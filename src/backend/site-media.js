/**
 * Upload a site's local media to the backend's content-addressed asset store via the
 * SAME asset lane the data bundle rides, and return a `{ ref → serveUrl }` map for the
 * deploy's second emit (`assetRewrite`) to swap the entity content refs for.
 *
 * Input is the site-root asset refs the producer surfaced in
 * `emitSyncPackages().localAssets` (`/images/hero.png`); `resolveAssetPath` finds the
 * file under the site's `public/`, and refuses one only `assets/` holds, a folder retired
 * 2026-10-28. A ref whose file is missing is
 * skipped (warned), never a broken serve URL. The serve URL is the backend's canonical
 * `serve_url`, read verbatim — origin-relative forms included; nothing here composes one.
 * Content-addressed like every asset: identical bytes → same id → a re-deploy of
 * unchanged media is a cheap no-op PUT (the lane's `present` skip-list).
 */

import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { resolveAssetPath } from '@uniweb/build/site'
import { servedFingerprint } from '@uniweb/build/uwx'
import { prepareImage, isPreparableImage } from '@uniweb/build/images'
import { contentTypeFor } from '../utils/code-upload.js'
import { humanBytes } from '../utils/bytes.js'

/**
 * @param {object} client - BackendClient (uploadSiteAssets). No `discover` — this
 *        lane stopped consulting the capability doc when `assetBase` was removed.
 * @param {string} siteDir - the site root (site-root refs resolve under public/)
 * @param {Array<string|{ ref: string, path: string, contentType?: string }>} refs - site-root local
 *        asset refs (`/images/x.png`), or files already located (a file record's)
 * @param {{ siteUuid?: string|null, onProgress?: (m: string) => void, warn?: (m: string) => void, recorded?: Record<string, object> }} [opts]
 *   `siteUuid` is the owner the uploaded bytes are charged to. Callers create the
 *   site before uploading precisely so this is set — an unowned upload is charged
 *   and cannot be freed, because freeing means deleting the owning entity.
 *   `recorded` is this backend's asset map from `sync.json`, which says what each ref was stored as.
 *   `keepFormat` names the pictures other software fetches by their address, which keep their format
 *   and lose only their location and camera data (`prepareImage`'s `keepFormat`).
 * @returns {Promise<{ map: Record<string,string>, ids: Record<string,{id:string,ext:string,source?:string,size?:number}>, missing: string[], served: string[], failed: Array<{path:string,status:number,detail?:string}> }>}
 *   `map` is ref → serve URL for refs that resolved AND uploaded. The two failure
 *   kinds are reported SEPARATELY because callers must treat them differently:
 *   `missing` is a ref with no file under the site — an authoring mistake, already
 *   broken before us, worth a warning; `failed` is a ref whose bytes we could not
 *   store — a transport or QUOTA refusal, and shipping content that still points at
 *   the local path would publish a broken image while only warning about it.
 *   ⭐ `served` is neither: an address the backend serves itself, which stays as written.
 *   A pull writes one where it has no file to put back, as a clone's favicon or a record's
 *   image on a backend whose addresses are paths of its own origin. ⛔ Until 2026-10-31
 *   these were warned about as missing files.
 */
