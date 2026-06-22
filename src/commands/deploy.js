/**
 * Deploy Command
 *
 * Deploys a site. Host is determined by the resolved deploy.yml target
 * (or `--target <name>` / `--host <name>` flags). The default is `uniweb`:
 *
 *   - `uniweb` (default): Uniweb hosting — link-mode + edge JIT prerender.
 *     Foundation loaded by URL from the registry. Requires `uniweb login`
 *     and a `foundation:` declaration in site.yml.
 *
 *   - Static-host adapters (`s3-cloudfront`, `cloudflare-pages`,
 *     `github-pages`, `generic-static`, …): build dist/ in bundle-mode
 *     and hand it to a host adapter for upload + invalidation. No login,
 *     no edge.
 *
 * For static-host artifacts WITHOUT upload, see `uniweb export`. To publish a
 * site that already lives on the backend as a synced draft, see `uniweb release`.
 *
 * Uniweb-host flow (deployToUniwebBackend) — the composite deploy = build → ball →
 * media → push → publish:
 *   1. Resolve the site dir + deploy.yml target; discover() the backend (GET
 *      /dev/config) and resolve the runtime (`site.yml::runtime` if pinned, else the
 *      backend's highest installed; fail closed if neither resolves).
 *   2. Build the site data (link mode): site-content.json (+ per-locale variants),
 *      collection data, search indexes, processed assets.
 *   3. Partition collections by schema presence: schema-less → the static-data ball;
 *      schema-backed → typed folder entities on the push lane.
 *   4. Upload the site's local media (entity refs + the ball's refs, one deduped set) →
 *      each site-root ref's backend serve URL; rewrite the ball with it, then upload the
 *      rewritten ball (content-addressed → `info.data_bundle`).
 *   5. Push — the SAME two-lane sync `uniweb push` uses (site-content with
 *      `info.data_bundle` stamped + media refs rewritten, then the folder + records) —
 *      over the send-only-changed cache; the backend mints/round-trips the site uuid.
 *   6. Publish — make the just-pushed composite live; the backend returns the serve URL.
 *
 * Usage:
 *   uniweb deploy                  Build + deploy to the resolved target
 *   uniweb deploy --dry-run        Resolve everything; POST nothing
 *   uniweb deploy --target <name>  Pick a target from deploy.yml (default: its `default:`)
 *   uniweb deploy --host <name>    One-off host override (not persisted to deploy.yml)
 *   uniweb deploy --no-save        Skip the deploy.yml lastDeploy auto-save
 *   uniweb deploy --backend <url>  Override the backend origin
 *
 * Backend: BackendClient. Origin from --backend/--registry > UNIWEB_REGISTER_URL
 * > the default. Auth: --token > UNIWEB_TOKEN > `uniweb login` session.
 *
 * Escape hatch: UNIWEB_SKIP_BUILD=1 reuses an existing dist/ (static-host flow).
 */

import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { execSync } from 'node:child_process'
import yaml from 'js-yaml'

import { loadDeployYml, resolveTarget, recordLastDeploy, assembleDataBall, collectBallAssets, rewriteBallAssets } from '@uniweb/build/site'
import { promptForHost } from '../utils/host-prompt.js'
import { readFlagValue } from '../utils/args.js'
import { parseBoolEnv } from '../utils/env.js'
import { BackendClient } from '../backend/client.js'
import { emitSyncPackages } from '@uniweb/build/uwx'
import { makeModelResolver, readSyncCache, pushSyncPackages } from '../backend/site-sync.js'
import { uploadDataBundle } from '../backend/data-bundle.js'
import { uploadSiteMedia } from '../backend/site-media.js'

import {
  findWorkspaceRoot,
  findSites,
  classifyPackage,
  promptSelect,
} from '../utils/workspace.js'
import { isNonInteractive, getCliPrefix } from '../utils/interactive.js'

const FOUNDATION_POLICIES = new Set(['exact', 'auto-patch', 'auto-minor'])

/**
 * Parse the `foundation:` field from site.yml into a normalized shape.
 *
 * Accepts:
 *   - string: '@uniweb/votiverse@0.1.1'
 *   - object: { ref: '@uniweb/votiverse@0.1.1', policy?: ..., pinned?: true }
 *
 * Returns one of:
 *   - { error: 'description of what's wrong' }
 *   - { normalized, policy?, pinned }   where `normalized` is whichever
 *     shape we received (string or { ref, policy?, pinned? }) — the Worker
 *     accepts both. `policy`/`pinned` are also returned individually so
 *     the CLI can print friendly diagnostics.
 *
 * Validation rules (mirrors publish.js::parseFoundationConfig):
 *   - `policy` must be one of 'exact', 'auto-patch', 'auto-minor'
 *   - `pinned: true` + `policy: not-exact` is rejected as conflicting
 */
