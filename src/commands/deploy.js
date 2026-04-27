/**
 * Deploy Command
 *
 * Deploys a built site to Uniweb hosting. Phase 1 — link-mode, content + theme
 * + locales only (no binary assets yet).
 *
 * Flow:
 *   1. Read site.yml → { site.id?, site.handle?, foundation, runtime? }.
 *   2. Resolve runtime (default: GET /api/runtime/latest from the Worker).
 *   3. ensureAuth() → bearer CLI JWT from ~/.uniweb/auth.json.
 *   4. Build `dist/` if missing.
 *   5. Load dist/site-content.json → extract `languages` for the capability
 *      preview.
 *   6. Start an ephemeral loopback listener for the browser-callback path.
 *   7. POST PHP /cli-deploy.php?action=authorize with { siteId?, foundation,
 *      runtimeVersion, languages, callbackUrl }.
 *   8. Branch:
 *        - publishToken returned → fast path.
 *        - needsReview:true + reviewUrl → open browser, wait for callback,
 *          consume { publishToken, siteId, handle }.
 *   9. POST Worker /api/publish/validate to confirm foundation + runtime
 *      exist and the token's namespace claim matches.
 *  10. POST Worker /api/publish/process with the full payload.
 *  11. On first-deploy create flow: write site.id + site.handle back into
 *      site.yml so subsequent deploys fast-path.
 *
 * Usage:
 *   uniweb deploy                          Normal deploy (browser may open on first deploy)
 *   uniweb deploy --skip-build             Don't rebuild even if dist/ is stale
 *   uniweb deploy --dry-run                Resolve everything but skip the Worker POST
 *   uniweb deploy --skip-billing           Admin-only: bypass billing gate (dev/testing)
 *   uniweb deploy --review                 Force the browser review path even when
 *                                          there's no drift (e.g., to change features)
 *
 * See kb/platform/plans/cli-site-deploy-decisions.md for the full design.
 */

import { createServer } from 'node:http'
import { existsSync } from 'node:fs'
import { readFile, writeFile, readdir, stat } from 'node:fs/promises'
import { resolve, join, basename, relative, sep } from 'node:path'
import { execSync } from 'node:child_process'
import yaml from 'js-yaml'

import { ensureAuth } from '../utils/auth.js'
import { getBackendUrl, getRegistryUrl } from '../utils/config.js'
import {
  findWorkspaceRoot,
  findSites,
  classifyPackage,
  promptSelect,
} from '../utils/workspace.js'
import { isNonInteractive, getCliPrefix } from '../utils/interactive.js'

const REVIEW_TIMEOUT_MS = 15 * 60 * 1000 // 15 min — matches PHP session TTL
const ASSET_UPLOAD_CONCURRENCY = 6
const ASSET_UPLOAD_RETRIES = 2
// Vite content-addresses these formats. Same filename → same content, so we
// can skip upload without checking size. Unhashed formats fall through to
// size-compare diffing.
const VITE_HASHED_FILENAME_RE = /-[0-9a-f]{8,}\.[a-z0-9]+$/i

// MEDIA extensions only — images, fonts, documents, video/audio. dist/assets/
// also contains Vite's JS/CSS chunks and source maps, which are code, not
// user media, and are served by the Worker from elsewhere (runtime bundle +
// content injection). Uploading those is wasted storage — they're never
// referenced. Mirror of ProfileAsset's ALLOWED_EXTENSIONS minus the text
// formats that have no place in a static media bucket.
const MEDIA_EXTENSIONS = new Set([
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'ico',
  'pdf', 'doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx', 'xlsm', 'xlsb',
  'mp4', 'webm', 'ogg',
  'woff', 'woff2', 'ttf', 'otf', 'eot',
])
const MIME_BY_EXT = {
  webp: 'image/webp', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
  gif: 'image/gif', svg: 'image/svg+xml', ico: 'image/x-icon',
  pdf: 'application/pdf',
  woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf',
  eot: 'application/vnd.ms-fontobject',
  mp4: 'video/mp4', webm: 'video/webm', ogg: 'audio/ogg',
}

const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
}
const say = {
  ok: (m) => console.log(`${c.green}✓${c.reset} ${m}`),
  info: (m) => console.log(`${c.cyan}→${c.reset} ${m}`),
  warn: (m) => console.log(`${c.yellow}⚠${c.reset} ${m}`),
  err: (m) => console.error(`${c.red}✗${c.reset} ${m}`),
  dim: (m) => console.log(`  ${c.dim}${m}${c.reset}`),
}

// ─── Main ───────────────────────────────────────────────────

