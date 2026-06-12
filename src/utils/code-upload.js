/**
 * Foundation code delivery — the phase-2 client of `uniweb register`.
 *
 * After a successful schema registration, the foundation's built `dist/`
 * bytes are delivered to the registry in two steps (contract:
 * foundation-code-upload.md, beside uwx-format.md):
 *
 *   1. PLAN   — POST {apiBase}/dev/registry/code-uploads with the file list
 *               ({ path, content_type, size, sha256? }). The response carries
 *               one upload target per file ({ path, method, url, headers })
 *               plus mode: 'direct' (dev — URLs point back at uniwebd) or
 *               'presigned' (prod — storage PUTs; bytes never transit the
 *               backend). The CLI never branches on the mode.
 *   2. UPLOAD — PUT each file's raw bytes to its URL with the given headers.
 *               The ENTRY uploads LAST: a partial upload never yields a
 *               loadable version (practical atomicity — there is no server
 *               confirm step by design).
 *
 * In direct mode the entry is fetched back from the anonymous serve route
 * (GET /gateway/foundation/{scope}/{name}/{version}/{path}) and compared
 * byte-for-byte — the e2e proof that the version is live.
 *
 * Rules encoded here (the backend validates too — reject, never repair):
 *   - paths are dist/-relative, '/'-separated, URL-safe verbatim
 *   - `meta/**` is EXCLUDED from the upload set: schema custody is the
 *     registry's entity store, and the gateway serves anonymously while
 *     schemas are authenticated content everywhere else (no public catalog)
 *   - a registered version is immutable, code included — changed bytes mean
 *     a new version (re-PUTting identical bytes is a safe no-op)
 */

import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

// Extension → declared content type. Extension-honest by construction (Vite
// output); anything unknown ships as octet-stream.
const CONTENT_TYPES = {
  js: 'text/javascript',
  mjs: 'text/javascript',
  css: 'text/css',
  map: 'application/json',
  json: 'application/json',
  wasm: 'application/wasm',
  woff2: 'font/woff2',
  woff: 'font/woff',
  ttf: 'font/ttf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  webp: 'image/webp',
  avif: 'image/avif',
  ico: 'image/x-icon',
  txt: 'text/plain',
  html: 'text/html',
}

export function contentTypeFor(path) {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase()
  return CONTENT_TYPES[ext] || 'application/octet-stream'
}

/** The dist-root entry file — uploaded last, verified after. */
export const ENTRY_PATH = 'entry.js'

/**
 * Walk a built dist/ and produce the upload file list.
 * Excludes `meta/**` (see header). Paths are POSIX-relative to distDir.
 *
 * @param {string} distDir
 * @returns {Array<{ path: string, content_type: string, size: number, sha256: string }>}
 */
export function collectDistFiles(distDir) {
  const files = []
  const walk = (dir, prefix) => {
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name)
      const rel = prefix ? `${prefix}/${name}` : name
      const st = statSync(full)
      if (st.isDirectory()) {
        if (rel === 'meta') continue // schema custody + no-public-catalog
        walk(full, rel)
      } else if (st.isFile()) {
        const bytes = readFileSync(full)
        files.push({
          path: rel,
          content_type: contentTypeFor(rel),
          size: st.size,
          sha256: createHash('sha256').update(bytes).digest('hex'),
        })
      }
    }
  }
  walk(distDir, '')
  return files
}

/** Entry-last upload order (practical atomicity — see header). */
export function uploadOrder(files) {
  const entry = files.filter((f) => f.path === ENTRY_PATH)
  const rest = files.filter((f) => f.path !== ENTRY_PATH)
  return [...rest, ...entry]
}

/**
 * The gateway serve URL for a file of a registered foundation version.
 * Mirrors the backend storage convention: scope WITHOUT the '@'.
 * Prefer the plan response's `serve_base` when present.
 */
export function gatewayUrl(apiBase, name, version, path) {
  const m = /^@([^/]+)\/(.+)$/.exec(name)
  const scope = m ? m[1] : ''
  const base = m ? m[2] : name
  const origin = apiBase.replace(/\/$/, '')
  return `${origin}/gateway/foundation/${scope}/${base}/${version}/${path}`
}

