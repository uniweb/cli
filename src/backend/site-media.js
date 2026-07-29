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

// There is deliberately NO storage-refusal predicate here, and re-adding one that
// branches on status would be a mistake. Settled with the backend 2026-07-29
// (channel `framework-backend-303c`): the asset lane has **no storage quota today**,
// and none of the three statuses such a heuristic would match means what it looks
// like —
//   507  never emitted anywhere in the backend;
//   402  never from assets — it is the publish billing-consent gate, so matching it
//        labels a billing refusal a storage problem and tells the user to free space
//        they do not need;
//   413  comes from the upload PUT, which collects into `failed[]` and never throws,
//        so it cannot reach a catch around the plan.
// The plan's real caps (64 MiB/file, 512 MiB/plan, 1024 files) refuse with `400`.
//
// When the quota ships, its refusal carries a machine-readable `reason` plus
// used/limit/needed bytes — branch on `reason`, never on status, and never on
// `detail` (prose, subject to rewording). Same house style as the push-staleness
// `reason: "stale_base"`. Contract: `kb/framework/build/delivery-lane.md` §Assets.
