/**
 * `uniweb status` on a site that uses Promote: what only the person can do, what failed and why,
 * what goes out this week, and what each running campaign spent — `promote.*` checks, with the
 * person's steps in `next` marked to ask them first.
 *
 * The backend answers its routes as its contract says: `GET /dev/site/promotion/{site}` gives
 * `{ promotion: { uuid, items } }`, a `networks` item's `connection` read back as an entity
 * reference (`{ model, entity, brief }`); `GET …/campaigns/{c}/spend` gives `{ spend }`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmp, runVerb } from './helpers/run-verb.js'

const ORIGIN = 'http://backend.test'
const SITE = '01a13807-2400-7000-8000-000000000001'
const STATUS = {
  published: true,
  visitor_url: 'https://maple.test/',
  last_published_at: '2026-11-16T08:00:00Z',
  draft_dirty: false,
  last_published_services: [],
  services: []
}
const item = (uuid, section, data, parent) => ({ uuid, section, ...(parent ? { parent } : {}), data, updated_at: '2026-11-16T06:00:00Z' })
const soon = new Date(Date.now() + 2 * 86400000).toISOString()
const later = new Date(Date.now() + 30 * 86400000).toISOString()

const PROMOTION = {
  uuid: 'p0',
  items: [
    item('01a1-0000-0000-0000-00000000aa01', 'networks', { network: 'x', use: 'posts', connection: { model: 'm', entity: 'k1', brief: { name: 'Maple Bakery', state: 'needs_reconnect' } } }),
    item('01a1-0000-0000-0000-00000000aa02', 'networks', { network: 'facebook', use: 'ads', connection: { model: 'm', entity: 'k2', brief: { name: 'Maple Ads', state: 'connected' } } }),
    item('01a1-0000-0000-0000-00000000bb01', 'getting_found', { step: 'sitemap' }),
    item('01a1-0000-0000-0000-00000000bb02', 'getting_found/reading', { state: 'todo', found: 'no_robots' }, '01a1-0000-0000-0000-00000000bb01'),
    item('01a1-0000-0000-0000-00000000cc01', 'posts', { via: '01a1-0000-0000-0000-00000000aa01', send_at: soon }),
    item('01a1-0000-0000-0000-00000000cc02', 'posts/delivery', { status: 'scheduled' }, '01a1-0000-0000-0000-00000000cc01'),
    item('01a1-0000-0000-0000-00000000cc03', 'posts', { via: '01a1-0000-0000-0000-00000000aa01', send_at: later }),
    item('01a1-0000-0000-0000-00000000cc04', 'posts/delivery', { status: 'scheduled' }, '01a1-0000-0000-0000-00000000cc03'),
    item('01a1-0000-0000-0000-00000000cc05', 'posts', { via: '01a1-0000-0000-0000-00000000aa01' }),
    item('01a1-0000-0000-0000-00000000cc06', 'posts/delivery', { status: 'failed', reason: 'page_not_published' }, '01a1-0000-0000-0000-00000000cc05'),
    item('01a1-0000-0000-0000-00000000dd01', 'campaigns', { name: 'Holiday', via: ['01a1-0000-0000-0000-00000000aa02'] }),
    item('01a1-0000-0000-0000-00000000dd02', 'campaigns/delivery', { via: '01a1-0000-0000-0000-00000000aa02', external_id: 'X9', status: 'active', currency: 'CAD' }, '01a1-0000-0000-0000-00000000dd01'),
    item('01a1-0000-0000-0000-00000000dd03', 'campaigns', { name: 'Spring' }),
    item('01a1-0000-0000-0000-00000000dd04', 'campaigns/delivery', { via: '01a1-0000-0000-0000-00000000aa02', external_id: 'X8', status: 'paused', reason: 'promote_off' }, '01a1-0000-0000-0000-00000000dd03')
  ]
}
const SPEND = [
  { via: '01a1-0000-0000-0000-00000000aa02', day: '2026-11-15', amount: '8.00', currency: 'CAD', read_at: '2026-11-16T06:00:00Z' },
  { via: '01a1-0000-0000-0000-00000000aa02', day: '2026-11-16', amount: '3.25', currency: 'CAD', read_at: '2026-11-16T06:00:00Z' }
]

function project() {
  const dir = join(tmp('uw-status-promote-'), 'site')
  const files = {
    'site.yml': "name: Maple\nfoundation: 'https://example.test/foundation/entry.js'\n",
    'package.json': JSON.stringify({ name: 'maple', dependencies: { uniweb: '*' } }),
    'pages/home/page.yml': 'title: Home\n',
    'pages/home/1-hero.md': '# Home\n',
    'sync.json': JSON.stringify({ version: 1, backends: { [ORIGIN]: { site: { uuid: SITE }, items: {} } } })
  }
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(join(dir, rel, '..'), { recursive: true })
    writeFileSync(join(dir, rel), body)
  }
  return dir
}

const loggedIn = { version: 2, current: ORIGIN, sessions: { [ORIGIN]: { token: 't' } } }
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

async function statusWith({ promotion = PROMOTION, promotionStatus = 200 } = {}) {
  const { status } = await import('../src/commands/status.js')
  const respond = async (url) => {
    if (url.includes(`/dev/site/status/${SITE}`)) return json(STATUS)
    if (url.endsWith(`/dev/site/promotion/${SITE}`)) return json({ promotion }, promotionStatus)
    if (url.includes(`/dev/site/promotion/${SITE}/campaigns/01a1-0000-0000-0000-00000000dd01/spend`)) return json({ spend: SPEND })
    return undefined
  }
  const run = await runVerb(project(), status, ['--personal', '--json'], { session: loggedIn, respond })
  const doc = JSON.parse(run.output.trim().split('\n').pop())
  return { run, doc, check: (id) => doc.checks.find((c) => c.id === id) }
}

test('⭐ status says what Promote needs of the person, and asks them first', { timeout: 30_000 }, async () => {
  const { doc, check } = await statusWith()
  const accounts = check('promote.accounts')
  assert.equal(accounts.state, 'attention')
  assert.match(accounts.lines[0], /x “Maple Bakery”: needs reconnecting/)
  const asks = doc.next.filter((s) => s.ask)
  assert.ok(asks.some((s) => /x account “Maple Bakery” needs reconnecting: its person does it, in the app/.test(s.why)), JSON.stringify(doc.next))
  assert.ok(asks.some((s) => /ads were paused because it has no Promote/.test(s.why)), 'Promote turned on is the person\'s')
})

test('status names a post that failed and why, and the posts going out this week', { timeout: 30_000 }, async () => {
  const { check } = await statusWith()
  const posts = check('promote.posts')
  assert.equal(posts.state, 'attention')
  assert.match(posts.summary, /1 failed · 2 scheduled/)
  assert.ok(posts.lines.some((l) => /failed on x: the page it links to is not published in its language yet/.test(l)), posts.lines.join('\n'))
  assert.equal(posts.detail.scheduled.length, 1, 'only the one going out this week')
  assert.equal(check('promote.found').state, 'attention')
  assert.match(check('promote.found').summary, /sitemap to do/)
})

test('status gives each running campaign\'s spend by day, a day not reported left unknown', { timeout: 30_000 }, async () => {
  const { check } = await statusWith()
  const campaigns = check('promote.campaigns')
  assert.match(campaigns.summary, /1 running, 1 not/)
  assert.ok(campaigns.lines.some((l) => l === '“Holiday” running — 8.00 CAD on 2026-11-15, 3.25 CAD on 2026-11-16 so far'), campaigns.lines.join('\n'))
  assert.ok(campaigns.lines.some((l) => /paused because the site has no Promote/.test(l)))
})

test('a site that never used Promote, or a backend without it, adds nothing; a failed read is unknown', { timeout: 30_000 }, async () => {
  const none = await statusWith({ promotion: null })
  assert.equal(none.doc.checks.filter((c) => c.id.startsWith('promote.')).length, 0)
  const without = await statusWith({ promotionStatus: 404 })
  assert.equal(without.doc.checks.filter((c) => c.id.startsWith('promote.')).length, 0)
  const failed = await statusWith({ promotionStatus: 500 })
  assert.equal(failed.check('promote.site')?.state, 'unknown')
})

test('status counts a post in the network\'s review, and says why one was refused', { timeout: 30_000 }, async () => {
  const promotion = {
    uuid: 'p0',
    items: [
      item('01a1-0000-0000-0000-00000000aa01', 'networks', { network: 'x', use: 'posts', connection: { model: 'm', entity: 'k1', brief: { name: 'Maple Bakery', state: 'connected' } } }),
      item('01a1-0000-0000-0000-00000000ee01', 'posts', { via: '01a1-0000-0000-0000-00000000aa01' }),
      item('01a1-0000-0000-0000-00000000ee02', 'posts/delivery', { status: 'review' }, '01a1-0000-0000-0000-00000000ee01'),
      item('01a1-0000-0000-0000-00000000ee03', 'posts', { via: '01a1-0000-0000-0000-00000000aa01' }),
      item('01a1-0000-0000-0000-00000000ee04', 'posts/delivery', { status: 'refused', reason: 'network_refused', detail: 'against its rules' }, '01a1-0000-0000-0000-00000000ee03')
    ]
  }
  const { check } = await statusWith({ promotion })
  const posts = check('promote.posts')
  assert.equal(posts.state, 'attention')
  assert.equal(posts.summary, 'Posts: 1 refused · 1 review.')
  assert.ok(posts.lines.some((l) => /refused on x: the network refused it — against its rules/.test(l)), posts.lines.join('\n'))
})