export async function deploy(args = []) {
  const skipBuild = args.includes('--skip-build')
  const dryRun = args.includes('--dry-run')
  const skipAssets = args.includes('--skip-assets')
  const skipBilling = args.includes('--skip-billing')
  // --review forces the browser review path even when there's no drift.
  // Useful for "I want to look at / change my features" without first
  // having to edit site.yml. The toggles in the review page persist live
  // to DB, so any change the user makes there ends up in site.yml after
  // the loopback finalize roundtrip.
  const forceReview = args.includes('--review')

  const siteDir = await resolveSiteDir(args)
  const backendUrl = getBackendUrl()
  const workerUrl = getRegistryUrl()

  // Read site.yml — declares the foundation (required) and optionally the
  // site.id / site.handle from prior deploys.
  const siteYmlPath = join(siteDir, 'site.yml')
  const siteYml = await readSiteYml(siteYmlPath)
  const foundation = siteYml.foundation
  if (!foundation) {
    say.err('site.yml is missing `foundation`.')
    say.dim('Add a line like:  foundation: \'@uniweb/docs-foundation@0.1.20\'')
    process.exit(1)
  }

  // Runtime defaults to "latest" resolved at authorize time.
  let runtimeVersion = siteYml.runtime
  if (!runtimeVersion) {
    runtimeVersion = await fetchLatestRuntime(workerUrl)
    if (!runtimeVersion) {
      say.err('Could not resolve a runtime version (no runtime: in site.yml, /api/runtime/latest failed).')
      process.exit(1)
    }
    say.dim(`Runtime: ${runtimeVersion} (latest; pin via \`runtime:\` in site.yml)`)
  }

  // Optional `features:` declaration. Acts as a "request" — CLI sends to
  // PHP, PHP routes through review when it differs from the site's current
  // metadata. Unknown names get warned + dropped before sending so a typo
  // doesn't fail the whole deploy.
  const desiredFeatures = readFeaturesFromYaml(siteYml)

  const cliToken = await ensureAuth({ command: 'Deploying' })

  // Always rebuild unless the user explicitly opts out with --skip-build.
  // A stale dist/ from a previous build + edited content on disk would
  // otherwise silently ship yesterday's version — a footgun big enough
  // to warrant the extra seconds every deploy.
  const distDir = join(siteDir, 'dist')
  const contentPath = join(distDir, 'site-content.json')
  if (!skipBuild) {
    say.info('Building site…')
    console.log('')
    // No VITE_FOUNDATION_MODE override needed: @uniweb/build's
    // detectFoundationType recognizes `@ns/name@version` refs as
    // link-mode URLs, which auto-enters runtime mode. Prerender also
    // auto-skips for link-mode foundations (HTML is rendered on the
    // serving edge, not here).
    execSync('npx uniweb build', {
      cwd: siteDir,
      stdio: 'inherit',
    })
    console.log('')
  } else if (!existsSync(contentPath)) {
    say.err('No build found and --skip-build passed. Run `uniweb build` first.')
    process.exit(1)
  }
  if (!existsSync(contentPath)) {
    say.err('Build did not produce dist/site-content.json')
    process.exit(1)
  }

  // Read site-content.json — we need `languages` for the capability preview
  // and the whole object for the publish payload.
  const siteContent = JSON.parse(await readFile(contentPath, 'utf8'))
  const languages = extractLanguages(siteContent)
  const languageLabels = extractLanguageLabels(siteContent)
  const defaultLanguage = siteContent?.config?.defaultLanguage || languages[0] || 'en'
  const theme = await readTheme(siteDir, siteContent)

  // Multi-locale: @uniweb/build emits dist/<lang>/site-content.json per
  // non-default locale via buildLocalizedContent (translations applied via
  // locales/<lang>.json + freeform/). Load each one so we can ship a full
  // locales: map in the publish payload — same shape as Editor publish.
  // Single-locale sites just have the default and skip the loop.
  const localeContents = { [defaultLanguage]: siteContent }
  for (const lang of languages) {
    if (lang === defaultLanguage) continue
    const localeContentPath = join(distDir, lang, 'site-content.json')
    if (existsSync(localeContentPath)) {
      localeContents[lang] = JSON.parse(await readFile(localeContentPath, 'utf8'))
    } else {
      say.warn(`Locale "${lang}" listed in site config but no dist/${lang}/site-content.json found — skipping.`)
    }
  }

  if (dryRun) {
    say.info('Dry run — showing what would be deployed:')
    say.dim(`Site dir       : ${siteDir}`)
    say.dim(`site.id        : ${siteYml.site?.id || '(none — would use create flow)'}`)
    say.dim(`Foundation     : ${foundation}`)
    say.dim(`Runtime        : ${runtimeVersion}`)
    say.dim(`Languages      : ${languages.join(', ')}`)
    say.dim(`Default locale : ${defaultLanguage}`)
    say.dim(`Backend (PHP)  : ${backendUrl}`)
    say.dim(`Worker         : ${workerUrl}`)
    return
  }

  // Spin up the loopback listener eagerly — we need its callback URL for the
  // authorize request even on the fast path (PHP may always return
  // needsReview=true on first deploy / billing drift in future phases).
  const loopback = await startLoopback()

  let publishToken, siteIdResolved, handleResolved, publishUrl, validateUrl, mintedFeatures
  try {
    say.info('Requesting deploy authorization…')
    const authorizeBody = {
      siteId: siteYml.site?.id || '',
      foundation,
      runtimeVersion,
      languages,
      // Optional `{ code: label }` map from site.yml's object-form
      // languages. PHP stamps this into the session JWT so CliDeployReview
      // can use real labels (English, Français, …) when provisioning the
      // site, instead of falling back to `lang.toUpperCase()`.
      ...(languageLabels ? { languageLabels } : {}),
      // `name` from site.yml is a hint for the create-flow review page so
      // the handle input is pre-filled. Ignored by authorize in other
      // branches (fast path, intent=authorize).
      name: typeof siteYml.name === 'string' ? siteYml.name : '',
      callbackUrl: loopback.callbackUrl,
      // Dev-only: admin-gated server-side. PHP rejects for non-admins.
      skipBilling: skipBilling || undefined,
      // site.yml-declared target feature set. PHP routes through review
      // (with the desired set pre-applied) when it differs from DB.
      // Always sent as an array; missing/empty `features:` in site.yml
      // is normalized to `[]`, meaning "no paid features".
      desiredFeatures,
      // User-forced review (`uniweb deploy --review`). PHP refuses to
      // fast-path even when nothing else has drifted.
      forceReview: forceReview || undefined,
    }
    let authRes
    try {
      authRes = await callAuthorize({ backendUrl, cliToken, body: authorizeBody })
    } catch (err) {
      // Stale-siteId recovery: the user's site.yml points at a site that
      // no longer exists on the server (deleted, different env, etc.).
      // Warn, drop the siteId, and retry — we'll land in the create flow
      // and write a fresh site.id back to site.yml after success.
      if (err.status === 404 && authorizeBody.siteId) {
        say.warn(`site.id "${authorizeBody.siteId}" was not found on the server.`)
        say.dim('Treating as a new site — the create flow will run in your browser.')
        authorizeBody.siteId = ''
        authRes = await callAuthorize({ backendUrl, cliToken, body: authorizeBody })
      } else {
        say.err(`Authorize failed: ${err.message}`)
        process.exit(1)
      }
    }

    if (authRes.needsReview) {
      const flowLabel = authRes.intent === 'create' ? 'site creation' : 'review'
      // openBrowser returns a hint about whether a GUI was available. On
      // headless/CI environments (no DISPLAY, SSH session, no browser
      // command), we print the URL + clear instructions instead of just
      // "timed out" 15 minutes later.
      say.info(`Opening browser for ${flowLabel}…`)
      say.dim(authRes.reviewUrl)
      const opened = await openBrowser(authRes.reviewUrl)
      console.log('')
      if (opened === false) {
        say.warn('No browser could be launched in this environment.')
        console.log(`${c.dim}Open this URL manually to complete the ${flowLabel}:${c.reset}`)
        console.log(`  ${authRes.reviewUrl}`)
        console.log('')
        console.log(`${c.dim}The browser must be able to POST to this CLI's loopback listener:${c.reset}`)
        console.log(`  ${loopback.callbackUrl}`)
        console.log(`${c.dim}If you're in CI or over SSH, run this deploy from a machine with a browser.${c.reset}`)
        console.log('')
      }
      console.log(`${c.dim}Awaiting authorization…${c.reset}`)
      console.log(`${c.dim}(Will time out after ${REVIEW_TIMEOUT_MS / 60000} minutes)${c.reset}`)
      console.log('')

      const cb = await loopback.waitForCallback(REVIEW_TIMEOUT_MS)
      if (!cb || !cb.publishToken) {
        say.err('Browser authorization timed out or was denied.')
        if (opened === false) {
          say.dim('Hint: the browser may have run on a different machine and couldn\'t reach this CLI\'s loopback.')
        }
        process.exit(1)
      }
      publishToken = cb.publishToken
      siteIdResolved = cb.siteId
      handleResolved = cb.handle
      // PHP echoes the live feature set in the loopback callback so the
      // CLI can write `features:` back into site.yml accurately. Older
      // PHP that doesn't include this field is a no-op.
      mintedFeatures = Array.isArray(cb.features) ? cb.features : null
      // Review path: Worker URLs are implicit (we derive them from config).
      publishUrl = `${workerUrl}/api/publish/process`
      validateUrl = `${workerUrl}/api/publish/validate`
    } else {
      publishToken = authRes.publishToken
      siteIdResolved = authRes.siteId
      handleResolved = authRes.handle
      publishUrl = authRes.publishUrl
      validateUrl = authRes.validateUrl
      mintedFeatures = Array.isArray(authRes.features) ? authRes.features : null
    }
  } finally {
    loopback.close()
  }

  // Write site.id / handle to site.yml AS SOON as we have them, before any
  // step that can fail (validate, asset upload, publish). On first deploy
  // the user has already paid by this point — losing the link to the
  // server's site row would force a duplicate-create on the next attempt
  // (and a second subscription). The features write happens later after
  // publish; this early write only covers id/handle.
  if (siteIdResolved && !siteYml.site?.id) {
    await writeSiteYmlUpdates(siteYmlPath, siteYml, {
      site: { id: siteIdResolved, handle: handleResolved },
    })
    siteYml.site = { ...(siteYml.site || {}), id: siteIdResolved, handle: handleResolved }
    say.dim(`Linked site.yml to site.id=${siteIdResolved}`)
  }

  // Pre-flight against the Worker. Surfaces "foundation not published" /
  // "runtime not found" / namespace mismatch BEFORE we ship content.
  say.info('Validating foundation + runtime…')
  const validation = await callValidate({
    url: validateUrl,
    token: publishToken,
    body: { foundation, runtimeVersion },
  })
  if (!validation.valid) {
    say.err('Pre-flight validation failed:')
    for (const issue of validation.issues || []) {
      console.log(`    ${c.red}${issue.code}${c.reset}: ${issue.message}`)
      if (issue.fix) console.log(`      ${c.dim}${issue.fix}${c.reset}`)
    }
    process.exit(1)
  }

  // Asset pipeline — upload dist/assets/* + favicon + fonts to S3, then
  // rewrite each locale's siteContent so semantic-parser resolves CDN URLs
  // at render time. Assets themselves are locale-shared (they live in
  // dist/assets/ regardless of language), so the diff/upload runs once
  // and the rewrite walks every locale's content tree in localeContents.
  // Skipped with --skip-assets.
  if (!skipAssets) {
    await uploadAssetsAndRewriteContent({
      siteDir,
      localeContents,
      siteYml,
      theme,
      backendUrl,
      cliToken,
      siteId: siteIdResolved,
    })
  } else {
    say.dim('Skipping asset upload (--skip-assets).')
  }

  // Collect compiled collection JSON files from dist/data/. The framework
  // emits these for `collection:` data sources — `<name>.json` cascade
  // payloads plus per-record `<name>/<slug>.json` files when `deferred:` is
  // declared. Editor publish has no equivalent (collections live in the DB);
  // CLI sites need them shipped as static R2 objects.
  const dataFiles = await collectDataFiles(distDir)
  if (Object.keys(dataFiles).length > 0) {
    say.dim(`Data files     : ${Object.keys(dataFiles).length} (collection JSON)`)
  }

  say.info('Publishing…')
  const publishPayload = {
    foundation,
    runtimeVersion,
    theme,
    languages,
    defaultLanguage,
    // Compiled collection JSON files (relative-path → utf8 content). Worker
    // publish writes each to ${sitePrefix}/data/<key>; worker serve allows
    // /data/* paths from R2 alongside _pages/*.
    ...(Object.keys(dataFiles).length > 0 ? { dataFiles } : {}),
    // Same shape as Editor publish — one entry per language. Single-locale
    // sites end up with `{ [defaultLanguage]: siteContent }`; multi-locale
    // sites carry per-locale translated content emitted by buildLocalizedContent.
    locales: localeContents,
  }
  await callPublish({ url: publishUrl, token: publishToken, body: publishPayload })

  // Write site.id / site.handle / features back to site.yml so the file
  // stays in sync with the live billing state. site.id and site.handle
  // are written on first deploy and any time the server-side handle drifts.
  // `features:` is rewritten whenever the live (server-confirmed) set
  // differs from what's declared — including the case where the user
  // declared `[]` and the live set is `[]` (no diff, no write).
  const siteIdChanged = !!siteIdResolved && !siteYml.site?.id
  const handleChanged = !!siteIdResolved && !!handleResolved && siteYml.site?.handle !== handleResolved
  // desiredFeatures is what we sent to PHP (the simplified model: missing
  // == empty), so comparing mintedFeatures against it tells us whether
  // the file needs updating. Skip the write when nothing changed.
  const featuresChanged = mintedFeatures !== null
    && !arrayEqualsAsSets(desiredFeatures, mintedFeatures)

  if (siteIdChanged || handleChanged || featuresChanged) {
    const updates = {}
    if (siteIdChanged || handleChanged) {
      updates.site = { id: siteIdResolved, handle: handleResolved }
    }
    if (featuresChanged) {
      updates.features = mintedFeatures
    }
    await writeSiteYmlUpdates(siteYmlPath, siteYml, updates)
    if (siteIdChanged) say.dim(`Linked site.yml to site.id=${siteIdResolved}`)
    else if (handleChanged) say.dim(`Updated site.yml handle → ${handleResolved}`)
    if (featuresChanged) {
      say.dim(`Updated site.yml features → [${mintedFeatures.join(', ') || '(none)'}]`)
    }
  }

  console.log('')
  say.ok(`Deployed ${c.bold}${handleResolved || siteIdResolved || 'site'}${c.reset}`)
  if (handleResolved) {
    console.log(`  ${c.cyan}https://${handleResolved}.uniweb.website/${c.reset}`)
  }
}

