/**
 * `probePull` — what a pull would change in the files, and nothing more.
 *
 * ⭐ THE PULL ITSELF, STOPPED BEFORE IT TAKES ANYTHING, so `uniweb status` and `uniweb pull`
 * cannot disagree about which files the backend changed. Measured 2026-10-26 on a real site:
 * an earlier status compared the backend's units with this copy's last sync and named 8
 * files where the pull changed 11 — the 3 it missed were the changed sections'
 * translations, which a pull writes to `locales/*.json`.
 *
 * Each case runs the way a person meets it: a real repository, synced by a real first pull,
 * against a fake backend whose site moves — and where it can, ends with the pull itself, to
 * hold the probe to its answer.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { pull, probePull } from '../src/commands/pull.js'

// The workspace these pulls work in (backend/workspace.js) — a test has no login to choose one.
process.env.UNIWEB_WORKSPACE = 'personal'
const ORIGIN = 'https://uniweb.app'
process.env.UNIWEB_SERVER = ORIGIN

// ⛔ Git, hermetic: no global or system config reaches these repositories.
const scratch = mkdtempSync(join(tmpdir(), 'uw-probe-'))
process.env.GIT_CONFIG_GLOBAL = join(scratch, 'gitconfig')
writeFileSync(process.env.GIT_CONFIG_GLOBAL, '')
process.env.GIT_CONFIG_NOSYSTEM = '1'

const hasGit = (() => {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

// ── the backend ─────────────────────────────────────────────────────────────

const para = (text) => ({ type: 'paragraph', content: [{ type: 'text', text }] })
const section = (id, uuid, ...paras) => ({
  $id: id,
  $uuid: uuid,
  stable_id: id,
  type: 'Section',
  content: { type: 'doc', content: paras.map(para) }
})
const siteDoc = (sections) => ({
  $uuid: 'SITE',
  $id: 'site-content',
  $schema: '@uniweb/site-content',
  info: { name: { en: 'S' }, foundation: '@a/base' },
  pages: [{ $id: 'home', $uuid: 'P1', slug: 'home', mode: 'page', stable_id: 'home', is_index: true, page_sections: sections }],
  layout_sections: [],
  extensions: [],
  collections: []
})
const WELCOME = ['Welcome to the site.']
const ABOUT = ['About us.']
const site = ({ welcome = WELCOME, about = ABOUT } = {}) =>
  siteDoc([section('welcome', 'S1', ...welcome), section('about', 'S2', ...about)])

const articleDecl = {
  name: '@acme/article',
  sections: {
    article: {
      brief: true,
      fields: { title: { type: 'string', localized: true }, body: { type: 'text', format: 'markdown', localized: true } }
    }
  }
}
const folderDocs = (records) => [
  {
    $uuid: 'F1',
    $schema: '@uniweb/folder',
    contents: records.map((r) => ({ kind: 'ref', name: r.name, $uuid: `PL-${r.uuid}`, entry: { schema: '@acme/article', entity: r.uuid } }))
  },
  ...records.map((r) => ({ $uuid: r.uuid, $schema: '@acme/article', article: { title: { en: r.title }, body: { en: r.body } } }))
]

const jsonRes = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  statusText: '',
  headers: { get: () => null },
  json: async () => body,
  text: async () => JSON.stringify(body ?? null),
  arrayBuffer: async () => Buffer.from(JSON.stringify(body ?? null))
})

/** A backend whose site the test moves: `state.site`, `state.records` (null: no folder lane). */
function fakeBackend({ records = null } = {}) {
  const state = { site: site(), records, requests: [] }
  const fetch = async (url, init) => {
    state.requests.push({ url, method: init?.method || 'GET' })
    if (url.includes('/dev/site/content/pull/SITE')) return jsonRes(state.site)
    if (url.includes('/dev/site/folder/pull/SITE')) return state.records ? jsonRes({ entities: folderDocs(state.records) }) : jsonRes(null, 404)
    if (url.includes('/dev/registry/data-schemas/acme/article')) return jsonRes(articleDecl)
    return jsonRes(null, 404)
  }
  return { state, fetch }
}

// ── projects ────────────────────────────────────────────────────────────────

const quiet = async (fn) => {
  const out = []
  const { log, error } = console
  console.log = (...a) => out.push(a.join(' '))
  console.error = (...a) => out.push(a.join(' '))
  try {
    return { ...(await fn()), out: out.join('\n') }
  } finally {
    console.log = log
    console.error = error
  }
}

const deps = (dir, backend) => ({ resolveSiteDir: async () => join(dir, 'site'), getToken: async () => 'tok', fetch: backend.fetch })
const pullIn = (dir, backend, args = []) => quiet(() => pull(args, deps(dir, backend)))
const probeIn = (dir, backend) => probePull([], deps(dir, backend))

