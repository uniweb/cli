/**
 * `uniweb promote status | check | connect` — a site's Promote, read and checked as a second
 * client of the backend, beside the app. Drafts and going out: `promote-drafts.test.js`.
 *
 * The backend's half is its own, and these tests answer its routes as it says they answer:
 * `GET /dev/site/promotion/{site}` gives `{ promotion: { uuid, items } }` (each item `{ uuid,
 * section, parent?, data, updated_at }`) or `{ promotion: null }`; `POST …/items` writes a batch
 * and answers `{ uuid, results: [{ uuid, updated_at }] }`; `POST …/steps/{step}/check`, the step
 * named by its token, answers `{ reading }`, or `400` for a step it cannot check; `GET …/campaigns/{c}/spend` gives `{ spend }`;
 * `GET /dev/connections` lists the caller's connections; `POST /dev/connections/consent` answers
 * `{ address }`; `GET /dev/config` carries `promote.networks`, absent while there is none.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { runVerb, tmp } from './helpers/run-verb.js'

const ORIGIN = 'http://backend.test'
const ENV = { UNIWEB_SERVER: ORIGIN, UNIWEB_TOKEN: 'TKN' }
const SITE = '01a169f2-1e71-7bd3-942e-47d5675f2bd2'
const PROMO = `/dev/site/promotion/${SITE}`

const item = (uuid, section, data, parent) => ({
  uuid,
  section,
  ...(parent ? { parent } : {}),
  data,
  updated_at: '2026-11-16T06:00:00Z'
})

/** A promotion with one of each kind of thing a site's Promote holds. */
const PROMOTION = {
  uuid: 'p0',
  items: [
    // A connection reads back as an entity reference, its card's words in its brief.
    item('n1', 'networks', { network: 'linkedin', use: 'posts', connection: { model: 'm', entity: 'k1', brief: { name: 'Ana', state: 'connected' } } }),
    item('n2', 'networks', { network: 'facebook', use: 'ads', connection: { model: 'm', entity: 'k2', brief: { name: 'Maple Ads', state: 'connected' } } }),
    item('s1', 'getting_found', { step: 'sitemap' }),
    item('s1r', 'getting_found/reading', { state: 'done', found: 'sitemap_named', address: 'https://maple.test/sitemap.xml' }, 's1'),
    item('d1', 'posts', { via: 'n1', language: 'en', page: 'pg1' }),
    item('d1a', 'posts/parts', { text: 'Fresh bread' }, 'd1'),
    item('d2', 'posts', { via: 'n1', language: 'en', page: 'pg1', send_at: '2026-11-24T14:00:00Z' }),
    item('d2d', 'posts/delivery', { status: 'scheduled', tag: 't2' }, 'd2'),
    item('d3', 'posts', { via: 'n1', language: 'en', page: 'pg1' }),
    item('d3d', 'posts/delivery', { status: 'published', network_url: 'https://linkedin.test/p/3' }, 'd3'),
    item('c1', 'campaigns', { name: 'Holiday', goal: 'conversions', via: ['n2'] }),
    item('c1d', 'campaigns/delivery', { via: 'n2', external_id: 'X9', status: 'active', currency: 'CAD' }, 'c1'),
    item('c2', 'campaigns', { name: 'Spring', goal: 'visits' })
  ]
}

