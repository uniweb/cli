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
 */

import { createHash } from 'node:crypto'
import { buildAssetUrl } from '../utils/asset-upload.js'

/**
 * @param {object} client - BackendClient (origin + uploadSiteAssets + discover)
 * @param {{ data: object, search: object }} ball - the assembled data ball
 * @param {{ onProgress?: (m: string) => void }} [opts]
 * @returns {Promise<string>} the content-addressed serve URL (→ `info.data_bundle`)
 */
export async function uploadDataBundle(client, ball, { onProgress } = {}) {
  const bytes = Buffer.from(JSON.stringify(ball))
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  const localUrl = '/data-bundle/base.json' // bookkeeping key into assetsByLocalUrl

  const result = await client.uploadSiteAssets({
    files: [
      { path: 'data-bundle/base.json', content_type: 'application/json', size: bytes.length, sha256, localUrl, bytes },
    ],
    onProgress,
  })
  if (result.failed?.length) {
    const f = result.failed[0]
    throw new Error(`data-bundle upload failed: HTTP ${f.status} ${f.detail}`)
  }
  const entry = result.assetsByLocalUrl[localUrl]
  if (!entry) throw new Error('data-bundle upload returned no asset id')

  const config = await client.discover()
  return buildAssetUrl(client.origin, config.assetBase, entry.id, entry.ext)
}
