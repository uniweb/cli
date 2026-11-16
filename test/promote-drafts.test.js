/**
 * `uniweb promote post | campaign | show | delete | send | unschedule | start | resume | pause` —
 * drafts written from files, and going out, as a second client of the site's Promote.
 *
 * The backend's half is its own; the fake below answers as its contract says the routes answer:
 * an items write is one transaction, refused whole `409` on a stale `if_unmodified_since`; a write
 * to a scheduled post's fields or parts makes it a draft again; `publish`, `schedule` and
 * `unschedule` answer `{ delivery }`; `start`, `pause` and `resume` answer `{ deliveries }`, one per
 * ad account; the site's document comes from `GET /dev/site/content/pull/{site}` as a `.uwx`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createZip } from '@uniweb/build/uwx'
import { runVerb, tmp } from './helpers/run-verb.js'
import {
  checkDraft,
  fileWithIdentity,
  indexPromotion,
  parseDraft,
  planCampaign,
  planPost,
  resolvePage,
  shortIds,
  sitePages,
  unitVersion,
  versionOf,
  viaResolver
} from '../src/backend/promote-drafts.js'

const ORIGIN = 'http://backend.test'
const ENV = { UNIWEB_SERVER: ORIGIN, UNIWEB_TOKEN: 'TKN' }
const SITE = '01a169f2-1e71-7bd3-942e-47d5675f2bd2'
const PROMO = `/dev/site/promotion/${SITE}`
const PAGE_HOME = '01a16a00-0000-7000-8000-00000000a001'
const PAGE_HOLIDAY = '01a16a00-0000-7000-8000-00000000a002'
const CONN_X = '01a16a00-0000-7000-8000-0000000c0001'
const CONN_META = '01a16a00-0000-7000-8000-0000000c0002'

/** The site's document as the backend holds it: a homepage and /holiday, in English and French. */
const SITE_DOC = {
  settings: { default_language: 'en', languages: ['en', 'fr'] },
  pages: [
    { $uuid: PAGE_HOME, slug: { en: 'home' }, is_index: true, stable_id: 'home' },
    { $uuid: PAGE_HOLIDAY, slug: { en: 'holiday' }, stable_id: '3f58142d' },
    { $uuid: '01a16a00-0000-7000-8000-00000000a003', slug: { en: 'blog' }, $children: [
      { $uuid: '01a16a00-0000-7000-8000-00000000a004', slug: { en: 'slug' }, is_dynamic: true, param_name: 'slug' }
    ] }
  ]
}
const uwx = (doc) => createZip([{ name: 'manifest.json', data: Buffer.from('{}') }, { name: 'site.json', data: Buffer.from(JSON.stringify(doc)) }])

const CONNECTIONS = [
  { uuid: CONN_X, owner: 'a1', card: { network: 'x', name: 'Maple Bakery', handle: '@maple', state: 'connected' } },
  { uuid: CONN_META, owner: 'a1', card: { network: 'facebook', name: 'Maple Ads', state: 'connected' } }
]

/**
 * A backend that keeps the site's Promote as the contract says: every write a transaction, each
 * item's `updated_at` moving when it is written, backend's own children written by its doors.
 */
