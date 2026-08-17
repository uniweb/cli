/**
 * Downloading the asset bytes a project does not have.
 *
 * The properties that matter are the two landing rules and the failure mode:
 * a KNOWN asset goes back to the path its author wrote (the reason the map is
 * committed), an UNKNOWN one lands at a generic content-addressed path and
 * becomes known, and nothing here can fail a pull — the content keeps its URL,
 * so a site whose bytes did not arrive still renders from the host.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readAssetMap, updateAssetMap } from '@uniweb/build/uwx'
import {
  downloadMissingAssets,
  collectAssetRefs,
  genericRefFor
} from '../src/backend/asset-download.js'

const ORIGIN = 'http://backend.test'
const SERVE = '/gateway/asset/dist/9f2c/base.png'

const site = () => mkdtempSync(join(tmpdir(), 'uw-dl-'))

const docWith = (attrs) => ({
  pages: [{ content: { type: 'doc', content: [{ type: 'image', attrs }] } }]
})

const okFetch = (body = 'BYTES') => async () => ({
  ok: true,
  arrayBuffer: async () => new TextEncoder().encode(body).buffer
})

test('collectAssetRefs finds identity on a node AND on a background media object', () => {
  const doc = {
    a: { src: SERVE, assetId: '9f2c', assetExt: 'png' },
    b: { background: { image: { src: '/x/y.jpg', assetId: 'abcd', assetExt: 'jpg' } } }
  }
  const refs = collectAssetRefs(doc).sort((x, y) => x.id.localeCompare(y.id))
  assert.deepEqual(refs, [
    { id: '9f2c', ext: 'png', url: SERVE },
    { id: 'abcd', ext: 'jpg', url: '/x/y.jpg' }
  ])
})

test('⭐ a KNOWN asset lands back at the path its author wrote', async () => {
  const dir = site()
  try {
    updateAssetMap(dir, { '/images/hero.png': { id: '9f2c', ext: 'png' } })
    const out = await downloadMissingAssets({
      document: docWith({ src: SERVE, assetId: '9f2c', assetExt: 'png' }),
      siteDir: dir,
      origin: ORIGIN,
      fetchImpl: okFetch()
    })
    assert.deepEqual(out.downloaded, ['/images/hero.png'])
    assert.equal(
      readFileSync(join(dir, 'public', 'images', 'hero.png'), 'utf8'),
      'BYTES'
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('an UNKNOWN asset lands at a generic path and BECOMES known', async () => {
  const dir = site()
  try {
    const out = await downloadMissingAssets({
      document: docWith({ src: SERVE, assetId: '9f2c', assetExt: 'png' }),
      siteDir: dir,
      origin: ORIGIN,
      fetchImpl: okFetch()
    })
    const ref = genericRefFor('9f2c', 'png')
    assert.deepEqual(out.downloaded, [ref])
    assert.ok(existsSync(join(dir, 'public', 'assets', '9f2c.png')))
    // …and the next pull restores it here rather than fetching it again elsewhere
    assert.deepEqual(readAssetMap(dir)[ref], { id: '9f2c', ext: 'png' })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('an asset already on disk is not re-fetched', async () => {
  const dir = site()
  try {
    updateAssetMap(dir, { '/images/hero.png': { id: '9f2c', ext: 'png' } })
    mkdirSync(join(dir, 'public', 'images'), { recursive: true })
    writeFileSync(join(dir, 'public', 'images', 'hero.png'), 'ALREADY')
    const out = await downloadMissingAssets({
      document: docWith({ src: SERVE, assetId: '9f2c', assetExt: 'png' }),
      siteDir: dir,
      origin: ORIGIN,
      fetchImpl: async () => {
        throw new Error('should not fetch')
      }
    })
    assert.deepEqual(out.present, ['/images/hero.png'])
    assert.equal(
      readFileSync(join(dir, 'public', 'images', 'hero.png'), 'utf8'),
      'ALREADY'
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('⛔ a failed download WARNS and never throws — the content keeps its URL', async () => {
  const dir = site()
  const warnings = []
  try {
    const out = await downloadMissingAssets({
      document: docWith({ src: SERVE, assetId: '9f2c', assetExt: 'png' }),
      siteDir: dir,
      origin: ORIGIN,
      fetchImpl: async () => ({ ok: false, status: 503 }),
      warn: (m) => warnings.push(m)
    })
    assert.deepEqual(out.failed, [genericRefFor('9f2c', 'png')])
    assert.deepEqual(out.downloaded, [])
    assert.ok(warnings.some((w) => w.includes('503')))
    // nothing written, and nothing learned — a failure must not claim the path
    assert.equal(existsSync(join(dir, 'public', 'assets', '9f2c.png')), false)
    assert.deepEqual(readAssetMap(dir), {})
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a transport error is caught too, not just a bad status', async () => {
  const dir = site()
  const warnings = []
  try {
    const out = await downloadMissingAssets({
      document: docWith({ src: SERVE, assetId: '9f2c', assetExt: 'png' }),
      siteDir: dir,
      origin: ORIGIN,
      fetchImpl: async () => {
        throw new Error('ECONNREFUSED')
      },
      warn: (m) => warnings.push(m)
    })
    assert.deepEqual(out.failed.length, 1)
    assert.ok(warnings.some((w) => w.includes('ECONNREFUSED')))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('⛔ identity with no URL beside it is SKIPPED, never composed', async () => {
  // Composing an address would mean holding the host's route layout — the
  // coupling this CLI deleted. No URL means no fetch.
  const dir = site()
  const warnings = []
  try {
    const out = await downloadMissingAssets({
      document: docWith({ assetId: '9f2c', assetExt: 'png' }),
      siteDir: dir,
      origin: ORIGIN,
      fetchImpl: async () => {
        throw new Error('should not fetch')
      },
      warn: (m) => warnings.push(m)
    })
    assert.deepEqual(out.skipped, [genericRefFor('9f2c', 'png')])
    assert.ok(warnings.some((w) => w.includes('no URL')))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('an origin-relative serve URL resolves against the backend origin', async () => {
  const dir = site()
  let requested = null
  try {
    await downloadMissingAssets({
      document: docWith({ src: SERVE, assetId: '9f2c', assetExt: 'png' }),
      siteDir: dir,
      origin: ORIGIN,
      fetchImpl: async (u) => {
        requested = u
        return { ok: true, arrayBuffer: async () => new ArrayBuffer(0) }
      }
    })
    assert.equal(requested, `${ORIGIN}${SERVE}`)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('an absolute serve URL is fetched verbatim', async () => {
  const dir = site()
  let requested = null
  const ABS = 'https://cdn.example/dist/9f2c/base.png'
  try {
    await downloadMissingAssets({
      document: docWith({ src: ABS, assetId: '9f2c', assetExt: 'png' }),
      siteDir: dir,
      origin: ORIGIN,
      fetchImpl: async (u) => {
        requested = u
        return { ok: true, arrayBuffer: async () => new ArrayBuffer(0) }
      }
    })
    assert.equal(requested, ABS)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('no refs is a no-op that never touches the network', async () => {
  const dir = site()
  try {
    const out = await downloadMissingAssets({
      document: { pages: [] },
      siteDir: dir,
      origin: ORIGIN,
      fetchImpl: async () => {
        throw new Error('should not fetch')
      }
    })
    assert.deepEqual(out, { downloaded: [], present: [], failed: [], skipped: [] })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
