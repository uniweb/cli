/**
 * Upload a site's local media to the backend's content-addressed asset store via the
 * SAME asset lane the data bundle rides, and return a `{ ref → serveUrl }` map for the
 * deploy's second emit (`assetRewrite`) to swap the entity content refs for.
 *
 * Input is the site-root asset refs the producer surfaced in
 * `emitSyncPackages().localAssets` (`/images/hero.png`); `resolveAssetPath` finds the
 * file under the site's `public/` (or `assets/`). A ref whose file is missing is
 * skipped (warned), never a broken serve URL. The serve URL is the backend's canonical
 * `serve_url` when present, else reconstructed from `id`+`assetBase` (the dev fallback).
 * Content-addressed like every asset: identical bytes → same id → a re-deploy of
 * unchanged media is a cheap no-op PUT (the lane's `present` skip-list).
 */

import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { resolveAssetPath } from '@uniweb/build/site'
import { buildAssetUrl } from '../utils/asset-upload.js'
import { contentTypeFor } from '../utils/code-upload.js'

/**
 * @param {object} client - BackendClient (origin + uploadSiteAssets + discover)
 * @param {string} siteDir - the site root (site-root refs resolve under public/)
 * @param {string[]} refs - site-root local asset refs (`/images/x.png`)
 * @param {{ onProgress?: (m: string) => void, warn?: (m: string) => void }} [opts]
 * @returns {Promise<{ map: Record<string,string>, missing: string[], failed: Array<{path:string,status:number,detail?:string}> }>}
 *   `map` is ref → serve URL for refs that resolved AND uploaded. The two failure
 *   kinds are reported SEPARATELY because callers must treat them differently:
 *   `missing` is a ref with no file under the site — an authoring mistake, already
 *   broken before us, worth a warning; `failed` is a ref whose bytes we could not
 *   store — a transport or QUOTA refusal, and shipping content that still points at
 *   the local path would publish a broken image while only warning about it.
 */
export async function uploadSiteMedia(client, siteDir, refs, { onProgress, warn } = {}) {
  if (!refs?.length) return { map: {}, missing: [], failed: [] }

  const files = []
  const missing = []
  for (const ref of refs) {
    const { resolved } = resolveAssetPath(ref, siteDir, siteDir)
    if (!resolved || !existsSync(resolved)) {
      warn?.(`local-media: ${ref} not found under the site (skipped)`)
      missing.push(ref)
      continue
    }
    const bytes = readFileSync(resolved)
    files.push({
      path: ref.replace(/^\/+/, ''), // bookkeeping key into the plan (must be unique)
      content_type: contentTypeFor(basename(resolved)),
      size: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      localUrl: ref, // the rewrite key — the original content ref
      diskPath: resolved,
    })
  }
  if (!files.length) return { map: {}, missing, failed: [] }

  const result = await client.uploadSiteAssets({ files, onProgress })
  const failed = result.failed || []
  for (const f of failed) warn?.(`local-media: upload failed for ${f.path} (HTTP ${f.status})`)

  const config = await client.discover()
  const map = {}
  for (const ref of refs) {
    const entry = result.assetsByLocalUrl[ref]
    if (entry) map[ref] = entry.serveUrl || buildAssetUrl(client.origin, config.assetBase, entry.id, entry.ext)
  }
  return { map, missing, failed }
}

// ─── Asset-plan refusals ──────────────────────────────────────────────────────
//
// There is deliberately NO status-based refusal predicate here, and re-adding one
// would be a mistake. None of the statuses such a heuristic would match
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

const KIB = 1024
function humanBytes(n) {
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return null
  if (n < KIB) return `${n} B`
  const units = ['KiB', 'MiB', 'GiB', 'TiB']
  let v = n / KIB
  let i = 0
  while (v >= KIB && i < units.length - 1) {
    v /= KIB
    i++
  }
  return `${v >= 10 || Number.isInteger(v) ? Math.round(v) : v.toFixed(1)} ${units[i]}`
}

// Append `label: <bytes>` when the value is a usable number. A refusal that omits an
// extra still produces a useful message — never print `undefined` at a user.
function pushBytes(lines, label, n) {
  const h = humanBytes(n)
  if (h) lines.push(`  ${label}: ${h}`)
}

/**
 * Turn an asset-plan refusal into user-facing lines, or null when this is not a
 * refusal we recognise (including every refusal shipped today, which is still
 * prose — the typed `reason` values are agreed but NOT YET EMITTED). Null means
 * "fall through to the generic error", so this degrades rather than swallowing.
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
      notes.push('Assets already on this workspace\'s books cost nothing to re-present,')
      notes.push('so a change that touches only content is never refused here.')
      // Rule 2.
      notes.push('Quota is returned by deleting the site or entity an asset was uploaded')
      notes.push('for — removing an image from content does not free it.')
      return { headline: 'Storage quota reached — this workspace cannot take on more assets.', notes }
    }
    case 'asset_file_too_large': {
      const path = typeof p.path === 'string' ? p.path : null
      pushBytes(notes, 'Size', p.size_bytes)
      pushBytes(notes, 'Per-file limit', p.limit_bytes)
      return {
        headline: `Asset too large${path ? `: ${path}` : ''}`,
        notes: [...notes, 'Shrink or re-encode the file, then re-run.'],
      }
    }
    case 'asset_plan_too_large': {
      pushBytes(notes, 'This publish', p.requested_bytes)
      pushBytes(notes, 'Per-publish limit', p.limit_bytes)
      return {
        headline: 'Too many bytes in one publish.',
        notes: [...notes, 'Split the media across publishes, or shrink the largest files.'],
      }
    }
    case 'asset_plan_too_many_files': {
      if (Number.isFinite(p.files)) notes.push(`  Files: ${p.files}`)
      if (Number.isFinite(p.limit)) notes.push(`  Per-publish limit: ${p.limit}`)
      return {
        headline: 'Too many asset files in one publish.',
        notes: [...notes, 'Split the media across publishes.'],
      }
    }
    default:
      // An unrecognised reason is still more useful than nothing, but we do not
      // invent advice for it — surface it and let the generic detail follow.
      return { headline: `Asset upload refused by the backend (${reason}).`, notes: [] }
  }
}
