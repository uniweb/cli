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
 * Backend: BackendClient. Origin from --backend > UNIWEB_REGISTER_URL
 * > default. Auth: --token > UNIWEB_TOKEN > `uniweb login` session.
 *
 * Usage:
 *   uniweb publish                 Bring the foundation along, sync, and go live
 *   uniweb publish --dry-run       Resolve everything; POST nothing
 *   uniweb publish --yes           Skip confirmations (CI); never block on a prompt
 *   uniweb publish --force         Overwrite upstream app-side edits (drop the push gate)
 *   uniweb publish --org @org      Publish under @org (alias: --as-org). Only the
 *                                  FIRST publish of a site reads it — that create is
 *                                  what decides which org owns the site and whose
 *                                  storage its assets are charged to. It is then
 *                                  recorded as `site.yml::$org` and replayed, so it
 *                                  never has to be re-typed.
 *   uniweb publish --personal      Own the new site personally, deliberately. Sends
 *                                  NO `as_org` — byte-identical to the wire before
 *                                  the owner prompt existed. First publish only.
 *   uniweb publish --no-save       Skip the deploy.yml lastDeploy auto-save
 *   uniweb publish --backend <url> Override the backend origin
 *   uniweb publish --token <bearer> Auth bearer (skips `uniweb login`)
 */

