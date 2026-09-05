/**
 * Bring-the-foundation-along — the freshness loop `uniweb publish` AND `uniweb
 * push` run before handing a site to a backend (shipping-model.md §4).
 *
 * A publish must never ship a site pointing at stale or missing foundation code
 * (the footgun: a site goes live referencing a version the catalog doesn't
 * have). So when the site references a LOCAL foundation, the verb fingerprints it
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
 *
 * ⭐ **`push` runs it too, and for a reason publish's framing does not cover.**
 * [Diego, 2026-08-19] — *"A published site can only reference a registered
 * foundation … In fact, not even a push can, because we can't preview the site in
 * the frontend in that case."* A push is the collaboration verb: a teammate opens
 * the site in the visual app straight after, and the app can only render it against
 * foundation code the backend can serve. So an unregistered ref is not merely a
 * publish-time problem — it is a broken preview, which is where a teammate actually
 * meets it. `verb` names the caller in the messages so the fix the user is told to
 * run is the command they ran.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

import { detectFoundationType, isExtensionUrl } from '@uniweb/build'
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
    version: readPkgField(info.path, 'version')
  }
}

/**
 * The site's LOCAL extensions — the ones publish must bring along. An extension IS
 * a foundation (same build, same output), so it is declared and resolved the same
 * way and goes through the SAME resolver, for the same reason `resolveLocalFoundation`
 * does: "which code" must never drift between the build and the publish.
 *
 * A declaration that resolves to a URL or a catalog ref yields nothing local — the
 * host already serves that code. Only workspace-local extensions need releasing.
 *
 * @param {string} siteDir
 * @param {object} siteYml - parsed site.yml
 * @returns {Array<{ decl: string, dir: string, scopedName: string|null, version: string|null }>}
 *   `decl` is the authored declaration, which is the wire entry's `$id` — the key
 *   publish stamps the pinned ref back onto.
 */
export function resolveLocalExtensions(siteDir, siteYml) {
  const list = siteYml?.extensions
  if (!Array.isArray(list)) return []
  const out = []
  for (const entry of list) {
    // Only the name/ref form can be local; an explicit `url` never is.
    const decl =
      entry && typeof entry === 'object'
        ? entry.ref || entry.name || null
        : typeof entry === 'string'
          ? entry
          : null
    if (!decl || isExtensionUrl(decl)) continue
    let info
    try {
      info = detectFoundationType(decl, siteDir)
    } catch {
      // Unresolved — the site build surfaces the canonical error; nothing local.
      continue
    }
    if (!info || info.type !== 'local' || !info.path) continue
    out.push({
      decl,
      dir: info.path,
      scopedName: foundationScopedName(info.path),
      version: readPkgField(info.path, 'version')
    })
  }
  return out
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
    return (
      JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))?.[field] ||
      null
    )
  } catch {
    return null
  }
}

