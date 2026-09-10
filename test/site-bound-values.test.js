/**
 * The two site.yml values that belong to ONE backend site — `$url` (where it is
 * live, carried as `info.url` for site cards) and the app's generated `preview` —
 * and when the CLI writes or drops them.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import yaml from 'js-yaml'
import {
  dropSiteBoundValues,
  recordLiveUrl
} from '../src/backend/site-sync.js'

function siteWith(body) {
  const dir = mkdtempSync(join(tmpdir(), 'site-bound-'))
  writeFileSync(join(dir, 'site.yml'), body)
  return dir
}
const read = (dir) => readFileSync(join(dir, 'site.yml'), 'utf8')

test('recordLiveUrl writes $url when the address is new, keeping comments', () => {
  const dir = siteWith('# comments survive\nname: S\n')
  try {
    const r = recordLiveUrl(dir, 'https://acme.example/')
    assert.deepEqual(r, { changed: true, previous: null })
    assert.equal(yaml.load(read(dir)).$url, 'https://acme.example/')
    assert.ok(read(dir).includes('# comments survive'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('⭐ recordLiveUrl leaves site.yml untouched when the address is the same', () => {
  const dir = siteWith('$url: https://acme.example/\nname: S\n')
  try {
    const before = read(dir)
    assert.equal(recordLiveUrl(dir, 'https://acme.example/').changed, false)
    assert.equal(read(dir), before)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('recordLiveUrl replaces an address that moved', () => {
  const dir = siteWith('$url: https://old.example/\nname: S\n')
  try {
    const r = recordLiveUrl(dir, 'https://new.example/')
    assert.deepEqual(r, { changed: true, previous: 'https://old.example/' })
    assert.equal(yaml.load(read(dir)).$url, 'https://new.example/')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('recordLiveUrl with no address writes nothing', () => {
  const dir = siteWith('name: S\n')
  try {
    assert.equal(recordLiveUrl(dir, null).changed, false)
    assert.equal(read(dir), 'name: S\n')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("⛔ an unbound project drops the previous site's $url and the app's generated preview", () => {
  const dir = siteWith(
    "name: S\n$url: https://old.example/\npreview: '2026-09-10T12:34:56Z'\n"
  )
  try {
    assert.deepEqual(dropSiteBoundValues(dir), ['$url', 'preview'])
    assert.equal(read(dir), 'name: S\n')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("an author's preview is theirs and survives — a URL, or a path in the project", () => {
  for (const preview of ['/images/card.png', 'https://cdn.example/card.png']) {
    const dir = siteWith(`name: S\npreview: ${preview}\n`)
    try {
      assert.deepEqual(dropSiteBoundValues(dir), [])
      assert.equal(yaml.load(read(dir)).preview, preview)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
})

test('a bound project (it has a $uuid) keeps both', () => {
  const body =
    "$uuid: abc\nname: S\n$url: https://acme.example/\npreview: '2026-09-10T12:34:56Z'\n"
  const dir = siteWith(body)
  try {
    assert.deepEqual(dropSiteBoundValues(dir), [])
    assert.equal(read(dir), body)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