/**
 * Deliver a foundation's code: plan, upload (entry last), verify (direct
 * mode). Returns a result object; throws only on plan-level failures.
 *
 * @param {object} opts
 * @param {string} opts.apiBase  - registry origin (e.g. http://localhost:8080)
 * @param {string} opts.token    - bearer (same session as register)
 * @param {string} opts.name     - '@scope/name'
 * @param {string} opts.version  - the registered semver
 * @param {string} opts.distDir  - the built dist/ directory
 * @param {Array}  [opts.files]  - pre-collected file list (default: collect)
 * @param {(msg: string) => void} [opts.onProgress]
 * @returns {Promise<{ mode: string, uploaded: string[], failed: Array<{path, status, detail}>, verified: boolean|null, serveBase: string|null }>}
 */
export async function uploadFoundationCode({
  apiBase,
  token,
  name,
  version,
  distDir,
  files,
  onProgress = () => {},
}) {
  const list = files || collectDistFiles(distDir)
  if (!list.length) {
    return { mode: 'none', uploaded: [], failed: [], verified: null, serveBase: null }
  }

  const origin = apiBase.replace(/\/$/, '')
  const planRes = await fetch(`${origin}/dev/registry/code-uploads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      name,
      version,
      files: list.map(({ path, content_type, size, sha256 }) => ({
        path,
        content_type,
        size,
        // Optional integrity hint (ignored by the v1 backend; flows so a
        // future checksum-bearing presign needs no CLI change).
        sha256,
      })),
    }),
  })
  if (!planRes.ok) {
    const body = await planRes.text().catch(() => '')
    const err = new Error(
      `code-uploads plan rejected: HTTP ${planRes.status}${body ? ` — ${body.slice(0, 300)}` : ''}`
    )
    err.status = planRes.status
    throw err
  }
  const plan = await planRes.json()
  const targets = new Map((plan.uploads || []).map((u) => [u.path, u]))
  const serveBase = plan.serve_base || null

  const uploaded = []
  const failed = []
  for (const file of uploadOrder(list)) {
    const target = targets.get(file.path)
    if (!target) {
      failed.push({ path: file.path, status: 0, detail: 'no upload target in plan' })
      continue
    }
    const bytes = readFileSync(join(distDir, file.path))
    try {
      const res = await fetch(new URL(target.url, origin), {
        method: target.method || 'PUT',
        // x-uniweb-sha256: optional integrity guard — direct mode verifies
        // the received bytes and 400s on mismatch (corruption-in-flight).
        headers: { ...(target.headers || {}), 'x-uniweb-sha256': file.sha256 },
        body: bytes,
      })
      if (res.ok) {
        uploaded.push(file.path)
        onProgress(`${file.path} (${file.size} bytes)`)
      } else {
        failed.push({
          path: file.path,
          status: res.status,
          detail: (await res.text().catch(() => '')).slice(0, 200),
        })
      }
    } catch (err) {
      failed.push({ path: file.path, status: 0, detail: err.message })
    }
  }

  // Direct mode: prove the version is live — fetch the entry back and
  // compare bytes (the channel's e2e proof, made a default).
  let verified = null
  const entry = list.find((f) => f.path === ENTRY_PATH)
  if (plan.mode === 'direct' && entry && !failed.length) {
    try {
      // serve_base is origin-relative in direct mode — resolve against the
      // registry origin before fetching.
      const url = serveBase
        ? new URL(`${serveBase.replace(/\/$/, '')}/${ENTRY_PATH}`, origin).toString()
        : gatewayUrl(origin, name, version, ENTRY_PATH)
      const res = await fetch(url)
      if (res.ok) {
        const served = Buffer.from(await res.arrayBuffer())
        const local = readFileSync(join(distDir, ENTRY_PATH))
        verified = served.equals(local)
      } else {
        verified = false
      }
    } catch {
      verified = false
    }
  }

  return { mode: plan.mode || 'direct', uploaded, failed, verified, serveBase }
}
