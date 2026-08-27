/**
 * uniweb push — push a site to the backend over its two directional lanes:
 *   - content lane → `@uniweb/site-content` (the static half: pages, sections,
 *     layout, theme, foundation ref, extensions, collection decls);
 *   - folder lane → one `@uniweb/folder` + the collection-record entities it
 *     references (the dynamic half; the `$ref` closure rides together).
 *
 * Each entity is an entity-content document (`$id` + `$model` + sections). The site
 * holds exactly one identity: `site.yml::$uuid` (the site-content entity). A first
 * push has none — it CREATEs the site (uuid-less), the backend mints + adopts it
 * and returns the new uuid, which `push` records into `site.yml`. Later pushes
 * UPDATE by that uuid. The folder lane is keyed by the SAME site-content uuid —
 * the backend owns the site's `@uniweb/folder`, so the framework never holds a
 * folder uuid. Records still round-trip their own `$uuid`
 * (back-filled into their source files). site-content items carry a per-item `$uuid`
 * too, stamped at emit from the identity cache rather than from author files — without
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
 *   uniweb push --org @org               Own the new site under @org (alias: --as-org).
 *                                        Read only on the FIRST push of a site — it
 *                                        decides which org owns it, and whose storage
 *                                        its assets are charged to. Recorded as
 *                                        `site.yml::$org` and replayed after that.
 *                                        Without it, you are asked once.
 *   uniweb push --personal               Own the new site personally, deliberately.
 *                                        Sends NO `as_org` — the same wire as before
 *                                        this prompt existed. First push only.
 *   uniweb push --dry-run                Report what would be pushed; submit nothing
 *   uniweb push -o out.uwx               Write the .uwx file(s) per lane; submit nothing
 *   uniweb push --registry <url>         Override the backend origin
 *   uniweb push --token <bearer>         Submit with this bearer; skips `uniweb login`
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
 * Backend: via BackendClient (the content + folder sync lanes). Origin from
 *   --registry  >  UNIWEB_REGISTER_URL  >  the local default.
 * Auth:  --token  >  UNIWEB_TOKEN  >  `uniweb login` session.
 *
 * The two-lane SUBMISSION (POST both lanes, back-fill uuids, persist the
 * send-only-changed cache) lives in `../backend/site-sync.js` so `uniweb publish`
 * (the composite path) reuses the exact same logic. This command owns flag parsing,
 * the emit, and the `-o`/`--dry-run` preview.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import yaml from 'js-yaml'
import { emitSyncPackages } from '@uniweb/build/uwx'
import { uploadSiteMedia, describeAssetRefusal } from '../backend/site-media.js'
import { updateAssetMap, ASSET_MAP_FILE } from '@uniweb/build/uwx'
import { BackendClient } from '../backend/client.js'
import { resolveSiteDir, resolveSiteBackend } from './deploy.js'
import { warnIfContentDoesNotConform } from '../utils/conformance.js'
import { reportSchemalessCollections } from '../utils/schemaless-report.js'
import { readOrgFlag } from '../utils/args.js'
import { checkFlags } from '../utils/flag-guard.js'
import {
  assertSiteBackendScope,
  readSiteIdentity
} from '../utils/site-identity.js'
import { confirm } from '../utils/interactive.js'
import { bringFoundationAlong } from '../backend/foundation-bring-along.js'
import {
  makeModelResolver,
  readSyncCache,
  readBaseVersions,
  readItemBaseVersions,
  readItemUuids,
  ensureItemUuids,
  ensureSiteExists,
  clearRemoteSyncStateIfUnbound,
  pushSyncPackages,
  resolveSiteOrgForCreate
} from '../backend/site-sync.js'

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
  const tokenFlag = flagValue(args, '--token')
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
  // The project's own statement of where its identity lives. Feeds the origin ladder
  // ABOVE the session (see resolveBackendOrigin), so a teammate who cloned this project
  // targets the backend it is bound to instead of whatever they last logged into.
  // ⛔ The RAW value, never `resolveSiteScope` — null must mean "defer to the next tier".
  const siteScope = readSiteIdentity(siteDir).backend
  const siteBackend = await resolveSiteBackend(siteDir)
  // One front door. The bearer is resolved lazily on first need (a non-local Model
  // read during the build, or the submit). Offline emit (--dry-run / -o) is fully
  // offline: it never submits, and its Model resolver never reads from the backend
  // (the `offline` flag below), so it never authenticates — even when a collection
  // references a Model the local foundation doesn't define.
  const client = new BackendClient({
    originFlag: flagValue(args, '--backend') || flagValue(args, '--registry'),
    siteScope,
    siteBackend,
    token: tokenFlag,
    args,
    command: 'Syncing'
  })

  // ⛔ SCOPE CHECK — before anything is sent. A project whose stored identity was minted
  // by a different backend cannot be pushed here: the uuids, the asset ids and the sync
  // cache are all foreign at once. Runs after the client so it sees the RESOLVED origin
  // (flag > env > deploy.yml > session), not the one we guessed.
  //
  // ⚠️ NOT for `-o`, which is a LOCAL EMIT and reaches no backend at all. Its output is
  // built from files on disk; the resolved origin is not an input to it, so a mismatch
  // cannot make the artifact wrong — and refusing would break an operation this command
  // deliberately keeps offline (the `!output && !dryRun` guards below are the same rule).
  // The refusal even says "Sending them elsewhere is refused" over a run that sends
  // nothing.
  //
  // `--dry-run` IS checked, and the asymmetry is the point: a dry run previews a real
  // push, so when that push would be refused, saying so is the honest preview. Printing
  // "would update content at <origin>" instead would preview something that cannot happen.
  if (!output) {
    const scope = assertSiteBackendScope(siteDir, client.origin)
    if (!scope.ok) {
      error(scope.message)
      scope.hint.forEach(note)
      return { exitCode: 1 }
    }
  }

  // WHO will own this site, if this push is the one that creates it. Resolved
  // before any lane runs, because both create paths below consume it and neither
  // should be reached with the question still open. A site that already exists
  // resolves to null without asking — ownership was settled at its create.
  const org = await resolveSiteOrgForCreate({
    client,
    siteDir,
    args,
    flag: readOrgFlag(args),
    personal: args.includes('--personal'),
    offline: !!output || dryRun
  })
  if (org.refused) {
    error('Refusing to create this site without naming an owner.')
    note(org.reason)
    return { exitCode: 2 }
  }
  const asOrg = org.asOrg

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
    const dropped = clearRemoteSyncStateIfUnbound(siteDir)
    if (dropped.length) {
      note(
        `Cleared stale sync state from a previous site (${dropped.join(', ')}).`
      )
    }
  }
  const priorHashes = readSyncCache(siteDir)
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
  // local cache, and if that is empty it reads `site.yml::$uuid` and returns
  // immediately when there is none (the first-push case). Its only backend call is
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
  let assetRewrite = null
  let assetIds = null
  if (!output && !dryRun) {
    let mediaRefs = []
    try {
      const probe = await emitSyncPackages(siteDir, {
      // Resolves a foundation-relative `@/x` model ref into `@org/x`.
      ...(asOrg ? { org: asOrg } : {}),
        ...(foundationDir ? { foundationDir } : {}),
        resolveModel: makeModelResolver({ client, offline: false })
      })
      mediaRefs = probe.localAssets || []
    } catch (err) {
      error(`Could not scan the site for local media: ${err.message}`)
      return { exitCode: 2 }
    }
    if (mediaRefs.length) {
      // The site has to exist before its bytes do — an upload with no owning
      // entity is charged and cannot be freed, because freeing means deleting the
      // owner. A no-op once `$uuid` is set, so only a never-synced site pays.
      // ⛔ The PINNED ref, not site.yml's. The create is a THIRD writer of this
      // value — the emit below stamps it via `injectInfo`, publish passes it here,
      // and push did neither until 2026-08-19: it sent the authored alias (`src`),
      // which names a foundation no deployment can resolve. A site created that way
      // keeps the bad ref, and the backend's create guard now refuses it outright
      // (channel backend-framework-787e, their measurement).
      //
      // ⭐ Same shape as the send-only-changed defect fixed this morning, and missed
      // for the same reason: the rule was applied at the writers under discussion and
      // a third caller of the same value was never enumerated.
      const site = await ensureSiteExists({
        client,
        siteDir,
        asOrg,
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
        const rec = updateAssetMap(siteDir, ids)
        if (rec.written) {
          note(
            `${ASSET_MAP_FILE}: ${rec.added.length} added, ${rec.changed.length} changed — commit it`
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
      ? readItemUuids(siteDir)
      : await ensureItemUuids({ client, siteDir, note })
  let pkg
  try {
    pkg = await emitSyncPackages(siteDir, {
      // Resolves a foundation-relative `@/x` model ref into `@org/x`.
      ...(asOrg ? { org: asOrg } : {}),
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
            baseVersions: readBaseVersions(siteDir),
            itemBaseVersions: readItemBaseVersions(siteDir)
          }),
      ...(assetRewrite ? { assetRewrite } : {}),
      ...(assetIds ? { assetIds } : {})
    })
  } catch (err) {
    error(`Could not build the sync package: ${err.message}`)
    return { exitCode: 2 }
  }
  const { siteContent, collections, siteContentUuid, warnings, skipped } = pkg
  log('')
  for (const w of warnings) note(`! ${w}`)
  // Warn level, not dim: this is the author choosing entities vs static files.
  reportSchemalessCollections(pkg.schemaless, { warn, dim: note })

  const totalEntities =
    (siteContent?.entityCount || 0) + (collections?.entityCount || 0)

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
  if (collections) {
    const n = collections.entityCount
    info(
      `${colors.bright}collections${colors.reset} (${n} entit${n === 1 ? 'y' : 'ies'}) → ${collections.models.join(', ')}`
    )
  }
  if (skipped) note(`${skipped} unchanged, skipped`)

  // Preview paths — no submit, no auth. Two lanes → up to two files / two routes.
  if (output) {
    const base = output.replace(/\.uwx$/, '')
    if (siteContent)
      writeFileSync(resolve(`${base}.site-content.uwx`), siteContent.buffer)
    if (collections)
      writeFileSync(resolve(`${base}.collections.uwx`), collections.buffer)
    const lanes = [
      siteContent && 'site-content',
      collections && 'collections'
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
    if (collections) {
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
    asOrg,
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
