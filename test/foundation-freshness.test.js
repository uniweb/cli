/**
 * When is a local foundation's build stale? `newerInput` (`src/utils/foundation-freshness.js`)
 * decides whether `uniweb build` (from a site), `export`, `deploy --host` and `dev` rebuild a
 * foundation or an extension before using its `dist/`, and whether `register` builds before it
 * uploads (`register.test.js`).
 *
 * ⛔ Until 2026-11-09 only the foundation's own folder counted. Measured: with only a library's
 * file changed (a local package the foundation depends on), `uniweb build` kept the old `dist/`,
 * and the prerendered page showed the old component while the site's JS had the new one.
 * ⛔ Until 2026-10-13 it walked `<package>/src/` whatever the layout. Every package scaffolded
 * since the flat layout keeps `main.js` and `sections/` at its root, so an edit to a section never
 * made one stale.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readdirSync, realpathSync, renameSync, writeFileSync, rmSync, symlinkSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { newerInput } from '../src/utils/foundation-freshness.js'

const BUILT = Date.now() - 60_000
const OLD = new Date(BUILT - 60_000)

/** Files under `dir`, all older than the build at `BUILT`, and their folders too. */
function files(dir, entries) {
  for (const [rel, body] of Object.entries(entries)) {
    mkdirSync(join(dir, rel, '..'), { recursive: true })
    writeFileSync(join(dir, rel), body)
    utimesSync(join(dir, rel), OLD, OLD)
  }
  age(dir, OLD)
  return dir
}

/** Every folder under `dir`, `dir` included, dated `when`, deepest first; links not followed. */
function age(dir, when) {
  for (const e of readdirSync(dir, { withFileTypes: true })) if (e.isDirectory()) age(join(dir, e.name), when)
  utimesSync(dir, when, when)
}

/** A package whose files are all older than its build. */
function pkg(main, entries, json = {}) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'uniweb-fresh-')))
  return files(dir, { 'package.json': JSON.stringify({ main, ...json }), ...entries })
}
const touch = (file) => utimesSync(file, new Date(), new Date())
const fresh = (dir) => newerInput(dir, BUILT) === null

/** A workspace: `classic`, a foundation depending on `shared` by `file:`, both built before `BUILT`. */
function workspace({ shared: sharedFiles = { 'index.js': '' }, sharedJson = {} } = {}) {
  const ws = realpathSync(mkdtempSync(join(tmpdir(), 'uniweb-fresh-ws-')))
  const shared = files(join(ws, 'shared'), { 'package.json': JSON.stringify({ name: '@acme/shared', ...sharedJson }), ...sharedFiles })
  const classic = files(join(ws, 'classic'), {
    'package.json': JSON.stringify({ name: 'classic', main: './_entry.generated.js', dependencies: { '@acme/shared': 'file:../shared' } }),
    'main.js': '',
    'sections/Pricing/index.jsx': ''
  })
  mkdirSync(join(classic, 'node_modules', '@acme'), { recursive: true })
  symlinkSync(shared, join(classic, 'node_modules', '@acme', 'shared'), 'dir')
  age(classic, OLD) // installed before the build
  return { ws, shared, classic }
}

