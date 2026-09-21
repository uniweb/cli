/**
 * `uniweb i18n status --freeform`, `update-hash` and `prune --freeform` judge a free-form
 * translation by the paths the renderer reads it from — `@uniweb/build/i18n`'s
 * `freeformSourceIndex`, the index the build's own check uses.
 *
 * ⛔ Each derived one path per section — `page-ids/<id>/<section>.md` when the page has an
 * `id` — where the renderer also reads `pages/<route>/<section>.md`. So on a page with an
 * `id`, a route-addressed translation the page renders was "orphaned" to `status`,
 * unknown to `update-hash`, and DELETED by `prune --freeform`, along with every record
 * translation (`records/…`), which no check over site content can see.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { computeSourceHash } from '@uniweb/build/i18n'

const CLI = join(dirname(dirname(fileURLToPath(import.meta.url))), 'src/index.js')

function run(args) {
  try {
    return { code: 0, out: execFileSync('node', [CLI, ...args], { encoding: 'utf8', stdio: 'pipe' }) }
  } catch (err) {
    return { code: err.status ?? 1, out: err.stdout || '', err: err.stderr || '' }
  }
}

const doc = (text) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })
const STORY = doc('Our story')

/**
 * A built site whose `/about` page has an `id`, with three registered Spanish free-form
 * translations: the route-addressed one the page renders, a record's, and one for a
 * section that does not exist.
 */
function site({ storyHash = computeSourceHash(STORY), pages = null } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'i18n-freeform-paths-'))
  const w = (rel, body) => {
    mkdirSync(join(root, rel, '..'), { recursive: true })
    writeFileSync(join(root, rel), typeof body === 'string' ? body : JSON.stringify(body, null, 2))
  }
  w('site.yml', 'name: t\nlanguages: [en, es]\n')
  // `status` asks for the page manifest before it reads any mode
  w('locales/manifest.json', { version: '1.0', units: {} })
  w('dist/site-content.json', {
    config: { name: 't' },
    pages: pages ?? [{ route: '/about', id: 'ae274cc8', title: 'About', sections: [{ id: 'story', stableId: 'story', content: STORY }] }],
  })
  w('locales/freeform/es/pages/about/story.md', 'Nuestra historia\n')
  w('locales/freeform/es/records/article/hello.md', 'Hola\n')
  w('locales/freeform/es/pages/about/gone.md', 'Ya no\n')
  w('locales/freeform/es/.manifest.json', {
    'pages/about/story.md': { hash: storyHash, recorded: '2025-01-28' },
    'records/article/hello.md': { hash: 'aaaaaaaa', recorded: '2025-01-28' },
    'pages/about/gone.md': { hash: 'bbbbbbbb', recorded: '2025-01-28' },
  })
  return root
}
const manifestOf = (root) => JSON.parse(readFileSync(join(root, 'locales/freeform/es/.manifest.json'), 'utf8'))

test('status --freeform: the route-addressed and the record translation are not orphaned', () => {
  const root = site()
  try {
    const { code, out, err } = run(['i18n', 'status', 'es', '--freeform', '--json', '--target', root])
    assert.equal(code, 0, err)
    const { es } = JSON.parse(out).locales
    assert.deepEqual(es.orphaned.map((o) => o.path), ['pages/about/gone.md'])
    assert.deepEqual(es.stale, [])
    assert.equal(es.total, 3)
    assert.equal(es.upToDate, 2)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('prune --freeform --dry-run lists only the true orphan, and deletes nothing', () => {
  const root = site()
  try {
    const { code, out, err } = run(['i18n', 'prune', '--freeform', '--dry-run', '--target', root])
    assert.equal(code, 0, err)
    assert.match(out, /pages\/about\/gone\.md/)
    assert.doesNotMatch(out, /pages\/about\/story\.md/)
    assert.doesNotMatch(out, /records\/article\/hello\.md/)
    assert.match(out, /Would remove 1 orphaned translation/)
    for (const rel of ['pages/about/story.md', 'records/article/hello.md', 'pages/about/gone.md']) {
      assert.ok(existsSync(join(root, 'locales/freeform/es', rel)), `${rel} must still exist`)
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('prune --freeform keeps the route-addressed and the record translation, and removes the orphan', () => {
  const root = site()
  try {
    const { code, err } = run(['i18n', 'prune', '--freeform', '--target', root])
    assert.equal(code, 0, err)
    assert.ok(existsSync(join(root, 'locales/freeform/es/pages/about/story.md')))
    assert.ok(existsSync(join(root, 'locales/freeform/es/records/article/hello.md')))
    assert.ok(!existsSync(join(root, 'locales/freeform/es/pages/about/gone.md')))
    assert.deepEqual(Object.keys(manifestOf(root)).sort(), ['pages/about/story.md', 'records/article/hello.md'])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('prune --freeform never removes a translation for a page whose sections the built content does not carry', () => {
  // A prerendered site with split content rewrites `site-content.json` without page sections.
  const root = site({ pages: [{ route: '/about', id: 'ae274cc8', title: 'About' }] })
  try {
    const { code, out, err } = run(['i18n', 'prune', '--freeform', '--target', root])
    assert.equal(code, 0, err)
    assert.match(out, /No orphaned translations found/)
    assert.ok(existsSync(join(root, 'locales/freeform/es/pages/about/gone.md')))
    assert.ok(existsSync(join(root, 'locales/freeform/es/pages/about/story.md')))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('update-hash finds the source of a route-addressed translation on a page with an id', () => {
  const root = site({ storyHash: 'deadbeef' })
  try {
    const one = run(['i18n', 'update-hash', 'es', 'pages/about', 'story', '--target', root])
    assert.equal(one.code, 0, `${one.out}${one.err}`)
    assert.equal(manifestOf(root)['pages/about/story.md'].hash, computeSourceHash(STORY))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('update-hash --all-stale updates a stale route-addressed translation on a page with an id', () => {
  const root = site({ storyHash: 'deadbeef' })
  try {
    const { code, out, err } = run(['i18n', 'update-hash', 'es', '--all-stale', '--target', root])
    assert.equal(code, 0, err)
    assert.match(out, /Updated hash: pages\/about\/story\.md/)
    assert.equal(manifestOf(root)['pages/about/story.md'].hash, computeSourceHash(STORY))
    // CONTROL — what it cannot judge keeps its recorded hash
    assert.equal(manifestOf(root)['records/article/hello.md'].hash, 'aaaaaaaa')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
