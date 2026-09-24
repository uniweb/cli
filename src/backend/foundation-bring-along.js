/**
 * Bring-the-foundation-along — the freshness loop `uniweb publish` AND `uniweb
 * push` run before handing a site to a backend (shipping-model.md §4).
 *
 * A publish must never ship a site pointing at stale or missing foundation code
 * (the footgun: a site goes live referencing a version the catalog doesn't
 * have). So when the site references a LOCAL foundation, the verb fingerprints it
 * and reconciles with the catalog (§4):
 *
 *   | version not yet registered      | release it                            |
 *   | registered, code unchanged      | skip the release (digest match)       |
 *   | registered, code CHANGED        | release it under the next version     |
 *   | a NEWER version is registered   | stop — `--bump` releases above it     |
 *
 * ⭐ **Changed code is released by default** *[Diego, 2026-09-24]*. A site whose project
 * holds its own foundation is a content+code bundle — *"a developer is used to code
 * going with the site, so they don't think of bumping the code of a site"* — and the
 * version there decides nothing: the only site reading it is the one being pushed.
 * Since a registered version is immutable, the change goes under the next version
 * above the registered one, written into the package's `package.json` first. ⛔ This
 * reverses the version-bump release gate of 2026-06-23, whose reasoning — a deliberate,
 * npm-style release — fits a foundation other sites use as a product; those sites pin
 * a catalog ref and never reach this code. (A library's own demo site, which names it
 * by path, does — whether such a foundation should declare its releases deliberate is
 * open.)
 *
 * ⛔ **A NEWER registered version still stops it.** It was released from another copy
 * of the project, whose code this one may not have, and releasing above it would make
 * the older code the newest — the code twin of push's content staleness gate. `--bump`
 * releases above it anyway; `--no-release` ships the content bound to it.
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

import {
  detectFoundationType,
  isExtensionUrl,
  readFoundationName,
  checkFoundationName
} from '@uniweb/build'
import { computeFoundationDigest } from '../utils/code-upload.js'
import { isNonInteractive } from '../utils/interactive.js'
import { writeJsonPreservingStyle } from '../utils/json-file.js'
import {
  compareSemverPrecedence,
  nextVersionAbove
} from '../utils/semver-precedence.js'

/**
 * Resolve the site's LOCAL foundation — the one publish should bring along — or
 * null when the site references a published registry ref / URL (the catalog
 * already has it; nothing to do). Uses the SAME resolver the build uses
 * (`detectFoundationType`), so "which foundation" never drifts between them.
 *
 * Its catalog name is `foundationScopedName(dir)` — a separate, async read, because
 * the name lives in `main.js`, which is loaded rather than parsed.
 *
 * @param {string} siteDir
 * @param {object} siteYml - parsed site.yml
 * @returns {{ dir: string, version: string|null }|null}
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
  return { dir: info.path, version: readPkgField(info.path, 'version') }
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
 * @returns {Array<{ decl: string, dir: string, version: string|null }>}
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
    out.push({ decl, dir: info.path, version: readPkgField(info.path, 'version') })
  }
  return out
}

/**
 * The foundation's scoped catalog name (`@org/name`): its name — `main.js`'s
 * `name`, else package.json's, the one rule the build reads for the schema
 * `register` submits (`readFoundationName`). ⭐ The scope is part of that name
 * (2026-09-22), so a scoped name IS the catalog name. Null otherwise; the caller
 * then treats the foundation as unreleased, and `register` — which it runs to
 * release — is where a missing scope is chosen and written into the name, and a
 * missing name is asked for.
 *
 * ⛔ A NAME THAT CANNOT REGISTER IS NULL, not looked up. `src` and `foundation`
 * name a folder (`checkFoundationName`); looking one up would find some other
 * project's `@org/src` — the very collision refusing them prevents.
 *
 * ⛔ A BARE NAME IS NULL too: it has not registered, since `register` writes the scope
 * it registers under into the name. Until 2026-09-22 this joined a bare name with
 * `package.json::uniweb.scope`; that key is refused now (`readFoundationName` throws,
 * so a leftover reads as unreleased here and `register` says what to write instead).
 * *(This read package.json alone until 2026-09-21 — `uniweb.id`, else `name` — and
 * so named a foundation differently from the build whenever `main.js` named it.)*
 *
 * @param {string} dir - the foundation package
 * @returns {Promise<string|null>}
 */
