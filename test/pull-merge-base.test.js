/**
 * A pull merges the backend's content into a project whose history it shares.
 *
 * ⭐ THE BASE IS A COMMIT. The three-way merge a pull runs is only as good as its common
 * ancestor, and that ancestor is the last state of the site this history shares with the
 * backend: a sync point. It travels with the history — a teammate who clones has it —
 * where a per-machine record of what one copy's pull wrote did not.
 *
 * Each case below lost work while the ancestor was that record: a teammate's new
 * section, a committed record edit, a fresh clone's committed work, the committed half
 * of a file edited again since. They run the way a person meets them — `uniweb refresh`
 * in a real repository, teammates sharing a bare remote — against a fake backend whose
 * site moves between pulls.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, cpSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { pull } from '../src/commands/pull.js'
import { refresh } from '../src/commands/refresh.js'
import { writeSyncPoint } from '../src/utils/sync-point.js'
import { holdUnchangedPush } from '../src/backend/site-sync.js'

// The workspace these pulls work in (backend/workspace.js) — a test has no login to choose one.
process.env.UNIWEB_WORKSPACE = 'personal'
// The backend the fixtures are bound on, aimed the way automation aims. `fetch` is mocked
// everywhere, so nothing leaves the machine.
const ORIGIN = 'https://uniweb.app'
process.env.UNIWEB_SERVER = ORIGIN

// ⛔ Git, hermetic: no global or system config reaches these repositories — a developer's
// `pull.rebase`, hooks path or signing key would change what is being measured.
const scratch = mkdtempSync(join(tmpdir(), 'uw-merge-base-'))
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

const git = (cwd, ...args) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

function identify(cwd) {
  git(cwd, 'config', 'user.name', 't')
  git(cwd, 'config', 'user.email', 't@t')
}

function commitAll(cwd, msg) {
  git(cwd, 'add', '-A')
  if (git(cwd, 'status', '--porcelain').trim()) git(cwd, 'commit', '-qm', msg)
}

// ── the backend ─────────────────────────────────────────────────────────────

const para = (text) => ({ type: 'paragraph', content: [{ type: 'text', text }] })
const section = (id, uuid, ...paras) => ({
  $id: id,
  $uuid: uuid,
  stable_id: id,
  type: 'Section',
  content: { type: 'doc', content: paras.map(para) }
})
const WELCOME = ['Welcome to the site.', 'We sell furniture.']
const ABOUT = ['About us.']
const siteDoc = (sections) => ({
  $uuid: 'SITE',
  $id: 'site-content',
  $schema: '@uniweb/site-content',
  info: { name: { en: 'S' }, foundation: '@a/base' },
  pages: [
    {
      $id: 'home',
      $uuid: 'P1',
      slug: 'home',
      mode: 'page',
      stable_id: 'home',
      is_index: true,
      page_sections: sections
    }
  ],
  layout_sections: [],
  extensions: [],
  collections: []
})
const baseSite = () => siteDoc([section('welcome', 'S1', ...WELCOME), section('about', 'S2', ...ABOUT)])

const articleDecl = {
  name: '@acme/article',
  sections: {
    article: {
      brief: true,
      fields: {
        title: { type: 'string', localized: true },
        body: { type: 'text', format: 'markdown', localized: true }
      }
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
const HELLO = { name: 'hello', uuid: 'R1', title: 'Hello', body: 'First words.\n' }

const jsonRes = (body, status = 200, headers = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  statusText: '',
  headers: { get: (k) => headers[String(k).toLowerCase()] ?? null },
  json: async () => body,
  text: async () => JSON.stringify(body ?? null),
  arrayBuffer: async () => Buffer.from(JSON.stringify(body ?? null))
})

// A backend whose site the test moves between pulls: `state.site`, `state.records` (null:
// no folder lane), and `state.source` — the commit its content last came from, when it
// says so; `state.folderSource`, when set, what the folder lane names instead.
function fakeBackend({ site = baseSite(), records = null } = {}) {
  const state = { site, records, source: null, folderSource: undefined }
  const fetch = async (url) => {
    const named = (sha) => (sha ? { 'x-uniweb-source': sha } : {})
    const headers = named(state.source)
    const folderHeaders = named(state.folderSource === undefined ? state.source : state.folderSource)
    if (url.includes('/dev/site/content/pull/SITE')) return jsonRes(state.site, 200, headers)
    if (url.includes('/dev/site/folder/pull/SITE'))
      return state.records ? jsonRes({ entities: folderDocs(state.records) }, 200, folderHeaders) : jsonRes(null, 404)
    if (url.includes('/dev/registry/data-schemas/acme/article')) return jsonRes(articleDecl)
    return jsonRes(null, 404)
  }
  return { state, fetch }
}

// ── projects ────────────────────────────────────────────────────────────────

// A project as `uniweb create` leaves one: the repo is the project, the site is `site/`,
// bound to the backend's site and committed.
function skeleton(dir) {
  mkdirSync(join(dir, 'site'), { recursive: true })
  writeFileSync(join(dir, '.gitignore'), '.uniweb\nnode_modules\n')
  writeFileSync(join(dir, 'README.md'), 'project\n')
  writeFileSync(join(dir, 'site', 'site.yml'), "name: S\nfoundation: '@a/base'\n")
  writeFileSync(
    join(dir, 'site', 'sync.json'),
    JSON.stringify({ version: 1, backends: { [ORIGIN]: { site: { uuid: 'SITE' } } } }, null, 2) + '\n'
  )
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
  quiet(() =>
    pull(args, {
      resolveSiteDir: async () => join(dir, 'site'),
      getToken: async () => 'tok',
      fetch: backend.fetch
    })
  )

// `uniweb refresh`: the git remote, then the backend.
const refreshIn = (dir, backend, args = []) =>
  quiet(() =>
    refresh(args, {
      resolveSiteDir: async () => join(dir, 'site'),
      pull: (a) =>
        pull(a, {
          resolveSiteDir: async () => join(dir, 'site'),
          getToken: async () => 'tok',
          fetch: backend.fetch
        })
    })
  )

// One person's project, synced: committed, then its first pull — which takes the backend's
// version whole, as a first pull into a skeleton does — and committed again.
async function synced(backend) {
  const dir = mkdtempSync(join(scratch, 'p-'))
  git(dir, 'init', '-q')
  identify(dir)
  skeleton(dir)
  commitAll(dir, 'create')
  const r = await pullIn(dir, backend, ['--force'])
  assert.equal(r.exitCode, 0, r.out)
  commitAll(dir, 'pull')
  return dir
}

// A team sharing a bare remote. `alice` is synced and pushed to git; `clone(name)` clones
// the remote — a teammate, or a fresh checkout — with nothing of anyone's `.uniweb/`.
async function team(backend) {
  const root = mkdtempSync(join(scratch, 't-'))
  const origin = join(root, 'origin.git')
  git(root, 'init', '-q', '--bare', origin)
  const alice = join(root, 'alice')
  git(root, 'clone', '-q', origin, alice)
  identify(alice)
  skeleton(alice)
  commitAll(alice, 'create')
  const r = await pullIn(alice, backend, ['--force'])
  assert.equal(r.exitCode, 0, r.out)
  commitAll(alice, 'pull')
  git(alice, 'push', '-q', '-u', 'origin', 'HEAD')
  const clone = (name) => {
    const dir = join(root, name)
    git(root, 'clone', '-q', origin, dir)
    identify(dir)
    return dir
  }
  return { alice, clone }
}

const read = (dir, rel) => readFileSync(join(dir, 'site', rel), 'utf8')
const edit = (dir, rel, from, to) => {
  const text = read(dir, rel)
  assert.ok(text.includes(from), `${rel} does not hold ${JSON.stringify(from)}:\n${text}`)
  writeFileSync(join(dir, 'site', rel), text.replace(from, to))
}
const welcomeEdited = (backend, ...paras) => {
  backend.state.site = siteDoc([section('welcome', 'S1', ...paras), section('about', 'S2', ...ABOUT)])
}
const aboutEdited = (backend) => {
  backend.state.site = siteDoc([section('welcome', 'S1', ...WELCOME), section('about', 'S2', 'About us, since 1990.')])
}

// ── a teammate's work, arriving through git ─────────────────────────────────

test(
  "⭐ a teammate's new section, committed and never pushed to the backend, survives a refresh that brings app edits",
  { skip: !hasGit },
  async () => {
    const backend = fakeBackend()
    const { alice, clone } = await team(backend)
    const bob = clone('bob')
    assert.equal((await refreshIn(bob, backend)).exitCode, 0)

    writeFileSync(join(alice, 'site/pages/home/extra.md'), "---\ntype: Section\n---\n\nAlice's new section.\n")
    commitAll(alice, 'a new section')
    git(alice, 'push', '-q')
    aboutEdited(backend) // an author, in the app

    const r = await refreshIn(bob, backend)
    assert.equal(r.exitCode, 0, r.out)
    assert.ok(existsSync(join(bob, 'site/pages/home/extra.md')), `the section Alice committed was deleted:\n${r.out}`)
    assert.match(read(bob, 'pages/home/extra.md'), /Alice's new section\./)
    assert.match(read(bob, 'pages/home/about.md'), /since 1990/) // and the app's edit arrived
  }
)

test(
  "⭐ a fresh clone's first refresh keeps the repository's committed, unpushed work",
  { skip: !hasGit },
  async () => {
    const backend = fakeBackend()
    const { alice, clone } = await team(backend)
    edit(alice, 'pages/home/welcome.md', 'We sell furniture.', 'We sell furniture and lamps.')
    commitAll(alice, 'lamps')
    git(alice, 'push', '-q')
    aboutEdited(backend)

    const carol = clone('carol') // a new teammate: nothing of anyone's .uniweb/
    const r = await refreshIn(carol, backend)
    assert.equal(r.exitCode, 0, r.out)
    assert.match(read(carol, 'pages/home/welcome.md'), /and lamps/, `the committed edit was reverted:\n${r.out}`)
    assert.match(read(carol, 'pages/home/about.md'), /since 1990/)
  }
)

test(
  '⭐ a fresh clone whose history has no sync point merges from the commit the backend says its content came from',
  { skip: !hasGit },
  async () => {
    // The project was put under git after a pull outside it — so its history holds no
    // sync point — and its content then pushed from that commit, which the backend names.
    const backend = fakeBackend()
    const root = mkdtempSync(join(scratch, 'src-'))
    const origin = join(root, 'origin.git')
    git(root, 'init', '-q', '--bare', origin)
    const alice = join(root, 'alice')
    mkdirSync(alice)
    skeleton(alice)
    assert.equal((await pullIn(alice, backend, ['--force'])).exitCode, 0) // not a repo yet: a checkout
    git(alice, 'init', '-q')
    identify(alice)
    commitAll(alice, 'the site')
    backend.state.source = git(alice, 'rev-parse', 'HEAD').trim()
    edit(alice, 'pages/home/welcome.md', 'We sell furniture.', 'We sell furniture and lamps.')
    commitAll(alice, 'lamps')
    git(alice, 'remote', 'add', 'origin', origin)
    git(alice, 'push', '-q', '-u', 'origin', 'HEAD')
    aboutEdited(backend)

    const carol = join(root, 'carol')
    git(root, 'clone', '-q', origin, carol)
    identify(carol)
    const r = await refreshIn(carol, backend)
    assert.equal(r.exitCode, 0, r.out)
    assert.match(read(carol, 'pages/home/welcome.md'), /and lamps/, `the committed edit was reverted:\n${r.out}`)
    assert.match(read(carol, 'pages/home/about.md'), /since 1990/)
  }
)

// ── records ─────────────────────────────────────────────────────────────────

test(
  '⭐ a committed edit to a record, never pushed, survives a refresh',
  { skip: !hasGit },
  async () => {
    const backend = fakeBackend({ records: [HELLO] })
    const dir = await synced(backend)
    const rel = 'records/acme/article/hello.md'
    edit(dir, rel, 'title: Hello', 'title: Hello, edited')
    commitAll(dir, 'retitle')
    aboutEdited(backend)

    const r = await refreshIn(dir, backend, ['--no-git'])
    assert.equal(r.exitCode, 0, r.out)
    assert.match(read(dir, rel), /title: Hello, edited/, `the committed record edit was reverted:\n${r.out}`)
    assert.match(read(dir, 'pages/home/about.md'), /since 1990/)
  }
)

test(
  '⭐ uncommitted edits on top of an unpushed commit — both halves survive',
  { skip: !hasGit },
  async () => {
    const backend = fakeBackend({ records: [HELLO] })
    const dir = await synced(backend)
    const rel = 'records/acme/article/hello.md'
    edit(dir, rel, 'title: Hello', 'title: Hello, edited')
    commitAll(dir, 'retitle')
    edit(dir, rel, 'First words.', 'First words, and more.') // left uncommitted
    aboutEdited(backend)

    const r = await refreshIn(dir, backend, ['--no-git'])
    assert.equal(r.exitCode, 0, r.out)
    const text = read(dir, rel)
    assert.match(text, /title: Hello, edited/, `the committed half was reverted:\n${text}\n${r.out}`)
    assert.match(text, /First words, and more\./, `the uncommitted half was lost:\n${text}\n${r.out}`)
  }
)

// ── what the app did to what you edited ─────────────────────────────────────

test(
  'a section the app deleted while you edited it is a conflict to settle — never kept or dropped in silence',
  { skip: !hasGit },
  async () => {
    const backend = fakeBackend()
    const dir = await synced(backend)
    edit(dir, 'pages/home/welcome.md', 'We sell furniture.', 'We sell furniture and lamps.')
    commitAll(dir, 'lamps')
    backend.state.site = siteDoc([section('about', 'S2', ...ABOUT)])

    const r = await refreshIn(dir, backend, ['--no-git'])
    assert.equal(r.exitCode, 1, `a delete against an edit settled itself:\n${r.out}`)
    assert.match(read(dir, 'pages/home/welcome.md'), /and lamps/)
    assert.match(r.out, /welcome\.md/)
    // Nothing was uncommitted, so nothing is said to come back.
    assert.match(r.out, /then `git commit` to finish the merge\./)
    assert.doesNotMatch(r.out, /uncommitted changes come back/)
  }
)

test(
  'CONTROL — uncommitted work the merge set aside is said to come back with the commit that finishes it, and it does',
  { skip: !hasGit },
  async () => {
    const backend = fakeBackend()
    const dir = await synced(backend)
    edit(dir, 'pages/home/about.md', 'About us.', 'About us, since 1991.')
    commitAll(dir, 'since 1991')
    edit(dir, 'pages/home/welcome.md', 'We sell furniture.', 'We sell furniture and lamps.') // not committed
    aboutEdited(backend)

    const r = await pullIn(dir, backend)
    assert.equal(r.exitCode, 1, r.out)
    assert.deepEqual(r.merge.conflicted, ['site/pages/home/about.md'])
    assert.match(r.out, /then `git commit` to finish the merge — your uncommitted changes come back with it\./)
    assert.doesNotMatch(read(dir, 'pages/home/welcome.md'), /and lamps/, 'not set aside for the merge')
    git(dir, 'checkout', '--ours', '--', 'site/pages/home/about.md')
    git(dir, 'add', 'site/pages/home/about.md')
    git(dir, 'commit', '-q', '--no-edit')
    assert.match(read(dir, 'pages/home/welcome.md'), /and lamps/, 'the uncommitted edit did not come back')
    assert.match(git(dir, 'status', '--porcelain'), /^ M site\/pages\/home\/welcome\.md$/m, 'and is not uncommitted still')
  }
)

test(
  'a section the app renamed while you edited it keeps your edit, under its new name — one file, not two',
  { skip: !hasGit },
  async () => {
    const backend = fakeBackend()
    const dir = await synced(backend)
    edit(dir, 'pages/home/welcome.md', 'We sell furniture.', 'We sell furniture and lamps.')
    commitAll(dir, 'lamps')
    backend.state.site = siteDoc([section('greeting', 'S1', ...WELCOME), section('about', 'S2', ...ABOUT)])

    const r = await refreshIn(dir, backend, ['--no-git'])
    assert.equal(r.exitCode, 0, r.out)
    assert.ok(existsSync(join(dir, 'site/pages/home/greeting.md')), r.out)
    assert.match(read(dir, 'pages/home/greeting.md'), /and lamps/, `the edit did not follow the rename:\n${r.out}`)
    assert.equal(existsSync(join(dir, 'site/pages/home/welcome.md')), false, 'the section is now in two files')
  }
)

test('CONTROL — an app edit to a section nobody touched here is taken', { skip: !hasGit }, async () => {
  const backend = fakeBackend()
  const dir = await synced(backend)
  aboutEdited(backend)
  const r = await refreshIn(dir, backend, ['--no-git'])
  assert.equal(r.exitCode, 0, r.out)
  assert.match(read(dir, 'pages/home/about.md'), /since 1990/)
})

test('CONTROL — a section the app deleted, untouched here, is deleted here', { skip: !hasGit }, async () => {
  const backend = fakeBackend()
  const dir = await synced(backend)
  backend.state.site = siteDoc([section('welcome', 'S1', ...WELCOME)])
  const r = await refreshIn(dir, backend, ['--no-git'])
  assert.equal(r.exitCode, 0, r.out)
  assert.equal(existsSync(join(dir, 'site/pages/home/about.md')), false, r.out)
})

// ── no common history at all ────────────────────────────────────────────────

test(
  'with no sync point to merge from, every difference is a conflict to settle — your committed edit is not overwritten',
  { skip: !hasGit },
  async () => {
    // Content committed straight from a pull outside git, with no backend that names it.
    const backend = fakeBackend()
    const dir = mkdtempSync(join(scratch, 'nobase-'))
    skeleton(dir)
    assert.equal((await pullIn(dir, backend, ['--force'])).exitCode, 0)
    git(dir, 'init', '-q')
    identify(dir)
    commitAll(dir, 'the site')
    edit(dir, 'pages/home/welcome.md', 'We sell furniture.', 'We sell furniture and lamps.')
    commitAll(dir, 'lamps')
    aboutEdited(backend)

    const r = await refreshIn(dir, backend, ['--no-git'])
    assert.equal(r.exitCode, 1, r.out)
    const welcome = read(dir, 'pages/home/welcome.md')
    assert.match(welcome, /<<<<<<</)
    assert.match(welcome, /and lamps/, 'your version is one side of the conflict')
    // A file both sides hold alike merges without a word.
    assert.doesNotMatch(read(dir, 'site.yml'), /<<<<<<</)
  }
)

// ── a project inside a repository that is not its own ───────────────────────

// A harness: a repository with a remote, whose `runs/` holds projects it ignores — and a
// commit on that remote it has not taken, so a `git pull` there would move it.
function harness() {
  const root = mkdtempSync(join(scratch, 'h-'))
  const origin = join(root, 'origin.git')
  git(root, 'init', '-q', '--bare', origin)
  const top = join(root, 'harness')
  git(root, 'clone', '-q', origin, top)
  identify(top)
  writeFileSync(join(top, '.gitignore'), 'runs/\n')
  writeFileSync(join(top, 'README.md'), 'the harness\n')
  commitAll(top, 'harness')
  git(top, 'push', '-q', '-u', 'origin', 'HEAD')
  const other = join(root, 'other')
  git(root, 'clone', '-q', origin, other)
  identify(other)
  writeFileSync(join(other, 'NEWS.md'), 'news\n')
  commitAll(other, 'news')
  git(other, 'push', '-q')
  const project = join(top, 'runs', 'p1')
  mkdirSync(project, { recursive: true })
  skeleton(project)
  return { project, head: () => git(top, 'rev-parse', 'HEAD').trim() }
}

test(
  '⛔ a site in a folder its enclosing repository ignores is pulled as outside git — that repository gains no commit, and refresh does not pull it',
  { skip: !hasGit },
  async () => {
    const backend = fakeBackend()
    const h = harness()
    const before = h.head()
    const first = await pullIn(h.project, backend, ['--force'])
    assert.equal(first.exitCode, 0, first.out)
    aboutEdited(backend)
    const r = await refreshIn(h.project, backend)
    assert.equal(r.exitCode, 0, r.out)
    assert.match(read(h.project, 'pages/home/about.md'), /since 1990/)
    assert.equal(h.head(), before, `the harness moved:\n${r.out}`)
    assert.match(r.out, /Skipped: git \(the repository around this folder ignores it\)/)
  }
)

test(
  '⛔ there, a pull that cannot ask says the repository around it ignores it — and refresh still says it skipped git',
  { skip: !hasGit },
  async () => {
    const backend = fakeBackend()
    const h = harness()
    assert.equal((await pullIn(h.project, backend, ['--force'])).exitCode, 0)
    // The author's own work: outside git a pull asks first, and here nothing can ask.
    edit(h.project, 'pages/home/about.md', 'About us.', 'About us, edited here.')
    aboutEdited(backend)
    const r = await refreshIn(h.project, backend)
    assert.equal(r.exitCode, 1, r.out)
    assert.match(r.out, /the repository around it ignores, so no repository holds it/)
    assert.match(r.out, /a repository of its own/)
    assert.match(r.out, /Skipped: git \(the repository around this folder ignores it\)/, `refresh stopped without saying it skipped git:\n${r.out}`)
    assert.match(read(h.project, 'pages/home/about.md'), /edited here/)
  }
)

test('CONTROL — the same project as its own repository merges, and the harness around it does not move', { skip: !hasGit }, async () => {
  const backend = fakeBackend()
  const h = harness()
  const before = h.head()
  git(h.project, 'init', '-q')
  identify(h.project)
  commitAll(h.project, 'create')
  const first = await pullIn(h.project, backend, ['--force'])
  assert.equal(first.exitCode, 0, first.out)
  aboutEdited(backend)
  const r = await refreshIn(h.project, backend)
  assert.equal(r.exitCode, 0, r.out)
  assert.match(read(h.project, 'pages/home/about.md'), /since 1990/)
  assert.match(git(h.project, 'log', '--format=%B'), /^Uniweb-Sync: /m, 'no sync point in its own history')
  assert.equal(h.head(), before)
})

test(
  "⛔ media a pull fetches into a folder the repository ignores reach the working tree where it lacks them — never over a file it has",
  { skip: !hasGit },
  async () => {
    const backend = fakeBackend()
    const dir = await synced(backend)
    writeFileSync(join(dir, '.gitignore'), '.uniweb\nnode_modules\nsite/public/\n')
    commitAll(dir, 'media stay out of git')
    mkdirSync(join(dir, 'site', 'public', 'assets'), { recursive: true })
    writeFileSync(join(dir, 'site', 'public', 'assets', 'aaaa.png'), 'MINE')
    // An author adds two images in the app; their bytes are served beside the content.
    const image = (id) => ({ type: 'image', attrs: { src: `/served/${id}.png`, assetId: id, assetExt: 'png' } })
    backend.state.site = siteDoc([
      { ...section('welcome', 'S1'), content: { type: 'doc', content: [...WELCOME.map(para), image('aaaa'), image('bbbb')] } },
      section('about', 'S2', ...ABOUT)
    ])
    const saved = globalThis.fetch
    globalThis.fetch = async () => ({ ok: true, arrayBuffer: async () => new TextEncoder().encode('BYTES').buffer })
    let r
    try {
      r = await refreshIn(dir, backend, ['--no-git'])
    } finally {
      globalThis.fetch = saved
    }
    assert.equal(r.exitCode, 0, r.out)
    assert.equal(readFileSync(join(dir, 'site/public/assets/bbbb.png'), 'utf8'), 'BYTES', `the media never arrived:\n${r.out}`)
    assert.equal(readFileSync(join(dir, 'site/public/assets/aaaa.png'), 'utf8'), 'MINE', 'a file the project has was overwritten')
  }
)

test('`pull --force` takes the backend version and leaves a sync point a later merge starts from', { skip: !hasGit }, async () => {
  const backend = fakeBackend()
  const dir = mkdtempSync(join(scratch, 'force-'))
  git(dir, 'init', '-q')
  identify(dir)
  skeleton(dir)
  commitAll(dir, 'create')
  const r = await pullIn(dir, backend, ['--force'])
  assert.equal(r.exitCode, 0, r.out)
  assert.match(git(dir, 'log', '--format=%B'), /^Uniweb-Sync: /m)
})

// ── the base a pull keeps, and what it says ────────────────────────────────

test(
  '⛔ after a merge is abandoned, the next pull merges from the commit that merge was made onto — not an older sync point',
  { skip: !hasGit },
  async () => {
    const backend = fakeBackend()
    const dir = await synced(backend)
    // The developer re-lays and edits a paragraph and pushes from that commit: the backend
    // then holds it, in its own layout, and the commit is this copy's sync point.
    edit(dir, 'pages/home/welcome.md', 'We sell furniture.', 'We sell\nfurniture and lamps.')
    commitAll(dir, 'lamps')
    const pushedFrom = git(dir, 'rev-parse', 'HEAD').trim()
    writeSyncPoint(join(dir, 'site'), ORIGIN, pushedFrom)
    // Then both change About.
    backend.state.site = siteDoc([
      section('welcome', 'S1', WELCOME[0], 'We sell furniture and lamps.'),
      section('about', 'S2', 'About us, since 1990.')
    ])
    edit(dir, 'pages/home/about.md', 'About us.', 'About us, since 1991.')
    commitAll(dir, 'since 1991')

    const first = await pullIn(dir, backend)
    assert.equal(first.exitCode, 1, first.out)
    assert.deepEqual(first.merge.conflicted, ['site/pages/home/about.md'])
    git(dir, 'merge', '--abort')

    const again = await pullIn(dir, backend)
    assert.equal(again.exitCode, 1, again.out)
    assert.deepEqual(again.merge.conflicted, ['site/pages/home/about.md'], `a section nobody changed since the push conflicted:\n${again.out}`)
    assert.equal(git(dir, 'rev-parse', 'MERGE_HEAD^1').trim(), pushedFrom, 'not made onto the commit last pushed from')
  }
)

test(
  "⛔ a re-wrap a push calls nothing to push merges with an author's words typed into it since",
  { skip: !hasGit },
  async () => {
    const backend = fakeBackend()
    const dir = await synced(backend)
    edit(dir, 'pages/home/welcome.md', 'Welcome to the site.', 'Welcome to\nthe site.')
    commitAll(dir, 're-wrap')
    // A push from here sends nothing — a plain newline is a space — and keeps this commit.
    assert.equal(holdUnchangedPush(join(dir, 'site'), ORIGIN), git(dir, 'rev-parse', 'HEAD').trim())
    welcomeEdited(backend, 'Welcome to the site. Typed by the author.', WELCOME[1])

    const r = await pullIn(dir, backend)
    assert.equal(r.exitCode, 0, r.out)
    assert.match(read(dir, 'pages/home/welcome.md'), /Typed by the author/)
  }
)

test(
  "⛔ with no sync point, your own edit is reported as a conflict — never as a change from the backend — and `--force` says what it replaced",
  { skip: !hasGit },
  async () => {
    const backend = fakeBackend()
    const dir = mkdtempSync(join(scratch, 'nobase-say-'))
    skeleton(dir)
    assert.equal((await pullIn(dir, backend, ['--force'])).exitCode, 0) // outside git: a checkout
    git(dir, 'init', '-q')
    identify(dir)
    commitAll(dir, 'the site')
    edit(dir, 'pages/home/welcome.md', 'We sell furniture.', 'We sell furniture and lamps.')
    commitAll(dir, 'lamps')

    const r = await pullIn(dir, backend)
    assert.equal(r.exitCode, 1, r.out)
    assert.deepEqual(r.merge.conflicted, ['site/pages/home/welcome.md'])
    assert.doesNotMatch(r.out, /Merged \d+ change/, `your own edit read as the backend's:\n${r.out}`)
    assert.match(r.out, /No commit in this history is one/)

    git(dir, 'merge', '--abort')
    const f = await pullIn(dir, backend, ['--force'])
    assert.equal(f.exitCode, 0, f.out)
    assert.match(f.out, /Took https:\/\/uniweb\.app's version of 1 file\(s\)/)
    assert.match(f.out, /changed pages\/home\/welcome\.md/)
    assert.match(f.out, /git diff HEAD\^1 HEAD/)
    assert.match(git(dir, 'show', 'HEAD^1:site/pages/home/welcome.md'), /and lamps/, 'the replaced version is not where the pull said')
  }
)

test('⭐ a pull reports what it changed in the files — not what they already held', { skip: !hasGit }, async () => {
  const backend = fakeBackend()
  const dir = await synced(backend)
  aboutEdited(backend)
  // What the backend now holds is in the files already, not committed — as a push leaves
  // the files it writes.
  edit(dir, 'pages/home/about.md', 'About us.', 'About us, since 1990.')
  const r = await pullIn(dir, backend)
  assert.equal(r.exitCode, 0, r.out)
  assert.deepEqual(r.merge.changed, [], `a file the files already held was reported as a change:\n${r.out}`)
  assert.match(r.out, /already hold/)
  // CONTROL — a change the files did not hold is reported.
  commitAll(dir, 'since 1990')
  backend.state.site = siteDoc([section('welcome', 'S1', 'Welcome, from the app.', WELCOME[1]), section('about', 'S2', 'About us, since 1990.')])
  const next = await pullIn(dir, backend)
  assert.equal(next.exitCode, 0, next.out)
  assert.deepEqual(next.merge.changed, [['M', 'pages/home/welcome.md']])
})

test(
  "⛔ an uncommitted edit the merge cannot be put back over is a conflict — the pull exits 1, and says where the edit is kept",
  { skip: !hasGit },
  async () => {
    const backend = fakeBackend()
    const dir = await synced(backend)
    aboutEdited(backend)
    edit(dir, 'pages/home/about.md', 'About us.', 'About us, since 1991.') // not committed, on the line the author changed
    const r = await pullIn(dir, backend)
    assert.equal(r.exitCode, 1, `markers in the files, and the pull exited 0:\n${r.out}`)
    assert.deepEqual(r.merge.conflicted, ['site/pages/home/about.md'])
    assert.match(r.out, /git stash drop/)
    assert.match(git(dir, 'stash', 'list'), /autostash/)
    assert.match(read(dir, 'pages/home/about.md'), /<<<<<<< /)
    // And the next pull does not merge over them.
    const again = await pullIn(dir, backend)
    assert.equal(again.exitCode, 1, again.out)
    assert.match(again.out, /in conflict/)
  }
)

test(
  "⛔ refresh stops when git pull cannot put uncommitted work back — before the backend's content lands on it",
  { skip: !hasGit },
  async () => {
    const backend = fakeBackend()
    const { alice, clone } = await team(backend)
    const bob = clone('bob')
    assert.equal((await refreshIn(bob, backend)).exitCode, 0)
    edit(alice, 'pages/home/about.md', 'About us.', 'About us, by Alice.')
    commitAll(alice, 'about')
    git(alice, 'push', '-q')
    edit(bob, 'pages/home/about.md', 'About us.', 'About us, by Bob.') // not committed
    welcomeEdited(backend, 'Welcome, from the app.', WELCOME[1])

    const r = await refreshIn(bob, backend)
    assert.equal(r.exitCode, 1, r.out)
    assert.match(r.out, /git pull left conflicts/)
    assert.match(r.out, /git stash drop/)
    assert.doesNotMatch(read(bob, 'pages/home/welcome.md'), /from the app/, 'the backend was merged on top of the markers')
  }
)

test(
  "⛔ a pull that brings nothing says so — and names what the files hold that the backend does not have yet",
  { skip: !hasGit },
  async () => {
    const backend = fakeBackend()
    const dir = await synced(backend)
    edit(dir, 'pages/home/welcome.md', 'We sell furniture.', 'We sell furniture and lamps.')
    commitAll(dir, 'lamps') // committed here, never pushed
    const r = await pullIn(dir, backend)
    assert.equal(r.exitCode, 0, r.out)
    assert.match(r.out, /Nothing new from https:\/\/uniweb\.app\. 1 file\(s\) here hold changes it does not have yet/)
    assert.match(r.out, /pages\/home\/welcome\.md/)
    assert.doesNotMatch(r.out, /already hold/, 'it said the files hold what the backend has')
  }
)

test('CONTROL — with nothing changed here either, the files hold what the backend has', { skip: !hasGit }, async () => {
  const backend = fakeBackend()
  const dir = await synced(backend)
  const r = await pullIn(dir, backend)
  assert.equal(r.exitCode, 0, r.out)
  assert.match(r.out, /Your files already hold what https:\/\/uniweb\.app has\./)
})

// ── a push that landed in part ──────────────────────────────────────────────

// A project synced, then a page and a record edited and committed and pushed — the
// content landed, the backend holds the page edit; the records were refused, an author
// had changed one. The content lane names the push's commit; the folder lane what it held.
async function landedInPart({ folderSource }) {
  const backend = fakeBackend({ records: [HELLO] })
  const dir = await synced(backend)
  const before = git(dir, 'rev-parse', 'HEAD').trim()
  edit(dir, 'records/acme/article/hello.md', 'title: Hello', 'title: Hello, edited')
  edit(dir, 'pages/home/welcome.md', 'We sell furniture.', 'We sell furniture and lamps.')
  commitAll(dir, 'edits')
  welcomeEdited(backend, WELCOME[0], 'We sell furniture and lamps.')
  backend.state.source = git(dir, 'rev-parse', 'HEAD').trim()
  backend.state.folderSource = folderSource === 'before' ? before : folderSource
  return { backend, dir }
}

test(
  "⛔ the commit the content lane names is no base for records the backend refused from it — the next pull keeps the record edits",
  { skip: !hasGit },
  async () => {
    for (const folderSource of [null, 'before']) {
      const { backend, dir } = await landedInPart({ folderSource })
      const r = await pullIn(dir, backend)
      assert.equal(r.exitCode, 0, r.out)
      assert.match(read(dir, 'records/acme/article/hello.md'), /title: Hello, edited/, `folder names ${folderSource}: the record edit was reverted:\n${r.out}`)
      assert.match(read(dir, 'pages/home/welcome.md'), /and lamps/)
    }
  }
)

test(
  'CONTROL — with the records the same in both, the commit the content lane names is the base',
  { skip: !hasGit },
  async () => {
    const backend = fakeBackend({ records: [HELLO] })
    const dir = await synced(backend)
    edit(dir, 'pages/home/welcome.md', 'We sell furniture.', 'We sell furniture and lamps.')
    commitAll(dir, 'a page edit')
    welcomeEdited(backend, WELCOME[0], 'We sell furniture and lamps.')
    backend.state.source = git(dir, 'rev-parse', 'HEAD').trim()
    backend.state.folderSource = null
    const r = await pullIn(dir, backend)
    assert.equal(r.exitCode, 0, r.out)
    // Merged from that commit, the backend holds what the files do.
    assert.match(r.out, /Your files already hold what https:\/\/uniweb\.app has\./)
  }
)

// ── a push that wrote ids back ──────────────────────────────────────────────

// A project synced whose record was pushed for the first time: the push was made from a commit
// where the record has no `$uuid`, and wrote the one the backend gave it back, in a commit of its
// own — marked as a 1.13.1 push marks it, or (`marked: false`) as 1.13.0's was.
async function pushedOnceWithIds(backend, { marked = true } = {}) {
  const dir = await synced(backend)
  const rel = 'records/acme/article/hello.md'
  edit(dir, rel, '$uuid: R1\n', '')
  commitAll(dir, 'a record, as authored')
  const pushedFrom = git(dir, 'rev-parse', 'HEAD').trim()
  edit(dir, rel, 'title: Hello', '$uuid: R1\ntitle: Hello')
  git(dir, 'add', '-A')
  const env = { ...process.env, GIT_AUTHOR_NAME: 'uniweb', GIT_AUTHOR_EMAIL: 'sync@uniweb.app', GIT_COMMITTER_NAME: 'uniweb', GIT_COMMITTER_EMAIL: 'sync@uniweb.app' }
  const msg = `Record what ${ORIGIN} gave the site${marked ? `\n\nUniweb-Recorded: ${ORIGIN} SITE` : ''}`
  execFileSync('git', ['commit', '-q', '-m', msg], { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'] })
  return { dir, pushedFrom, recorded: git(dir, 'rev-parse', 'HEAD').trim() }
}

test(
  "⛔ a lane's commit is read through the ids its push wrote back — a change pushed later and taken back stays taken back (A18)",
  { skip: !hasGit },
  async () => {
    const backend = fakeBackend({ records: [HELLO] })
    const { dir, pushedFrom } = await pushedOnceWithIds(backend)
    // A later push changes a page only: the content lane names it, the folder lane still the first.
    edit(dir, 'pages/home/welcome.md', 'We sell furniture.', 'We sell furniture and lamps.')
    commitAll(dir, 'lamps')
    welcomeEdited(backend, WELCOME[0], 'We sell furniture and lamps.')
    backend.state.source = git(dir, 'rev-parse', 'HEAD').trim()
    backend.state.folderSource = pushedFrom
    git(dir, 'revert', '--no-edit', 'HEAD') // taken back, not pushed
    const r = await pullIn(dir, backend)
    assert.equal(r.exitCode, 0, r.out)
    assert.doesNotMatch(read(dir, 'pages/home/welcome.md'), /and lamps/, `the change taken back came back:\n${r.out}`)
  }
)

test(
  "⛔ this copy's own base is never dropped — its last push merges exactly, whatever the lanes name",
  { skip: !hasGit },
  async () => {
    const backend = fakeBackend({ records: [HELLO] })
    // Unmarked, as 1.13.0 wrote it: the lanes cannot be read through it.
    const { dir, pushedFrom } = await pushedOnceWithIds(backend, { marked: false })
    edit(dir, 'pages/home/welcome.md', 'We sell furniture.', 'We sell furniture and lamps.')
    commitAll(dir, 'lamps')
    const pushed = git(dir, 'rev-parse', 'HEAD').trim()
    // This copy pushed it: its sync point, and what the content lane names.
    writeSyncPoint(join(dir, 'site'), ORIGIN, pushed)
    welcomeEdited(backend, WELCOME[0], 'We sell furniture and lamps.')
    backend.state.source = pushed
    backend.state.folderSource = pushedFrom
    const r = await pullIn(dir, backend)
    assert.equal(r.exitCode, 0, r.out)
    assert.match(r.out, /Your files already hold what https:\/\/uniweb\.app has\./)
    const { readSyncPoint } = await import('../src/utils/sync-point.js')
    assert.equal(readSyncPoint(join(dir, 'site'), ORIGIN), pushed, 'the pull merged from an older base than its own last push')
  }
)