// ─── site.yml ──────────────────────────────────────────────

async function readSiteYml(path) {
  if (!existsSync(path)) return {}
  try {
    const parsed = yaml.load(await readFile(path, 'utf8'))
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch (err) {
    say.err(`Could not parse ${path}: ${err.message}`)
    process.exit(1)
  }
}

// Recognized paid features. `features:` in site.yml uses these short
// names; the PHP backend maps them to internal metadata flags. Anything
// else gets dropped with a warning so a typo doesn't block a deploy.
const KNOWN_FEATURES = new Set(['search', 'analytics', 'lowTtl', 'intelligence'])

function readFeaturesFromYaml(siteYml) {
  // site.yml's `features:` is the developer's declarative intent for what
  // paid features they want billed. We treat absence and `features: []` as
  // the same thing — both mean "no paid features". This keeps the model
  // simple: what's in the file is what the user wants. No "no opinion"
  // escape hatch. Legacy sites that have paid features in DB but no
  // features: line yet will see a downgrade-review on their next deploy
  // (they cancel and add the explicit list, or proceed and downgrade).
  const raw = siteYml?.features
  if (raw === undefined) return []
  if (!Array.isArray(raw)) {
    say.warn('site.yml `features:` should be a list (e.g. `features: [search]`). Treating as empty.')
    return []
  }
  const valid = []
  const unknown = []
  for (const v of raw) {
    if (typeof v !== 'string') continue
    if (KNOWN_FEATURES.has(v)) valid.push(v)
    else unknown.push(v)
  }
  if (unknown.length > 0) {
    say.warn(`site.yml features: unknown name(s) ignored: ${unknown.join(', ')}`)
    say.dim(`Known features: ${[...KNOWN_FEATURES].join(', ')}`)
  }
  // Dedupe + stable order so authorize compares the same way every time.
  return [...new Set(valid)].sort()
}

function arrayEqualsAsSets(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return false
  if (a.length !== b.length) return false
  const sa = new Set(a)
  for (const x of b) if (!sa.has(x)) return false
  return true
}

/**
 * Write a partial set of updates back to site.yml, preserving other fields.
 *
 * Note: this is not a full YAML-preserving write — comments and exact
 * formatting are NOT preserved. js-yaml's `dump` re-emits the document.
 * Acceptable for now; the Phase 1 plan doesn't promise comment preservation.
 */
async function writeSiteYmlUpdates(path, current, updates) {
  const next = { ...current }
  if (updates.site) {
    next.site = { ...(current.site || {}), ...updates.site }
  }
  if (updates.features !== undefined) {
    next.features = [...updates.features].sort()
  }
  const dumped = yaml.dump(next, { lineWidth: 120, noRefs: true, quotingType: "'" })
  await writeFile(path, dumped)
}

// ─── Resolve site dir + runtime ────────────────────────────

async function resolveSiteDir(args) {
  const cwd = process.cwd()
  const prefix = getCliPrefix()

  const type = await classifyPackage(cwd)
  if (type === 'site') return cwd

  const workspaceRoot = findWorkspaceRoot(cwd)
  if (workspaceRoot) {
    const sites = await findSites(workspaceRoot)
    if (sites.length === 1) return resolve(workspaceRoot, sites[0])
    if (sites.length > 1) {
      if (isNonInteractive(args)) {
        say.err('Multiple sites found. Specify which one to deploy.')
        console.log('')
        for (const s of sites) {
          console.log(`  ${c.cyan}cd ${s} && ${prefix} deploy${c.reset}`)
        }
        process.exit(1)
      }
      const choice = await promptSelect('Which site?', sites)
      if (!choice) {
        console.log('\nDeploy cancelled.')
        process.exit(0)
      }
      return resolve(workspaceRoot, choice)
    }
  }

  say.err('No site found in this workspace.')
  say.dim('`deploy` publishes a built Uniweb site to the hosting platform.')
  process.exit(1)
}

async function fetchLatestRuntime(workerUrl) {
  try {
    const res = await fetch(`${workerUrl}/api/runtime/latest`)
    if (!res.ok) return null
    const body = await res.json()
    return body.version || null
  } catch {
    return null
  }
}

// ─── Content helpers ───────────────────────────────────────

function extractLanguages(siteContent) {
  const langs = siteContent?.config?.languages
  if (!Array.isArray(langs) || langs.length === 0) return ['en']
  // Three accepted shapes: plain `'en'`, Editor `{ value, label }`, site.yml `{ code, label }`.
  return langs.map((l) => (typeof l === 'string' ? l : l?.value || l?.code)).filter(Boolean)
}

// Collect compiled collection JSON files from dist/data/ recursively.
// Returns `{ '<relPath>': '<utf8-content>' }` keyed by the path under data/
// so the worker can write each to `${sitePrefix}/data/<relPath>` in R2.
// Empty object when the site has no `collection:` data sources.
async function collectDataFiles(distDir) {
  const dataDir = join(distDir, 'data')
  if (!existsSync(dataDir)) return {}
  const files = {}
  const entries = await readdir(dataDir, { withFileTypes: true, recursive: true })
  for (const entry of entries) {
    if (!entry.isFile()) continue
    if (!entry.name.endsWith('.json')) continue
    const fullPath = join(entry.parentPath || entry.path, entry.name)
    const relPath = relative(dataDir, fullPath)
    files[relPath] = await readFile(fullPath, 'utf8')
  }
  return files
}

// Optional per-language labels from site.yml's object form. Returns null when
// site.yml uses the plain-string form (no labels declared) — server falls back
// to its own defaults in that case.
function extractLanguageLabels(siteContent) {
  const langs = siteContent?.config?.languages
  if (!Array.isArray(langs)) return null
  const labels = {}
  for (const l of langs) {
    if (typeof l === 'string') continue
    const code = l?.value || l?.code
    if (code && l?.label) labels[code] = l.label
  }
  return Object.keys(labels).length > 0 ? labels : null
}

/**
 * Resolve theme config.
 *
 * The build pipeline does not (today) emit a separate theme.json, so we read
 * the developer-authored theme.yml from the site root. The Worker's
 * `buildTheme()` tolerates an empty config — sites with no theme.yml still
 * publish, they just get default tokens.
 */
async function readTheme(siteDir, siteContent) {
  const themePath = join(siteDir, 'theme.yml')
  if (existsSync(themePath)) {
    try {
      const parsed = yaml.load(await readFile(themePath, 'utf8'))
      if (parsed && typeof parsed === 'object') return parsed
    } catch {
      // fall through to site-content.json fallback
    }
  }
  // site-content sometimes carries a `theme` key produced by collectors.
  if (siteContent?.theme && typeof siteContent.theme === 'object') {
    return siteContent.theme
  }
  return {}
}

// ─── HTTP calls ────────────────────────────────────────────

async function callAuthorize({ backendUrl, cliToken, body }) {
  // PHP's BaseController reads the `action` from the JSON body (not the query
  // string) when Content-Type: application/json. Every PHP POST needs to embed
  // `action` in the payload.
  const url = `${backendUrl}/cli-deploy.php`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cliToken}`,
    },
    body: JSON.stringify({ action: 'authorize', ...body }),
  })

  let parsed
  try {
    parsed = await res.json()
  } catch {
    say.err(`Authorize returned non-JSON (HTTP ${res.status})`)
    process.exit(1)
  }

  if (!res.ok) {
    // Throw a structured error so the caller can branch — 404 on a known
    // siteId means "site.yml is stale, fall back to create flow" rather
    // than "hard fail". Other statuses remain fatal to the caller.
    const err = new Error(parsed?.error || `HTTP ${res.status}`)
    err.status = res.status
    throw err
  }

  // The controller returns `data` wrapped by BaseController — unwrap if so.
  return parsed.data ?? parsed
}

async function callValidate({ url, token, body }) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    let err = `HTTP ${res.status}`
    try {
      const j = await res.json()
      err = j.error || err
    } catch {}
    say.err(`Validate failed: ${err}`)
    process.exit(1)
  }
  return res.json()
}

async function callPublish({ url, token, body }) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    let err = `HTTP ${res.status}`
    try {
      const j = await res.json()
      err = j.error || err
    } catch {}
    say.err(`Publish failed: ${err}`)
    process.exit(1)
  }
  return res.json()
}

// ─── Asset pipeline (Phase 4) ──────────────────────────────

/**
 * Walk dist/assets/*, diff against the server's manifest, upload what
 * changed, and rewrite siteContent's image/document nodes to reference
 * identifiers. Designed to be idempotent: on a no-change deploy, the diff
 * yields zero uploads and only the rewrite runs (cheap).
 *
 * siteContent is mutated in place so the caller's publish payload picks up
 * the rewritten nodes without passing anything back.
 */
async function uploadAssetsAndRewriteContent({ siteDir, localeContents, siteYml, theme, backendUrl, cliToken, siteId }) {
  const distAssetsDir = join(siteDir, 'dist', 'assets')
  const hasDistAssets = existsSync(distAssetsDir)

  // 1. Enumerate local files + read size.
  const localFiles = hasDistAssets ? await walkAssetDir(distAssetsDir) : []

  // 1a. Favicon — sits at site root, not in dist/assets. Ship it through
  //     the same pipeline so it ends up at assets.uniweb.app with an
  //     identifier; config.favicon gets set further down.
  const faviconPath = await detectFavicon(siteDir, siteYml)
  if (faviconPath) {
    const ext = (faviconPath.split('.').pop() || '').toLowerCase()
    const st = await stat(faviconPath)
    localFiles.push({
      filename: faviconPath.split(sep).pop(),
      fullPath: faviconPath,
      size: st.size,
      mime: MIME_BY_EXT[ext] || 'application/octet-stream',
    })
  }

  // 1b. Custom fonts — scan public/fonts/<family>/<weight>-<style>.{woff,woff2}
  //     filtered to families actually referenced by theme slots. Each file
  //     enters the same upload pipeline; faces[] with CDN URLs is assembled
  //     below after identifiers are known.
  const fontFiles = theme?.fonts?.faces
    ? [] // User declared faces manually — skip auto-scan
    : await discoverUsedFonts(siteDir, theme)
  for (const f of fontFiles) {
    localFiles.push({
      filename: f.filename,
      fullPath: f.fullPath,
      size: f.size,
      mime: MIME_BY_EXT[(f.filename.split('.').pop() || '').toLowerCase()] || 'application/octet-stream',
    })
  }

  if (localFiles.length === 0) {
    say.dim('No assets to upload.')
    return
  }

  // 2. Fetch server manifest.
  const server = await callAssetsAction({ backendUrl, cliToken, action: 'listAssets', body: { siteId } })
  const byFilename = new Map()
  for (const a of server.assets || []) byFilename.set(a.filename, a)

  // 3. Diff. Vite-hashed filenames are content-addressed (filename match →
  //    skip); unhashed formats fall through to size compare.
  const needUpload = []
  const reused = new Map() // filename → identifier (for content rewrite)
  for (const f of localFiles) {
    const server = byFilename.get(f.filename)
    if (!server) {
      needUpload.push(f)
      continue
    }
    if (VITE_HASHED_FILENAME_RE.test(f.filename) || server.size === f.size) {
      reused.set(f.filename, server.identifier)
    } else {
      needUpload.push(f)
    }
  }

  say.info(
    `Assets: ${c.bold}${needUpload.length}${c.reset} to upload, ` +
      `${c.bold}${reused.size}${c.reset} reused, ` +
      `${c.bold}${server.assets?.length || 0}${c.reset} on server.`
  )

  // 4. Plan + upload new ones.
  const fresh = new Map() // filename → identifier
  if (needUpload.length > 0) {
    const plan = await callAssetsAction({
      backendUrl, cliToken, action: 'planUploads',
      body: {
        siteId,
        files: needUpload.map((f) => ({ filename: f.filename, size: f.size, mime: f.mime })),
      },
    })

    if (plan.quota) {
      const usedMB = (plan.quota.usedBytes / 1048576).toFixed(1)
      const addKB = (plan.quota.wouldAddBytes / 1024).toFixed(1)
      say.dim(`Storage: ${usedMB} MB used (+${addKB} KB this deploy)`)
    }

    const byFilenameInPlan = new Map()
    for (const u of plan.uploads || []) byFilenameInPlan.set(u.filename, u)

    // Parallel upload with bounded concurrency + per-file retries.
    const queue = needUpload.map((f) => ({ f, plan: byFilenameInPlan.get(f.filename) }))
    const confirmed = []
    const failed = []
    await runInPool(queue, ASSET_UPLOAD_CONCURRENCY, async ({ f, plan }) => {
      if (!plan) {
        say.warn(`Server didn't return an upload plan for ${f.filename} — skipping.`)
        failed.push(f.filename)
        return
      }
      const ok = await putToS3WithRetry(f, plan.presignedPost, ASSET_UPLOAD_RETRIES)
      if (ok) {
        confirmed.push({ recordId: plan.recordId, filename: f.filename, identifier: plan.identifier })
      } else {
        failed.push(f.filename)
      }
    })

    if (failed.length > 0) {
      say.err(`Asset upload failed for ${failed.length} file(s): ${failed.join(', ')}`)
      process.exit(1)
    }

    // 5. Commit successful uploads.
    const confirmRes = await callAssetsAction({
      backendUrl, cliToken, action: 'confirmUploads',
      body: { siteId, uploaded: confirmed.map((u) => ({ recordId: u.recordId })) },
    })
    if ((confirmRes.failed || []).length > 0) {
      say.warn(`Server couldn't confirm ${confirmRes.failed.length} upload(s). Check storage/retry.`)
    }
    for (const u of confirmed) fresh.set(u.filename, u.identifier)
  }

  // 6. Rewrite each locale's content in place. Image/document nodes whose
  //    src/href references a local /assets/{filename} get an info.identifier
  //    pointing to the uploaded (or reused) asset. Walking every locale
  //    means translated content (which still references the same image
  //    files via the source ProseMirror tree) gets the same rewrite.
  const byFilenameAll = new Map([...reused, ...fresh])
  let rewritten = 0
  for (const lang of Object.keys(localeContents)) {
    rewritten += rewriteAssetReferences(localeContents[lang], byFilenameAll)
  }
  if (rewritten > 0) {
    say.dim(`Rewrote ${rewritten} asset reference(s) across ${Object.keys(localeContents).length} locale(s).`)
  }

  // 7. If a favicon was included above, inject its resolved CDN URL into
  //    every locale's config.favicon. Matches Editor publish (which sets
  //    favicon per-locale); Worker bakes <link rel="icon"> from the active
  //    locale's content.config.favicon.
  if (faviconPath) {
    const favName = faviconPath.split(sep).pop()
    const favIdentifier = byFilenameAll.get(favName)
    if (favIdentifier) {
      const faviconUrl = resolveAssetCdnUrl(favIdentifier)
      for (const lang of Object.keys(localeContents)) {
        localeContents[lang].config = { ...(localeContents[lang].config || {}), favicon: faviconUrl }
      }
      say.dim(`Favicon: ${favName}`)
    }
  }

  // 8. Assemble theme.fonts.faces from uploaded font files. Replaces the
  //    local /fonts/... src with the CDN URL for each identifier. Mirrors
  //    unicloud's scanFontDirectory → faces[] shape so @uniweb/theming
  //    emits @font-face + preload links without any other changes.
  if (fontFiles.length > 0) {
    const faces = []
    for (const f of fontFiles) {
      const identifier = byFilenameAll.get(f.filename)
      if (!identifier) continue
      faces.push({
        family: f.family,
        src: resolveAssetCdnUrl(identifier),
        weight: f.weight,
        style: f.style,
        format: f.format,
      })
    }
    if (faces.length > 0) {
      theme.fonts = { ...(theme.fonts || {}), faces }
      const families = [...new Set(faces.map((x) => x.family))].join(', ')
      say.dim(`Fonts: ${faces.length} face(s) across ${families}`)
    }
  }
}