export async function uploadSiteMedia(
  client,
  siteDir,
  refs,
  { siteUuid = null, onProgress, warn, recorded = {}, keepFormat = new Set() } = {}
) {
  if (!refs?.length) return { map: {}, ids: {}, missing: [], served: [], failed: [] }

  const files = []
  const missing = []
  const served = []
  // ⭐ A ref is a site-root media path (`/images/x.png`), resolved under the site — or a file the
  // caller already located, `{ ref, path, contentType? }`: a file record's file and its preview, which
  // live in the records directory and declare their own type (`@uniweb/file`, 2026-09-28), and a
  // section's co-located file, keyed by its path from the site root (`uwx/located-media.js`, 2026-10-28).
  const keys = []
  for (const item of refs) {
    const ref = typeof item === 'string' ? item : item?.ref
    if (typeof ref !== 'string' || !ref) continue
    keys.push(ref)
    const resolved = typeof item === 'string' ? resolveAssetPath(ref, siteDir, siteDir).resolved : item.path
    if (!resolved || !existsSync(resolved)) {
      if (typeof item === 'string' && (await client.servesFile(ref))) {
        served.push(ref)
        continue
      }
      warn?.(`local-media: ${ref} not found under the site (skipped)`)
      missing.push(ref)
      continue
    }
    const bytes = readFileSync(resolved)
    const declared = typeof item === 'object' ? item.contentType : null
    const file = {
      path: ref.replace(/^\/+/, ''), // bookkeeping key into the plan (must be unique)
      content_type: declared || contentTypeFor(basename(resolved)),
      size: bytes.length,
      sha256: sha256(bytes),
      localUrl: ref, // the rewrite key — the original content ref
      diskPath: resolved
    }
    // ⭐ A picture is prepared before it is stored (`prepareImage`). Not a file record's file, which
    // declares its own type: that is a download, kept as its author gave it. A picture other software
    // fetches by its address (`keepFormat`: the favicon, the touch icon, the site's card and its social
    // images) keeps its format, since a home screen takes a PNG and a link preview a JPEG or PNG, and
    // loses only its location and camera data. ⛔ Until 2026-11-12 those went up as they were, so a
    // phone's photo made a social image kept where it was taken, on its page too.
    const ext = extOf(resolved)
    const prepare = !declared && isPreparableImage(ext)
    const options = { keepFormat: keepFormat.has(ref) }
    files.push(prepare ? await preparedFile(file, bytes, ext, recorded?.[ref], warn, options) : file)
  }
  if (!files.length) return { map: {}, ids: {}, missing, served, failed: [] }

  let result = await client.uploadSiteAssets({ files, siteUuid, onProgress })
  // A recorded preparation the backend no longer holds, whose file now prepares to other bytes
  // (the rule changed since): prepared anew, and planned again.
  const stale = (result.failed || []).filter((f) => f.stale)
  if (stale.length) {
    const again = []
    for (const f of stale) {
      const was = files.find((x) => x.path === f.path)
      if (!was) continue
      const bytes = readFileSync(was.diskPath)
      const file = {
        path: was.key,
        content_type: contentTypeFor(basename(was.diskPath)),
        size: bytes.length,
        sha256: sha256(bytes),
        localUrl: was.localUrl,
        diskPath: was.diskPath
      }
      again.push(await preparedFile(file, bytes, extOf(was.diskPath), null, warn, { keepFormat: was.keepFormat }))
    }
    const retry = await client.uploadSiteAssets({ files: again, siteUuid, onProgress })
    result = {
      ...result,
      failed: [...result.failed.filter((f) => !f.stale), ...(retry.failed || [])],
      assetsByLocalUrl: { ...result.assetsByLocalUrl, ...retry.assetsByLocalUrl }
    }
    for (const f of again) files[files.findIndex((x) => x.localUrl === f.localUrl)] = f
  }
  const failed = [...(result.failed || [])]
  for (const f of failed)
    warn?.(`local-media: upload failed for ${f.path} (HTTP ${f.status})`)

  const map = {}
  // The identity half, for this backend's asset map in `sync.json`. The plan
  // returns an authoritative `id`+`ext` for every entry INCLUDING a `present: true`
  // dedup skip, so a re-push of unchanged media still records identity without
  // moving bytes — which is what makes the committed map cheap to keep accurate.
  const ids = {}
  for (const ref of keys) {
    const entry = result.assetsByLocalUrl[ref]
    if (!entry) continue
    // `served` — a fingerprint of the address, never the address. It is how a pull
    // recognizes this asset where the reference is a bare string with no room for an
    // id beside it (`info.preview`, `seo.image`, a section param); the header of
    // `@uniweb/build`'s asset-map.js says why a hash and not the URL.
    if (entry.id) {
      // A prepared picture also records the file it was made from and its stored size, so the next
      // push reuses it rather than preparing the file again (`preparedFile`).
      const sent = files.find((f) => f.localUrl === ref)
      ids[ref] = {
        id: entry.id,
        ext: entry.ext || '',
        ...(entry.serveUrl ? { served: servedFingerprint(entry.serveUrl) } : {}),
        ...(sent?.source ? { source: sent.source, size: sent.size } : {})
      }
    }
    // The backend's canonical serve URL, READ — never composed. An entry without
    // one is an asset we cannot address, and inventing a location for it is the
    // exact failure this lane exists to avoid: a guessed host is SILENTLY wrong,
    // where a missing one is visibly missing. So it joins `failed` and publish
    // refuses, rather than shipping content pointing somewhere nobody claimed.
    //
    // `serve_url` is part of the asset-plan contract: on EVERY entry, both
    // lanes, including entries reported as already `present`. Reconstruction
    // from a discovered `assetBase` was removed once the backend covered that
    // with a test of its own; it was the last hardcoded cross-deployment
    // constant in the CLI. (Confirmed 2026-08-17.)
    if (!entry.serveUrl) {
      warn?.(`local-media: ${ref} — the asset plan returned no serve_url`)
      failed.push({
        path: ref,
        status: 0,
        detail: 'asset plan entry carried no serve_url'
      })
      continue
    }
    map[ref] = entry.serveUrl
  }
  return { map, ids, missing, served, failed }
}

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
const extOf = (path) => (basename(path).match(/\.([^.]+)$/)?.[1] || '').toLowerCase()

