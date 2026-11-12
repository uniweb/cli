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
 *   2. BRINGS THE FOUNDATION ALONG — a local foundation is released when its
 *      version is not registered yet, and under the next patch (written into its
 *      package.json) when its code changed since that version was registered;
 *      unchanged code is not re-released, and a newer registered version stops
 *      the publish (`--bump`, `--no-release`). It asks only when the backend
 *      cannot say whether the code changed. A published registry ref needs
 *      nothing (§4, foundation-bring-along.js). *(This read "releases the new
 *      version first (or asks)" until 2026-10-16; changed code has been released
 *      without asking since 2026-09-24.)*
 *   3. SYNCS — builds the site data (link mode), uploads media, and pushes
 *      content (the same two-lane sync `uniweb push` uses);
 *   4. GOES LIVE — POST /dev/site/publish/{uuid}. When the backend answers 402
 *      (the site must be paid for first), it opens the settlement URL the
 *      backend hands over, verbatim, and stops; the content is already synced,
 *      so the author settles and runs publish again (payment-handoff.js).
 *
 * Distinct from `uniweb deploy` (third-party hosts) and `uniweb register`
 * (foundation code → catalog). For a self-contained artifact, see `uniweb export`.
 *
 * Backend: the one you are logged in to — UNIWEB_SERVER overrides it for a script
 *   (resolveBackendOrigin). Auth: UNIWEB_TOKEN  >  the stored session  >  `uniweb login`.
 *   No `--server` or `--token`: switching and signing in are `uniweb login`.
 *
 * Usage:
 *   uniweb publish                 Bring the foundation along, sync, and go live
 *   uniweb publish --dry-run       Resolve everything; POST nothing
 *   uniweb publish --yes           Skip confirmations (CI); never block on a prompt
 *   uniweb publish --force         Overwrite upstream app-side edits (drop the push gate)
 *   uniweb publish --commit [-m <message>]
 *                                  In a repository, commit the site's content first — a
 *                                  publish there sends only what is committed
 *   uniweb publish --org @org      Work in @org for this publish, instead of the
 *   uniweb publish --personal      workspace chosen at `uniweb login` (or your
 *                                  personal workspace). A site it creates is created
 *                                  — owned — there; a site in another workspace stops
 *                                  it.
 *   uniweb publish --no-save       Do not record this publish in deploy.yml
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { execSync } from 'node:child_process'
import yaml from 'js-yaml'

import {
  loadDeployYml,
  resolvePublishTarget,
  recordLastDeploy
} from '@uniweb/build/site'
import { emitSyncPackages } from '@uniweb/build/uwx'
import {
  bankLanguages,
  reconcile,
  announceServices,
  foundationSupports,
  recordsNotAsked
} from '../backend/service-request.js'
import { isSiteRelativeExtensionUrl } from '@uniweb/build'
import { resolveDefaultLocale } from '@uniweb/core/locale-config'

import {
  BackendClient,
  BackendUnreachableError,
  describeRequestError,
  WorkspaceMismatchError
} from '../backend/client.js'
import { DEFAULT_BACKEND_ORIGIN } from '../utils/config.js'
import { resolveSiteDir } from './deploy.js'
import { refuseIfContentDoesNotConform } from '../utils/conformance.js'
import { readFlagValue } from '../utils/args.js'
import { checkFlags } from '../utils/flag-guard.js'
import {
  syncedElsewhere,
  describeSyncedElsewhere
} from '../utils/site-identity.js'
import { isNonInteractive, confirm } from '../utils/interactive.js'
import { guardEmptyRecords, noteFolderLeftAlone, noteMovedRecords } from '../utils/records-guard.js'
import { settleRetiredRecords } from '../utils/retired-records.js'
import { findSiteCopies, describeSiteCopies } from '../utils/site-copies.js'
import { headProvenance } from '../utils/git.js'
import {
  makeModelResolver,
  readSyncCache,
  readBaseVersions,
  readItemBaseVersions,
  readHeldUnits,
  refuseChangedHeld,
  noteHeldLeftOut,
  ensureItemUuids,
  readFolderItemUuids,
  readRecordItemUuids,
  deploymentFields,
  ensureRegisteredFoundation,
  recoverUnbankedIdentity,
  keepTranslationsOfEdits,
  createSiteFromItsContent,
  refuseUnsendableRecords,
  clearRemoteSyncStateIfUnbound,
  untakenBase,
  unsettledFiles,
  commitWriteBacks,
  deployRecordAtRest,
  reportWriteBacks,
  pushSyncPackages,
  readSiteWorkspace,
  sentSiteDocument
} from '../backend/site-sync.js'
import { sentBlueprintNote } from '../backend/blueprint-reach.js'
import { repoOf } from '../utils/sync-point.js'
import { commitBeforeSending } from '../backend/commit-before-sending.js'
import { mountsBeforeSending } from '../backend/mounts-before-sending.js'
import { resolveWorkspace, describeWorkspace, previewWorkspace, SOURCE_LABEL } from '../backend/workspace.js'
import { uploadSiteMedia, describeAssetRefusal } from '../backend/site-media.js'
import { liveAddress } from '../backend/live-address.js'
import {
  updateBackendMap,
  readBackendState,
  carryServed,
  SYNC_STORE_FILE
} from '@uniweb/build/uwx'
import {
  bringFoundationAlong,
  filesAReleaseWrites,
  bringExtensionsAlong
} from '../backend/foundation-bring-along.js'
import {
  readPaymentRefusal,
  settleRefusal
} from '../backend/payment-handoff.js'

