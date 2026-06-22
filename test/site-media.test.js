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
import { uploadSiteMedia } from '../src/backend/site-media.js'

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
    const map = await uploadSiteMedia(client, dir, ['/images/banner.png'])
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
    const map = await uploadSiteMedia(client, dir, ['/images/banner.png', '/images/missing.png'], { warn: (m) => warnings.push(m) })
    assert.deepEqual(Object.keys(map), ['/images/banner.png']) // only the existing file
    assert.ok(warnings.some((m) => m.includes('missing.png') && m.includes('not found')))
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
    const map = await uploadSiteMedia(client, dir, ['/images/banner.png'])
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
  assert.deepEqual(await uploadSiteMedia(client, '/tmp', []), {})
})