/** Answers the routes promote meets, recording every request with its body and workspace. */
function promoteBackend({ promotion = PROMOTION, networks = ['google', 'linkedin', 'x'], onCheck, connections, readRefused = null } = {}) {
  const seen = []
  const respond = async (url, init = {}) => {
    const u = new URL(url)
    const method = init.method || 'GET'
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : null
    seen.push({ method, path: u.pathname, body, workspace: init.headers?.['x-uniweb-workspace'] ?? null })
    if (u.pathname === '/dev/orgs') return Response.json({ account_handle: 'ana', orgs: [], workspaces: [] })
    if (u.pathname === '/dev/config') return Response.json(networks ? { promote: { networks } } : {})
    if (u.pathname === PROMO && method === 'GET') {
      return readRefused ? Response.json(readRefused.body, { status: readRefused.status }) : Response.json({ promotion })
    }
    if (u.pathname === `${PROMO}/items` && method === 'POST') {
      return Response.json({ uuid: 'p0', results: body.batch.map((op, i) => ({ uuid: op.uuid ?? `new${i}`, updated_at: '2026-11-16T07:00:00Z' })) })
    }
    const step = u.pathname.match(new RegExp(`^${PROMO}/steps/([^/]+)/check$`))
    if (step && method === 'POST') {
      if (onCheck) return onCheck(step[1])
      return Response.json({ reading: { state: 'done', found: 'sitemap_named', address: 'https://maple.test/sitemap.xml' } })
    }
    if (u.pathname === `${PROMO}/campaigns/c1/spend`) {
      return Response.json({ spend: [
        { via: 'n2', day: '2026-11-15', amount: '8.00', currency: 'CAD', read_at: '2026-11-16T06:00:00Z' },
        { via: 'n2', day: '2026-11-16', amount: '8.00', currency: 'CAD', read_at: '2026-11-16T06:00:00Z' }
      ] })
    }
    if (u.pathname === '/dev/connections' && method === 'GET') {
      return Response.json({ connections: connections ?? [
        { uuid: 'k1', owner: 'a1', card: { network: 'linkedin', name: 'Ana', state: 'connected' } }
      ] })
    }
    if (u.pathname === '/dev/connections/consent' && method === 'POST') {
      return Response.json({ address: `https://network.test/${body.network}/consent?c=abc` })
    }
    return undefined
  }
  return { respond, seen, at: (method, path) => seen.filter((r) => r.method === method && r.path === path) }
}

async function verb() {
  return (await import('../src/commands/promote.js')).promote
}

test('status --json reads the promotion, the connections and the networks, in the workspace named', async () => {
  const backend = promoteBackend()
  const run = await runVerb(tmp('uw-promote-'), await verb(), ['status', '--json', '--site', SITE, '--org', '@acme'], { env: ENV, respond: backend.respond })
  assert.equal(run.exitCode, 0, run.output)
  const out = JSON.parse(run.output.trim().split('\n').pop())
  assert.equal(out.site, SITE)
  assert.deepEqual(out.networksOffered, ['google', 'linkedin', 'x'])
  // posts by state: one draft (no delivery), one scheduled, one published
  assert.deepEqual(out.promotion.posts.map((p) => p.state), ['draft', 'scheduled', 'published'])
  assert.equal(out.promotion.posts[0].parts[0].text, 'Fresh bread')
  // a campaign that runs somewhere carries its spend, summed per currency; a draft has none
  const [holiday, spring] = out.promotion.campaigns
  assert.equal(holiday.state, 'active')
  assert.equal(holiday.started, true)
  assert.deepEqual(holiday.spend, { total: { CAD: '16.00' }, days: 2 })
  assert.equal(spring.state, 'draft')
  assert.equal(spring.spend, undefined)
  // the getting-found step carries its reading
  assert.equal(out.promotion.steps[0].reading.address, 'https://maple.test/sitemap.xml')
  // the site's routes and the connections name the workspace; nothing was written
  assert.equal(backend.at('GET', PROMO)[0].workspace, '@acme')
  assert.equal(backend.at('GET', '/dev/connections')[0].workspace, '@acme')
  assert.equal(backend.seen.filter((r) => r.method === 'POST').length, 0, 'status writes nothing')
})

test('status says what needs the person: a connection to reconnect', async () => {
  const backend = promoteBackend({
    connections: [{ uuid: 'k1', card: { network: 'linkedin', name: 'Ana', state: 'needs_reconnect' } }]
  })
  const run = await runVerb(tmp('uw-promote-'), await verb(), ['status', '--site', SITE], { env: ENV, respond: backend.respond })
  assert.equal(run.exitCode, 0, run.output)
  assert.match(run.output, /Ask the person first/)
  assert.match(run.output, /needs reconnecting, by its person, in the app/)
  assert.match(run.output, /1 draft · 1 scheduled \(next 2026-11-24T14:00:00Z\) · 1 published/)
  assert.match(run.output, /Holiday: active · spent 16\.00 CAD/)
  assert.match(run.output, /posts through linkedin, “Ana”/, 'an account by its connection\'s name')
  assert.match(run.output, /ads through facebook, “Maple Ads”/)
})

test('status on a site that has not used Promote says so, and what can be connected', async () => {
  const backend = promoteBackend({ promotion: null, networks: null })
  const run = await runVerb(tmp('uw-promote-'), await verb(), ['status', '--site', SITE], { env: ENV, respond: backend.respond })
  assert.equal(run.exitCode, 0, run.output)
  assert.match(run.output, /has not used Promote yet/)
  assert.match(run.output, /no network yet, on this deployment/)
})

