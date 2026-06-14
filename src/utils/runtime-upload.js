/**
 * Runtime registration — the framework half of `uniweb runtime register`.
 *
 * Uploads a built `@uniweb/runtime` to the backend so it can serve the runtime
 * version. Mirrors the foundation code lane (utils/code-upload.js): plan →
 * PUT-per-file, one mode-aware auth rule.
 *
 * The runtime is a SYSTEM artifact — registering it requires **@std membership**
 * (a non-@std bearer 403s). Versioned by version alone (no scope/name).
 *
 * A runtime version is ONE unit with two halves, BOTH uploaded here (the backend
 * stages the bytes; where/how it serves them is its decision — we don't assume a
 * serve path, we read `serve_base` back from the plan):
 *   - dist/app/**          the browser SPA (_importmap/, assets/, index.html,
 *                          manifest.json) — boots + client-renders a site.
 *   - dist/worker-runtime.js + dist/shims/*.js   the ssr-edge isolate set (4
 *                          files): the inlined SSR bundle + its 3 globalThis-bridge
 *                          shims (react, react/jsx-runtime, @uniweb/core). The
 *                          isolate can't resolve react without the shims.
 *
 * NOT uploaded: the SSR *orchestrator* (the isolate's `entry.js` boot module). It's
 * a serverless-isolate fetch handler encoding the platform's isolate dispatch
 * protocol — owned by the platform's SSR layer, not a framework artifact. The
 * framework ships the render API the orchestrator imports (worker-runtime.js
 * exports initPrerenderForLocale / renderPage / injectPageContent / hydrateDataStore).
 *
 * Contract — AGREED with the backend (2026-06-14):
 *   PLAN   POST {apiBase}/dev/runtime
 *          { version, files: [{ path, content_type, size, sha256 }] }
 *          → { mode, expires_in, serve_base, uploads: [{ path, method, url, headers }] }
 *          bearer; @std required (else 403, RFC7807 problem+json, op "runtime-register").
 *   UPLOAD PUT each file (direct → bearer; presigned → none; x-uniweb-sha256).
 *          MANIFEST LAST — discovery keys a version's existence on manifest.json,
 *          so a partial upload never advertises a half-delivered version.
 *   SERVE  the backend's call (read `serve_base` from the plan; we never construct it).
 */

import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { contentTypeFor } from './code-upload.js'

const WORKER_RUNTIME = 'worker-runtime.js'
const SHIMS_DIR = 'shims'
const MANIFEST = 'manifest.json'

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
 * everything under `dist/app/**` at the root, plus `dist/worker-runtime.js` and
 * the `dist/shims/*.js` it depends on. Sourcemaps (`*.map`) are excluded (dev-only,
 * not CDN-served). Returns `[]` when `dist/app/` is missing (the runtime isn't
 * built). The worker bundle + shims are collected when present (graceful when not).
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
  // The SSR isolate's globalThis-bridge shims ride alongside worker-runtime.js,
  // served at shims/*.js. They're part of the ssr-edge artifact SET — the isolate
  // can't resolve `react` without them — so collect the whole dir when present.
  const shimsDir = join(distDir, SHIMS_DIR)
  if (existsSync(shimsDir)) walk(shimsDir, SHIMS_DIR)
  // MANIFEST LAST: the backend keys a version's existence on manifest.json (no
  // server confirm step), so uploading it last means a partial delivery never
  // advertises a half-built version. Reorder regardless of walk order.
  const manifest = files.filter((f) => f.path === MANIFEST)
  if (!manifest.length) return files
  return [...files.filter((f) => f.path !== MANIFEST), ...manifest]
}

/** True when the worker SSR bundle is in the collected set. */
export function hasWorkerRuntime(files) {
  return files.some((f) => f.path === WORKER_RUNTIME)
}

/** True when any SSR-isolate shim (shims/*.js) is in the collected set. */
export function hasShims(files) {
  return files.some((f) => f.path.startsWith(`${SHIMS_DIR}/`))
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
  const planRes = await fetch(`${origin}/dev/runtime`, {
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