function statefulBackend({ items = [], connections = CONNECTIONS, doc = SITE_DOC, now = () => Date.now() } = {}) {
  let clock = 0
  const store = items.map((i) => ({ ...i }))
  const stamp = () => `2026-11-16T08:${String(Math.floor(clock / 60)).padStart(2, '0')}:${String(clock++ % 60).padStart(2, '0')}.000Z`
  const seen = []
  const remove = (uuid) => {
    for (const child of store.filter((i) => i.parent === uuid)) remove(child.uuid)
    const at = store.findIndex((i) => i.uuid === uuid)
    if (at !== -1) store.splice(at, 1)
  }
  const child = (section, parent) => store.find((i) => i.section === section && i.parent === parent)
  const setChild = (section, parent, data) => {
    const was = child(section, parent)
    if (was) Object.assign(was, { data, updated_at: stamp() })
    else store.push({ uuid: `bk-${clock}`, section, parent, data, updated_at: stamp() })
  }
  const postOf = (item) => (item?.section === 'posts' ? item : item?.section === 'posts/parts' ? store.find((p) => p.uuid === item.parent) : null)
  let n = 0
  const respond = async (url, init = {}) => {
    const u = new URL(url)
    const method = init.method || 'GET'
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : null
    seen.push({ method, path: u.pathname, body })
    if (u.pathname === '/dev/orgs') return Response.json({ account_handle: 'ana', orgs: [], workspaces: [] })
    if (u.pathname === '/dev/config') return Response.json({ promote: { networks: ['x', 'facebook'] } })
    if (u.pathname === '/dev/connections') return Response.json({ connections })
    if (u.pathname === `/dev/site/content/pull/${SITE}`) return new Response(uwx(doc), { status: 200 })
    if (u.pathname === PROMO && method === 'GET') {
      return Response.json({ promotion: store.length ? { uuid: 'p0', items: store.map((i) => structuredClone(i)) } : null })
    }
    if (u.pathname === `${PROMO}/items` && method === 'POST') {
      // One transaction: every stale op refuses all of it.
      for (const op of body.batch) {
        if (op.kind === 'create') continue
        const item = store.find((i) => i.uuid === op.uuid)
        if (!item) return Response.json({ reason: 'not_found' }, { status: 404 })
        if (op.if_unmodified_since && op.if_unmodified_since !== item.updated_at) return Response.json({ reason: 'stale', item: op.uuid }, { status: 409 })
        const campaign = item.section?.startsWith('campaigns') ? store.find((i) => i.uuid === (item.section === 'campaigns' ? item.uuid : null)) : null
        if (campaign && store.some((d) => d.section === 'campaigns/delivery' && d.parent === campaign.uuid && d.data?.external_id)) {
          return Response.json({ reason: 'campaign_started', campaign: campaign.uuid }, { status: 409 })
        }
      }
      const results = []
      // A connection is written as its uuid and read as an entity reference, as the backend reads one back.
      const asStored = (section, data) => {
        if (section !== 'networks' || typeof data?.connection !== 'string') return data
        const card = connections.find((k) => k.uuid === data.connection)?.card ?? {}
        return { ...data, connection: { model: 'connection-model', entity: data.connection, brief: { name: card.name, handle: card.handle, state: card.state, network: card.network } } }
      }
      for (const op of body.batch) {
        if (op.kind === 'create') {
          const item = { uuid: op.uuid ?? `new-${n++}`, section: op.section, ...(op.parent ? { parent: op.parent } : {}), data: asStored(op.section, op.data), updated_at: stamp() }
          store.push(item)
          results.push({ uuid: item.uuid, updated_at: item.updated_at })
        } else if (op.kind === 'update') {
          const item = store.find((i) => i.uuid === op.uuid)
          Object.assign(item, { data: op.data, updated_at: stamp() })
          results.push({ uuid: item.uuid, updated_at: item.updated_at })
        } else {
          remove(op.uuid)
          results.push({ uuid: op.uuid, updated_at: null })
        }
        // A write to a scheduled post's fields or its parts makes it a draft again.
        const post = postOf(store.find((i) => i.uuid === (op.parent ?? op.uuid)) ?? (op.parent ? store.find((i) => i.uuid === op.parent) : null))
        const delivery = post && child('posts/delivery', post.uuid)
        if (delivery?.data?.status === 'scheduled') remove(delivery.uuid)
      }
      return Response.json({ uuid: 'p0', results })
    }
    const postAct = u.pathname.match(new RegExp(`^${PROMO}/posts/([^/]+)/(publish|schedule|unschedule)$`))
    if (postAct && method === 'POST') {
      const [, uuid, act] = postAct
      const post = store.find((i) => i.uuid === uuid && i.section === 'posts')
      if (!post) return Response.json({ reason: 'not_found' }, { status: 404 })
      if (act === 'publish') {
        const refused = store.some((p) => p.section === 'posts/parts' && p.parent === uuid && /#refuse/.test(p.data?.text ?? ''))
        setChild('posts/delivery', uuid, refused
          ? { status: 'failed', reason: 'network_refused', detail: 'the fake refused it' }
          : { status: 'published', network_url: `https://x.test/p/${uuid}`, link: 'https://maple.test/holiday?utm_source=x', tag: 't1' })
      } else if (act === 'schedule') {
        if (!post.data?.send_at || Date.parse(post.data.send_at) <= now()) return Response.json({ reason: 'no_send_at' }, { status: 400 })
        setChild('posts/delivery', uuid, { status: 'scheduled', tag: 't1', scheduled_by: 'a1' })
      } else {
        const d = child('posts/delivery', uuid)
        if (d?.data?.status === 'scheduled') remove(d.uuid)
      }
      return Response.json({ delivery: child('posts/delivery', uuid)?.data ?? null })
    }
    const campaignAct = u.pathname.match(new RegExp(`^${PROMO}/campaigns/([^/]+)/(start|pause|resume)$`))
    if (campaignAct && method === 'POST') {
      const [, uuid, act] = campaignAct
      const campaign = store.find((i) => i.uuid === uuid && i.section === 'campaigns')
      for (const via of campaign.data?.via ?? []) {
        const d = store.find((i) => i.section === 'campaigns/delivery' && i.parent === uuid && i.data?.via === via)
        if (act === 'start' && !d) store.push({ uuid: `cd-${via}`, section: 'campaigns/delivery', parent: uuid, data: { via, external_id: `ext-${via}`, status: 'active', review: 'pending', currency: 'CAD' }, updated_at: stamp() })
        if (act === 'pause' && d) d.data = { ...d.data, status: 'paused' }
        if (act === 'resume' && d) d.data = { ...d.data, status: 'active' }
      }
      return Response.json({ deliveries: store.filter((i) => i.section === 'campaigns/delivery' && i.parent === uuid).map((d) => d.data) })
    }
    return undefined
  }
  return {
    respond,
    store,
    seen,
    at: (method, path) => seen.filter((r) => r.method === method && r.path === path),
    writes: () => seen.filter((r) => r.method === 'POST' && r.path === `${PROMO}/items`)
  }
}

async function verb() {
  return (await import('../src/commands/promote.js')).promote
}
const lastJson = (run) => JSON.parse(run.output.trim().split('\n').pop())

let seq = 0
const mint = () => `01a16b00-0000-7000-8000-${String(++seq).padStart(12, '0')}`

// ── the draft as written ───────────────────────────────────────────────────────────

test('a Markdown post: frontmatter its fields, its body its parts, a picture alone on its line', () => {
  const { draft, error } = parseDraft(
    ['---', 'via: x', 'page: /holiday', 'send_at: 2026-11-24T09:00-05:00', '---', 'Our holiday trays are here.', '', '![a tray](./tray.jpg)', '', '---', '', 'Order by Dec 20.', ''].join('\n'),
    { format: 'markdown', kind: 'post' }
  )
  assert.equal(error, undefined)
  assert.deepEqual(draft.fields, { via: 'x', page: '/holiday', send_at: '2026-11-24T09:00-05:00' }, 'a time stays the text written')
  assert.deepEqual(draft.parts, [
    { text: 'Our holiday trays are here.', pictures: ['./tray.jpg'] },
    { text: 'Order by Dec 20.', pictures: [] }
  ])
})

test('a draft that names its id without the version it was read at is refused, saying where to start', () => {
  const { error } = parseDraft('---\nid: 01a1\nvia: x\n---\nHi', { format: 'markdown', kind: 'post' })
  assert.match(error, /without the `version`.*uniweb promote show 01a1/)
  const both = parseDraft('---\nvia: x\ntext: Hi\n---\nHello', { format: 'markdown', kind: 'post' })
  assert.match(both.error, /Its words are its body/)
})

test('a YAML campaign: its ad groups and ads nested, a date the text written, backend\'s fields left out', () => {
  const { draft } = parseDraft(
    'name: Holiday\nstarts: 2026-12-01\nends: 2026-12-14\nvia: facebook\ntag: holiday-2026\nad_groups:\n  - name: Trays\n    daily_budget: 10.00\n    ads:\n      - page: /holiday\n        headlines: [Holiday trays]\n        text: Fresh from our ovens\n',
    { format: 'yaml', kind: 'campaign' }
  )
  assert.equal(draft.fields.starts, '2026-12-01')
  assert.equal(draft.fields.tag, undefined, 'a campaign\'s tag is backend\'s')
  assert.equal(draft.adGroups[0].fields.name, 'Trays')
  assert.deepEqual(draft.adGroups[0].ads[0].parts, [{ text: 'Fresh from our ovens', pictures: [] }])
  assert.deepEqual(draft.adGroups[0].ads[0].fields.headlines, ['Holiday trays'])
})

// ── versions and ids ───────────────────────────────────────────────────────────────

test('a unit\'s version moves when any of its items is made, changed or removed — and not for backend\'s delivery', () => {
  const post = { uuid: 'p1', section: 'posts', data: {}, updated_at: 't1' }
  const part = { uuid: 'q1', section: 'posts/parts', parent: 'p1', data: { text: 'a' }, updated_at: 't1' }
  const base = indexPromotion({ items: [post, part] })
  const v = versionOf(base, post)
  assert.equal(v, versionOf(indexPromotion({ items: [post, part, { uuid: 'd1', section: 'posts/delivery', parent: 'p1', data: { status: 'scheduled' }, updated_at: 't9' }] }), post))
  assert.notEqual(v, versionOf(indexPromotion({ items: [post, { ...part, updated_at: 't2' }] }), post), 'a part changed')
  assert.notEqual(v, versionOf(indexPromotion({ items: [post] }), post), 'a part removed')
  assert.notEqual(v, versionOf(indexPromotion({ items: [post, part, { ...part, uuid: 'q2' }] }), post), 'a part added')
  assert.match(unitVersion([post]), /^v[0-9a-f]{12}$/, 'it leads with a letter, so YAML reads it back as text')
})

test('a short id is the end of a uuid, since two made the same minute share their start', () => {
  const ids = shortIds(['01a1e083-7b18-7557-8dd1-a7e840960811', '01a1e083-7b18-7557-8dd1-a7e840961234', '01a1e083-7b19-7000-8000-000000000811'])
  assert.equal(ids.get('01a1e083-7b18-7557-8dd1-a7e840961234'), '1234')
  assert.equal(ids.get('01a1e083-7b18-7557-8dd1-a7e840960811'), '60811', 'longer where another ends the same')
})

// ── the write ──────────────────────────────────────────────────────────────────────

test('an update carries back what it does not edit, and writes only what changed, by position', () => {
  const index = indexPromotion({ items: [
    { uuid: 'p1', section: 'posts', data: { via: 'n1', language: 'en', page: PAGE_HOLIDAY, future_field: 7 }, updated_at: 't1' },
    { uuid: 'q1', section: 'posts/parts', parent: 'p1', data: { text: 'same' }, updated_at: 't1' },
    { uuid: 'q2', section: 'posts/parts', parent: 'p1', data: { text: 'old' }, updated_at: 't2' },
    { uuid: 'q3', section: 'posts/parts', parent: 'p1', data: { text: 'gone' }, updated_at: 't3' }
  ] })
  const draft = { kind: 'post', id: 'p1', version: 'x', fields: { send_at: '2026-11-24T14:00:00Z' }, parts: [{ text: 'same', pictures: [] }, { text: 'new', pictures: [] }] }
  const { ops } = planPost(index, draft, { mint })
  assert.deepEqual(ops, [
    { kind: 'update', uuid: 'p1', data: { via: 'n1', language: 'en', page: PAGE_HOLIDAY, future_field: 7, send_at: '2026-11-24T14:00:00Z' }, if_unmodified_since: 't1' },
    { kind: 'update', uuid: 'q2', data: { text: 'new' }, if_unmodified_since: 't2' },
    { kind: 'delete', uuid: 'q3', if_unmodified_since: 't3' }
  ])
  assert.deepEqual(planPost(index, { ...draft, fields: {}, parts: null }, { mint }).ops, [], 'nothing changed, nothing written')
})

test('a campaign\'s ad group the file leaves out is kept, never deleted by omission', () => {
  const index = indexPromotion({ items: [
    { uuid: 'c1', section: 'campaigns', data: { name: 'Holiday', tag: 'holiday' }, updated_at: 't1' },
    { uuid: 'g1', section: 'campaigns/ad_groups', parent: 'c1', data: { name: 'Trays', daily_budget: '10.00' }, updated_at: 't1' },
    { uuid: 'g2', section: 'campaigns/ad_groups', parent: 'c1', data: { name: 'Added in the app' }, updated_at: 't1' }
  ] })
  const draft = { kind: 'campaign', id: 'c1', version: 'x', fields: { name: 'Holiday' }, adGroups: [
    { id: 'g1', version: 'x', fields: { daily_budget: '12.00' }, ads: [{ id: null, version: null, fields: { via: 'n2' }, parts: null }] }
  ] }
  const plan = planCampaign(index, draft, { mint, language: 'en' })
  assert.deepEqual(plan.ops.map((o) => [o.kind, o.uuid === 'g1' ? 'g1' : o.section]), [['update', 'g1'], ['create', 'campaigns/ad_groups/ads']])
  assert.equal(plan.ops[0].data.name, 'Trays', 'its name carried back')
  assert.equal(plan.ops[1].parent, 'g1')
  assert.equal(plan.ops[1].data.language, 'en', 'a new ad is in the site\'s language')
  assert.deepEqual(plan.kept, [{ kind: 'ad group', uuid: 'g2', name: 'Added in the app' }])
  assert.ok(!plan.ops.some((o) => o.uuid === 'c1'), 'the campaign\'s own data did not change, its tag included')
})

test('a stale copy, a post gone out and an ad group under the wrong campaign are refused before any write', () => {
  const items = [
    { uuid: 'p1', section: 'posts', data: {}, updated_at: 't1' },
    { uuid: 'p1d', section: 'posts/delivery', parent: 'p1', data: { status: 'published' }, updated_at: 't1' },
    { uuid: 'p2', section: 'posts', data: {}, updated_at: 't1' },
    { uuid: 'c1', section: 'campaigns', data: { name: 'A' }, updated_at: 't1' },
    { uuid: 'c2', section: 'campaigns', data: { name: 'B' }, updated_at: 't1' },
    { uuid: 'g9', section: 'campaigns/ad_groups', parent: 'c2', data: { name: 'B1' }, updated_at: 't1' }
  ]
  const index = indexPromotion({ items })
  assert.match(checkDraft(index, { kind: 'post', id: 'p2', version: 'vstale', fields: {}, parts: null })[0], /changed since your copy/)
  assert.match(checkDraft(index, { kind: 'post', id: 'p1', version: versionOf(index, items[0]), fields: {}, parts: null })[0], /went out/)
  const wrong = checkDraft(index, { kind: 'campaign', id: 'c1', version: versionOf(index, items[3]), fields: {}, adGroups: [{ id: 'g9', version: versionOf(index, items[5]), fields: {}, ads: null }] })
  assert.match(wrong[0], /not in the campaign it is under/)
  assert.deepEqual(checkDraft(index, { kind: 'post', id: 'p2', version: versionOf(index, items[2]), fields: {}, parts: null }), [])
})

// ── what the files name differently ────────────────────────────────────────────────

test('a page is named by its route or its id, on the site as pushed', () => {
  const pages = sitePages(SITE_DOC)
  assert.equal(pages.language, 'en')
  assert.equal(resolvePage('/holiday', pages).uuid, PAGE_HOLIDAY)
  assert.equal(resolvePage('page:3f58142d', pages).uuid, PAGE_HOLIDAY)
  assert.equal(resolvePage('/', pages).uuid, PAGE_HOME)
  assert.match(resolvePage('/winter', pages).error, /no page \/winter.*uniweb push/)
  assert.match(resolvePage('/blog/:slug', pages).error, /template for many pages/)
  assert.match(resolvePage('/holiday#trays', pages).error, /not to a place on it/)
})

test('an account is the site\'s for that network — made, through the one connection there, when it has none', () => {
  const via = viaResolver({ networks: [], connections: CONNECTIONS, mint })
  const r = via.resolve('x', 'posts', 'The post')
  assert.deepEqual(via.creates(), [{ kind: 'create', section: 'networks', uuid: r.uuid, data: { network: 'x', use: 'posts', connection: CONN_X } }])
  assert.equal(via.resolve('x', 'posts', 'Another post').uuid, r.uuid, 'made once for the batch')
  const none = viaResolver({ networks: [], connections: [], mint }).resolve('linkedin', 'posts', 'The post')
  assert.match(none.error, /uniweb promote connect linkedin/)
  const two = viaResolver({ networks: [], connections: [CONNECTIONS[0], { ...CONNECTIONS[0], uuid: '01a16a00-0000-7000-8000-0000000c0009' }], mint }).resolve('x', 'posts', 'The post')
  assert.match(two.error, /choose one: `via: \{ network: x, connection: <id> \}`/)
  const stored = { uuid: 'n1', data: { network: 'x', use: 'posts', connection: { model: 'm', entity: CONN_X, brief: { name: 'Maple Bakery' } } } }
  const kept = viaResolver({ networks: [stored], connections: CONNECTIONS, mint })
  assert.equal(kept.resolve('x', 'posts', 'The post').uuid, 'n1')
  assert.equal(kept.resolve({ network: 'x', connection: CONN_X.slice(-4) }, 'posts', 'The post').uuid, 'n1', 'named by its connection, read as an entity reference')
  assert.deepEqual(kept.creates(), [])
})

test('the file gets its ids back: first in the frontmatter, the body as written', () => {
  const md = '---\nvia: x  # the bakery\'s\npage: /holiday\n---\nOur trays.\n'
  const out = fileWithIdentity(md, { format: 'markdown', kind: 'post' }, { uuid: 'U1' }, () => 'vabc')
  assert.equal(out.text, '---\nid: U1\nversion: vabc\nvia: x  # the bakery\'s\npage: /holiday\n---\nOur trays.\n')
  const again = fileWithIdentity(out.text, { format: 'markdown', kind: 'post' }, { uuid: 'U1' }, () => 'vdef')
  assert.equal(again.text, out.text.replace('vabc', 'vdef'), 'a later write moves only the version')
  const yml = '# Holiday\nname: Holiday\nad_groups:\n  - name: Trays\n    ads:\n      - headlines: [A]\n'
  const camp = fileWithIdentity(yml, { format: 'yaml', kind: 'campaign' }, { uuid: 'C1', groups: [{ uuid: 'G1', ads: ['A1'] }] }, (u) => `v-${u}`)
  assert.match(camp.text, /^# Holiday\nid: C1\nversion: v-C1\nname: Holiday\n/)
  assert.match(camp.text, /- id: G1\n {4}version: v-G1\n {4}name: Trays/)
  assert.match(camp.text, /- id: A1\n {8}version: v-A1/)
})

// ── the commands, against the backend ──────────────────────────────────────────────

test('post makes a draft from a Markdown file — the account, the page, the language — and writes its id back', async () => {
  const backend = statefulBackend()
  const dir = tmp('uw-promote-')
  writeFileSync(join(dir, 'holiday.md'), '---\nvia: x\npage: /holiday\n---\nOur holiday trays are here.\n\n---\n\nOrder by Dec 20.\n')
  const run = await runVerb(dir, await verb(), ['post', 'holiday.md', '--site', SITE], { env: ENV, respond: backend.respond })
  assert.equal(run.exitCode, 0, run.output)
  const [write] = backend.writes()
  assert.deepEqual(write.body.batch.map((op) => [op.kind, op.section]), [['create', 'networks'], ['create', 'posts'], ['create', 'posts/parts'], ['create', 'posts/parts']])
  const [network, post, part1] = write.body.batch
  assert.deepEqual(network.data, { network: 'x', use: 'posts', connection: CONN_X }, 'the site\'s first use of x, through the one x account')
  assert.deepEqual(post.data, { via: network.uuid, page: PAGE_HOLIDAY, language: 'en' })
  assert.equal(part1.parent, post.uuid)
  assert.match(run.output, /Drafted post \w+ on x, linking to \/holiday \(en\)/)
  const file = readFileSync(join(dir, 'holiday.md'), 'utf8')
  assert.match(file, new RegExp(`^---\\nid: ${post.uuid}\\nversion: v[0-9a-f]{12}\\nvia: x\\n`))

  // The second run updates the same draft: only the part that changed.
  writeFileSync(join(dir, 'holiday.md'), file.replace('Order by Dec 20.', 'Order by Dec 21.'))
  const second = await runVerb(dir, await verb(), ['post', 'holiday.md', '--site', SITE], { env: ENV, respond: backend.respond })
  assert.equal(second.exitCode, 0, second.output)
  const update = backend.writes()[1].body.batch
  assert.deepEqual(update.map((op) => op.kind), ['update'])
  assert.deepEqual(update[0].data, { text: 'Order by Dec 21.' })
  assert.ok(update[0].if_unmodified_since, 'named at the version it was read at')
  assert.match(second.output, /Updated post/)
  assert.equal(backend.store.filter((i) => i.section === 'posts').length, 1, 'no second draft')
})

test('a change in the app since the file was written refuses the write whole, and says how to start again', async () => {
  const backend = statefulBackend()
  const dir = tmp('uw-promote-')
  writeFileSync(join(dir, 'p.md'), '---\nvia: x\n---\nFirst words.\n')
  await runVerb(dir, await verb(), ['post', 'p.md', '--site', SITE], { env: ENV, respond: backend.respond })
  // The person edits the post's words in the app.
  const part = backend.store.find((i) => i.section === 'posts/parts')
  Object.assign(part, { data: { text: 'The person\'s words.' }, updated_at: '2026-11-16T09:00:00.000Z' })
  writeFileSync(join(dir, 'p.md'), readFileSync(join(dir, 'p.md'), 'utf8').replace('First words.', 'The agent\'s words.'))
  const run = await runVerb(dir, await verb(), ['post', 'p.md', '--site', SITE], { env: ENV, respond: backend.respond })
  assert.equal(run.exitCode, 1, run.output)
  assert.match(run.output, /changed since your copy.*uniweb promote show/)
  assert.equal(backend.writes().length, 1, 'nothing written over the person\'s words')
  assert.equal(part.data.text, 'The person\'s words.')
})

test('a post with no account for its network says the person connects one, and writes nothing', async () => {
  const backend = statefulBackend({ connections: [] })
  const dir = tmp('uw-promote-')
  writeFileSync(join(dir, 'p.md'), '---\nvia: linkedin\n---\nHello.\n')
  const run = await runVerb(dir, await verb(), ['post', 'p.md', '--site', SITE], { env: ENV, respond: backend.respond })
  assert.equal(run.exitCode, 2, run.output)
  assert.match(run.output, /uniweb promote connect linkedin/)
  assert.equal(backend.writes().length, 0)
})

test('send posts a draft with no time now, schedules one with a time, and --at sets the time first', async () => {
  const backend = statefulBackend()
  const dir = tmp('uw-promote-')
  writeFileSync(join(dir, 'now.md'), '---\nvia: x\n---\nNow.\n')
  writeFileSync(join(dir, 'later.md'), '---\nvia: x\nsend_at: 2099-11-24T09:00:00-05:00\n---\nLater.\n')
  for (const f of ['now.md', 'later.md']) await runVerb(dir, await verb(), ['post', f, '--site', SITE], { env: ENV, respond: backend.respond })
  const [nowPost, laterPost] = backend.store.filter((i) => i.section === 'posts')

  const sent = await runVerb(dir, await verb(), ['send', 'now.md', '--site', SITE], { env: ENV, respond: backend.respond })
  assert.equal(sent.exitCode, 0, sent.output)
  assert.equal(backend.at('POST', `${PROMO}/posts/${nowPost.uuid}/publish`).length, 1)
  assert.match(sent.output, /Posted \w+ on x: https:\/\/x\.test\/p\//)

  const scheduled = await runVerb(dir, await verb(), ['send', 'later.md', '--site', SITE], { env: ENV, respond: backend.respond })
  assert.equal(scheduled.exitCode, 0, scheduled.output)
  assert.equal(backend.at('POST', `${PROMO}/posts/${laterPost.uuid}/schedule`).length, 1)
  assert.match(scheduled.output, /Scheduled \w+ on x for 2099-11-24T09:00:00-05:00/)

  // A new time: the post's own field written (a draft again), then scheduled at it.
  const moved = await runVerb(dir, await verb(), ['send', laterPost.uuid, '--at', '2099-12-01T10:00:00Z', '--site', SITE, '--json'], { env: ENV, respond: backend.respond })
  assert.equal(moved.exitCode, 0, moved.output)
  const last = backend.writes().pop().body.batch[0]
  assert.equal(last.data.send_at, '2099-12-01T10:00:00Z')
  assert.equal(lastJson(moved).delivery.status, 'scheduled')

  // Gone out: nothing is sent again.
  const again = await runVerb(dir, await verb(), ['send', 'now.md', '--site', SITE], { env: ENV, respond: backend.respond })
  assert.equal(again.exitCode, 0, again.output)
  assert.match(again.output, /went out already/)
  assert.equal(backend.at('POST', `${PROMO}/posts/${nowPost.uuid}/publish`).length, 1)
})

test('send says why a post failed, in words, with the network\'s own beside them', async () => {
  const backend = statefulBackend()
  const dir = tmp('uw-promote-')
  writeFileSync(join(dir, 'p.md'), '---\nvia: x\n---\nThis one #refuse\n')
  await runVerb(dir, await verb(), ['post', 'p.md', '--site', SITE], { env: ENV, respond: backend.respond })
  const run = await runVerb(dir, await verb(), ['send', 'p.md', '--site', SITE], { env: ENV, respond: backend.respond })
  assert.equal(run.exitCode, 1, run.output)
  assert.match(run.output, /Not posted: the network refused it — the fake refused it/)
})

test('send refuses a time that has passed, and a bad --at, before anything is sent', async () => {
  const backend = statefulBackend()
  const dir = tmp('uw-promote-')
  writeFileSync(join(dir, 'p.md'), '---\nvia: x\nsend_at: 2020-01-01T00:00:00Z\n---\nOld.\n')
  await runVerb(dir, await verb(), ['post', 'p.md', '--site', SITE], { env: ENV, respond: backend.respond })
  const passed = await runVerb(dir, await verb(), ['send', 'p.md', '--site', SITE], { env: ENV, respond: backend.respond })
  assert.equal(passed.exitCode, 2, passed.output)
  assert.match(passed.output, /has passed: send it now with --now/)
  const bad = await runVerb(dir, await verb(), ['send', 'p.md', '--at', 'tomorrow', '--site', SITE], { env: ENV, respond: backend.respond })
  assert.equal(bad.exitCode, 2, bad.output)
  const past = await runVerb(dir, await verb(), ['send', 'p.md', '--at', '2021-06-01T09:00:00Z', '--site', SITE], { env: ENV, respond: backend.respond })
  assert.equal(past.exitCode, 2, past.output)
  assert.match(past.output, /`--at 2021-06-01T09:00:00Z` has passed/)
  assert.equal(backend.writes().length, 1, 'its time is not written either')
  assert.equal(backend.seen.filter((r) => /\/(publish|schedule)$/.test(r.path)).length, 0)
})

test('a write to a scheduled post makes it a draft again, and post says so', async () => {
  const backend = statefulBackend()
  const dir = tmp('uw-promote-')
  writeFileSync(join(dir, 'p.md'), '---\nvia: x\nsend_at: 2099-11-24T09:00:00Z\n---\nSoon.\n')
  await runVerb(dir, await verb(), ['post', 'p.md', '--site', SITE], { env: ENV, respond: backend.respond })
  await runVerb(dir, await verb(), ['send', 'p.md', '--site', SITE], { env: ENV, respond: backend.respond })
  writeFileSync(join(dir, 'p.md'), readFileSync(join(dir, 'p.md'), 'utf8').replace('Soon.', 'Very soon.'))
  const run = await runVerb(dir, await verb(), ['post', 'p.md', '--site', SITE], { env: ENV, respond: backend.respond })
  assert.equal(run.exitCode, 0, run.output)
  assert.match(run.output, /a change makes it a draft again, its time kept/)
})

test('unschedule makes a scheduled post a draft again; on a draft it does nothing', async () => {
  const backend = statefulBackend()
  const dir = tmp('uw-promote-')
  writeFileSync(join(dir, 'p.md'), '---\nvia: x\nsend_at: 2099-11-24T09:00:00Z\n---\nSoon.\n')
  await runVerb(dir, await verb(), ['post', 'p.md', '--site', SITE], { env: ENV, respond: backend.respond })
  const idle = await runVerb(dir, await verb(), ['unschedule', 'p.md', '--site', SITE], { env: ENV, respond: backend.respond })
  assert.match(idle.output, /not scheduled/)
  await runVerb(dir, await verb(), ['send', 'p.md', '--site', SITE], { env: ENV, respond: backend.respond })
  const run = await runVerb(dir, await verb(), ['unschedule', 'p.md', '--site', SITE], { env: ENV, respond: backend.respond })
  assert.equal(run.exitCode, 0, run.output)
  assert.match(run.output, /a draft again, its time kept \(2099-11-24T09:00:00Z\)/)
  assert.equal(backend.seen.filter((r) => r.path.endsWith('/unschedule')).length, 1)
})

const CAMPAIGN_YML = [
  'name: Holiday',
  'goal: conversions',
  'starts: 2026-12-01',
  'ends: 2026-12-14',
  'via: facebook',
  'ad_groups:',
  '  - name: Trays',
  '    daily_budget: 10.00',
  '    ads:',
  '      - page: /holiday',
  '        headlines: [Holiday trays]',
  '        descriptions: [Fresh from our ovens]',
  '  - name: Cakes',
  '    daily_budget: 5.00',
  '    ads:',
  '      - page: /holiday',
  '        headlines: [Holiday cakes]',
  ''
].join('\n')

test('campaign makes the campaign, its ad groups and ads in one write, each ad in its only account', async () => {
  const backend = statefulBackend()
  const dir = tmp('uw-promote-')
  writeFileSync(join(dir, 'holiday.yml'), CAMPAIGN_YML)
  const run = await runVerb(dir, await verb(), ['campaign', 'holiday.yml', '--site', SITE], { env: ENV, respond: backend.respond })
  assert.equal(run.exitCode, 0, run.output)
  const batch = backend.writes()[0].body.batch
  assert.deepEqual(batch.map((op) => op.section), ['networks', 'campaigns', 'campaigns/ad_groups', 'campaigns/ad_groups/ads', 'campaigns/ad_groups', 'campaigns/ad_groups/ads'])
  const [network, campaign, , ad] = batch
  assert.deepEqual(network.data, { network: 'facebook', use: 'ads', connection: CONN_META })
  assert.deepEqual(campaign.data.via, [network.uuid])
  assert.equal(ad.data.via, network.uuid, 'an ad runs in its campaign\'s only account')
  assert.equal(ad.data.page, PAGE_HOLIDAY)
  assert.match(run.output, /Drafted campaign “Holiday” \(\w+\): 2 ad groups, 2 ads, in facebook “Maple Ads”/)
  const file = readFileSync(join(dir, 'holiday.yml'), 'utf8')
  assert.match(file, new RegExp(`^id: ${campaign.uuid}\\nversion: v`))
  assert.equal((file.match(/ id: /g) ?? []).length, 4, 'each ad group and ad has its id')
})

test('start says what it will spend and refuses to spend unseen; --yes starts it', async () => {
  const backend = statefulBackend()
  const dir = tmp('uw-promote-')
  writeFileSync(join(dir, 'holiday.yml'), CAMPAIGN_YML)
  await runVerb(dir, await verb(), ['campaign', 'holiday.yml', '--site', SITE], { env: ENV, respond: backend.respond })
  const campaign = backend.store.find((i) => i.section === 'campaigns')

  const unseen = await runVerb(dir, await verb(), ['start', 'Holiday', '--site', SITE], { env: ENV, respond: backend.respond })
  assert.equal(unseen.exitCode, 2, unseen.output)
  assert.match(unseen.output, /2026-12-01 – 2026-12-14, 14 days/)
  assert.match(unseen.output, /facebook “Maple Ads”: 2 ad groups, 10\.00 \+ 5\.00 a day in the account's currency — up to 210\.00/)
  assert.match(unseen.output, /pass --yes once your person has agreed/)
  assert.equal(backend.seen.filter((r) => r.path.endsWith('/start')).length, 0, 'nothing started')

  const run = await runVerb(dir, await verb(), ['start', 'holiday.yml', '--yes', '--site', SITE], { env: ENV, respond: backend.respond })
  assert.equal(run.exitCode, 0, run.output)
  assert.equal(backend.at('POST', `${PROMO}/campaigns/${campaign.uuid}/start`).length, 1)
  assert.match(run.output, /Running in facebook “Maple Ads”, the network's review: pending, spending in CAD/)
  assert.match(run.output, /fixed there now/)

  const paused = await runVerb(dir, await verb(), ['pause', 'Holiday', '--site', SITE], { env: ENV, respond: backend.respond })
  assert.equal(paused.exitCode, 0, paused.output)
  assert.match(paused.output, /Paused in facebook “Maple Ads”/)
  const resumed = await runVerb(dir, await verb(), ['resume', 'Holiday', '--yes', '--site', SITE], { env: ENV, respond: backend.respond })
  assert.equal(resumed.exitCode, 0, resumed.output)
  assert.match(resumed.output, /Resuming “Holiday”/)
})

test('a write a started campaign refuses is said in words, and nothing changed', async () => {
  const backend = statefulBackend()
  const dir = tmp('uw-promote-')
  writeFileSync(join(dir, 'holiday.yml'), CAMPAIGN_YML)
  await runVerb(dir, await verb(), ['campaign', 'holiday.yml', '--site', SITE], { env: ENV, respond: backend.respond })
  await runVerb(dir, await verb(), ['start', 'Holiday', '--yes', '--site', SITE], { env: ENV, respond: backend.respond })
  writeFileSync(join(dir, 'holiday.yml'), readFileSync(join(dir, 'holiday.yml'), 'utf8').replace('goal: conversions', 'goal: visits'))
  const run = await runVerb(dir, await verb(), ['campaign', 'holiday.yml', '--site', SITE], { env: ENV, respond: backend.respond })
  assert.equal(run.exitCode, 1, run.output)
  assert.match(run.output, /“Holiday” has started in an ad account, and what runs there is fixed.*Add an ad account to its `via`, or draft a new campaign/)
  const shown = await runVerb(dir, await verb(), ['show', 'Holiday', '--site', SITE], { env: ENV, respond: backend.respond })
  assert.match(shown.output, /Campaign \w+ “Holiday”: active(\x1b\[0m)?\n/, 'a started campaign is not called a draft')
  assert.match(shown.output, /facebook “Maple Ads”: active, the network's review: pending, in CAD/)
})

test('show prints a post as the Markdown it is drafted in, with its page by route, and round-trips', async () => {
  const backend = statefulBackend()
  const dir = tmp('uw-promote-')
  writeFileSync(join(dir, 'p.md'), '---\nvia: x\npage: page:3f58142d\n---\nOne.\n\n---\n\nTwo.\n')
  await runVerb(dir, await verb(), ['post', 'p.md', '--site', SITE], { env: ENV, respond: backend.respond })
  const post = backend.store.find((i) => i.section === 'posts')
  const run = await runVerb(dir, await verb(), ['show', post.uuid, '--site', SITE], { env: ENV, respond: backend.respond })
  assert.equal(run.exitCode, 0, run.output)
  assert.match(run.output, /Post \w+: draft/)
  assert.match(run.output, new RegExp(`---\\nid: ${post.uuid}\\nversion: v[0-9a-f]{12}\\nvia: x\\nlanguage: en\\npage: /holiday\\n---\\n\\nOne\\.\\n\\n---\\n\\nTwo\\.`))
  // What show printed is a draft: written back unchanged, it changes nothing.
  const shown = run.output.slice(run.output.indexOf('---\nid:'))
  writeFileSync(join(dir, 'shown.md'), shown)
  const again = await runVerb(dir, await verb(), ['post', 'shown.md', '--site', SITE], { env: ENV, respond: backend.respond })
  assert.equal(again.exitCode, 0, again.output)
  assert.match(again.output, /Nothing to change/)
  assert.equal(backend.writes().length, 1)
})

test('delete deletes a draft by its id, and keeps a post that went out', async () => {
  const backend = statefulBackend()
  const dir = tmp('uw-promote-')
  writeFileSync(join(dir, 'a.md'), '---\nvia: x\n---\nA.\n')
  writeFileSync(join(dir, 'b.md'), '---\nvia: x\n---\nB.\n')
  for (const f of ['a.md', 'b.md']) await runVerb(dir, await verb(), ['post', f, '--site', SITE], { env: ENV, respond: backend.respond })
  await runVerb(dir, await verb(), ['send', 'b.md', '--site', SITE], { env: ENV, respond: backend.respond })
  const [a] = backend.store.filter((i) => i.section === 'posts')
  const short = shortIds(backend.store.map((i) => i.uuid)).get(a.uuid)
  const run = await runVerb(dir, await verb(), ['delete', short, '--site', SITE], { env: ENV, respond: backend.respond })
  assert.equal(run.exitCode, 0, run.output)
  assert.match(run.output, /Deleted the post “A\.”/)
  assert.ok(!backend.store.some((i) => i.uuid === a.uuid))
  const kept = await runVerb(dir, await verb(), ['delete', 'b.md', '--site', SITE], { env: ENV, respond: backend.respond })
  assert.equal(kept.exitCode, 2, kept.output)
  assert.match(kept.output, /went out.*It stays/)
})

test('send --at from a file writes the new time and version into it, so its next run is not stale', async () => {
  const backend = statefulBackend()
  const dir = tmp('uw-promote-')
  writeFileSync(join(dir, 'p.md'), '---\nvia: x\nsend_at: 2099-11-24T09:00:00Z\n---\nSoon.\n')
  await runVerb(dir, await verb(), ['post', 'p.md', '--site', SITE], { env: ENV, respond: backend.respond })
  const moved = await runVerb(dir, await verb(), ['send', 'p.md', '--at', '2099-12-01T10:00:00Z', '--site', SITE], { env: ENV, respond: backend.respond })
  assert.equal(moved.exitCode, 0, moved.output)
  const file = readFileSync(join(dir, 'p.md'), 'utf8')
  assert.match(file, /send_at: '?2099-12-01T10:00:00Z'?\n/)
  assert.match(file, /\n---\nSoon\.\n$/, 'its words as they were')
  const again = await runVerb(dir, await verb(), ['post', 'p.md', '--site', SITE], { env: ENV, respond: backend.respond })
  assert.equal(again.exitCode, 0, again.output)
  assert.match(again.output, /Nothing to change/)
})
