/**
 * Site asset delivery — the asset lane for `uniweb deploy` (channel
 * framework-backend-f90d). After the link build processes a site's media into
 * `dist/assets/`, those bytes are delivered to the backend's content-addressed
 * asset store, and the deploy step rewrites the content's local refs to durable
 * serve URLs:
 *
 *   1. PLAN   — POST {apiBase}/dev/assets with the file list ({ path,
 *               content_type, size, sha256 }). `sha256` is REQUIRED — it is the
 *               content address. The response carries one entry per file
 *               ({ path, id, ext, present?, method, url, headers }) plus mode:
 *               'direct' (dev — URLs point back at the backend) or 'presigned'
 *               (prod — storage PUTs). `id` is the lowercase-hex sha256 of the
 *               bytes; we READ it from the response (never depend on id == sha256)
 *               so the client stays correct if the derivation ever changes.
 *   2. UPLOAD — PUT each NEW file's raw bytes to its URL with the given headers.
 *               Order is irrelevant (unlike code-upload, there is no "entry").
 *               Skip-list: an entry the plan marks `present: true` is already in
 *               the content-addressed store, so we SKIP the PUT but still record
 *               its id+ext for the rewrite. Absent `present` ⇒ false — an older
 *               backend without the flag uploads everything (today's behavior).
 *
 * Assets are GLOBAL + content-addressed: identical bytes → same id → dedup
 * across sites and idempotent re-deploys (a re-PUT is a cheap no-op). This
 * mirrors the foundation code lane (utils/code-upload.js); the one structural
 * difference is that the backend MINTS the per-asset id, so the plan response is
 * what the deploy step rewrites content references to.
 *
 * Contract: kb/framework/build/delivery-lane.md §Assets.
 */

import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { contentTypeFor } from './code-upload.js'

/**
 * Walk a built site's `dist/assets/` and produce the upload file list. `path` is
 * POSIX-relative to distDir (e.g. `assets/hero-ab12cd34.webp`); `localUrl` is how
 * the built content references the asset (`/assets/...`) — the rewrite key.
 * Returns `[]` when there is no `assets/` dir (an image-free site).
 *
 * @param {string} distDir - the site's built dist/ directory
 * @returns {Array<{ path: string, content_type: string, size: number, sha256: string, localUrl: string, diskPath: string }>}
 */
export function collectSiteAssets(distDir) {
  const assetsDir = join(distDir, 'assets')
  if (!existsSync(assetsDir)) return []
  const files = []
  const walk = (dir, prefix) => {
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name)
      const rel = prefix ? `${prefix}/${name}` : name
      const st = statSync(full)
      if (st.isDirectory()) {
        walk(full, rel)
      } else if (st.isFile()) {
        const bytes = readFileSync(full)
        files.push({
          path: `assets/${rel}`,
          content_type: contentTypeFor(name),
          size: st.size,
          sha256: createHash('sha256').update(bytes).digest('hex'),
          localUrl: `/assets/${rel}`,
          diskPath: full,
        })
      }
    }
  }
  walk(assetsDir, '')
  return files
}

/**
 * Deliver a site's assets: plan, then PUT each NEW file. Returns the rewrite map
 * (`localUrl → { id, ext }`) — populated for files that uploaded successfully OR
 * that the plan reports already `present`, so a partial failure never injects a
 * broken serve URL into content. Throws only on a plan-level failure; per-file
 * PUT failures surface in `failed`.
 *
 * Skip-list (content-addressed dedup): a plan entry with `present: true` is
 * already in the global store — we don't re-PUT it, but we DO record its id+ext
 * so the rewrite covers every asset. A backend that omits the flag (absent ⇒
 * false) uploads everything, exactly as before.
 *
 * @param {object} opts
 * @param {string} opts.apiBase  - backend origin (e.g. http://localhost:8080)
 * @param {string} opts.token    - bearer (same session as deploy/register)
 * @param {string} opts.distDir  - the site's built dist/ directory
 * @param {Array}  [opts.files]  - pre-collected list (default: collectSiteAssets)
 * @param {(msg: string) => void} [opts.onProgress]
 * @returns {Promise<{ mode: string, uploaded: string[], skipped: string[], failed: Array<{path, status, detail}>, assetsByLocalUrl: Record<string, { id: string, ext: string }> }>}
 */