// Forward the origin + auth flags so the spawned `uniweb register` / `build`
// hits the SAME backend with the SAME session as the publish that called it.
function forwardedFlags(args) {
  const out = []
  for (const name of ['--backend', '--token']) {
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
 *   collab framework↔backend), so an unversioned local ref MUST be pinned
 *   on the wire or the live site points at code the gateway can't serve. null
 *   when the site already references a registry ref / URL (no override needed)
 *   or no scoped ref can be formed.
 */
export async function bringFoundationAlong({
  client,
  siteDir,
  siteYml,
  args,
  say,
  confirm,
  cliBin,
  dryRun = false,
  verb = 'publish'
}) {
  const local = resolveLocalFoundation(siteDir, siteYml)
  if (!local) {
    // Published registry ref / URL — the catalog (or the URL host) already
    // serves the code, and site.yml already pins the version. Nothing to bring
    // along, and no ref override (forward the site.yml ref verbatim).
    return { released: false, proceed: true, ref: null }
  }
  return bringLocalCodeAlong({
    client,
    local,
    kind: 'foundation',
    args,
    say,
    confirm,
    cliBin,
    dryRun,
    verb
  })
}

/**
 * Bring ONE piece of local code along — the primary foundation or one extension.
 * Identical logic for both because an extension is a foundation; `kind` only names
 * it in the messages.
 *
 * @param {object} o
 * @param {{dir: string, scopedName: string|null, version: string|null}} o.local
 * @param {'foundation'|'extension'} o.kind
 * @returns {Promise<{ released: boolean, proceed: boolean, ref: string|null }>}
 */
async function bringLocalCodeAlong({
  client,
  local,
  kind,
  args,
  say,
  confirm,
  cliBin,
  dryRun = false,
  verb = 'publish'
}) {
  const Kind = kind === 'extension' ? 'Extension ' : 'Foundation'
  const label =
    local.scopedName || local.version
      ? `${local.scopedName || kind}${local.version ? `@${local.version}` : ''}`
      : `the local ${kind}`
  const skipPrompts =
    args.includes('--yes') ||
    args.includes('--force') ||
    args.includes('--no-verify')

  // `--no-release`: ship the site against the code that is ALREADY released, and do
  // not release the local changes.
  //
  // The intent is ordinary and had no name until 2026-08-19 — a developer edits
  // content and a component in one sitting, and wants the copy fix live without
  // shipping a half-finished component. Until now the way to get it was `--yes`,
  // which means "do not ask me": the behaviour was reachable only as a side effect of
  // a confirmation-skipper, which is discovery by accident.
  //
  // ⛔ It skips the RELEASE, never the REGISTRATION REQUIREMENT. A site referencing a
  // foundation no deployment can resolve cannot be opened in the app at all, so where
  // this flag cannot be honoured it REFUSES rather than doing the opposite of what it
  // says (see the `!reg` branch).
  const noRelease = args.includes('--no-release')

  // The pinned ref to stamp on the pushed site — read at RETURN time (after any
  // release), so it reflects the released version + the scope register derived.
  // null when no scoped ref can be formed (then the site.yml ref is forwarded).
  const pinnedRef = () => {
    const s = foundationScopedName(local.dir)
    const v = readPkgField(local.dir, 'version')
    return s && v ? `${s}@${v}` : null
  }

  // The ref for a run that releases NOTHING — the version the catalog actually holds,
  // which is not always the local one. ⚠️ `pinnedRef()` reads the LOCAL package.json,
  // so on a bumped-but-unreleased foundation it names a version nobody can serve. Any
  // branch that skips a release must bind to this instead.
  const registeredRef = (reg) =>
    local.scopedName && reg?.latest_version
      ? `${local.scopedName}@${reg.latest_version}`
      : null

  // Dry-run reports the intent WITHOUT touching the network — it must not force
  // a login (the digest read is auth-gated). The real run does the compare.
  if (dryRun) {
    say.dim(
      `${Kind}  : ${label} — local; would release if changed or not yet registered`
    )
    // The ref still comes back where one can be formed: it is read from the
    // foundation's own package.json, so it costs no network, and an offline preview
    // that omitted it would emit a document the real run would not — the one thing
    // `-o` exists to avoid.
    //
    // ⚠️ It is null for a foundation that has NEVER been registered and carries no
    // scope (a freshly scaffolded `name: "src"`), because the scope is what
    // `register` writes back (`writePkgScope`). So the preview shows the authored
    // value there, and the first real push — which releases, and so acquires the
    // scope — sends the pinned ref instead. That gap is unavoidable offline: before
    // the first release there is no registered name to name.
    return { released: false, proceed: true, ref: pinnedRef() }
  }

  // Ask the catalog what it has. Null → not registered (or the backend can't
  // answer / no scoped name to look up) → release.
  const reg = local.scopedName
    ? await client.readFoundationLatest(local.scopedName)
    : null

  if (!reg) {
    // ⛔ Nothing to bind to. Releasing anyway would be the opposite of what was asked,
    // and shipping anyway would leave a site the app cannot open — so stop and say so.
    if (noRelease) {
      say.err(
        `--no-release, but ${label} has never been released — there is no registered version to bind to.`
      )
      say.dim(
        `A site referencing an unreleased ${kind} cannot be opened in the app, so this cannot be skipped.`
      )
      say.dim(`Drop \`--no-release\` to release it now.`)
      return { released: false, proceed: false, refused: true, ref: null }
    }
    say.info(`Releasing the ${kind} ${label} (not yet registered)…`)
    return {
      released: releaseFoundation(local, args, cliBin, say),
      proceed: true,
      ref: pinnedRef()
    }
  }

  // Registered — fingerprint the local build and compare. Build first so the
  // digest reflects current source (idempotent: a no-op when already fresh).
  buildFoundation(local, cliBin)
  const localDigest = computeFoundationDigest(join(local.dir, 'dist'))

  if (reg.digest && localDigest && reg.digest === localDigest) {
    say.dim(
      `${Kind}  : ${label} — unchanged since release (digest matches); nothing to release.`
    )
    return { released: false, proceed: true, ref: pinnedRef() }
  }

  // A different version locally → a new version to release.
  if (local.version && local.version !== reg.latest_version) {
    if (noRelease) {
      // ⚠️ Bind to the REGISTERED version, not the local one. `pinnedRef()` would
      // return the bumped-but-unreleased `local.version` here — a ref no deployment
      // can serve, which is the very failure this flag must not create.
      say.info(
        `Keeping the released ${kind} ${reg.latest_version} — local ${local.version} not released (\`--no-release\`).`
      )
      return { released: false, proceed: true, ref: registeredRef(reg) }
    }
    say.info(
      `Releasing the ${kind} ${label} (new version; registered latest is ${reg.latest_version})…`
    )
    return {
      released: releaseFoundation(local, args, cliBin, say),
      proceed: true,
      ref: pinnedRef()
    }
  }

  // Same version, but the digest differs or the backend can't confirm it.
  if (!reg.digest) {
    // Degrade: the backend doesn't return the stored digest yet, so we can't
    // be sure the registered version matches local. Offer to re-deliver.
    if (noRelease) {
      say.info(
        `Keeping the released ${kind} ${reg.latest_version} — nothing released (\`--no-release\`).`
      )
      return { released: false, proceed: true, ref: registeredRef(reg) }
    }
    say.warn(
      `Can't verify the registered ${label} matches your local copy (backend returned no digest).`
    )
    if (skipPrompts || isNonInteractive(args)) {
      say.dim(
        'Proceeding without re-releasing — pass nothing to re-deliver, or bump the version to release a change.'
      )
      return { released: false, proceed: true, ref: pinnedRef() }
    }
    const reRelease = await confirm(
      `Re-release ${label} to be sure its code is current?`,
      false
    )
    if (reRelease)
      return {
        released: releaseFoundation(local, args, cliBin, say),
        proceed: true,
        ref: pinnedRef()
      }
    return { released: false, proceed: true, ref: pinnedRef() }
  }

  // Case 3 (§4): the code was edited but the version wasn't bumped. The
  // registered version is immutable, so we never silently ship the old code —
  // the deliberate release gate is a version bump (§3.1).
  // Asked for explicitly: the case this flag exists to name.
  if (noRelease) {
    say.info(
      `Keeping the released ${kind} ${reg.latest_version} — your local changes are not released (\`--no-release\`).`
    )
    return { released: false, proceed: true, ref: registeredRef(reg) }
  }

  // ⭐ THREE OUTCOMES, NOT TWO — `--yes` and "no TTY" are not the same answer.
  //
  // They were one condition until 2026-08-19, and conflating them meant the only
  // party that never got asked was the one that most needed asking. A `--yes` is a
  // decision someone made in advance; an absent TTY is the ABSENCE of a decision,
  // and absence is not consent.
  //
  // ⚖️ Which flips the safe default by caller, for a reason particular to this
  // situation: proceeding here ships a site bound to code that is NOT the code in
  // the working tree. A human is at a terminal, reads the warning, and decides. An
  // agent re-runs commands for free and reports "pushed" on exit 0 — so for it the
  // cheap outcome is one more cycle and the expensive one is a silent wrong success
  // it will not look at again. Refusing costs an agent a retry; proceeding costs it
  // a false completion report and a live site nobody notices is stale.

  // 1. Explicit consent — proceed, but at WARN. `dim` is what we print for things
  //    nobody needs to read, and "your changes are not live" is not that.
  if (skipPrompts) {
    say.warn(
      `Local ${label} differs from the registered ${reg.latest_version} and the version wasn't bumped — ` +
        `shipping against the registered code. Your local changes will NOT be live.`
    )
    return { released: false, proceed: true, ref: pinnedRef() }
  }

  // 2. Nobody to ask. Refuse, and name both real options as runnable commands so
  //    the caller's next step needs no interpretation. `refused` marks this as a
  //    hard stop rather than a human's "no", which callers map to different exits.
  if (isNonInteractive(args)) {
    say.err(
      `Local ${kind} ${label} differs from the registered ${reg.latest_version}, and the version wasn't bumped.`
    )
    say.dim(`Nothing was sent. Either release the change, or ship without it:`)
    say.dim(`  • bump the ${kind}'s version in package.json, then re-run \`uniweb ${verb}\``)
    // Teach the flag that NAMES this, not `--yes`. Both work, but `--yes` means "do
    // not ask me" and only does this as a side effect — pointing a stuck user at it
    // teaches a blunt instrument for a precise job.
    say.dim(
      `  • \`uniweb ${verb} --no-release\` — sends content bound to the released ${reg.latest_version}`
    )
    return { released: false, proceed: false, refused: true, ref: null }
  }

  // 3. A human is here. State it, then ask.
  say.warn(
    `Your local ${label} differs from the registered version ${reg.latest_version}, but the version wasn't bumped.`
  )
  say.dim(
    `A registered version is immutable — bump the ${kind}'s version to release the change.`
  )
  const proceed = await confirm(
    `Continue with the already-registered ${reg.latest_version} anyway?`,
    false
  )
  if (!proceed) {
    say.info(
      `Aborted — nothing was sent. Bump the ${kind} version, then re-run \`uniweb ${verb}\`.`
    )
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
    env: process.env
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
    env: process.env
  })
  console.log('')
  return true
}

