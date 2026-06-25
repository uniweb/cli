/**
 * uniweb publish — the smart Uniweb-hosting flagship (shipping-model.md §3).
 *
 * `uniweb login && uniweb publish` is meant to be the most ergonomic command in
 * the tool: run it, and it does the right thing — talks to the backend,
 * understands the project, and makes the site live on Uniweb hosting (synced +
 * dynamically served). It:
 *
 *   1. resolves WHICH site (your location, or the workspace's one site; multiple
 *      → prompt);
 *   2. BRINGS THE FOUNDATION ALONG — if the site's local foundation changed
 *      since its last release, releases the new version first (or asks); a
 *      published registry ref needs nothing (§4, foundation-bring-along.js);
 *   3. SYNCS — builds the site data (link mode), uploads media + the static-data
 *      ball, and pushes content (the same two-lane sync `uniweb push` uses);
 *   4. SETTLES PAYMENT when the backend says go-live needs it — opens a browser
 *      to uniweb.app, waits, continues (provider-agnostic; payment-handoff.js);
 *   5. GOES LIVE — POST /dev/site/publish/{uuid}.
 *
 * Distinct from `uniweb deploy` (third-party hosts) and `uniweb register`
 * (foundation code → catalog). For a self-contained artifact, see `uniweb export`.
 *
 * Backend: BackendClient. Origin from --backend/--registry > UNIWEB_REGISTER_URL
 * > default. Auth: --token > UNIWEB_TOKEN > `uniweb login` session.
 *
 * Usage:
 *   uniweb publish                 Bring the foundation along, sync, and go live
 *   uniweb publish --dry-run       Resolve everything; POST nothing
 *   uniweb publish --yes           Skip confirmations (CI); never block on a prompt
 *   uniweb publish --no-save       Skip the deploy.yml lastDeploy auto-save
 *   uniweb publish --backend <url> Override the backend origin
 *   uniweb publish --token <bearer> Auth bearer (skips `uniweb login`)
 */

import { existsSync, readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { execSync } from 'node:child_process'
import { createInterface } from 'node:readline/promises'
import yaml from 'js-yaml'

import {
  loadDeployYml,
  resolveTarget,
  recordLastDeploy,
  assembleDataBall,
  collectBallAssets,
  rewriteBallAssets,
} from '@uniweb/build/site'
import { emitSyncPackages } from '@uniweb/build/uwx'

import { BackendClient } from '../backend/client.js'
import { resolveSiteDir } from './deploy.js'
import { readFlagValue } from '../utils/args.js'
import { isNonInteractive } from '../utils/interactive.js'
import { makeModelResolver, readSyncCache, pushSyncPackages } from '../backend/site-sync.js'
import { uploadDataBundle } from '../backend/data-bundle.js'
import { uploadSiteMedia } from '../backend/site-media.js'
import { bringFoundationAlong } from '../backend/foundation-bring-along.js'
import { settlePaymentIfNeeded } from '../backend/payment-handoff.js'

const c = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  cyan: '\x1b[36m', green: '\x1b[32m', yellow: '\x1b[33m', red: '\x1b[31m',
}
const say = {
  ok: (m) => console.log(`${c.green}✓${c.reset} ${m}`),
  info: (m) => console.log(`${c.cyan}→${c.reset} ${m}`),
  warn: (m) => console.log(`${c.yellow}⚠${c.reset} ${m}`),
  err: (m) => console.error(`${c.red}✗${c.reset} ${m}`),
  dim: (m) => console.log(`  ${c.dim}${m}${c.reset}`),
}

// Minimal yes/no prompt. Returns `defaultYes` on an empty answer.
async function confirm(question, defaultYes = false) {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    const a = (await rl.question(`${question} ${defaultYes ? '[Y/n]' : '[y/N]'} `)).trim().toLowerCase()
    if (!a) return defaultYes
    return a === 'y' || a === 'yes'
  } finally {
    rl.close()
  }
}

// Highest installed runtime from the backend's /dev/config list (numeric-aware
// sort). Null when the list is empty.
function pickHighestRuntime(installed) {
  if (!Array.isArray(installed) || installed.length === 0) return null
  return [...installed].sort((a, b) => String(b).localeCompare(String(a), undefined, { numeric: true }))[0]
}