export async function uploadSiteAssets({ apiBase, token, distDir, files, onProgress = () => {} }) {
  const list = files || collectSiteAssets(distDir)
  if (!list.length) {
    return { mode: 'none', uploaded: [], skipped: [], failed: [], assetsByLocalUrl: {} }
  }

  const origin = apiBase.replace(/\/$/, '')
  const planRes = await fetch(`${origin}/dev/assets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      files: list.map(({ path, content_type, size, sha256 }) => ({ path, content_type, size, sha256 })),
    }),
  })
  if (!planRes.ok) {
    const detail = await planRes.text().catch(() => '')
    throw new Error(
      `Asset plan failed: HTTP ${planRes.status} ${planRes.statusText}${detail ? ` — ${detail.slice(0, 300)}` : ''}`
    )
  }
  const plan = await planRes.json()
  const mode = plan.mode || 'direct'
  const uploads = Array.isArray(plan.uploads) ? plan.uploads : []
  const byPath = new Map(list.map((f) => [f.path, f]))

  const uploaded = []
  const skipped = []
  const failed = []
  const assetsByLocalUrl = {}

  for (const up of uploads) {
    const src = byPath.get(up.path)
    if (!src) continue // backend echoed a path we didn't send — ignore

    // Skip-list: the bytes are already in the content-addressed store. No PUT,
    // but still record id+ext so the rewrite covers this asset. `present` absent
    // ⇒ false (older backend) → falls through to the upload path below.
    if (up.present) {
      skipped.push(src.path)
      assetsByLocalUrl[src.localUrl] = { id: up.id, ext: String(up.ext || '').replace(/^\./, '') }
      continue
    }

    const headers = { ...(up.headers || {}), 'x-uniweb-sha256': src.sha256 }
    // Direct-mode PUTs are authed requests to the backend; presigned URLs are
    // self-signed, so a foreign auth header can break the SigV4 target. This is
    // the only mode-aware line in the client (same rule as code-upload).
    if (mode !== 'presigned') headers.Authorization = `Bearer ${token}`
    onProgress(`↑ ${src.path}`)
    let putRes
    try {
      // The plan's url may be origin-relative (direct mode → uniwebd) or
      // absolute (presigned → storage); new URL() resolves both.
      putRes = await fetch(new URL(up.url, origin), { method: up.method || 'PUT', headers, body: src.bytes ?? readFileSync(src.diskPath) })
    } catch (err) {
      failed.push({ path: src.path, status: 0, detail: err.message })
      continue
    }
    if (putRes.ok) {
      uploaded.push(src.path)
      // Authoritative id + ext from the plan; mapped only on a successful PUT.
      assetsByLocalUrl[src.localUrl] = { id: up.id, ext: String(up.ext || '').replace(/^\./, '') }
    } else {
      failed.push({ path: src.path, status: putRes.status, detail: await putRes.text().catch(() => '') })
    }
  }

  return { mode, uploaded, skipped, failed, assetsByLocalUrl }
}

// Build a durable asset serve URL from /dev/config's assetBase. Origin-relative
// (`/gateway/asset/` in dev) → prepend the backend origin; absolute (a prod CDN)
// → used verbatim. Shape: {assetBase}dist/{id}/base.{ext} — basename literally
// `base`, {ext} the source extension the plan echoed.
export function buildAssetUrl(origin, assetBase, id, ext) {
  const base = /^https?:\/\//.test(assetBase) ? assetBase : `${origin}${assetBase}`
  return `${base.replace(/\/$/, '')}/dist/${id}/base.${ext}`
}
