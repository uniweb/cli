/**
 * uploadSiteMedia — resolves a site's site-root media refs under public/, uploads them
 * through the asset lane, and returns the { ref → serveUrl } map the deploy rewrites the
 * entity content with. Mock client; a temp site with a public/ image as the real artifact.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { uploadSiteMedia, isStorageRefusal } from '../src/backend/site-media.js'

function makeSite() {
  const dir = mkdtempSync(join(tmpdir(), 'uw-media-'))
  mkdirSync(join(dir, 'public', 'images'), { recursive: true })
  writeFileSync(join(dir, 'public', 'images', 'banner.png'), 'PNGDATA')
  return dir
}

test('uploadSiteMedia resolves site-root refs under public/, uploads, returns ref→serveUrl (prefers serve_url)', async () => {
  const dir = makeSite()
  let captured = null
  const client = {
    origin: 'http://x',
    discover: async () => ({ assetBase: '/gateway/asset/' }),
    uploadSiteAssets: async ({ files }) => {
      captured = files
      return { failed: [], assetsByLocalUrl: { '/images/banner.png': { id: 'SHA1', ext: 'png', serveUrl: '/gateway/asset/dist/SHA1/base.png' } } }
    },
  }
  try {
    const { map } = await uploadSiteMedia(client, dir, ['/images/banner.png'])
    // one file uploaded: content-typed, sha256'd, keyed by the original ref
    assert.equal(captured.length, 1)
    assert.equal(captured[0].localUrl, '/images/banner.png')
    assert.equal(captured[0].content_type, 'image/png')
    assert.ok(captured[0].sha256)
    // the map embeds the backend's canonical serve_url
    assert.deepEqual(map, { '/images/banner.png': '/gateway/asset/dist/SHA1/base.png' })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('uploadSiteMedia skips (and warns) a ref whose file is missing', async () => {
  const dir = makeSite()
  const warnings = []
  const client = {
    origin: 'http://x',
    discover: async () => ({ assetBase: '/gateway/asset/' }),
    uploadSiteAssets: async ({ files }) => ({
      failed: [],
      assetsByLocalUrl: Object.fromEntries(files.map((f) => [f.localUrl, { id: 'S', ext: 'png', serveUrl: `srv:${f.localUrl}` }])),
    }),
  }
  try {
    const { map, missing, failed } = await uploadSiteMedia(client, dir, ['/images/banner.png', '/images/missing.png'], { warn: (m) => warnings.push(m) })
    assert.deepEqual(Object.keys(map), ['/images/banner.png']) // only the existing file
    assert.ok(warnings.some((m) => m.includes('missing.png') && m.includes('not found')))
    // A missing FILE is an authoring mistake, reported apart from a failed upload:
    // callers block a push on `failed`, not on `missing`.
    assert.deepEqual(missing, ['/images/missing.png'])
    assert.deepEqual(failed, [])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('uploadSiteMedia falls back to buildAssetUrl when the lane omits serve_url', async () => {
  const dir = makeSite()
  const client = {
    origin: 'http://x',
    discover: async () => ({ assetBase: '/gateway/asset/' }),
    uploadSiteAssets: async () => ({ failed: [], assetsByLocalUrl: { '/images/banner.png': { id: 'SHA9', ext: 'png' } } }), // no serveUrl
  }
  try {
    const { map } = await uploadSiteMedia(client, dir, ['/images/banner.png'])
    assert.equal(map['/images/banner.png'], 'http://x/gateway/asset/dist/SHA9/base.png')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('uploadSiteMedia is a no-op for no refs (never touches the lane)', async () => {
  const client = {
    origin: 'http://x',
    discover: async () => ({ assetBase: '/' }),
    uploadSiteAssets: async () => { throw new Error('should not upload') },
  }
  assert.deepEqual(await uploadSiteMedia(client, '/tmp', []), { map: {}, missing: [], failed: [] })
})

test('uploadSiteMedia reports a failed upload separately from a missing file', async () => {
  // The distinction the callers act on: bytes that did not land must block the
  // push/publish, because the content would otherwise ship still naming the local
  // path — a broken image whose only trace is a warning.
  const dir = makeSite()
  const client = {
    origin: 'http://x',
    discover: async () => ({ assetBase: '/gateway/asset/' }),
    uploadSiteAssets: async () => ({
      failed: [{ path: 'images/banner.png', status: 507, detail: 'over quota' }],
      assetsByLocalUrl: {},
    }),
  }
  try {
    const { map, missing, failed } = await uploadSiteMedia(client, dir, ['/images/banner.png'])
    assert.deepEqual(map, {})
    assert.deepEqual(missing, [])
    assert.equal(failed.length, 1)
    assert.equal(failed[0].status, 507)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('isStorageRefusal recognises the storage-shaped plan rejections', () => {
  // A heuristic on status until the backend carries a typed error with
  // used / limit / needed — see the collab charter in the handoff.
  for (const status of [402, 413, 507]) {
    assert.equal(isStorageRefusal(new Error(`Asset plan failed: HTTP ${status} Payload`)), true)
  }
  assert.equal(isStorageRefusal(new Error('Asset plan failed: HTTP 500 Server Error')), false)
  assert.equal(isStorageRefusal(new Error('Asset plan failed: HTTP 4020 Weird')), false)
  assert.equal(isStorageRefusal(new Error('something else entirely')), false)
  assert.equal(isStorageRefusal(null), false)
})