const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m'
}
const say = {
  ok: (m) => console.log(`${c.green}✓${c.reset} ${m}`),
  info: (m) => console.log(`${c.cyan}→${c.reset} ${m}`),
  warn: (m) => console.log(`${c.yellow}⚠${c.reset} ${m}`),
  err: (m) => console.error(`${c.red}✗${c.reset} ${m}`),
  dim: (m) => console.log(`  ${c.dim}${m}${c.reset}`)
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

// The backend's own sentences about a publish, for the person: what it changed (`applied`, a
// confirmed change or a reduction), then what it did not change and they should know (`notes`),
// such as something asked for that this deployment does not serve. The publish went through, so
// nothing else would say so.
export function publishSentences(result) {
  return [result?.applied, result?.notes]
    .flatMap((list) => (Array.isArray(list) ? list : []))
    .filter((line) => typeof line === 'string' && line)
}

// Languages from the BUILT site — the authority after a build: `config.languages` where
// the site declares them (three accepted shapes: 'en', { value, label }, { code, label }),
// else its default and each language the build produced (`dist/<locale>/site-content.json`).
// ⛔ Until 2026-09-26 a site that declares no `languages:` — its languages made by its
// translation files — went live as `['en']`, though the build had produced the others.
export function languagesFromContent(siteContent, distDir = null) {
  const langs = siteContent?.config?.languages
  if (Array.isArray(langs) && langs.length > 0) {
    return langs
      .map((l) => (typeof l === 'string' ? l : l?.value || l?.code))
      .filter(Boolean)
  }
  const source = siteContent?.config?.defaultLanguage || 'en'
  const built =
    distDir && existsSync(distDir)
      ? readdirSync(distDir, { withFileTypes: true })
          .filter((e) => e.isDirectory() && e.name !== source && existsSync(join(distDir, e.name, 'site-content.json')))
          .map((e) => e.name)
          .sort()
      : []
  return [source, ...built]
}

// Languages from site.yml — used only for the dry-run summary (no build yet).
function languagesFromSiteYml(siteYml) {
  // Legacy `lang:` still honored between defaultLanguage and the shared
  // `defaultLanguage || languages[0] || 'en'` rule.
  const def =
    siteYml.defaultLanguage || siteYml.lang || resolveDefaultLocale(siteYml)
  const locales = siteYml.i18n?.locales || siteYml.languages
  if (!Array.isArray(locales) || locales.length === 0) return null
  const norm = locales
    .map((l) => (typeof l === 'string' ? l : l?.value || l?.code))
    .filter(Boolean)
  return [def, ...norm.filter((l) => l !== def)]
}

// Persist the deploys memo in deploy.yml (skipped on --no-save / saveDeploys: false).
/**
 * A one-line, human-readable account of a service request, for a terminal.
 *
 * ⛔ Deliberately lossy — it names what is on and what is off, not a service's
 * opaque `config`. The owner is being told WHICH decision differs so they can go
 * look; reproducing a per-service config blob in a warning would bury that.
 * "nothing" is a real answer and reads better than an empty string.
 */
/**
 * A language selection, for a terminal.
 *
 * ⛔ An ABSENT selection is not an empty one, and the words have to keep them
 * apart: no `publishLanguages` key means every declared language is publishable,
 * while `[]` means explicitly none. "all of them" and "none" are opposite answers
 * and a bare empty string would read as either.
 */
function describeLanguages(value) {
  if (value === undefined || value === null) return 'all of them'
  if (!Array.isArray(value) || value.length === 0) return 'none'
  return value.join(', ')
}

/**
 * Languages the site was asked to publish that it did not publish.
 *
 * ⭐ THIS IS NOT COMPUTABLE FROM `site.yml`. The served set is decided where the
 * publish happens — a code naming no declared language is ignored rather than
 * refused, and the site's own declared set is whatever its last push left there,
 * which is not necessarily this file. So the only honest source is what the publish
 * reported back, and until now the CLI wrote that into `deploy.yml` and never
 * looked at it.
 *
 * ⛔ The failure it makes visible is the quiet one: an author believes their site
 * is live in three languages and it is live in two. Nothing errors, the publish
 * succeeds, and the missing locale is indistinguishable from one nobody asked for.
 *
 * Only the missing direction is reported. A site serving MORE than was asked is a
 * different question that nobody has, and inventing a message for it would be
 * machinery for a reason that does not exist.
 *
 * @param {string[]|null} asked - what this publish sent
 * @param {*} served - `locales` from the publish response
 * @returns {string[]} asked-for and not served, in the order asked
 */
export function unservedLanguages(asked, served) {
  if (!Array.isArray(asked) || !Array.isArray(served)) return []
  const got = new Set(served)
  return asked.filter((l) => !got.has(l))
}

async function persistLastDeploy(siteDir, opts) {
  if (opts.saveDeploys === false) return
  try {
    const result = await recordLastDeploy(siteDir, opts)
    if (result?.created)
      say.dim(`Wrote deploy.yml (target: ${opts.targetName})`)
  } catch (err) {
    // The publish itself succeeded — never fail the whole command on a
    // memo-write error. Surface it so the user can fix the file.
    say.dim(`Could not update deploy.yml: ${err.message}`)
  }
}

export async function publish(args = []) {
  // See utils/flag-guard.js — an unrecognized flag is invisible to a literal
  // scan, and for --backend the silent default can be production.
  const bad = checkFlags('publish', args)
  if (bad) {
    say.err(bad.message)
    return { exitCode: 2 }
  }
  const dryRun = args.includes('--dry-run')
  const noSave = args.includes('--no-save')
  const foundationDir = readFlagValue(args, '--foundation') // optional local foundation for Model schemas

  const siteDir = await resolveSiteDir(args, 'publish')

  // ⭐ A GATE, before anything is sent — the backend checks these records against the
  // schemas this publish registers. See utils/conformance.js.
  if (await refuseIfContentDoesNotConform(siteDir, { args, error: say.err, warn: say.warn, dim: say.dim })) {
    return { exitCode: 1 }
  }
  const siteYml = readSiteYml(join(siteDir, 'site.yml'))
  // ⭐ THE BACKEND YOU ARE LOGGED IN TO is where this goes *[Diego, 2026-09-21]*, for every
  // backend verb (resolveBackendOrigin). Only UNIWEB_SERVER — the automation
  // override — outranks it, and nothing talks to a backend the user is not logged in to:
  // logged in nowhere, the origin is the default backend and the first request asks for
  // that login. ⛔ There is no `--server` here: switching is `uniweb login --server`.
  // ⛔ The project's own record — its synced backend, deploy.yml's default target — routes
  // NOTHING. For part of 2026-09-21 it answered a "logged in nowhere" tier, which cannot
  // be reached: *"We do not allow any communication with backend if the user is not
  // logged into a backend."*

  const client = new BackendClient({
    args,
    command: 'Publishing'
  })

  // ⛔ A COPY OF ANOTHER PROJECT — before the foundation bring-along, the sync, or the
  // go-live. A plain directory copy carries sync.json, so it holds the ORIGINAL's site
  // on this backend and would publish over it (utils/site-copies.js). A publish is the
  // longest of these flows and the most expensive to unwind, so it is the one that
  // most benefits from failing at the first step rather than at the fifth.
  // *(The backend scope check that stood here went on 2026-09-20 — see push.js.)*
  {
    const copies = findSiteCopies(siteDir, client.origin)
    if (copies.length) {
      const said = describeSiteCopies(copies, client.origin, 'publish')
      say.err(said.headline)
      for (const line of said.lines) say.dim(line)
      return { exitCode: 1 }
    }
  }

  // ⚠️ Logged in to a backend where this project has no site, while it has one
  // elsewhere: following the login CREATES a second site. Say so before the owner
  // question, which otherwise arrives with no reason attached. Not when
  // UNIWEB_SERVER chose the backend — that is already a decision.
  if (!process.env.UNIWEB_SERVER) {
    const known = syncedElsewhere(siteDir, client.origin)
    if (known) {
      const [headline, ...rest] = describeSyncedElsewhere(known, client.origin, 'publish')
      say.info(headline)
      for (const line of rest) say.dim(line)
    }
  }

  // ⛔ The gated push publish rides claims a base only while the files hold it
  // (`untakenBase`) — said before anything reaches the backend, the foundation's release
  // included. `--force` drops the gate; a dry run does not preview it. ⛔ *Until 2026-10-17
  // it ran after the bring-along and the build, so a refused publish could release a local
  // foundation first.*
  // ⛔ Never a file in conflict — whatever the flags (`unsettledFiles`).
  const unsettled = unsettledFiles(siteDir)
  if (unsettled) {
    say.err(unsettled.headline)
    for (const line of unsettled.lines) say.dim(line)
    return { exitCode: 1 }
  }
  // ⛔ Pages mounted from a repository of their own go only as current: a pull never writes
  // into one, so the backend's gate cannot keep older ones from replacing newer
  // (`backend/mounts-before-sending.js`). `--mounts-as-is` sends them as they are.
  // ⛔ In a repository a publish sends what is committed (`uncommittedContent`), whatever the
  // flags. `--commit` commits it first; a dry run says it would.
  {
    const said = { success: say.ok, info: say.info, error: say.err, note: say.dim }
    const mounted = await mountsBeforeSending(siteDir, args, { verb: 'publish', dryRun, say: said })
    if (mounted) return mounted
    const stop = commitBeforeSending(siteDir, args, { verb: 'publish', dryRun, say: said })
    if (stop) return stop
  }
  if (!dryRun && !args.includes('--force')) {
    const untaken = untakenBase(siteDir, client.origin)
    if (untaken) {
      say.err(untaken.headline)
      for (const line of untaken.lines) say.dim(line)
      return { exitCode: 1 }
    }
  }

  // ⭐ THE WORKSPACE THIS PUBLISH WORKS IN — the one chosen with the login, unless this
  // command names another (`workspace.js`). Resolved up front: a first publish creates the site
  // in it (`createSiteFromItsContent`), and a site the backend keeps elsewhere is refused.
  const ws = await resolveWorkspace({ client, args, offline: dryRun })
  if (ws.refused) {
    say.err('This publish works in one workspace, and none is chosen.')
    say.dim(ws.reason)
    return { exitCode: 2 }
  }

  // ⛔ There is no capability gate here any more, deliberately.
  //
  // This used to read `delivery.publish` from the discovery document and refuse when it
  // was false. It could never fire: the backend sent a literal true for every deployment,
  // so the gate compared a constant against false. The key is now gone on both sides
  // (2026-08-30). Restoring a reader for it would re-create a check that cannot fail
  // while implying a capability that was never negotiable.
  //
  // Discovery is not consulted for a gate: the CLI reads the key lists under `siteContent`
  // (`queryFields`, `pageFields`, `settingsFields`), which say what the push below may SEND
  // (`deploymentFields`), never whether to publish. (`delivery.siteSubscriptionRequired`
  // was deleted 2026-08-30; this said it was still read, after the site create, until
  // 2026-09-26.)

  // ⛔ NOTHING about a runtime is sent from here. `site.yml::runtime` was a
  // vestigial prop and is no longer read [Diego, 2026-08-22]; `?runtime=` is no
  // longer a query param on publish. Do not reintroduce either.
  //
  // The chain is SITE → FOUNDATION → RUNTIME. A link-mode site is CODELESS: it
  // ships no JS, so it has nothing that binds to a runtime version and cannot
  // break when the runtime moves. Asking it to name one is not a hard question,
  // it is a malformed one. The party that binds is the FOUNDATION, whose build
  // externalizes react / react-dom / jsx-runtime / @uniweb/core — which is why
  // the compatibility floor rides on the foundation (`dist/runtime-pin.json` →
  // `info.runtime`, stated on every register) and never here. Whoever resolves a
  // whole site picks a runtime satisfying max() of the floors its foundation and
  // extensions declare, and fetches it from a CDN — the official mirror, the
  // distribution channel, or a local server. A backend never holds one.
  //
  // History, because each removal undid a different bad idea:
  //   • a local fallback to the highest version the backend reported installed —
  //     the producer guessing at a fact the control plane owns, and actively
  //     wrong once propagation moves sites (a walk advances a site to X; the
  //     next publish would restate a locally-computed value, silently undoing
  //     it). Removed in `6d32d94`.
  //   • fail-closed validation of a pin against `/dev/config`'s
  //     `runtime.installed`, and the `uniweb runtime register` verb that
  //     populated that field. Removed 2026-08-22 with the concept.
  //   • the pin itself, and the `?runtime=` it rode on. Removed 2026-08-22 —
  //     nothing scaffolded ever set it, it is in no public doc, and the backend
  //     may already have been ignoring it.

  // deploy.yml target (the Uniweb hosting memory) — the one for the backend this
  // publish goes to. ⭐ The target follows the backend, never the reverse: the default
  // target only breaks a tie (resolvePublishTarget). With no deploy.yml, or no target
  // naming this backend, persistLastDeploy adds one.
  //
  // ⛔ This took deploy.yml's DEFAULT target until 2026-09-21, whatever backend it was
  // publishing to — a publish to a second backend wrote over the default target's
  // record and compared its request against that target's fingerprint.
  let resolved
  let priorRequest = null
  try {
    const deployYml = await loadDeployYml(siteDir)
    resolved = resolvePublishTarget(deployYml, client.origin, {
      defaultBackend: DEFAULT_BACKEND_ORIGIN
    })
    // The language selection last sent TO THIS BACKEND, for its reconcile below. Read
    // from the SAME deploy.yml load — one read, and the memo is the only durable record
    // of it (see backend/service-request.js).
    priorRequest = deployYml?.deploys?.[resolved.targetName] || null
  } catch {
    // Malformed/ambiguous deploy.yml — don't block the publish on the memo.
    resolved = {
      targetName: 'production',
      host: 'uniweb',
      config: {},
      saveDeploys: true,
      fromFile: false
    }
  }
  const saveDeploys = !noSave && resolved.saveDeploys !== false

  // A SITE-RELATIVE extension URL cannot work on Uniweb hosting: the published
  // site ships no JS, so nothing serves that path. The request falls through to
  // the SPA shell and returns 200 with `text/html`, which `import()` then fails
  // to parse — and `loadExtensions` uses Promise.allSettled, so nothing throws
  // and every section the extension provides silently renders "Component not
  // found". A 200-with-HTML is strictly worse to debug than a 404 (the same
  // shape that forced the `/data/` carve-out at the edge), so fail here, at the
  // author's screen, rather than at a visitor's.
  //
  // `export` / `deploy --host` are unaffected — there the site serves its own
  // files and a relative URL is exactly right.
  const relativeExtensions = (
    Array.isArray(siteYml.extensions) ? siteYml.extensions : []
  )
    .map((e) => (e && typeof e === 'object' ? e.url || e.ref || e.name : e))
    .filter((d) => isSiteRelativeExtensionUrl(d))
  if (relativeExtensions.length) {
    say.err(
      `Site-relative extension URL${relativeExtensions.length > 1 ? 's' : ''} cannot be served by Uniweb hosting: ${relativeExtensions.join(', ')}`
    )
    say.dim(
      'A published site ships no JS, so nothing serves that path. An extension is a foundation —'
    )
    say.dim(
      'register it (`uniweb register` in the extension directory) and reference it by name or'
    )
    say.dim(
      '`@org/name@version` in site.yml::extensions, the same way the primary foundation is declared.'
    )
    say.dim(
      'Site-relative URLs keep working with `uniweb export` and `uniweb deploy --host=<adapter>`.'
    )
    return { exitCode: 1 }
  }

  if (dryRun) {
    const siteUuid = readBackendState(siteDir, client.origin).site?.uuid
    const preview = previewWorkspace(ws, siteUuid ? readSiteWorkspace(siteDir, client.origin) : null, 'publish')
    say.info('Dry run — would bring the foundation along, sync, and go live:')
    say.dim(`Backend     : ${client.origin}`)
    say.dim(`Workspace   : ${preview.workspace}`)
    say.dim(`site_uuid   : ${siteUuid || '(none — the site is created before anything uploads)'}`)
    const langs = languagesFromSiteYml(siteYml)
    if (langs) say.dim(`Languages   : ${langs.join(', ')}`)
    if (preview.warning) say.warn(preview.warning)
    await bringFoundationAlong({
      client,
      siteDir,
      siteYml,
      args,
      say,
      confirm,
      cliBin: process.argv[1],
      dryRun: true
    })
    await bringExtensionsAlong({
      client,
      siteDir,
      siteYml,
      args,
      say,
      confirm,
      cliBin: process.argv[1],
      dryRun: true
    })
    // No payment line on a dry run. The backend is the only gate and it
    // answers at go-live, so the honest dry-run answer is silence rather than
    // a guess. (The old "would check whether go-live needs payment" described
    // a pre-flight probe that has been removed — payment-handoff.js.)
    return { exitCode: 0 }
  }

  // What the release may write into local code, for the push to commit with what it writes.
  const released = await filesAReleaseWrites(siteDir, siteYml)

  // 1. Bring the foundation along — release the local foundation if its code
  //    changed (or isn't registered). Never ship a site pointing at stale code.
  let fnd
  try {
    fnd = await bringFoundationAlong({
      client,
      siteDir,
      siteYml,
      args,
      say,
      confirm,
      commits: released,
      cliBin: process.argv[1]
    })
  } catch (err) {
    // A backend that did not answer is said as that — not as a release that failed.
    if (err instanceof BackendUnreachableError) {
      say.err(err.message)
      say.dim('Nothing was released or sent. Check that the backend is running, then re-run `uniweb publish`.')
      return { exitCode: 1 }
    }
    // A scope you are not a member of is said as that, with the ways on (`explainReleaseFailure`).
    say.err(err.notMember ? err.message : `Foundation release failed: ${err.message}`)
    for (const line of err.notMember ? err.ways : ['Nothing was sent. Settle what the release said above, then re-run `uniweb publish`.']) say.dim(line)
    return { exitCode: 1 }
  }

  // 1b. Same for the site's LOCAL extensions. An extension is a foundation, so
  //     it gets the same freshness guarantee — otherwise a site could go live
  //     against stale extension code with nothing noticing.
  let ext
  try {
    ext = await bringExtensionsAlong({
      client,
      siteDir,
      siteYml,
      args,
      say,
      confirm,
      commits: released,
      cliBin: process.argv[1]
    })
  } catch (err) {
    say.err(err.notMember ? err.message : `Extension release failed: ${err.message}`)
    for (const line of err.notMember ? err.ways : ['Fix the extension, then re-run `uniweb publish`.']) say.dim(line)
    return { exitCode: 1 }
  }
  if (!ext.proceed) return { exitCode: 1 }
  // A human who answered "no" chose this, so it is not a failure — exit 0. A
  // REFUSAL is different: nobody was asked, nothing shipped, and the caller is
  // usually an agent that reads the exit code and reports done. Exit 0 there would
  // be the silent-wrong-success this whole branch exists to prevent.
  if (!fnd.proceed) return { exitCode: fnd.refused ? 1 : 0 }

  // ⭐ Every site request names the workspace — the create, the push, the publish and
  // the data lane — and a site outside it stops the publish (`WorkspaceMismatchError`).
  // A site this publish creates is created in it — said first.
  client.setWorkspace(ws.workspace, { source: ws.source })
  if (ws.source !== 'offline' && !readBackendState(siteDir, client.origin).site?.uuid) {
    say.dim(`This publish creates the site in ${describeWorkspace(ws.workspace)} (${SOURCE_LABEL[ws.source]}).`)
  }

  // 2. Build the site data (link mode): dist/site-content.json (+ per-locale),
  //    read back only for the languages to make live; the content itself goes
  //    over the sync wire, built from source. No compiled data files: every
  //    record has a data schema and a push sends it as an entity
  //    (`site/build-site-data.js`, "Does NOT emit"). No media is processed:
  //    step 4 uploads it from the site's own files. Spawn the SAME CLI binary
  //    so the inner build can't resolve to a different installed version.
  //
  //    ⛔ *This listed `dist/assets/*` until 2026-10-22; the link build has made
  //    no media copies since 2026-10-19 (`site/build-site-data.js`, "Does NOT
  //    emit").*
  //
  //    ⛔ NO SEARCH INDEX. This listed `dist/_search/*` until 2026-08-26; the
  //    link lane stopped emitting one on 2026-08-01 (`@uniweb/build`
  //    `site/build-site-data.js` step 5) because only one of the two
  //    publishers produced it.
  say.info('Building site…')
  console.log('')
  execSync(`node ${JSON.stringify(process.argv[1])} build --link`, {
    cwd: siteDir,
    stdio: 'inherit',
    env: process.env
  })
  console.log('')

  const distDir = join(siteDir, 'dist')
  const contentPath = join(distDir, 'site-content.json')
  if (!existsSync(contentPath)) {
    say.err('Build did not produce dist/site-content.json')
    return { exitCode: 1 }
  }

  // Non-local @std/registry Model schemas resolve through the backend (same as push).
  const resolveModel = makeModelResolver({ client, offline: false, siteDir })

  // ⛔ AN EMPTY RECORDS DIRECTORY REMOVES. It is the one path where an ordinary act
  // is destructive — a directory emptied by accident, or kept with only a
  // placeholder — so the count is reported and confirmed before anything is sent.
  //
  // ⛔ `backend` WAS MISSING HERE until 2026-09-21, and it is what the count is read
  // under: placements are banked per backend, so with none the guard counted zero
  // and never asked — `publish` sent an empty folder without a word while `push`
  // stopped for the same one.
  {
    const guard = await guardEmptyRecords({
      siteDir,
      backend: client.origin,
      args,
      warn: say.warn,
      note: say.dim
    })
    if (!guard.ok) return { exitCode: 1 }
  }

  // 3. A first emit: what the push will send, and what stops it before anything goes up —
  //    a record it cannot send, and a folder or query whose data schema resolves to nothing
  //    (`refusals`): every record has one [Diego, 2026-11-11]. ⛔ Until then such a query was
  //    "schema-less", and this step partitioned the queries so 4c could upload its compiled files.
  // ⭐ With the keys this deployment's Sections take (`deploymentFields`), as the push below
  // is: this emit says which files go up, and a key sent only where it is taken can name one —
  // `touch_icon` does. ⛔ Until 2026-10-28 it went without them, so a touch icon was sent as the
  // site path it was written as, and never uploaded.
  const fields = await deploymentFields({ client, siteDir })
  let probe
  try {
    probe = await emitSyncPackages(siteDir, {
      backend: client.origin,
      ...fields,
      // Placement identity for the folder — see writeFolderItemUuids.
      folderItemUuids: readFolderItemUuids(siteDir, client.origin),
      ...(foundationDir ? { foundationDir } : {}),
      resolveModel,
      // What a pull held, for a page that changed since to stop the publish before anything goes up.
      ...(args.includes('--force') ? {} : { heldUnits: readHeldUnits(siteDir, client.origin) })
    })
  } catch (err) {
    say.err(`Could not build the sync package: ${err.message}`)
    return { exitCode: 1 }
  }
  // A record the backend would refuse stops the publish HERE — before the site is
  // created or a byte uploaded, not merely before the send (`refuseUnsendableRecords`).
  if (refuseUnsendableRecords(probe.refusals, { error: say.err, note: say.dim })) {
    return { exitCode: 1 }
  }
  // …and so does a page a pull held whose files changed since (`refuseChangedHeld`).
  if (refuseChangedHeld(probe, { error: say.err, note: say.dim })) return { exitCode: 1 }
  const localAssets = probe.localAssets || []

  // 3a. A copy with no site uuid for this backend (`sync.json`) is bound to no site
  //     there, so every cached map that describes one is stale. `uniweb forget` clears
  //     the maps with the uuid; this catches a uuid gone any other way. Must run BEFORE
  //     the create, which mints a uuid and would make the copy look bound.
  const droppedState = clearRemoteSyncStateIfUnbound(siteDir, client.origin)
  if (droppedState.length) {
    say.dim(
      `Cleared stale sync state from a previous site (${droppedState.join(', ')}).`
    )
  }
  // publish rides the same gated push as `uniweb push`: if an app author has
  // edited since this clone last synced, the push is refused rather than
  // overwriting them, and nothing goes live. `--force` drops the precondition.
  const forced = args.includes('--force')
  let assetRewrite = null
  let assetIds = null
  // ⭐ THE PACKAGE AS THIS PUBLISH SENDS IT, read from this copy's state when it is built: once to
  // create the site (3b), and once to push it (5), after the media and the identity the create banked.
  const emitOptionsNow = async () => ({
    backend: client.origin,
    // The keys this deployment's Sections take — see deploymentFields.
    ...fields,
    // Placement identity for the folder — see writeFolderItemUuids.
    folderItemUuids: readFolderItemUuids(siteDir, client.origin),
    // Identity for the records' list items — see readRecordItemUuids.
    recordItemUuids: readRecordItemUuids(siteDir, client.origin),
    ...(foundationDir ? { foundationDir } : {}),
    resolveModel,
    priorHashes: readSyncCache(siteDir, client.origin),
    // Per-item identity, recovered from the backend when this clone has never seen it.
    // Without it the backend re-mints every page and section row (see readItemUuids).
    itemUuids: await ensureItemUuids({ client, siteDir, note: (m) => say.dim(m) }),
    ...(forced
      ? {}
      : {
          baseVersions: readBaseVersions(siteDir, client.origin),
          itemBaseVersions: readItemBaseVersions(siteDir, client.origin),
          // What a pull held is left out while its files still say it — see `uniweb push`.
          heldUnits: readHeldUnits(siteDir, client.origin)
        }),
    // Stamp the PINNED foundation ref (`@scope/name@version`) from the bring-along
    // on the site-content entity — the one key `injectInfo` carries since the
    // data-bundle URL went (2026-08-18). Delivery is version-pinned end-to-end (a
    // foundation is delivered only by a concrete version, agreed with backend and
    // measured end to end on 2026-06-25), so pinning the released version on the
    // wire is required when site.yml uses an unversioned local ref; injectInfo
    // overrides info.foundation. A registry/URL ref → fnd.ref is null → the
    // site.yml ref is forwarded verbatim (already pinned).
    // ⛔ DO NOT STAMP A FILE MAP INTO `info` HERE. `injectInfo` WINS the merge
    // (`sync-package.js`: `{...siteDoc.info, ...injectInfo}`), so any name stamped
    // here silently replaces what the author's document carries under it, and the
    // store validator accepts it — nothing errors at any layer. This was written
    // about `info.data`, which carried the site's `fetch:` block until 2026-09-09;
    // that moved to `settings.fetch`, and the warning holds for any name.
    //
    // A file map needs a name nothing else claims (`static_data` / `data_files`
    // were proposed) AND a consumer that reads it. Neither was settled, and since
    // 2026-11-11 no file of compiled data goes up at all: every record does.
    ...(fnd.ref ? { injectInfo: { foundation: fnd.ref } } : {}),
    ...(Object.keys(ext.pins).length ? { injectExtensions: ext.pins } : {}),
    ...(assetRewrite ? { assetRewrite } : {}),
    ...(assetIds ? { assetIds } : {})
  })
  const report = {
    info: (m) => say.info(m),
    note: (m) => say.dim(m),
    error: (m) => say.err(m),
    dim: (x) => `${c.dim}${x}${c.reset}`
  }
  // 3b. The site exists before a single byte is uploaded against it, and a first publish
  //     creates it FROM ITS CONTENT (`createSiteFromItsContent`): the backend takes the content
  //     or creates nothing, so a publish it refuses leaves no site and no uploaded bytes behind.
  //     Uploaded bytes are metered against an owning entity and freed by deleting it, so they go
  //     up only once it exists. A no-op once `sync.json` holds this backend's site uuid.
  //
  //     ⛔ Until 2026-11-09 this made an EMPTY site first (`POST /dev/site`). A content push the
  //     backend refused then left that site behind, empty, and this copy could not push again
  //     without `--force`. A test asserts the create precedes the upload.
  const site = await createSiteFromItsContent({
    client,
    siteDir,
    emit: async () => emitSyncPackages(siteDir, await emitOptionsNow()),
    report
  })
  if (!site.uuid) {
    say.dim('No media was uploaded.')
    reportWriteBacks(commitWriteBacks(siteDir, client.origin, { complete: false, released }), { note: say.dim })
    return { exitCode: 1 }
  }
  // What a first publish has sent by now, when an upload then fails: said, since it is not nothing.
  const sentSoFar = () =>
    site.created &&
    say.dim('The site was created with its content, which names its media by their local paths until a push uploads them.')

  // 4. Upload ALL local media on one asset lane → the ref→serveUrl map the content is
  //    rewritten with — and each file record's file (`@uniweb/file` — `{ ref, path,
  //    contentType }`, already located). ⛔ Until 2026-11-11 the compiled files of a query
  //    with no data schema were gathered first, for their records' media, and uploaded in 4c.
  const mediaRefs = [...new Set(localAssets), ...(probe.localFiles || [])]
  if (mediaRefs.length) {
    say.info('Uploading media…')
    try {
      const { map, ids, served, failed } = await uploadSiteMedia(
        client,
        siteDir,
        mediaRefs,
        {
          siteUuid: site.uuid,
          onProgress: (m) => say.dim(`  ${m}`),
          warn: (m) => say.dim(`! ${m}`),
          // What each picture was stored as, so an unchanged one is not prepared again.
          recorded: readBackendState(siteDir, client.origin).assets || {},
          // The pictures other software fetches (favicon, touch icon, card, social images): as they are.
          asIs: new Set(probe.outsideAssets || [])
        }
      )
      // A ref whose bytes did not land must NOT be published: the content would go
      // out still pointing at the local path, so the site ships a broken image and
      // the only trace is a warning nobody reads. A missing FILE is different —
      // already broken before us, warned above, and not worth blocking a publish.
      if (failed.length) {
        say.err(`${failed.length} asset(s) failed to upload — not publishing.`)
        for (const f of failed) say.dim(`  ${f.path} (HTTP ${f.status})`)
        sentSoFar()
        return { exitCode: 1 }
      }
      if (Object.keys(map).length) assetRewrite = map
      if (Object.keys(ids).length) assetIds = ids
      // Identity into the COMMITTED map — see backend/asset-map.js. Merge, not
      // replace: this publish carries only the refs its content touched.
      const rec = updateBackendMap(siteDir, client.origin, 'assets', ids, carryServed)
      if (rec.written) {
        say.dim(
          `${SYNC_STORE_FILE}   : ${rec.added.length} asset(s) added, ${rec.changed.length} changed` +
            // In a repository the publish commits it (`commitWriteBacks`).
            (repoOf(siteDir) ? '' : ' — commit it')
        )
      }
      say.dim(
        `Media          : ${Object.keys(map).length}/${mediaRefs.length - served.length} ref(s) → serve URL`
      )
    } catch (err) {
      // A typed plan refusal gets its own account (quota, per-file cap, plan caps);
      // anything else falls through to the raw message. Nothing has been pushed at
      // this point, so either way the site is untouched.
      const refusal = describeAssetRefusal(err)
      if (refusal) {
        say.err(refusal.headline)
        for (const line of refusal.notes) say.dim(line)
      } else {
        say.err(`Media upload failed: ${err.message}`)
      }
      sentSoFar()
      return { exitCode: 1 }
    }
  }

  // 5. Push the site (content + folder) over the send-only-changed cache —
  //    the SAME two-lane submission `uniweb push` uses — stamping
  //    the pinned foundation ref and rewriting local media refs to serve URLs.
  //    (It stamped `info.data_bundle` until 2026-08-18. ⛔ Until 2026-11-11 a step 4c
  //    sent the compiled files of the queries with no data schema, before this push:
  //    every record has a data schema since, and goes up with this push.)
  // ⭐ WHAT THE SITE HAS — read before the push, for the language selection. Only this
  // read sees a decision the owner made in the app since this clone last synced. It
  // reads this backend's site, from sync.json; a never-synced site has none.
  const boundUuid = readBackendState(siteDir, client.origin).site?.uuid || null
  const status = boundUuid ? await client.siteStatus(boundUuid) : null

  // ⭐ THE SERVICES are stated by the push itself — the file's, and off for each held
  // one it no longer lists (`statedServices`) — and the backend decides per service.
  // Said here: what the file asks that will not be sent as written.
  announceServices({ siteYml, say, supports: await foundationSupports(siteDir, siteYml) })

  // ⭐ THE LANGUAGE SELECTION IS A REQUEST TOO, and it is the one that costs.
  //
  // `publishLanguages` is a request like `services`: pushed up, projected back on
  // pull, stored on the other side. ⛔ Nothing over there deliberately rewrites it
  // today — which is why this was nearly skipped — but a base is not only for
  // detecting an overwrite. Without one, a selection that has always been in the
  // file cannot be told from one the owner just typed, and for languages that is a
  // charge: the line is billed on how many go out, so adding one costs money and
  // the owner should hear that from us before it is sent, not from a refusal after.
  if (status && !isNonInteractive(args)) {
    const langs = reconcile(
      siteYml.publishLanguages,
      status.publish_languages,
      priorRequest?.publishLanguagesRequest
    )
    if (langs.action === 'send') {
      const asked = siteYml.publishLanguages
      say.info(
        `You changed which languages this site publishes: ${describeLanguages(asked)}.`
      )
      // ⚖️ "may" — the count is what is priced, and only the backend prices it.
      // Framework says a charge is possible and never how much: this package is
      // public and holds no prices, and a number we invented would be wrong.
      say.dim('  Adding a language may cost more. You will be asked to confirm if so.')
    } else if (langs.action === 'adopt' || langs.action === 'conflict') {
      say.info('This site publishes different languages than site.yml lists.')
      say.dim(`  in site.yml:  ${describeLanguages(siteYml.publishLanguages)}`)
      say.dim(`  on your site: ${describeLanguages(status.publish_languages)}`)
    }
  }

  // A foundation named by catalog ref — a clone's: its kept registered version types a query named
  // for a data key (`ensureRegisteredFoundation`).
  await ensureRegisteredFoundation({
    client,
    siteDir,
    siteUuid: readBackendState(siteDir, client.origin).site?.uuid,
    ref: siteYml?.foundation
  })
  const emitOptions = await emitOptionsNow()
  let pkg
  try {
    pkg = await emitSyncPackages(siteDir, emitOptions)
    // Identity the backend holds and this copy lacks — see `uniweb push`.
    const again = await recoverUnbankedIdentity({ client, siteDir, pkg, note: (m) => say.dim(m) })
    if (again) pkg = await emitSyncPackages(siteDir, { ...emitOptions, ...again })
    if (await keepTranslationsOfEdits({ client, siteDir, pkg, note: (m) => say.dim(m) })) {
      pkg = await emitSyncPackages(siteDir, { ...emitOptions, ...again })
    }
  } catch (err) {
    say.err(`Could not build the sync package: ${err.message}`)
    return { exitCode: 1 }
  }
  for (const w of pkg.warnings) say.dim(`! ${w}`)
  // A folder this publish leaves alone while the backend's still holds records — see `uniweb push`.
  await noteFolderLeftAlone({ pkg, siteDir, backend: client.origin, note: (m) => say.dim(m) })
  noteMovedRecords({ pkg, siteDir, note: (m) => say.dim(m) })
  if (refuseUnsendableRecords(pkg.refusals, { error: say.err, note: say.dim })) {
    return { exitCode: 1 }
  }
  if (refuseChangedHeld(pkg, { error: say.err, note: say.dim })) return { exitCode: 1 }
  noteHeldLeftOut(pkg, { note: (m) => say.dim(m) })
  // ⭐ `records` is what delivers the records the pages show on the published site — said
  // here, at publish, and never at push: syncing records does not depend on it.
  const notAsked = recordsNotAsked({ siteYml, shown: pkg.recordsShown })
  if (notAsked) say.warn(notAsked)
  // ⭐ A CHANGED BLUEPRINT REACHES NO BACKEND ALREADY STARTED FROM THE SITE — judged by the status read
  // before the push, since this publish's go-live may start the site's first backend with what it
  // sends (`backend/blueprint-reach.js`).
  const blueprintNote = sentBlueprintNote({ status, sent: sentSiteDocument(pkg)?.services ?? null })
  const pushResult = await pushSyncPackages({
    client,
    siteDir,
    pkg,
    report
  })
  // What the push wrote into the files is committed, whatever became of the lanes.
  reportWriteBacks(commitWriteBacks(siteDir, client.origin, { complete: pushResult.complete, released }), { note: say.dim })
  if (pushResult.exitCode !== 0) return { exitCode: pushResult.exitCode }
  if (blueprintNote) {
    say.warn(blueprintNote[0])
    for (const line of blueprintNote.slice(1)) say.dim(line)
  }
  const siteUuid = pushResult.boundSiteUuid
  if (!siteUuid) {
    say.err('Push did not yield a site uuid — cannot go live.')
    return { exitCode: 1 }
  }

  // 7. Go live — make the just-pushed composite live (its current backend state).
  const siteContent = JSON.parse(await readFile(contentPath, 'utf8'))
  const languages = languagesFromContent(siteContent, dirname(contentPath))
  say.info(`Publishing to ${c.dim}${client.origin}${c.reset} …`)
  let pubRes
  try {
    pubRes = await client.publishSite(siteUuid, {
      ...(languages ? { languages } : {})
    })
  } catch (err) {
    say.err(describeRequestError(err, client.origin))
    if (!(err instanceof WorkspaceMismatchError))
      say.dim('Is that the backend you meant? Switch with: uniweb login --server <url>')
    return { exitCode: 1 }
  }
  // The body of a publish that did not go through — read once, and kept for the report below.
  let failedBody = ''
  if (!pubRes.ok) {
    failedBody = await pubRes.text().catch(() => '')

    // A 402 is the backend's payment gate — the ONLY gate, evaluated here on
    // every publish against whatever posture that deployment runs. It is a
    // refusal, not a fault: the content is already synced as a draft, so the
    // recovery is to settle and re-run. Give it the backend's own sentence
    // rather than the raw envelope — and when it offers a change the terminal
    // may confirm, ask, and publish again with the answer.
    const refusal = readPaymentRefusal({
      status: pubRes.status,
      contentType: pubRes.headers?.get?.('content-type') || '',
      body: failedBody
    })
    if (refusal.kind !== 'not-payment') {
      const settled = await settleRefusal({
        verdict: refusal,
        args,
        say,
        republish: (token, { unattended } = {}) =>
          client.publishSite(siteUuid, { ...(languages ? { languages } : {}), confirm: token, unattended })
      })
      if ('exitCode' in settled) return { exitCode: settled.exitCode }
      pubRes = settled.response
      failedBody = settled.body ?? ''
    }
  }
  if (!pubRes.ok) {
    say.err(`Publish rejected: HTTP ${pubRes.status} ${pubRes.statusText}`)
    if (pubRes.status === 401 || pubRes.status === 403) {
      say.dim(
        "Credentials weren't accepted — run `uniweb login` again."
      )
    }
    if (failedBody) say.dim(failedBody.slice(0, 800))
    return { exitCode: 1 }
  }
  let result
  try {
    result = await pubRes.json()
  } catch {
    result = {}
  }
  // Where the site went live — a finished, absolute address, taken verbatim: shown,
  // and recorded in deploy.yml, never composed onto. Until 2026-09-17 a backend
  // serving the site itself answered with an origin-relative path, which this
  // prefixed with our own origin; the reply is absolute now, so a path from an
  // older backend is simply shown as one.
  const serveUrl = typeof result.url === 'string' && result.url ? result.url : null
  // …and where its visitors go, which is what is shown: its custom domain while one is
  // active (`liveAddress`). The backend reads it on every publish and stores it nowhere, so
  // deploy.yml keeps the address this publish delivered to.
  const shownUrl = liveAddress(result.visitor_url, serveUrl)

  // 8. Persist deploy.yml memory — a record of what went live (and so a re-run
  //    reuses the resolved target without re-asking). Identity is sync.json's,
  //    per backend. `released` records whether this publish shipped a new
  //    foundation version (the bring-along, §4).
  // Record the ref that actually went live: the pinned `@scope/name@version`
  // from the bring-along when present, else the site.yml ref verbatim.
  const gitAt = headProvenance(siteDir)
  const siteYmlRef =
    typeof siteYml.foundation === 'string'
      ? siteYml.foundation
      : siteYml.foundation?.ref || null
  const recordedRef = fnd.ref || siteYmlRef
  const recordAtRest = deployRecordAtRest(siteDir)
  await persistLastDeploy(siteDir, {
    targetName: resolved.targetName,
    // A target this file does not have yet — the first publish anywhere (the whole
    // file is scaffolded), or the first to a backend no target names (the target is
    // added beside the others) — records the backend it went live on.
    targetConfig: resolved.fromFile
      ? null
      : { host: 'uniweb', backend: client.origin },
    saveDeploys,
    lastDeploy: {
      at: new Date().toISOString(),
      host: 'uniweb',
      // The language selection this publish sent — the base its reconcile compares
      // against next time. ⛔ A FINGERPRINT: the selection itself is in site.yml.
      ...bankLanguages(siteYml),
      // What was actually shipped. A version number can't answer that — two
      // publishes of "0.1.0" are not the same content — and after the fact the
      // working tree has moved on. `dirty` matters as much as the sha: it says the
      // publish did NOT correspond to any commit, so the sha alone would mislead.
      ...(gitAt ? { git: gitAt } : {}),
      backend: client.origin,
      siteUuid,
      url: serveUrl,
      foundation: {
        ...(recordedRef ? { ref: recordedRef } : {}),
        released: fnd.released
      },
      // No `runtime` here. `deploy.yml` records what this publish DID, and a
      // publish sends nothing about a runtime — the site's runtime follows from
      // its foundation's floor and is resolved by whoever serves it. Recording a
      // value would be a snapshot that silently goes stale, of a decision this
      // command does not make.
      // ⛔ WHAT WENT OUT, or nothing. This fell back to `languages` — what we
      // ASKED FOR — when the response carried no `locales`, which put two
      // different facts under one key with no way to tell them apart: a reader
      // could not distinguish "these were served" from "we asked for these and
      // were never told". `deploy.yml` records what a publish DID, and when we do
      // not know what it did, the honest record is silence.
      ...(Array.isArray(result.locales) ? { locales: result.locales } : {})
    }
  })
  // ⭐ The record is committed, as what a push writes is. ⛔ Until 2026-10-30 every publish left
  // `deploy.yml` changed, so a tree a person had committed was never clean after one.
  if (recordAtRest && saveDeploys) {
    const recorded = commitWriteBacks(siteDir, client.origin, { only: ['deploy.yml'], published: true })
    if (recorded?.error) reportWriteBacks(recorded, { note: say.dim })
  }

  console.log('')
  say.ok(
    `Published ${c.bold}${siteUuid}${c.reset}${result.status ? ` (${result.status})` : ''}`
  )
  for (const line of publishSentences(result)) say.info(line)

  // ⛔ SAY IT WHEN A LANGUAGE ASKED FOR DID NOT GO OUT.
  //
  // The publish succeeded, so nothing above this is wrong — and a site live in two
  // of the three languages its author listed looks exactly like a site live in the
  // two they wanted. That is the failure with no owner: the file and reality
  // disagree and the terminal is green.
  //
  // ⚖️ A warning, not a failure. The publish DID happen and the content IS live, so
  // exiting non-zero would tell a script the deploy failed when it did not.
  const unserved = unservedLanguages(languages, result.locales)
  if (unserved.length > 0) {
    say.warn(
      `Your site went live in ${(result.locales || []).join(', ')} — but not ${unserved.join(', ')}.`
    )
    say.dim(`  site.yml lists ${unserved.join(', ')}, and ${unserved.length === 1 ? 'it was' : 'they were'} not published.`)
  }
  if (shownUrl) console.log(`  ${c.cyan}${shownUrl}${c.reset}`)
  // ⛔ No site.yml write for where it went live. That is a fact about this deploy,
  // not about the site, and it is recorded where deploy facts live: deploy.yml's
  // `lastDeploy.<target>.url` (step 8 above). site.yml carried it as `$url` ⇄
  // `info.url` from 2026-09-10 until the field was retired on 2026-09-17.
  if (result.deploy_uuid) say.dim(`deploy: ${result.deploy_uuid}`)
  // ⭐ The records this publish's push took out of the site's folder: the CLI offers to delete them
  // from the backend (ruled 2026-11-04; `utils/retired-records.js`).
  await settleRetiredRecords({ client, siteDir, args, say })
  return { exitCode: 0 }
}

export default publish
