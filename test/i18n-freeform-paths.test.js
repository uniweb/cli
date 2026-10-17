/**
 * `uniweb i18n status --freeform`, `init-freeform`, `update-hash` and `prune --freeform` judge a
 * free-form translation by the paths the renderer reads it from — `@uniweb/build/i18n`'s
 * `freeformSourceIndex`, the index the build's own check uses — over the site's content as its
 * SOURCE says it, collected as `extract` collects it. No build needed.
 *
 * ⛔ Each derived one path per section — `page-ids/<id>/<section>.md` when the page has an
 * `id` — where the renderer also reads `pages/<route>/<section>.md`. So on a page with an
 * `id`, a route-addressed translation the page renders was "orphaned" to `status`,
 * unknown to `update-hash`, and DELETED by `prune --freeform`, along with every record
 * translation (`records/…`), which no check over site content can see.
 *
 * ⛔ And until 2026-10-17 they read `dist/site-content.json`. A prerendered build that splits
 * its content rewrites that file without page sections, so `status` compared no page
 * translation and counted each one up to date, `update-hash --all-stale` found nothing and
 * `init-freeform` found no section; and a build leaves out `hidden:` pages, so `prune
 * --freeform` deleted their translations.
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

// What a prerendered build that splits its content leaves in `dist/site-content.json`: its
// pages, without their sections (`build/src/prerender.js`).
const SPLIT = {
  config: { name: 't' },
  pages: [
    { route: '/', title: 'Home' },
    { route: '/about', id: 'ae274cc8', title: 'About' },
  ],
}
// What a build leaves there for a site with a `hidden:` page: every page but that one.
const BUILT = {
  config: { name: 't' },
  pages: [{ route: '/about', id: 'ae274cc8', title: 'About', sections: [{ id: 'story', stableId: 'story', content: STORY }] }],
}

/**
 * A site whose `/about` page has an `id`, with three registered Spanish free-form
 * translations: the route-addressed one the page renders, a record's, and one for a
 * section that does not exist. `draft` adds a `hidden:` page and a `hidden:` section, each
 * with a translation of its own; `dist` writes what a build left behind.
 */
function site({ storyHash = computeSourceHash(STORY), draft = false, dist = null } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'i18n-freeform-paths-'))
  const w = (rel, body) => {
    mkdirSync(join(root, rel, '..'), { recursive: true })
    writeFileSync(join(root, rel), typeof body === 'string' ? body : JSON.stringify(body, null, 2))
  }
  w('site.yml', 'name: t\nlanguages: [en, es]\nindex: home\n')
  // `status` asks for the page manifest before it reads any mode
  w('locales/manifest.json', { version: '1.0', units: {} })
  w('pages/home/page.yml', 'title: Home\n')
  // An icon, so the collector reports on stdout — which `--json` must keep off its output.
  w('pages/home/hero.md', '# Hello\n\n![](lu-house)\n')
  w('pages/about/page.yml', 'id: ae274cc8\ntitle: About\n')
  w('pages/about/story.md', 'Our story\n')
  w('pages/about/intro.md', 'Welcome aboard\n')
  w('locales/freeform/es/pages/about/story.md', 'Nuestra historia\n')
  w('locales/freeform/es/records/article/hello.md', 'Hola\n')
  w('locales/freeform/es/pages/about/gone.md', 'Ya no\n')
  const manifest = {
    'pages/about/story.md': { hash: storyHash, recorded: '2025-01-28' },
    'records/article/hello.md': { hash: 'aaaaaaaa', recorded: '2025-01-28' },
    'pages/about/gone.md': { hash: 'bbbbbbbb', recorded: '2025-01-28' },
  }
  if (draft) {
    w('pages/draft/page.yml', 'title: Draft\nhidden: true\n')
    w('pages/draft/teaser.md', 'Coming soon\n')
    w('locales/freeform/es/pages/draft/teaser.md', 'Muy pronto\n')
    manifest['pages/draft/teaser.md'] = { hash: computeSourceHash(doc('Coming soon')), recorded: '2025-01-28' }
    w('pages/about/secret.md', '---\nhidden: true\n---\n\nNot yet\n')
    w('locales/freeform/es/pages/about/secret.md', 'Todavía no\n')
    manifest['pages/about/secret.md'] = { hash: computeSourceHash(doc('Not yet')), recorded: '2025-01-28' }
  }
  w('locales/freeform/es/.manifest.json', manifest)
  if (dist) w('dist/site-content.json', dist)
  return root
}
const manifestOf = (root) => JSON.parse(readFileSync(join(root, 'locales/freeform/es/.manifest.json'), 'utf8'))

