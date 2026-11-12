/**
 * uploadSiteMedia prepares a picture a page shows before it is stored (`prepareImage`, from
 * `@uniweb/build/images`), and keeps what it prepared: `sync.json`'s asset map records the file a
 * stored picture was made from, so a push never prepares, uploads or charges an unchanged picture
 * again, and a pull still puts the author's own path back. Mock client; real pictures, made here.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { deflateSync, crc32 } from 'node:zlib'
import { uploadSiteMedia } from '../src/backend/site-media.js'

const sha = (b) => createHash('sha256').update(b).digest('hex')

/** A real PNG of noise: detail a WebP shrinks, so the rule converts it. */
function noisePng(width = 64, height = 64, seed = 7) {
  const rows = []
  let x = seed
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(1 + width * 3) // filter byte 0, then RGB
    for (let i = 1; i < row.length; i++) {
      x = (x * 1103515245 + 12345) & 0x7fffffff
      row[i] = (x >> 16) & 0xff
    }
    rows.push(row)
  }
  const chunk = (type, data) => {
    const length = Buffer.alloc(4)
    length.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(body) >>> 0)
    return Buffer.concat([length, body, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0))
  ])
}

function makeSite(files = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'uw-prepared-'))
  mkdirSync(join(dir, 'public', 'images'), { recursive: true })
  for (const [path, bytes] of Object.entries(files)) writeFileSync(join(dir, path), bytes)
  return dir
}

/** A client whose plan answers each file by the identity it was sent, every file already stored or not. */
function client({ present = false, answers = [] } = {}) {
  const calls = []
  return {
    calls,
    origin: 'http://x',
    uploadSiteAssets: async ({ files }) => {
      calls.push(files)
      const scripted = answers[calls.length - 1]
      if (scripted) return scripted(files)
      return {
        failed: [],
        assetsByLocalUrl: Object.fromEntries(
          files.map((f) => {
            const ext = f.path.split('.').pop()
            return [f.localUrl, { id: f.sha256, ext, serveUrl: `https://cdn/${f.sha256}/base.${ext}`, present }]
          })
        )
      }
    }
  }
}

