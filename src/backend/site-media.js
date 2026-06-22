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
 * @returns {Promise<Record<string,string>>} ref → serve URL (only resolved + uploaded refs)
 */
export async function uploadSiteMedia(client, siteDir, refs, { onProgress, warn } = {}) {
  if (!refs?.length) return {}

  const files = []
  for (const ref of refs) {
    const { resolved } = resolveAssetPath(ref, siteDir, siteDir)
    if (!resolved || !existsSync(resolved)) {
      warn?.(`local-media: ${ref} not found under the site (skipped)`)
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
  if (!files.length) return {}

  const result = await client.uploadSiteAssets({ files, onProgress })
  for (const f of result.failed || []) warn?.(`local-media: upload failed for ${f.path} (HTTP ${f.status})`)

  const config = await client.discover()
  const map = {}
  for (const ref of refs) {
    const entry = result.assetsByLocalUrl[ref]
    if (entry) map[ref] = entry.serveUrl || buildAssetUrl(client.origin, config.assetBase, entry.id, entry.ext)
  }
  return map
}
