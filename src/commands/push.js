/**
 * uniweb push — push a site to the backend over its two directional lanes:
 *   - content lane → `@uniweb/site-content` (the static half: pages, sections,
 *     layout, theme, foundation ref, extensions, collection decls);
 *   - folder lane → one `@uniweb/folder` + the collection-record entities it
 *     references (the dynamic half; the `$ref` closure rides together).
 *
 * Each entity is an entity-content document (`$id` + `$schema` + sections). The site's
 * identity on a backend is its site-content uuid, in that backend's section of
 * `sync.json`. A first push to a backend has none — it CREATEs the site (uuid-less),
 * the backend mints + adopts it and returns the new uuid, which `push` records in
 * `sync.json`. Later pushes
 * UPDATE by that uuid. The folder lane is keyed by the SAME site-content uuid —
 * the backend owns the site's `@uniweb/folder`, so the framework never holds a
 * folder uuid. Records still round-trip their own `$uuid`
 * (back-filled into their source files). site-content items carry a per-item `$uuid`
 * too, stamped at emit from `sync.json` rather than from author files — without
 * it the backend reads every record as new and recreates every page and section row.
 * Push-only, and gated on the backend's per-entity `version`
 * (see "Pushes are GATED by default" below); `--force` restores last-push-wins.
 *
 * Order: content first (CREATE or UPDATE — the site must exist before its folder),
 * then the folder, keyed by the site's uuid. On a brand-new site the backend creates
 * the folder on its first folder push for that uuid.
 *
 * `uniweb login && uniweb push`. Run from a site, or a workspace with one site.
 *
 * Usage:
 *   uniweb push                          Build, push both lanes, back-fill $uuid
 *   uniweb push --org @org               Work in @org for this push, instead of the
 *   uniweb push --personal               workspace chosen at `uniweb login` (or your
 *                                        personal workspace). A site this push creates
 *                                        is created — owned — there; a site the backend
 *                                        keeps in another workspace stops the push.
 *   uniweb push --dry-run                Report what would be pushed; submit nothing
 *   uniweb push -o out.uwx               Write the .uwx file(s) per lane; submit nothing
 *   uniweb push --foundation <dir>       Use this local foundation for the Model schema
 *   uniweb push --all                    Send every record (bypass the changed-only cache)
 *   uniweb push --force                  Overwrite upstream changes (drop the staleness gate)
 *
 * Pushes are GATED by default: each entity carries the backend `version` this clone
 * last saw (a top-level `base_version` on the manifest entry), and the backend refuses the whole package
 * atomically — before any write — if its stored version has moved. That prevents a
 * developer who hasn't pulled from silently destroying an app author's edits (the
 * backend's reconcile deletes items absent from the package, so an author's NEW page
 * would be hard-deleted). `--force` omits the token and restores last-push-wins.
 *
 * Backend: the one you are logged in to — UNIWEB_REGISTER_URL overrides it for a script
 *   (resolveBackendOrigin). Auth: UNIWEB_TOKEN  >  the stored session  >  `uniweb login`.
 *   No `--backend` or `--token`: switching and signing in are `uniweb login`.
 *
 * The two-lane SUBMISSION (POST both lanes, back-fill uuids, persist the
 * send-only-changed cache) lives in `../backend/site-sync.js` so `uniweb publish`
 * (the composite path) reuses the exact same logic. This command owns flag parsing,
 * the emit, and the `-o`/`--dry-run` preview.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import yaml from 'js-yaml'
import { emitSyncPackages, readBackendState } from '@uniweb/build/uwx'
import { findSiteCopies, describeSiteCopies } from '../utils/site-copies.js'
import { uploadSiteMedia, describeAssetRefusal } from '../backend/site-media.js'
import { updateBackendMap, carryServed, SYNC_STORE_FILE } from '@uniweb/build/uwx'
import { BackendClient } from '../backend/client.js'
import { resolveSiteDir } from './deploy.js'
import { warnIfContentDoesNotConform } from '../utils/conformance.js'
import { reportSchemalessQueries } from '../utils/schemaless-report.js'
import { checkFlags } from '../utils/flag-guard.js'
import {
  syncedElsewhere,
  describeSyncedElsewhere
} from '../utils/site-identity.js'
import { confirm } from '../utils/interactive.js'
import { guardEmptyRecords } from '../utils/records-guard.js'
import { bringFoundationAlong } from '../backend/foundation-bring-along.js'
import {
  makeModelResolver,
  readSyncCache,
  readBaseVersions,
  readItemBaseVersions,
  readItemUuids,
  readFolderItemUuids,
  readQueryUuids,
  ensureItemUuids,
  refuseUnsendableRecords,
  ensureSiteExists,
  clearRemoteSyncStateIfUnbound,
  dropSiteBoundValues,
  pushSyncPackages
} from '../backend/site-sync.js'
import { resolveWorkspace, describeWorkspace, SOURCE_LABEL } from '../backend/workspace.js'

// Re-exported for downstream importers (pull.js, push.test.js) that read these
// helpers from this module — their canonical home is now ../backend/site-sync.js.
export {
  extractMintedSiteUuid,
  makeModelResolver
} from '../backend/site-sync.js'

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[36m'
}
const log = console.log
const success = (m) => log(`${colors.green}✓${colors.reset} ${m}`)
const error = (m) => console.error(`${colors.red}✗${colors.reset} ${m}`)
const info = (m) => log(`${colors.blue}→${colors.reset} ${m}`)
const note = (m) => log(`  ${colors.dim}${m}${colors.reset}`)
const warn = (m) => log(`${colors.yellow}\u26a0${colors.reset} ${m}`)

function flagValue(args, name) {
  const eq = args.find((a) => a.startsWith(`${name}=`))
  if (eq) return eq.slice(name.length + 1)
  const i = args.indexOf(name)
  if (i !== -1 && args[i + 1] && !args[i + 1].startsWith('-'))
    return args[i + 1]
  return null
}

export async function push(args = [], deps = {}) {
  // An unrecognized flag is invisible to a literal scan, so it silently keeps the
  // default — including for --backend, where the default can be production.
  //
  // `sync` validates the UNION of its two halves' flags and forwards raw argv, so a
  // legal `uniweb sync --no-git` would be rejected here. It passes `skipFlagCheck`.
  if (!deps.skipFlagCheck) {
    const bad = checkFlags('push', args)
    if (bad) {
      error(bad.message)
      return { exitCode: 2 }
    }
  }
  const dryRun = args.includes('--dry-run')
  const output = flagValue(args, '-o') || flagValue(args, '--output')
  const foundationDir = flagValue(args, '--foundation')
  const sendAll = args.includes('--all') // bypass the send-only-changed cache
  // --force drops the optimistic-concurrency precondition, making the push
  // unconditional (the backend then falls back to its `collision` policy). It is
  // deliberately NOT "send collision=force": when a base_version is present the
  // backend consults it and never looks at `collision`, so forcing has to mean
  // OMITTING the token — the HTTP If-Match idiom.
  const force = args.includes('--force')

  const siteDir = await resolveSiteDir(args, 'push')

  // Advisory only — warns and pushes. A malformed data block otherwise rides
  // the sync wire unchecked; see utils/conformance.js.
  await warnIfContentDoesNotConform(siteDir, { args })
  // ⭐ THE BACKEND YOU ARE LOGGED IN TO is where this goes *[Diego, 2026-09-21]*, for every
  // backend verb (resolveBackendOrigin). Only UNIWEB_REGISTER_URL — the automation
  // override — outranks it, and nothing talks to a backend the user is not logged in to:
  // logged in nowhere, the origin is the default backend and the first request asks for
  // that login. ⛔ There is no `--backend` here: switching is `uniweb login --backend`.
  // ⛔ The project's own record — its synced backend, deploy.yml's default target — routes
  // NOTHING. For part of 2026-09-21 it answered a "logged in nowhere" tier, which cannot
  // be reached: *"We do not allow any communication with backend if the user is not
  // logged into a backend."*
  // One front door. The bearer is resolved lazily on first need (a non-local Model
  // read during the build, or the submit). Offline emit (--dry-run / -o) is fully
  // offline: it never submits, and its Model resolver never reads from the backend
  // (the `offline` flag below), so it never authenticates — even when a collection
  // references a Model the local foundation doesn't define.
  const client = new BackendClient({
    args,
    command: 'Syncing'
  })

  // ⛔ A COPY OF ANOTHER PROJECT — before anything is sent. A plain directory copy
  // carries sync.json, so it holds the ORIGINAL's site on this backend and its push
  // would update that site (see utils/site-copies.js for why the signal is exact).
  // Refused, not warned: a warning printed while the push goes ahead is printed over
  // the damage. Runs after the client so it checks the RESOLVED origin.
  //
  // ⚠️ NOT for `-o`, which is a LOCAL EMIT and reaches no backend at all — there is no
  // site for it to update, and refusing would break an operation this command keeps
  // offline (the `!output && !dryRun` guards below are the same rule).
  //
  // `--dry-run` IS checked, and the asymmetry is the point: a dry run previews a real
  // push, so when that push would be refused, saying so is the honest preview.
  //
  // *(This spot held the backend SCOPE CHECK, `assertSiteBackendScope`, until
  // 2026-09-20 — deleted when identity became per-backend and a foreign backend's
  // uuids stopped being reachable at all.)*
  if (!output) {
    const copies = findSiteCopies(siteDir, client.origin)
    if (copies.length) {
      const said = describeSiteCopies(copies, client.origin, 'push')
      error(said.headline)
      for (const line of said.lines) note(line)
      return { exitCode: 1 }
    }
  }

  // ⚠️ Logged in to a backend where this project has no site, while it has one
  // elsewhere: following the login CREATES a second site. Say so before the owner
  // question, which otherwise arrives with no reason attached. Not for `-o` (nothing is
  // created) and not when UNIWEB_REGISTER_URL chose the backend — that is a decision.
  if (!output && !process.env.UNIWEB_REGISTER_URL) {
    const known = syncedElsewhere(siteDir, client.origin)
    if (known) {
      const [headline, ...rest] = describeSyncedElsewhere(known, client.origin, 'push')
      info(headline)
      for (const line of rest) note(line)
    }
  }

  // ⭐ THE WORKSPACE THIS PUSH WORKS IN — the one chosen with the login, unless this
  // command names another (`workspace.js`). Resolved before any lane runs: a site this
  // push creates is created in it, and a site the backend keeps elsewhere is refused.
  const ws = await resolveWorkspace({ client, args, offline: !!output || dryRun })
  if (ws.refused) {
    error('This push works in one workspace, and none is chosen.')
    note(ws.reason)
    return { exitCode: 2 }
  }

  // Bring the foundation along — BEFORE any asset upload, because an upload is
  // chargeable and a push that aborts after one has spent the user's money for
  // nothing.
  //
  // ⭐ Why push and not just publish. [Diego, 2026-08-19] — *"A published site can
  // only reference a registered foundation … In fact, not even a push can, because
  // we can't preview the site in the frontend in that case."* Push is the
  // collaboration verb: a teammate opens the site in the visual app right after,
  // and the app can only render against foundation code the backend can serve. So
  // storing an unregistered ref does not merely defer a problem to publish — it
  // hands the teammate a site that cannot render, which is where they meet it.
  //
  // `fnd.ref` is the pinned `@scope/name@version`, stamped onto the wire below.
  // That also makes push and publish agree about the document they emit; until now
  // push sent the authored string and publish sent the pinned ref, so the two saw
  // each other's pushes as changes.
  const siteYml = (() => {
    try {
      return yaml.load(readFileSync(join(siteDir, 'site.yml'), 'utf8')) || {}
    } catch {
      return {}
    }
  })()
  const say = {
    ok: success,
    info,
    warn,
    err: error,
    dim: note
  }
  let fnd = { ref: null }
  try {
    fnd = await bringFoundationAlong({
      client,
      siteDir,
      siteYml,
      args,
      say,
      confirm,
      cliBin: process.argv[1],
      // An offline emit reports what it WOULD do and touches no network; the ref
      // still comes back (read from the foundation's package.json) so the preview
      // matches what a real push sends — EXCEPT for a foundation never yet
      // registered, which has no scope to form a ref from until the first release
      // writes one. See the dry-run branch in foundation-bring-along.js.
      dryRun: !!output || dryRun,
      verb: 'push'
    })
  } catch (err) {
    error(`Foundation release failed: ${err.message}`)
    note('Fix the foundation, then re-run `uniweb push`.')
    return { exitCode: 1 }
  }
  if (!fnd.proceed) return { exitCode: 1 }

  // ⭐ Every site request names the workspace; a site outside it stops the push
  // (`WorkspaceMismatchError`). A site this push creates is created in it — said first.
  client.setWorkspace(ws.workspace, { source: ws.source })
  if (ws.source !== 'offline' && !readBackendState(siteDir, client.origin).site?.uuid) {
    note(`This push creates the site in ${describeWorkspace(ws.workspace)} (${SOURCE_LABEL[ws.source]}).`)
  }

  // Build BOTH directional packages (the producer side). Each carries its own
  // `index` — the per-entity source-file map for back-fill, correlated by submission
  // position. Non-local Models are fetched from the registry on demand. `priorHashes`
  // (the .uniweb push-cache) drives "send only changed" across both lanes; --all bypasses.
  // ⛔ DROP STALE REMOTE STATE FIRST — this must precede the hash read below, and it
  // did not until 2026-08-19.
  //
  // The guard itself is right and its docblock names this exact outcome: on a clone
  // whose `$uuid` was cleared to re-publish as a new site — WHICH IS OUR OWN
  // DOCUMENTED RECOVERY — send-only-changed would "skip every entity whose content
  // had not changed since the OLD site's last push, so the NEW site would come up
  // missing exactly the content that did not change." It was defeated twice over:
  //
  //   · it ran AFTER `readSyncCache`, so the emit still diffed against the old
  //     site's hashes even though the file on disk had just been emptied;
  //   · it sat inside `if (mediaRefs.length)`, so a site with no local images never
  //     reached it at all.
  //
  // Measured 2026-08-19 against a live uniwebd: clearing `$uuid` and pushing created
  // the new site and pulled back **0 pages, 0 sections**. Successful exit, empty site,
  // nothing to indicate it — the failure the guard was written to prevent.
  //
  // Still skipped for an offline emit: `-o` / `--dry-run` must not mutate project state.
  if (!output && !dryRun) {
    const dropped = clearRemoteSyncStateIfUnbound(siteDir, client.origin)
    if (dropped.length) {
      note(
        `Cleared stale sync state from a previous site (${dropped.join(', ')}).`
      )
    }
    const stale = dropSiteBoundValues(siteDir, client.origin)
    if (stale.length) {
      note(`Dropped the previous site's ${stale.join(' and ')} from site.yml.`)
    }
  }
  const priorHashes = readSyncCache(siteDir, client.origin)
  // Per-item identity, without which the backend reads every record as new and
  // recreates every page and section row.
  //
  // An offline preview (`-o` / `--dry-run`) still stamps from the CACHE — that is a
  // local file read, so it stays offline, and it keeps the emitted `.uwx` faithful
  // to what a real push would send. Only the network RECOVERY is skipped, so a
  // preview never reaches the backend. (Emitting `{}` here instead would make the
  // preview quietly unrepresentative, which is the one thing `-o` exists to avoid.)
  // Local media rides the SAME asset lane `publish` uses, and it rides it FIRST.
  //
  // Push is the collaboration verb: a teammate opens the site in the visual app
  // right after it. Content that still points at `/images/hero.png` — bytes the
  // backend never received — shows them a broken image, which is precisely what
  // push exists to avoid. `publish` uploaded and rewrote; push dropped
  // `localAssets` on the floor.
  //
  // The upload runs before `ensureItemUuids`, and the reason once recorded here —
  // "BEFORE `ensureItemUuids`, which mints uuids on the backend, so a refusal
  // leaves nothing minted" — is FALSE. `ensureItemUuids` mints nothing: it reads a
  // local map, and if that is empty it reads this backend's site uuid from sync.json
  // and returns immediately when there is none (the first-push case). Its only backend call is
  // a GET (`pullSiteContent`); its only write is a local file. So this ordering is
  // not protecting what that comment claimed, and is under review — an upload is a
  // durable, metered write, which makes uploading first the thing that leaves bytes
  // behind when a later step fails.
  //
  // The probe emit runs WITHOUT `priorHashes`, so it surfaces every local ref
  // rather than only the changed ones. That is not waste — the lane is
  // content-addressed with a `present` skip-list, so unchanged bytes are a no-op
  // PUT. It is also what makes the storage rule fall out of the mechanism instead
  // of needing a special case: a content-only push adds no new stored content, so
  // a quota has nothing to refuse. Only a push that genuinely ADDS bytes can be
  // blocked.
  //
  // Two claims live here and only ONE is a guarantee, per the backend's asset
  // accounting model:
  //   - "moves zero bytes" is the COMMON CASE, not a property. `present` is an
  //     optimization: a failed presence probe degrades to all-absent, so unchanged
  //     bytes may be re-PUT. It is never a false positive, so skipping stays safe.
  //   - "is never refused for storage" IS a property, because metering is
  //     IDEMPOTENT per (workspace, asset) and recorded at PLAN time. Presenting an
  //     asset already on this workspace's books charges nothing, so a push that
  //     changes only content meters nothing and cannot be refused.
  //
  // ⚠️ "unchanged bytes skip the transfer" is TRUE. "…and are therefore FREE" is
  // NOT — do not write it into a message, a summary, or a comment. Every upload is
  // chargeable; deduplication is the backend's storage optimization, not the user's
  // discount, so an asset another workspace already uploaded comes back
  // `present: true`, never PUTs, and is STILL charged to this one. What is free is
  // copying URLs around (duplicating a site, a snapshot, a backup).
  //
  // Consequently `needed_bytes` = "assets not yet on this workspace's books", which
  // can be NON-ZERO with zero transfers — so a push can print no `↑` line at all and
  // still be refused. A refusal message must talk about assets new to the workspace,
  // never "the files being uploaded", and must not size itself from what moved.
  //
  // Two framings were proposed and WITHDRAWN in-channel; do not reintroduce either:
  // "charged on distinct stored content", and "the quota fails open on a
  // presence-probe failure" (retired — `needed_bytes` reads the ledger, not the
  // probe, so the property no longer depends on that error path behaving).
  //
  // It also has to be this emit that carries `assetRewrite` below: the push cache
  // stores hashes of the REWRITTEN content, so the emit compared against it must
  // rewrite too, or every entity reads as changed forever.
  // ⛔ AN EMPTY RECORDS DIRECTORY REMOVES. It is the one path where an ordinary act
  // is destructive — a directory emptied by accident, or kept with only a
  // placeholder — so the count is reported and confirmed before anything is sent.
  // The format stays honest; the asking happens here.
  if (!dryRun) {
    const guard = await guardEmptyRecords({ siteDir, backend: client.origin, args, warn, note })
    if (!guard.ok) return { exitCode: 1 }
  }

  let assetRewrite = null
  let assetIds = null
  if (!output && !dryRun) {
    let mediaRefs = []
    let refusals = []
    try {
      const probe = await emitSyncPackages(siteDir, {
      backend: client.origin,
      // Placement identity for the folder — see writeFolderItemUuids.
      folderItemUuids: readFolderItemUuids(siteDir, client.origin),
        ...(foundationDir ? { foundationDir } : {}),
        resolveModel: makeModelResolver({ client, offline: false })
      })
      mediaRefs = probe.localAssets || []
      refusals = probe.refusals || []
    } catch (err) {
      error(`Could not scan the site for local media: ${err.message}`)
      return { exitCode: 2 }
    }
    // A record the backend would refuse stops the push HERE — before the site is
    // created or a byte uploaded, not merely before the send (`refuseUnsendableRecords`).
    if (refuseUnsendableRecords(refusals, { error, note })) return { exitCode: 1 }
    if (mediaRefs.length) {
      // The site has to exist before its bytes do — an upload with no owning
      // entity is charged and cannot be freed, because freeing means deleting the
      // owner. A no-op once `$uuid` is set, so only a never-synced site pays.
      // ⛔ The PINNED ref, not site.yml's. The create is a THIRD writer of this
      // value — the emit below stamps it via `injectInfo`, publish passes it here,
      // and push did neither until 2026-08-19: it sent the authored alias (`src`),
      // which names a foundation no deployment can resolve. A site created that way
      // keeps the bad ref, and the backend's create guard now refuses it outright
      // (channel backend↔framework, their measurement).
      //
      // ⭐ Same shape as the send-only-changed defect fixed this morning, and missed
      // for the same reason: the rule was applied at the writers under discussion and
      // a third caller of the same value was never enumerated.
      const site = await ensureSiteExists({
        client,
        siteDir,
        note,
        ...(fnd.ref ? { foundation: fnd.ref } : {})
      })
      if (!site.uuid) {
        error(`Could not create the site on the backend: ${site.reason}`)
        note('Nothing was uploaded and nothing was charged.')
        return { exitCode: 1 }
      }
      info('Uploading media…')
      try {
        const { map, ids, failed } = await uploadSiteMedia(
          client,
          siteDir,
          mediaRefs,
          {
            siteUuid: site.uuid,
            onProgress: (m) => note(`  ${m}`),
            warn: (m) => note(`! ${m}`)
          }
        )
        // Bytes that did not land must not be pushed around: the content would go
        // up still naming the local path, so the teammate sees the broken image
        // this whole change exists to prevent, and the only trace is a warning. A
        // missing FILE is a different thing — already broken before us, warned by
        // the uploader, and not worth blocking a push over.
        if (failed.length) {
          error(
            `${failed.length} asset(s) failed to upload — nothing was pushed.`
          )
          for (const f of failed) note(`  ${f.path} (HTTP ${f.status})`)
          return { exitCode: 1 }
        }
        if (Object.keys(map).length) assetRewrite = map
        if (Object.keys(ids).length) assetIds = ids
        note(
          `${Object.keys(map).length}/${mediaRefs.length} media ref(s) → serve URL`
        )
        // Record identity in the COMMITTED map. Merge, never replace: this push
        // carries only the refs its content touched.
        const rec = updateBackendMap(siteDir, client.origin, 'assets', ids, carryServed)
        if (rec.written) {
          note(
            `${SYNC_STORE_FILE}: ${rec.added.length} asset(s) added, ${rec.changed.length} changed — commit it`
          )
        }
      } catch (err) {
        // Typed plan refusals get their own account. Note the storage one must not
        // be phrased from what moved — see describeAssetRefusal's rule 1; a push can
        // print no `↑` line at all and still be refused.
        const refusal = describeAssetRefusal(err)
        if (refusal) {
          error(refusal.headline)
          for (const line of refusal.notes) note(line)
        } else {
          error(`Media upload failed: ${err.message}`)
        }
        return { exitCode: 1 }
      }
    }
  }

  const itemUuids =
    output || dryRun
      ? readItemUuids(siteDir, client.origin)
      : await ensureItemUuids({ client, siteDir, note })
  let pkg
  try {
    pkg = await emitSyncPackages(siteDir, {
      backend: client.origin,
      // Placement identity for the folder — see writeFolderItemUuids.
      folderItemUuids: readFolderItemUuids(siteDir, client.origin),
      // Identity for the `queries` section — see readQueryUuids. Keyed by
      // name, because a declaration has no file for a path-keyed map to hold.
      queryUuids: readQueryUuids(siteDir, client.origin),
      ...(foundationDir ? { foundationDir } : {}),
      resolveModel: makeModelResolver({
        client,
        offline: Boolean(output) || dryRun
      }),
      priorHashes,
      sendAll,
      itemUuids,
      // The PINNED foundation ref from the bring-along above, stamped over the
      // authored `site.yml` string. Delivery is version-pinned end to end, so an
      // unpinned local name on the wire names code no host can serve. Absent when
      // the site already references a registry ref or URL — then site.yml's own
      // value rides verbatim.
      ...(fnd.ref ? { injectInfo: { foundation: fnd.ref } } : {}),
      // Both grains are dropped together by --force: one flag, one meaning,
      // no partial-force mode.
      ...(force
        ? {}
        : {
            baseVersions: readBaseVersions(siteDir, client.origin),
            itemBaseVersions: readItemBaseVersions(siteDir, client.origin)
          }),
      ...(assetRewrite ? { assetRewrite } : {}),
      ...(assetIds ? { assetIds } : {})
    })
  } catch (err) {
    error(`Could not build the sync package: ${err.message}`)
    return { exitCode: 2 }
  }
  const { siteContent, records, siteContentUuid, warnings, skipped } = pkg
  log('')
  for (const w of warnings) note(`! ${w}`)
  // The same stop for the paths the probe above does not run on — `-o` and
  // `--dry-run` say what a push would do, and a push would stop here.
  if (refuseUnsendableRecords(pkg.refusals, { error, note })) return { exitCode: 1 }
  // Warn level, not dim: this is the author choosing entities vs static files.
  reportSchemalessQueries(pkg.schemaless, { warn, dim: note })

  const totalEntities =
    (siteContent?.entityCount || 0) + (records?.entityCount || 0)

  // Nothing changed since the last push — the backend is already up to date.
  if (totalEntities === 0) {
    success(
      `Nothing to push — ${skipped} entit${skipped === 1 ? 'y' : 'ies'} unchanged since the last push.`
    )
    return { exitCode: 0 }
  }
  if (siteContent)
    info(
      `${colors.bright}site-content${colors.reset} → ${siteContent.models.join(', ')}`
    )
  if (records) {
    const n = records.entityCount
    info(
      `${colors.bright}records${colors.reset} (${n} entit${n === 1 ? 'y' : 'ies'}) → ${records.models.join(', ')}`
    )
  }
  if (skipped) note(`${skipped} unchanged, skipped`)

  // Preview paths — no submit, no auth. Two lanes → up to two files / two routes.
  if (output) {
    const base = output.replace(/\.uwx$/, '')
    if (siteContent)
      writeFileSync(resolve(`${base}.site-content.uwx`), siteContent.buffer)
    if (records)
      writeFileSync(resolve(`${base}.records.uwx`), records.buffer)
    const lanes = [
      siteContent && 'site-content',
      records && 'records'
    ].filter(Boolean)
    success(`Wrote ${lanes.join(' + ')} .uwx — not submitted`)
    return { exitCode: 0 }
  }
  if (dryRun) {
    if (siteContent) {
      const verb = siteContentUuid ? 'update' : 'create'
      info(
        `Dry run — would ${verb} content at ${colors.dim}${client.origin}${colors.reset}`
      )
    }
    if (records) {
      info(
        `Dry run — would push the folder at ${colors.dim}${client.origin}${colors.reset}`
      )
    }
    return { exitCode: 0 }
  }

  // Submit both lanes, back-fill the minted uuids, and persist the send-only-changed
  // cache. Shared with `uniweb publish` via ../backend/site-sync.js.
  const result = await pushSyncPackages({
    client,
    siteDir,
    pkg,
    report: {
      info,
      note,
      error,
      dim: (s) => `${colors.dim}${s}${colors.reset}`
    }
  })
  if (result.exitCode !== 0) return { exitCode: result.exitCode }
  success(
    `Pushed ${result.finalizedTotal} entit${result.finalizedTotal === 1 ? 'y' : 'ies'}` +
      (result.wrote.length ? ` — ${result.wrote.join(', ')}` : '')
  )
  return { exitCode: 0 }
}
