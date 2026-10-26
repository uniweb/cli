/**
 * `uniweb status` — what to know before working on a site, and what to run about it.
 *
 * [Diego, 2026-10-26] a site agent — one that knows nothing of the framework's insides —
 * is surprised by a synced site that changes in the app at any time, and misses a Uniweb
 * release that is ready. So status asks the backend and npm by default (`--offline` asks
 * nothing), reads without taking, names a release calmly, and ends with steps that work in
 * the order given.
 *
 * Run: `pnpm test` or `node --test test/`
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmp, runVerb } from './helpers/run-verb.js'
import { computeUnitHashes, createZip } from '@uniweb/build/uwx'

const ORIGIN = 'http://backend.test'
const SITE = '01a13807-2400-7000-8000-0000000000aa'
const FOLDER = '01a13807-2400-7000-8000-0000000000bb'
const REC = '01a13807-2400-7000-8000-0000000000cc'
const OWN_REC = '01a13807-2400-7000-8000-0000000000dd'

/** The backend's site-content document: one page, About, whose hero says `hero`. */
const siteDoc = (hero) => ({
  $uuid: SITE,
  info: { name: 'T' },
  pages: [{ slug: 'about', title: 'About', page_sections: [{ stable_id: 'hero', type: 'Section', content: hero }] }],
  layout_sections: []
})
/** What the backend held at this copy's last sync. */
const BASE = siteDoc('# About')

/** A pull lane's `.uwx`: the manifest with each entity's version, and the entities. */
const uwx = (entries) =>
  createZip([
    { name: 'manifest.json', data: Buffer.from(JSON.stringify({ entries: entries.map(({ doc, version }) => ({ uuid: doc.$uuid, version })) })) },
    ...entries.map(({ doc }) => ({ name: `entities/${doc.$uuid}.json`, data: Buffer.from(JSON.stringify(doc)) }))
  ])

const git = (dir, args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })

/** A site synced with ORIGIN, whose author keeps About's hero as `1-hero.md`. */
function project({ repo = false, org = null } = {}) {
  const dir = join(tmp('uw-status-'), 'site')
  const files = {
    'site.yml': "name: T\nfoundation: 'https://example.test/foundation/entry.js'\n",
    'package.json': JSON.stringify({ name: 't', dependencies: { uniweb: '*' } }),
    'pages/about/page.yml': 'title: About\n',
    'pages/about/1-hero.md': '# About\n',
    '.gitignore': '.uniweb/\n',
    'sync.json': JSON.stringify({
      version: 1,
      backends: {
        [ORIGIN]: {
          site: { uuid: SITE, ...(org ? { org } : {}) },
          items: { 'pages/about/hero.md': '01a13807-2435-75a1-a2dd-50d125a84676' },
          records: { [OWN_REC]: REC }
        }
      }
    })
  }
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(join(dir, rel, '..'), { recursive: true })
    writeFileSync(join(dir, rel), body)
  }
  const cache = { unitBases: { remote: computeUnitHashes(BASE), local: {} }, baseVersions: { [SITE]: 'v1', [REC]: 'r1', [FOLDER]: 'f1' } }
  if (repo) {
    git(dir, ['init', '-q'])
    git(dir, ['config', 'user.email', 'test@example.test'])
    git(dir, ['config', 'user.name', 'Test'])
    git(dir, ['add', '-A'])
    git(dir, ['commit', '-qm', 'the site'])
    cache.syncPoint = git(dir, ['rev-parse', 'HEAD']).trim()
  }
  mkdirSync(join(dir, '.uniweb'), { recursive: true })
  writeFileSync(join(dir, '.uniweb', 'backend-cache.json'), JSON.stringify({ version: 1, backends: { [ORIGIN]: cache } }))
  return dir
}

const loggedIn = { version: 2, current: ORIGIN, sessions: { [ORIGIN]: { token: 't', handle: 'jane' } } }
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const LIVE = { published: true, draft_dirty: false, editors: [] }

/** The backend, and npm: each lane a `.uwx` or a 304. */
function answering({ content = null, folder = null, site = LIVE, npm = null } = {}) {
  return async (url) => {
    if (url.includes(`/dev/site/status/${SITE}`)) return json(site)
    if (url.includes(`/dev/site/content/pull/${SITE}`)) return content ? new Response(content, { status: 200, headers: { etag: '"e2"' } }) : new Response(null, { status: 304 })
    if (url.includes(`/dev/site/folder/pull/${SITE}`)) return folder ? new Response(folder, { status: 200, headers: { etag: '"f2"' } }) : new Response(null, { status: 304 })
    if (npm && url.startsWith('https://registry.npmjs.org/uniweb/latest')) return json({ version: npm })
    return undefined
  }
}

