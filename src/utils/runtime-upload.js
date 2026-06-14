/**
 * Runtime registration — the framework half of `uniweb runtime register`.
 *
 * Uploads a built `@uniweb/runtime` to the backend's runtime registry, served at
 * `/gateway/runtime/{version}/`. Mirrors the foundation code lane
 * (utils/code-upload.js): plan → PUT-per-file (content-addressed), one auth rule.
 *
 * The runtime is a SYSTEM artifact — the backend gates this route to **@std
 * members** (a non-@std bearer 403s). Versioned by version alone (no scope/name).
 *
 * Artifact set (built by `pnpm build` in framework/runtime + the worker bundle):
 *   - dist/app/**            → /gateway/runtime/{version}/...        (browser SPA:
 *                              _importmap/, assets/, index.html, manifest.json)
 *   - dist/worker-runtime.js → /gateway/runtime/{version}/worker-runtime.js
 *                              (the Workers-isolate SSR bundle)
 *
 * ASSUMED backend contract — built our-side-first (Diego, 2026-06-14); reconcile
 * with the backend before relying on it (the delivery-lane design named a
 * `/dev/registry/runtime` route as "decided-but-deferred"; this is it):
 *   PLAN   POST {apiBase}/dev/registry/runtime
 *          { version, files: [{ path, content_type, size, sha256 }] }
 *          → { mode, expires_in, serve_base, uploads: [{ path, method, url, headers }] }
 *          bearer; @std membership required (403 otherwise).
 *   UPLOAD PUT each file (direct → bearer; presigned → none; x-uniweb-sha256).
 *   SERVE  GET /gateway/runtime/{version}/{path}  (anonymous, immutable, CORS).
 */

import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { contentTypeFor } from './code-upload.js'

const WORKER_RUNTIME = 'worker-runtime.js'

function fileEntry(diskPath, path) {
  const bytes = readFileSync(diskPath)
  return {
    path,
    content_type: contentTypeFor(path),
    size: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    diskPath,
  }
}

/**
 * Collect a built runtime's upload set from `distDir` (framework/runtime/dist):
 * everything under `dist/app/**` at the root, plus `dist/worker-runtime.js`.
 * Sourcemaps (`*.map`) are excluded (dev-only, not CDN-served). Returns `[]` when
 * `dist/app/` is missing (the runtime isn't built).
 *
 * @param {string} distDir - framework/runtime/dist
 * @returns {Array<{ path, content_type, size, sha256, diskPath }>}
 */
export function collectRuntimeFiles(distDir) {
  const appDir = join(distDir, 'app')
  if (!existsSync(appDir)) return []
  const files = []
  const walk = (dir, prefix) => {
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name)
      const rel = prefix ? `${prefix}/${name}` : name
      const st = statSync(full)
      if (st.isDirectory()) walk(full, rel)
      else if (st.isFile() && !rel.endsWith('.map')) files.push(fileEntry(full, rel))
    }
  }
  walk(appDir, '')
  const worker = join(distDir, WORKER_RUNTIME)
  if (existsSync(worker)) files.push(fileEntry(worker, WORKER_RUNTIME))
  return files
}

/** True when the worker SSR bundle is in the collected set. */
export function hasWorkerRuntime(files) {
  return files.some((f) => f.path === WORKER_RUNTIME)
}

/**
 * Plan + upload a built runtime. Throws on a plan-level failure (the caller maps
 * 403 → "@std only"); per-file PUT failures surface in `failed`.
 *
 * @param {object} opts - { apiBase, token, version, distDir, files?, onProgress? }
 * @returns {Promise<{ mode, uploaded: string[], failed: Array, serveBase: string|null }>}
 */
export async function uploadRuntime({ apiBase, token, version, distDir, files, onProgress = () => {} }) {
  const list = files || collectRuntimeFiles(distDir)
  if (!list.length) return { mode: 'none', uploaded: [], failed: [], serveBase: null }

  const origin = apiBase.replace(/\/$/, '')
  const planRes = await fetch(`${origin}/dev/registry/runtime`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      version,
      files: list.map(({ path, content_type, size, sha256 }) => ({ path, content_type, size, sha256 })),
    }),
  })
  if (!planRes.ok) {
    const detail = await planRes.text().catch(() => '')
    const err = new Error(`runtime plan rejected: HTTP ${planRes.status}${detail ? ` — ${detail.slice(0, 300)}` : ''}`)
    err.status = planRes.status
    throw err
  }
  const plan = await planRes.json()
  const targets = new Map((plan.uploads || []).map((u) => [u.path, u]))
  // The one mode-aware bit: direct PUTs are bearer-authed backend routes;
  // presigned URLs are self-authorizing and must NOT carry a foreign bearer.
  const authHeaders = plan.mode === 'presigned' ? {} : { Authorization: `Bearer ${token}` }

  const uploaded = []
  const failed = []
  for (const f of list) {
    const target = targets.get(f.path)
    if (!target) {
      failed.push({ path: f.path, status: 0, detail: 'no upload target in plan' })
      continue
    }
    onProgress(`↑ ${f.path}`)
    let res
    try {
      res = await fetch(new URL(target.url, origin), {
        method: target.method || 'PUT',
        headers: { ...(target.headers || {}), ...authHeaders, 'x-uniweb-sha256': f.sha256 },
        body: readFileSync(f.diskPath),
      })
    } catch (err) {
      failed.push({ path: f.path, status: 0, detail: err.message })
      continue
    }
    if (res.ok) uploaded.push(f.path)
    else failed.push({ path: f.path, status: res.status, detail: (await res.text().catch(() => '')).slice(0, 200) })
  }
  return { mode: plan.mode || 'direct', uploaded, failed, serveBase: plan.serve_base || null }
}
