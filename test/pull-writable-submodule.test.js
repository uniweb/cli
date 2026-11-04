/**
 * ⭐ A WRITABLE MOUNT IN A SUBMODULE: `paths: { pages/docs: { path: ../external/docs, writable: true } }`,
 * where `external/docs` is a submodule of the site's repository with a remote of its own.
 *
 * A pull writes the app's edits to its pages as a commit in the submodule, made as the person who pulls,
 * merges it into the submodule's checkout, and records it in the site's sync point, so every copy of the
 * site that checks it out holds the base the next pull merges from. These run the way a team meets it:
 * real repositories, bare remotes for the site and for the docs, a fake backend whose site moves.
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
import { probeUnpushed } from '../src/backend/site-sync.js'

process.env.UNIWEB_WORKSPACE = 'personal'
const ORIGIN = 'https://uniweb.app'
process.env.UNIWEB_SERVER = ORIGIN

// ⛔ Git, hermetic: no global or system config reaches these repositories but this one, which names
// the person and lets a submodule be cloned from a local path.
const scratch = mkdtempSync(join(tmpdir(), 'uw-writable-submodule-'))
process.env.GIT_CONFIG_GLOBAL = join(scratch, 'gitconfig')
writeFileSync(process.env.GIT_CONFIG_GLOBAL, '[user]\n\tname = Alice\n\temail = alice@example.test\n[protocol "file"]\n\tallow = always\n[init]\n\tdefaultBranch = main\n')
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
const read = (dir, rel) => readFileSync(join(dir, rel), 'utf8')
const head = (dir) => git(dir, 'rev-parse', 'HEAD').trim()

const INTRO = '# Intro\n\nRead this first.\n\nThen the guide.\n'
const USE = '# Use\n\nUse it.\n'

// The docs, a repository with a remote of their own; the site's, with the docs as a submodule it
// mounts writable. Both pushed.
function team() {
  const root = mkdtempSync(join(scratch, 't-'))
  const docsRemote = join(root, 'docs.git')
  git(root, 'init', '-q', '--bare', docsRemote)
  const seed = join(root, 'seed')
  git(root, 'clone', '-q', docsRemote, seed)
  w(seed, 'folder.yml', 'title: Help\n')
  w(seed, 'intro.md', INTRO)
  w(seed, 'use.md', USE)
  commitAll(seed, 'the docs')
  git(seed, 'push', '-q', 'origin', 'HEAD:main')

  const siteRemote = join(root, 'site.git')
  git(root, 'init', '-q', '--bare', siteRemote)
  const alice = join(root, 'alice')
  git(root, 'clone', '-q', siteRemote, alice)
  w(alice, '.gitignore', '.uniweb\nnode_modules\n')
  w(alice, 'site/site.yml', "name: S\nfoundation: '@a/base'\nindex: home\npaths:\n  pages/docs:\n    path: ../external/docs\n    writable: true\n")
  w(alice, 'site/sync.json', JSON.stringify({ version: 1, backends: { [ORIGIN]: { site: { uuid: 'SITE' } } } }, null, 2) + '\n')
  w(alice, 'site/pages/home/page.yml', 'title: Home\n')
  w(alice, 'site/pages/home/hero.md', '# Welcome\n')
  git(alice, 'submodule', '-q', 'add', '-b', 'main', docsRemote, 'external/docs')
  commitAll(alice, 'the site')
  git(alice, 'push', '-q', '-u', 'origin', 'HEAD:main')
  const clone = (name) => {
    const dir = join(root, name)
    git(root, 'clone', '-q', '--recurse-submodules', siteRemote, dir)
    return dir
  }
  return { alice, seed, clone }
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
// A backend holding what the files push, each item with a uuid.
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
// An author's edit in the app: the first paragraph of a docs page.
function appEdits(backend, id, text) {
  const page = backend.state.site.pages.find((p) => p.$id === 'docs').$children.find((p) => p.$id === id)
  const content = page.page_sections[0].content
  const body = content.type === 'doc' ? content : content.en
  body.content.find((node) => node.type === 'paragraph').content = [{ type: 'text', text }]
}

const quiet = async (fn) => {
  const out = []
  const log = console.log
  const err = console.error
  console.log = (...a) => out.push(a.join(' '))
  console.error = (...a) => out.push(a.join(' '))
  try {
    const r = await fn()
    return { ...r, out: out.join('\n').replace(/\x1B\[[0-9;]*m/g, '') }
  } finally {
    console.log = log
    console.error = err
  }
}
const pullIn = (dir, backend, args = []) =>
  quiet(() => pull(args, { resolveSiteDir: async () => join(dir, 'site'), getToken: async () => 'tok', fetch: backend.fetch }))
const syncPointOf = (dir) => git(dir, 'log', '-1', '--format=%H', '--fixed-strings', '--grep=Uniweb-Sync: ', 'HEAD').trim()

test('⭐ an app edit to a page in a submodule comes back as a commit there, which the site\'s sync point records', async () => {
  const { alice } = team()
  const backend = await backendOf(alice)
  const first = await pullIn(alice, backend)
  assert.equal(first.exitCode, 0, first.out)
  assert.equal(read(alice, 'external/docs/intro.md'), INTRO, 'CONTROL — the first pull, of what the files hold, changed nothing')

  appEdits(backend, 'intro', 'Read this first, please.')
  const r = await pullIn(alice, backend)
  assert.equal(r.exitCode, 0, r.out)
  assert.match(read(alice, 'external/docs/intro.md'), /Read this first, please\./)
  // A commit in the submodule, as the person who pulls, naming the file and no site.
  const sub = join(alice, 'external/docs')
  const [author, subject, , file] = git(sub, 'log', '-1', '--format=%an%n%s%n%n%b', 'HEAD').split('\n')
  assert.deepEqual([author, subject, file], ['Alice', 'Edits made in the app', '- intro.md'])
  // The site's sync point records it, and names its commit in a trailer.
  const sp = syncPointOf(alice)
  assert.equal(git(alice, 'rev-parse', `${sp}:external/docs`).trim(), head(sub))
  assert.match(git(alice, 'log', '-1', '--format=%B', sp), new RegExp(`^Uniweb-Root: external/docs:${head(sub)}$`, 'm'))
  // The site's own commit records the submodule's checkout, and nothing is left uncommitted.
  assert.equal(git(alice, 'rev-parse', 'HEAD:external/docs').trim(), head(sub))
  assert.equal(git(alice, 'status', '--porcelain').trim(), '')
  assert.match(r.out, /external\/docs is a submodule, and the app.s edits are a commit in it, which its remote does not hold yet: push it there before you push this repository — `git -C \S*external\/docs push origin HEAD:main`/)
  assert.equal((await probeUnpushed(join(alice, 'site'), { backend: ORIGIN })).changed, 0)
})

test("⭐ a teammate's fresh clone pulls from it with no conflict", async () => {
  const { alice, clone } = team()
  const backend = await backendOf(alice)
  assert.equal((await pullIn(alice, backend)).exitCode, 0)
  appEdits(backend, 'intro', 'Read this first, please.')
  assert.equal((await pullIn(alice, backend)).exitCode, 0)
  // Alice pushes the docs, then the site, as the pull said.
  git(join(alice, 'external/docs'), 'push', '-q', 'origin', 'HEAD:main')
  git(alice, 'push', '-q')

  const bob = clone('bob')
  appEdits(backend, 'use', 'Use it well.')
  const r = await pullIn(bob, backend)
  assert.equal(r.exitCode, 0, r.out)
  assert.doesNotMatch(r.out, /conflict/i)
  assert.match(read(bob, 'external/docs/use.md'), /Use it well\./)
  assert.match(read(bob, 'external/docs/intro.md'), /Read this first, please\./)
  assert.equal(git(bob, 'status', '--porcelain').trim(), '')
})

test("⭐ a teammate's commit in the submodule since the last pull merges with the app's edit, and the site's pin records both", async () => {
  const { alice } = team()
  const backend = await backendOf(alice)
  assert.equal((await pullIn(alice, backend)).exitCode, 0)
  // The docs move in git, and the site records it: its pin moved since the pull's base.
  const sub = join(alice, 'external/docs')
  w(sub, 'use.md', '# Use\n\nUse it, carefully.\n')
  commitAll(sub, "a teammate's edit")
  commitAll(alice, 'the docs moved')
  appEdits(backend, 'intro', 'Read this first, please.')

  const r = await pullIn(alice, backend)
  assert.equal(r.exitCode, 0, r.out)
  assert.match(read(alice, 'external/docs/intro.md'), /Read this first, please\./)
  assert.match(read(alice, 'external/docs/use.md'), /Use it, carefully\./)
  // Git conflicts on a pin both sides moved; the submodule's merge is its resolution.
  assert.equal(git(alice, 'rev-parse', 'HEAD:external/docs').trim(), head(sub))
  assert.equal(git(alice, 'status', '--porcelain').trim(), '')
  assert.throws(() => git(alice, 'rev-parse', '--verify', '-q', 'MERGE_HEAD'), 'the site\'s merge is made')
})

test('⭐ a squash merge upstream drops the pull\'s commit: the next pull merges from the commit it was made onto, with no conflict', async () => {
  const { alice } = team()
  const backend = await backendOf(alice)
  assert.equal((await pullIn(alice, backend)).exitCode, 0)
  appEdits(backend, 'intro', 'Read this first, please.')
  assert.equal((await pullIn(alice, backend)).exitCode, 0)
  // Upstream takes the pull's commit as a squash: its content, on another commit.
  const sub = join(alice, 'external/docs')
  const made = head(sub)
  const squash = git(sub, 'commit-tree', `${made}^{tree}`, '-p', `${made}^1`, '-m', 'Docs edits (squashed)').trim()
  git(sub, 'checkout', '-q', '--detach', squash)
  commitAll(alice, 'the docs, squashed upstream')
  appEdits(backend, 'use', 'Use it well.')

  const r = await pullIn(alice, backend)
  assert.equal(r.exitCode, 0, r.out)
  assert.doesNotMatch(r.out, /conflict/i)
  assert.match(read(alice, 'external/docs/use.md'), /Use it well\./)
  assert.match(read(alice, 'external/docs/intro.md'), /Read this first, please\./)
  assert.equal(git(alice, 'status', '--porcelain').trim(), '')
})

test('a conflict in the submodule is left for the person, and said with what settles it', async () => {
  const { alice } = team()
  const backend = await backendOf(alice)
  assert.equal((await pullIn(alice, backend)).exitCode, 0)
  const sub = join(alice, 'external/docs')
  w(sub, 'intro.md', INTRO.replace('Read this first.', 'Read this first, in git.'))
  commitAll(sub, "a teammate's edit")
  commitAll(alice, 'the docs moved')
  appEdits(backend, 'intro', 'Read this first, in the app.')

  const r = await pullIn(alice, backend)
  assert.notEqual(r.exitCode, 0)
  assert.match(r.out, /external\/docs\/intro\.md/)
  assert.match(r.out, /\.\.\/external\/docs is a submodule: settle its conflicts and commit there, then record it here \(`git add \S*external\/docs`\) and commit\./)
  assert.match(read(alice, 'external/docs/intro.md'), /<<<<<<<[\s\S]*in git[\s\S]*in the app/)
})