async function status(dir, args, opts = {}) {
  const { status: verb } = await import('../src/commands/status.js')
  return runVerb(dir, verb, args, opts)
}
const plain = (out) => out.replace(/\x1b\[[0-9;]*m/g, '')
const docOf = (run) => JSON.parse(run.output.trim().split('\n').pop())
const checkOf = (doc, id) => doc.checks.find((c) => c.id === id)

test('⭐ --offline asks nothing beyond this machine', { timeout: 60_000 }, async () => {
  const run = await status(project(), ['--offline', '--json'], { session: loggedIn })
  assert.equal(run.requests, 0, run.urls.join('\n'))
  const doc = docOf(run)
  assert.equal(doc.schema, 1)
  assert.equal(doc.offline, true)
  for (const id of ['app.session', 'uniweb.version', 'dev.server']) assert.equal(checkOf(doc, id)?.state, 'skipped', id)
})

test('--remote is refused, naming the default and --offline', async () => {
  const run = await status(project(), ['--remote'])
  assert.equal(run.exitCode, 2)
  assert.match(run.output, /asks the backend by default now/)
  assert.match(run.output, /--offline/)
  assert.equal(run.requests, 0)
})

test('the document: schema 1, every check an id, a state, a summary and what it blocks', { timeout: 60_000 }, async () => {
  const doc = docOf(await status(project(), ['--personal', '--json'], { session: loggedIn, respond: answering() }))
  assert.equal(doc.schema, 1)
  assert.equal(doc.backend, ORIGIN)
  assert.equal(doc.site, '.')
  for (const c of doc.checks) {
    assert.match(c.id, /^(git|app|uniweb|health|dev)\.[a-z]+$/, c.id)
    assert.ok(['ok', 'attention', 'blocking', 'unknown', 'skipped'].includes(c.state), `${c.id}: ${c.state}`)
    assert.equal(typeof c.summary, 'string')
    assert.ok(Array.isArray(c.blocks), c.id)
  }
  for (const s of doc.next) {
    assert.ok(s.command === null || typeof s.command === 'string')
    assert.equal(typeof s.why, 'string')
    assert.equal(typeof s.ask, 'boolean')
  }
})

test('⭐ not signed in: nothing goes to the backend, and the first step signs in', { timeout: 60_000 }, async () => {
  const run = await status(project(), ['--json'], { env: { UNIWEB_SERVER: ORIGIN } })
  assert.ok(!run.urls.some((u) => u.startsWith(ORIGIN)), run.urls.join('\n'))
  const doc = docOf(run)
  assert.equal(checkOf(doc, 'app.session').state, 'unknown')
  assert.equal(doc.next[0].command, `npx uniweb login --browser --server ${ORIGIN} --personal`)
})

test('…in the workspace the site was created in', { timeout: 60_000 }, async () => {
  const doc = docOf(await status(project({ org: 'acme' }), ['--json'], { env: { UNIWEB_SERVER: ORIGIN } }))
  assert.equal(doc.next[0].command, `npx uniweb login --browser --server ${ORIGIN} --org @acme`)
})

test('⭐ a section changed on the backend is named by the file it is in here', { timeout: 60_000 }, async () => {
  const content = uwx([{ doc: siteDoc('# About us'), version: 'v2' }])
  const run = await status(project(), ['--personal', '--json'], { session: loggedIn, respond: answering({ content }) })
  const doc = docOf(run)
  const changes = checkOf(doc, 'app.changes')
  assert.equal(changes.state, 'attention', JSON.stringify(changes))
  assert.deepEqual(changes.files, ['pages/about/1-hero.md'])
  assert.deepEqual(changes.blocks, [])
  assert.ok(doc.next.some((s) => s.command === 'npx uniweb pull'), JSON.stringify(doc.next))

  const human = plain((await status(project(), ['--personal'], { session: loggedIn, respond: answering({ content }) })).output)
  assert.match(human, /1 change on the backend since this copy last synced/, human)
  assert.match(human, / {6}pages\/about\/1-hero\.md/)
})

test('nothing moved: the same version, or a 304, is nothing to take', { timeout: 60_000 }, async () => {
  // The document differs, the version does not: the version is the backend's word.
  const same = uwx([{ doc: siteDoc('# About us'), version: 'v1' }])
  for (const content of [same, null]) {
    const doc = docOf(await status(project(), ['--personal', '--json'], { session: loggedIn, respond: answering({ content }) }))
    assert.equal(checkOf(doc, 'app.changes').state, 'ok')
    assert.ok(!doc.next.some((s) => s.command === 'npx uniweb pull'))
  }
})

test('⭐ status takes nothing: no ETag, version or hash is banked', { timeout: 60_000 }, async () => {
  const dir = project()
  const before = readFileSync(join(dir, '.uniweb', 'backend-cache.json'), 'utf8')
  const sync = readFileSync(join(dir, 'sync.json'), 'utf8')
  const content = uwx([{ doc: siteDoc('# About us'), version: 'v2' }])
  const run = await status(dir, ['--personal', '--json'], { session: loggedIn, respond: answering({ content }) })
  assert.equal(checkOf(docOf(run), 'app.changes').state, 'attention', 'control: a change was read')
  assert.equal(existsSync(join(dir, '.uniweb', 'pull-cache.json')), false)
  assert.equal(readFileSync(join(dir, '.uniweb', 'backend-cache.json'), 'utf8'), before)
  assert.equal(readFileSync(join(dir, 'sync.json'), 'utf8'), sync)
})

test('a record changed on the backend is named by its folder and slug', { timeout: 60_000 }, async () => {
  const folder = uwx([
    { doc: { $uuid: FOLDER, $schema: '@uniweb/folder', contents: [{ kind: 'ref', name: 'my-post', entry: { schema: '@acme/article', entity: REC } }] }, version: 'f1' },
    { doc: { $uuid: REC, $schema: '@acme/article', title: 'Edited in the app' }, version: 'r2' }
  ])
  const changes = checkOf(docOf(await status(project(), ['--personal', '--json'], { session: loggedIn, respond: answering({ folder }) })), 'app.changes')
  assert.equal(changes.state, 'attention', JSON.stringify(changes))
  assert.deepEqual(changes.detail.records.changed, ['article/my-post'])
  assert.deepEqual(changes.lines, ['records changed: article/my-post'])
})

// ── in a repository: the pull's own answer (`probePull`) ─────────────────────

const para = (text) => ({ type: 'paragraph', content: [{ type: 'text', text }] })
const section = (id, uuid, text) => ({ $id: id, $uuid: uuid, stable_id: id, type: 'Section', content: { type: 'doc', content: [para(text)] } })
/** A site-content document as a backend sends it: a home page with a welcome and an about. */
const realDoc = ({ welcome = 'Welcome to the site.', about = 'About us.' } = {}) => ({
  $uuid: SITE,
  $id: 'site-content',
  $schema: '@uniweb/site-content',
  info: { name: { en: 'S' }, foundation: '@a/base' },
  pages: [{ $id: 'home', $uuid: 'P1', slug: 'home', mode: 'page', stable_id: 'home', is_index: true, page_sections: [section('welcome', 'S1', welcome), section('about', 'S2', about)] }],
  layout_sections: [],
  extensions: [],
  collections: []
})

/** A backend whose site the test moves: the content lane a `.uwx` with its version, no records lane. */
function movingBackend() {
  const state = { doc: realDoc(), version: 'v1' }
  const respond = async (url) => {
    if (url.includes(`/dev/site/status/${SITE}`)) return json(LIVE)
    if (url.includes(`/dev/site/content/pull/${SITE}`)) return new Response(uwx([{ doc: state.doc, version: state.version }]), { status: 200 })
    if (url.includes(`/dev/site/folder/pull/${SITE}`)) return json(null, 404)
    return undefined
  }
  return { state, respond }
}

/** A project in git, taken from the backend by a real first pull, committed — as a person has one. */
async function syncedRepo(backend) {
  const top = tmp('uw-status-git-')
  const dir = join(top, 'site')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(top, '.gitignore'), '.uniweb\nnode_modules\n')
  writeFileSync(join(dir, 'site.yml'), "name: S\nfoundation: '@a/base'\n")
  writeFileSync(join(dir, 'sync.json'), JSON.stringify({ version: 1, backends: { [ORIGIN]: { site: { uuid: SITE } } } }))
  git(top, ['init', '-q'])
  git(top, ['config', 'user.email', 'test@example.test'])
  git(top, ['config', 'user.name', 'Test'])
  git(top, ['add', '-A'])
  git(top, ['commit', '-qm', 'create'])
  const { pull } = await import('../src/commands/pull.js')
  const run = await runVerb(dir, pull, ['--force'], { session: loggedIn, env: { UNIWEB_WORKSPACE: 'personal' }, respond: backend.respond })
  assert.equal(run.exitCode, 0, run.output)
  git(top, ['add', '-A'])
  if (git(top, ['status', '--porcelain']).trim()) git(top, ['commit', '-qm', 'pull'])
  return dir
}

