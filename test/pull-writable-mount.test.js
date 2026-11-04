/**
 * ⭐ A MOUNT THE SITE'S REPOSITORY HOLDS, AND ONE NO HISTORY OF IT HOLDS.
 *
 * `paths: { pages/docs: ../docs }`, where `docs/` is a folder of the site's
 * own repository outside the site's folder — the way `uniweb-app-docs` sits beside a site. A pull
 * writes the app's edits to its pages into the mounted folder, merged like the site's own files: with
 * a teammate's commit to another paragraph of the same file, and with nothing for the next push to
 * send that the backend does not hold.
 *
 * ⛔ Until 2026-11-04 a pull wrote no mounted page: an app edit to one was undone by the next push.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { siteProjectToDocument, createZip } from '@uniweb/build/uwx'
import { pull } from '../src/commands/pull.js'
import { probeUnpushed, readItemBaseVersions } from '../src/backend/site-sync.js'

process.env.UNIWEB_WORKSPACE = 'personal'
const ORIGIN = 'https://uniweb.app'
process.env.UNIWEB_SERVER = ORIGIN

// ⛔ Git, hermetic: no global or system config reaches these repositories.
const scratch = mkdtempSync(join(tmpdir(), 'uw-writable-mount-'))
process.env.GIT_CONFIG_GLOBAL = join(scratch, 'gitconfig')
writeFileSync(process.env.GIT_CONFIG_GLOBAL, '')
process.env.GIT_CONFIG_NOSYSTEM = '1'

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
const w = (root, rel, body) => {
  mkdirSync(dirname(join(root, rel)), { recursive: true })
  writeFileSync(join(root, rel), body)
}
const commitAll = (cwd, msg) => {
  git(cwd, 'add', '-A')
  if (git(cwd, 'status', '--porcelain').trim()) git(cwd, 'commit', '-qm', msg)
}

const INTRO = '# Intro\n\nRead this first.\n\nThen the guide.\n'

// A repository holding `site/` and `docs/`, which the site mounts at /docs as `declare` says.
function project(declare = ' ../docs') {
  const dir = mkdtempSync(join(scratch, 'p-'))
  git(dir, 'init', '-q')
  git(dir, 'config', 'user.name', 't')
  git(dir, 'config', 'user.email', 't@t')
  w(dir, '.gitignore', '.uniweb\nnode_modules\n')
  w(dir, 'site/site.yml', `name: S\nfoundation: '@a/base'\nindex: home\npaths:\n  pages/docs:${declare}\n`)
  w(dir, 'site/sync.json', JSON.stringify({ version: 1, backends: { [ORIGIN]: { site: { uuid: 'SITE' } } } }, null, 2) + '\n')
  w(dir, 'site/pages/home/page.yml', 'title: Home\n')
  w(dir, 'site/pages/home/hero.md', '# Welcome\n')
  w(dir, 'site/pages/docs/folder.yml', 'title: Docs\nlayout: DocsLayout\n')
  w(dir, 'docs/folder.yml', 'title: Help\n')
  w(dir, 'docs/intro.md', INTRO)
  commitAll(dir, 'create')
  return dir
}

const jsonRes = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  statusText: '',
  headers: { get: () => null },
  json: async () => body,
  text: async () => JSON.stringify(body ?? null),
  arrayBuffer: async () => Buffer.from(JSON.stringify(body ?? null))
})

const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16)
// Each item's version, as a backend tokens one: its own content, apart from the items in it.
function itemVersions(doc) {
  const out = {}
  const walk = (r) => {
    const { $children, page_sections, ...own } = r
    out[r.$uuid] = hash({ own, sections: (page_sections || []).map((x) => x.$uuid), children: ($children || []).map((x) => x.$uuid) })
    for (const x of page_sections || []) walk(x)
    for (const x of $children || []) walk(x)
  }
  for (const p of doc.pages) walk(p)
  return out
}
// The site as a backend hands it back: a `.uwx` with each item's version in its manifest.
const uwxOf = (doc) =>
  createZip([
    {
      name: 'manifest.json',
      data: Buffer.from(JSON.stringify({ format: 'uwx/1', entries: [{ kind: 'entity', uuid: 'SITE', file: 'entities/SITE.json', version: hash(doc), item_versions: itemVersions(doc) }] }))
    },
    { name: 'entities/SITE.json', data: Buffer.from(JSON.stringify(doc)) }
  ])

// A backend holding what the files push, each item with its uuid, as one hands it back.
async function backendOf(dir) {
  const doc = await siteProjectToDocument(join(dir, 'site'))
  doc.$uuid = 'SITE'
  let n = 0
  const stamp = (r) => {
    r.$uuid = `u${n++}`
    for (const s of r.page_sections || []) stamp(s)
    for (const c of r.$children || []) stamp(c)
  }
  for (const p of doc.pages) stamp(p)
  const state = { site: doc }
  const fetch = async (url) => {
    if (!url.includes('/dev/site/content/pull/SITE')) return jsonRes(null, 404)
    const zip = uwxOf(state.site)
    return { ok: true, status: 200, statusText: '', headers: { get: () => null }, arrayBuffer: async () => zip }
  }
  return { state, fetch }
}
const pageOf = (doc, ...ids) => ids.reduce((records, id, i) => {
  const r = records.find((p) => p.$id === id)
  return i === ids.length - 1 ? r : r.$children
}, doc.pages)
// An author's edit in the app: the intro's first paragraph.
function appEdits(backend, text) {
  const intro = pageOf(backend.state.site, 'docs', 'intro')
  const doc = intro.page_sections[0].content
  const body = doc.type === 'doc' ? doc : doc.en
  const para = body.content.find((node) => node.type === 'paragraph')
  para.content = [{ type: 'text', text }]
}

const quiet = async (fn) => {
  const out = []
  const log = console.log
  const err = console.error
  console.log = (...a) => out.push(a.join(' '))
  console.error = (...a) => out.push(a.join(' '))
  try {
    const r = await fn()
    return { ...r, out: out.join('\n') }
  } finally {
    console.log = log
    console.error = err
  }
}
const pullIn = (dir, backend, args = []) =>
  quiet(() => pull(args, { resolveSiteDir: async () => join(dir, 'site'), getToken: async () => 'tok', fetch: backend.fetch }))
const read = (dir, rel) => readFileSync(join(dir, rel), 'utf8')

test('⭐ an app edit to a mounted page comes back on a pull, merged with a teammate\'s commit to another paragraph', async () => {
  const dir = project()
  const backend = await backendOf(dir)
  const first = await pullIn(dir, backend)
  assert.equal(first.exitCode, 0, first.out)
  assert.equal(read(dir, 'docs/intro.md'), INTRO, 'CONTROL — the first pull, of what the files hold, changed nothing')

  // A teammate's commit to the second paragraph; the app's edit to the first.
  w(dir, 'docs/intro.md', INTRO.replace('Then the guide.', 'Then the guide, slowly.'))
  commitAll(dir, "a teammate's edit")
  appEdits(backend, 'Read this first, please.')

  const r = await pullIn(dir, backend)
  assert.equal(r.exitCode, 0, r.out)
  assert.equal(read(dir, 'docs/intro.md'), '# Intro\n\nRead this first, please.\n\nThen the guide, slowly.\n', r.out)
  assert.equal(git(dir, 'status', '--porcelain', '--', 'docs').trim(), '', 'merged and committed')
  // The sync point names the mounted folder's tree, so a rebased copy of it is told apart.
  const body = git(dir, 'log', '-1', '--format=%B', '--grep=Uniweb-Sync', '--fixed-strings', 'HEAD')
  assert.ok(body.split('\n').some((l) => l.startsWith('Uniweb-Root: docs:')), body)
  // The next push sends the teammate's paragraph, which the backend does not hold, and nothing else.
  assert.equal((await probeUnpushed(join(dir, 'site'), { backend: ORIGIN })).changed, 1)
})

test('⭐ a pull of an app edit alone leaves nothing for the next push to send', async () => {
  const dir = project()
  const backend = await backendOf(dir)
  assert.equal((await pullIn(dir, backend)).exitCode, 0)
  appEdits(backend, 'Read this first, please.')

  const r = await pullIn(dir, backend)
  assert.equal(r.exitCode, 0, r.out)
  assert.match(read(dir, 'docs/intro.md'), /Read this first, please\./)
  assert.equal((await probeUnpushed(join(dir, 'site'), { backend: ORIGIN })).changed, 0)
})

test("⭐ a mount no history of the site holds: the app's edit is held — the folder keeps its text, and the copy the version it last agreed on", async () => {
  const dir = project()
  const elsewhere = mkdtempSync(join(scratch, 'elsewhere-'))
  w(elsewhere, 'folder.yml', 'title: Help\n')
  w(elsewhere, 'intro.md', INTRO)
  w(dir, 'site/site.yml', `name: S\nfoundation: '@a/base'\nindex: home\npaths:\n  pages/docs: ${elsewhere}\n`)
  commitAll(dir, 'mount elsewhere')
  const backend = await backendOf(dir)
  assert.equal((await pullIn(dir, backend)).exitCode, 0)
  const section = pageOf(backend.state.site, 'docs', 'intro').page_sections[0].$uuid
  const agreed = readItemBaseVersions(join(dir, 'site'), ORIGIN)[section]
  assert.ok(agreed, 'CONTROL — the first pull agreed on it')
  appEdits(backend, 'Read this first, please.')

  const r = await pullIn(dir, backend)
  assert.equal(r.exitCode, 0, r.out)
  assert.equal(readFileSync(join(elsewhere, 'intro.md'), 'utf8'), INTRO)
  assert.match(r.out, /Held: 1 mounted page\(s\) changed in the app, which their folder cannot take/)
  assert.match(r.out, /pages\/docs comes from .+, a folder no history of the site's holds, so a pull cannot merge into it/)
  // Named page by page: the one the app changed, not the mount.
  const named = r.out.replace(/\x1B\[[0-9;]*m/g, '').split('\n').map((l) => l.trim()).filter((l) => l.startsWith('/'))
  assert.deepEqual(named, ['/docs/intro'])
  // ⭐ So the per-item gate keeps the backend's while the file is unchanged: never the folder's over it.
  assert.equal(readItemBaseVersions(join(dir, 'site'), ORIGIN)[section], agreed)
})

test('⛔ a mount written as an object, the form `writable` was set in, stops the pull before it takes anything', async () => {
  const dir = project('\n    path: ../docs\n    writable: true')
  const head = git(dir, 'rev-parse', 'HEAD').trim()
  let asked = false
  const backend = { fetch: async () => ((asked = true), jsonRes(null, 404)) }

  const r = await pullIn(dir, backend)
  assert.equal(r.exitCode, 1)
  assert.match(r.out, /pages\/docs in site\.yml's paths: is an object\. A mount is its folder: `pages\/docs: \.\.\/docs`/)
  assert.equal(asked, false, 'the backend was asked')
  assert.equal(git(dir, 'rev-parse', 'HEAD').trim(), head)
})

test("⭐ the mount's own route renamed in the app: site.yml and its local folder follow, merged, and nothing is copied", async () => {
  const dir = project()
  const backend = await backendOf(dir)
  assert.equal((await pullIn(dir, backend)).exitCode, 0)
  backend.state.site.pages.find((p) => p.$id === 'docs').slug = { en: 'help' }

  const r = await pullIn(dir, backend)
  assert.equal(r.exitCode, 0, r.out)
  assert.match(read(dir, 'site/site.yml'), /^ {2}pages\/help: \.\.\/docs$/m)
  assert.doesNotMatch(read(dir, 'site/site.yml'), /pages\/docs/)
  assert.equal(read(dir, 'site/pages/help/folder.yml'), 'title: Docs\nlayout: DocsLayout\n')
  assert.throws(() => read(dir, 'site/pages/help/intro.md'), 'no copy of a mounted page')
  assert.equal(read(dir, 'docs/intro.md'), INTRO)
  assert.match(r.out, /The app renamed \/docs, a mounted route, to \/help/)
  assert.equal(git(dir, 'status', '--porcelain').trim(), '')
  assert.equal((await probeUnpushed(join(dir, 'site'), { backend: ORIGIN })).changed, 0)
})
