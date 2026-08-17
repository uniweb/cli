/**
 * Upload the static-data ball (assembleDataBall's `{ data, search }` doc) to the
 * backend's content-addressed asset store via the SAME asset lane deploy uses for
 * media, and return its durable serve URL — the `info.data_bundle` the composite push
 * stamps on the site-content entity. The backend unwraps the ball into the `/data/*`
 * + `/_search/*` bytes the gateway serves.
 *
 * The ball is in-memory (not a built file on disk), so it rides as `bytes` on the
 * single upload entry — `uploadSiteAssets` PUTs `bytes` when present, else reads a
 * `diskPath` (its media path). Content-addressed like every asset: identical ball →
 * same id → a re-deploy of unchanged data is a cheap no-op PUT.
 *
 * The returned URL is the plan entry's `serve_url`, read verbatim. See the note at
 * the return for why the origin-relative form is safe to store.
 */

import { createHash } from 'node:crypto'

/**
 * @param {object} client - BackendClient (origin + uploadSiteAssets)
 * @param {{ data: object, search: object }} ball - the assembled data ball
 * @param {{ onProgress?: (m: string) => void }} [opts]
 * @returns {Promise<string>} the content-addressed serve URL (→ `info.data_bundle`)
 */
export async function uploadDataBundle(
  client,
  ball,
  { siteUuid = null, onProgress } = {}
) {
  const bytes = Buffer.from(JSON.stringify(ball))
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  const localUrl = '/data-bundle/base.json' // bookkeeping key into assetsByLocalUrl

  const result = await client.uploadSiteAssets({
    files: [
      {
        path: 'data-bundle/base.json',
        content_type: 'application/json',
        size: bytes.length,
        sha256,
        localUrl,
        bytes
      }
    ],
    siteUuid,
    onProgress
  })
  if (result.failed?.length) {
    const f = result.failed[0]
    throw new Error(`data-bundle upload failed: HTTP ${f.status} ${f.detail}`)
  }
  const entry = result.assetsByLocalUrl[localUrl]
  if (!entry) throw new Error('data-bundle upload returned no asset id')

  // The backend's canonical serve URL, READ — never composed. Same rule and the
  // same code path as `site-media.js`; until 2026-08-17 this composed from a
  // discovered `assetBase` unconditionally, which made it the one place a
  // discovery failure could bake the historical production CDN host into content
  // we push.
  //
  // Storing it verbatim is safe even though `serve_url` is ORIGIN-RELATIVE in the
  // backend's `direct` mode — the only mode any deployment has ever run.
  // `info.data_bundle` is never fetched over HTTP: the backend resolves it to a
  // blob-store key, discarding everything before the final `dist/`, so absolute
  // and relative forms resolve to the same key (pinned both ways on their side).
  //
  // Absent is an error, not a cue to invent a location: an unaddressable bundle
  // must stop the publish, never ship a URL nobody claimed. (Confirmed with the
  // backend 2026-08-17; `serve_url` is contractually on every plan entry.)
  if (!entry.serveUrl)
    throw new Error('data-bundle upload returned no serve_url')

  return entry.serveUrl
}