async function walkAssetDir(dir) {
  const out = []
  const entries = await readdir(dir, { withFileTypes: true, recursive: true })
  for (const entry of entries) {
    if (!entry.isFile()) continue
    const ext = (entry.name.split('.').pop() || '').toLowerCase()
    // Only upload media. JS/CSS/JSON/map files in dist/assets/ are Vite's
    // build output — the Worker serves the site via runtime/{version}/ +
    // content injection, not from these chunks.
    if (!MEDIA_EXTENSIONS.has(ext)) continue
    const fullPath = join(entry.parentPath || entry.path, entry.name)
    const st = await stat(fullPath)
    out.push({
      filename: entry.name,
      fullPath,
      size: st.size,
      mime: MIME_BY_EXT[ext] || 'application/octet-stream',
    })
  }
  return out
}

// Detect the site's favicon on disk. Order: explicit `favicon:` in site.yml,
// then any of favicon.{svg,ico,png,webp} at the site root. Returns null when
// nothing is found (site serves without a favicon).
async function detectFavicon(siteDir, siteYml) {
  if (typeof siteYml?.favicon === 'string' && siteYml.favicon.trim()) {
    const p = resolve(siteDir, siteYml.favicon.trim())
    if (existsSync(p)) return p
    say.warn(`site.yml favicon "${siteYml.favicon}" not found on disk — falling back to auto-detect.`)
  }
  // Check both the site root and Vite's public/ directory (public/* is the
  // source for static assets copied verbatim into dist/ at build time).
  const dirs = [siteDir, join(siteDir, 'public')]
  for (const dir of dirs) {
    for (const name of ['favicon.svg', 'favicon.ico', 'favicon.png', 'favicon.webp']) {
      const p = join(dir, name)
      if (existsSync(p)) return p
    }
  }
  return null
}