/**
 * Bring the site's LOCAL extensions along — the exact parallel of
 * `bringFoundationAlong`, run for each workspace-local extension.
 *
 * An extension is a foundation, so it gets a foundation's freshness guarantee:
 * released when unregistered or newly versioned, skipped on a digest match, and
 * never silently shipped stale. Before this, a site could go live against a stale
 * extension with nothing noticing — the primary was covered and the rest were not.
 *
 * @param {object} o - same shape as bringFoundationAlong
 * @returns {Promise<{ proceed: boolean, released: number, pins: Object<string,string> }>}
 *   `pins` maps each authored declaration (the wire entry's `$id`) → the pinned
 *   `@scope/name@version`, for `emitSyncPackages({ injectExtensions })`. Delivery is
 *   version-pinned, so an unpinned local name on the wire points at code the host
 *   cannot serve — the same reason the primary's ref is stamped.
 */
export async function bringExtensionsAlong({
  client,
  siteDir,
  siteYml,
  args,
  say,
  confirm,
  cliBin,
  dryRun = false
}) {
  const locals = resolveLocalExtensions(siteDir, siteYml)
  const pins = {}
  let released = 0
  for (const local of locals) {
    const r = await bringLocalCodeAlong({
      client,
      local,
      kind: 'extension',
      args,
      say,
      confirm,
      cliBin,
      dryRun
    })
    // A declined prompt aborts the whole publish, exactly as it does for the
    // primary — a site live against half its code is worse than not shipping.
    if (!r.proceed) return { proceed: false, released, pins: {} }
    if (r.released) released += 1
    if (r.ref) pins[local.decl] = r.ref
  }
  return { proceed: true, released, pins }
}