/** A project as `uniweb create` leaves one, bound to the backend's site, taken by a first pull, committed. */
async function synced(backend) {
  const dir = mkdtempSync(join(scratch, 'p-'))
  git(dir, 'init', '-q')
  git(dir, 'config', 'user.name', 't')
  git(dir, 'config', 'user.email', 't@t')
  mkdirSync(join(dir, 'site'), { recursive: true })
  writeFileSync(join(dir, '.gitignore'), '.uniweb\nnode_modules\n')
  writeFileSync(join(dir, 'site', 'site.yml'), "name: S\nfoundation: '@a/base'\n")
  writeFileSync(join(dir, 'site', 'sync.json'), JSON.stringify({ version: 1, backends: { [ORIGIN]: { site: { uuid: 'SITE' } } } }, null, 2) + '\n')
  git(dir, 'add', '-A')
  git(dir, 'commit', '-qm', 'create')
  const r = await pullIn(dir, backend, ['--force'])
  assert.equal(r.exitCode, 0, r.out)
  git(dir, 'add', '-A')
  if (git(dir, 'status', '--porcelain').trim()) git(dir, 'commit', '-qm', 'pull')
  return dir
}

/** Everything a probe must leave as it found it. */
const snapshot = (dir) => ({
  head: git(dir, 'rev-parse', 'HEAD').trim(),
  status: git(dir, 'status', '--porcelain'),
  ...Object.fromEntries(
    ['sync.json', '.uniweb/backend-cache.json', '.uniweb/pull-cache.json'].map((f) => [f, existsSync(join(dir, 'site', f)) ? readFileSync(join(dir, 'site', f), 'utf8') : null])
  )
})

const paths = (files) => files.map(([, p]) => p)

test('⭐ the probe names what the pull then changes — no more, no less', { skip: !hasGit }, async () => {
  const backend = fakeBackend()
  const dir = await synced(backend)
  backend.state.site = site({ welcome: ['Welcome — written in the app.'] })

  const probed = await probeIn(dir, backend)
  assert.ok(probed, 'the probe answered')
  assert.equal(probed.files.length, 1, JSON.stringify(probed.files))
  assert.equal(probed.files[0][0], 'M')

  const pulled = await pullIn(dir, backend)
  assert.equal(pulled.exitCode, 0, pulled.out)
  assert.deepEqual(paths(probed.files), pulled.merge.changed.map(([, p]) => p))
})

test('⭐ the probe takes nothing: no file, cache, sync point or commit moves, and nothing is written to the backend', { skip: !hasGit }, async () => {
  const backend = fakeBackend()
  const dir = await synced(backend)
  backend.state.site = site({ about: ['About us, since 1990.'] })
  const before = snapshot(dir)
  backend.state.requests.length = 0

  const probed = await probeIn(dir, backend)
  assert.equal(probed?.files.length, 1, 'control: a change was read')
  assert.deepEqual(snapshot(dir), before)
  assert.ok(backend.state.requests.every((r) => r.method === 'GET'), JSON.stringify(backend.state.requests))
})

test('nothing moved on the backend: nothing to take', { skip: !hasGit }, async () => {
  const backend = fakeBackend()
  const dir = await synced(backend)
  assert.deepEqual((await probeIn(dir, backend))?.files, [])
})

test("this copy's own uncommitted work is not the backend's change", { skip: !hasGit }, async () => {
  const backend = fakeBackend()
  const dir = await synced(backend)
  const about = git(dir, 'ls-files', 'site/pages').split('\n').find((p) => p.endsWith('about.md'))
  assert.ok(about, 'control: the first pull wrote the about section')
  writeFileSync(join(dir, about), `${readFileSync(join(dir, about), 'utf8')}\nEdited here.\n`)
  backend.state.site = site({ welcome: ['Welcome — written in the app.'] })

  const probed = await probeIn(dir, backend)
  assert.equal(probed.files.length, 1, JSON.stringify(probed.files))
  assert.match(probed.files[0][1], /welcome\.md$/)
})

test('a record changed on the backend is named by the file the pull writes it to', { skip: !hasGit }, async () => {
  const backend = fakeBackend({ records: [{ name: 'hello', uuid: 'R1', title: 'Hello', body: 'First words.\n' }] })
  const dir = await synced(backend)
  backend.state.records = [{ name: 'hello', uuid: 'R1', title: 'Hello', body: 'Words written in the app.\n' }]

  const probed = await probeIn(dir, backend)
  assert.ok(probed, 'the probe answered')
  const pulled = await pullIn(dir, backend)
  assert.equal(pulled.exitCode, 0, pulled.out)
  assert.deepEqual(paths(probed.files), pulled.merge.changed.map(([, p]) => p))
  assert.ok(paths(probed.files).some((p) => p.startsWith('records/')), JSON.stringify(probed.files))
})

test('outside git there is nothing to write onto: the probe does not answer', async () => {
  const backend = fakeBackend()
  const dir = mkdtempSync(join(scratch, 'plain-'))
  mkdirSync(join(dir, 'site'), { recursive: true })
  writeFileSync(join(dir, 'site', 'site.yml'), "name: S\nfoundation: '@a/base'\n")
  writeFileSync(join(dir, 'site', 'sync.json'), JSON.stringify({ version: 1, backends: { [ORIGIN]: { site: { uuid: 'SITE' } } } }))
  assert.equal(await probeIn(dir, backend), null)
  assert.equal(backend.state.requests.length, 0)
})