// Named weight → CSS numeric weight. Matches unicloud's font-scanner.js so
// the CLI-deploy path and the local unicloud dev path agree on conventions.
const FONT_WEIGHT_MAP = {
  thin: 100, hairline: 100, extralight: 200, ultralight: 200, light: 300,
  normal: 400, regular: 400, medium: 500, semibold: 600, demibold: 600,
  bold: 700, extrabold: 800, ultrabold: 800, black: 900, heavy: 900,
}

// Parse "bold-normal.woff2" / "400-italic.woff" style filenames into weight,
// style, format. Returns null on any unrecognized shape (caller skips the file).
function parseFontFilename(filename) {
  const dotIdx = filename.lastIndexOf('.')
  if (dotIdx === -1) return null
  const ext = filename.slice(dotIdx + 1).toLowerCase()
  if (ext !== 'woff' && ext !== 'woff2') return null
  const format = ext === 'woff2' ? 'woff2' : 'woff'
  const stem = filename.slice(0, dotIdx)
  const parts = stem.split('-')
  if (parts.length < 2) return null
  const style = parts[parts.length - 1].toLowerCase()
  if (style !== 'normal' && style !== 'italic') return null
  const weightPart = parts.slice(0, -1).join('').toLowerCase()
  const numWeight = parseInt(weightPart, 10)
  if (!isNaN(numWeight) && numWeight >= 1 && numWeight <= 999) {
    return { weight: numWeight, style, format }
  }
  const mapped = FONT_WEIGHT_MAP[weightPart]
  if (mapped) return { weight: mapped, style, format }
  return null
}

