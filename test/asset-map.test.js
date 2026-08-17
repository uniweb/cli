/**
 * `assets.json` — the committed local-ref → asset-id map.
 *
 * The properties under test are the ones that make a COMMITTED file safe to
 * keep: it merges rather than replaces (a push carries only the refs its
 * content touched), it sorts (an unstable file diffs on every push and trains
 * people to stop reading it), and it does not rewrite an identical file (a push
 * that moved no assets must leave `git status` clean).
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  readAssetMap,
  updateAssetMap,
  refForAssetId,
  ASSET_MAP_FILE
} from '../src/backend/asset-map.js'

const site = () => mkdtempSync(join(tmpdir(), 'uw-assetmap-'))
const raw = (dir) => readFileSync(join(dir, ASSET_MAP_FILE), 'utf8')

test('a missing map reads as empty rather than throwing', () => {
  const dir = site()
  try {
    assert.deepEqual(readAssetMap(dir), {})
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a corrupt map reads as empty — it must never be why a push fails', () => {
  const dir = site()
  try {
    writeFileSync(join(dir, ASSET_MAP_FILE), '{ this is not json')
    assert.deepEqual(readAssetMap(dir), {})
    // …and the next write repairs it rather than compounding the damage.
    updateAssetMap(dir, { '/images/a.png': { id: 'A', ext: 'png' } })
    assert.deepEqual(readAssetMap(dir), { '/images/a.png': { id: 'A', ext: 'png' } })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('writes sorted keys and a trailing newline', () => {
  const dir = site()
  try {
    updateAssetMap(dir, {
      '/images/z.png': { id: 'Z', ext: 'png' },
      '/images/a.png': { id: 'A', ext: 'png' },
      '/images/m.png': { id: 'M', ext: 'png' }
    })
    const text = raw(dir)
    const order = [...text.matchAll(/"(\/images\/[^"]+)"/g)].map((m) => m[1])
    assert.deepEqual(order, ['/images/a.png', '/images/m.png', '/images/z.png'])
    assert.ok(text.endsWith('\n'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('MERGES rather than replaces — a partial push must not drop untouched refs', () => {
  const dir = site()
  try {
    updateAssetMap(dir, { '/images/a.png': { id: 'A', ext: 'png' } })
    // A later push whose content mentions only b.png.
    updateAssetMap(dir, { '/images/b.png': { id: 'B', ext: 'png' } })
    assert.deepEqual(readAssetMap(dir), {
      '/images/a.png': { id: 'A', ext: 'png' },
      '/images/b.png': { id: 'B', ext: 'png' }
    })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('⭐ an unchanged push does not rewrite the file — git status stays clean', () => {
  const dir = site()
  try {
    const entries = { '/images/a.png': { id: 'A', ext: 'png' } }
    const first = updateAssetMap(dir, entries)
    assert.equal(first.written, true)
    assert.deepEqual(first.added, ['/images/a.png'])

    const before = raw(dir)
    const second = updateAssetMap(dir, entries)
    assert.equal(second.written, false, 'must not rewrite an identical map')
    assert.deepEqual(second.added, [])
    assert.deepEqual(second.changed, [])
    assert.equal(raw(dir), before)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('re-pointing a ref is reported as changed, not added', () => {
  const dir = site()
  try {
    updateAssetMap(dir, { '/images/a.png': { id: 'A', ext: 'png' } })
    const r = updateAssetMap(dir, { '/images/a.png': { id: 'A2', ext: 'png' } })
    assert.deepEqual(r.changed, ['/images/a.png'])
    assert.deepEqual(r.added, [])
    assert.equal(readAssetMap(dir)['/images/a.png'].id, 'A2')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('⭐ refForAssetId is the direction pull needs — id back to the AUTHORED path', () => {
  // The whole reason the map is worth committing: stored content carries an id,
  // and only this can say the author called it /images/hero.png. Without it a
  // pull has to invent a path.
  const map = {
    '/images/hero.png': { id: '9f2c', ext: 'png' },
    '/images/other.png': { id: 'abcd', ext: 'png' }
  }
  assert.equal(refForAssetId(map, '9f2c'), '/images/hero.png')
  assert.equal(refForAssetId(map, 'nope'), null)
  assert.equal(refForAssetId(map, ''), null)
})

test('entries with no id are ignored rather than written as junk', () => {
  const dir = site()
  try {
    const r = updateAssetMap(dir, { '/images/a.png': { ext: 'png' } })
    assert.equal(r.written, false)
    assert.equal(existsSync(join(dir, ASSET_MAP_FILE)), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
