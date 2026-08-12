/**
 * The `.uwx` reader that `uniweb clone` depends on.
 *
 * `clone` runs before a project exists, so it cannot reach `@uniweb/build/uwx`'s
 * `readZip` — the reader every in-project lane uses. These pin the behaviour of
 * the local substitute, and the first test is the one that matters: the archive
 * mixes compression methods, and the naive reader for this format handles only
 * the one the code comments mention.
 *
 * The regression this guards is silent. A stored-only reader returns the
 * manifest, drops the entity document, and reports success with zero
 * documents — which surfaces as "the site carried no recognizable document"
 * rather than as a decode failure.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deflateRawSync, crc32 } from 'node:zlib'
import { readUwxDocuments, readUwxZip, looksLikeZip } from '../src/utils/uwx-read.js'

/**
 * Build a ZIP with a per-entry compression method, so a test can produce the
 * mixed archive the backend actually serves.
 *
 * @param {Array<{name: string, body: string, deflate?: boolean}>} entries
 */
function makeZip(entries) {
  const locals = []
  const central = []
  let offset = 0

  for (const { name, body, deflate } of entries) {
    const nameBuf = Buffer.from(name, 'utf8')
    const raw = Buffer.from(body, 'utf8')
    const data = deflate ? deflateRawSync(raw) : raw
    const method = deflate ? 8 : 0
    const crc = crc32(raw)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4) // version needed
    local.writeUInt16LE(method, 8)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(raw.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    locals.push(local, nameBuf, data)

    const cd = Buffer.alloc(46)
    cd.writeUInt32LE(0x02014b50, 0)
    cd.writeUInt16LE(method, 10)
    cd.writeUInt32LE(crc, 16)
    cd.writeUInt32LE(data.length, 20)
    cd.writeUInt32LE(raw.length, 24)
    cd.writeUInt16LE(nameBuf.length, 28)
    cd.writeUInt32LE(offset, 42)
    central.push(cd, nameBuf)

    offset += local.length + nameBuf.length + data.length
  }

  const localPart = Buffer.concat(locals)
  const centralPart = Buffer.concat(central)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(centralPart.length, 12)
  eocd.writeUInt32LE(localPart.length, 16)

  return Buffer.concat([localPart, centralPart, eocd])
}

const DOC = { $id: 'site-content', $model: '@uniweb/site-content', info: { name: 'S' } }

test('reads a DEFLATED entity — the method a stored-only reader silently drops', () => {
  // Measured on a live pull: manifest.json is STORED and the entity JSON is
  // DEFLATED, though the format is described in-tree as "our Stored ZIP".
  const buf = makeZip([
    { name: 'manifest.json', body: JSON.stringify({ v: 1 }), deflate: false },
    { name: 'entities/abc.json', body: JSON.stringify(DOC), deflate: true }
  ])
  const docs = readUwxDocuments(buf)
  assert.equal(docs.length, 1, 'the deflated entity must survive')
  assert.deepEqual(docs[0], DOC)
})

test('reads a STORED entity too', () => {
  const buf = makeZip([{ name: 'entities/abc.json', body: JSON.stringify(DOC) }])
  assert.deepEqual(readUwxDocuments(buf), [DOC])
})

test('skips manifest.json and non-JSON members', () => {
  const buf = makeZip([
    { name: 'manifest.json', body: JSON.stringify({ v: 1 }), deflate: true },
    { name: 'assets/logo.svg', body: '<svg/>' },
    { name: 'entities/abc.json', body: JSON.stringify(DOC), deflate: true }
  ])
  assert.deepEqual(readUwxDocuments(buf), [DOC])
})

test('a corrupt member does not lose the readable ones', () => {
  const buf = makeZip([
    { name: 'entities/bad.json', body: '{ not json' , deflate: true },
    { name: 'entities/abc.json', body: JSON.stringify(DOC), deflate: true }
  ])
  assert.deepEqual(readUwxDocuments(buf), [DOC])
})

test('falls back to a JSON body, so an envelope change does not break the lane', () => {
  assert.deepEqual(readUwxDocuments(Buffer.from(JSON.stringify(DOC))), [DOC])
  assert.deepEqual(
    readUwxDocuments(Buffer.from(JSON.stringify({ entities: [DOC] }))),
    [DOC]
  )
})

test('returns empty rather than throwing on junk, empty, and a 304 body', () => {
  assert.deepEqual(readUwxDocuments(Buffer.alloc(0)), [])
  assert.deepEqual(readUwxDocuments(Buffer.from('not json at all')), [])
  assert.deepEqual(readUwxZip(Buffer.from('PK')), [])
})

test('looksLikeZip identifies the PK magic that broke the JSON parse', () => {
  assert.equal(looksLikeZip(makeZip([{ name: 'a.json', body: '{}' }])), true)
  assert.equal(looksLikeZip(Buffer.from('{"json":true}')), false)
})