/**
 * The plan entry for a picture a page shows, stored as `prepareImage` makes it. Three cases, by what
 * this backend's asset map records for the ref:
 *
 * - **Prepared before, from these same bytes** (`source` is their hash): planned by the identity it
 *   recorded, with no bytes, so nothing is prepared again. The backend still holding it, the plan
 *   says so and nothing moves. If it doesn't, `load` prepares the file again. So a change to the
 *   rule never prepares, uploads or charges an unchanged picture again, and its pages don't change.
 * - **Stored as it is, before pictures were prepared** (no `source`, and the id is these bytes'
 *   hash, the asset plan's content address): left as it is, and its source recorded.
 * - **New or changed:** prepared now.
 *
 * @param {object} file - the plan entry for the file as it is
 * @param {Buffer} bytes - the file
 * @param {string} ext - its extension
 * @param {object|undefined|null} prior - its entry in the asset map
 * @param {(m: string) => void} [warn]
 * @param {{ keepFormat?: boolean }} [options] - a picture other software fetches by its address
 */
async function preparedFile(file, bytes, ext, prior, warn, { keepFormat = false } = {}) {
  const source = file.sha256
  const key = file.path
  if (prior?.source === source && prior.id && prior.ext && Number.isInteger(prior.size)) {
    return {
      ...file,
      key,
      path: storedPath(key, ext, prior.ext),
      content_type: contentTypeFor(`x.${prior.ext}`),
      size: prior.size,
      sha256: prior.id,
      source,
      keepFormat,
      load: async () => (await prepareImage(bytes, ext, { keepFormat })).bytes
    }
  }
  if (prior && !prior.source && prior.id === source) return { ...file, key, source }

  const prepared = await prepareImage(bytes, ext, { keepFormat })
  if (prepared.unreadable) {
    warn?.(`local-media: ${file.localUrl} is uploaded as it is: it can't be converted here, and some browsers can't show it`)
  }
  return {
    ...file,
    key,
    path: storedPath(key, ext, prepared.ext),
    content_type: contentTypeFor(`x.${prepared.ext}`),
    size: prepared.bytes.length,
    sha256: sha256(prepared.bytes),
    bytes: prepared.bytes,
    source,
    keepFormat
  }
}

/**
 * The plan's key for a prepared file. The backend types an upload by its extension, so a picture
 * stored as a WebP goes by one ending in `.webp`: its own key with the extension added, which keeps
 * it apart from every other file's.
 */
function storedPath(key, ext, storedExt) {
  return storedExt === ext ? key : `${key}.${storedExt}`
}

// ─── Asset-plan refusals ──────────────────────────────────────────────────────
//
// There is deliberately NO status-based refusal predicate here, and re-adding
// one would be a mistake. None of the statuses such a heuristic would match
// means what it looks like —
//   507  reserved for `storage_quota_exceeded`, but status alone cannot tell it
//        from any other 507, and carries none of the numbers a user needs;
//   402  never from assets — it is the publish billing-consent gate, so matching it
//        labels a billing refusal a storage problem and tells the user to free space
//        they do not need;
//   413  comes from the upload PUT, which collects into `failed[]` and never throws,
//        so it cannot reach a catch around the plan.
// The plan's caps (64 MiB/file, 512 MiB/plan, 1024 files) refuse with `400`, which
// a 402/413/507 predicate never matched at all.
//
// Branch on `reason` instead — never on status, never on `detail` (prose, subject to
// rewording). Same house style as the push-staleness `reason: "stale_base"` in
// site-sync.js.

// Append `label: <bytes>` when the value is a usable number. A refusal that omits an
// extra still produces a useful message — never print `undefined` at a user.
function pushBytes(lines, label, n) {
  const h = humanBytes(n)
  if (h) lines.push(`  ${label}: ${h}`)
}