test('a flat package goes stale when a section changes', () => {
  const dir = pkg('./_entry.generated.js', { 'main.js': '', 'sections/Hero.jsx': '' })
  try {
    assert.equal(fresh(dir), true) // CONTROL: nothing edited
    touch(join(dir, 'sections', 'Hero.jsx'))
    assert.deepEqual(newerInput(dir, BUILT), { file: join(dir, 'sections', 'Hero.jsx'), library: null })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a flat package goes stale when main.js changes', () => {
  const dir = pkg('./_entry.generated.js', { 'main.js': '' })
  try {
    touch(join(dir, 'main.js'))
    assert.equal(fresh(dir), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a nested package is walked from src/, with the files at its root that shape the build', () => {
  const dir = pkg('./src/_entry.generated.js', { 'src/main.js': '', 'src/sections/Hero.jsx': '', 'vite.config.js': '', 'README.md': '' })
  try {
    assert.equal(fresh(dir), true)
    touch(join(dir, 'README.md'))
    assert.equal(fresh(dir), true) // beside the sources, not one of them
    touch(join(dir, 'src', 'sections', 'Hero.jsx'))
    assert.equal(fresh(dir), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
  const config = pkg('./src/_entry.generated.js', { 'src/main.js': '', 'vite.config.js': '' })
  try {
    touch(join(config, 'vite.config.js'))
    assert.equal(fresh(config), false)
  } finally {
    rmSync(config, { recursive: true, force: true })
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
    assert.equal(fresh(dir), true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('⭐ a library it bundles goes stale with it, and is named', () => {
  const { ws, shared, classic } = workspace({ shared: { 'index.js': '', 'components/PlanCard.jsx': '' } })
  try {
    assert.equal(fresh(classic), true) // CONTROL: nothing edited
    touch(join(shared, 'components', 'PlanCard.jsx'))
    assert.deepEqual(newerInput(classic, BUILT), { file: join(shared, 'components', 'PlanCard.jsx'), library: '@acme/shared' })
  } finally {
    rmSync(ws, { recursive: true, force: true })
  }
})

test("a library's node_modules and dot-folders are not its sources", () => {
  const { ws, shared, classic } = workspace({ shared: { 'index.js': '', 'node_modules/x/index.js': '', '.git/HEAD': '' } })
  try {
    touch(join(shared, 'node_modules', 'x', 'index.js'))
    touch(join(shared, '.git', 'HEAD'))
    assert.equal(fresh(classic), true)
  } finally {
    rmSync(ws, { recursive: true, force: true })
  }
})

test("a library's dist/ is what the foundation may import; a foundation's dist/ is only its output", () => {
  const built = workspace({ shared: { 'dist/index.js': '' }, sharedJson: { main: './dist/index.js' } })
  try {
    touch(join(built.shared, 'dist', 'index.js'))
    assert.equal(fresh(built.classic), false)
  } finally {
    rmSync(built.ws, { recursive: true, force: true })
  }
  const other = workspace({ shared: { 'main.js': '', 'dist/entry.js': '', '_entry.generated.js': '' }, sharedJson: { main: './_entry.generated.js' } })
  try {
    touch(join(other.shared, 'dist', 'entry.js'))
    touch(join(other.shared, '_entry.generated.js'))
    assert.equal(fresh(other.classic), true) // another foundation, as a library: its build, not its sources
    touch(join(other.shared, 'main.js'))
    assert.equal(fresh(other.classic), false)
  } finally {
    rmSync(other.ws, { recursive: true, force: true })
  }
})

test('a library outside the workspace counts from the folder its `file:` path names', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'uniweb-fresh-out-')))
  try {
    const outside = files(join(root, 'acme-shared'), { 'package.json': JSON.stringify({ name: '@acme/shared' }), 'index.js': '' })
    const classic = files(join(root, 'project', 'classic'), {
      'package.json': JSON.stringify({ main: './_entry.generated.js', dependencies: { '@acme/shared': 'file:../../acme-shared' } }),
      'main.js': ''
    })
    // pnpm's copy in its store, which a new file in the library never reaches before an install
    const copy = join(root, 'project', 'node_modules', '.pnpm', 'acme-shared@file+..+acme-shared', 'node_modules', '@acme', 'shared')
    files(copy, { 'package.json': JSON.stringify({ name: '@acme/shared' }), 'index.js': '' })
    mkdirSync(join(classic, 'node_modules', '@acme'), { recursive: true })
    symlinkSync(copy, join(classic, 'node_modules', '@acme', 'shared'), 'dir')
    age(classic, OLD)
    assert.equal(fresh(classic), true)
    touch(join(outside, 'index.js'))
    assert.equal(newerInput(classic, BUILT)?.library, '@acme/shared')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('CONTROL: an installed package is not a source, whatever its time', () => {
  const dir = pkg('./_entry.generated.js', { 'main.js': '' }, { dependencies: { '@uniweb/kit': '~1.7.18' } })
  try {
    const kit = join(dirname(dir), `${dir.split('/').pop()}-store`, 'node_modules', '@uniweb', 'kit')
    files(kit, { 'package.json': '{}', 'src/index.js': '' })
    mkdirSync(join(dir, 'node_modules', '@uniweb'), { recursive: true })
    symlinkSync(kit, join(dir, 'node_modules', '@uniweb', 'kit'), 'dir')
    age(dir, OLD)
    touch(join(kit, 'src', 'index.js'))
    assert.equal(fresh(dir), true)
    rmSync(join(dirname(dir), `${dir.split('/').pop()}-store`), { recursive: true, force: true })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('⭐ a deleted or renamed file makes it stale, as its folder changes', () => {
  const dir = pkg('./_entry.generated.js', { 'main.js': '', 'sections/Hero.jsx': '', 'sections/Banner.jsx': '' })
  try {
    assert.equal(fresh(dir), true)
    rmSync(join(dir, 'sections', 'Banner.jsx'))
    assert.equal(newerInput(dir, BUILT)?.file, join(dir, 'sections'))
    age(dir, OLD)
    assert.equal(fresh(dir), true)
    // A rename keeps the file's own time.
    renameSync(join(dir, 'sections', 'Hero.jsx'), join(dir, 'sections', 'Lead.jsx'))
    assert.equal(newerInput(dir, BUILT)?.file, join(dir, 'sections'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("a nested package's public/ and its vite.config.* count", () => {
  const dir = pkg('./src/_entry.generated.js', { 'src/main.js': '', 'public/logo.svg': '', 'vite.config.mjs': '' })
  try {
    assert.equal(fresh(dir), true)
    touch(join(dir, 'public', 'logo.svg'))
    assert.equal(newerInput(dir, BUILT)?.file, join(dir, 'public', 'logo.svg'))
    utimesSync(join(dir, 'public', 'logo.svg'), OLD, OLD)
    touch(join(dir, 'vite.config.mjs'))
    assert.equal(newerInput(dir, BUILT)?.file, join(dir, 'vite.config.mjs'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

