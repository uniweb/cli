/**
 * uploadDataBundle — uploads the static-data ball through the asset lane and returns
 * its content-addressed serve URL. Driven with a mock client: the ball rides as
 * in-memory `bytes` (content-typed JSON, sha256-addressed), and the URL is built from
 * the plan's id+ext via the shared buildAssetUrl.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { uploadDataBundle } from '../src/backend/data-bundle.js'
import { buildAssetUrl } from '../src/utils/asset-upload.js'

test('uploadDataBundle uploads the ball as content-addressed JSON bytes and returns the serve URL', async () => {
  const ball = { data: { 'notes.json': [{ slug: 'n1' }] }, search: { 'en/pages.json': { type: 'pages' } } }
  const expectedSha = createHash('sha256').update(Buffer.from(JSON.stringify(ball))).digest('hex')

  let captured = null
  const client = {
    origin: 'http://x',
    discover: async () => ({ assetBase: '/gateway/asset/' }),
    uploadSiteAssets: async ({ files }) => {
      captured = files
      return { failed: [], assetsByLocalUrl: { [files[0].localUrl]: { id: 'SHA123', ext: 'json' } } }
    },
  }

  const url = await uploadDataBundle(client, ball)

  // one entry, content-typed JSON, carrying in-memory bytes + the right sha256
  assert.equal(captured.length, 1)
  assert.equal(captured[0].content_type, 'application/json')
  assert.equal(captured[0].sha256, expectedSha)
  assert.ok(Buffer.isBuffer(captured[0].bytes))
  assert.equal(captured[0].bytes.toString('utf8'), JSON.stringify(ball))
  // the serve URL is built from the plan's id+ext (content-addressed)
  assert.equal(url, buildAssetUrl('http://x', '/gateway/asset/', 'SHA123', 'json'))
  assert.equal(url, 'http://x/gateway/asset/dist/SHA123/base.json')
})

test('uploadDataBundle throws when the upload fails', async () => {
  const client = {
    origin: 'http://x',
    discover: async () => ({ assetBase: '/gateway/asset/' }),
    uploadSiteAssets: async () => ({ failed: [{ status: 500, detail: 'boom' }], assetsByLocalUrl: {} }),
  }
  await assert.rejects(() => uploadDataBundle(client, { data: {}, search: {} }), /data-bundle upload failed: HTTP 500/)
})