export async function foundationScopedName(dir) {
  let name
  try {
    ;({ name } = await readFoundationName(dir))
  } catch {
    return null
  }
  if (checkFoundationName(name)) return null
  return name.startsWith('@') ? name : null
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

// Set the package's version, changing nothing else in the file — its key order,
// indentation and trailing newline stay as they were, so the diff is one line.
function writePkgVersion(dir, version) {
  const path = join(dir, 'package.json')
  const src = readFileSync(path, 'utf8')
  writeJsonPreservingStyle(path, { ...JSON.parse(src), version }, src)
}

// What travels to the spawned `uniweb register` / `build` on the command line: only
// --non-interactive. The BACKEND travels in the child's environment
// (releaseFoundation), and the SESSION is the shared session file — or UNIWEB_TOKEN,
// which the child inherits. The backend commands take no `--backend` or `--token`.
function forwardedFlags(args) {
  const out = []
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
 * @param {{dir: string, version: string|null}} o.local
 * @param {'foundation'|'extension'} o.kind
 * @returns {Promise<{ released: boolean, proceed: boolean, ref: string|null, bumped?: string }>}
 *   `bumped` is the version written into package.json when changed code was released
 *   under the next version.
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
  const scopedName = await foundationScopedName(local.dir)
  const label =
    scopedName || local.version
      ? `${scopedName || kind}${local.version ? `@${local.version}` : ''}`
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

  // `--bump`: when the registry holds a version NEWER than the local one, release the
  // local code above it instead of stopping. That is all it does — changed code under
  // the registered version is released without it, and unchanged code never is — so a
  // script can pass it on every run.
  const bump = args.includes('--bump')

  if (bump && noRelease) {
    say.err(
      '`--bump` releases your local changes and `--no-release` ships without them — pass one of the two.'
    )
    return { released: false, proceed: false, refused: true, ref: null }
  }

  // The pinned ref to stamp on the pushed site — read at RETURN time (after any
  // release), so it reflects the released version, the scope register derived and
  // the name it asked for. null when no scoped ref can be formed (then the site.yml
  // ref is forwarded).
  const pinnedRef = async () => {
    const s = await foundationScopedName(local.dir)
    const v = readPkgField(local.dir, 'version')
    return s && v ? `${s}@${v}` : null
  }

  // The ref for a run that releases NOTHING — the version the catalog actually holds,
  // which is not always the local one. ⚠️ `pinnedRef()` reads the LOCAL package.json,
  // so on a bumped-but-unreleased foundation it names a version nobody can serve. Any
  // branch that skips a release must bind to this instead.
  const registeredRef = (reg) =>
    scopedName && reg?.latest_version
      ? `${scopedName}@${reg.latest_version}`
      : null

  // Dry-run reports the intent WITHOUT touching the network — it must not force
  // a login (the digest read is auth-gated). The real run does the compare.
  if (dryRun) {
    say.dim(
      `${Kind}  : ${label} — local; would release if changed or not yet registered`
    )
    // The ref still comes back where one can be formed: it is read from the
    // foundation's own files, so it costs no network, and an offline preview that
    // omitted it would emit a document the real run would not — the one thing `-o`
    // exists to avoid.
    //
    // ⚠️ It is null for a foundation that has NEVER been registered and carries no
    // scope (a fresh scaffold), because the scope is what `register` writes into its
    // name (`settleFoundationScope`) — and for one with no name of its own (`src`),
    // which `register` asks for. So the preview shows the authored value there, and the
    // first real push — which releases, and so acquires both — sends the pinned ref
    // instead. That gap is unavoidable offline: before the first release there is
    // no registered name to name.
    return { released: false, proceed: true, ref: await pinnedRef() }
  }

  // Ask the catalog what it has. Null → not registered (or the backend can't
  // answer / no scoped name to look up) → release.
  const reg = scopedName ? await client.readFoundationLatest(scopedName) : null

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
      released: releaseFoundation(local, args, cliBin, say, client?.origin),
      proceed: true,
      ref: await pinnedRef()
    }
  }

  // The next version above the registered one — what changed code is released under
  // when the local version is taken. Null when the registered version is not SemVer,
  // and then there is nothing to count up from.
  const bumpTo = nextVersionAbove(reg.latest_version)

  // Write it into package.json, then release. `register` rebuilds on its own when the
  // built schema's version no longer matches package.json, so the release carries it.
  // `optOut` names `--no-release` for a release nobody asked for by flag.
  //
  // ⚖️ A failed release leaves the new version in the file, and that is the useful
  // state: the next run finds a local version above the registered one and releases
  // it, with nothing to redo.
  const releaseAsNext = async (why, { optOut = false } = {}) => {
    if (!bumpTo) {
      say.err(
        `Cannot release ${label} under a new version: the registered ${reg.latest_version} is not a SemVer version.`
      )
      say.dim(
        `Nothing was sent. Set a version above it in the ${kind}'s package.json, then re-run \`uniweb ${verb}\`; or \`uniweb ${verb} --no-release\` sends content bound to the released ${reg.latest_version}.`
      )
      return { released: false, proceed: false, refused: true, ref: null }
    }
    writePkgVersion(local.dir, bumpTo)
    say.info(`Releasing the ${kind} ${scopedName || kind} as ${bumpTo} — ${why}…`)
    const released = releaseFoundation(local, args, cliBin, say, client?.origin)
    say.dim(`The ${kind}'s package.json now says ${bumpTo} — commit it.`)
    if (optOut) say.dim('To send content without releasing code, pass `--no-release`.')
    return { released, proceed: true, bumped: bumpTo, ref: await pinnedRef() }
  }

  // Registered — fingerprint the local build and compare. Build first so the
  // digest reflects current source (idempotent: a no-op when already fresh).
  buildFoundation(local, cliBin)
  const localDigest = computeFoundationDigest(join(local.dir, 'dist'))

  if (reg.digest && localDigest && reg.digest === localDigest) {
    say.dim(
      `${Kind}  : ${label} — unchanged since release (digest matches); nothing to release.`
    )
    return { released: false, proceed: true, ref: await pinnedRef() }
  }

  // A different version locally.
  if (local.version && local.version !== reg.latest_version) {
    const order = compareSemverPrecedence(local.version, reg.latest_version)
    // Equal in precedence (build metadata apart) is the registered version itself, and
    // is treated as it, below.
    if (order !== 0) {
      if (noRelease) {
        // ⚠️ Bind to the REGISTERED version, not the local one. `pinnedRef()` would
        // return the bumped-but-unreleased `local.version` here — a ref no deployment
        // can serve, which is the very failure this flag must not create.
        say.info(
          `Keeping the released ${kind} ${reg.latest_version} — local ${local.version} not released (\`--no-release\`).`
        )
        return { released: false, proceed: true, ref: registeredRef(reg) }
      }

      // ⛔ OLDER than the registered latest: that version was released from another
      // copy of the project, and this one may not have its code. Releasing above it
      // would make this code the newest and bind the site to it — a teammate's release
      // undone by a push that never saw it. So it stops, and names the ways on.
      //
      // Until 2026-09-24 it was submitted, the registry deciding: it took a version it
      // already held with this very code (a resume), and refused anything else. Only
      // the latest version's digest is readable, and the digest folds in the version,
      // so "this code, under an older version" cannot be told apart from here.
      if (order === -1) {
        if (bump) {
          say.warn(
            `The registry holds ${reg.latest_version}, newer than your ${label} — releasing your code above it (\`--bump\`). If ${reg.latest_version} is someone else's release, its changes are not in yours.`
          )
          return releaseAsNext(`above the registered ${reg.latest_version}`)
        }
        say.err(
          `The registry holds ${kind} ${scopedName || kind} ${reg.latest_version}, newer than your ${local.version} — a release this copy does not have.`
        )
        say.dim(
          `Nothing was sent. Pull the change that released it, then re-run \`uniweb ${verb}\`; or:`
        )
        if (bumpTo) {
          say.dim(`  • \`uniweb ${verb} --bump\` — releases your code as ${bumpTo}, above it`)
        }
        say.dim(
          `  • \`uniweb ${verb} --no-release\` — sends content bound to the released ${reg.latest_version}`
        )
        return { released: false, proceed: false, refused: true, ref: null }
      }

      // Newer than anything registered — a new version, released as it stands. Not
      // SemVer (`order === null`) — nothing to compare, so the same, and the registry
      // decides; `register` prints its answer if it is a no.
      say.info(
        order === 1
          ? `Releasing the ${kind} ${label} (new version; registered latest is ${reg.latest_version})…`
          : `Releasing the ${kind} ${label} (registered latest is ${reg.latest_version})…`
      )
      return {
        released: releaseFoundation(local, args, cliBin, say, client?.origin),
        proceed: true,
        ref: await pinnedRef()
      }
    }
  }

  // The registered version — but the digest differs, or the backend can't confirm it.
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
      // ⚖️ Not released: nothing says the code changed, and releasing on no evidence
      // would mint a version on every push against such a backend.
      say.dim(
        `Proceeding without re-releasing — to release a change, set a higher version in the ${kind}'s package.json.`
      )
      return { released: false, proceed: true, ref: await pinnedRef() }
    }
    const reRelease = await confirm(
      `Re-release ${label} to be sure its code is current?`,
      false
    )
    if (reRelease)
      return {
        released: releaseFoundation(local, args, cliBin, say, client?.origin),
        proceed: true,
        ref: await pinnedRef()
      }
    return { released: false, proceed: true, ref: await pinnedRef() }
  }

  // The code changed and the version did not. A registered version is immutable, so
  // the change is released under the next one.
  if (noRelease) {
    say.info(
      `Keeping the released ${kind} ${reg.latest_version} — your local changes are not released (\`--no-release\`).`
    )
    return { released: false, proceed: true, ref: registeredRef(reg) }
  }

  // ⭐ RELEASED BY DEFAULT — for a person and an agent alike, with no question.
  //
  // Until 2026-09-24 this stopped: a terminal was asked, a run without one refused, and
  // `--yes` shipped the REGISTERED code. That guarded against a site bound to code that
  // was not the working tree's — which is exactly what releasing prevents: the site is
  // bound to the code just released, as it is to the content pushed with it. `--yes`
  // has nothing left to consent to here, and a question whose answer is nearly always
  // yes teaches people to stop reading it.
  return releaseAsNext(`its code changed since ${reg.latest_version} was registered`, {
    optOut: true
  })
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
function releaseFoundation(local, args, cliBin, say, origin) {
  console.log('')
  // ⭐ Pinned to the parent's backend through the environment, so the release lands
  // where the publish goes by construction — not because two processes happen to read
  // the same session file the same way.
  execFileSync('node', [cliBin, 'register', ...forwardedFlags(args)], {
    cwd: local.dir,
    stdio: 'inherit',
    env: origin ? { ...process.env, UNIWEB_REGISTER_URL: origin } : process.env
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
