/**
 * Static collection data — the passthrough lane.
 *
 * A site's **schema-less** collections have no entity model, so their compiled
 * `dist/data/**` JSON is delivered as files rather than synced as entities.
 * This plans and uploads that set: one plan call, one object per file, each
 * PUT to the target the backend returns.
 *
 *   1. PLAN   — POST {apiBase}/dev/site/data-uploads/{site} with the file list
 *               ({ path, content_type, size, sha256 }). Response carries
 *               `mode` ('presigned' | 'direct'), `expires_in`, `serve_base`,
 *               and one `uploads` entry per file ({ path, method, url, headers }).
 *   2. UPLOAD — PUT each file's bytes to its URL. Order is irrelevant; there is
 *               no entry file and no server confirm step.
 *
 * ⭐ **`path` is the SERVING TAIL** (`data/articles.json`), not a bookkeeping
 * key. The file lands where it is served — which is the whole point of this
 * lane, and why it returns no map: nothing has to record where anything went.
 *
 * ## Why this is not the asset lane
 *
 * Assets are **global and content-addressed** — identical bytes dedup across
 * sites — so the relation from a site's path to an object is many-to-one and a
 * serve path cannot be a property of the object. This lane is **per-site and
 * path-addressed**. Sending static data through the asset store is what forced
 * the old "data ball": one bundled asset the backend had to fetch, parse and
 * fan out, which is the only place these bytes ever transited it.
 *
 * ⇒ **The backend is a PASSTHROUGH here** — it brokers the authorization, not
 * the bytes. Hosting static content is the hosting platform's mission where an
 * edge exists; where there is none (edgeless), the backend serves them itself,
 * and that is the posture working rather than a fallback.
 *
 * ⛔ **Do not compose paths onto `serve_base`.** It is `null` on the presigned
 * arm (prod serving is the delivery tier's URL shape, not the backend's to
 * mint) and the gateway's data route on the direct arm. Nothing in a build
 * needs it — the site's fetcher asks for a site-relative `/data/{path}` at
 * runtime — so it is returned for parity and for a caller that wants to verify
 * an upload landed.
 *
 * Contract ratified with the backend lane, 2026-08-18.
 * **Wired into `publish.js` and shipped in `uniweb` 0.25.3.** Both arms of the
 * endpoint exist (presigned landed 2026-08-18, per Diego).
 *
 * ⚠️ **The presigned arm has never been exercised against a real backend from
 * here.** The branch is one line and unit-tested both ways, but a stub is not a
 * presigning deployment — three claims diverged that way in a single day while
 * this lane was being built. A local `uniwebd` answers `direct`, so proving it
 * needs a presigning deployment and one real publish. **Believed correct, not
 * demonstrated.**
 */

import { createHash } from 'node:crypto'

/**
 * Plan + upload a site's static collection data files.
 *
 * @param {object} opts
 * @param {string} opts.apiBase - backend origin
 * @param {string} opts.token - bearer, used on the direct arm only
 * @param {string} opts.siteUuid - the site these files belong to (path segment)
 * @param {{ data: Record<string, unknown> }|null} opts.ball - source of the set:
 *   `{ "<relpath under dist/data>": <json> }`, media refs already rewritten
 * @param {(m: string) => void} [opts.onProgress]
 * @returns {Promise<{ mode: string, uploaded: string[], failed: Array<{path:string,status:number,detail?:string}>, serveBase: string|null }>}
 *   **No map** — by design. The files are at their serving paths.
 */
export async function uploadSiteData({
  apiBase,
  token,
  siteUuid,
  ball,
  onProgress = () => {}
}) {
  const entries = Object.entries(ball?.data || {})
  if (!entries.length) {
    return { mode: 'none', uploaded: [], failed: [], serveBase: null }
  }

  // One plan for the whole set. The per-request file cap counts a plan, so
  // splitting would evade it rather than respect it; if a set ever exceeds it,
  // the refusal is the correct outcome and the cap is the thing to fix.
  const files = entries.map(([relPath, value]) => {
    const bytes = Buffer.from(JSON.stringify(value))
    return {
      // ⚠️ The tail RELATIVE TO THE DATA ROOT — no `data/` prefix.
      //
      // The plan's `serve_base` already ends in `/data/`
      // (`/gateway/site/{site}/data/`), and the runtime asks for
      // `{config.base}/data/{name}.json` (`DATA_URL_PREFIX`). Sending
      // `data/articles.json` would store one level too deep and serve at
      // `…/data/data/articles.json`, which the runtime never requests.
      //
      // ⛔ And the failure is INVISIBLE from here: the plan succeeds, the PUT
      // succeeds, and only a visitor's fetch 404s. Confirmed against the
      // shipped contract's own example (`collections/articles.json` with a
      // `/data/`-bearing `serve_base`), which supersedes an earlier
      // parenthetical that showed the prefix.
      path: relPath,
      content_type: 'application/json',
      size: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      bytes
    }
  })

  const origin = apiBase.replace(/\/$/, '')
  // `{site}` is a PATH segment, not a body field — every sibling on this
  // controller addresses the site that way (`content/push/{site}`,
  // `publish/{site}`, `status/{site}`). The asset lane's body-borne owner is
  // the wrong precedent: that lane is global, this one is per-site.
  const planRes = await fetch(
    `${origin}/dev/site/data-uploads/${encodeURIComponent(siteUuid)}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        files: files.map(({ path, content_type, size, sha256 }) => ({
          path,
          content_type,
          size,
          sha256
        }))
      })
    }
  )
  if (!planRes.ok) {
    const body = await planRes.text().catch(() => '')
    throw new Error(
      `site data-uploads plan rejected: HTTP ${planRes.status}${body ? ` — ${body.slice(0, 300)}` : ''}`
    )
  }

  const plan = await planRes.json()
  const targets = new Map((plan.uploads || []).map((u) => [u.path, u]))
  // The one mode-aware bit, same rule as the code and runtime lanes: a direct
  // PUT is a bearer-authed backend route; a presigned URL is self-authorizing
  // and must NOT carry a foreign bearer, which can break signature validation.
  const authHeaders =
    plan.mode === 'presigned' ? {} : { Authorization: `Bearer ${token}` }

  const uploaded = []
  const failed = []
  for (const f of files) {
    const target = targets.get(f.path)
    if (!target) {
      // A file the plan did not answer for is unaddressable. Report it; never
      // invent a location for it.
      failed.push({ path: f.path, status: 0, detail: 'no upload target in plan' })
      continue
    }
    try {
      // Relative on the direct arm, absolute on presigned — `new URL` resolves
      // both against the origin.
      const res = await fetch(new URL(target.url, origin), {
        method: target.method || 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(target.headers || {}),
          ...authHeaders
        },
        body: f.bytes
      })
      if (res.ok) {
        uploaded.push(f.path)
        onProgress(`${f.path}`)
      } else {
        failed.push({ path: f.path, status: res.status })
      }
    } catch (err) {
      failed.push({ path: f.path, status: 0, detail: err.message })
    }
  }

  return {
    mode: plan.mode || 'direct',
    uploaded,
    failed,
    serveBase: plan.serve_base || null
  }
}
