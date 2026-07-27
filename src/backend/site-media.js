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

/**
 * Is this asset-lane error the backend refusing on storage grounds?
 *
 * The plan step throws `Asset plan failed: HTTP <status>` for any non-2xx, so a quota
 * refusal is currently indistinguishable from any other rejection except by status.
 * These three are the plausible spellings — 402 (payment required), 413 (payload too
 * large), 507 (insufficient storage).
 *
 * DELIBERATELY a heuristic, and it should not stay one: the backend owes a typed
 * error carrying used / limit / needed so the CLI can say what a push costs and what
 * is left. Until that contract exists this at least turns an opaque HTTP number into
 * the right advice. See the collab charter in the handoff.
 *
 * @param {Error} err
 * @returns {boolean}
 */
export function isStorageRefusal(err) {
  return /Asset plan failed: HTTP (402|413|507)\b/.test(err?.message || '')
}