test('check names the step, and makes no item: the backend keeps one per step', async () => {
  const backend = promoteBackend({ promotion: null })
  const run = await runVerb(tmp('uw-promote-'), await verb(), ['check', 'sitemap', '--site', SITE], { env: ENV, respond: backend.respond })
  assert.equal(run.exitCode, 0, run.output)
  assert.equal(backend.at('POST', `${PROMO}/steps/sitemap/check`).length, 1)
  assert.equal(backend.at('POST', `${PROMO}/items`).length, 0, 'the check finds or makes its item itself')
  assert.equal(backend.at('GET', PROMO).length, 0, 'and needs no read first')
  assert.match(run.output, /sitemap: done .*https:\/\/maple\.test\/sitemap\.xml/)
})

test('check --json gives the reading as the backend answered it', async () => {
  const backend = promoteBackend()
  const run = await runVerb(tmp('uw-promote-'), await verb(), ['check', 'sitemap', '--site', SITE, '--json'], { env: ENV, respond: backend.respond })
  assert.equal(run.exitCode, 0, run.output)
  const out = JSON.parse(run.output.trim().split('\n').pop())
  assert.equal(out.step, 'sitemap')
  assert.equal(out.reading.state, 'done')
})

test('a step the backend cannot check is said, and nothing is written', async () => {
  const backend = promoteBackend({ onCheck: () => new Response('{"reason":"not_checkable"}', { status: 400 }) })
  const run = await runVerb(tmp('uw-promote-'), await verb(), ['check', 'search_console', '--site', SITE], { env: ENV, respond: backend.respond })
  assert.equal(run.exitCode, 1, run.output)
  assert.equal(backend.at('POST', `${PROMO}/steps/search_console/check`).length, 1)
  assert.equal(backend.at('POST', `${PROMO}/items`).length, 0)
  assert.match(run.output, /cannot check `search_console` yet/)
})

test('connect starts the consent and hands over the address, saying where it finishes', async () => {
  const backend = promoteBackend()
  const run = await runVerb(tmp('uw-promote-'), await verb(), ['connect', 'x', '--org', '@acme'], { env: ENV, respond: backend.respond })
  assert.equal(run.exitCode, 0, run.output)
  const sent = backend.at('POST', '/dev/connections/consent')
  assert.deepEqual(sent[0].body, { network: 'x' })
  assert.equal(sent[0].workspace, '@acme', 'a consent is recorded in the workspace named')
  assert.match(run.output, /network\.test\/x\/consent\?c=abc/)
  assert.match(run.output, /signed in to the app as you/)
  assert.match(run.output, /An agent hands this address to its person/)
})

test('connect refuses a network the deployment does not offer, before sending anything', async () => {
  const backend = promoteBackend({ networks: ['google'] })
  const run = await runVerb(tmp('uw-promote-'), await verb(), ['connect', 'x'], { env: ENV, respond: backend.respond })
  assert.equal(run.exitCode, 2, run.output)
  assert.equal(backend.at('POST', '/dev/connections/consent').length, 0)
  assert.match(run.output, /cannot connect `x` — it offers google/)
})

test('with no site named outside a project, it says how to name one; a bad --site is refused', async () => {
  const backend = promoteBackend()
  const none = await runVerb(tmp('uw-promote-'), await verb(), ['status'], { env: ENV, respond: backend.respond })
  assert.equal(none.exitCode, 2, none.output)
  assert.match(none.output, /--site <uuid>/)
  const bad = await runVerb(tmp('uw-promote-'), await verb(), ['status', '--site', 'maple'], { env: ENV, respond: backend.respond })
  assert.equal(bad.exitCode, 2, bad.output)
  assert.match(bad.output, /`maple` is not one/)
})

test('an unknown subcommand or flag is refused', async () => {
  const unknown = await runVerb(tmp('uw-promote-'), await verb(), ['launch'], { env: ENV })
  assert.equal(unknown.exitCode, 2, unknown.output)
  const flag = await runVerb(tmp('uw-promote-'), await verb(), ['status', '--sight', SITE], { env: ENV })
  assert.equal(flag.exitCode, 2, flag.output)
})

/** A site's files: its `site.yml`, and a page per entry (`{ name: pageYml }`), the first the home page. */
function siteFiles(siteYml, pages) {
  const dir = tmp('uw-promote-landing-')
  writeFileSync(join(dir, 'site.yml'), siteYml)
  for (const [name, pageYml] of Object.entries(pages)) {
    mkdirSync(join(dir, 'pages', name), { recursive: true })
    writeFileSync(join(dir, 'pages', name, 'page.yml'), pageYml)
    writeFileSync(join(dir, 'pages', name, '1-intro.md'), `---\ntype: Section\n---\n\n# ${name}\n`)
  }
  return dir
}

