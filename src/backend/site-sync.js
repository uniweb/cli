/**
 * site-sync — the reusable core of `uniweb push`: given a site's emitted sync
 * packages, submit them over the two directional lanes (site-content first, then the
 * folder keyed by the site's uuid), back-fill the minted uuids into the source files,
 * and persist the send-only-changed cache. Extracted from the push command so
 * `uniweb publish` (the composite path) reuses the exact same lane submission.
 *
 * The command keeps flag parsing, the emit, and the `-o`/`--dry-run` preview;
 * everything from "the packages are built, now POST them" lives here. Logging is
 * injected via `report` ({ info, note, error, dim }) so each caller styles output its
 * own way.
 */

import { writeFileSync, readFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import yaml from 'js-yaml'
import {
  backfillEntityUuids,
  writeSiteEntityUuid,
  emitSyncPackages,
  readZip,
  diffSiteUnits,
  describeSiteDiff,
  computeUnitHashes,
  collectUnitUuids,
} from '@uniweb/build/uwx'

// First entity `$`-document out of a `.uwx` we produced or the backend served.
// Deliberately NOT pull.js's `readPullDocuments`: that one is tolerant of JSON
// envelopes for a lane whose shape may change, and importing it here would be a
// cycle (pull.js already imports this module). Both lanes here are always ZIPs.
function entityDocFromUwx(buf) {
  if (!buf || buf.length < 2 || buf[0] !== 0x50 || buf[1] !== 0x4b) return null
  for (const [name, data] of readZip(buf)) {
    if (name === 'manifest.json' || !name.endsWith('.json')) continue
    try {
      return JSON.parse(data.toString('utf8'))
    } catch {
      return null
    }
  }
  return null
}

/**
 * Turn an entity-grained staleness refusal into a file-level account.
 *
 * The gate can only report that the site-content document moved. What the user
 * needs is which FILES — content is split one section per file, so two people
 * editing different sections of the same page have not conflicted — and, since we
 * cache per-unit hashes of the last agreed state, which side moved them. Fetches the backend's current document (a plain
 * read; it writes nothing locally, unlike `uniweb pull`) and diffs.
 *
 * Best-effort by design: this runs on a path that has ALREADY failed, so any
 * problem fetching or parsing must degrade to the plain refusal rather than
 * replace a clear error with a confusing one.
 *
 * @returns {string[]} lines to print, or [] when nothing useful can be said.
 */
async function explainStaleSiteContent({ client, siteDir, localBuffer, uuid }) {
  try {
    if (!uuid) return []
    const res = await client.pullSiteContent(uuid)
    if (!res?.ok) return []
    const remoteDoc = entityDocFromUwx(Buffer.from(await res.arrayBuffer()))
    const localDoc = entityDocFromUwx(localBuffer)
    if (!remoteDoc || !localDoc) return []
    return describeSiteDiff(diffSiteUnits(localDoc, remoteDoc, readUnitBases(siteDir)))
  } catch {
    return []
  }
}

// Pull the finalized entities out of the restore response. The backend returns
// `{ report: { finalized: [ { index, uuid, changed, document }, … ] } }` — each entry
// carries its position in the SUBMITTED sequence (`index`, the correlation key — `$id`
// is not echoed), the minted entity `uuid`, a `changed` flag, and the full `document`
// (verbatim stored content with every `$uuid` filled in). A couple of shapes are
// tolerated; only entries with a valid `index` + `uuid` are usable.
export function extractFinalized(payload) {
  const list = Array.isArray(payload?.report?.finalized)
    ? payload.report.finalized
    : Array.isArray(payload?.finalized)
      ? payload.finalized
      : Array.isArray(payload)
        ? payload
        : null
  if (!list) return null
  return list
    .map((d) => ({
      index: d?.index,
      uuid: d?.uuid ?? d?.document?.$uuid ?? null,
      changed: d?.changed,
      // Post-write optimistic-concurrency token, read back from the stored row.
      // Cache it UNCONDITIONALLY — do not branch on `changed` and do not infer:
      // the backend pins "zero-write ⇒ version unmoved" with a test, so a no-op
      // resubmit returns the value we already hold, and anything else is theirs
      // to report, not ours to derive.
      version: typeof d?.version === 'string' ? d.version : null,
      document: d?.document ?? null,
    }))
    .filter((e) => Number.isInteger(e.index) && e.uuid)
}

// Pull the minted site-content uuid out of a CREATE response. The exact shape is an
// open backend item, so the extractor is deliberately tolerant of a bare
// `{ siteContentUuid }` / `{ $uuid }` / `{ uuid }`, or the same `report.finalized[]`
// envelope the update/folder lanes return (the site entity is submitted alone, so its
// minted uuid is the first finalized entry). Returns null if none is present.
export function extractMintedSiteUuid(payload) {
  if (typeof payload?.siteContentUuid === 'string') return payload.siteContentUuid
  if (typeof payload?.$uuid === 'string') return payload.$uuid
  if (typeof payload?.uuid === 'string') return payload.uuid
  const finalized = extractFinalized(payload)
  if (finalized && finalized.length) {
    const site = finalized.find((f) => f.index === 0) || finalized[0]
    return site?.uuid ?? null
  }
  return null
}

// One-line summary from the authoritative per-entity `changed` flag (`false` = a true
// no-op). Falls back silently when the backend omits it.
function changedSummary(finalized) {
  const changed = finalized.filter((f) => f.changed === true).length
  const unchanged = finalized.filter((f) => f.changed === false).length
  const parts = []
  if (changed) parts.push(`${changed} changed`)
  if (unchanged) parts.push(`${unchanged} unchanged`)
  return parts.length ? parts.join(', ') : null
}

// Resolve a Model NOT defined by the local foundation by reading its declaration (the
// `@uniweb/data-schema` form) from the backend via the client. Cached per run; HTTP
// 404 → null (the emitter then says "register it first"). The bearer is acquired lazily
// by the client, so a fully-local sync never authenticates.
//
// `offline` (set for `-o` / `--dry-run`) forces every non-local Model to null WITHOUT
// touching the backend — an offline emit must never authenticate.
export function makeModelResolver({ client, offline = false }) {
  const cache = new Map()
  return async (modelName) => {
    if (cache.has(modelName)) return cache.get(modelName)
    const decl = offline ? null : await client.readDataSchema(modelName)
    cache.set(modelName, decl)
    return decl
  }
}

// "Send only changed" cache: content hashes from the last successful sync, keyed
// `<model> <id>`. Gitignored, per-clone, deletable (a deleted cache just means one full
// re-sync, which the backend then no-ops). NOT identity — the minted `$uuid` lives in
// the source files; this is a pure wire-efficiency cache.
function syncCachePath(siteDir) {
  return join(siteDir, '.uniweb', 'sync-cache.json')
}
function readSyncCacheFile(siteDir) {
  try {
    const obj = JSON.parse(readFileSync(syncCachePath(siteDir), 'utf8'))
    return obj && typeof obj === 'object' ? obj : {}
  } catch {
    return {} // missing / unreadable → treat everything as changed
  }
}
// The cache holds three maps written on DIFFERENT events — content hashes on a
// successful push, base versions on push AND pull, unit hashes on push and pull —
// so every writer must preserve the ones it isn't touching. One merge point rather
// than three hand-rolled preserves, because getting that wrong silently disarms
// whichever map got clobbered.
function updateSyncCache(siteDir, patch) {
  const p = syncCachePath(siteDir)
  mkdirSync(dirname(p), { recursive: true })
  const prior = readSyncCacheFile(siteDir)
  const out = { version: 1, ...prior, ...patch }
  delete out.version
  writeFileSync(p, JSON.stringify({ version: 1, ...out }, null, 2) + '\n')
}
const readMap = (siteDir, key) => {
  const v = readSyncCacheFile(siteDir)[key]
  return v && typeof v === 'object' ? v : {}
}

export function readSyncCache(siteDir) {
  return readMap(siteDir, 'hashes')
}
export function writeSyncCache(siteDir, hashes) {
  updateSyncCache(siteDir, { hashes })
}

/**
 * The push gate's optimistic-concurrency tokens: `{ <backend-uuid>: <version> }`.
 *
 * Lives beside the content hashes because it is the same kind of thing — "the
 * backend state this clone last agreed with" — and is already per-entity, which
 * the per-lane `pull-cache.json` (two ETags) is not. Gitignored, per-clone,
 * deletable: losing it means the next push is unconditional, i.e. today's
 * behavior, never a wrong-but-plausible token.
 *
 * Fed from BOTH directions, which is what makes the gate usable: `pull` records
 * the manifest's `extra.version`, and every successful push records the
 * post-write `finalized[].version` the backend returns. Without the push half a
 * second consecutive push would be stale by construction and refused.
 */
export function readBaseVersions(siteDir) {
  return readMap(siteDir, 'baseVersions')
}
export function mergeBaseVersions(siteDir, versions) {
  if (!versions || !Object.keys(versions).length) return
  updateSyncCache(siteDir, { baseVersions: { ...readBaseVersions(siteDir), ...versions } })
}

/**
 * Per-unit content hashes of the last synced state, kept in BOTH representations —
 * the bases for the file-level attribution shown after a staleness refusal
 * (`diffSiteUnits`). A unit is a projected file: a page's `page.yml`, each section
 * `.md`, each layout section.
 *
 * Two maps, not one, because our document and the backend's are not byte-comparable
 * (they carry fields we don't emit and their own key order). A hash from one side
 * compared against a base from the other differs for a unit nobody touched, so each
 * side gets a base in its own representation:
 *   `local`  ← our emitted document
 *   `remote` ← the backend's own copy (`finalized[].document`, or a pull)
 *
 * Replaced wholesale rather than merged: a unit that no longer exists is a unit with
 * no base, and a stale entry would attribute its next difference to the wrong side.
 *
 * Purely an explanation aid — losing either map costs detail in one message, never a
 * wrong push.
 */
/**
 * Per-item identity: `{ <unit path>: <backend $uuid> }`.
 *
 * The backend's reconcile matches a record by `$uuid`. `pages`, `page_sections` and
 * `layout_sections` are all `multi` sections, where a record WITHOUT a uuid is read
 * as new — inserted, with its stored counterpart deleted as host-only. So pushing
 * without this map replaces every page and section row on every push. The content
 * still lands, which is why it went unnoticed, but the app's per-item concurrency
 * handles are left pointing at rows that no longer exist.
 *
 * Cached here rather than written into `page.yml` / section frontmatter: identity is
 * a sync concern and author files should not carry sync uuids. Populated from
 * whatever the backend last told us — a pull, or a push response's
 * `finalized[].document`, which carries `$uuid` for every item at every nesting
 * level, so a push alone bootstraps it and no pull is required.
 *
 * Losing it (gitignored, per-clone) means the next push would be identity-blind,
 * which is why `push` repopulates it first — see `ensureItemUuids`. The backend also
 * refuses an all-blank `multi` section, so a producer that skips that step fails
 * loudly instead of quietly rebuilding the site's identity.
 */
export function readItemUuids(siteDir) {
  return readMap(siteDir, 'itemUuids')
}
export function writeItemUuids(siteDir, map) {
  if (!map || !Object.keys(map).length) return
  updateSyncCache(siteDir, { itemUuids: map })
}

/**
 * Guarantee we have per-item identity before an identity-bearing push.
 *
 * Fires only when the site HAS been pushed before (`$uuid` in site.yml) but the
 * cache is empty — a fresh `git clone`, or a deleted `.uniweb/`. One read of the
 * backend's current document, no file writes, no `uniweb pull`. A first-ever push
 * legitimately has nothing to fetch and is left alone.
 *
 * @returns {Promise<Object<string,string>>} the map (possibly empty)
 */
export async function ensureItemUuids({ client, siteDir, note }) {
  const cached = readItemUuids(siteDir)
  if (Object.keys(cached).length) return cached
  // A site that has never been pushed has no identity to recover — and nothing to
  // lose, since every item is genuinely new.
  let siteContentUuid = null
  try {
    const y = yaml.load(readFileSync(join(siteDir, 'site.yml'), 'utf8'))
    siteContentUuid = typeof y?.$uuid === 'string' ? y.$uuid : null
  } catch { /* unreadable site.yml — nothing to recover against */ }
  if (!siteContentUuid) return cached
  try {
    const res = await client.pullSiteContent(siteContentUuid)
    if (!res?.ok) return cached
    const doc = entityDocFromUwx(Buffer.from(await res.arrayBuffer()))
    if (!doc) return cached
    const harvested = collectUnitUuids(doc)
    if (Object.keys(harvested).length) {
      writeItemUuids(siteDir, harvested)
      note?.(`Recovered identity for ${Object.keys(harvested).length} item(s) from the backend.`)
    }
    return harvested
  } catch {
    // Best-effort: a failure here leaves the push identity-blind, which the backend
    // refuses rather than silently applying. Better to hit that than to guess.
    return cached
  }
}

export function readUnitBases(siteDir) {
  const v = readMap(siteDir, 'unitBases')
  return { local: v.local || {}, remote: v.remote || {} }
}
export function writeUnitBases(siteDir, patch) {
  if (!patch) return
  updateSyncCache(siteDir, { unitBases: { ...readUnitBases(siteDir), ...patch } })
}

/**
 * Offline-probe how many of a site's entities differ from the last successful push.
 * Runs the SAME emit + send-only-changed diff `uniweb push` runs, but with an
 * OFFLINE Model resolver — no auth, no submit, no backend round-trip. Used by
 * `uniweb status` only. (It was also `uniweb publish`'s pre-flight back when publish
 * went live WITHOUT pushing and so had to warn about unpushed content; publish now
 * always pushes, which makes the warning moot.) Throws if the producer can't build
 * the sync packages (e.g. an unresolved data Model); callers report it.
 *
 * @param {string} siteDir
 * @returns {Promise<{ changed: number, unchanged: number, warnings: string[] }>}
 */
export async function probeUnpushed(siteDir, { sendAll = false } = {}) {
  const priorHashes = readSyncCache(siteDir)
  const pkg = await emitSyncPackages(siteDir, {
    resolveModel: makeModelResolver({ client: null, offline: true }),
    priorHashes,
    sendAll,
  })
  const changed = (pkg.siteContent?.entityCount || 0) + (pkg.collections?.entityCount || 0)
  return { changed, unchanged: pkg.skipped || 0, warnings: pkg.warnings || [] }
}

/**
 * Submit a site's emitted sync packages over both directional lanes, back-fill the
 * minted uuids, and persist the send-only-changed cache. The HTTP + file-write-back
 * half that `emitSyncPackages` (producer-pure) deliberately omits.
 *
 * @param {object} params
 * @param {object} params.client - BackendClient (carries the origin + the lane methods)
 * @param {string} params.siteDir - the site root (for $uuid write-back + the cache)
 * @param {object} params.pkg - the `emitSyncPackages` result
 *        ({ siteContent, collections, siteContentUuid, hashes })
 * @param {string|null} [params.asOrg] - act-as org (membership-gated), forwarded to each lane
 * @param {{info,note,error,dim?:Function}} params.report - injected logging
 * @returns {Promise<{ exitCode: number, boundSiteUuid?: string, finalizedTotal: number, wrote: string[] }>}
 *   exitCode 1 on any lane failure (already reported, cache NOT persisted); 0 on success.
 */
export async function pushSyncPackages({ client, siteDir, pkg, asOrg, report }) {
  const { siteContent, collections, siteContentUuid, hashes } = pkg
  const { info, note, error } = report
  const dim = report.dim || ((s) => s)

  const wrote = []
  let finalizedTotal = 0

  // POST one lane via the client and parse the JSON response. `doRequest` is a thunk
  // returning the client's Response promise (so the "Pushing …" line prints before the
  // request fires). The client carries `collision=force` (last-push-wins) + the optional
  // `--as-org`. Returns the parsed payload, or null on any transport/HTTP/parse failure
  // (already reported).
  const postLane = async (label, doRequest, explainStale = async () => []) => {
    info(`Pushing ${label} to ${dim(client.origin)} …`)
    let res
    try {
      res = await doRequest()
    } catch (err) {
      error(`Could not reach the backend at ${client.origin}: ${err.message}`)
      note('Set the origin with --backend <url> or UNIWEB_REGISTER_URL.')
      return null
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      // Two unrelated conflicts share HTTP 409, so branch on the machine-readable
      // `reason` — never on `detail`, which is prose the backend may reword.
      let problem = null
      if (res.status === 409 && body) {
        try { problem = JSON.parse(body) } catch { /* not a problem document */ }
      }
      if (problem?.reason === 'stale_base') {
        error(`${label} push refused — the backend has newer content than your last pull.`)
        // Page-level account, when we can get one. The gate is entity-grained, so
        // without this the user only learns "the document moved" and has no basis
        // for choosing between pulling and forcing.
        const detail = await explainStale()
        for (const line of detail) note(line)
        if (!detail.length) {
          const stale = Array.isArray(problem.stale_entities) ? problem.stale_entities : []
          if (stale.length) {
            note(`Changed upstream: ${stale.length} entit${stale.length === 1 ? 'y' : 'ies'} (${stale.join(', ')})`)
          }
        }
        note('Nothing was written — the whole push was refused before any change.')
        note('Run `uniweb pull` to take those changes, then push again.')
        note('To overwrite them anyway, re-run with --force (this discards the upstream edits).')
        return null
      }
      error(`${label} push rejected: HTTP ${res.status} ${res.statusText}`)
      if (res.status === 401 || res.status === 403) {
        note("Credentials weren't accepted — supply a bearer with --token <bearer> (or UNIWEB_TOKEN).")
      } else if (res.status === 409) {
        // The site's @uniweb/folder is genesis-owned: its structure is fixed on first
        // deploy and not reconciled in place (the v1 rule — see gotcha #20's mode switch).
        note(
          "This site's collection structure is already established on the backend and can't be changed " +
            'in place — e.g. adding or removing a schema-backed collection, or switching one between ' +
            'static (data-bundle) and schema-backed delivery. To change it: delete the deployed site and ' +
            'redeploy, or clear `$uuid` in site.yml to deploy a fresh one.'
        )
      }
      if (body) note(body.slice(0, 800))
      return null
    }
    try {
      return await res.json()
    } catch (err) {
      error(`Could not parse the ${label} response as JSON: ${err.message}`)
      return null
    }
  }

  // POST a lane that round-trips entity uuids (content UPDATE + the folder): parse the
  // finalized list (for record back-fill + the changed summary). Returns the finalized
  // array, or null on failure (already reported).
  const pushLane = async (label, doRequest, explainStale) => {
    const payload = await postLane(label, doRequest, explainStale)
    if (payload === null) return null
    const finalized = extractFinalized(payload)
    if (!finalized) {
      error(`The ${label} response carried no recognizable finalized list (expected report.finalized[] with index + uuid).`)
      note(JSON.stringify(payload).slice(0, 800))
      return null
    }
    const summary = changedSummary(finalized)
    if (summary) note(`${label}: ${summary}`)
    return finalized
  }

  // Lane 1 — site-content (the site is born here; it must exist before its folder). A
  // known site uuid → UPDATE by uuid; none → CREATE (the backend mints + adopts the site
  // and returns its uuid, which we record into site.yml). `boundSiteUuid` carries the
  // minted/known uuid forward to key the folder push.
  let boundSiteUuid = siteContentUuid
  // Post-write tokens harvested from every lane, persisted once at the end so a
  // partial push (lane 1 ok, lane 2 refused) still banks what actually landed —
  // otherwise the next attempt would re-send lane 1 with a base the backend has
  // already moved past, and refuse a push the user just made.
  const newVersions = {}
  const harvest = (finalized) => {
    for (const f of finalized || []) if (f.uuid && f.version) newVersions[f.uuid] = f.version
  }
  // The backend's post-write copy of the site-content document, kept for the
  // remote-side unit base (see writeUnitBases).
  let siteFinalizedDoc = null
  if (siteContent) {
    if (siteContentUuid) {
      const finalized = await pushLane(
        'site-content',
        () => client.updateSiteContent(siteContentUuid, siteContent.buffer, { asOrg }),
        () => explainStaleSiteContent({ client, siteDir, localBuffer: siteContent.buffer, uuid: siteContentUuid })
      )
      if (!finalized) {
        mergeBaseVersions(siteDir, newVersions)
        return { exitCode: 1, finalizedTotal, wrote }
      }
      harvest(finalized)
      siteFinalizedDoc = finalized[0]?.document || null
      finalizedTotal += finalized.length
    } else {
      const payload = await postLane(
        'site-content',
        () => client.createSiteContent(siteContent.buffer, { asOrg })
      )
      if (payload === null) return { exitCode: 1, finalizedTotal, wrote }
      const minted = extractMintedSiteUuid(payload)
      if (!minted) {
        error('The create response carried no minted site-content uuid — cannot record the site identity or push its folder.')
        note(JSON.stringify(payload).slice(0, 800))
        return { exitCode: 1, finalizedTotal, wrote }
      }
      writeSiteEntityUuid(siteDir, minted)
      boundSiteUuid = minted
      wrote.push('recorded site $uuid in site.yml')
      const createdFinalized = extractFinalized(payload)
      harvest(createdFinalized)
      siteFinalizedDoc = createdFinalized?.[0]?.document || null
      finalizedTotal += createdFinalized?.length ?? 1
    }
  }

  // Lane 2 — collections (the @uniweb/folder + the records it references), keyed by the
  // site-content uuid. On a brand-new site the backend creates the folder on this first
  // push. Records round-trip their own $uuid (back-filled into source files); the folder
  // itself has no uuid (the backend owns it).
  if (collections) {
    if (!boundSiteUuid) {
      error('Cannot push collections — the site has no uuid yet. Push the site-content lane first.')
      return { exitCode: 1, finalizedTotal, wrote }
    }
    const finalized = await pushLane(
      'collections',
      () => client.pushFolder(boundSiteUuid, collections.buffer, { asOrg })
    )
    if (!finalized) {
      mergeBaseVersions(siteDir, newVersions)
      return { exitCode: 1, finalizedTotal, wrote }
    }
    harvest(finalized)
    const bf = backfillEntityUuids({ index: collections.index, finalized })
    for (const w of bf.warnings) note(`! ${w}`)
    for (const d of bf.deferred) note(`↷ ${d.id ?? `#${d.index}`}: ${d.reason}`)
    if (bf.updated.length) wrote.push(`wrote ${bf.updated.length} record file(s)`)
    finalizedTotal += finalized.length
  }

  // Persist the full content-hash map so the next push skips unchanged entities,
  // then bank the post-write tokens so the NEXT push carries a current base.
  // Entities absent from finalized[] (skipped, or not editable) keep their cached
  // value — absence is not invalidation.
  writeSyncCache(siteDir, hashes)
  mergeBaseVersions(siteDir, newVersions)
  // Re-base the page attribution: our emitted document and the backend's post-write
  // copy of it are the two sides' new agreed state. Only when the site-content lane
  // actually shipped — a push that skipped it left that state where it was.
  if (siteContent) {
    const patch = {}
    const ours = entityDocFromUwx(siteContent.buffer)
    if (ours) patch.local = computeUnitHashes(ours)
    // `finalized[].document` is the backend's own representation, read back from
    // the stored row — the only remote-side base a push can produce.
    const theirs = siteFinalizedDoc?.pages ? siteFinalizedDoc : null
    if (theirs) patch.remote = computeUnitHashes(theirs)
    if (Object.keys(patch).length) writeUnitBases(siteDir, patch)
    // The backend's post-write document carries `$uuid` per item at every nesting
    // level, so the push that just landed also re-arms identity for the next one.
    // Replaced wholesale: an item that no longer exists must not keep a uuid that
    // would re-target something else.
    if (theirs) writeItemUuids(siteDir, collectUnitUuids(theirs))
  }
  return { exitCode: 0, boundSiteUuid, finalizedTotal, wrote }
}
