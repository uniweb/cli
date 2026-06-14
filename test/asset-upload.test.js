/**
 * Site asset delivery (deploy asset lane) — unit-pinned against the
 * delivery-lane.md §Assets contract: collect (dist/assets/*) → plan (POST
 * /dev/assets, sha256 required) → PUT-per-file → the localUrl→{id,ext} rewrite
 * map. Mock-backed fetch; a temp dist/ as the real artifact.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { collectSiteAssets, uploadSiteAssets } from '../src/utils/asset-upload.js'

const sha = (s) => createHash('sha256').update(s).digest('hex')

function makeDist({ withAssets = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'uw-asset-'))
  const distDir = join(dir, 'dist')
  mkdirSync(distDir, { recursive: true })
  writeFileSync(join(distDir, 'site-content.json'), '{}')
  if (withAssets) {
    mkdirSync(join(distDir, 'assets'))
    writeFileSync(join(distDir, 'assets', 'hero-ab12cd34.webp'), 'WEBPDATA')
    writeFileSync(join(distDir, 'assets', 'logo-9f8e7d6c.svg'), '<svg/>')
  }
  return { dir, distDir }
}

test('collectSiteAssets walks dist/assets, hashes + types, sets localUrl', () => {
  const { dir, distDir } = makeDist()
  try {
    const files = collectSiteAssets(distDir)
    assert.deepEqual(files.map((f) => f.path).sort(), ['assets/hero-ab12cd34.webp', 'assets/logo-9f8e7d6c.svg'])
    const hero = files.find((f) => f.path === 'assets/hero-ab12cd34.webp')
    assert.equal(hero.localUrl, '/assets/hero-ab12cd34.webp')
    assert.equal(hero.content_type, 'image/webp')
    assert.equal(hero.size, 'WEBPDATA'.length)
    assert.equal(hero.sha256, sha('WEBPDATA'))
    assert.equal(files.find((f) => f.path === 'assets/logo-9f8e7d6c.svg').content_type, 'image/svg+xml')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('collectSiteAssets returns [] for an image-free site (no assets/ dir)', () => {
  const { dir, distDir } = makeDist({ withAssets: false })
  try {
    assert.deepEqual(collectSiteAssets(distDir), [])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('uploadSiteAssets plans /dev/assets, PUTs each, returns the localUrl→{id,ext} map', async () => {
  const { dir, distDir } = makeDist()
  const calls = []
  const realFetch = globalThis.fetch
  globalThis.fetch = async (url, opts = {}) => {
    calls.push({ url: String(url), method: opts.method || 'GET', headers: opts.headers || {} })
    if (String(url).endsWith('/dev/assets')) {
      const body = JSON.parse(opts.body)
      // sha256 is required on every file
      assert.ok(body.files.every((f) => f.sha256 && f.path && f.size >= 0))
      return {
        ok: true,
        status: 200,
        json: async () => ({
          mode: 'direct',
          expires_in: null,
          uploads: body.files.map((f) => ({
            path: f.path,
            id: f.sha256, // backend: id == lowercase-hex sha256
            ext: f.path.split('.').pop(),
            method: 'PUT',
            url: `http://localhost:8080/dev/assets/blob/${f.sha256}`,
            headers: { 'content-type': f.content_type },
          })),
        }),
      }
    }
    // a PUT to a blob url
    assert.equal(opts.method, 'PUT')
    assert.ok(opts.headers['x-uniweb-sha256'], 'integrity header rides every PUT')
    assert.ok(opts.headers.Authorization, 'direct-mode PUT carries the bearer')
    return { ok: true, status: 200, text: async () => '' }
  }
  try {
    const result = await uploadSiteAssets({ apiBase: 'http://localhost:8080', token: 't', distDir })
    assert.equal(result.mode, 'direct')
    assert.equal(result.failed.length, 0)
    assert.equal(result.uploaded.length, 2)
    assert.deepEqual(result.assetsByLocalUrl['/assets/hero-ab12cd34.webp'], { id: sha('WEBPDATA'), ext: 'webp' })
    assert.deepEqual(result.assetsByLocalUrl['/assets/logo-9f8e7d6c.svg'], { id: sha('<svg/>'), ext: 'svg' })
    assert.equal(calls.filter((c) => c.method === 'PUT').length, 2)
  } finally {
    globalThis.fetch = realFetch
    rmSync(dir, { recursive: true, force: true })
  }
})

test('uploadSiteAssets surfaces a per-file failure and omits it from the rewrite map', async () => {
  const { dir, distDir } = makeDist()
  const realFetch = globalThis.fetch
  globalThis.fetch = async (url, opts = {}) => {
    if (String(url).endsWith('/dev/assets')) {
      const body = JSON.parse(opts.body)
      return {
        ok: true,
        status: 200,
        json: async () => ({
          mode: 'direct',
          uploads: body.files.map((f) => ({
            path: f.path, id: f.sha256, ext: f.path.split('.').pop(),
            method: 'PUT', url: `http://x/${f.sha256}`, headers: {},
          })),
        }),
      }
    }
    if (String(url).includes(sha('<svg/>'))) return { ok: false, status: 413, text: async () => 'too large' }
    return { ok: true, status: 200, text: async () => '' }
  }
  try {
    const result = await uploadSiteAssets({ apiBase: 'http://localhost:8080', token: 't', distDir })
    assert.equal(result.uploaded.length, 1)
    assert.equal(result.failed.length, 1)
    assert.equal(result.failed[0].path, 'assets/logo-9f8e7d6c.svg')
    assert.equal(result.failed[0].status, 413)
    assert.ok(result.assetsByLocalUrl['/assets/hero-ab12cd34.webp'], 'successful asset is mapped')
    assert.ok(!result.assetsByLocalUrl['/assets/logo-9f8e7d6c.svg'], 'failed asset is NOT mapped (no broken URL)')
  } finally {
    globalThis.fetch = realFetch
    rmSync(dir, { recursive: true, force: true })
  }
})

test('uploadSiteAssets attaches NO auth header in presigned mode', async () => {
  const { dir, distDir } = makeDist()
  let sawAuthOnPut = false
  const realFetch = globalThis.fetch
  globalThis.fetch = async (url, opts = {}) => {
    if (String(url).endsWith('/dev/assets')) {
      const body = JSON.parse(opts.body)
      return {
        ok: true, status: 200,
        json: async () => ({
          mode: 'presigned',
          uploads: body.files.map((f) => ({
            path: f.path, id: f.sha256, ext: f.path.split('.').pop(),
            method: 'PUT', url: `https://s3.example/${f.sha256}?sig=abc`, headers: {},
          })),
        }),
      }
    }
    if (opts.headers?.Authorization) sawAuthOnPut = true
    return { ok: true, status: 200, text: async () => '' }
  }
  try {
    const result = await uploadSiteAssets({ apiBase: 'http://localhost:8080', token: 't', distDir })
    assert.equal(result.mode, 'presigned')
    assert.equal(result.uploaded.length, 2)
    assert.equal(sawAuthOnPut, false, 'presigned PUT must not carry a foreign auth header')
  } finally {
    globalThis.fetch = realFetch
    rmSync(dir, { recursive: true, force: true })
  }
})

test('uploadSiteAssets throws on a plan-level failure', async () => {
  const { dir, distDir } = makeDist()
  const realFetch = globalThis.fetch
  globalThis.fetch = async () => ({ ok: false, status: 400, statusText: 'Bad Request', text: async () => 'nope' })
  try {
    await assert.rejects(
      () => uploadSiteAssets({ apiBase: 'http://localhost:8080', token: 't', distDir }),
      /Asset plan failed: HTTP 400/
    )
  } finally {
    globalThis.fetch = realFetch
    rmSync(dir, { recursive: true, force: true })
  }
})

test('uploadSiteAssets is a no-op for an image-free site', async () => {
  const { dir, distDir } = makeDist({ withAssets: false })
  const realFetch = globalThis.fetch
  let fetched = false
  globalThis.fetch = async () => { fetched = true; return { ok: true, status: 200, json: async () => ({}) } }
  try {
    const result = await uploadSiteAssets({ apiBase: 'http://localhost:8080', token: 't', distDir })
    assert.deepEqual(result, { mode: 'none', uploaded: [], failed: [], assetsByLocalUrl: {} })
    assert.equal(fetched, false, 'no plan call when there are no assets')
  } finally {
    globalThis.fetch = realFetch
    rmSync(dir, { recursive: true, force: true })
  }
})