test('⭐ a file changed here and on the backend blocks the push, and the pull comes first', { timeout: 60_000 }, async () => {
  const backend = movingBackend()
  const dir = await syncedRepo(backend)
  const welcome = git(dir, ['ls-files', 'pages']).split('\n').find((p) => p.endsWith('welcome.md'))
  assert.ok(welcome, 'control: the first pull wrote the welcome section')
  writeFileSync(join(dir, welcome), `${readFileSync(join(dir, welcome), 'utf8')}\nEdited here.\n`)
  backend.state.doc = realDoc({ welcome: 'Welcome — written in the app.' })
  backend.state.version = 'v2'
  const doc = docOf(await status(dir, ['--personal', '--json'], { session: loggedIn, respond: backend.respond }))

  const changes = checkOf(doc, 'app.changes')
  assert.equal(changes.detail.source, 'pull', JSON.stringify(changes))
  assert.equal(changes.state, 'blocking', JSON.stringify(changes))
  assert.deepEqual(changes.blocks, ['push', 'publish'])
  assert.deepEqual(changes.detail.overlap, [welcome])
  assert.deepEqual(checkOf(doc, 'app.unpushed').files, [welcome])
  assert.equal(checkOf(doc, 'git.uncommitted').state, 'attention')

  const order = doc.next.map((s) => s.command)
  const push = order.indexOf('npx uniweb push --commit -m "<what you changed>"')
  assert.ok(push > 0, order.join('\n'))
  assert.ok(order.indexOf('npx uniweb pull') < push, order.join('\n'))
})

