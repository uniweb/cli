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
 *     no edge. See kb/framework/plans/static-host-deploy-adapters.md.
 *
 * For static-host artifacts WITHOUT upload, see `uniweb export`.
 *
 * Default-flow steps:
 *   1. Read site.yml → { site.id?, site.handle?, foundation, runtime? }.
 *   2. Resolve runtime (default: GET /runtime/latest from the Worker).
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
 *   9. POST Worker /publish/check to confirm foundation + runtime
 *      exist and the token's namespace claim matches.
 *  10. POST Worker /publish with the full payload.
 *  11. On first-deploy create flow: write site.id + site.handle back into
 *      site.yml so subsequent deploys fast-path.
 *
 * Usage:
 *   uniweb deploy                          Normal deploy (browser may open on first deploy)
 *   uniweb deploy --dry-run                Resolve everything but skip the Worker POST
 *   uniweb deploy --no-auto-publish        Don't auto-publish workspace-local foundation
 *   uniweb deploy --target <name>          Pick a target from deploy.yml (default: deploy.yml's `default:`)
 *   uniweb deploy --host <name>            Override the resolved target's host adapter
 *                                          (does not write to deploy.yml on success)
 *   uniweb deploy --no-save                Skip the auto-save of lastDeploy in deploy.yml
 *
 * Internal escape hatches (UNIWEB_* env vars — see framework/cli/docs/env-vars.md):
 *   UNIWEB_SKIP_BUILD=1                    Reuse existing dist/ instead of rebuilding
 *   UNIWEB_SKIP_ASSETS=1                   Skip the asset upload step
 *   UNIWEB_SKIP_BILLING=1                  Admin-only: bypass billing gate
 *   UNIWEB_FORCE_REVIEW=1                  Force the browser review flow
 *   UNIWEB_ALLOW_DIRTY_FOUNDATION=1        Don't treat a dirty workspace as stale
 *
 * See kb/platform/plans/cli-site-deploy-decisions.md for the full design.
 */

import { createServer } from 'node:http'
import { existsSync } from 'node:fs'
import { readFile, writeFile, readdir, stat } from 'node:fs/promises'
import { resolve, join, basename, relative, sep } from 'node:path'
import { execSync } from 'node:child_process'
import yaml from 'js-yaml'

import { detectFoundationType } from '@uniweb/build'
import { loadDeployYml, resolveTarget, recordLastDeploy } from '@uniweb/build/site'

import { ensureAuth, readAuth, decodeJwtPayload } from '../utils/auth.js'
import { getBackendUrl, getRegistryUrl } from '../utils/config.js'
import { parseBoolEnv } from '../utils/env.js'
import { RemoteRegistry } from '../utils/registry.js'

/**
 * Split `@ns/name@ver`, `~user/name@ver`, or `name@ver` into name + version.
 * Returns null on any shape we don't recognize. Inlined here after the
 * receipt-cache utility module was removed in Phase 4b — the only
 * remaining caller is the staleness check below.
 */
function splitRegistryRef(ref) {
  if (typeof ref !== 'string') return null
  const m = /^(@[^/]+\/[^@]+|~[^/]+\/[^@]+|[^@]+)@(.+)$/.exec(ref)
  return m ? { name: m[1], version: m[2] } : null
}

/**
 * Read `--flag value` from argv. Accepts both `--flag value` and
 * `--flag=value`. Returns null when absent.
 */
function readFlagValue(args, name) {
  const eqPrefix = name + '='
  for (let i = 0; i < args.length; i++) {
    if (args[i] === name) return args[i + 1] ?? null
    if (args[i].startsWith(eqPrefix)) return args[i].slice(eqPrefix.length)
  }
  return null
}
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

/**
 * Read the git state for `dir`, scoped to that directory's history and
 * working tree — NOT the whole repo's HEAD.
 *
 * `gitSha`  : last commit that touched `dir` (`git log -1 -- .`).
 * `gitDirty`: uncommitted changes inside `dir` only (`git status -- .`).
 *
 * Why scope it. In a multi-package monorepo, `git rev-parse HEAD` is
 * the same value for every directory — the repo's current HEAD. That
 * meant editing a SITE then deploying triggered the foundation's
 * staleness check (its receipt's recorded sha didn't match the new
 * repo HEAD), even though the foundation source was unchanged. The
 * receipt's `publishedFromGitSha` field is per-foundation by design;
 * the comparison side has to be too.
 *
 * If the path is outside a git repo, or has no commits touching it
 * yet, the function returns `{ gitSha: null, gitDirty: false }` —
 * same fallback shape as before.
 */
function readGitState(dir) {
  try {
    // `git log -1 --format=%H -- .` returns the SHA of the last
    // commit that touched the cwd path. If no such commit exists
    // yet (path was never committed), output is empty — caller
    // treats null as "no published-from-sha to compare against."
    const sha = execSync('git log -1 --format=%H -- .', {
      cwd: dir,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString().trim()
    const status = execSync('git status --porcelain -- .', {
      cwd: dir,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString()
    return { gitSha: sha || null, gitDirty: status.length > 0 }
  } catch {
    return { gitSha: null, gitDirty: false }
  }
}

function composeFoundationUrl(ref, registryBase) {
  if (typeof ref !== 'string') return null
  if (ref.startsWith('https://') || ref.startsWith('http://')) return ref
  const m = ref.match(/^(@[^/]+\/[^@]+|[^@]+)@(.+)$/)
  if (!m || !registryBase) return null
  const [, name, version] = m
  return `${registryBase.replace(/\/$/, '')}/${name}/${version}/`
}

/**
 * Decide whether a workspace-local foundation is stale relative to the
 * registry's record, by comparing per-directory git provenance against
 * the registry entry's `publishedFromGitSha`. No local cache file —
 * `dist/publish.json` was deleted in Phase 4b of the CLI ergonomics
 * overhaul because every fresh clone / CI run / collaborator paid the
 * registry round-trip anyway, and the local cache only added confusing
 * "stale receipt" warnings when collaborators had different `dist/`
 * state.
 *
 * Returns `{ stale, reason }`. The caller decides whether to auto-publish
 * (Phase 2 default) or fail (`--no-auto-publish`).
 */
async function inspectFoundationStaleness(localPath, { dirtyAsStale, registry, ref }) {
  const { gitSha, gitDirty } = readGitState(localPath)
  if (!gitSha) {
    return { stale: true, reason: 'foundation directory is not in a git repo or has no commits' }
  }

  const split = splitRegistryRef(ref)
  if (!split) {
    return { stale: true, reason: 'cannot derive registry ref from package.json' }
  }

  let existingEntry
  try {
    existingEntry = await registry.getVersionEntry(split.name, split.version)
  } catch {
    return { stale: true, reason: 'registry lookup failed' }
  }
  if (!existingEntry) {
    return { stale: true, reason: `${split.name}@${split.version} not yet published` }
  }

  if (existingEntry.publishedFromGitSha && existingEntry.publishedFromGitSha !== gitSha) {
    // Recorded sha differs from the foundation's per-directory
    // last-touched commit. Normally that's "real" staleness — somebody
    // committed changes to src/ that haven't been republished.
    //
    // Exception: when the publish was made FROM A DIRTY tree, the
    // recorded sha is a checkpoint, not an identity. The published
    // artifact reflects the committed state at that sha PLUS the
    // uncommitted changes that were on disk when publish ran. After
    // those changes get committed (a normal post-deploy housekeeping
    // step — e.g., committing the auto-derived `uniweb.id`), the
    // per-foundation sha moves forward, but the artifact upstream
    // hasn't materially changed. Don't fire staleness on the sha
    // alone in that case; let the dirty-tree check below do its job
    // if the tree IS still dirty, and otherwise treat as fresh.
    if (!existingEntry.publishedFromGitDirty) {
      return {
        stale: true,
        reason: `foundation has new commits since last publish (${existingEntry.publishedFromGitSha.slice(0, 7)} → ${gitSha.slice(0, 7)})`,
      }
    }
  }
  if (gitDirty && dirtyAsStale) {
    return { stale: true, reason: 'foundation working tree is dirty' }
  }
  return { stale: false }
}

/**
 * Last-resort canonical-name derivation for empty-scope foundations.
 * Combines `package.json::uniweb.id` (the foundation's bare name) with
 * the user's `memberUuid` claim from auth.json to produce
 * `~<memberUuid>/<id>@<version>`. Only fires when both inputs are
 * available — otherwise returns null and the caller falls through to
 * the republish path.
 */
async function refFromAuthAndPkg(localPath) {
  let pkg
  try {
    pkg = JSON.parse(await readFile(join(localPath, 'package.json'), 'utf8'))
  } catch {
    return null
  }
  const id = pkg?.uniweb?.id
  const version = pkg?.version
  if (!id || !version || !/^[a-z0-9_-]+$/.test(id)) return null
  try {
    const auth = await readAuth()
    const claims = decodeJwtPayload(auth?.token)
    if (claims?.memberUuid) return `~${claims.memberUuid}/${id}@${version}`
  } catch { /* no auth — fall through to null */ }
  return null
}

/**
 * Read a workspace-local foundation's identity (scoped name + version) from
 * its `dist/meta/schema.json` + `package.json`, mirroring `publish.js`'s
 * namespace resolution. Returns the registry ref (`@ns/name@ver` or
 * `~uuid/name@ver`), or null if no shape can be resolved.
 *
 * Resolution order:
 *   1. Org scope from `pkg.uniweb.namespace` or `pkg.name`'s `@org/...` prefix.
 *   2. Empty-scope synthesis from `pkg.uniweb.id` + the user's auth claim
 *      (`~<memberUuid>/<id>@<version>`). Same canonical shape the server
 *      stores under for empty-scope publishes. Phase 4d will replace this
 *      with `~{siteId}/...` derived from authorize.
 *   3. null — caller falls through to the helpful "set uniweb.namespace"
 *      error message.
 */
async function deriveLocalFoundationRef(localPath) {
  let pkg
  try {
    pkg = JSON.parse(await readFile(join(localPath, 'package.json'), 'utf8'))
  } catch {
    return null
  }

  let rawName, version
  try {
    const schema = JSON.parse(await readFile(join(localPath, 'dist', 'meta', 'schema.json'), 'utf8'))
    rawName = schema._self?.name
    version = schema._self?.version
  } catch {
    // Fallback to package.json when the build hasn't run yet.
  }
  rawName = rawName || pkg.name
  version = version || pkg.version
  if (!rawName || !version) return null

  // Org-scope path — derived purely from local files.
  const uniwebNamespace = pkg.uniweb?.namespace
  const pkgScopeMatch = (pkg.name || '').match(/^@([a-z0-9_-]+)\//)
  const selfScopeMatch = rawName.match(/^@([a-z0-9_-]+)\//)
  const namespace = uniwebNamespace || pkgScopeMatch?.[1] || selfScopeMatch?.[1]
  if (namespace) {
    const bareName = selfScopeMatch ? rawName.slice(selfScopeMatch[0].length) : rawName
    return `@${namespace}/${bareName}@${version}`
  }

  // Empty-scope fallback: synthesize `~<memberUuid>/<id>@<version>` from
  // the user's auth + package.json::uniweb.id. Same canonical shape the
  // server stores under for empty-scope publishes. After Phase 4d this
  // path is replaced by `~{siteId}/...` derived from authorize.
  const fromAuth = await refFromAuthAndPkg(localPath)
  if (fromAuth) return fromAuth

  return null
}

// ─── Main ───────────────────────────────────────────────────

export async function deploy(args = []) {
  const dryRun = args.includes('--dry-run')
  // When `foundation:` in site.yml points at a workspace-local file: ref,
  // deploy auto-publishes the foundation when the registry has no record
  // of the current source's git sha. This flag opts out.
  const autoPublishFoundation = !args.includes('--no-auto-publish')

  // Internal escape hatches — see framework/cli/docs/env-vars.md. These
  // are not user-facing flags; they exist for the platform test team,
  // CI scripts, and dev-loop unblockers. The bare `deploy` command should
  // do the right thing for normal users without any of them set.
  const skipBuild = parseBoolEnv('UNIWEB_SKIP_BUILD')
  const skipAssets = parseBoolEnv('UNIWEB_SKIP_ASSETS')
  const skipBilling = parseBoolEnv('UNIWEB_SKIP_BILLING')
  const forceReview = parseBoolEnv('UNIWEB_FORCE_REVIEW')
  // Inverse of the (now-removed) --no-dirty-as-stale flag. When true, a
  // dirty workspace will NOT be treated as stale (won't trigger auto-publish
  // of the foundation). Default: dirty IS stale.
  const treatDirtyAsStale = !parseBoolEnv('UNIWEB_ALLOW_DIRTY_FOUNDATION')

  const siteDir = await resolveSiteDir(args)
  const backendUrl = getBackendUrl()
  const workerUrl = getRegistryUrl()

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
  // check. See kb/framework/plans/static-host-deploy-adapters.md.
  const targetFromFlag = readFlagValue(args, '--target')
  const hostFromFlag = readFlagValue(args, '--host')
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
    resolved = resolveTarget(deployYml, targetFromFlag)
  } catch (err) {
    say.err(err.message)
    process.exit(1)
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

  // --dry-run gate. Must come BEFORE auto-publish (which writes to the
  // registry) and BEFORE the site build (which writes to dist/). Earlier
  // versions of this command had the dry-run check after both, which
  // violated the contract that --dry-run performs zero writes. Languages
  // and the default locale are unavailable here (they live in
  // dist/site-content.json, which a dry-run won't build); the trade-off
  // is intentional. Run `uniweb build` directly if you need that detail.
  if (dryRun) {
    say.info('Dry run — would deploy:')
    say.dim(`Site dir       : ${siteDir}`)
    say.dim(`site.id        : ${siteYml.site?.id || '(none — would use create flow)'}`)
    say.dim(`Foundation     : ${typeof foundation === 'string' ? foundation : foundation.ref}`)
    say.dim(`Runtime        : ${siteYml.runtime || '(latest, resolved at authorize)'}`)
    say.dim(`Backend (PHP)  : ${backendUrl}`)
    say.dim(`Worker         : ${workerUrl}`)
    return
  }

  // `uniweb deploy` always runtime-links: the edge serves a runtime
  // template + per-site base.html, with the foundation loaded by URL.
  // The historical --link / --bundle flags are gone (Phase 2 of the CLI
  // ergonomics overhaul). For static-host artifacts, see `uniweb export`.

  // Phase 2: resolve workspace-local `file:` foundation refs.
  //
  // The object form of `foundation:` already requires a registry ref
  // (`@ns/name@ver`) per parseSiteFoundation, so only the string form can
  // resolve to a local path. Pass-through cases (registry ref, full URL,
  // npm package) all leave `foundation` untouched. The resolved registry
  // ref is also passed to the site build via UNIWEB_FOUNDATION_REF so the
  // build runs in runtime mode against the just-published artifact instead
  // of bundling the local foundation source. site.yml on disk is never
  // modified.
  // Phase 4d: detect a workspace-local foundation. The actual upload happens
  // AFTER authorize (which mints siteId), so the canonical site-bound ref
  // `~{siteId}/{name}@{ver}` is known by the time we publish. For now we
  // just record what we'll need at upload time and pass a `~self/...`
  // placeholder to authorize — the server rewrites it.
  let localFoundation = null
  if (typeof foundation === 'string') {
    const detected = detectFoundationType(foundation, siteDir)
    if (detected.type === 'local') {
      const localPath = detected.path
      const relPath = relative(siteDir, localPath) || localPath

      let pkg
      try {
        pkg = JSON.parse(await readFile(join(localPath, 'package.json'), 'utf8'))
      } catch {
        say.err(`Could not read ${relPath}/package.json.`)
        process.exit(1)
      }
      const foundationName = pkg.uniweb?.id || pkg.name?.replace(/^[@~][^/]+\//, '') || pkg.name
      const foundationVersion = pkg.version
      if (!foundationName || !foundationVersion) {
        say.err(`Foundation at ${relPath} needs both a name and a version in package.json.`)
        process.exit(1)
      }

      localFoundation = {
        path: localPath,
        relPath,
        name: foundationName,
        version: foundationVersion,
      }

      // Send `~self/{name}@{ver}` as a placeholder. The server will rewrite
      // to `~{siteId}/{name}@{ver}` once siteId is minted. The CLI uses the
      // returned canonical ref for both the upload and the publish payload.
      foundation = `~self/${foundationName}@${foundationVersion}`
    }
  }
  // Honor --no-auto-publish for local foundations: surface the gate before
  // we do any work.
  if (localFoundation && !autoPublishFoundation) {
    say.err(`Local foundation at ${localFoundation.relPath} would be auto-published as part of deploy.`)
    say.dim('Drop --no-auto-publish to let deploy publish it, or change site.yml to reference a registry-published foundation.')
    process.exit(1)
  }

  // Runtime defaults to "latest" resolved at authorize time.
  let runtimeVersion = siteYml.runtime
  if (!runtimeVersion) {
    runtimeVersion = await fetchLatestRuntime(workerUrl)
    if (!runtimeVersion) {
      say.err('Could not resolve a runtime version (no runtime: in site.yml, /runtime/latest failed).')
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
    // serving edge, not here). Always --link: the edge serves a runtime
    // template + per-site base.html, never a self-contained vite bundle.
    //
    // Phase 4d: workspace-local foundations carry the `~self/{name}@{ver}`
    // placeholder at this point; the canonical `~{siteId}/...` ref isn't
    // known until authorize returns. Link mode doesn't run vite or fetch
    // the foundation, so site-content.json's foundation field reflects
    // whatever's in site.yml — that's fine because the publish payload
    // overrides it with the canonical form post-authorize.
    //
    // Spawn the SAME CLI binary that's currently running rather than
    // `npx uniweb build` — npx walks node_modules and would resolve to
    // whatever version is installed there (which might be older than
    // the deploy CLI and silently ignore --link). `process.argv[1]`
    // pins the inner build to the outer's exact version.
    execSync(`node ${JSON.stringify(process.argv[1])} build --link`, {
      cwd: siteDir,
      stdio: 'inherit',
      env: process.env,
    })
    console.log('')
  } else if (!existsSync(contentPath)) {
    say.err('No build found and UNIWEB_SKIP_BUILD set. Run `uniweb build` first.')
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

  // Spin up the loopback listener eagerly — we need its callback URL for the
  // authorize request even on the fast path (PHP may always return
  // needsReview=true on first deploy / billing drift in future phases).
  const loopback = await startLoopback()

  let publishToken, siteIdResolved, handleResolved, publishUrl, validateUrl, mintedFeatures
  let foundationUploadUrl  // Phase 4d: returned by authorize for site-bound foundation uploads
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
      // User-forced review (UNIWEB_FORCE_REVIEW=1). PHP refuses to
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
      } else if (err.status === 403 && authorizeBody.siteId) {
        // Collaborator ACL — the user has the repo (and thus site.id in
        // site.yml) but isn't owner or editor on this site. The server's
        // 403 message names the owner; surface it verbatim.
        say.err(err.message)
        process.exit(1)
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
      // Phase 4d: workspace-local foundation deploys on the create flow
      // need the rewritten `~{siteId}/{name}@{ver}` ref + upload endpoint.
      // PHP/unicloud put them in the finalize response; the web app
      // forwards them to the loopback. Catalog-ref deploys leave them
      // undefined and we fall back to the placeholder/derived URL below.
      if (cb.foundationRef) foundation = cb.foundationRef
      if (cb.foundationUploadUrl) foundationUploadUrl = cb.foundationUploadUrl
      // Review path: Worker URLs are implicit (we derive them from config).
      publishUrl = `${workerUrl}/publish`
      validateUrl = `${workerUrl}/publish/check`
    } else {
      publishToken = authRes.publishToken
      siteIdResolved = authRes.siteId
      handleResolved = authRes.handle
      publishUrl = authRes.publishUrl
      validateUrl = authRes.validateUrl
      foundationUploadUrl = authRes.foundationUploadUrl
      mintedFeatures = Array.isArray(authRes.features) ? authRes.features : null
      // Phase 4d: server returns the canonical foundation ref. For
      // `~self/...` placeholders this is the rewritten `~{siteId}/...`
      // form; catalog refs pass through. The CLI uses this for both the
      // foundation upload (next step) and the publish payload below.
      if (authRes.foundationRef) foundation = authRes.foundationRef
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

  // Phase 4d: upload site-bound foundation files directly. Replaces the
  // pre-Phase-4d `execSync('uniweb publish')` flow — we now know the
  // canonical `~{siteId}/{name}@{ver}` ref from authorize, and the worker's
  // /foundations endpoint accepts the publish token's siteId claim
  // for this scope.
  if (localFoundation) {
    say.info(`Building foundation at ${localFoundation.relPath}…`)
    console.log('')
    try {
      execSync(`node ${JSON.stringify(process.argv[1])} build`, {
        cwd: localFoundation.path,
        stdio: 'inherit',
      })
    } catch {
      say.err(`Foundation build at ${localFoundation.relPath} failed. See output above.`)
      process.exit(1)
    }
    console.log('')

    say.info(`Uploading foundation as ${foundation}…`)
    const foundationFiles = await collectFoundationDistFiles(join(localFoundation.path, 'dist'))
    const foundationPublishUrl = foundationUploadUrl || `${workerUrl}/foundations`
    const { gitSha: fGitSha, gitDirty: fGitDirty } = readGitState(localFoundation.path)
    await callFoundationUpload({
      url: foundationPublishUrl,
      token: publishToken,
      body: {
        name: foundation.replace(/@[^@]+$/, ''),  // strip `@version` to get `~{siteId}/{name}`
        version: localFoundation.version,
        files: foundationFiles,
        metadata: {
          ...(fGitSha ? { publishedFromGitSha: fGitSha } : {}),
          ...(typeof fGitDirty === 'boolean' ? { publishedFromGitDirty: fGitDirty } : {}),
        },
      },
    })
    say.ok(`Foundation uploaded.`)
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

  // Collect compiled collection JSON files from dist/data/. The framework
  // emits these for `collection:` data sources — `<name>.json` cascade
  // payloads plus per-record `<name>/<slug>.json` files when `deferred:` is
  // declared. Editor publish has no equivalent (collections live in the DB);
  // CLI sites need them shipped as static R2 objects.
  //
  // Read BEFORE the asset pipeline so the asset scan can pick up image
  // refs in collection JSON (e.g. `article.image: "/covers/foo.svg"`)
  // and the rewrite can swap them for CDN URLs alongside locale content.
  const dataFiles = await collectDataFiles(distDir)
  // Decode each data file as JSON so the asset scan can walk the tree;
  // mutated in place by the rewrite step. Re-stringified before publish.
  const dataFileObjects = {}
  for (const [k, raw] of Object.entries(dataFiles)) {
    try {
      dataFileObjects[k] = JSON.parse(raw)
    } catch {
      dataFileObjects[k] = null // unparseable — skip rewrite, ship as-is
    }
  }
  if (Object.keys(dataFiles).length > 0) {
    say.dim(`Data files     : ${Object.keys(dataFiles).length} (collection JSON)`)
  }

  // Asset pipeline — upload dist/assets/* + favicon + fonts + content-scan
  // hits (public/, data file refs) to S3, then rewrite each locale's
  // siteContent + each parsed data file so the runtime resolves CDN URLs at
  // render time. Assets are locale-shared (they live in dist/assets/ +
  // public/ regardless of language); diff/upload runs once and the rewrite
  // walks every locale's content tree + every data-file JSON tree.
  // Skipped with --skip-assets.
  if (!skipAssets) {
    await uploadAssetsAndRewriteContent({
      siteDir,
      localeContents,
      dataFileObjects,
      siteYml,
      theme,
      backendUrl,
      cliToken,
      siteId: siteIdResolved,
    })
    // Re-stringify any data-file JSON that the rewrite step mutated, so the
    // publish payload below sees the rewritten URLs. Untouched files round-
    // trip identically.
    for (const k of Object.keys(dataFiles)) {
      if (dataFileObjects[k] !== null) {
        dataFiles[k] = JSON.stringify(dataFileObjects[k])
      }
    }
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

  // Local event memory — used by future re-deploys (e.g., to skip
  // redundant work when nothing has changed). Lives under dist/ which is
  // gitignored; the platform never reads it.
  const foundationRef = typeof foundation === 'string' ? foundation : foundation?.ref
  const { gitSha, gitDirty } = readGitState(siteDir)
  const deployReceipt = {
    schemaVersion: 1,
    deployedFromGitSha: gitSha,
    deployedFromGitDirty: gitDirty,
    deployedAt: new Date().toISOString(),
    url: handleResolved ? `https://${handleResolved}.uniweb.website/` : null,
    foundation: {
      ref: foundationRef,
      url: composeFoundationUrl(foundationRef, getRegistryUrl()),
    },
    locales: languages,
  }
  await writeFile(join(distDir, 'deploy.json'), JSON.stringify(deployReceipt, null, 2) + '\n')

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

  // Record a fresh lastDeploy.<target> entry. Skipped on --no-save (and
  // on --host overrides, but uniweb-host can't be reached via override
  // since the override branches into deployStaticHost above).
  await persistLastDeploy(siteDir, {
    targetName: resolved.targetName,
    targetConfig: resolved.fromFile ? null : { host: 'uniweb' },
    autoSave,
    lastDeploy: {
      at: deployReceipt.deployedAt,
      host: 'uniweb',
      url: deployReceipt.url,
      siteId: siteIdResolved,
      handle: handleResolved,
      foundation: {
        shape: 'linked',
        ref: foundationRef,
      },
      runtime: runtimeVersion,
    },
  })
}

// ─── Static-host deploy (S3+CloudFront, etc.) ─────────────────
//
// Distinct from the uniweb-edge flow above. Picked when the resolved
// deploy.yml target (or --host override) names a static-host adapter
// registered in @uniweb/build/hosts. Always runs `uniweb build` (bundle
// mode + prerender) first, then hands dist/ to the adapter's deploy hook
// for upload + invalidation.
//
// See kb/framework/plans/static-host-deploy-adapters.md.

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
    say.dim(`deploy.bucket  : ${deployConfig.bucket || '(unset)'}`)
    say.dim(`deploy.distId  : ${deployConfig.distributionId || '(unset)'}`)
    say.dim(`deploy.region  : ${deployConfig.region || '(unset)'}`)
    say.dim(`deploy.profile : ${deployConfig.profile || '(default AWS chain)'}`)
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

async function fetchLatestRuntime(workerUrl) {
  try {
    const res = await fetch(`${workerUrl}/runtime/latest`)
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

// ─── Site-bound foundation upload (Phase 4d) ────────────────

/**
 * Walk a built foundation's `dist/` directory and return `{ relPath: base64Bytes }`
 * — the shape `POST /foundations` expects in its `files` field.
 */
async function collectFoundationDistFiles(distDir) {
  if (!existsSync(distDir)) {
    say.err(`Foundation dist/ not found at ${distDir}.`)
    process.exit(1)
  }
  const files = {}
  const entries = await readdir(distDir, { withFileTypes: true, recursive: true })
  for (const entry of entries) {
    if (!entry.isFile()) continue
    const fullPath = join(entry.parentPath, entry.name)
    const relPath = relative(distDir, fullPath).split(sep).join('/')
    const bytes = await readFile(fullPath)
    files[relPath] = bytes.toString('base64')
  }
  return files
}

async function callFoundationUpload({ url, token, body }) {
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
    say.err(`Foundation upload failed: ${err}`)
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
async function uploadAssetsAndRewriteContent({ siteDir, localeContents, dataFileObjects = {}, siteYml, theme, backendUrl, cliToken, siteId }) {
  const distAssetsDir = join(siteDir, 'dist', 'assets')
  const hasDistAssets = existsSync(distAssetsDir)

  // 1. Enumerate local files + read size.
  const localFiles = hasDistAssets ? await walkAssetDir(distAssetsDir) : []

  // 1a. Content-scan: walk site-content.json (and locale variants) for any
  //     asset references (image/document src/href) and resolve absolute
  //     paths to local files under `dist/` or `public/`. This catches static
  //     assets the author placed in `public/covers/`, `public/images/`, etc.
  //     that the dist/assets walk above misses (vite's image-pipeline only
  //     produces files for refs that go through it). Each resolved file
  //     joins the upload pipeline; the rewrite step at the end maps every
  //     such reference to its CDN identifier so content stays portable
  //     across site delete / template extraction.
  const contentRefMap = await scanContentForAssetRefs(localeContents, dataFileObjects, siteDir)
  const seenPaths = new Set(localFiles.map((f) => f.fullPath))
  for (const [, info] of contentRefMap) {
    if (seenPaths.has(info.resolvedPath)) continue
    const ext = (info.filename.split('.').pop() || '').toLowerCase()
    const st = await stat(info.resolvedPath)
    localFiles.push({
      filename: info.filename,
      fullPath: info.resolvedPath,
      size: st.size,
      mime: MIME_BY_EXT[ext] || 'application/octet-stream',
    })
    seenPaths.add(info.resolvedPath)
  }

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
  //    src/href references an uploaded asset get an info.identifier pointing
  //    to the CDN. Walking every locale means translated content (which
  //    still references the same image files via the source ProseMirror
  //    tree) gets the same rewrite.
  //
  //    Two lookup paths:
  //      - byOriginalRef: full src/href string → identifier (covers static
  //        public/ assets like `/covers/foo.svg` and dist/-resolved refs)
  //      - byFilename: legacy match for `assets/{filename}` shape — kept
  //        for back-compat with content authored against the old vite-
  //        produced `/assets/...` URLs.
  const byFilenameAll = new Map([...reused, ...fresh])
  const byOriginalRef = new Map()
  for (const [ref, info] of contentRefMap) {
    const id = byFilenameAll.get(info.filename)
    if (id) byOriginalRef.set(ref, id)
  }
  let rewritten = 0
  for (const lang of Object.keys(localeContents)) {
    rewritten += rewriteAssetReferences(localeContents[lang], byFilenameAll, byOriginalRef)
  }
  // Data files: walk the JSON tree. Two patterns coexist in collection
  // payloads:
  //   - Flat fields (e.g. `article.image: "/covers/foo.svg"`) → replace
  //     the string with a resolveAssetCdnUrl(identifier). The runtime
  //     reads these as plain URLs, so rewriting at deploy time is the
  //     simplest path to portability.
  //   - Nested ProseMirror sub-trees (e.g. `article.content`) → use the
  //     existing image/document node rewrite (sets `attrs.info.identifier`).
  for (const k of Object.keys(dataFileObjects)) {
    if (dataFileObjects[k] === null) continue
    rewritten += rewriteFlatAssetUrls(dataFileObjects[k], byOriginalRef)
    rewritten += rewriteAssetReferences(dataFileObjects[k], byFilenameAll, byOriginalRef)
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
 * `attrs.src` or `attrs.href` references an uploaded/reused asset. Sets
 * `attrs.info.identifier` so semantic-parser resolves the real CDN URL
 * (and optimized variants) at render time.
 *
 * Two lookup paths, in order:
 *   1. `byOriginalRef` — full src/href string → identifier. Covers static
 *      public/ assets (`/covers/foo.svg`, `/images/foo.png`) and any
 *      content-scan-resolved file. Decouples assets from site lifecycle
 *      (templates can extract content + identifier; assets stay on CDN).
 *   2. `byFilename` (legacy) — only fires when the path matches the old
 *      `/assets/{filename}` shape. Kept so re-deploys of content authored
 *      against pre-content-scan CLIs still work.
 *
 * Returns the number of rewrites performed — useful for reporting, and to
 * detect "nothing matched" (likely a content-shape mismatch worth flagging).
 */
function rewriteAssetReferences(node, byFilename, byOriginalRef = new Map()) {
  let count = 0
  const walk = (n) => {
    if (!n || typeof n !== 'object') return
    if (Array.isArray(n)) { for (const child of n) walk(child); return }
    if (n.attrs && typeof n.attrs === 'object') {
      // Prefer full-ref lookup (covers static + dist refs uniformly);
      // fall back to legacy `assets/{filename}` extraction.
      let identifier = null
      let srcMatched = false
      let hrefMatched = false
      if (typeof n.attrs.src === 'string' && byOriginalRef.has(n.attrs.src)) {
        identifier = byOriginalRef.get(n.attrs.src)
        srcMatched = true
      } else if (typeof n.attrs.href === 'string' && byOriginalRef.has(n.attrs.href)) {
        identifier = byOriginalRef.get(n.attrs.href)
        hrefMatched = true
      } else {
        const srcRef = pickAssetRef(n.attrs.src)
        const hrefRef = pickAssetRef(n.attrs.href)
        const ref = srcRef || hrefRef
        if (ref) {
          identifier = byFilename.get(ref) || null
          srcMatched = !!srcRef
          hrefMatched = !srcRef && !!hrefRef
        }
      }
      if (identifier) {
        n.attrs.info = {
          ...(n.attrs.info || {}),
          identifier,
          contentType: 'website',
          viewType: 'profile',
        }
        // Clear the local path so the runtime resolves via info.identifier
        // (→ assets.uniweb.app CDN) instead of requesting a non-existent
        // file from the site host.
        if (srcMatched) n.attrs.src = null
        if (hrefMatched) n.attrs.href = null
        // Match the Editor shape: plain `image` nodes skip identifier
        // resolution in older runtimes; `ImageBlock` routes through
        // parseImgBlock which reads info.identifier and fills url.
        if (n.type === 'image' && n.attrs.role !== 'icon') {
          n.type = 'ImageBlock'
        }
        count++
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

/**
 * Walk every locale's content for `attrs.src` and `attrs.href` strings, and
 * resolve absolute-path refs (e.g. `/covers/foo.svg`) to local files under
 * the site root.
 *
 * Resolution order per ref:
 *   1. `dist/{path}`    — vite outputs, link-mode collection JSON, etc.
 *   2. `public/{path}`  — static author-placed assets (covers, images).
 *
 * Returns Map<originalRef, { resolvedPath, filename }> where:
 *   - `originalRef`  — the exact src/href string from content (used as the
 *                      lookup key during rewrite).
 *   - `resolvedPath` — absolute path on disk (used for upload).
 *   - `filename`     — basename, used as the assets-server upload filename.
 *                      Server keys by (siteId, filename); collisions across
 *                      paths with the same basename are flagged as warnings.
 *
 * Skips:
 *   - Non-string values, refs that don't start with `/`, protocol-relative
 *     refs (`//cdn.example.com/...`), and external URLs.
 *   - Refs starting with `/api/` or `/_` (worker-internal paths, never
 *     local files).
 *   - Nodes already rewritten with `attrs.info.identifier` set (re-deploy).
 */
async function scanContentForAssetRefs(localeContents, dataFileObjects, siteDir) {
  const candidates = new Set()
  for (const lang of Object.keys(localeContents)) {
    walkContentForAssetRefs(localeContents[lang], candidates)
  }
  // Also walk parsed collection JSON files. These contain BOTH ProseMirror-
  // shaped sub-trees (article.content) AND flat string fields (article.image,
  // article.cover, etc.). The walker captures both: any string-valued src/
  // href/image/cover/thumbnail/icon/poster field, plus any string anywhere
  // that looks like an absolute path with a known media extension.
  for (const k of Object.keys(dataFileObjects || {})) {
    if (dataFileObjects[k] !== null) {
      walkContentForAssetRefs(dataFileObjects[k], candidates)
    }
  }

  const results = new Map()
  const filenameToRef = new Map() // detect collisions (same basename, different path)
  for (const ref of candidates) {
    if (!isResolvableContentRef(ref)) continue
    const cleanPath = ref.split('?')[0].split('#')[0].slice(1) // drop leading '/'
    const distCandidate = join(siteDir, 'dist', cleanPath)
    const publicCandidate = join(siteDir, 'public', cleanPath)
    let resolvedPath = null
    if (existsSync(distCandidate)) {
      try { if ((await stat(distCandidate)).isFile()) resolvedPath = distCandidate } catch {}
    }
    if (!resolvedPath && existsSync(publicCandidate)) {
      try { if ((await stat(publicCandidate)).isFile()) resolvedPath = publicCandidate } catch {}
    }
    if (!resolvedPath) continue
    const filename = resolvedPath.split(sep).pop()
    const prior = filenameToRef.get(filename)
    if (prior && prior !== resolvedPath) {
      // Two different files want the same upload filename — server keys by
      // filename so the second would clobber the first. Skip + warn rather
      // than silently overwrite. Caller can rename the file or move one
      // into a vite-processed path to disambiguate via content hashing.
      say.warn(
        `Asset filename collision: "${filename}" exists at multiple paths ` +
          `(${prior}, ${resolvedPath}). Skipping the second; rename to disambiguate.`
      )
      continue
    }
    filenameToRef.set(filename, resolvedPath)
    results.set(ref, { resolvedPath, filename })
  }
  return results
}

// Field names commonly used for media in collection JSON. The walker
// collects any absolute-path string under these keys as a potential asset
// reference. ProseMirror image/link nodes are caught separately via attrs.
const FLAT_ASSET_FIELDS = new Set([
  'src', 'href', 'image', 'cover', 'thumbnail', 'icon', 'poster', 'logo',
  'avatar', 'photo', 'banner', 'background',
])

function walkContentForAssetRefs(node, refs) {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) { for (const child of node) walkContentForAssetRefs(child, refs); return }
  if (node.attrs && typeof node.attrs === 'object') {
    // Skip nodes already rewritten in a prior deploy — those have an
    // identifier and the runtime resolves them through the CDN already.
    if (!node.attrs.info?.identifier) {
      if (typeof node.attrs.src === 'string') refs.add(node.attrs.src)
      if (typeof node.attrs.href === 'string') refs.add(node.attrs.href)
    }
  }
  // Flat fields: collection-shaped objects (e.g. an article record) often
  // carry media URLs as plain string fields rather than ProseMirror nodes.
  // Capture absolute-path values under known keys.
  for (const [k, v] of Object.entries(node)) {
    if (typeof v === 'string' && FLAT_ASSET_FIELDS.has(k) && isResolvableContentRef(v)) {
      refs.add(v)
    } else if (typeof v === 'object') {
      walkContentForAssetRefs(v, refs)
    }
  }
}

/**
 * Walk an arbitrary JSON tree and replace any string equal to a key in
 * `byOriginalRef` (and not already a CDN URL) with the asset's CDN URL.
 * Used for collection JSON files where image refs are flat string fields
 * (e.g. `article.image: "/covers/foo.svg"`) rather than ProseMirror nodes.
 *
 * Returns the number of replacements performed.
 */
function rewriteFlatAssetUrls(node, byOriginalRef) {
  let count = 0
  const walk = (n, parent, key) => {
    if (n == null) return
    if (typeof n === 'string') {
      const id = byOriginalRef.get(n)
      if (id && parent != null && key != null) {
        parent[key] = resolveAssetCdnUrl(id)
        count++
      }
      return
    }
    if (typeof n !== 'object') return
    if (Array.isArray(n)) {
      for (let i = 0; i < n.length; i++) walk(n[i], n, i)
      return
    }
    for (const [k, v] of Object.entries(n)) walk(v, n, k)
  }
  walk(node, null, null)
  return count
}

function isResolvableContentRef(ref) {
  if (typeof ref !== 'string' || !ref) return false
  // Absolute-path only — relative paths (`./foo`, `foo`) are content-author
  // shorthand handled elsewhere; URLs (`http://`, `//cdn`) never resolve to
  // local files; worker-internal paths (`/api/`, `/_`) aren't asset content.
  if (!ref.startsWith('/')) return false
  if (ref.startsWith('//')) return false
  if (ref.startsWith('/api/') || ref.startsWith('/_')) return false
  return true
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