function parseSiteFoundation(input) {
  if (typeof input === 'string') {
    return { normalized: input, policy: null, pinned: false }
  }
  if (!input || typeof input !== 'object') {
    return { error: 'foundation must be a string or object' }
  }

  // Object form must carry `ref`; everything else is metadata.
  if (!input.ref || typeof input.ref !== 'string') {
    return { error: 'foundation.ref is required when using object form' }
  }
  if (!/^@[a-z0-9_-]+\/[a-z0-9_-]+@.+$/.test(input.ref)) {
    return {
      error: `foundation.ref does not match @namespace/name@version: '${input.ref}'`,
    }
  }

  let policy = null
  if (input.policy != null) {
    if (!FOUNDATION_POLICIES.has(input.policy)) {
      return {
        error: `foundation.policy must be one of 'exact', 'auto-patch', 'auto-minor' (got '${input.policy}')`,
      }
    }
    policy = input.policy
  }
  const pinned = input.pinned === true

  if (pinned && policy && policy !== 'exact') {
    return {
      error: `foundation: 'pinned: true' conflicts with policy '${policy}'. ` +
        `Use either 'pinned: true' or 'policy: \"exact\"' (they're equivalent), or drop one.`,
    }
  }

  return {
    normalized: { ref: input.ref, ...(policy ? { policy } : {}), ...(pinned ? { pinned: true } : {}) },
    policy: pinned ? 'exact' : policy,
    pinned,
  }
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
  const dryRun = args.includes('--dry-run')
  const siteDir = await resolveSiteDir(args)
  // Read site.yml — declares the foundation (required) and optionally the
  // site.id / site.handle from prior deploys.
  const siteYmlPath = join(siteDir, 'site.yml')
  const siteYml = await readSiteYml(siteYmlPath)

  // Host dispatch.
  //
  // Resolution order:
  //   1. --target <name> picks a target from deploy.yml (full config:
  //      host + adapter-specific fields)
  //   2. deploy.yml's `default:` target is used when no flag is given
  //   3. With no deploy.yml at all, the implicit default is host: 'uniweb'
  //   4. --host <name> is a one-off override of the resolved target's host
  //      and does NOT persist on success (see saveDeployTarget below).
  //
  // The default flow (`uniweb`) requires a `foundation:` declaration;
  // static-host deploys don't, so this branch comes BEFORE the foundation
  // check.
  const targetFromFlag = readFlagValue(args, '--target')
  let hostFromFlag = readFlagValue(args, '--host')
  const noSave = args.includes('--no-save')

  let deployYml
  try {
    deployYml = await loadDeployYml(siteDir)
  } catch (err) {
    say.err(err.message)
    process.exit(1)
  }
  let resolved
  try {
    resolved = resolveTarget(deployYml, targetFromFlag || null)
  } catch (err) {
    say.err(err.message)
    process.exit(1)
  }
  // --host with no value → interactive picker. Pre-selects the resolved
  // target's host so Enter does the obvious thing.
  if (hostFromFlag === null) {
    try {
      hostFromFlag = await promptForHost({ args, preselect: resolved.host })
    } catch (err) {
      say.err(err.message)
      process.exit(1)
    }
  }
  const host = hostFromFlag || resolved.host
  const hostOverridden = !!hostFromFlag && hostFromFlag !== resolved.host
  // Auto-save scope: 'off' from --no-save OR an ad-hoc --host override
  // (we don't want a one-off experiment to rewrite the file).
  const autoSave = noSave || hostOverridden ? 'off' : resolved.autoSave

  if (host !== 'uniweb') {
    await deployStaticHost(siteDir, host, resolved, {
      dryRun,
      autoSave,
      hostOverridden,
    })
    return
  }

  if (!siteYml.foundation) {
    say.err('site.yml is missing `foundation`.')
    say.dim('Add a line like:  foundation: \'@uniweb/docs-foundation@0.1.20\'')
    process.exit(1)
  }

  // Foundation may be string or object form (see site.yml docs).
  const fnd = parseSiteFoundation(siteYml.foundation)
  if (fnd.error) {
    say.err(`site.yml: ${fnd.error}`)
    process.exit(1)
  }
  // `foundation` is the on-the-wire shape we forward to PHP authorize +
  // Worker publish. PHP only inspects the namespace via the ref string;
  // it doesn't care about policy/pinned, so the object form passes through.
  // The Worker (publish.js::parseFoundationConfig) handles both shapes.
  let foundation = fnd.normalized
  if (fnd.policy && fnd.policy !== 'auto-patch') {
    say.dim(`Foundation policy: ${fnd.policy}${fnd.pinned ? ' (pinned)' : ''}`)
  } else if (fnd.pinned) {
    say.dim('Foundation policy: exact (pinned)')
  }

  // Uniweb hosting → the new backend's /dev/deploy delivery lane (BackendClient):
  // one authed POST, no PHP authorize, no Worker publish, no JWT. Backend chosen by
  // origin only; capabilities + installed runtimes discovered via GET /dev/config.
  // Foundation/runtime resolution, payload assembly, the POST, and the deploy.yml
  // uuid round-trip all live in deployToUniwebBackend. The legacy PHP-authorize +
  // Worker-publish flow below is retired by this routing (excised on cutover).
  await deployToUniwebBackend(siteDir, siteYml, { foundation, args, dryRun, resolved, deployYml, autoSave })
  return
}