/**
 * Turn an asset-plan refusal into user-facing lines, or null when this is not a
 * refusal we recognise. Null means "fall through to the generic error", so this
 * degrades rather than swallowing.
 *
 * ⛔ This comment used to assert that the typed `reason` values were "agreed but
 * NOT YET EMITTED" — an unverified claim about ANOTHER LANE's deployed state,
 * sitting in our source where it read as fact and nobody would think to re-check
 * it. That is the precise shape that cost the backend lane a metering hole (a
 * comment claiming what the app sent, wrong the whole time). What we can say is
 * ours: we branch on `reason` and fall through cleanly when there is none, so
 * this function is correct whether or not any given backend emits one, and no
 * sentence here needs to track what a deployment is running.
 *
 * Two wording rules are load-bearing and come from the ratified accounting model,
 * not from taste:
 *
 *   1. **Never size a storage refusal from what was transferred.** `needed_bytes` is
 *      "assets not yet on this workspace's books", which can be non-zero with ZERO
 *      transfers — another workspace already uploaded the same bytes, so they come
 *      back `present: true`, never PUT, and are charged here anyway. A push can print
 *      no `↑` line at all and still be refused, so the message must talk about assets
 *      new to the workspace, never "the files being uploaded".
 *   2. **Never advise removing an image to free space.** Freeing is
 *      entity-deletion-granular: editing an image out of live content frees nothing.
 *      Only deleting the entity (or the site) it was uploaded for returns quota.
 *      The predicate this replaced said "remove or shrink assets, then re-run" —
 *      advice that is now simply wrong.
 *
 * @param {Error & { problem?: object|null }} err
 * @returns {{ headline: string, notes: string[] } | null}
 */
export function describeAssetRefusal(err) {
  const reason = err?.problem?.reason
  if (typeof reason !== 'string') return null
  const p = err.problem
  const notes = []

  switch (reason) {
    case 'storage_quota_exceeded': {
      pushBytes(notes, 'Used', p.used_bytes)
      pushBytes(notes, 'Limit', p.limit_bytes)
      // Rule 1: this is what the workspace must take on, not what would transfer.
      pushBytes(notes, 'This publish adds', p.needed_bytes)
      notes.push(
        'Assets already on its books cost nothing to re-present, so a change'
      )
      notes.push('that touches only content is never refused here.')
      // Rule 2.
      notes.push(
        'Quota is returned by deleting the site or entity an asset was uploaded'
      )
      notes.push('for — removing an image from content does not free it.')
      // Rule 3: the allowance belongs to whoever OWNS the site, not to whoever is
      // pushing — an asset is charged to the workspace of the entity it is for, so
      // a push to an org site spends the org's allowance whatever context the
      // pusher acts in. "Your storage" would be wrong for every contributor who is
      // not the owner, and wrong in the direction that sends them looking through
      // their own files for space that was never theirs.
      return {
        headline:
          "Storage quota reached — the site owner's workspace cannot take on more assets.",
        notes
      }
    }
    case 'asset_file_too_large': {
      const path = typeof p.path === 'string' ? p.path : null
      pushBytes(notes, 'Size', p.size_bytes)
      pushBytes(notes, 'Per-file limit', p.limit_bytes)
      return {
        headline: `Asset too large${path ? `: ${path}` : ''}`,
        notes: [...notes, 'Shrink or re-encode the file, then re-run.']
      }
    }
    case 'asset_plan_too_large': {
      pushBytes(notes, 'This publish', p.requested_bytes)
      pushBytes(notes, 'Per-publish limit', p.limit_bytes)
      return {
        headline: 'Too many bytes in one publish.',
        notes: [
          ...notes,
          'Split the media across publishes, or shrink the largest files.'
        ]
      }
    }
    case 'asset_plan_too_many_files': {
      if (Number.isFinite(p.files)) notes.push(`  Files: ${p.files}`)
      if (Number.isFinite(p.limit))
        notes.push(`  Per-publish limit: ${p.limit}`)
      return {
        headline: 'Too many asset files in one publish.',
        notes: [...notes, 'Split the media across publishes.']
      }
    }
    default:
      // An unrecognised reason is still more useful than nothing, but we do not
      // invent advice for it — surface it and let the generic detail follow.
      return {
        headline: `Asset upload refused by the backend (${reason}).`,
        notes: []
      }
  }
}
