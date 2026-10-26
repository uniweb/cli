/**
 * The first pull of a project copied into another repository — a history that shares no commit
 * with the site's content, its sync points left in the old one.
 *
 * [Diego, 2026-10-26] "We may need instruction for people that need to move a project to a repo
 * … maybe we need some command to fix a local project based on the fact that it is already a
 * synced site." → "build all three." Measured the same day on two live sites copied into one
 * repository: the first pull compared text, so six files conflicted, and only three said anything
 * different — the others were the same content written another way. Now a file whose content a
 * push would send the same is left as this copy writes it, and only the rest are conflicts; and
 * the probe, which said nothing with no base, says what differs.
 *
 * Run: `pnpm test` or `node --test test/`
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { pull, probePull, sameButAssetForms } from '../src/commands/pull.js'

process.env.UNIWEB_WORKSPACE = 'personal'
const ORIGIN = 'https://uniweb.app'
process.env.UNIWEB_SERVER = ORIGIN

// ⛔ Git, hermetic: no global or system config reaches these repositories.
const scratch = mkdtempSync(join(tmpdir(), 'uw-moved-'))
process.env.GIT_CONFIG_GLOBAL = join(scratch, 'gitconfig')
writeFileSync(process.env.GIT_CONFIG_GLOBAL, '')
process.env.GIT_CONFIG_NOSYSTEM = '1'

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

// ── the backend ─────────────────────────────────────────────────────────────

const para = (text) => ({ type: 'paragraph', content: [{ type: 'text', text }] })
const section = (id, uuid, ...paras) => ({ $id: id, $uuid: uuid, stable_id: id, type: 'Section', content: { type: 'doc', content: paras.map(para) } })
const site = ({ welcome = ['Welcome to the site.'], about = ['About us.'] } = {}) => ({
  $uuid: 'SITE',
  $id: 'site-content',
  $schema: '@uniweb/site-content',
  info: { name: { en: 'S' }, foundation: '@a/base' },
  pages: [
    { $id: 'home', $uuid: 'P1', slug: 'home', mode: 'page', stable_id: 'home', is_index: true, page_sections: [section('welcome', 'S1', ...welcome), section('about', 'S2', ...about)] }
  ],
  layout_sections: [],
  extensions: [],
  collections: []
})

const jsonRes = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  statusText: '',
  headers: { get: () => null },
  json: async () => body,
  text: async () => JSON.stringify(body ?? null),
  arrayBuffer: async () => Buffer.from(JSON.stringify(body ?? null))
})

function fakeBackend() {
  const state = { site: site(), requests: [] }
  const fetch = async (url, init) => {
    state.requests.push({ url, method: init?.method || 'GET' })
    if (url.includes('/dev/site/content/pull/SITE')) return jsonRes(state.site)
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

/** A project bound to the backend's site and taken by a first pull, then copied into a new repository — without `.git/` or `.uniweb/`. */
async function moved(backend) {
  const from = mkdtempSync(join(scratch, 'old-'))
  git(from, 'init', '-q')
  git(from, 'config', 'user.name', 't')
  git(from, 'config', 'user.email', 't@t')
  mkdirSync(join(from, 'site'), { recursive: true })
  writeFileSync(join(from, '.gitignore'), '.uniweb\nnode_modules\n')
  writeFileSync(join(from, 'site', 'site.yml'), "name: S\nfoundation: '@a/base'\n")
  writeFileSync(join(from, 'site', 'sync.json'), JSON.stringify({ version: 1, backends: { [ORIGIN]: { site: { uuid: 'SITE' } } } }, null, 2) + '\n')
  git(from, 'add', '-A')
  git(from, 'commit', '-qm', 'create')
  const first = await pullIn(from, backend, ['--force'])
  assert.equal(first.exitCode, 0, first.out)
  git(from, 'add', '-A')
  git(from, 'commit', '-qm', 'pull')

  const dir = mkdtempSync(join(scratch, 'new-'))
  cpSync(from, dir, { recursive: true, filter: (src) => !/[/\\]\.(git|uniweb)([/\\]|$)/.test(src) })
  assert.equal(existsSync(join(dir, 'site', '.uniweb')), false, 'control: the cache stayed behind')
  git(dir, 'init', '-q')
  git(dir, 'config', 'user.name', 't')
  git(dir, 'config', 'user.email', 't@t')
  git(dir, 'add', '-A')
  git(dir, 'commit', '-qm', 'the project, copied in')
  return dir
}