// ─── Uniweb-backend deploy (the /dev/deploy delivery lane) ────────────────
//
// Hosts a file-built site on the Uniweb backend through BackendClient: one authed
// POST /dev/deploy carrying the deploy payload `build-site-data.js` produces. The
// login bearer authorizes (the account IS the authorization) — no PHP authorize,
// no Worker publish, no JWT, no asset-presign dance. Backend is chosen by origin
// only (--backend/--registry > UNIWEB_REGISTER_URL > default); everything else is
// discovered via GET /dev/config (capabilities + installed runtimes). Replaces the
// legacy PHP+Worker flow in deploy() above.

async function deployToUniwebBackend(siteDir, siteYml, { foundation, args, dryRun, resolved, deployYml, autoSave }) {
  const client = new BackendClient({
    originFlag: readFlagValue(args, '--backend') || readFlagValue(args, '--registry'),
    token: readFlagValue(args, '--token'),
    args,
    command: 'Deploying',
  })

  const foundationDir = readFlagValue(args, '--foundation') // optional local foundation for Model schemas
  const asOrg = readFlagValue(args, '--as-org')

  // Anonymous capability handshake (cached). The composite deploy ends in a publish,
  // so confirm that lane is offered (the push/sync lanes are the backend's baseline).
  const config = await client.discover()
  if (config?.delivery && config.delivery.publish === false) {
    say.err(`Backend at ${client.origin} does not offer the publish lane (delivery.publish=false).`)
    process.exit(1)
  }

  // Runtime resolution: an explicit site.yml::runtime pin wins; else the highest
  // version the backend reports installed; else fail closed with a clear
  // precondition error (better than serving a site with no runtime).
  const installed = Array.isArray(config?.runtime?.installed) ? config.runtime.installed : []
  if (siteYml.runtime && installed.length && !installed.includes(siteYml.runtime)) {
    say.err(`Runtime ${siteYml.runtime} (from site.yml) is not installed on the backend.`)
    say.dim(`Installed: ${installed.join(', ') || '(none)'} — pin one of these in site.yml (\`runtime:\`), or have it installed on the backend.`)
    process.exit(1)
  }
  const runtimeVersion = siteYml.runtime || pickHighestRuntime(installed)
  if (!runtimeVersion) {
    say.err('Could not resolve a runtime version.')
    say.dim('Pin one with `runtime:` in site.yml, or install one on the backend so /dev/config reports it.')
    process.exit(1)
  }

  if (dryRun) {
    say.info('Dry run — would deploy to the Uniweb backend as a composite (ball → push → publish):')
    say.dim(`Backend     : ${client.origin}`)
    say.dim(`Foundation  : ${typeof foundation === 'string' ? foundation : foundation.ref}`)
    say.dim(`Runtime     : ${runtimeVersion}${siteYml.runtime ? '' : ' (highest installed)'}`)
    say.dim(`site_uuid   : ${siteYml.$uuid || '(none — the first push mints it)'}`)
    return
  }

  // Build (link mode): emits dist/data/*, dist/_search/*, dist/assets/*, and
  // dist/site-content.json. Spawn the SAME CLI binary so the inner build can't resolve
  // to a different installed version.
  say.info('Building site…')
  console.log('')
  execSync(`node ${JSON.stringify(process.argv[1])} build --link`, {
    cwd: siteDir,
    stdio: 'inherit',
    env: process.env,
  })
  console.log('')

  const distDir = join(siteDir, 'dist')
  const contentPath = join(distDir, 'site-content.json')
  if (!existsSync(contentPath)) {
    say.err('Build did not produce dist/site-content.json')
    process.exit(1)
  }

  // Non-local @std/registry Model schemas resolve through the backend (same as push).
  const resolveModel = makeModelResolver({ client, offline: false })

  // 1. Partition the collections by schema presence. A first emit reads `schemaless`
  //    — the collections with no data schema, delivered statically via the ball. Its
  //    packages are discarded (deploy is not a hot path; the cheap clarity beats a
  //    schemaless-only fast path, a later optimization).
  let probe
  try {
    probe = await emitSyncPackages(siteDir, { ...(foundationDir ? { foundationDir } : {}), resolveModel })
  } catch (err) {
    say.err(`Could not build the sync package: ${err.message}`)
    process.exit(1)
  }
  const schemalessNames = (probe.schemaless || []).map((col) => col.name)
  const localAssets = probe.localAssets || [] // entity-content site-root media refs

  // 2. Assemble the static-data ball (schema-less collection data + the search index) —
  //    BEFORE uploading it, because its schema-less records can carry local media too,
  //    which we upload + rewrite to serve URLs exactly like entity content (the backend
  //    serves a serve_url in the ball identically — it unwraps the ball verbatim).
  let ball = await assembleDataBall(distDir, schemalessNames)
  const ballAssets = collectBallAssets(ball)

  // 2b. Upload ALL local media (entity refs + ball refs) on one asset lane → the
  //     ref→serveUrl map. The same map rewrites the entity content (assetRewrite, real
  //     emit below) AND the ball (here, before it's uploaded). Co-located refs were
  //     warned + skipped by the producer; a missing file is skipped here (warned).
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
      if (ballAssets.length) ball = rewriteBallAssets(ball, map) // swap the ball's local refs → serve URLs
      say.dim(`Media          : ${Object.keys(map).length}/${mediaRefs.length} ref(s) → serve URL`)
    } catch (err) {
      say.err(`Media upload failed: ${err.message}`)
      process.exit(1)
    }
  }

  // 2c. Upload the (media-rewritten) ball. `data_bundle` is its content-addressed serve
  //     URL; omitted when there is nothing static to deliver.
  let dataBundle
  if (ball) {
    say.info('Uploading data bundle…')
    try {
      dataBundle = await uploadDataBundle(client, ball, { onProgress: (m) => say.dim(`  ${m}`) })
    } catch (err) {
      say.err(`Data bundle upload failed: ${err.message}`)
      process.exit(1)
    }
    say.dim(`Data bundle    : ${Object.keys(ball.data).length} data + ${Object.keys(ball.search).length} search file(s)`)
  }

  // 3. Push the site (content + folder) over the send-only-changed cache — the SAME
  //    two-lane submission `uniweb push` uses — stamping info.data_bundle on the
  //    site-content entity and rewriting local media refs to their backend serve URLs.
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
    process.exit(1)
  }
  for (const w of pkg.warnings) say.dim(`! ${w}`)
  const report = {
    info: (m) => say.info(m),
    note: (m) => say.dim(m),
    error: (m) => say.err(m),
    dim: (s) => `${c.dim}${s}${c.reset}`,
  }
  const pushResult = await pushSyncPackages({ client, siteDir, pkg, asOrg, report })
  if (pushResult.exitCode !== 0) process.exit(pushResult.exitCode)
  const siteUuid = pushResult.boundSiteUuid
  if (!siteUuid) {
    say.err('Push did not yield a site uuid — cannot publish.')
    process.exit(1)
  }

  // 4. Publish: make the just-pushed composite live (its current backend state).
  const siteContent = JSON.parse(await readFile(contentPath, 'utf8'))
  const languages = extractLanguages(siteContent)
  say.info(`Publishing to ${c.dim}${client.origin}${c.reset} …`)
  let pubRes
  try {
    pubRes = await client.publishSite(siteUuid, { runtimeVersion, ...(languages ? { languages } : {}) })
  } catch (err) {
    say.err(`Could not reach the backend at ${client.origin}: ${err.message}`)
    say.dim('Set the origin with --backend <url> or UNIWEB_REGISTER_URL.')
    process.exit(1)
  }
  if (!pubRes.ok) {
    say.err(`Publish rejected: HTTP ${pubRes.status} ${pubRes.statusText}`)
    if (pubRes.status === 401 || pubRes.status === 403) {
      say.dim("Credentials weren't accepted — run `uniweb login` (or pass --token <bearer>).")
    }
    const body = await pubRes.text().catch(() => '')
    if (body) say.dim(body.slice(0, 800))
    process.exit(1)
  }
  let result
  try { result = await pubRes.json() } catch { result = {} }
  const serveUrl = absolutizeServeUrl(client.origin, result.url)

  // Persist deploy memory. One identity: site.yml::$uuid (the push uuid) — no separate
  // deploy uuid. recordLastDeploy touches only lastDeploy.<target>.
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
      foundation: { ref: typeof foundation === 'string' ? foundation : foundation?.ref },
      runtime: runtimeVersion,
      locales: Array.isArray(result.locales) ? result.locales : languages,
    },
  })

  console.log('')
  say.ok(`Deployed ${c.bold}${siteUuid}${c.reset}`)
  if (serveUrl) console.log(`  ${c.cyan}${serveUrl}${c.reset}`)
}