// Extract the set of lowercase family names referenced by theme slots
// (heading/body/mono and any declared _userSlots). Mirrors
// @uniweb/theming's extractUsedFamilies — used here to drop font files
// for families the theme doesn't actually consume, so upload stays lean.
function extractUsedFontFamilies(theme) {
  const fonts = theme?.fonts || {}
  const slots = fonts._userSlots || ['body', 'heading', 'mono']
  const generic = new Set([
    'serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui',
    'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded',
  ])
  const used = new Set()
  for (const slot of slots) {
    const v = fonts[slot]
    if (typeof v !== 'string') continue
    for (const seg of v.split(',')) {
      const n = seg.trim().replace(/^["']|["']$/g, '').toLowerCase()
      if (n && !generic.has(n)) used.add(n)
    }
  }
  return used
}

// Scan public/fonts/<family>/<weight>-<style>.{woff,woff2} and return the
// files belonging to families that the theme actually uses. Returning [] is
// the normal case for sites that don't ship custom fonts.
async function discoverUsedFonts(siteDir, theme) {
  const fontsDir = join(siteDir, 'public', 'fonts')
  if (!existsSync(fontsDir)) return []
  const used = extractUsedFontFamilies(theme)
  if (used.size === 0) return []

  let familyDirs
  try {
    familyDirs = await readdir(fontsDir, { withFileTypes: true })
  } catch {
    return []
  }

  const out = []
  for (const entry of familyDirs) {
    if (!entry.isDirectory()) continue
    const family = entry.name.toLowerCase()
    if (!used.has(family)) continue // Skip unreferenced families.
    const familyDir = join(fontsDir, entry.name)
    let files
    try {
      files = await readdir(familyDir, { withFileTypes: true })
    } catch { continue }
    for (const file of files) {
      if (!file.isFile()) continue
      const parsed = parseFontFilename(file.name)
      if (!parsed) continue
      const fullPath = join(familyDir, file.name)
      const st = await stat(fullPath)
      out.push({
        filename: file.name,
        fullPath,
        size: st.size,
        family,
        weight: parsed.weight,
        style: parsed.style,
        format: parsed.format,
      })
    }
  }
  return out
}

// Resolve an asset identifier ({uuid}/{filename}) to the canonical CDN URL.
// Mirrors `resolveAssetIdentifier` in @uniweb/semantic-parser so the favicon
// URL shape matches everything else the Worker sees from Editor publishes.
function resolveAssetCdnUrl(identifier) {
  if (!identifier || typeof identifier !== 'string') return ''
  const [uuid, filename] = identifier.split('/')
  if (!filename) return ''
  const ext = filename.substring(filename.lastIndexOf('.') + 1)
  return `https://assets.uniweb.app/dist/${uuid}/base.${ext}`
}

async function callAssetsAction({ backendUrl, cliToken, action, body }) {
  const res = await fetch(`${backendUrl}/cli-assets.php`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cliToken}`,
    },
    body: JSON.stringify({ action, ...body }),
  })
  let parsed
  try { parsed = await res.json() } catch {
    throw new Error(`cli-assets.${action} returned non-JSON (HTTP ${res.status})`)
  }
  if (!res.ok) {
    throw new Error(parsed?.error || `cli-assets.${action} failed (HTTP ${res.status})`)
  }
  return parsed.data ?? parsed
}

/**
 * POST a single file to S3 via a pre-signed POST. Retries transient
 * failures (network errors + 5xx) up to `maxRetries` times before giving up.
 * S3 pre-signed POSTs don't support resumable upload, so each retry is a
 * full re-POST. File sizes are <= 50 MB so that's tolerable.
 */
async function putToS3WithRetry(file, presigned, maxRetries) {
  const body = await readFile(file.fullPath)
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      // Node's FormData doesn't produce what S3 wants — build a multipart
      // body manually using fetch's standard FormData, giving us File-like
      // semantics via Blob.
      const form = new FormData()
      for (const [k, v] of Object.entries(presigned.fields)) form.append(k, String(v))
      form.append('file', new Blob([body], { type: file.mime }), file.filename)

      const res = await fetch(presigned.url, { method: 'POST', body: form })
      if (res.ok || res.status === 204) return true
      if (res.status >= 500 && attempt < maxRetries) continue
      // Surface the server's response so failures are diagnosable. S3
      // returns XML with a useful <Code>/<Message> on rejection (e.g.
      // AccessDenied + reason); silently retrying without surfacing it
      // hides real config issues like bucket-permission mismatches.
      const errBody = await res.text().catch(() => '')
      say.warn(`Upload of ${file.filename} rejected by S3 (HTTP ${res.status}):\n  ${errBody.slice(0, 500)}`)
      return false
    } catch (err) {
      if (attempt < maxRetries) continue
      say.warn(`Upload of ${file.filename} failed: ${err?.message || err}`)
      return false
    }
  }
  return false
}

/**
 * Run up to `concurrency` promises at a time from `items`. Returns when all
 * settle. Propagates errors as thrown (caller wraps in try/catch if needed)
 * — but the worker here swallows per-item errors and collects them instead.
 */
async function runInPool(items, concurrency, worker) {
  let i = 0
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++
      await worker(items[idx])
    }
  })
  await Promise.all(runners)
}

/**
 * Walk siteContent (ProseMirror-ish JSON tree) and rewrite any node whose
 * `attrs.src` or `attrs.href` references a local `/assets/{filename}` that
 * we've uploaded/reused. Sets `attrs.info.identifier` so semantic-parser
 * resolves the real CDN URL (and optimized variants) at render time.
 *
 * Returns the number of rewrites performed — useful for reporting, and to
 * detect "nothing matched" (likely a content-shape mismatch worth flagging).
 */
function rewriteAssetReferences(node, byFilename) {
  let count = 0
  const walk = (n) => {
    if (!n || typeof n !== 'object') return
    if (Array.isArray(n)) { for (const child of n) walk(child); return }
    if (n.attrs && typeof n.attrs === 'object') {
      const srcRef = pickAssetRef(n.attrs.src)
      const hrefRef = pickAssetRef(n.attrs.href)
      const ref = srcRef || hrefRef
      if (ref) {
        const identifier = byFilename.get(ref)
        if (identifier) {
          n.attrs.info = {
            ...(n.attrs.info || {}),
            identifier,
            contentType: 'website',
            viewType: 'profile',
          }
          // Clear the local Vite-hashed path so the runtime resolves via
          // info.identifier (→ assets.uniweb.app CDN) instead of requesting
          // a non-existent /assets/... file from the site host.
          if (srcRef) n.attrs.src = null
          if (hrefRef) n.attrs.href = null
          // Match the Editor shape: plain `image` nodes skip identifier
          // resolution in older runtimes; `ImageBlock` routes through
          // parseImgBlock which reads info.identifier and fills url.
          if (n.type === 'image' && n.attrs.role !== 'icon') {
            n.type = 'ImageBlock'
          }
          count++
        }
      }
    }
    for (const v of Object.values(n)) if (typeof v === 'object') walk(v)
  }
  walk(node)
  return count
}

function pickAssetRef(v) {
  if (typeof v !== 'string') return null
  // Match "/assets/filename.ext", "./assets/filename.ext", "assets/filename.ext".
  const m = v.match(/(?:^|\/|\.\/)assets\/([^/?#]+)$/)
  return m ? m[1] : null
}

// ─── Loopback listener (review path) ───────────────────────

/**
 * Start an HTTP server on a random loopback port to receive the publish
 * token from the browser. The server accepts ONE request to /callback; after
 * that it's closed.
 *
 * Same shape as `login.js::browserLogin`, but POST-accepting since the web
 * app POSTs JSON (not a redirect with query params like CliAuthController).
 */
async function startLoopback() {
  return new Promise((resolveReady) => {
    let resolveCallback
    const callbackPromise = new Promise((r) => { resolveCallback = r })

    const server = createServer((req, res) => {
      const u = new URL(req.url, 'http://localhost')
      if (u.pathname !== '/callback') {
        res.writeHead(404)
        res.end('Not found')
        return
      }

      // CORS preflight — the web app POSTs JSON cross-origin, so browsers
      // send an OPTIONS preflight first. Respond with permissive CORS headers.
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Max-Age': '3600',
        })
        res.end()
        return
      }

      // Accept POST (web app posts JSON) or GET (browser redirect with params)
      if (req.method === 'POST') {
        let buf = ''
        req.on('data', (chunk) => (buf += chunk))
        req.on('end', () => {
          let payload = {}
          try { payload = JSON.parse(buf) } catch {}
          respondSuccess(res)
          resolveCallback(payload)
        })
        return
      }
      if (req.method === 'GET') {
        const publishToken = u.searchParams.get('token')
        const siteId = u.searchParams.get('siteId')
        const handle = u.searchParams.get('handle')
        if (!publishToken) {
          res.writeHead(400, { 'Content-Type': 'text/html' })
          res.end('<h2>Missing token</h2>')
          return
        }
        respondSuccess(res)
        resolveCallback({ publishToken, siteId, handle })
        return
      }
      res.writeHead(405)
      res.end('Method not allowed')
    })

    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port
      resolveReady({
        callbackUrl: `http://127.0.0.1:${port}/callback`,
        waitForCallback: (timeoutMs) => Promise.race([
          callbackPromise,
          new Promise((r) => setTimeout(() => r(null), timeoutMs)),
        ]),
        close: () => { try { server.close() } catch {} },
      })
    })
  })
}

function respondSuccess(res) {
  // CORS preflight + actual response, since the web app POSTs cross-origin.
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
  })
  res.end(
    '<html><body style="font-family:system-ui;text-align:center;padding:60px">' +
    '<h2 style="color:#16a34a">Deploy authorized</h2>' +
    '<p>You can close this window and return to your terminal.</p>' +
    '</body></html>'
  )
}

async function openBrowser(url) {
  try {
    const { exec } = await import('node:child_process')
    const cmd = process.platform === 'darwin'
      ? `open "${url}"`
      : process.platform === 'win32'
        ? `start "" "${url}"`
        : `xdg-open "${url}"`
    return new Promise((r) => exec(cmd, (err) => r(!err)))
  } catch {
    return false
  }
}

export default deploy
