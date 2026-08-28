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
import { hasUncommittedContent } from '../utils/git.js'
import { recordSiteBackend } from '../utils/site-identity.js'
import {
  backfillEntityUuids,
  writeSiteEntityUuid,
  writeSiteOrg,
  emitSyncPackages,
  readZip,
  diffSiteUnits,
  describeSiteDiff,
  computeUnitHashes,
  collectUnitUuids,
  collectFolderItemUuids,
  collectCollectionUuids,
  readAssetMap
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
    return describeSiteDiff(
      diffSiteUnits(localDoc, remoteDoc, readUnitBases(siteDir))
    )
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
      // Per-item post-write tokens, `{ recordUuid: <opaque> }` (backend `d7e46335`).
      // Same map shape and same key name the PULL manifest entry stamps, deliberately
      // — one kind of value, cached from whichever lane last handed it over, echoed
      // as `item_base_versions`. Absent on an older backend ⇒ null ⇒ the cached
      // tokens are left alone and gating degrades to the entity grain.
      itemVersions:
        d?.item_versions && typeof d.item_versions === 'object'
          ? d.item_versions
          : null,
      document: d?.document ?? null
    }))
    .filter((e) => Number.isInteger(e.index) && e.uuid)
}

// Pull the minted site-content uuid out of a CREATE response. The exact shape is an
// open backend item, so the extractor is deliberately tolerant of a bare
// `{ siteContentUuid }` / `{ $uuid }` / `{ uuid }`, or the same `report.finalized[]`
// envelope the update/folder lanes return (the site entity is submitted alone, so its
// minted uuid is the first finalized entry). Returns null if none is present.
export function extractMintedSiteUuid(payload) {
  // `POST /dev/site` (the empty-site create) answers with the snake_case spelling;
  // the content-lane CREATE has historically used the others. Both are the same
  // identity — the uuid `/dev/site/content/pull/{uuid}` accepts.
  if (typeof payload?.site_content_uuid === 'string')
    return payload.site_content_uuid
  if (typeof payload?.siteContentUuid === 'string')
    return payload.siteContentUuid
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
// The cache holds several maps written on DIFFERENT events — content hashes and the
// injections that produced them on a successful push, base versions on push AND
// pull, unit hashes on push and pull — so every writer must preserve the ones it
// isn't touching. One merge point rather than a hand-rolled preserve per writer,
// because getting that wrong silently disarms whichever map got clobbered.
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

/**
 * Drop every cache map that describes a BACKEND site, when this clone is bound to
 * none. Returns the names dropped (empty when there was nothing to do).
 *
 * `.uniweb/sync-cache.json` holds five maps keyed by *unit path* — item uuids,
 * content hashes, the injections those hashes were taken over, entity base versions,
 * unit bases — and a unit path (`site.yml`, `pages/about/about.md`) is the same
 * string for every site. So the cache does not
 * self-invalidate when `site.yml::$uuid` goes away: it keeps describing the site
 * this folder used to be.
 *
 * Which is a state we ACTIVELY TELL PEOPLE TO ENTER. The 404 guidance on a
 * uuid-bound lane says to clear `$uuid` to re-publish as a new site — the documented
 * recovery after a site is deleted in the app. Following it left the stale maps in
 * place, and the next publish failed two ways:
 *
 *   - **item uuids** — the new site's document carried the OLD site's item
 *     identities, and the backend correctly refused: *"item uuid … is already
 *     stored on entity 156 — item uuids are globally unique; cross-entity move is
 *     not supported"*. A raw 400 for following our own advice.
 *   - **content hashes** — worse, because it is silent. Send-only-changed would
 *     skip every entity whose content had not changed since the OLD site's last
 *     push, so the NEW site would come up **missing exactly the content that did
 *     not change** — a partial site, published successfully, with nothing to
 *     indicate it.
 *
 * Call this BEFORE `ensureSiteExists`, which mints a uuid and would otherwise make
 * the clone look bound before the check runs.
 */
/**
 * Drop the five remote-derived maps unconditionally, stamping the site they now
 * describe (or clearing the stamp when there is none). Shared by the pre-flight
 * guard and the `item_uuid_conflict` recovery — the guard decides WHETHER, this
 * decides WHAT, and they must not drift.
 */
export function clearRemoteSyncState(siteDir, siteUuid = null) {
  const prior = readSyncCacheFile(siteDir)
  const dropped = [
    'itemUuids',
    'collectionUuids',
    'hashes',
    'baseVersions',
    'unitBases',
    'applied'
  ].filter((k) => prior[k] && Object.keys(prior[k]).length)
  updateSyncCache(siteDir, {
    itemUuids: {},
    // Remote-derived exactly like itemUuids — it holds the OLD site's collection
    // ids, and surviving the drop it would offer them for the new site's sections.
    collectionUuids: {},
    hashes: {},
    baseVersions: {},
    unitBases: {},
    // Remote-derived like the rest, and doubly so: it holds the OLD site's asset
    // serve URLs. Surviving the drop, it would rewrite the new site's media to
    // bytes owned by the site this folder used to be.
    applied: {},
    siteUuid: siteUuid || null
  })
  return dropped
}

export function clearRemoteSyncStateIfUnbound(siteDir) {
  let current = null
  try {
    const y = yaml.load(readFileSync(join(siteDir, 'site.yml'), 'utf8'))
    if (typeof y?.$uuid === 'string') current = y.$uuid
  } catch {
    /* unreadable site.yml — treat as unbound and clear, which is the safe side */
  }

  const prior = readSyncCacheFile(siteDir)
  const REMOTE_MAPS = [
    'itemUuids',
    'hashes',
    'baseVersions',
    'unitBases',
    'applied'
  ]
  const populated = REMOTE_MAPS.filter(
    (k) => prior[k] && Object.keys(prior[k]).length
  )
  if (!populated.length) {
    // Nothing to invalidate, but still stamp identity so a LATER divergence is
    // detectable. A cache that never records its site can only be checked by the
    // unbound rule, which misses the bound-but-wrong case below.
    if (current && prior.siteUuid !== current) {
      updateSyncCache(siteDir, { siteUuid: current })
    }
    return []
  }

  // Two ways the cache can describe a site this clone is not working with:
  //
  //   1. UNBOUND — no `$uuid` at all, so there is no backend site for any of it to
  //      be about. This is the state the documented "clear `$uuid` to re-publish as
  //      a new site" recovery puts you in.
  //   2. BOUND TO A DIFFERENT SITE — `$uuid` names one site and the cache was
  //      written for another. Reachable in one step: the create mints a uuid and
  //      writes it BEFORE the push, so a push that then fails leaves exactly this.
  //      Without the identity stamp it is invisible, and every later publish fails
  //      the same way with no path out but deleting `.uniweb/` by hand.
  //
  // A cache with NO `siteUuid` and a bound site is left alone: that is every
  // pre-existing clone, and assuming it matches is right far more often than
  // wiping it would be.
  const stale =
    !current || (prior.siteUuid && prior.siteUuid !== current) ? populated : []
  if (!stale.length) {
    if (current && prior.siteUuid !== current) {
      updateSyncCache(siteDir, { siteUuid: current })
    }
    return []
  }

  clearRemoteSyncState(siteDir, current)
  return stale
}

export function readSyncCache(siteDir) {
  return readMap(siteDir, 'hashes')
}

/**
 * The hash-affecting injections the emit that produced those hashes applied, in the
 * exact shape `emitSyncPackages` takes back as opts.
 *
 * ⛔ **Only the ones nothing else records.** `assetIds` is deliberately NOT banked
 * here even though the emit applies it: `assets.json` is COMMITTED project state
 * holding exactly that map (local ref → `{id, ext}`), written by the same push, and
 * a gitignored second copy would be a second thing to disagree — the reason that
 * file itself refuses to hold a serve URL. It also has the worse lifetime of the
 * two: `clearRemoteSyncState` wipes this cache, and the committed map correctly
 * survives. ⇒ Bank what a reader cannot re-derive; re-derive the rest.
 *
 * ⛔ Read this whenever you re-emit to COMPARE against `hashes`. A push hashes the
 * DELIVERED document — local `/images/x.png` rewritten to the backend serve URL it
 * just uploaded to, `info.foundation` replaced by the version-pinned ref — and banks
 * that. An offline re-emit produces the AUTHORED document, which is a different
 * document, so it matches nothing and every entity reads as changed forever. That is
 * not hypothetical: it is what `uniweb status` did on any site with one local image
 * (backend-framework-787e, 2026-08-19) — `push` said "1 entity unchanged" and
 * `status --json` said `changed: 1`, from the same cache, seconds apart.
 *
 * ⭐ What is left is what only a backend round-trip produces — an asset **serve URL**
 * and a released foundation version — and `status` is offline by design (measured at
 * zero HTTP requests, a property the cross-client flows rely on). ⚠️ Note the serve
 * URL is REPLAYED, never composed: we re-use the string the host handed us, which is
 * a different act from reconstructing one, and the distinction is the same one that
 * keeps `assets.json` id-only. An asset genuinely new to the site has no recorded
 * mapping and still reads as changed, which is correct.
 */
export function readAppliedInjections(siteDir) {
  return readMap(siteDir, 'applied')
}

/**
 * Bank the content hashes and the injections that produced them. ⛔ ONE call, both
 * maps: they describe the same document, so writing either alone leaves the cache
 * self-inconsistent — and the failure is silent, since a hash never says which
 * document it is of. `applied` is written even when empty, so it can never be a
 * leftover from an earlier push describing hashes it no longer matches.
 *
 * `assetIds` is dropped rather than stored — see readAppliedInjections: it has a
 * committed source of truth in `assets.json`, and the reader re-derives it there.
 */
export function writeSyncCache(siteDir, hashes, applied) {
  const { assetIds: _inAssetsJson, ...bankable } = applied || {}
  updateSyncCache(siteDir, { hashes, applied: bankable })
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

/**
 * Per-ITEM staleness tokens: `{ <record $uuid>: <opaque version> }`.
 *
 * The entity token gates the whole document, so a stale base on any one record
 * refuses the entire push — which fires on the common case of two people editing
 * different sections and teaches them to reach for `--force`. These gate per record
 * instead. Same contract as the entity token: opaque, cached, echoed, never parsed.
 *
 * Merged rather than replaced: a push carries only CHANGED entities, so a response
 * reports tokens for a subset of the site. Replacing would drop the tokens of every
 * record that wasn't in this package and silently degrade those to ungated.
 */
export function readItemBaseVersions(siteDir) {
  return readMap(siteDir, 'itemBaseVersions')
}
export function mergeItemBaseVersions(siteDir, versions) {
  if (!versions || !Object.keys(versions).length) return
  updateSyncCache(siteDir, {
    itemBaseVersions: { ...readItemBaseVersions(siteDir), ...versions }
  })
}
export function mergeBaseVersions(siteDir, versions) {
  if (!versions || !Object.keys(versions).length) return
  updateSyncCache(siteDir, {
    baseVersions: { ...readBaseVersions(siteDir), ...versions }
  })
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
/**
 * Placement identity for the site's `@uniweb/folder` — path chain → `$uuid`.
 *
 * Kept separate from `itemUuids` (which is site-content units) because they key
 * different trees: `pages/…/page.yml` there, `members/alice` here. One map with
 * two key languages is a map nobody can validate.
 */
export function readFolderItemUuids(siteDir) {
  return readMap(siteDir, 'folderItemUuids')
}

/**
 * Collection-declaration identity: `{ <collection name>: <backend $uuid> }`.
 *
 * ⛔ THE THIRD MAP, AND EACH ONE EXISTS FOR THE SAME REASON. `itemUuids` is keyed by
 * the file an item projects to. Two kinds of item have no file of their own — a
 * folder's placements, and a collection DECLARATION (they all live in one
 * `collections/collections.yml`) — so a path-keyed map has no shape either could
 * occupy, and a push re-sends that whole section uuid-less.
 *
 * The backend refuses an all-blank section over stored items rather than applying it,
 * because applying it would insert every record fresh and delete every stored row —
 * content survives, identity does not. So `push` worked once and every push after was
 * refused. Measured 2026-08-29; collab framework-backend-812b.
 *
 * ⭐ Keyed by NAME, which the backend enforces unique within the section and uses as
 * its own join key. ⛔ Not `$id`: it holds the same string but is a payload-local
 * handle the backend skips on parse and never stores.
 */
export function readCollectionUuids(siteDir) {
  return readMap(siteDir, 'collectionUuids')
}
export function writeCollectionUuids(siteDir, map) {
  if (!map || !Object.keys(map).length) return
  updateSyncCache(siteDir, { collectionUuids: map })
}
export function writeFolderItemUuids(siteDir, map) {
  if (!map || !Object.keys(map).length) return
  updateSyncCache(siteDir, { folderItemUuids: map })
}
export function writeItemUuids(siteDir, map) {
  if (!map || !Object.keys(map).length) return
  updateSyncCache(siteDir, { itemUuids: map })
}

/**
 * The org this site was created under, as `@handle`, or null.
 *
 * Read back from `site.yml::$org` (stored bare — see `writeSiteOrg`) and re-dressed
 * with the `@` the CLI and the wire both use. Callers pass it as `--as-org`'s default
 * so an org named once, at create, does not have to be re-typed on every later push.
 *
 * Deliberately NOT a fallback for the flag: an explicit `--as-org` always wins and
 * rides verbatim, so this can only add a value where the CLI previously sent none.
 *
 * @param {string} siteDir
 * @returns {string|null}
 */
export function readSiteOrg(siteDir) {
  try {
    const y = yaml.load(readFileSync(join(siteDir, 'site.yml'), 'utf8'))
    const h = y && typeof y === 'object' ? y.$org : null
    return typeof h === 'string' && h.trim()
      ? `@${h.trim().replace(/^@/, '')}`
      : null
  } catch {
    return null
  }
}

/**
 * Record the org a just-minted site was created under, if one was named.
 *
 * Only what we were TOLD is recorded — when no `--as-org` was passed the backend
 * chose the owner and its create response carries no org, so there is nothing to
 * write and guessing one would be worse than the gap. Returns the display form for
 * the caller's "here's what resolved" line, or null when nothing was recorded.
 *
 * @param {string} siteDir
 * @param {string|null|undefined} asOrg - the `--as-org` value, `@handle` or bare
 * @returns {string|null}
 */
function recordSiteOrg(siteDir, asOrg) {
  const handle = String(asOrg || '')
    .replace(/^@/, '')
    .replace(/\/.*$/, '')
    .trim()
  if (!handle) return null
  try {
    writeSiteOrg(siteDir, handle)
    return `@${handle}`
  } catch {
    // The uuid is the load-bearing back-fill; losing the org note must never
    // fail a push that already succeeded on the backend.
    return null
  }
}

/**
 * Resolve WHICH ORG will own a site that is about to be created.
 *
 * The create that mints `$uuid` is the only call that reads `as_org`, and the
 * backend never moves ownership afterwards. There is also no CLI verb to transfer
 * or delete a site. So this is a **one-shot, unrepealable** decision — and until
 * this function existed the CLI made it silently, by sending nothing and letting
 * the backend fall back to the session's personal context. A developer who belongs
 * to several orgs could put a company site, and the storage it bills, somewhere
 * they never named.
 *
 * `register` has refused to guess a scope for the foundation lane since it shipped
 * (`deriveScope` → `package.json::uniweb.scope`). This is the same refusal, one
 * lane over.
 *
 * Order, and only the last step is new:
 *   1. `--as-org @org`      — explicit, rides verbatim
 *   2. `--personal`         — explicit "no org, I mean it" → sends NO `as_org`
 *   3. `site.yml::$org`     — recorded at this site's own create
 *   4. the site already exists (`$uuid`) → null; ownership is settled, ask nothing
 *   5. otherwise ASK (TTY) or REFUSE (non-interactive)
 *
 * ⛔ **`--personal` sends no `as_org`, and is NOT the same as `--as-org @<handle>`.**
 * The personal *org* `@jane` is an org like any other, lazily created on first use;
 * the session's personal context is not an org at all. Whether the backend gives
 * them the same owning unit is **its** business and unverified here, so the
 * deliberate-personal spelling reproduces today's wire byte-for-byte rather than
 * asserting an equivalence this lane cannot check.
 *
 * @returns {Promise<{ asOrg: string|null, refused?: true, reason?: string }>}
 *   `asOrg: null` with no `refused` means "send no as_org" — either a settled site
 *   or a deliberate personal choice.
 */
export async function resolveSiteOrgForCreate({
  client,
  siteDir,
  args = [],
  flag,
  personal = false,
  offline = false
}) {
  if (flag) return { asOrg: flag }
  if (personal) return { asOrg: null }

  const recorded = readSiteOrg(siteDir)
  if (recorded) return { asOrg: recorded }

  // Already created ⇒ nothing to decide. This is what keeps every existing site
  // silent: ownership was settled at its create, and re-asking would be theatre.
  let siteYml = {}
  try {
    const y = yaml.load(readFileSync(join(siteDir, 'site.yml'), 'utf8'))
    if (y && typeof y === 'object') siteYml = y
  } catch {
    /* unreadable — treat as un-created and let the resolution below decide */
  }
  if (typeof siteYml.$uuid === 'string') return { asOrg: null }

  // An offline preview (`--dry-run` / `-o`) must never authenticate, and it is
  // creating nothing, so there is no decision to force. Say what is unresolved
  // instead of prompting for an answer the run will not use.
  if (offline) return { asOrg: null }

  // `--yes` promises "never block on a prompt", so it has to answer this one too —
  // and the only honest non-blocking answer to an unanswerable ownership question
  // is a refusal. Treating it as consent-to-anything would reinstate the silent
  // default this whole path exists to remove, behind a flag that reads like
  // approval.
  const { isNonInteractive } = await import('../utils/interactive.js')
  if (isNonInteractive(args) || args.includes('--yes')) {
    return {
      asOrg: null,
      refused: true,
      reason:
        'This site does not exist on the backend yet, and no org was named.\n' +
        '  The create decides who OWNS it — and which workspace its storage is billed to —\n' +
        '  one time, with no CLI way to change it afterwards. Name it explicitly:\n' +
        '    --as-org @org     create it under an organization\n' +
        '    --personal        create it under your personal account, deliberately'
    }
  }

  // Interactive: offer the real choice. Deliberately NOT `deriveScope` — that one
  // serves the foundation lane, where every answer is an org and 0-orgs means
  // "claim your personal org". Here "personal" must stay reachable as *no org*,
  // and reusing deriveScope would quietly turn it into an org creation.
  const { fetchOrgs, createOrg, validateHandle, bareHandle } = await import(
    '../utils/registry-orgs.js'
  )
  let envelope
  try {
    envelope = await fetchOrgs({
      apiBase: client.origin,
      token: await client.token()
    })
  } catch (err) {
    return { asOrg: null, refused: true, reason: err.message }
  }
  const personalHandle = envelope.account_handle || null
  const prompts = (await import('prompts')).default
  const choices = [
    ...envelope.orgs.map((o) => ({
      title: `@${o.handle}${o.handle === personalHandle ? ' — your personal org' : o.is_primary ? ' (primary)' : ''}`,
      value: o.handle
    })),
    {
      title: `Personal — no organization${personalHandle ? ` (${personalHandle})` : ''}`,
      value: ':personal'
    },
    { title: 'A new organization…', value: ':new' }
  ]
  const { choice } = await prompts(
    {
      type: 'select',
      name: 'choice',
      message: 'Create this site under which owner?',
      choices,
      initial: 0
    },
    {
      onCancel: () => {
        console.log('\nCancelled.')
        process.exit(0)
      }
    }
  )
  if (!choice) return { asOrg: null, refused: true, reason: 'No owner chosen.' }
  if (choice === ':personal') return { asOrg: null }
  if (choice !== ':new') return { asOrg: `@${choice}` }

  const answer = await prompts(
    {
      type: 'text',
      name: 'handle',
      message: 'Org handle (e.g. acme):',
      validate: (v) => validateHandle(v) || true
    },
    {
      onCancel: () => {
        console.log('\nCancelled.')
        process.exit(0)
      }
    }
  )
  if (!answer.handle)
    return { asOrg: null, refused: true, reason: 'No org handle given.' }
  try {
    const org = await createOrg({
      apiBase: client.origin,
      token: await client.token(),
      handle: bareHandle(answer.handle)
    })
    return { asOrg: `@${org.handle}` }
  } catch (err) {
    return { asOrg: null, refused: true, reason: err.message }
  }
}

/**
 * Guarantee the site EXISTS on the backend before anything is uploaded against it.
 *
 * Ordering is the point, and it is load-bearing rather than incidental. Uploaded
 * bytes are metered against an owning entity and reclaimed by deleting it, so an
 * upload made before any site exists is charged and can never be freed — there is
 * nothing to delete. Creating the site first turns the artifact of a failed first
 * publish from *unfreeable bytes* into *an empty site*, which costs nothing to
 * keep and can be cleared. (The reverse ordering was justified by a claim that
 * `ensureItemUuids` mints on the backend, which it does not — see push.js.)
 *
 * A no-op when `site.yml::$uuid` is already set, so only the first publish of a
 * site pays for it. The uuid is written back immediately, keeping the window in
 * which a crash could strand a site as small as one file write.
 *
 * @returns {Promise<{ uuid: string|null, created: boolean, reason?: string }>}
 *   `uuid: null` means the site could not be created; the caller decides whether
 *   that is fatal (it is, for any flow that uploads).
 */
export async function ensureSiteExists({
  client,
  siteDir,
  name,
  foundation,
  asOrg,
  note
}) {
  // One read serves both the binding check and the create's defaults, so callers
  // that have no reason to hold site.yml (push) need not load it just to pass it
  // back. An explicit argument still wins — publish supplies the PINNED foundation
  // ref from the bring-along, which site.yml may not carry.
  let siteYml = {}
  try {
    const y = yaml.load(readFileSync(join(siteDir, 'site.yml'), 'utf8'))
    if (y && typeof y === 'object') siteYml = y
  } catch {
    /* unreadable site.yml — treat as un-synced and let the create decide */
  }
  if (typeof siteYml.$uuid === 'string') {
    return { uuid: siteYml.$uuid, created: false, org: readSiteOrg(siteDir) }
  }

  // Both are required by the create. Catching it here turns a 400 into a sentence
  // naming the file and the key — the difference between "fix this line of
  // site.yml" and reading a status code.
  const siteName = name ?? siteYml.name
  const siteFoundation = foundation ?? siteYml.foundation
  const missing = [!siteName && 'name', !siteFoundation && 'foundation'].filter(
    Boolean
  )
  if (missing.length) {
    return {
      uuid: null,
      created: false,
      reason: `site.yml is missing ${missing.join(' and ')} — the backend requires ${missing.length > 1 ? 'them' : 'it'} to create a site`
    }
  }

  let res
  try {
    res = await client.createSite({
      name: siteName,
      foundation: siteFoundation,
      asOrg
    })
  } catch (err) {
    return { uuid: null, created: false, reason: err.message }
  }
  if (!res?.ok) {
    const body = await res?.text?.().catch(() => '')
    return {
      uuid: null,
      created: false,
      // 404 here means the backend predates the route, which is a materially
      // different problem from being refused — say which.
      reason:
        res?.status === 404
          ? 'this backend has no /dev/site route (it predates the empty-site create)'
          : `HTTP ${res?.status} ${res?.statusText || ''}${body ? ` — ${body.slice(0, 200)}` : ''}`
    }
  }
  const payload = await res.json().catch(() => null)
  const minted = extractMintedSiteUuid(payload)
  if (!minted) {
    return {
      uuid: null,
      created: false,
      reason: 'the create returned no site uuid'
    }
  }
  writeSiteEntityUuid(siteDir, minted)
  // Stamp the cache with the site it now describes, so a push that fails after
  // this point cannot leave a cache pointing at a different site with no way to
  // detect it.
  updateSyncCache(siteDir, { siteUuid: minted })
  const org = await recordAndDescribeOwner({
    client,
    siteDir,
    payload,
    asOrg,
    note
  })
  return { uuid: minted, created: true, org }
}

/**
 * Record and announce who owns a just-created site, from the backend's own echo.
 *
 * The echo reports what the site **is**; `asOrg` is only what we asked for. They
 * agree in the normal case and the echo is the one to trust — it is read back off
 * the created entity, so it also covers the case we could never record before: no
 * `--as-org` at all, where the backend picked and we had nothing true to write.
 *
 * ⚠️ `org: null` is MEANINGFUL (personal), not missing. An older backend omits the
 * key entirely, which is the only case that falls back to what we asked for.
 *
 * @returns {Promise<string|null>} the display handle recorded, or null for personal
 */
async function recordAndDescribeOwner({ client, siteDir, payload, asOrg, note }) {
  const echoed = payload && 'org' in payload ? payload.org : undefined
  const owner =
    echoed === undefined ? asOrg : typeof echoed === 'string' ? echoed : null
  const org = recordSiteOrg(siteDir, owner)

  // The SYNC SCOPE, recorded here for the same reason `$org` is: this function is the
  // one place BOTH create paths meet (`ensureSiteExists` for a site with local media,
  // the content-lane create for one without). Recording it at either call site instead
  // would make `$backend` present or absent depending on whether the site happens to
  // have images — the exact drift the comment at the second call site warns about.
  //
  // A no-op on the default backend, so the common case writes nothing.
  const scope = await recordSiteBackend(siteDir, client.origin)
  if (scope) note?.(`Bound this project to ${scope} (recorded $backend in site.yml).`)

  note?.(
    org
      ? `Created the site on the backend under ${org} (recorded $uuid + $org in site.yml).`
      : `Created the site on the backend, owned personally (recorded $uuid in site.yml).`
  )

  // The billing line needs the JOIN of two independent facts, and either alone
  // gives a wrong answer:
  //   hosts_free               — a property of the SCOPE (is this owner exempt?)
  //   siteSubscriptionRequired — a property of the DEPLOYMENT (does it charge at all?)
  // Keyed on the scope alone, this fires on every local publish — where nothing
  // enforces — until the warning is trained away. Keyed on the deployment alone it
  // fires at exempt owners. An older backend supplies neither, so both read falsy
  // and nothing is said: silence beats a claim we cannot justify.
  const hostsFree = payload?.hosts_free === true
  let enforces = false
  try {
    const cfg = await client.discover()
    enforces = cfg?.delivery?.siteSubscriptionRequired === true
  } catch {
    /* discovery is advisory here — never fail a create over a message */
  }
  if (hostsFree) {
    note?.('This owner is hosted free — publishing will not require a subscription.')
  } else if (enforces) {
    note?.(
      'Publishing this site live will require a hosting subscription on this backend.'
    )
  }
  return org
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
  } catch {
    /* unreadable site.yml — nothing to recover against */
  }
  if (!siteContentUuid) return cached
  try {
    const res = await client.pullSiteContent(siteContentUuid)
    if (!res?.ok) return cached
    const doc = entityDocFromUwx(Buffer.from(await res.arrayBuffer()))
    if (!doc) return cached
    const harvested = collectUnitUuids(doc)
    if (Object.keys(harvested).length) {
      writeItemUuids(siteDir, harvested)
      note?.(
        `Recovered identity for ${Object.keys(harvested).length} item(s) from the backend.`
      )
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
  updateSyncCache(siteDir, {
    unitBases: { ...readUnitBases(siteDir), ...patch }
  })
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
  // Re-emit the document the last push HASHED, not the one the author wrote — see
  // readAppliedInjections. Two sources, on purpose:
  //   · BANKED — the serve URLs and pinned refs only a round-trip produces. Empty
  //     for a cache written before this was banked (and for a never-pushed site),
  //     which is the pre-fix behaviour and self-heals on the next push. It can never
  //     point at the wrong document: it is written with the hashes it belongs to.
  //   · RE-DERIVED — asset identity, from the COMMITTED `assets.json` the same push
  //     wrote. Reading the live file rather than a snapshot is what makes a moved
  //     map (a teammate's push, a pull) read as changed instead of matching a copy
  //     of itself.
  //   · RECORDED — the site's own org, from `site.yml::$org`, written by the push
  //     that banked these hashes.
  //
  // ⛔ THE ORG IS NOT OPTIONAL HERE, AND OMITTING IT WAS SILENT. It is what resolves
  // a foundation-relative `@/member` into the `@org/member` the push shipped and
  // keyed its hashes by. Without it the emit does not fail — `buildCollectionEntities`
  // WARNS and ships the model unresolved, deliberately, so an org-less export still
  // works — so every record of a `@/`-scoped collection is emitted under a key that
  // can never match its banked one, and reads as changed forever.
  //
  // ⚠️ It hides in plain sight because `@std/…` collections are unaffected: their
  // scope is already absolute, so they match. A site mixing both — the marketing
  // fixture has `@std/person` AND `@proximify/member` — shows some records settling
  // and others never settling, which reads like a content problem rather than a
  // resolution one. Measured on matinee 2026-08-29: `status` reported 4 changed
  // immediately after a successful push; passing the org took it to 1.
  const pkg = await comparisonEmit(siteDir, { priorHashes, sendAll })
  const changed =
    (pkg.siteContent?.entityCount || 0) + (pkg.collections?.entityCount || 0)
  return { changed, unchanged: pkg.skipped || 0, warnings: pkg.warnings || [] }
}

/**
 * The emit whose hashes are comparable with the banked ones — ONE definition.
 *
 * ⛔ EVERY DEFECT IN THIS AREA HAS BEEN A WRITER AND A READER DISAGREEING ABOUT
 * WHICH DOCUMENT A HASH DESCRIBES, so the option set that makes them agree must
 * have a single home. Assembled from three sources, each for a stated reason:
 *
 *   · BANKED     the injections the push applied before hashing — serve URLs and
 *                the pinned foundation ref, which only a round trip produces.
 *   · RE-DERIVED asset identity, from the COMMITTED `assets.json`, so a moved map
 *                reads as changed rather than matching a copy of itself.
 *   · RECORDED   the site's org, which resolves a foundation-relative `@/x` into
 *                the `@org/x` the push keyed its hashes by, and the collection
 *                identity a push stamps — so `status` hashes the same document a
 *                push would send rather than one missing a section's `$uuid`s.
 *
 * Offline by design — measured at zero HTTP requests, a property the cross-client
 * flows rely on.
 */
async function comparisonEmit(siteDir, { priorHashes = {}, sendAll = false } = {}) {
  const applied = readAppliedInjections(siteDir)
  const assetIds = readAssetMap(siteDir)
  const org = readSiteOrg(siteDir)
  const collectionUuids = readCollectionUuids(siteDir)
  return emitSyncPackages(siteDir, {
    resolveModel: makeModelResolver({ client: null, offline: true }),
    priorHashes,
    sendAll,
    ...applied,
    ...(Object.keys(collectionUuids).length ? { collectionUuids } : {}),
    ...(Object.keys(assetIds).length ? { assetIds } : {}),
    ...(org ? { org } : {})
  })
}

/**
 * Re-bank the send-only-changed hashes over the files as they NOW stand.
 *
 * ⛔ FOR A WRITER THAT REWRITES THE WORKING TREE — today, `uniweb pull`.
 *
 * A pull projects the backend's document into source files, and that projection is
 * canonical rather than byte-identical to what was there: it moves section ordering
 * out of filename prefixes (`1-hero.md` → `hero.md` plus an explicit `sections:`
 * list) and stamps each section's `id`. Lossless, and a different document.
 *
 * ⚠️ `pull` already knew this for the OTHER map — it clears the `local` unit base
 * because "what we would emit from them is not byte-identical to it, so the old
 * local base no longer describes anything". That reasoning was never carried to the
 * hashes, which were left STALE rather than unknown: the next `uniweb status`
 * reported the site as having unpushed content immediately after a pull, forever.
 * Measured on matinee 2026-08-29 — `push → pull` reported 1 changed of 8.
 *
 * ⭐ Re-banking is the correct answer rather than clearing, because after a pull the
 * on-disk state IS the agreed state: it came from the backend. A push with no edits
 * in between should send nothing, and clearing would make it send everything.
 */
export async function rebankSyncHashes(siteDir) {
  const pkg = await comparisonEmit(siteDir, { sendAll: true })
  writeSyncCache(siteDir, pkg.hashes || {}, pkg.applied || {})
  return Object.keys(pkg.hashes || {}).length
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
export async function pushSyncPackages({
  client,
  siteDir,
  pkg,
  asOrg,
  report
}) {
  const { siteContent, collections, siteContentUuid, hashes, applied } = pkg
  const { info, note, error } = report
  const dim = report.dim || ((s) => s)

  const wrote = []
  let finalizedTotal = 0

  // POST one lane via the client and parse the JSON response. `doRequest` is a thunk
  // returning the client's Response promise (so the "Pushing …" line prints before the
  // request fires). The client carries `collision=force` (last-push-wins) + the optional
  // `--as-org`. Returns the parsed payload, or null on any transport/HTTP/parse failure
  // (already reported).
  // `boundUuid` is set only for the lanes that address an EXISTING site by uuid
  // (content UPDATE, folder push) — never for the CREATE, which has no uuid to be
  // wrong about. It is what lets a 404 be read as "the site this clone is bound to
  // is gone" rather than "the route is missing".
  const postLane = async (
    label,
    doRequest,
    explainStale = async () => [],
    { boundUuid = null } = {}
  ) => {
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
      if ((res.status === 409 || res.status === 400) && body) {
        try {
          problem = JSON.parse(body)
        } catch {
          /* not a problem document */
        }
      }
      // The package carried no identity for records the backend already stores, so
      // applying it would replace every one of them. `ensureItemUuids` is supposed
      // to make this unreachable, so reaching it means that recovery failed — say so
      // rather than surfacing a raw 400.
      // The cache is offering another site's item identities. Recoverable without
      // the user knowing what a sync cache is: the stale maps are unambiguously
      // wrong (they describe a different entity), so clear them and say re-run.
      //
      // Reachable only for a clone broken BEFORE the pre-flight guard existed —
      // an unstamped legacy cache on a bound site, which the guard deliberately
      // leaves alone rather than wiping every existing clone. This is the exit.
      if (problem?.reason === 'item_uuid_conflict') {
        const dropped = clearRemoteSyncState(siteDir, boundUuid)
        error(
          `${label} push refused — this copy's sync cache is describing a different site.`
        )
        note('Nothing was written.')
        if (Number.isInteger(problem.stored_entity_id)) {
          note(
            `Item ${problem.item_uuid ?? '(unnamed)'} already belongs to entity ${problem.stored_entity_id}; this push is for entity ${problem.document_entity_id}.`
          )
        }
        if (dropped.length) {
          note(
            `Cleared the stale cache (${dropped.join(', ')}) — re-run the same command and it will push cleanly.`
          )
        } else {
          note(
            'The cache held nothing to clear, so this is not the usual cause — please report it.'
          )
        }
        return null
      }
      if (problem?.reason === 'identity_required') {
        // ⛔ THE REFUSAL IS PER-SECTION, NOT PER-PUSH, AND WE USED TO SAY OTHERWISE.
        //
        // The backend asks, of each section independently: is this section's ENTIRE
        // incoming record set uuid-less while the stored entity already has items in
        // it? So a push can carry correct identity for most of the document and still
        // be refused over one section it stamps none of — and the old wording ("this
        // copy has no record of the site's item identity", "the recovery … could not
        // reach the backend", "`uniweb pull` also restores it") was wrong on all
        // three counts in exactly that case: the copy has identity, no recovery was
        // attempted, and a pull changes nothing.
        //
        // ⭐ THE BACKEND ALREADY SENDS WHAT LOCATES IT — `section_id`,
        // `records_without_uuid`, `stored_items` — and this branch discarded every
        // one of them, so every refusal anyone collected was missing the only fields
        // that say WHERE. (Named by backend in collab `framework-backend-812b`,
        // 2026-08-28: "the offending section and both counts have been in the body of
        // every refusal you have collected".)
        const n = problem.records_without_uuid
        const stored = problem.stored_items
        // `section_name` landed backend-side 2026-08-28 (`90e7cd7e`), replacing an
        // i64 row id we could not resolve. The fallback stays for an older backend,
        // not because the swap is pending — it is done.
        const where = problem.section_name ?? problem.section_id
        error(
          `${label} push refused — one section carries no item identity` +
            (where === undefined ? '.' : ` (section ${where}).`)
        )
        if (Number.isInteger(n) && Number.isInteger(stored)) {
          note(
            `That section sent ${n} record(s), none carrying a \`$uuid\`, while ${stored} item(s) are already stored there.`
          )
        }
        note(
          'Nothing was written. Applying it would have replaced the identity of every stored item in that section.'
        )
        // ⚠️ Deliberately NOT "run `uniweb pull`". A pull re-harvests identity from
        // the backend's own document, so it fixes a LOST cache — and does nothing at
        // all when the cache is intact and one section simply has no entry in it,
        // which is the case this message now names. Suggesting it there sends the
        // user to re-fetch a map they already have.
        if (problem.detail) note(String(problem.detail))
        return null
      }
      if (problem?.reason === 'stale_base') {
        error(
          `${label} push refused — the backend has newer content than your last pull.`
        )
        // Page-level account, when we can get one. The gate is entity-grained, so
        // without this the user only learns "the document moved" and has no basis
        // for choosing between pulling and forcing.
        const detail = await explainStale()
        for (const line of detail) note(line)
        if (!detail.length) {
          const stale = Array.isArray(problem.stale_entities)
            ? problem.stale_entities
            : []
          if (stale.length) {
            note(
              `Changed upstream: ${stale.length} entit${stale.length === 1 ? 'y' : 'ies'} (${stale.join(', ')})`
            )
          }
        }
        note(
          'Nothing was written — the whole push was refused before any change.'
        )
        // Say what will actually work from HERE. Anyone hitting this has local
        // work — it is why they pushed — and if it is uncommitted then `pull`
        // refuses too, so bare "run pull" advice walks them into a dead end.
        if (hasUncommittedContent(siteDir)) {
          // `--merge` is the recovery that keeps both sides: most of these are two
          // people editing different parts of one section, which merges silently.
          // Offer it first, and keep the take-theirs route for anyone who wants it.
          note(
            "Commit your changes, then `uniweb pull --merge` to combine them with the backend's."
          )
          note(
            '(Plain `uniweb pull` declines while the work is unsaved — it overwrites rather than merges.)'
          )
        } else {
          note(
            'Run `uniweb pull --merge` to combine the changes, or `uniweb pull` to take the backend version.'
          )
        }
        note(
          'To overwrite them anyway, re-run with --force (this discards the upstream edits).'
        )
        return null
      }
      error(`${label} push rejected: HTTP ${res.status} ${res.statusText}`)
      if (res.status === 401 || res.status === 403) {
        note(
          "Credentials weren't accepted — supply a bearer with --token <bearer> (or UNIWEB_TOKEN)."
        )
      } else if (res.status === 404 && boundUuid) {
        // The clone is bound to a site the backend does not have. There is no CLI
        // verb that could have removed it — a site is deleted in the Uniweb app,
        // and that is what severs the sync — so the raw 404 leaves the user with
        // no idea that the fix is local and one line.
        //
        // ⛔ ORDER THESE TWO CAUSES, and put the RECOVERABLE one first. Until 2026-08-24
        // this branch named only the deletion and went straight to "clear `$uuid`" — and
        // that advice, followed for the OTHER cause, destroys a live binding: the site is
        // fine, you are simply pointed at the wrong backend, and clearing the uuid orphans
        // it. `assertSiteBackendScope` now catches most of that before any request goes
        // out, so reaching here usually does mean a deletion; "usually" is not "always"
        // (a project predating `$backend` records no scope to check), which is why the
        // cheap cause is still named before the destructive fix.
        note(
          `The backend at ${client.origin} has no site with uuid ${boundUuid}.`
        )
        note(
          'Two causes. Check the cheap one first: is this the backend the site lives on?'
        )
        note(
          `  wrong backend  →  uniweb login --backend <the right one>   (nothing is lost)`
        )
        note(
          `  deleted in the app  →  clearing \`$uuid\` from site.yml re-publishes it as a NEW site`
        )
        note(
          'Deleting this folder removes only your local copy, either way.'
        )
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
  const pushLane = async (label, doRequest, explainStale, opts) => {
    const payload = await postLane(label, doRequest, explainStale, opts)
    if (payload === null) return null
    const finalized = extractFinalized(payload)
    if (!finalized) {
      error(
        `The ${label} response carried no recognizable finalized list (expected report.finalized[] with index + uuid).`
      )
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
  // Per-item tokens from the SAME response. Keyed by record `$uuid` and flat
  // across entities (the cache is a single map), unlike `newVersions`, which is
  // keyed by entity uuid.
  //
  // ⛔ Both grains must be re-armed from the push, for one reason: a push writes,
  // so every token this clone holds for a record it just changed is now stale. Read
  // on pull only, push 2 classifies that record `pkg != base, host != base` and the
  // backend refuses it — a conflict naming records nobody else touched, on a second
  // push with no edit in between. And it is unrecoverable locally, because the
  // tokens are opaque by contract: a pull would be the only other source, and a
  // pull rewrites the working tree. That is precisely the `--force` habit the gate
  // exists to prevent. Returning the entity `version` on push was added to fix this
  // exact shape one grain up (see delivery-lane.md "Both feed directions are
  // load-bearing"); the item grain had the same hole until backend `d7e46335`
  // started echoing `item_versions` here.
  const newItemVersions = {}
  const harvest = (finalized) => {
    for (const f of finalized || []) {
      if (f.uuid && f.version) newVersions[f.uuid] = f.version
      // Unconditionally, and NOT gated on `changed` — same rule as the entity
      // token: the backend pins "zero-write ⇒ version unmoved", so a no-op
      // resubmit hands back the value we already hold. An older backend omits the
      // field entirely, which leaves the cached tokens alone and degrades to the
      // entity grain, exactly as before.
      if (f.itemVersions) Object.assign(newItemVersions, f.itemVersions)
    }
  }
  // Both grains land together, at every point the old code banked the entity one.
  const mergeHarvested = () => {
    mergeBaseVersions(siteDir, newVersions)
    mergeItemBaseVersions(siteDir, newItemVersions)
  }
  // The backend's post-write copy of the site-content document, kept for the
  // remote-side unit base (see writeUnitBases).
  let siteFinalizedDoc = null
  if (siteContent) {
    if (siteContentUuid) {
      const finalized = await pushLane(
        'site-content',
        () =>
          client.updateSiteContent(siteContentUuid, siteContent.buffer, {
            asOrg
          }),
        () =>
          explainStaleSiteContent({
            client,
            siteDir,
            localBuffer: siteContent.buffer,
            uuid: siteContentUuid
          }),
        { boundUuid: siteContentUuid }
      )
      if (!finalized) {
        mergeHarvested()
        return { exitCode: 1, finalizedTotal, wrote }
      }
      harvest(finalized)
      siteFinalizedDoc = finalized[0]?.document || null
      // ⭐ BANK COLLECTION-DECLARATION IDENTITY, the sibling of the folder's
      // placements below. These items have no file to back-fill into — they all
      // come from one `collections/collections.yml` — so the only place their
      // `$uuid` can live is the cache, keyed by the name the backend enforces
      // unique. Without it every push after the first re-sends the whole
      // `collections` section uuid-less and is refused.
      if (siteFinalizedDoc) {
        const collectionIds = collectCollectionUuids(siteFinalizedDoc)
        if (Object.keys(collectionIds).length) writeCollectionUuids(siteDir, collectionIds)
      }
      finalizedTotal += finalized.length
    } else {
      const payload = await postLane('site-content', () =>
        client.createSiteContent(siteContent.buffer, { asOrg })
      )
      if (payload === null) return { exitCode: 1, finalizedTotal, wrote }
      const minted = extractMintedSiteUuid(payload)
      if (!minted) {
        error(
          'The create response carried no minted site-content uuid — cannot record the site identity or push its folder.'
        )
        note(JSON.stringify(payload).slice(0, 800))
        return { exitCode: 1, finalizedTotal, wrote }
      }
      writeSiteEntityUuid(siteDir, minted)
      updateSyncCache(siteDir, { siteUuid: minted })
      boundSiteUuid = minted
      wrote.push('recorded site $uuid in site.yml')
      // The OTHER create path (a media-less push never reaches `ensureSiteExists`,
      // which is gated on the site having local media). Both mint a site, so both
      // owe the same record — recording it in only one place would make `$org`
      // present or absent depending on whether the site happens to have images.
      // The backend echoes `org`/`hosts_free` top-level here too, beside `report`
      // and `site` (NOT beside `finalized`, which lives at report.finalized).
      const createdOrg = await recordAndDescribeOwner({
        client,
        siteDir,
        payload,
        asOrg,
        note
      })
      if (createdOrg) wrote.push(`recorded site $org (${createdOrg}) in site.yml`)
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
      error(
        'Cannot push collections — the site has no uuid yet. Push the site-content lane first.'
      )
      return { exitCode: 1, finalizedTotal, wrote }
    }
    const finalized = await pushLane(
      'collections',
      () => client.pushFolder(boundSiteUuid, collections.buffer, { asOrg }),
      undefined,
      { boundUuid: boundSiteUuid }
    )
    if (!finalized) {
      mergeHarvested()
      return { exitCode: 1, finalizedTotal, wrote }
    }
    harvest(finalized)
    const bf = backfillEntityUuids({ index: collections.index, finalized })
    for (const w of bf.warnings) note(`! ${w}`)
    for (const d of bf.deferred) note(`↷ ${d.id ?? `#${d.index}`}: ${d.reason}`)
    if (bf.updated.length)
      wrote.push(`wrote ${bf.updated.length} record file(s)`)
    // ⭐ BANK THE FOLDER'S PLACEMENT IDENTITY. The records back-fill their own
    // `$uuid` into their source files (above); the folder's ITEMS have nowhere to
    // be written, so they are banked here from the document the backend just
    // returned.
    //
    // ⛔ Without this a `publish` after a `push` is refused: send-only-changed
    // skips the unchanged records and re-sends the folder ALONE, its `contents`
    // items carry no `$uuid`, and a `multi` item without one reads as new — so
    // the backend refuses rather than replacing every placement. Reproduced on a
    // live manor 2026-08-27; the identities were on the wire all along.
    const folderDoc = finalized.find((f) => f?.document?.contents)?.document
    if (folderDoc) {
      const placements = collectFolderItemUuids(folderDoc)
      if (Object.keys(placements).length) writeFolderItemUuids(siteDir, placements)
    }
    finalizedTotal += finalized.length
  }

  // Persist the full content-hash map so the next push skips unchanged entities,
  // then bank the post-write tokens so the NEXT push carries a current base.
  // Entities absent from finalized[] (skipped, or not editable) keep their cached
  // value — absence is not invalidation.
  writeSyncCache(siteDir, hashes, applied)
  mergeHarvested()
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
    else {
      // ⛔ BANKING IS BEST-EFFORT AND ITS FAILURE USED TO BE SILENT — say it here,
      // because the cost lands two commands away and names something else.
      //
      // Without `finalized[0].document` (carrying `pages`) this push banks NO item
      // identity. The push still reports success. The next `push`/`publish` then
      // emits with no `$uuid` per item, and the backend refuses — correctly, since
      // silently re-identifying every stored row is far worse. But that refusal
      // reads as a stale-token or a producer bug, with nothing pointing back at the
      // push that failed to bank.
      //
      // ⚠️ We cannot tell WHY it is absent from here — a response shape that
      // changed, a lane that shipped nothing, a backend that does not echo the
      // document. Report the observable fact and let the operator carry it.
      note(
        'identity not banked: this push returned no post-write document, so no per-item ' +
          '$uuid was stored. The next push or publish will be identity-blind and the backend ' +
          'may refuse it. `uniweb pull` re-arms identity if that happens.'
      )
    }
  }
  return { exitCode: 0, boundSiteUuid, finalizedTotal, wrote }
}