// Pick the highest runtime from the backend's installed list. localeCompare with
// numeric ordering puts '0.8.16' above '0.8.9' and orders the synthetic dev tags
// deterministically. Null when the list is empty.
function pickHighestRuntime(installed) {
  if (!Array.isArray(installed) || installed.length === 0) return null
  return [...installed].sort((a, b) => String(b).localeCompare(String(a), undefined, { numeric: true }))[0]
}

// The deploy response `url` is the serve path. When origin-relative (the self-serve
// default, e.g. /gateway/site/<uuid>/) prefix the BackendClient origin so the printed
// link is clickable; absolute URLs pass through unchanged.
function absolutizeServeUrl(origin, url) {
  if (!url || typeof url !== 'string') return null
  if (/^https?:\/\//.test(url)) return url
  return `${origin.replace(/\/$/, '')}${url.startsWith('/') ? '' : '/'}${url}`
}

// ─── Static-host deploy (S3+CloudFront, etc.) ─────────────────
//
// Distinct from the uniweb-edge flow above. Picked when the resolved
// deploy.yml target (or --host override) names a static-host adapter
// registered in @uniweb/build/hosts. Always runs `uniweb build` (bundle
// mode + prerender) first, then hands dist/ to the adapter's deploy hook
// for upload + invalidation.

async function deployStaticHost(siteDir, hostName, resolved, { dryRun, autoSave, hostOverridden }) {
  let getAdapter
  try {
    ({ getAdapter } = await import('@uniweb/build/hosts'))
  } catch (err) {
    say.err('Failed to load host adapter registry from @uniweb/build/hosts.')
    say.dim(err.message)
    process.exit(1)
  }

  let adapter
  try {
    adapter = getAdapter(hostName)
  } catch (err) {
    say.err(err.message)
    say.dim('Set the host in deploy.yml or pass --host=<name>. See `uniweb deploy --help`.')
    process.exit(1)
  }

  if (typeof adapter.deploy !== 'function') {
    say.err(`Host adapter '${hostName}' does not implement a deploy step.`)
    say.dim(`Build with \`uniweb build --host=${hostName}\` and upload \`dist/\` manually,`)
    say.dim(`or use a host whose adapter ships a deploy hook (e.g., s3-cloudfront).`)
    process.exit(1)
  }

  const deployConfig = resolved.config || {}
  const distDir = join(siteDir, 'dist')

  if (dryRun) {
    say.info(`Dry run — would deploy via host adapter: ${c.bold}${adapter.name}${c.reset}`)
    say.dim(`Site dir       : ${siteDir}`)
    say.dim(`dist/          : ${existsSync(distDir) ? 'exists (would not rebuild)' : 'missing (would build)'}`)
    say.dim(`Target         : ${resolved.targetName}`)
    say.dim(`bucket         : ${deployConfig.bucket || '(unset)'}`)
    say.dim(`distributionId : ${deployConfig.distributionId || '(unset)'}`)
    say.dim(`region         : ${deployConfig.region || '(unset)'}`)
    say.dim(`profile        : ${deployConfig.profile || '(default AWS chain)'}`)
    return
  }

  // Always rebuild — the static-host flow expects fresh dist/ on every
  // deploy. UNIWEB_SKIP_BUILD env var lets CI / dev loops reuse an
  // existing build (mirrors the uniweb-edge flow's escape hatch).
  const skipBuild = parseBoolEnv('UNIWEB_SKIP_BUILD')
  if (skipBuild) {
    if (!existsSync(distDir)) {
      say.err('UNIWEB_SKIP_BUILD is set but dist/ does not exist.')
      process.exit(1)
    }
    say.info('UNIWEB_SKIP_BUILD set — reusing existing dist/.')
  } else {
    say.info(`Building site (host: ${adapter.name})…`)
    console.log('')
    try {
      execSync(
        `node ${JSON.stringify(process.argv[1])} build --bundle --host ${JSON.stringify(adapter.name)}`,
        { cwd: siteDir, stdio: 'inherit' }
      )
    } catch {
      say.err('Build failed. See output above.')
      process.exit(1)
    }
    if (!existsSync(distDir)) {
      say.err('Build did not produce dist/.')
      process.exit(1)
    }
    console.log('')
  }

  // Hand off to the adapter. DeployError is the structured shape from
  // @uniweb/build/hosts/s3-cloudfront — translate to user-facing output.
  try {
    await adapter.deploy({
      distDir,
      deployConfig,
      env: process.env,
      log: (m) => console.log(m),
    })
  } catch (err) {
    if (err && err.name === 'DeployError') {
      say.err(err.message)
      if (err.hint) {
        console.log('')
        console.log(err.hint)
      }
      process.exit(1)
    }
    throw err
  }

  // Record a fresh lastDeploy.<target> entry. Skipped on --no-save and
  // on ad-hoc --host overrides — see autoSave gating in deploy().
  await persistLastDeploy(siteDir, {
    targetName: resolved.targetName,
    targetConfig: resolved.fromFile ? null : { host: hostName, ...deployConfig },
    autoSave,
    lastDeploy: {
      at: new Date().toISOString(),
      host: hostName,
      // Static hosts know their public URL only via the user's CDN config;
      // we don't have it on hand. Future: pull from a known field.
    },
  })
  if (hostOverridden && !dryRun) {
    say.dim('--host override active — did not write to deploy.yml. Edit deploy.yml to make this permanent.')
  }
}

// ─── deploy.yml lastDeploy persistence ──────────────────────────

async function persistLastDeploy(siteDir, opts) {
  if (opts.autoSave === 'off') return
  try {
    const result = await recordLastDeploy(siteDir, opts)
    if (result?.created) {
      say.dim(`Wrote deploy.yml (target: ${opts.targetName})`)
    }
  } catch (err) {
    // The deploy itself succeeded — never fail the whole command on a
    // memo-write error. Surface it so the user can fix the file.
    say.dim(`Could not update deploy.yml: ${err.message}`)
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

// ─── Resolve site dir + runtime ────────────────────────────

// Exported so `uniweb export` (commands/export.js) can reuse the same
// site-discovery logic without duplicating it. `verb` is the command
// being run ("deploy" or "export"); it appears in the error messages
// so the user gets accurate guidance.
export async function resolveSiteDir(args, verb = 'deploy') {
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
        say.err(`Multiple sites found. Specify which one to ${verb}.`)
        console.log('')
        for (const s of sites) {
          console.log(`  ${c.cyan}cd ${s} && ${prefix} ${verb}${c.reset}`)
        }
        process.exit(1)
      }
      const choice = await promptSelect('Which site?', sites)
      if (!choice) {
        console.log(`\n${verb.charAt(0).toUpperCase() + verb.slice(1)} cancelled.`)
        process.exit(0)
      }
      return resolve(workspaceRoot, choice)
    }
  }

  say.err('No site found in this workspace.')
  if (verb === 'export') {
    say.dim('`export` produces a self-contained dist/ artifact for third-party hosting.')
  } else {
    say.dim('`deploy` publishes a built Uniweb site to the hosting platform.')
  }
  process.exit(1)
}

// ─── Content helpers ───────────────────────────────────────

function extractLanguages(siteContent) {
  const langs = siteContent?.config?.languages
  if (!Array.isArray(langs) || langs.length === 0) return ['en']
  // Three accepted shapes: plain `'en'`, Editor `{ value, label }`, site.yml `{ code, label }`.
  return langs.map((l) => (typeof l === 'string' ? l : l?.value || l?.code)).filter(Boolean)
}