function withSite(options, fn) {
  const root = site(options)
  try {
    fn(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test('status --freeform: the route-addressed translation is up to date, the record’s is not checked — no build needed', () =>
  withSite({}, (root) => {
    const { code, out, err } = run(['i18n', 'status', 'es', '--freeform', '--json', '--target', root])
    assert.equal(code, 0, err)
    // JSON alone: the collector's report goes to stderr
    const { es } = JSON.parse(out).locales
    assert.deepEqual(es.orphaned.map((o) => o.path), ['pages/about/gone.md'])
    assert.deepEqual(es.stale, [])
    assert.equal(es.total, 3)
    assert.equal(es.upToDate, 1)
    // ⛔ Nothing compares a record's translation with its record, so it is not called up to date.
    assert.deepEqual(es.notChecked, [{ path: 'records/article/hello.md' }])
  }))

test('⭐ status --freeform on a prerendered site compares every page translation with its source', () =>
  withSite({ storyHash: 'deadbeef', dist: SPLIT }, (root) => {
    const { code, out, err } = run(['i18n', 'status', 'es', '--freeform', '--json', '--target', root])
    assert.equal(code, 0, err)
    const { es } = JSON.parse(out).locales
    assert.deepEqual(es.stale.map((s) => s.path), ['pages/about/story.md'])
    assert.equal(es.upToDate, 0)
  }))

test('status --freeform says what it did not check, in its summary', () =>
  withSite({}, (root) => {
    const { code, out, err } = run(['i18n', 'status', 'es', '--freeform', '--target', root])
    assert.equal(code, 0, err)
    assert.match(out, /Not checked \(no source to compare with\)/)
    assert.match(out, /records\/article\/hello\.md/)
    assert.match(out, /1 up to date, 0 stale, 1 orphaned, 1 not checked/)
  }))

test('prune --freeform --dry-run lists only the true orphan, and deletes nothing', () =>
  withSite({}, (root) => {
    const { code, out, err } = run(['i18n', 'prune', '--freeform', '--dry-run', '--target', root])
    assert.equal(code, 0, err)
    assert.match(out, /pages\/about\/gone\.md/)
    assert.doesNotMatch(out, /pages\/about\/story\.md/)
    assert.doesNotMatch(out, /records\/article\/hello\.md/)
    assert.match(out, /Would remove 1 orphaned translation/)
    for (const rel of ['pages/about/story.md', 'records/article/hello.md', 'pages/about/gone.md']) {
      assert.ok(existsSync(join(root, 'locales/freeform/es', rel)), `${rel} must still exist`)
    }
  }))

test('prune --freeform keeps the route-addressed and the record translation, and removes the orphan', () =>
  withSite({}, (root) => {
    const { code, err } = run(['i18n', 'prune', '--freeform', '--target', root])
    assert.equal(code, 0, err)
    assert.ok(existsSync(join(root, 'locales/freeform/es/pages/about/story.md')))
    assert.ok(existsSync(join(root, 'locales/freeform/es/records/article/hello.md')))
    assert.ok(!existsSync(join(root, 'locales/freeform/es/pages/about/gone.md')))
    assert.deepEqual(Object.keys(manifestOf(root)).sort(), ['pages/about/story.md', 'records/article/hello.md'])
  }))

test('⭐ prune --freeform keeps the translation of a `hidden:` page or section, which a build leaves out', () =>
  withSite({ draft: true, dist: BUILT }, (root) => {
    const { code, err } = run(['i18n', 'prune', '--freeform', '--target', root])
    assert.equal(code, 0, err)
    for (const rel of ['pages/draft/teaser.md', 'pages/about/secret.md']) {
      assert.ok(existsSync(join(root, 'locales/freeform/es', rel)), `${rel} must still exist`)
      assert.ok(manifestOf(root)[rel], `${rel} must stay in the manifest`)
    }
    // CONTROL — the orphan beside them is removed
    assert.ok(!existsSync(join(root, 'locales/freeform/es/pages/about/gone.md')))
  }))

test('update-hash finds the source of a route-addressed translation on a page with an id', () =>
  withSite({ storyHash: 'deadbeef' }, (root) => {
    const one = run(['i18n', 'update-hash', 'es', 'pages/about', 'story', '--target', root])
    assert.equal(one.code, 0, `${one.out}${one.err}`)
    assert.equal(manifestOf(root)['pages/about/story.md'].hash, computeSourceHash(STORY))
  }))

test('⭐ update-hash --all-stale updates a stale route-addressed translation on a prerendered site', () =>
  withSite({ storyHash: 'deadbeef', dist: SPLIT }, (root) => {
    const { code, out, err } = run(['i18n', 'update-hash', 'es', '--all-stale', '--target', root])
    assert.equal(code, 0, err)
    assert.match(out, /Updated hash: pages\/about\/story\.md/)
    assert.equal(manifestOf(root)['pages/about/story.md'].hash, computeSourceHash(STORY))
    // CONTROL — what it cannot judge keeps its recorded hash
    assert.equal(manifestOf(root)['records/article/hello.md'].hash, 'aaaaaaaa')
  }))

test('⭐ init-freeform finds a page’s section on a prerendered site', () =>
  withSite({ dist: SPLIT }, (root) => {
    const { code, out, err } = run(['i18n', 'init-freeform', 'es', 'pages/about', 'intro', '--target', root])
    assert.equal(code, 0, `${out}${err}`)
    assert.equal(readFileSync(join(root, 'locales/freeform/es/pages/about/intro.md'), 'utf8').trim(), 'Welcome aboard')
    assert.equal(manifestOf(root)['pages/about/intro.md'].hash, computeSourceHash(doc('Welcome aboard')))
  }))