// Origin-relative serve path → clickable absolute URL (self-serve default).
function absolutizeServeUrl(origin, url) {
  if (!url || typeof url !== 'string') return null
  if (/^https?:\/\//.test(url)) return url
  return `${origin.replace(/\/$/, '')}${url.startsWith('/') ? '' : '/'}${url}`
}

function readSiteYml(path) {
  if (!existsSync(path)) return {}
  try {
    const parsed = yaml.load(readFileSync(path, 'utf8'))
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

// Languages from the BUILT site-content.json (config.languages) — the authority
// after a build. Three accepted shapes: 'en', { value, label }, { code, label }.
function languagesFromContent(siteContent) {
  const langs = siteContent?.config?.languages
  if (!Array.isArray(langs) || langs.length === 0) return ['en']
  return langs.map((l) => (typeof l === 'string' ? l : l?.value || l?.code)).filter(Boolean)
}

// Languages from site.yml — used only for the dry-run summary (no build yet).
function languagesFromSiteYml(siteYml) {
  const def = siteYml.defaultLanguage || siteYml.lang || 'en'
  const locales = siteYml.i18n?.locales || siteYml.languages
  if (!Array.isArray(locales) || locales.length === 0) return null
  const norm = locales.map((l) => (typeof l === 'string' ? l : l?.value || l?.code)).filter(Boolean)
  return [def, ...norm.filter((l) => l !== def)]
}

// Persist deploy.yml lastDeploy memory (skipped on --no-save / autoSave 'off').
async function persistLastDeploy(siteDir, opts) {
  if (opts.autoSave === 'off') return
  try {
    const result = await recordLastDeploy(siteDir, opts)
    if (result?.created) say.dim(`Wrote deploy.yml (target: ${opts.targetName})`)
  } catch (err) {
    // The publish itself succeeded — never fail the whole command on a
    // memo-write error. Surface it so the user can fix the file.
    say.dim(`Could not update deploy.yml: ${err.message}`)
  }
}

export async function publish(args = []) {
  const dryRun = args.includes('--dry-run')
  const noSave = args.includes('--no-save')
  const asOrg = readFlagValue(args, '--as-org')
  const foundationDir = readFlagValue(args, '--foundation') // optional local foundation for Model schemas

  const siteDir = await resolveSiteDir(args, 'publish')
  const siteYml = readSiteYml(join(siteDir, 'site.yml'))

  const client = new BackendClient({
    originFlag: readFlagValue(args, '--backend') || readFlagValue(args, '--registry'),
    token: readFlagValue(args, '--token') || undefined,
    args,
    command: 'Publishing',
  })

  // Capability handshake (cached). Publish ends in a go-live, so the publish
  // lane must be offered.
  const config = await client.discover()
  if (config?.delivery && config.delivery.publish === false) {
    say.err(`Backend at ${client.origin} does not offer the publish lane (delivery.publish=false).`)
    return { exitCode: 1 }
  }

  // Runtime: an explicit site.yml::runtime pin wins; else the highest installed;
  // else fail closed (better than serving a site with no runtime). A dry-run is
  // a pure preview, so it only WARNS — it stays useful with no backend reachable.
  const installed = Array.isArray(config?.runtime?.installed) ? config.runtime.installed : []
  if (siteYml.runtime && installed.length && !installed.includes(siteYml.runtime)) {
    say.err(`Runtime ${siteYml.runtime} (from site.yml) is not installed on the backend.`)
    say.dim(`Installed: ${installed.join(', ') || '(none)'} — pin one of these in site.yml (\`runtime:\`), or have it installed on the backend.`)
    if (!dryRun) return { exitCode: 1 }
  }
  const runtimeVersion = siteYml.runtime || pickHighestRuntime(installed)
  if (!runtimeVersion && !dryRun) {
    say.err('Could not resolve a runtime version.')
    say.dim('Pin one with `runtime:` in site.yml, or install one on the backend so /dev/config reports it.')
    return { exitCode: 1 }
  }

  // deploy.yml target (the Uniweb hosting memory). No --target on publish — it
  // always targets Uniweb hosting; resolveTarget gives us the target name +
  // autoSave for the lastDeploy memo.
  let resolved
  try {
    const deployYml = await loadDeployYml(siteDir)
    resolved = resolveTarget(deployYml, null)
  } catch {
    resolved = { targetName: 'default', host: 'uniweb', fromFile: false, autoSave: 'on' }
  }
  const autoSave = noSave ? 'off' : (resolved.autoSave || 'on')

  if (dryRun) {
    say.info('Dry run — would bring the foundation along, sync, and go live:')
    say.dim(`Backend     : ${client.origin}`)
    say.dim(`Runtime     : ${runtimeVersion || '(unresolved — needs a backend or a site.yml runtime: pin)'}${runtimeVersion && !siteYml.runtime ? ' (highest installed)' : ''}`)
    say.dim(`site_uuid   : ${siteYml.$uuid || '(none — the first push mints it)'}`)
    const langs = languagesFromSiteYml(siteYml)
    if (langs) say.dim(`Languages   : ${langs.join(', ')}`)
    await bringFoundationAlong({ client, siteDir, siteYml, args, say, confirm, cliBin: process.argv[1], dryRun: true })
    await settlePaymentIfNeeded({ client, uuid: siteYml.$uuid || null, args, say, dryRun: true })
    return { exitCode: 0 }
  }

  // 1. Bring the foundation along — release the local foundation if its code
  //    changed (or isn't registered). Never ship a site pointing at stale code.
  let fnd
  try {
    fnd = await bringFoundationAlong({ client, siteDir, siteYml, args, say, confirm, cliBin: process.argv[1] })
  } catch (err) {
    say.err(`Foundation release failed: ${err.message}`)
    say.dim('Fix the foundation, then re-run `uniweb publish`.')
    return { exitCode: 1 }
  }
  if (!fnd.proceed) return { exitCode: 0 }

  // 2. Build the site data (link mode): dist/site-content.json (+ per-locale),
  //    dist/data/*, dist/_search/*, dist/assets/*. Spawn the SAME CLI binary so
  //    the inner build can't resolve to a different installed version.
  say.info('Building site…')
  console.log('')
  execSync(`node ${JSON.stringify(process.argv[1])} build --link`, { cwd: siteDir, stdio: 'inherit', env: process.env })
  console.log('')

  const distDir = join(siteDir, 'dist')
  const contentPath = join(distDir, 'site-content.json')
  if (!existsSync(contentPath)) {
    say.err('Build did not produce dist/site-content.json')
    return { exitCode: 1 }
  }

  // Non-local @std/registry Model schemas resolve through the backend (same as push).
  const resolveModel = makeModelResolver({ client, offline: false })

  // 3. Partition collections by schema presence (a first emit reads `schemaless`
  //    — collections with no data schema, delivered statically via the ball).
  let probe
  try {
    probe = await emitSyncPackages(siteDir, { ...(foundationDir ? { foundationDir } : {}), resolveModel })
  } catch (err) {
    say.err(`Could not build the sync package: ${err.message}`)
    return { exitCode: 1 }
  }
  const schemalessNames = (probe.schemaless || []).map((col) => col.name)
  const localAssets = probe.localAssets || []

  // 4. Assemble the static-data ball (schema-less data + search index) BEFORE
  //    uploading, since its records can carry local media too.
  let ball = await assembleDataBall(distDir, schemalessNames)
  const ballAssets = collectBallAssets(ball)

  // 4b. Upload ALL local media (entity refs + ball refs) on one asset lane →
  //     the ref→serveUrl map; rewrite the entity content AND the ball with it.
  let assetRewrite = null
  const mediaRefs = [...new Set([...localAssets, ...ballAssets])]
  if (mediaRefs.length) {
    say.info('Uploading media…')
    try {
      const map = await uploadSiteMedia(client, siteDir, mediaRefs, {
        onProgress: (m) => say.dim(`  ${m}`),
        warn: (m) => say.dim(`! ${m}`),
      })
      if (Object.keys(map).length) assetRewrite = map
      if (ballAssets.length) ball = rewriteBallAssets(ball, map)
      say.dim(`Media          : ${Object.keys(map).length}/${mediaRefs.length} ref(s) → serve URL`)
    } catch (err) {
      say.err(`Media upload failed: ${err.message}`)
      return { exitCode: 1 }
    }
  }

  // 4c. Upload the (media-rewritten) ball → its content-addressed serve URL.
  let dataBundle
  if (ball) {
    say.info('Uploading data bundle…')
    try {
      dataBundle = await uploadDataBundle(client, ball, { onProgress: (m) => say.dim(`  ${m}`) })
    } catch (err) {
      say.err(`Data bundle upload failed: ${err.message}`)
      return { exitCode: 1 }
    }
    say.dim(`Data bundle    : ${Object.keys(ball.data).length} data + ${Object.keys(ball.search).length} search file(s)`)
  }

  // 5. Push the site (content + folder) over the send-only-changed cache —
  //    the SAME two-lane submission `uniweb push` uses — stamping
  //    info.data_bundle and rewriting local media refs to backend serve URLs.
  const priorHashes = readSyncCache(siteDir)
  let pkg
  try {
    pkg = await emitSyncPackages(siteDir, {
      ...(foundationDir ? { foundationDir } : {}),
      resolveModel,
      priorHashes,
      ...(dataBundle ? { injectInfo: { data_bundle: dataBundle } } : {}),
      ...(assetRewrite ? { assetRewrite } : {}),
    })
  } catch (err) {
    say.err(`Could not build the sync package: ${err.message}`)
    return { exitCode: 1 }
  }
  for (const w of pkg.warnings) say.dim(`! ${w}`)
  const report = {
    info: (m) => say.info(m),
    note: (m) => say.dim(m),
    error: (m) => say.err(m),
    dim: (s) => `${c.dim}${s}${c.reset}`,
  }
  const pushResult = await pushSyncPackages({ client, siteDir, pkg, asOrg, report })
  if (pushResult.exitCode !== 0) return { exitCode: pushResult.exitCode }
  const siteUuid = pushResult.boundSiteUuid
  if (!siteUuid) {
    say.err('Push did not yield a site uuid — cannot go live.')
    return { exitCode: 1 }
  }

  // 6. Payment gate — the backend says whether go-live needs payment. Settles
  //    via a browser handoff to uniweb.app; degrades to "proceed" when the
  //    backend exposes no payment route. The draft is already synced, so a
  //    decline leaves a recoverable state (re-run after paying).
  const pay = await settlePaymentIfNeeded({ client, uuid: siteUuid, args, say })
  if (!pay.proceed) {
    say.info('Site synced as a draft but not made live. Re-run `uniweb publish` once payment is complete.')
    return { exitCode: 0 }
  }

  // 7. Go live — make the just-pushed composite live (its current backend state).
  const siteContent = JSON.parse(await readFile(contentPath, 'utf8'))
  const languages = languagesFromContent(siteContent)
  say.info(`Publishing to ${c.dim}${client.origin}${c.reset} …`)
  let pubRes
  try {
    pubRes = await client.publishSite(siteUuid, { runtimeVersion, ...(languages ? { languages } : {}) })
  } catch (err) {
    say.err(`Could not reach the backend at ${client.origin}: ${err.message}`)
    say.dim('Set the origin with --backend <url> or UNIWEB_REGISTER_URL.')
    return { exitCode: 1 }
  }
  if (!pubRes.ok) {
    say.err(`Publish rejected: HTTP ${pubRes.status} ${pubRes.statusText}`)
    if (pubRes.status === 401 || pubRes.status === 403) {
      say.dim("Credentials weren't accepted — run `uniweb login` (or pass --token <bearer>).")
    }
    const body = await pubRes.text().catch(() => '')
    if (body) say.dim(body.slice(0, 800))
    return { exitCode: 1 }
  }
  let result
  try { result = await pubRes.json() } catch { result = {} }
  const serveUrl = absolutizeServeUrl(client.origin, result.url)

  // 8. Persist deploy.yml memory — a record of what went live (and so a re-run
  //    reuses the resolved target without re-asking). One identity:
  //    site.yml::$uuid. `released` records whether this publish shipped a new
  //    foundation version (the bring-along, §4).
  const foundationRef = typeof siteYml.foundation === 'string' ? siteYml.foundation : siteYml.foundation?.ref || null
  await persistLastDeploy(siteDir, {
    targetName: resolved.targetName,
    targetConfig: resolved.fromFile ? null : { host: 'uniweb' },
    autoSave,
    lastDeploy: {
      at: new Date().toISOString(),
      host: 'uniweb',
      backend: client.origin,
      siteUuid,
      url: serveUrl,
      foundation: { ...(foundationRef ? { ref: foundationRef } : {}), released: fnd.released },
      runtime: runtimeVersion,
      locales: Array.isArray(result.locales) ? result.locales : languages,
    },
  })

  console.log('')
  say.ok(`Published ${c.bold}${siteUuid}${c.reset}${result.status ? ` (${result.status})` : ''}`)
  if (serveUrl) console.log(`  ${c.cyan}${serveUrl}${c.reset}`)
  if (result.deploy_uuid) say.dim(`deploy: ${result.deploy_uuid}`)
  return { exitCode: 0 }
}

export default publish