const sectionFile = (dir, name) => git(dir, 'ls-files', 'site/pages').split('\n').find((p) => p.endsWith(`${name}.md`))

/** The about section written another way, saying the same: an extra blank line before its paragraph. */
function rewrite(dir) {
  const about = sectionFile(dir, 'about')
  assert.ok(about, 'control: the first pull wrote the about section')
  const text = readFileSync(join(dir, about), 'utf8')
  const other = text.replace(/\nAbout us\./, '\n\n\nAbout us.')
  assert.notEqual(other, text, 'control: the file is written another way')
  writeFileSync(join(dir, about), other)
  git(dir, 'commit', '-qam', 'written another way')
  return about
}

// A section whose body parses to the document the backend holds keeps its own text when the pull
// writes it (`project-writer.js`, "an unchanged body keeps the author's own text"), so it is never
// one of the files that differ — with no base as with one.
test('⭐ a file written another way, saying the same, is no conflict — and the pull records a sync point', async () => {
  const backend = fakeBackend()
  const dir = await moved(backend)
  const about = rewrite(dir)

  const probed = await probeIn(dir, backend)
  assert.equal(probed?.noBase, true, 'the probe answers, with no base')
  assert.deepEqual(probed.files, [], 'nothing says something else')

  const pulled = await pullIn(dir, backend)
  assert.equal(pulled.exitCode, 0, pulled.out)
  assert.deepEqual(pulled.merge.conflicted, [])
  assert.match(readFileSync(join(dir, about), 'utf8'), /\n\n\nAbout us\./, 'the file as this copy writes it')
  // A history that holds the backend's content now: the next probe has a base, and nothing to take.
  const next = await probeIn(dir, backend)
  assert.equal(next?.noBase, undefined)
  assert.deepEqual(next.files, [])
})

test('⭐ a file that says something else is a conflict — and only that one', async () => {
  const backend = fakeBackend()
  const dir = await moved(backend)
  rewrite(dir)
  backend.state.site = site({ welcome: ['Welcome — written in the app.'] })

  const probed = await probeIn(dir, backend)
  assert.equal(probed?.noBase, true)
  assert.deepEqual(probed.files.map(([s, p]) => [s, p.replace(/^.*\//, '')]), [['M', 'welcome.md']])

  const pulled = await pullIn(dir, backend)
  assert.equal(pulled.exitCode, 1, 'a conflict to settle')
  assert.deepEqual(pulled.merge.conflicted.map((p) => p.replace(/^.*\//, '')), ['welcome.md'])
  assert.match(pulled.out, /each file that says something else is a conflict/)
})

test('control: the probe of a copy with history still says only what changed on the backend', async () => {
  const backend = fakeBackend()
  const dir = await moved(backend)
  await pullIn(dir, backend) // the first pull: a sync point here
  backend.state.site = site({ about: ['About us, since 1990.'] })
  const probed = await probeIn(dir, backend)
  assert.equal(probed.noBase, undefined)
  assert.deepEqual(probed.files.map(([, p]) => p.replace(/^.*\//, '')), ['about.md'])
})

test('two writings of the same asset: its URL on the backend, or the site\'s own path', () => {
  const sha = '43f43ddb48822da1c1b6b1a1e0c86fc5d212b8a4aa4c64cd16fde2cb4fb53bf6'
  const url = Buffer.from(`title: Balayage\nimage: >-\n  https://assets.uniweb.pro/assets/${sha}/base.jpeg\norientation: portrait\n`)
  const path = Buffer.from(`title: Balayage\nimage: /assets/${sha}.jpeg\norientation: portrait\n`)
  assert.equal(sameButAssetForms('records/gallery/shot-09.yml', url, path), true)
  const md = (ref) => Buffer.from(`---\ntype: Header\n---\n\n![](${ref}){width=154}\n`)
  assert.equal(sameButAssetForms('layout/header.md', md(`https://assets.uniweb.pro/assets/${sha}/base.jpeg`), md(`/assets/${sha}.png`)), true)
  // CONTROLS: another asset, another field, or nothing to tell apart.
  assert.equal(sameButAssetForms('records/gallery/shot-09.yml', url, Buffer.from(path.toString().replace(sha, 'a'.repeat(64)))), false)
  assert.equal(sameButAssetForms('records/gallery/shot-09.yml', url, Buffer.from(path.toString().replace('portrait', 'landscape'))), false)
  assert.equal(sameButAssetForms('records/gallery/shot-09.yml', path, path), false)
})
