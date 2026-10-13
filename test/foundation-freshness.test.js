/**
 * When is a local foundation's build stale? `isFoundationSourceNewerThan` decides
 * whether `uniweb build` (from a site), `export`, `deploy --host` and `dev` rebuild
 * a foundation or an extension before using its `dist/`.
 *
 * ⛔ Until 2026-10-13 it walked `<package>/src/` whatever the layout. Every package
 * scaffolded since the flat layout keeps `main.js` and `sections/` at its root, so
 * an edit to a section never made one stale: prerender rendered the static HTML
 * with the foundation as last built.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { isFoundationSourceNewerThan } from '../src/commands/build.js'

const BUILT = Date.now() - 60_000

/** A package whose files are all older than its build, at `BUILT`. */
function pkg(main, files) {
  const dir = mkdtempSync(join(tmpdir(), 'uniweb-fresh-'))
  for (const [rel, body] of Object.entries({ 'package.json': JSON.stringify({ main }), ...files })) {
    mkdirSync(join(dir, rel, '..'), { recursive: true })
    writeFileSync(join(dir, rel), body)
    const old = new Date(BUILT - 60_000)
    utimesSync(join(dir, rel), old, old)
  }
  return dir
}
const touch = (file) => utimesSync(file, new Date(), new Date())

test('a flat package goes stale when a section changes', () => {
  const dir = pkg('./_entry.generated.js', { 'main.js': '', 'sections/Hero.jsx': '' })
  try {
    assert.equal(isFoundationSourceNewerThan(dir, BUILT), false) // CONTROL: nothing edited
    touch(join(dir, 'sections', 'Hero.jsx'))
    assert.equal(isFoundationSourceNewerThan(dir, BUILT), true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a flat package goes stale when main.js changes', () => {
  const dir = pkg('./_entry.generated.js', { 'main.js': '' })
  try {
    touch(join(dir, 'main.js'))
    assert.equal(isFoundationSourceNewerThan(dir, BUILT), true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a nested package is walked from src/, as before', () => {
  const dir = pkg('./src/_entry.generated.js', { 'src/main.js': '', 'src/sections/Hero.jsx': '' })
  try {
    assert.equal(isFoundationSourceNewerThan(dir, BUILT), false)
    touch(join(dir, 'src', 'sections', 'Hero.jsx'))
    assert.equal(isFoundationSourceNewerThan(dir, BUILT), true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('what the build writes is not a source: dist/, node_modules/ and the generated entry', () => {
  const dir = pkg('./_entry.generated.js', {
    'main.js': '',
    '_entry.generated.js': '',
    'dist/entry.js': '',
    'node_modules/x/index.js': ''
  })
  try {
    for (const rel of ['_entry.generated.js', 'dist/entry.js', 'node_modules/x/index.js']) {
      touch(join(dir, rel))
    }
    assert.equal(isFoundationSourceNewerThan(dir, BUILT), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
