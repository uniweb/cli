/**
 * `uniweb status --remote` says who has the site open in the app right now, and on what.
 *
 * [Diego, 2026-10-13] — "If we know the page and section each person is on, we can show it.
 * We are facilitating collaboration. People can follow up on their own." The site's status
 * carries `editors` for it (backend, 2026-10-13); the CLI names each tab's item by the file
 * it is in this copy, found by the item's uuid in `sync.json`'s `items`.
 *
 * Run: `pnpm test` or `node --test test/`
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmp, runVerb } from './helpers/run-verb.js'
import { describeEditors, fileByItemUuid } from '../src/commands/status.js'

const ORIGIN = 'http://backend.test'
const SITE = '01a13807-2400-7000-8000-000000000001'
const LAYOUT_ITEM = '01a13807-243a-7132-bdda-0bcf8ac694be'
const SECTION_ITEM = '01a13807-2435-75a1-a2dd-50d125a84676'
const PAGE_ITEM = '01a13807-2427-7723-91e3-cb0849c24259'

// [backend, 2026-10-14] one real response from their end-to-end test: one author with two
// tabs open, one on a section nested under About's hero, one on the header's layout section.
const STATUS = {
  published: false,
  last_pushed_at: '2026-10-14T01:29:14.553504Z',
  last_published_at: null,
  draft_dirty: true,
  editors: [
    {
      person: { uuid: '01a13807-218a-70e0-bad0-74ccb5a5c05d', handle: 'co-status-cf0d2488-1', brief: null },
      tabs: [
        {
          page: null,
          item: { uuid: LAYOUT_ITEM, section: 'layout_sections', changed_at: '2026-10-14T01:29:14.553504Z' }
        },
        {
          page: { uuid: PAGE_ITEM, route: '/about' },
          item: { uuid: SECTION_ITEM, section: 'page_sections', changed_at: '2026-10-14T01:29:14.548849Z' }
        }
      ]
    }
  ],
  last_published_url: null,
  last_published_foundation: null,
  last_published_extensions: [],
  last_published_runtime: null,
  last_published_runtime_floor: null,
  last_published_runtime_resolution: null,
  last_published_services: [],
  services: []
}
const THREE_MIN_LATER = Date.parse('2026-10-14T01:32:15Z')

/** A synced site whose author keeps About's hero as `1-hero.md`. */
function project() {
  const dir = join(tmp('uw-editors-'), 'site')
  const files = {
    'site.yml': "name: T\nfoundation: 'https://example.test/foundation/entry.js'\n",
    'package.json': JSON.stringify({ name: 't', dependencies: { uniweb: '*' } }),
    'pages/about/page.yml': 'title: About\n',
    'pages/about/1-hero.md': '# About\n',
    'layout/header.md': '# Header\n',
    'sync.json': JSON.stringify({
      version: 1,
      backends: {
        [ORIGIN]: {
          site: { uuid: SITE },
          items: {
            'pages/about/page.yml': PAGE_ITEM,
            'pages/about/hero.md': SECTION_ITEM,
            'layout/header.md': LAYOUT_ITEM
          }
        }
      }
    })
  }
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(join(dir, rel, '..'), { recursive: true })
    writeFileSync(join(dir, rel), body)
  }
  return dir
}

test('each tab is named by the file it is in this copy', () => {
  const dir = project()
  const [ed] = describeEditors(STATUS.editors, { fileOf: fileByItemUuid(dir, ORIGIN), now: THREE_MIN_LATER })
  assert.equal(ed.person, '@co-status-cf0d2488-1')
  assert.deepEqual(ed.tabs, [
    'layout/header.md · changed 3 min ago',
    'pages/about/1-hero.md (/about) · changed 3 min ago'
  ])
})

test('an item this copy has not synced is named by its kind and route', () => {
  const dir = project()
  const editors = [{
    person: { uuid: 'p', handle: 'ada', brief: { display_name: 'Ada Lovelace' } },
    tabs: [
      { page: { uuid: 'x', route: '/blog' }, item: { uuid: 'not-here', section: 'page_sections', changed_at: '2026-10-14T01:30:00Z' } },
      { page: null, item: { uuid: 'not-here-either', section: 'layout_sections', changed_at: null } },
      { page: { uuid: PAGE_ITEM, route: '/about' }, item: { uuid: PAGE_ITEM, section: 'pages', changed_at: '2026-10-12T01:00:00Z' } }
    ]
  }]
  const [ed] = describeEditors(editors, { fileOf: fileByItemUuid(dir, ORIGIN), now: THREE_MIN_LATER })
  assert.equal(ed.person, 'Ada Lovelace (@ada)')
  assert.deepEqual(ed.tabs, [
    'a section not in this copy (/blog) · changed 2 min ago',
    'a layout section not in this copy',
    'pages/about/page.yml (/about) · changed 2 days ago'
  ])
})

test('a tab with nothing open is left out; a person with only those has no tabs', () => {
  const [ed] = describeEditors([{ person: { uuid: 'u1', handle: null, brief: null }, tabs: [{ page: null, item: null }] }])
  assert.equal(ed.person, 'someone (u1)')
  assert.deepEqual(ed.tabs, [])
})

test('control: another backend\'s uuids name nothing in this copy', () => {
  const fileOf = fileByItemUuid(project(), 'http://elsewhere.test')
  assert.equal(fileOf(SECTION_ITEM), null)
})

// ─── the command ─────────────────────────────────────────────────────────────

const plain = (out) => out.replace(/\x1b\[[0-9;]*m/g, '')
const loggedIn = { version: 2, current: ORIGIN, sessions: { [ORIGIN]: { token: 't' } } }
const answering = (body) => async (url) =>
  url.includes(`/dev/site/status/${SITE}`)
    ? new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
    : undefined

async function statusRemote(body, args = []) {
  const { status } = await import('../src/commands/status.js')
  return runVerb(project(), status, ['--remote', '--personal', ...args], { session: loggedIn, respond: answering(body) })
}

test('⭐ status --remote lists who has the site open, and where', { timeout: 30_000 }, async () => {
  const run = await statusRemote(STATUS)
  const out = plain(run.output)
  assert.match(out, /Open in the app now:\n {4}@co-status-cf0d2488-1\n {6}layout\/header\.md · changed .+\n {6}pages\/about\/1-hero\.md \(\/about\) · changed /, run.output)
})

test('nobody in the app is said; a backend that does not say leaves it out', { timeout: 30_000 }, async () => {
  const none = await statusRemote({ ...STATUS, editors: [] })
  assert.match(plain(none.output), /Nobody has this site open in the app\./, none.output)

  const { editors, ...older } = STATUS
  const silent = await statusRemote(older)
  assert.match(plain(silent.output), /Synced draft has changes not yet live/, 'control: the status was read')
  assert.doesNotMatch(plain(silent.output), /in the app/)
})

test('--json carries the backend\'s `editors` as it came', { timeout: 30_000 }, async () => {
  const run = await statusRemote(STATUS, ['--json'])
  const doc = JSON.parse(run.output.trim().split('\n').pop())
  assert.deepEqual(doc.remote.site.editors, STATUS.editors)
})