test('…and with the change only on the backend, its file is named and nothing blocks', { timeout: 60_000 }, async () => {
  const backend = movingBackend()
  const dir = await syncedRepo(backend)
  backend.state.doc = realDoc({ about: 'About us, since 1990.' })
  backend.state.version = 'v2'
  const changes = checkOf(docOf(await status(dir, ['--personal', '--json'], { session: loggedIn, respond: backend.respond })), 'app.changes')
  assert.equal(changes.state, 'attention', JSON.stringify(changes))
  assert.equal(changes.files.length, 1)
  assert.match(changes.files[0], /about\.md$/)
  assert.deepEqual(changes.detail.files, [{ path: changes.files[0], change: 'changed' }])
})

test('control: in git with nothing changed, nothing waits to be pushed', { timeout: 60_000 }, async () => {
  const doc = docOf(await status(project({ repo: true }), ['--personal', '--json'], { session: loggedIn, respond: answering() }))
  assert.equal(checkOf(doc, 'app.unpushed').state, 'ok')
  assert.equal(checkOf(doc, 'git.uncommitted').state, 'ok')
  assert.equal(checkOf(doc, 'git.remote').state, 'skipped', 'no upstream')
  assert.ok(!doc.next.some((s) => s.command?.startsWith('npx uniweb push')))
})

test('⭐ a newer Uniweb is named with the one way to take it — and never called breaking', { timeout: 60_000 }, async () => {
  const run = await status(project(), ['--personal'], { session: loggedIn, respond: answering({ npm: '99.0.0' }) })
  const out = plain(run.output)
  assert.match(out, /Uniweb 99\.0\.0 is out; this project runs /, out)
  assert.match(out, /npx uniweb@latest update\n\s+bring the project and its AGENTS\.md up to date — then build, and look at the pages/, out)
  assert.doesNotMatch(out, /breaking/i)
})

test('npm not answering is not knowing, never "the latest"', { timeout: 60_000 }, async () => {
  const doc = docOf(await status(project(), ['--personal', '--json'], { session: loggedIn, respond: answering() }))
  assert.equal(checkOf(doc, 'uniweb.version').state, 'unknown')
})

test('a site the backend says it does not hold is `gone` — on its word alone', { timeout: 60_000 }, async () => {
  const gone = async (url) =>
    url.includes(`/dev/site/status/${SITE}`) ? json({ kind: 'site', key: SITE, detail: 'No such site.' }, 404) : answering()(url)
  const site = checkOf(docOf(await status(project(), ['--personal', '--json'], { session: loggedIn, respond: gone })), 'app.site')
  assert.equal(site.detail.site_state, 'gone')
  assert.equal(site.state, 'blocking')

  // Control: no answer at all is not knowing, never `gone`.
  const silent = checkOf(docOf(await status(project(), ['--personal', '--json'], { session: loggedIn, respond: async () => undefined })), 'app.site')
  assert.equal(silent.detail.site_state, 'unknown')
})

test('going live is the person\'s to decide', { timeout: 60_000 }, async () => {
  const doc = docOf(await status(project(), ['--personal', '--json'], { session: loggedIn, respond: answering({ site: { published: false, draft_dirty: true, editors: [] } }) }))
  const publish = doc.next.find((s) => s.command === 'npx uniweb publish')
  assert.equal(publish?.ask, true, JSON.stringify(doc.next))
  assert.equal(checkOf(doc, 'app.live').state, 'attention')
})
