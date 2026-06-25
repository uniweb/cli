/**
 * Bring-the-foundation-along — the freshness loop `uniweb publish` runs before
 * it makes a site live (shipping-model.md §4).
 *
 * A publish must never ship a site pointing at stale or missing foundation code
 * (the footgun: a site goes live referencing a version the catalog doesn't
 * have). So when the site references a LOCAL foundation, publish fingerprints it
 * and reconciles with the catalog. Three cases (§4):
 *
 *   | version not yet registered    | release it, then publish        |
 *   | registered, code unchanged    | skip the release (digest match) |
 *   | registered, code CHANGED      | warn / prompt — never silent    |
 *
 * The freshness signal is the backend-stored, framework-computed digest (§4.1):
 * no local state, multi-machine-safe. When the site references a published
 * registry ref or a URL there's nothing to bring along. When the backend
 * doesn't expose the stored digest yet, the compare DEGRADES to "ask" (same
 * posture as `status --remote` on a 404).
 *
 * "Release" here is literally `uniweb register` run in the foundation directory
 * — same build-if-stale → schema submit → code upload → digest the standalone
 * verb does, so there is exactly one foundation-release path.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

import { detectFoundationType } from '@uniweb/build'
import { computeFoundationDigest } from '../utils/code-upload.js'
import { readFlagValue } from '../utils/args.js'
import { isNonInteractive } from '../utils/interactive.js'

/**
 * Resolve the site's LOCAL foundation — the one publish should bring along — or
 * null when the site references a published registry ref / URL (the catalog
 * already has it; nothing to do). Uses the SAME resolver the build uses
 * (`detectFoundationType`), so "which foundation" never drifts between them.
 *
 * @param {string} siteDir
 * @param {object} siteYml - parsed site.yml
 * @returns {{ dir: string, scopedName: string|null, version: string|null }|null}
 */
export function resolveLocalFoundation(siteDir, siteYml) {
  const decl = siteYml?.foundation
  if (!decl) return null
  let info
  try {
    info = detectFoundationType(decl, siteDir)
  } catch {
    // Unresolved declaration — the site build will surface the canonical
    // error; bring-along simply has nothing local to act on.
    return null
  }
  if (!info || info.type !== 'local' || !info.path) return null
  return {
    dir: info.path,
    scopedName: foundationScopedName(info.path),
    version: readPkgField(info.path, 'version'),
  }
}

// The foundation's scoped catalog name (`@org/name`) from its package.json — an
// already-scoped `name`, else `uniweb.scope` + a bare `name`. Null when neither
// yields a scoped name (then we can't look up the registered version, so the
// caller treats the foundation as "release it and let register pick the scope").
function foundationScopedName(dir) {
  try {
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
    const name = pkg?.name
    if (typeof name === 'string' && name.startsWith('@')) return name
    const scope = pkg?.uniweb?.scope
    if (scope && name) return `${String(scope).replace(/\/+$/, '')}/${name}`
    return null
  } catch {
    return null
  }
}

function readPkgField(dir, field) {
  try {
    return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))?.[field] || null
  } catch {
    return null
  }
}

// Forward the origin + auth flags so the spawned `uniweb register` / `build`
// hits the SAME backend with the SAME session as the publish that called it.
function forwardedFlags(args) {
  const out = []
  for (const name of ['--backend', '--registry', '--token']) {
    const v = readFlagValue(args, name)
    if (v) out.push(name, v)
  }
  if (isNonInteractive(args)) out.push('--non-interactive')
  return out
}

/**
 * Decide + (maybe) act on the site's local foundation before go-live.
 *
 * @param {object} o
 * @param {import('./client.js').BackendClient} o.client
 * @param {string} o.siteDir
 * @param {object} o.siteYml
 * @param {string[]} o.args
 * @param {object} o.say - { ok, info, warn, err, dim } reporters
 * @param {(q: string, def?: boolean) => Promise<boolean>} o.confirm
 * @param {string} o.cliBin - the CLI entry (process.argv[1]) to re-spawn
 * @param {boolean} [o.dryRun]
 * @returns {Promise<{ released: boolean, proceed: boolean, ref: string|null }>}
 *   proceed:false → the caller should abort the publish (user declined). `ref`
 *   is the pinned `@scope/name@version` to stamp on the pushed site — read AFTER
 *   any release, so it reflects the released version + the scope register
 *   derived. Delivery is version-pinned end-to-end (the gateway serves a
 *   foundation only by a concrete version, no latest-resolution at serve time —
 *   collab framework-backend-5c3e), so an unversioned local ref MUST be pinned
 *   on the wire or the live site points at code the gateway can't serve. null
 *   when the site already references a registry ref / URL (no override needed)
 *   or no scoped ref can be formed.
 */
