/**
 * uploadDataBundle — uploads the static-data ball through the asset lane and returns
 * its content-addressed serve URL. Driven with a mock client: the ball rides as
 * in-memory `bytes` (content-typed JSON, sha256-addressed), and the URL is the plan
 * entry's `serve_url` read verbatim, with buildAssetUrl as the older-backend fallback.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { uploadDataBundle } from '../src/backend/data-bundle.js'

test('uploadDataBundle returns the plan serve_url VERBATIM, origin-relative included', async () => {
  // The regression this pins: composing from `assetBase` unconditionally made this
  // the one place a discovery failure could bake the historical production CDN host
  // into pushed content. The origin-relative form is safe to store because the
  // backend resolves `info.data_bundle` to a blob key and discards the host — it is
  // never fetched over HTTP.
  const client = {
    origin: 'http://x',
    // A discovery doc that would compose a DIFFERENT (and absolute) URL, so the
    // assertion fails if anything reconstructs instead of reading.
    discover: async () => ({ assetBase: 'https://cdn.example/' }),
    uploadSiteAssets: async ({ files }) => ({
      failed: [],
      assetsByLocalUrl: {
        [files[0].localUrl]: {
          id: 'SHA123',
          ext: 'json',
          serveUrl: '/gateway/asset/dist/SHA123/base.json'
        }
      }
    })
  }

  const url = await uploadDataBundle(client, { data: {}, search: {} })

  assert.equal(url, '/gateway/asset/dist/SHA123/base.json')
  assert.ok(!url.startsWith('http'), 'must not be absolutized')
  assert.ok(!url.includes('cdn.example'), 'must not be composed from assetBase')
})

test('uploadDataBundle uploads the ball as content-addressed JSON bytes, and REFUSES when the plan omits serve_url', async () => {
  const ball = {
    data: { 'notes.json': [{ slug: 'n1' }] },
    search: { 'en/pages.json': { type: 'pages' } }
  }
  const expectedSha = createHash('sha256')
    .update(Buffer.from(JSON.stringify(ball)))
    .digest('hex')

  let captured = null
  const client = {
    origin: 'http://x',
    discover: async () => ({ assetBase: '/media-root/' }),
    uploadSiteAssets: async ({ files }) => {
      captured = files
      return {
        failed: [],
        // no serveUrl — the shape a backend predating the serve_url contract returns
        assetsByLocalUrl: { [files[0].localUrl]: { id: 'SHA123', ext: 'json' } }
      }
    }
  }

  // An unaddressable bundle must stop the publish. Composing a location from a
  // discovered `assetBase` (removed 2026-08-17) is what silently baked one
  // production host into every deployment's content.
  await assert.rejects(
    () => uploadDataBundle(client, ball),
    /no serve_url/
  )

  // …and it still planned the upload correctly: one entry, content-typed JSON,
  // in-memory bytes, right sha256. The refusal is about the URL, not the upload.
  assert.equal(captured.length, 1)
  assert.equal(captured[0].content_type, 'application/json')
  assert.equal(captured[0].sha256, expectedSha)
  assert.ok(Buffer.isBuffer(captured[0].bytes))
  assert.equal(captured[0].bytes.toString('utf8'), JSON.stringify(ball))
})

test('uploadDataBundle throws when the upload fails', async () => {
  const client = {
    origin: 'http://x',
    discover: async () => ({ assetBase: '/media-root/' }),
    uploadSiteAssets: async () => ({
      failed: [{ status: 500, detail: 'boom' }],
      assetsByLocalUrl: {}
    })
  }
  await assert.rejects(
    () => uploadDataBundle(client, { data: {}, search: {} }),
    /data-bundle upload failed: HTTP 500/
  )
})
