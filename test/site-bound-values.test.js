/**
 * The site.yml value that belongs to ONE backend site — the app's generated
 * `preview` — and when the CLI drops it.
 *
 * ⛔ `$url` is not one of them any more. It was retired on 2026-09-17: where a site
 * went live is a deploy fact, recorded in deploy.yml, and nothing reads a leftover
 * `$url` line — so there is nothing to drop.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import yaml from 'js-yaml'
import { dropSiteBoundValues } from '../src/backend/site-sync.js'

// Bound-ness is per backend, in sync.json, since 2026-09-20.
const ORIGIN = 'http://backend.test'

function siteWith(body) {
  const dir = mkdtempSync(join(tmpdir(), 'site-bound-'))
  writeFileSync(join(dir, 'site.yml'), body)
  return dir
}
const read = (dir) => readFileSync(join(dir, 'site.yml'), 'utf8')

test("⛔ an unbound project drops the app's generated preview", () => {
  const dir = siteWith("name: S\npreview: '2026-09-10T12:34:56Z'\n")
  try {
    assert.deepEqual(dropSiteBoundValues(dir, ORIGIN), ['preview'])
    assert.equal(read(dir), 'name: S\n')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("an author's preview is theirs and survives — a URL, or a path in the project", () => {
  for (const preview of ['/images/card.png', 'images/card.png', 'https://cdn.example/card.png']) {
    const dir = siteWith(`name: S\npreview: ${preview}\n`)
    try {
      assert.deepEqual(dropSiteBoundValues(dir, ORIGIN), [])
      assert.equal(yaml.load(read(dir)).preview, preview)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
})

test('a bound project keeps its generated preview', () => {
  const body = "name: S\npreview: '2026-09-10T12:34:56Z'\n"
  const dir = siteWith(body)
  // Bound on ORIGIN: a site uuid in that backend's section of sync.json.
  writeFileSync(
    join(dir, 'sync.json'),
    JSON.stringify({ version: 1, backends: { [ORIGIN]: { site: { uuid: 'abc' } } } })
  )
  try {
    assert.deepEqual(dropSiteBoundValues(dir, ORIGIN), [])
    assert.equal(read(dir), body)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