export async function bringFoundationAlong({ client, siteDir, siteYml, args, say, confirm, cliBin, dryRun = false }) {
  const local = resolveLocalFoundation(siteDir, siteYml)
  if (!local) {
    // Published registry ref / URL — the catalog (or the URL host) already
    // serves the code, and site.yml already pins the version. Nothing to bring
    // along, and no ref override (forward the site.yml ref verbatim).
    return { released: false, proceed: true, ref: null }
  }

  const label = local.scopedName || local.version ? `${local.scopedName || 'foundation'}${local.version ? `@${local.version}` : ''}` : 'the local foundation'
  const skipPrompts = args.includes('--yes') || args.includes('--force') || args.includes('--no-verify')

  // The pinned ref to stamp on the pushed site — read at RETURN time (after any
  // release), so it reflects the released version + the scope register derived.
  // null when no scoped ref can be formed (then the site.yml ref is forwarded).
  const pinnedRef = () => {
    const s = foundationScopedName(local.dir)
    const v = readPkgField(local.dir, 'version')
    return s && v ? `${s}@${v}` : null
  }

  // Dry-run reports the intent WITHOUT touching the network — it must not force
  // a login (the digest read is auth-gated). The real run does the compare.
  if (dryRun) {
    say.dim(`Foundation  : ${label} — local; would release if changed or not yet registered`)
    return { released: false, proceed: true, ref: null }
  }

  // Ask the catalog what it has. Null → not registered (or the backend can't
  // answer / no scoped name to look up) → release.
  const reg = local.scopedName ? await client.readFoundationLatest(local.scopedName) : null

  if (!reg) {
    say.info(`Releasing the foundation ${label} (not yet registered)…`)
    return { released: releaseFoundation(local, args, cliBin, say), proceed: true, ref: pinnedRef() }
  }

  // Registered — fingerprint the local build and compare. Build first so the
  // digest reflects current source (idempotent: a no-op when already fresh).
  buildFoundation(local, cliBin)
  const localDigest = computeFoundationDigest(join(local.dir, 'dist'))

  if (reg.digest && localDigest && reg.digest === localDigest) {
    say.dim(`Foundation  : ${label} — unchanged since release (digest matches); nothing to release.`)
    return { released: false, proceed: true, ref: pinnedRef() }
  }

  // A different version locally → a new version to release.
  if (local.version && local.version !== reg.latest_version) {
    say.info(`Releasing the foundation ${label} (new version; registered latest is ${reg.latest_version})…`)
    return { released: releaseFoundation(local, args, cliBin, say), proceed: true, ref: pinnedRef() }
  }

  // Same version, but the digest differs or the backend can't confirm it.
  if (!reg.digest) {
    // Degrade: the backend doesn't return the stored digest yet, so we can't
    // be sure the registered version matches local. Offer to re-deliver.
    say.warn(`Can't verify the registered ${label} matches your local copy (backend returned no digest).`)
    if (skipPrompts || isNonInteractive(args)) {
      say.dim('Proceeding without re-releasing — pass nothing to re-deliver, or bump the version to publish a change.')
      return { released: false, proceed: true, ref: pinnedRef() }
    }
    const reRelease = await confirm(`Re-release ${label} to be sure its code is current?`, false)
    if (reRelease) return { released: releaseFoundation(local, args, cliBin, say), proceed: true, ref: pinnedRef() }
    return { released: false, proceed: true, ref: pinnedRef() }
  }

  // Case 3 (§4): the foundation was edited but the version wasn't bumped. The
  // registered version is immutable, so we never silently ship the old code —
  // the deliberate release gate is a version bump (§3.1).
  say.warn(`Your local ${label} differs from the registered version ${reg.latest_version}, but the version wasn't bumped.`)
  say.dim('A registered version is immutable. Bump the foundation\'s version to release the change, then re-run `uniweb publish`.')
  if (skipPrompts || isNonInteractive(args)) {
    say.dim(`Proceeding with the already-registered ${reg.latest_version}.`)
    return { released: false, proceed: true, ref: pinnedRef() }
  }
  const proceed = await confirm(`Publish with the already-registered ${reg.latest_version} anyway?`, false)
  if (!proceed) {
    say.info('Aborted — bump the foundation version, then re-run `uniweb publish`.')
    return { released: false, proceed: false, ref: null }
  }
  return { released: false, proceed: true, ref: pinnedRef() }
}

// Build the foundation so its dist/ can be fingerprinted. Idempotent — the
// foundation build no-ops when already fresh.
function buildFoundation(local, cliBin) {
  execFileSync('node', [cliBin, 'build', '--target', 'foundation'], {
    cwd: local.dir,
    stdio: 'inherit',
    env: process.env,
  })
}

// Release = `uniweb register` in the foundation directory (the one foundation
// release path). Returns true on success; throws to the caller on failure so
// publish stops before going live with missing code.
function releaseFoundation(local, args, cliBin, say) {
  console.log('')
  execFileSync('node', [cliBin, 'register', ...forwardedFlags(args)], {
    cwd: local.dir,
    stdio: 'inherit',
    env: process.env,
  })
  console.log('')
  return true
}