test('check <route> checks a page as a landing page, from the site\'s files, and needs no backend', async () => {
  const dir = siteFiles(
    [
      'name: Maple',
      'index: home',
      'services:',
      '  tracking:',
      '    conversions:',
      '      - { name: order, page: /order }',
      '      - { name: call, link: "tel:+15551234" }',
      "  x: { pixel: 'o1abc', events: { order: 'tw-o1abc-o2def' } }",
      ''
    ].join('\n'),
    { home: 'title: Home\ndescription: Fresh bread daily.\n', holiday: 'title: Holiday trays\n' }
  )
  const run = await runVerb(dir, await verb(), ['check', '/holiday'], { env: {} })
  assert.equal(run.exitCode, 0, run.output)
  assert.equal(run.requests, 0, 'nothing asked of any backend')
  const text = run.output.replace(/\x1b\[[0-9;]*m/g, '')
  assert.match(text, /\/holiday, as a landing page/)
  assert.match(text, /Links to \/holiday show no image/)
  assert.match(text, /Give it seo\.image in its page\.yml/)
  assert.match(text, /1 page states no description/)
  assert.match(text, /counts the conversions it lists: order, call/)
  assert.match(text, /x hears order — not call/)
})

test('check <route> says when the site reports nothing for a network to hear, and refuses a page it lacks', async () => {
  const dir = siteFiles('name: Maple\n', { home: 'title: Home\ndescription: Fresh bread daily.\n' })
  const run = await runVerb(dir, await verb(), ['check', '/', '--json'], { env: {} })
  assert.equal(run.exitCode, 0, run.output)
  const out = JSON.parse(run.output.trim().split('\n').pop())
  assert.deepEqual(out.notes.map((n) => n.id), ['tracking-off'])
  const missing = await runVerb(dir, await verb(), ['check', '/winter'], { env: {} })
  assert.equal(missing.exitCode, 1, missing.output)
  assert.match(missing.output, /no page \/winter/)
})

test('status counts every state a post is in, and says why one did not go out', async () => {
  const promotion = {
    uuid: 'p0',
    items: [
      ...PROMOTION.items,
      item('d4', 'posts', { via: 'n1', language: 'en', page: 'pg1' }),
      item('d4a', 'posts/parts', { text: 'Too bold' }, 'd4'),
      item('d4d', 'posts/delivery', { status: 'refused', reason: 'network_refused', detail: 'against its rules' }, 'd4'),
      item('d5', 'posts', { via: 'n1', language: 'en', page: 'pg1' }),
      item('d5d', 'posts/delivery', { status: 'review' }, 'd5')
    ]
  }
  const backend = promoteBackend({ promotion })
  const run = await runVerb(tmp('uw-promote-'), await verb(), ['status', '--site', SITE], { env: ENV, respond: backend.respond })
  assert.equal(run.exitCode, 0, run.output)
  assert.match(run.output, /1 draft · 1 scheduled \(next 2026-11-24T14:00:00Z\) · 1 published · (\x1b\[31m)?1 refused(\x1b\[0m)? · 1 review/)
  assert.match(run.output, /refused “Too bold” — the network refused it — against its rules/)
})

// As the backend refuses a viewer's read (measured on a local backend, 2026-11-16): it names the site it refused.
const VIEWER_REFUSED = { status: 403, title: 'Forbidden', detail: `edit on entity ${SITE} not permitted`, op: 'edit', target: `entity ${SITE}` }

test('someone who can only view the site is told Promote takes edit, and who gives it', async () => {
  const backend = promoteBackend({ readRefused: { status: 403, body: VIEWER_REFUSED } })
  const run = await runVerb(tmp('uw-promote-'), await verb(), ['status', '--site', SITE], { env: ENV, respond: backend.respond })
  assert.equal(run.exitCode, 1, run.output)
  assert.match(run.output, /Promote is for those who can edit the site, and you can only view it/)
  const shown = await runVerb(tmp('uw-promote-'), await verb(), ['show', 'Holiday', '--site', SITE], { env: ENV, respond: backend.respond })
  assert.equal(shown.exitCode, 1, shown.output)
  assert.match(shown.output, /you can only view it/)
})
