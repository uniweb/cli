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
 *
 * See kb/platform/plans/cli-site-deploy-decisions.md for the full design.
 */

import { createServer } from 'node:http'
import { existsSync } from 'node:fs'
import { readFile, writeFile, readdir, stat } from 'node:fs/promises'
import { resolve, join, basename } from 'node:path'
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
// Rough mime map for the formats Vite passes through. Keep it small: covers
// what a real site produces from markdown + theme.yml. Falls back to
// application/octet-stream on unknowns.
const MIME_BY_EXT = {
  webp: 'image/webp', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
  gif: 'image/gif', svg: 'image/svg+xml', ico: 'image/x-icon',
  pdf: 'application/pdf',
  woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf',
  mp4: 'video/mp4', webm: 'video/webm', ogg: 'audio/ogg',
  json: 'application/json', csv: 'text/csv', txt: 'text/plain',
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

  const cliToken = await ensureAuth({ command: 'Deploying' })

  // Ensure dist/ is present. Phase 1 just uses site-content.json — binary
  // assets under dist/assets/* aren't uploaded yet.
  const distDir = join(siteDir, 'dist')
  const contentPath = join(distDir, 'site-content.json')
  if (!existsSync(contentPath)) {
    if (skipBuild) {
      say.err('No build found and --skip-build passed. Run `uniweb build` first.')
      process.exit(1)
    }
    say.warn('No build found. Building site…')
    console.log('')
    execSync('npx uniweb build', { cwd: siteDir, stdio: 'inherit' })
    console.log('')
    if (!existsSync(contentPath)) {
      say.err('Build did not produce dist/site-content.json')
      process.exit(1)
    }
  }

  // Read site-content.json — we need `languages` for the capability preview
  // and the whole object for the publish payload.
  const siteContent = JSON.parse(await readFile(contentPath, 'utf8'))
  const languages = extractLanguages(siteContent)
  const defaultLanguage = siteContent?.config?.defaultLanguage || languages[0] || 'en'
  const theme = await readTheme(siteDir, siteContent)

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

  let publishToken, siteIdResolved, handleResolved, publishUrl, validateUrl
  try {
    say.info('Requesting deploy authorization…')
    const authRes = await callAuthorize({
      backendUrl,
      cliToken,
      body: {
        siteId: siteYml.site?.id || '',
        foundation,
        runtimeVersion,
        languages,
        callbackUrl: loopback.callbackUrl,
      },
    })

    if (authRes.needsReview) {
      say.info(`Opening browser for ${authRes.intent === 'create' ? 'site creation' : 'review'}…`)
      say.dim(authRes.reviewUrl)
      await openBrowser(authRes.reviewUrl)
      console.log('')
      console.log(`${c.dim}Awaiting authorization in your browser…${c.reset}`)
      console.log(`${c.dim}(Will time out after ${REVIEW_TIMEOUT_MS / 60000} minutes)${c.reset}`)
      console.log('')

      const cb = await loopback.waitForCallback(REVIEW_TIMEOUT_MS)
      if (!cb || !cb.publishToken) {
        say.err('Browser authorization timed out or was denied.')
        process.exit(1)
      }
      publishToken = cb.publishToken
      siteIdResolved = cb.siteId
      handleResolved = cb.handle
      // Review path: Worker URLs are implicit (we derive them from config).
      publishUrl = `${workerUrl}/api/publish/process`
      validateUrl = `${workerUrl}/api/publish/validate`
    } else {
      publishToken = authRes.publishToken
      siteIdResolved = authRes.siteId
      handleResolved = authRes.handle
      publishUrl = authRes.publishUrl
      validateUrl = authRes.validateUrl
    }
  } finally {
    loopback.close()
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

  // Asset pipeline — upload dist/assets/* to S3, rewrite siteContent to use
  // identifier-based references so semantic-parser resolves CDN URLs (+
  // optimized variants) at render time. Skipped with --skip-assets.
  // Mutates siteContent in place: image/document nodes get info.identifier.
  if (!skipAssets) {
    await uploadAssetsAndRewriteContent({
      siteDir,
      siteContent,
      backendUrl,
      cliToken,
      siteId: siteIdResolved,
    })
  } else {
    say.dim('Skipping asset upload (--skip-assets).')
  }

  say.info('Publishing…')
  const publishPayload = {
    foundation,
    runtimeVersion,
    theme,
    languages,
    defaultLanguage,
    // Phase 1 single-locale wraps the content under the active locale. Multi-
    // locale CLI deploy needs per-locale collection (deferred — see plan §6).
    locales: { [defaultLanguage]: siteContent },
  }
  await callPublish({ url: publishUrl, token: publishToken, body: publishPayload })

  // Write site.id / site.handle back to site.yml so next `uniweb deploy`
  // fast-paths. Only touches the file on first deploy (or when the handle
  // drifted server-side).
  if (siteIdResolved && !siteYml.site?.id) {
    await writeSiteBinding(siteYmlPath, siteYml, { id: siteIdResolved, handle: handleResolved })
    say.dim(`Linked site.yml to site.id=${siteIdResolved}`)
  } else if (siteIdResolved && handleResolved && siteYml.site?.handle !== handleResolved) {
    await writeSiteBinding(siteYmlPath, siteYml, { id: siteIdResolved, handle: handleResolved })
    say.dim(`Updated site.yml handle → ${handleResolved}`)
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

/**
 * Write site.id + site.handle back to site.yml, preserving other fields.
 *
 * Note: this is not a full YAML-preserving write — comments and exact
 * formatting are NOT preserved. js-yaml's `dump` re-emits the document.
 * Acceptable for now; the Phase 1 plan doesn't promise comment preservation.
 */
async function writeSiteBinding(path, current, binding) {
  const next = {
    ...current,
    site: { ...(current.site || {}), id: binding.id, handle: binding.handle },
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
  // Editor-shape `[{ value, label }]` vs plain `[string]`.
  return langs.map((l) => (typeof l === 'string' ? l : l?.value)).filter(Boolean)
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
    const msg = parsed?.error || `HTTP ${res.status}`
    say.err(`Authorize failed: ${msg}`)
    process.exit(1)
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
async function uploadAssetsAndRewriteContent({ siteDir, siteContent, backendUrl, cliToken, siteId }) {
  const distAssetsDir = join(siteDir, 'dist', 'assets')
  if (!existsSync(distAssetsDir)) {
    say.dim('No dist/assets — skipping asset pipeline.')
    return
  }

  // 1. Enumerate local files + read size.
  const localFiles = await walkAssetDir(distAssetsDir)
  if (localFiles.length === 0) {
    say.dim('dist/assets is empty — skipping asset pipeline.')
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

  // 6. Rewrite siteContent in place. Each image/document node whose
  //    src/href references a local /assets/{filename} gets an info.identifier
  //    pointing to the uploaded (or reused) asset.
  const byFilenameAll = new Map([...reused, ...fresh])
  const rewritten = rewriteAssetReferences(siteContent, byFilenameAll)
  if (rewritten > 0) {
    say.dim(`Rewrote ${rewritten} asset reference(s) in site content.`)
  }
}

async function walkAssetDir(dir) {
  const out = []
  const entries = await readdir(dir, { withFileTypes: true, recursive: true })
  for (const entry of entries) {
    if (!entry.isFile()) continue
    const fullPath = join(entry.parentPath || entry.path, entry.name)
    const st = await stat(fullPath)
    const ext = (entry.name.split('.').pop() || '').toLowerCase()
    out.push({
      filename: entry.name,
      fullPath,
      size: st.size,
      mime: MIME_BY_EXT[ext] || 'application/octet-stream',
    })
  }
  return out
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
      return false
    } catch {
      if (attempt < maxRetries) continue
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
      const ref = pickAssetRef(n.attrs.src) || pickAssetRef(n.attrs.href)
      if (ref) {
        const identifier = byFilename.get(ref)
        if (identifier) {
          n.attrs.info = {
            ...(n.attrs.info || {}),
            identifier,
            contentType: 'website',
            viewType: 'profile',
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