test('⭐ a PNG a page shows goes up as the WebP it prepares to, under a .webp key, recording its source and size', async () => {
  const png = noisePng()
  const dir = makeSite({ 'public/images/photo.png': png })
  const c = client()
  try {
    const { ids, map } = await uploadSiteMedia(c, dir, ['/images/photo.png'])
    const [sent] = c.calls[0]
    assert.equal(sent.path, 'images/photo.png.webp')
    assert.equal(sent.content_type, 'image/webp')
    assert.equal(sent.bytes.toString('latin1', 8, 12), 'WEBP')
    assert.equal(sent.sha256, sha(sent.bytes))
    assert.equal(sent.size, sent.bytes.length)
    assert.ok(sent.size < png.length)
    assert.deepEqual(
      { id: ids['/images/photo.png'].id, ext: ids['/images/photo.png'].ext, source: ids['/images/photo.png'].source, size: ids['/images/photo.png'].size },
      { id: sent.sha256, ext: 'webp', source: sha(png), size: sent.size }
    )
    assert.equal(map['/images/photo.png'], `https://cdn/${sent.sha256}/base.webp`)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('⭐ a picture prepared before from the same bytes is planned by the identity it recorded, and nothing is prepared', async () => {
  const png = noisePng()
  const dir = makeSite({ 'public/images/photo.png': png })
  const c = client({ present: true })
  const recorded = { '/images/photo.png': { id: 'PREPARED', ext: 'webp', source: sha(png), size: 1234 } }
  try {
    const { ids } = await uploadSiteMedia(c, dir, ['/images/photo.png'], { recorded })
    const [sent] = c.calls[0]
    assert.equal(sent.path, 'images/photo.png.webp')
    assert.equal(sent.sha256, 'PREPARED')
    assert.equal(sent.size, 1234)
    assert.equal(sent.bytes, undefined)
    assert.equal(typeof sent.load, 'function')
    assert.deepEqual(ids['/images/photo.png'], {
      id: 'PREPARED',
      ext: 'webp',
      served: ids['/images/photo.png'].served,
      source: sha(png),
      size: 1234
    })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a picture stored as it is before pictures were prepared stays as it is, its source recorded', async () => {
  const png = noisePng()
  const dir = makeSite({ 'public/images/photo.png': png })
  const c = client({ present: true })
  const recorded = { '/images/photo.png': { id: sha(png), ext: 'png' } }
  try {
    const { ids } = await uploadSiteMedia(c, dir, ['/images/photo.png'], { recorded })
    const [sent] = c.calls[0]
    assert.equal(sent.path, 'images/photo.png')
    assert.equal(sent.sha256, sha(png))
    assert.equal(sent.bytes, undefined)
    assert.equal(ids['/images/photo.png'].source, sha(png))
    assert.equal(ids['/images/photo.png'].ext, 'png')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a picture changed since it was prepared is prepared again', async () => {
  const png = noisePng(64, 64, 11)
  const dir = makeSite({ 'public/images/photo.png': png })
  const c = client()
  const recorded = { '/images/photo.png': { id: 'OLD', ext: 'webp', source: 'an-older-file', size: 99 } }
  try {
    await uploadSiteMedia(c, dir, ['/images/photo.png'], { recorded })
    const [sent] = c.calls[0]
    assert.ok(sent.bytes)
    assert.notEqual(sent.sha256, 'OLD')
    assert.equal(sent.path, 'images/photo.png.webp')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("a file record's file is a download, never prepared: kept as its author gave it", async () => {
  const png = noisePng()
  const dir = makeSite({ 'chart.png': png })
  const c = client()
  try {
    const { ids } = await uploadSiteMedia(c, dir, [
      { ref: 'records/charts/q3.png', path: join(dir, 'chart.png'), contentType: 'image/png' }
    ])
    const [sent] = c.calls[0]
    assert.equal(sent.path, 'records/charts/q3.png')
    assert.equal(sent.content_type, 'image/png')
    assert.equal(sent.sha256, sha(png))
    assert.equal(sent.bytes, undefined)
    assert.equal(ids['records/charts/q3.png'].source, undefined)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a recorded preparation the backend lost, whose file now prepares to other bytes, is prepared anew and planned again', async () => {
  const png = noisePng()
  const dir = makeSite({ 'public/images/photo.png': png })
  const recorded = { '/images/photo.png': { id: 'MADE-BY-AN-OLDER-RULE', ext: 'webp', source: sha(png), size: 1234 } }
  const c = client({
    answers: [
      // The first plan: the recorded identity is gone, and `load` made other bytes.
      (files) => ({ failed: files.map((f) => ({ path: f.path, status: 0, stale: true })), assetsByLocalUrl: {} })
    ]
  })
  try {
    const { ids, map } = await uploadSiteMedia(c, dir, ['/images/photo.png'], { recorded })
    assert.equal(c.calls.length, 2)
    const [again] = c.calls[1]
    assert.ok(again.bytes)
    assert.equal(again.sha256, sha(again.bytes))
    assert.equal(ids['/images/photo.png'].id, again.sha256)
    assert.equal(ids['/images/photo.png'].source, sha(png))
    assert.ok(map['/images/photo.png'])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('⭐ a picture other software fetches (the touch icon, a social image) goes up as it is', async () => {
  const png = noisePng()
  const dir = makeSite({ 'public/touch-icon.png': png, 'public/images/photo.png': png })
  const c = client()
  try {
    const { ids } = await uploadSiteMedia(c, dir, ['/touch-icon.png', '/images/photo.png'], {
      asIs: new Set(['/touch-icon.png'])
    })
    const byRef = Object.fromEntries(c.calls[0].map((f) => [f.localUrl, f]))
    // A phone takes a PNG for its home screen: the icon's own bytes, under its own name.
    assert.equal(byRef['/touch-icon.png'].path, 'touch-icon.png')
    assert.equal(byRef['/touch-icon.png'].content_type, 'image/png')
    assert.equal(byRef['/touch-icon.png'].sha256, sha(png))
    assert.equal(byRef['/touch-icon.png'].bytes, undefined)
    assert.equal(ids['/touch-icon.png'].source, undefined)
    // The same picture drawn on a page is prepared.
    assert.equal(byRef['/images/photo.png'].path, 'images/photo.png.webp')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
