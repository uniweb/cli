/**
 * What changed on the backend since this copy last synced — READ, never taken.
 *
 * `uniweb pull` takes the backend's content; `uniweb status` asks what there is to take.
 * The two must agree on what "changed" means, so this reads the backend as a pull does —
 * the same two lanes, the same conditional GET (`etagsHold`) — and compares the answer
 * with what this copy recorded at its last sync, each in the backend's own representation:
 *
 *   - the site-content entity's version against `baseVersions`: nothing moved, said
 *     precisely;
 *   - each unit's hash against `unitBases.remote`, which a pull and a push both bank from
 *     the backend's own copy: which files moved. A unit's hash is only ever compared with a
 *     base in its own representation (`@uniweb/build`'s `site-diff.js`);
 *   - each record's version against `baseVersions`: which records moved.
 *
 * Whoever made the change — an author in the app, or a push from another copy — it is the
 * backend's content this copy does not hold yet.
 *
 * ⛔ IT TAKES NOTHING. An ETag, a version or a hash banked here would say this copy holds
 * content it never took, and the next pull would hear 304 and never catch up — the failure
 * `pull.js` records beside `PULL_CACHE_VERSION`. Nothing here writes a file.
 */

import { computeUnitHashes, documentSchema, indexFolder, readBackendState } from '@uniweb/build/uwx'
import {
  etagsHold,
  readPullCache,
  readPullDocuments,
  readPullVersions,
  splitRecordsPull
} from '../commands/pull.js'
import { readBaseVersions, readUnitBases } from './site-sync.js'

/**
 * @param {object} p
 * @param {import('./client.js').BackendClient} p.client - signed in; never prompts here
 * @param {string} p.siteDir
 * @param {string} p.siteUuid - the site's uuid on `client.origin` (sync.json)
 * @returns {Promise<{ content: object, records: object }>} each lane's account:
 *   `state` — `unchanged`, `changed` or `unknown` (with `detail`) — and what moved:
 *   content `changed` / `added` / `removed` unit paths and `outsideUnits` (the site's
 *   settings, services or queries moved, and no page did); records `changed` / `added`
 *   labels (`<schema>/<slug>`), a `removed` count and `folder` (the records' sub-folders).
 */
export async function readAppChanges({ client, siteDir, siteUuid }) {
  const etags = etagsHold(siteDir, client.origin) ? readPullCache(siteDir) : {}
  const bases = readBaseVersions(siteDir, client.origin)
  const [content, folder] = await Promise.all([
    readLane(() => client.pullSiteContent(siteUuid, { etag: etags.content })),
    readLane(() => client.pullFolder(siteUuid, { etag: etags.folder }))
  ])
  return {
    content: contentChanges(content, { siteDir, origin: client.origin, siteUuid, bases }),
    records: recordChanges(folder, { siteDir, origin: client.origin, bases })
  }
}

async function readLane(request) {
  let res
  try {
    res = await request()
  } catch (err) {
    return { error: err }
  }
  if (res.status === 304) return { notModified: true }
  if (!res.ok) return { status: res.status }
  try {
    const buf = Buffer.from(await res.arrayBuffer())
    return { docs: readPullDocuments(buf), versions: readPullVersions(buf) }
  } catch (err) {
    return { error: err }
  }
}

function laneDetail(lane) {
  if (lane.error) return lane.error.message || String(lane.error)
  if (lane.status === 404) return 'the backend has no such site, or you lack access to it'
  return `the backend answered HTTP ${lane.status}`
}

/** The content lane against this copy's last sync — see the header. */
export function contentChanges(lane, { siteDir, origin, siteUuid, bases }) {
  const none = { changed: [], added: [], removed: [], outsideUnits: false }
  if (lane.notModified) return { state: 'unchanged', ...none }
  if (!lane.docs) return { state: 'unknown', ...none, detail: laneDetail(lane) }
  const doc = lane.docs.find((d) => d?.info || documentSchema(d)) || lane.docs[0] || null
  if (!doc) return { state: 'unknown', ...none, detail: 'the backend sent no site content' }

  const now = lane.versions?.[siteUuid]
  const then = bases[siteUuid]
  if (now && then && now === then) return { state: 'unchanged', ...none }

  const base = readUnitBases(siteDir, origin).remote
  if (!Object.keys(base).length) {
    return { state: 'unknown', ...none, detail: "this copy holds no record of the backend's content at its last sync" }
  }
  const hashes = computeUnitHashes(doc)
  const changed = []
  const added = []
  for (const [path, hash] of Object.entries(hashes)) {
    if (!(path in base)) added.push(path)
    else if (base[path] !== hash) changed.push(path)
  }
  const removed = Object.keys(base).filter((path) => !(path in hashes))
  const units = changed.length + added.length + removed.length
  // The entity moved and no unit did: what moved is outside the pages — the site's
  // settings, its services, its queries.
  const outsideUnits = !units && Boolean(now && then)
  return {
    state: units || outsideUnits ? 'changed' : 'unchanged',
    changed: changed.sort(),
    added: added.sort(),
    removed: removed.sort(),
    outsideUnits
  }
}

// `@acme/article` → `article`: how a record's folder under `records/` is named.
const shortSchema = (schema) => (typeof schema === 'string' ? schema.replace(/^@[^/]+\//, '') : null)

/** The folder lane against this copy's last sync — see the header. */
export function recordChanges(lane, { siteDir, origin, bases }) {
  const none = { changed: [], added: [], removed: 0, folder: false }
  if (lane.notModified) return { state: 'unchanged', ...none }
  if (!lane.docs) return { state: 'unknown', ...none, detail: laneDetail(lane) }
  const { folderDoc, recordDocs } = splitRecordsPull(lane.docs)
  // The records this copy synced, by the backend's uuid (sync.json's `records`: own id → theirs).
  const known = new Set(Object.values(readBackendState(siteDir, origin).records || {}))
  if (!known.size && !recordDocs.length) return { state: 'unchanged', ...none }

  const index = indexFolder(folderDoc)
  const label = (doc) => {
    const slug = index.get(doc.$uuid)?.slug ?? (typeof doc.$id === 'string' ? doc.$id.split('/').pop() : null)
    const schema = shortSchema(documentSchema(doc))
    return slug ? (schema ? `${schema}/${slug}` : slug) : doc.$uuid
  }
  const versions = lane.versions || {}
  const changed = []
  const added = []
  const seen = new Set()
  for (const doc of recordDocs) {
    const uuid = doc?.$uuid
    if (!uuid) continue
    seen.add(uuid)
    if (!known.has(uuid)) added.push(label(doc))
    else if (bases[uuid] && versions[uuid] && bases[uuid] !== versions[uuid]) changed.push(label(doc))
  }
  const removed = [...known].filter((uuid) => !seen.has(uuid)).length
  const folderUuid = folderDoc?.$uuid
  const folder = Boolean(folderUuid && bases[folderUuid] && versions[folderUuid] && bases[folderUuid] !== versions[folderUuid])
  const moved = changed.length || added.length || removed || folder
  return { state: moved ? 'changed' : 'unchanged', changed: changed.sort(), added: added.sort(), removed, folder }
}