import { existsSync, readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { execSync } from 'node:child_process'
import yaml from 'js-yaml'

import {
  loadDeployYml,
  resolveTarget,
  recordLastDeploy,
  collectSchemalessData,
  collectSchemalessDataAssets,
  rewriteSchemalessDataAssets
} from '@uniweb/build/site'
import { emitSyncPackages } from '@uniweb/build/uwx'
import {
  decideDeclaration,
  fingerprintRequest,
  reconcile,
  reconcileRequest
} from '../backend/service-request.js'
import { isSiteRelativeExtensionUrl } from '@uniweb/build'
import { resolveDefaultLocale } from '@uniweb/core/locale-config'

import { BackendClient } from '../backend/client.js'
import { resolveSiteDir, resolveSiteBackend } from './deploy.js'
import { warnIfContentDoesNotConform } from '../utils/conformance.js'
import { readFlagValue, readOrgFlag } from '../utils/args.js'
import { checkFlags } from '../utils/flag-guard.js'
import {
  assertSiteBackendScope,
  readSiteIdentity
} from '../utils/site-identity.js'
import { isNonInteractive, confirm } from '../utils/interactive.js'
import { guardEmptyRecords } from '../utils/records-guard.js'
import { headProvenance } from '../utils/git.js'
import {
  makeModelResolver,
  readSyncCache,
  readBaseVersions,
  readItemBaseVersions,
  ensureItemUuids,
  readFolderItemUuids,
  ensureSiteExists,
  clearRemoteSyncStateIfUnbound,
  dropSiteBoundValues,
  pushSyncPackages,
  resolveSiteOrgForCreate
} from '../backend/site-sync.js'
import { uploadSiteMedia, describeAssetRefusal } from '../backend/site-media.js'
import { updateAssetMap, ASSET_MAP_FILE } from '@uniweb/build/uwx'
import {
  bringFoundationAlong,
  bringExtensionsAlong
} from '../backend/foundation-bring-along.js'
import {
  readPaymentRefusal,
  reportPaymentRefusal
} from '../backend/payment-handoff.js'
import { reportSchemalessQueries } from '../utils/schemaless-report.js'
import {
  uploadSiteData,
  describeDataRefusal
} from '../utils/site-data-upload.js'

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

// Origin-relative serve path → clickable absolute URL.
//
// ⭐ THE TWO SHAPES ARE A CONTRACT, NOT AN INCONSISTENCY — ratified 2026-08-29 and
// documented in the backend's `wire-layer.md` rather than merely observed. A publish
// returns an ABSOLUTE url when Cloudflare hosts the site (another origin entirely)
// and an ORIGIN-RELATIVE path when the backend serves it itself, where its own
// external origin is not reliably self-reportable from behind an ALB.
//
// ⇒ So this branch is implementing the contract, not defending against drift. I
// reported the two shapes as a violation of "finished values only" in collab
// framework↔backend; the backend checked, found the adjacent ruling that
// explains the relative arm, and ratified both. Do not "fix" it by demanding one
// shape — the caller's own origin is the missing half on the relative arm, and we
// are the caller.
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
  return langs
    .map((l) => (typeof l === 'string' ? l : l?.value || l?.code))
    .filter(Boolean)
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

// Persist deploy.yml lastDeploy memory (skipped on --no-save / autoSave 'off').
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

function describeServices(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return 'nothing'
  return rows
    .map((r) => {
      const name = typeof r?.name === 'string' ? r.name : '?'
      // A row that omits `enabled` is an ask, not a refusal — the backend's three
      // states. Only an explicit `false` reads as off.
      return r?.enabled === false ? `${name} (off)` : name
    })
    .sort()
    .join(', ')
}

async function persistLastDeploy(siteDir, opts) {
  if (opts.autoSave === 'off') return
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

  // Advisory only — warns and ships. See utils/conformance.js for why this
  // is not a gate.
  await warnIfContentDoesNotConform(siteDir, { args })
  const siteYml = readSiteYml(join(siteDir, 'site.yml'))
  // The site's deploy.yml-bound backend (where it was published) feeds the
  // resolution ladder below an explicit --backend / UNIWEB_REGISTER_URL.
  // The project's own statement of where its identity lives. Feeds the origin ladder
  // ABOVE the session (see resolveBackendOrigin), so a teammate who cloned this project
  // targets the backend it is bound to instead of whatever they last logged into.
  // ⛔ The RAW value, never `resolveSiteScope` — null must mean "defer to the next tier".
  const siteScope = readSiteIdentity(siteDir).backend
  const siteBackend = await resolveSiteBackend(siteDir)

  const client = new BackendClient({
    originFlag:
      readFlagValue(args, '--backend'),
    siteScope,
    siteBackend,
    token: readFlagValue(args, '--token') || undefined,
    args,
    command: 'Publishing'
  })

  // ⛔ SCOPE CHECK — before the foundation bring-along, the sync, or the go-live. A
  // publish is the longest of these flows and the most expensive to unwind, so it is
  // the one that most benefits from failing at the first step rather than at the fifth.
  const scope = assertSiteBackendScope(siteDir, client.origin)
  if (!scope.ok) {
    say.err(scope.message)
    scope.hint.forEach(say.dim)
    return { exitCode: 1 }
  }

  // WHO will own this site, if this publish is the one that creates it. Resolved
  // up front: `ensureSiteExists` below is the create, and it must not be reached
  // with the question still open. An already-created site resolves to null without
  // asking — its ownership was settled once and cannot be changed from here.
  const org = await resolveSiteOrgForCreate({
    client,
    siteDir,
    args,
    flag: readOrgFlag(args),
    personal: args.includes('--personal'),
    offline: dryRun
  })
  if (org.refused) {
    say.err('Refusing to create this site without naming an owner.')
    say.dim(org.reason)
    return { exitCode: 2 }
  }
  const asOrg = org.asOrg

  // ⛔ There is no capability gate here any more, deliberately.
  //
  // This used to read `delivery.publish` from the discovery document and refuse when it
  // was false. It could never fire: the backend sent a literal true for every deployment,
  // so the gate compared a constant against false. The key is now gone on both sides
  // (2026-08-30). Restoring a reader for it would re-create a check that cannot fail
  // while implying a capability that was never negotiable.
  //
  // Discovery is not consulted on this path at all. The one leaf the CLI still reads
  // (`delivery.siteSubscriptionRequired`) is read after the site create, where a
  // credential is already in hand.

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

  // deploy.yml target (the Uniweb hosting memory). No --target on publish — it
  // always targets Uniweb hosting; resolveTarget gives us the target name +
  // autoSave for the lastDeploy memo.
  let resolved
  let priorRequest = null
  try {
    const deployYml = await loadDeployYml(siteDir)
    // No --target on publish — it always targets Uniweb hosting; resolveTarget
    // returns the uniweb default (fromFile:false) when there's no deploy.yml, so
    // persistLastDeploy scaffolds the file as the "where it's deployed" record.
    resolved = resolveTarget(deployYml, null)
    // The last request we are known to have sent, for the declaration gate below.
    // Read from the SAME deploy.yml load — one read, and the memo is the only
    // durable record of it (see backend/service-request.js for why not the cache).
    priorRequest =
      deployYml?.lastDeploy?.[resolved?.targetName] ||
      deployYml?.lastDeploy?.uniweb ||
      null
  } catch {
    // Malformed/ambiguous deploy.yml — don't block the publish on the memo.
    resolved = {
      targetName: 'production',
      host: 'uniweb',
      config: {},
      autoSave: 'lastDeploy',
      fromFile: false
    }
  }
  const autoSave = noSave ? 'off' : resolved.autoSave || 'lastDeploy'

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
    say.info('Dry run — would bring the foundation along, sync, and go live:')
    say.dim(`Backend     : ${client.origin}`)
    say.dim(
      `site_uuid   : ${siteYml.$uuid || '(none — the site is created before anything uploads)'}`
    )
    const langs = languagesFromSiteYml(siteYml)
    if (langs) say.dim(`Languages   : ${langs.join(', ')}`)
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
      cliBin: process.argv[1]
    })
  } catch (err) {
    say.err(`Foundation release failed: ${err.message}`)
    say.dim('Fix the foundation, then re-run `uniweb publish`.')
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
      cliBin: process.argv[1]
    })
  } catch (err) {
    say.err(`Extension release failed: ${err.message}`)
    say.dim('Fix the extension, then re-run `uniweb publish`.')
    return { exitCode: 1 }
  }
  if (!ext.proceed) return { exitCode: 1 }
  // A human who answered "no" chose this, so it is not a failure — exit 0. A
  // REFUSAL is different: nobody was asked, nothing shipped, and the caller is
  // usually an agent that reads the exit code and reports done. Exit 0 there would
  // be the silent-wrong-success this whole branch exists to prevent.
  if (!fnd.proceed) return { exitCode: fnd.refused ? 1 : 0 }

  // 2. Build the site data (link mode): dist/site-content.json (+ per-locale),
  //    dist/data/*, dist/assets/*. Spawn the SAME CLI binary so the inner
  //    build can't resolve to a different installed version.
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
  const resolveModel = makeModelResolver({ client, offline: false })

  // ⛔ AN EMPTY `records.yml` REMOVES. It is the one path where an ordinary act is
  // destructive — a placeholder file, created meaning to fill it in — so the count
  // is reported and confirmed before anything is sent.
  {
    const guard = await guardEmptyRecords({
      siteDir,
      args,
      warn: say.warn,
      note: say.dim
    })
    if (!guard.ok) return { exitCode: 1 }
  }

  // 3. Partition collections by schema presence (a first emit reads `schemaless`
  //    — collections with no data schema, delivered statically via the ball).
  let probe
  try {
    probe = await emitSyncPackages(siteDir, {
      // Placement identity for the folder — see writeFolderItemUuids.
      folderItemUuids: readFolderItemUuids(siteDir),
      // Resolves a foundation-relative `@/x` model ref into `@org/x`.
      ...(asOrg ? { org: asOrg } : {}),
      ...(foundationDir ? { foundationDir } : {}),
      resolveModel
    })
  } catch (err) {
    say.err(`Could not build the sync package: ${err.message}`)
    return { exitCode: 1 }
  }
  const schemalessNames = (probe.schemaless || []).map((col) => col.name)
  // A product decision the author is usually making unknowingly — say it at warn
  // level, not dim among everything else. See the helper for what the old
  // message got wrong.
  reportSchemalessQueries(probe.schemaless, say)
  const localAssets = probe.localAssets || []

  // 3a. A clone with no `$uuid` is bound to no backend site, so every cached map
  //     that describes one is stale — including after the documented "clear
  //     `$uuid` to re-publish as a new site" recovery. Must run BEFORE the create,
  //     which mints a uuid and would make the clone look bound.
  const droppedState = clearRemoteSyncStateIfUnbound(siteDir)
  if (droppedState.length) {
    say.dim(
      `Cleared stale sync state from a previous site (${droppedState.join(', ')}).`
    )
  }
  const droppedValues = dropSiteBoundValues(siteDir)
  if (droppedValues.length) {
    say.dim(
      `Dropped the previous site's ${droppedValues.join(' and ')} from site.yml.`
    )
  }

  // 3b. Make sure the SITE EXISTS before a single byte is uploaded.
  //
  //     Uploaded bytes are metered against an owning entity and reclaimed by
  //     deleting it. Uploading before the site exists therefore produces bytes
  //     that are charged and can never be freed — there is nothing to delete —
  //     so a repeatedly-failing first publish would burn quota with no recovery
  //     short of support. Creating the site first makes the artifact of a failed
  //     publish an EMPTY SITE instead: it costs nothing to keep and the owner can
  //     clear it. A no-op once `$uuid` is set, so only a first publish pays.
  //
  //     This ordering is load-bearing, not incidental — the asset plan requires an
  //     owner. A test asserts the create precedes the upload.
  const site = await ensureSiteExists({
    client,
    siteDir,
    name: siteYml.name,
    foundation: fnd.ref || siteYml.foundation,
    asOrg,
    note: (m) => say.dim(m)
  })
  if (!site.uuid) {
    say.err(`Could not create the site on the backend: ${site.reason}`)
    say.dim('Nothing was uploaded and nothing was charged.')
    return { exitCode: 1 }
  }

  // 4. Assemble the static-data ball (schema-less data + search index) BEFORE
  //    uploading, since its records can carry local media too.
  let ball = await collectSchemalessData(distDir, schemalessNames)
  const ballAssets = collectSchemalessDataAssets(ball)

  // 4b. Upload ALL local media (entity refs + ball refs) on one asset lane →
  //     the ref→serveUrl map; rewrite the entity content AND the ball with it.
  let assetRewrite = null
  let assetIds = null
  const mediaRefs = [...new Set([...localAssets, ...ballAssets])]
  if (mediaRefs.length) {
    say.info('Uploading media…')
    try {
      const { map, ids, failed } = await uploadSiteMedia(
        client,
        siteDir,
        mediaRefs,
        {
          siteUuid: site.uuid,
          onProgress: (m) => say.dim(`  ${m}`),
          warn: (m) => say.dim(`! ${m}`)
        }
      )
      // A ref whose bytes did not land must NOT be published: the content would go
      // out still pointing at the local path, so the site ships a broken image and
      // the only trace is a warning nobody reads. A missing FILE is different —
      // already broken before us, warned above, and not worth blocking a publish.
      if (failed.length) {
        say.err(`${failed.length} asset(s) failed to upload — not publishing.`)
        for (const f of failed) say.dim(`  ${f.path} (HTTP ${f.status})`)
        return { exitCode: 1 }
      }
      if (Object.keys(map).length) assetRewrite = map
      if (Object.keys(ids).length) assetIds = ids
      // Identity into the COMMITTED map — see backend/asset-map.js. Merge, not
      // replace: this publish carries only the refs its content touched.
      const rec = updateAssetMap(siteDir, ids)
      if (rec.written) {
        say.dim(
          `${ASSET_MAP_FILE}   : ${rec.added.length} added, ${rec.changed.length} changed — commit it`
        )
      }
      if (ballAssets.length) ball = rewriteSchemalessDataAssets(ball, map)
      say.dim(
        `Media          : ${Object.keys(map).length}/${mediaRefs.length} ref(s) → serve URL`
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
      return { exitCode: 1 }
    }
  }

  // 4c. Deliver the schema-less collection data — one object per file.
  //
  //     Each `dist/data/**` file is PUT to the target `data-uploads` returns,
  //     landing at its serving tail. Hosting intercepts `/data/**.json` and
  //     reads `_data/{tail}` from the site bucket, so the file is served from
  //     where it lands: **nothing records where anything went**, and no `info`
  //     field is stamped.
  //
  //     ⛔ NO BALL. A CLI sends separates or a ball, never both — presence of a
  //     ball is the backend's signal for which CLI it is talking to, and
  //     sending both destroys it along with their ability to know when the
  //     unwrap can be deleted. Released CLIs keep sending one and their unwrap
  //     keeps serving them; this one does not.
  //
  //     📌 No capability gate, deliberately. A backend predating this lane
  //     answers 404 and the publish fails — accepted while pre-prod [Diego,
  //     2026-08-18: "we are pre-prod. I'm not concerned about old cli vs new"].
  //     A gate was written and removed: it is machinery for a population that
  //     does not exist, which is the failure this work kept catching in others.
  //     `client.discover()` is the mechanism if that changes — `DISCOVERY_DEFAULTS`
  //     makes an absent key non-breaking by construction.
  //
  // ⛔ UNCONDITIONAL — `if (ball)` was here until 2026-09-01 and it was the bug.
  //
  //     `collectSchemalessData` returns null for an empty set, so a publish that
  //     carried no schema-less data sent NO PLAN AT ALL. The backend reconciles a
  //     site's data usage against this manifest, and a request that never arrives
  //     is not a manifest saying "none" — it is silence, indistinguishable from a
  //     publish that never happened. So deleting your LAST schema-less collection
  //     — the exact operation the reconcile exists to make free — was the one
  //     operation that could not be expressed, and the site kept paying for it
  //     until the whole site was deleted.
  //
  // ⭐ The general shape, worth more than the fix: an EMPTY set and NO set are
  //    different statements, and an `if (x)` guard collapses them into one. The
  //    cost is always paid by whoever is downstream trying to tell them apart.
  //
  // Both halves agreed in channel backend↔framework (2026-09-01); the
  // backend's route accepts an empty `files` array as of the same exchange.
  say.info('Uploading schema-less record data…')
  try {
    const r = await uploadSiteData({
      apiBase: client.origin,
      token: await client.token(),
      siteUuid: site.uuid,
      ball,
      onProgress: (m) => say.dim(`  ${m}`)
    })
    if (r.failed.length) {
      // A file whose bytes did not land must not be published: the site would
      // serve a stale copy or 404, and the only trace would be a warning.
      say.err(
        `${r.failed.length} data file(s) failed to upload — not publishing.`
      )
      for (const f of r.failed) say.dim(`  ${f.path} (HTTP ${f.status})`)
      return { exitCode: 1 }
    }
    say.dim(`Record data     : ${r.uploaded.length} file(s) [${r.mode}]`)
  } catch (err) {
    // A typed plan refusal gets its own account (quota, or whatever else the
    // backend names); anything else falls through to the raw message. Same
    // treatment the asset plan and the site create already get — this was the
    // last door still printing the problem document at the user verbatim.
    const refusal = describeDataRefusal(err)
    if (refusal) {
      say.err(refusal.headline)
      for (const line of refusal.notes) say.dim(line)
    } else {
      say.err(`Record data upload failed: ${err.message}`)
    }
    return { exitCode: 1 }
  }

  // 5. Push the site (content + folder) over the send-only-changed cache —
  //    the SAME two-lane submission `uniweb push` uses — stamping
  //    the pinned foundation ref and rewriting local media refs to serve URLs.
  //    (It stamped `info.data_bundle` until 2026-08-18; the ball is gone and
  //    collection data now lands at its serving tail, so nothing records it.)
  const priorHashes = readSyncCache(siteDir)
  // publish rides the same gated push as `uniweb push`: if an app author has
  // edited since this clone last synced, the push is refused rather than
  // overwriting them, and nothing goes live. `--force` drops the precondition.
  const baseVersions = args.includes('--force')
    ? null
    : readBaseVersions(siteDir)
  // Per-item identity, recovered from the backend when this clone has never seen it.
  // Without it the backend re-mints every page and section row (see readItemUuids).
  const itemUuids = await ensureItemUuids({
    client,
    siteDir,
    note: (m) => say.dim(m)
  })
  // Stamp deploy-derived info on the site-content entity: the data-bundle URL,
  // and the PINNED foundation ref (`@scope/name@version`) from the bring-along.
  // Delivery is version-pinned end-to-end (the gateway serves a foundation only
  // by a concrete version — collab framework↔backend), so pinning the
  // released version on the wire is required when site.yml uses an unversioned
  // local ref; injectInfo overrides info.foundation. A registry/URL ref → fnd.ref
  // is null → the site.yml ref is forwarded verbatim (already pinned).
  // ⛔ DO NOT STAMP `info.data` HERE. The name is TAKEN: `uwx/site.js` already
  // emits `info.data` from `site.yml`'s top-level `data:`/`fetch:` block, and
  // `injectInfo` WINS the merge (`sync-package.js`: `{...siteDoc.info,
  // ...injectInfo}`), so stamping a file map here silently replaces the author's
  // fetch config on the wire. Both are `type: json`, so the store validator
  // accepts either and nothing errors at any layer.
  //
  // A file map needs a name nothing else claims (`static_data` / `data_files`
  // were proposed) AND a consumer that reads it — neither settled. See
  // one object per file, no bundle.
  const injectInfo = {
    ...(fnd.ref ? { foundation: fnd.ref } : {})
  }
  // ⛔ IS THE FILE ASKING FOR ANYTHING BY ITS `$services` / `$secrets` BLOCK?
  //
  // The blocks ride inside the site-content document, so without this gate every
  // push re-sends them — and the backend REPLACES what it is sent. A paragraph
  // edit would therefore overwrite whatever the stored request has become, which
  // in the consent workflow is a decision the owner made in the app. Under "the
  // file is a request", an unchanged block is not asking for anything.
  //
  // ⚠️ The residual window, stated because it is real and narrow: the base is
  // banked at publish, so a request changed in the app BETWEEN a `uniweb pull` and
  // the next publish is not seen — the pulled block reads as unchanged-from-nothing
  // and is declared. It closes when the status route carries the stored request
  // (backend is adding it) and we compare against theirs instead of our memory.
  //
  // ⭐ ASK THE BACKEND rather than trusting our memory, when it will tell us. The
  // banked fingerprint says what WE last sent; the status read says what the site
  // actually has. Only the second one sees a change made in the app, which is where
  // the consent workflow's decisions happen — so this is what closes the window
  // between a `uniweb pull` and the next publish.
  //
  // ⚖️ Degrades to the banked comparison on any failure — an older backend, a
  // network blip, a site never pushed. That is the shipped behaviour and it is safe:
  // it withholds an unchanged block and sends a changed one; it merely cannot see
  // the app's side.
  let declaration = decideDeclaration(siteYml, priorRequest)
  let adopted = null
  // Before the push, so a never-synced site has no uuid and simply skips this.
  const status =
    typeof siteYml.$uuid === 'string' && siteYml.$uuid
      ? await client.siteStatus(siteYml.$uuid)
      : null
  if (status && Array.isArray(status.services)) {
    const r = reconcileRequest(siteYml, status.services, priorRequest)
    if (r.action === 'none') {
      declaration = { declare: false, reason: 'in-sync' }
    } else if (r.action === 'send') {
      declaration = { declare: true, reason: 'changed' }
    } else if (r.action === 'adopt') {
      // The owner decided in the app and this file is simply behind. Nothing to
      // ask for, so nothing is sent — and the file can be brought in line, which
      // is offered rather than done, because site.yml is theirs.
      declaration = { declare: false, reason: 'adopt' }
      adopted = status.services
    } else {
      // ⛔ CONFLICT — both moved. Withhold and SAY SO. Not a stop: the content
      // publish is a separate thing the owner asked for, and blocking it over a
      // services disagreement couples two unrelated intents. Not a guess either;
      // the request stays in their file, unsent, and they are told.
      declaration = { declare: false, reason: 'conflict' }
      adopted = status.services
    }
  }

  // ⛔ EVERY STRING BELOW IS FOR A SITE OWNER, NOT FOR US.
  //
  // "request", "declaration", "send", "adopt", "reconcile" are how this file
  // MODELS the problem and they are the wrong words to say out loud: an author
  // does not think they are sending a request, they think they want their site to
  // have search. Say services, on and off, site.yml and your site. The internal
  // vocabulary stays in the code and the comments, where it earns its precision.
  //
  // ⭐ THE OWNER IS THE ONLY ONE WHO CAN RANK TWO OF THEIR OWN INTENTS.
  //
  // `conflict` means the file and the site both moved since we last agreed, so
  // neither is "the" request. ⛔ Withholding silently and saying "edit site.yml"
  // is advice that CANNOT WORK: with no banked base the file has nothing to move
  // relative to, so editing it produces the same conflict forever. That shipped
  // for one commit. Asking is the only thing that resolves it.
  if (declaration.reason === 'conflict') {
    say.warn('Your site\'s services were changed elsewhere, and site.yml changed too.')
    say.dim(`  in site.yml:  ${describeServices(siteYml.$services)}`)
    say.dim(`  on your site: ${describeServices(adopted)}`)
    if (isNonInteractive(args)) {
      say.dim('  Left your site as it is — run without --non-interactive to choose.')
    } else if (await confirm('Use the services listed in site.yml?', false)) {
      declaration = { declare: true, reason: 'resolved-send' }
      adopted = null
    } else {
      // Declining to send is not yet a decision to take theirs, so this falls
      // through to the offer below and "neither, leave it alone" stays available.
      declaration = { declare: false, reason: 'adopt' }
    }
  }

  // ⭐ THE SAME QUESTION FOR THE LANGUAGE SELECTION, and it is the one that costs.
  //
  // `publishLanguages` is a request like `$services`: pushed up, projected back on
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

  if (declaration.reason === 'adopt' && adopted) {
    // ⚖️ Deliberately says WHAT differs, not WHO moved. The usual cause is a
    // decision made in the app — but the same state follows a request of ours the
    // site refused, where nothing of theirs changed and ours simply did not take.
    // We cannot tell those apart here, so the wording claims neither.
    say.info('Your site has different services than site.yml lists.')
    say.dim(`  in site.yml:  ${describeServices(siteYml.$services)}`)
    say.dim(`  on your site: ${describeServices(adopted)}`)
    // ⭐ OFFERED, NEVER DONE. site.yml is the owner's file, and a publish that
    // silently rewrites an authored file is the surprise this seam exists to
    // avoid. Default No, and declining costs nothing: the site is already
    // correct, only the file is behind, and the offer returns next publish.
    //
    // ⚖️ A DECLINED conflict reaches here too, and that is deliberate — having
    // been asked which they meant and said "not mine", taking the site's is the
    // other half of the same question, not a silent overwrite of an edit.
    if (!isNonInteractive(args) && (await confirm('Update site.yml to match?', false))) {
      const { writeSiteConfig } = await import('@uniweb/build/uwx')
      writeSiteConfig(siteDir, { $services: adopted })
      // Keep the in-memory copy in step, or the deploy.yml bank below records the
      // file as it WAS and the offer repeats forever.
      siteYml.$services = adopted
      say.ok('site.yml updated.')
    }
  } else if (!declaration.declare && declaration.reason !== 'adopt') {
    say.dim('Services unchanged.')
  }

  let pkg
  try {
    pkg = await emitSyncPackages(siteDir, {
      ...(declaration.declare ? {} : { declareServices: false }),
      // Placement identity for the folder — see writeFolderItemUuids.
      folderItemUuids: readFolderItemUuids(siteDir),
      // Resolves a foundation-relative `@/x` model ref into `@org/x`.
      ...(asOrg ? { org: asOrg } : {}),
      ...(foundationDir ? { foundationDir } : {}),
      resolveModel,
      priorHashes,
      itemUuids,
      ...(baseVersions
        ? { baseVersions, itemBaseVersions: readItemBaseVersions(siteDir) }
        : {}),
      ...(Object.keys(injectInfo).length ? { injectInfo } : {}),
      ...(Object.keys(ext.pins).length ? { injectExtensions: ext.pins } : {}),
      ...(assetRewrite ? { assetRewrite } : {}),
      ...(assetIds ? { assetIds } : {})
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
    dim: (s) => `${c.dim}${s}${c.reset}`
  }
  const pushResult = await pushSyncPackages({
    client,
    siteDir,
    pkg,
    asOrg,
    report
  })
  if (pushResult.exitCode !== 0) return { exitCode: pushResult.exitCode }
  const siteUuid = pushResult.boundSiteUuid
  if (!siteUuid) {
    say.err('Push did not yield a site uuid — cannot go live.')
    return { exitCode: 1 }
  }

  // 7. Go live — make the just-pushed composite live (its current backend state).
  const siteContent = JSON.parse(await readFile(contentPath, 'utf8'))
  const languages = languagesFromContent(siteContent)
  say.info(`Publishing to ${c.dim}${client.origin}${c.reset} …`)
  let pubRes
  try {
    pubRes = await client.publishSite(siteUuid, {
      ...(languages ? { languages } : {})
    })
  } catch (err) {
    say.err(`Could not reach the backend at ${client.origin}: ${err.message}`)
    say.dim('Set the origin with --backend <url> or UNIWEB_REGISTER_URL.')
    return { exitCode: 1 }
  }
  if (!pubRes.ok) {
    const body = await pubRes.text().catch(() => '')

    // A 402 is the backend's payment gate — the ONLY gate, evaluated here on
    // every publish against whatever posture that deployment runs. It is a
    // refusal, not a fault: the content is already synced as a draft, so the
    // recovery is to settle and re-run. Give it the backend's own sentence
    // rather than the raw envelope.
    const refusal = readPaymentRefusal({
      status: pubRes.status,
      contentType: pubRes.headers?.get?.('content-type') || '',
      body
    })
    if (refusal.kind !== 'not-payment') {
      await reportPaymentRefusal({ verdict: refusal, args, say })
      return { exitCode: 1 }
    }

    say.err(`Publish rejected: HTTP ${pubRes.status} ${pubRes.statusText}`)
    if (pubRes.status === 401 || pubRes.status === 403) {
      say.dim(
        "Credentials weren't accepted — run `uniweb login` (or pass --token <bearer>)."
      )
    }
    if (body) say.dim(body.slice(0, 800))
    return { exitCode: 1 }
  }
  let result
  try {
    result = await pubRes.json()
  } catch {
    result = {}
  }
  const serveUrl = absolutizeServeUrl(client.origin, result.url)

  // 8. Persist deploy.yml memory — a record of what went live (and so a re-run
  //    reuses the resolved target without re-asking). One identity:
  //    site.yml::$uuid. `released` records whether this publish shipped a new
  //    foundation version (the bring-along, §4).
  // Record the ref that actually went live: the pinned `@scope/name@version`
  // from the bring-along when present, else the site.yml ref verbatim.
  const gitAt = headProvenance(siteDir)
  const siteYmlRef =
    typeof siteYml.foundation === 'string'
      ? siteYml.foundation
      : siteYml.foundation?.ref || null
  const recordedRef = fnd.ref || siteYmlRef
  await persistLastDeploy(siteDir, {
    targetName: resolved.targetName,
    // First publish scaffolds deploy.yml with the backend recorded on the
    // target, binding the site to where it went live (uniweb.app, or a B2B
    // backend). resolveSiteBackend reads it back on later publishes.
    targetConfig: resolved.fromFile
      ? null
      : { host: 'uniweb', backend: client.origin },
    autoSave,
    lastDeploy: {
      at: new Date().toISOString(),
      host: 'uniweb',
      // The request this publish is known to have sent — the base the declaration
      // gate compares against next time. ⛔ A FINGERPRINT, never the block:
      // deploy.yml is committed, `$secrets` carries secret material and a
      // service's `config` is opaque, so recording either verbatim would write
      // them into git. Absent when the file declares no block.
      ...(declaration.declare
        ? fingerprintRequest(siteYml)
        : {
            // Nothing was sent, so the base is unchanged — carry it forward
            // rather than dropping it, or the next publish would read "no record"
            // and declare.
            ...(priorRequest?.servicesRequest
              ? { servicesRequest: priorRequest.servicesRequest }
              : {}),
            ...(priorRequest?.secretsRequest
              ? { secretsRequest: priorRequest.secretsRequest }
              : {})
          }),
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

  console.log('')
  say.ok(
    `Published ${c.bold}${siteUuid}${c.reset}${result.status ? ` (${result.status})` : ''}`
  )

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
  if (serveUrl) console.log(`  ${c.cyan}${serveUrl}${c.reset}`)
  // ⛔ No site.yml write for where it went live. The backend records the reply's
  // `url` on `info.url` at every publish, and pull brings it into `site.yml::$url`
  // like any other key. A copy written here was a second writer that had to match
  // the backend's byte for byte (the address printed above is made absolute, so it
  // did not), and it left site.yml modified — which a plain `pull` refuses over.
  if (result.deploy_uuid) say.dim(`deploy: ${result.deploy_uuid}`)
  return { exitCode: 0 }
}

export default publish
