/**
 * Sync points — the git half of a pull's merge (`src/utils/sync-point.js`).
 *
 * What reaches a person is pinned in `pull-merge-base.test.js`. These pin the rules a
 * merge rests on: which commit is a sync point, which is the newest, what a stand-in may
 * touch, and what a merge does with a file that is not under git.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, symlinkSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import {
  repoOf,
  historySyncPoint,
  newestBase,
  openStandIn,
  mergeSyncPoint,
  siteTreeIn,
  commitRoots,
  uncommittedPaths,
  changedInFiles,
  snapshotFiles
} from '../src/utils/sync-point.js'

const scratch = mkdtempSync(join(tmpdir(), 'uw-sync-point-'))
process.env.GIT_CONFIG_GLOBAL = join(scratch, 'gitconfig')
writeFileSync(process.env.GIT_CONFIG_GLOBAL, '[user]\n\tname = t\n\temail = t@t\n')
process.env.GIT_CONFIG_NOSYSTEM = '1'

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
const ORIGIN = 'https://uniweb.app'

// A project whose repo is its root and whose site is `site/`, with one page committed.
function project() {
  const dir = mkdtempSync(join(scratch, 'p-'))
  git(dir, 'init', '-q')
  mkdirSync(join(dir, 'site', 'pages', 'home'), { recursive: true })
  writeFileSync(join(dir, 'site', 'site.yml'), 'name: S\n')
  writeFileSync(join(dir, 'site', 'pages', 'home', 'hero.md'), '# Hero\n')
  git(dir, 'add', '-A')
  git(dir, 'commit', '-qm', 'base')
  return { dir, repo: repoOf(join(dir, 'site')) }
}

// A sync point onto `rev`, its pages as given.
function syncPoint(repo, rev, files, { parent = rev } = {}) {
  const stand = openStandIn(repo, { roots: ['pages', 'site.yml'], rev })
  try {
    for (const [rel, text] of Object.entries(files)) {
      mkdirSync(join(stand.siteDir, rel, '..'), { recursive: true })
      writeFileSync(join(stand.siteDir, rel), text)
    }
    return stand.commit({ parent, subject: 'test', origin: ORIGIN, siteUuid: 'SITE', always: true }).commit
  } finally {
    stand.close()
  }
}

test('a commit a pull made is a sync point of its site and backend — and a rebased copy of it is not', () => {
  const { dir, repo } = project()
  const sp = syncPoint(repo, repo.head, { 'pages/home/hero.md': '# Hero, theirs\n' })
  git(dir, 'merge', '-q', '--no-edit', sp)
  const r = repoOf(join(dir, 'site'))
  assert.equal(historySyncPoint(r, { origin: ORIGIN, siteUuid: 'SITE' }), sp)
  assert.equal(historySyncPoint(r, { origin: 'http://other.test', siteUuid: 'SITE' }), null, 'another backend')
  assert.equal(historySyncPoint(r, { origin: ORIGIN, siteUuid: 'OTHER' }), null, 'another site')
  // The trailers copied onto a commit whose tree is not the backend's: not a sync point.
  const body = git(dir, 'log', '-1', '--format=%B', sp)
  writeFileSync(join(dir, 'site', 'pages', 'home', 'hero.md'), '# Hero, edited after\n')
  git(dir, 'add', '-A')
  git(dir, 'commit', '-q', '-m', body)
  const copy = git(dir, 'rev-parse', 'HEAD').trim()
  assert.notEqual(siteTreeIn(r, copy), siteTreeIn(r, sp))
  assert.equal(historySyncPoint(repoOf(join(dir, 'site')), { origin: ORIGIN, siteUuid: 'SITE' }), sp)
})

test('⛔ a site in a folder its repository ignores is in no repository — that repository can never hold its history', () => {
  const top = mkdtempSync(join(scratch, 'harness-'))
  git(top, 'init', '-q')
  writeFileSync(join(top, '.gitignore'), 'runs/\n')
  git(top, 'add', '-A')
  git(top, 'commit', '-qm', 'harness')
  const siteIn = (...path) => {
    const dir = join(top, ...path)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'site.yml'), 'name: S\n')
    return dir
  }
  const ignored = siteIn('runs', 'p1', 'site')
  assert.equal(repoOf(ignored), null, 'a pull would commit into the harness, whose `git add` refuses the path')
  // CONTROL — the same site where the repository does not ignore it is in it.
  assert.equal(repoOf(siteIn('sites', 'p1', 'site'))?.path, 'sites/p1/site')
  // And one committed there anyway (`git add -f`) is held: the repository tracks it.
  git(top, 'add', '-f', 'runs/p1/site/site.yml')
  git(top, 'commit', '-qm', 'forced')
  assert.equal(repoOf(ignored)?.path, 'runs/p1/site')
})

test('the newest base is one that descends from the others — and none HEAD does not hold', () => {
  const { dir, repo } = project()
  const older = repo.head
  writeFileSync(join(dir, 'README.md'), 'x\n')
  git(dir, 'add', '-A')
  git(dir, 'commit', '-qm', 'later')
  const later = git(dir, 'rev-parse', 'HEAD').trim()
  const r = repoOf(join(dir, 'site'))
  assert.equal(newestBase(r, [older, later]), later)
  assert.equal(newestBase(r, [later, older, null]), later)
  const elsewhere = git(dir, 'commit-tree', 'HEAD^{tree}', '-m', 'not in the history').trim()
  assert.equal(newestBase(r, [older, elsewhere]), older)
  assert.equal(newestBase(r, ['0'.repeat(40), 'not-a-sha']), null)
})

test("⛔ a merge a file not under git would be overwritten by is not made — and a file holding the merge's own version is kept until it is", () => {
  const { dir, repo } = project()
  const sp = syncPoint(repo, repo.head, { 'pages/home/same.md': '# Same\n', 'pages/home/other.md': '# Theirs\n' })
  writeFileSync(join(dir, 'site', 'pages', 'home', 'same.md'), '# Same\n') // what the merge would write
  writeFileSync(join(dir, 'site', 'pages', 'home', 'other.md'), '# Mine\n') // not
  const r = mergeSyncPoint(repoOf(join(dir, 'site')), sp, { message: 'merge' })
  assert.deepEqual(r, { ok: false, reason: 'untracked', paths: ['site/pages/home/other.md'] })
  assert.equal(readFileSync(join(dir, 'site', 'pages', 'home', 'same.md'), 'utf8'), '# Same\n', 'deleted with nothing put back')
  assert.equal(readFileSync(join(dir, 'site', 'pages', 'home', 'other.md'), 'utf8'), '# Mine\n')
  // CONTROL — with the other out of the way, the merge is made, and the same file is the merge's.
  writeFileSync(join(dir, 'site', 'pages', 'home', 'other.md'), '# Theirs\n')
  const again = mergeSyncPoint(repoOf(join(dir, 'site')), sp, { message: 'merge' })
  assert.equal(again.ok, true, JSON.stringify(again))
  assert.equal(git(dir, 'status', '--porcelain').trim(), '')
})

test('⛔ a stand-in links what is not content — and closing it removes no file of the project', () => {
  const { dir, repo } = project()
  mkdirSync(join(dir, 'node_modules', 'pkg'), { recursive: true })
  writeFileSync(join(dir, 'node_modules', 'pkg', 'index.js'), 'export default 1\n')
  mkdirSync(join(dir, 'site', 'dist'), { recursive: true })
  writeFileSync(join(dir, 'site', 'dist', 'built.js'), 'built\n')
  const stand = openStandIn(repo, { roots: ['pages', 'site.yml'], rev: repo.head })
  // The project's own files read through the stand-in…
  assert.equal(readFileSync(join(stand.siteDir, '..', 'node_modules', 'pkg', 'index.js'), 'utf8'), 'export default 1\n')
  assert.equal(readFileSync(join(stand.siteDir, 'dist', 'built.js'), 'utf8'), 'built\n')
  // …the content is the commit's, not the working tree's…
  writeFileSync(join(dir, 'site', 'pages', 'home', 'hero.md'), '# Hero, uncommitted\n')
  assert.equal(readFileSync(join(stand.siteDir, 'pages', 'home', 'hero.md'), 'utf8'), '# Hero\n')
  stand.close()
  // …and closing it took nothing with it.
  assert.equal(readFileSync(join(dir, 'node_modules', 'pkg', 'index.js'), 'utf8'), 'export default 1\n')
  assert.equal(readFileSync(join(dir, 'site', 'dist', 'built.js'), 'utf8'), 'built\n')
  assert.equal(existsSync(stand.siteDir), false)
})

test('⭐ a path leading out of the repository resolves in the stand-in as in the project, as far up as `above` reaches — and closing it removes nothing there', () => {
  const { dir, repo } = project()
  // Another repository beside this one, whose records the site mounts (`paths: records/…: ../../owner-…`).
  const owner = mkdtempSync(join(scratch, 'owner-'))
  mkdirSync(join(owner, 'records', 'crew'), { recursive: true })
  writeFileSync(join(owner, 'records', 'crew', 'ann.yml'), 'name: Ann\n')
  const beside = `../../${basename(owner)}/records/crew/ann.yml`
  // CONTROL — the stand-in of the repository alone: the path leads out of it, to nothing.
  const alone = openStandIn(repo, { roots: ['pages', 'site.yml'], rev: repo.head })
  assert.equal(existsSync(resolve(alone.siteDir, beside)), false)
  alone.close()

  const stand = openStandIn(repo, { roots: ['pages', 'site.yml'], rev: repo.head, above: 1 })
  assert.equal(readFileSync(resolve(stand.siteDir, beside), 'utf8'), 'name: Ann\n')
  // The stand-in still does its own work: the content is the commit's, and a commit of it is made.
  writeFileSync(join(dir, 'site', 'pages', 'home', 'hero.md'), '# Hero, uncommitted\n')
  assert.equal(readFileSync(join(stand.siteDir, 'pages', 'home', 'hero.md'), 'utf8'), '# Hero\n')
  writeFileSync(join(stand.siteDir, 'pages', 'home', 'hero.md'), '# Hero, from the app\n')
  const made = stand.commit({ parent: repo.head, subject: 'test', origin: ORIGIN, siteUuid: 'SITE' })
  assert.equal(git(dir, 'show', `${made.commit}:site/pages/home/hero.md`), '# Hero, from the app\n')
  stand.close()
  assert.equal(readFileSync(join(owner, 'records', 'crew', 'ann.yml'), 'utf8'), 'name: Ann\n')
  assert.equal(existsSync(resolve(stand.siteDir, '..', '..')), false, 'the stand-in is gone, the directories it stood under too')

  // A path that climbs past the repository's parent and comes back down by its name.
  const twice = openStandIn(repo, { roots: ['pages', 'site.yml'], rev: repo.head, above: 2 })
  assert.equal(readFileSync(resolve(twice.siteDir, `../../../${basename(scratch)}/${basename(owner)}/records/crew/ann.yml`), 'utf8'), 'name: Ann\n')
  twice.close()
  assert.equal(readFileSync(join(owner, 'records', 'crew', 'ann.yml'), 'utf8'), 'name: Ann\n')
})

test("⛔ what a stand-in holds where the repository ignores it is not committed — it is placed where the project lacks it, never over a file it has", () => {
  const { dir } = project()
  writeFileSync(join(dir, '.gitignore'), 'site/public/media/\n')
  mkdirSync(join(dir, 'site', 'public'), { recursive: true })
  writeFileSync(join(dir, 'site', 'public', 'robots.txt'), 'User-agent: *\n')
  git(dir, 'add', '-A')
  git(dir, 'commit', '-qm', 'media stay out of git')
  mkdirSync(join(dir, 'site', 'public', 'media'), { recursive: true })
  writeFileSync(join(dir, 'site', 'public', 'media', 'kept.png'), 'mine')
  const repo = repoOf(join(dir, 'site'))
  const stand = openStandIn(repo, { roots: ['pages', 'site.yml', 'public'], rev: repo.head })
  try {
    mkdirSync(join(stand.siteDir, 'public', 'media'), { recursive: true })
    writeFileSync(join(stand.siteDir, 'public', 'media', 'kept.png'), 'theirs')
    writeFileSync(join(stand.siteDir, 'public', 'media', 'new.png'), 'new')
    writeFileSync(join(stand.siteDir, 'pages', 'home', 'hero.md'), '# Hero, theirs\n')
    const made = stand.commit({ parent: repo.head, subject: 'test', origin: ORIGIN, siteUuid: 'SITE' })
    assert.equal(git(dir, 'show', `${made.commit}:site/pages/home/hero.md`), '# Hero, theirs\n')
    assert.throws(() => git(dir, 'cat-file', '-e', `${made.commit}:site/public/media/new.png`), 'an ignored file was committed')
    assert.deepEqual(stand.placeIgnored(), ['public/media/new.png'])
  } finally {
    stand.close()
  }
  assert.equal(readFileSync(join(dir, 'site', 'public', 'media', 'new.png'), 'utf8'), 'new')
  assert.equal(readFileSync(join(dir, 'site', 'public', 'media', 'kept.png'), 'utf8'), 'mine', 'a file the project has was overwritten')
})

test('⛔ a content root the repository ignores whole stops no commit', () => {
  const { dir } = project()
  writeFileSync(join(dir, '.gitignore'), 'site/public/\n')
  git(dir, 'add', '-A')
  git(dir, 'commit', '-qm', 'public stays out of git')
  const repo = repoOf(join(dir, 'site'))
  const stand = openStandIn(repo, { roots: ['pages', 'site.yml', 'public'], rev: repo.head })
  try {
    mkdirSync(join(stand.siteDir, 'public', 'assets'), { recursive: true })
    writeFileSync(join(stand.siteDir, 'public', 'assets', 'a.png'), 'bytes')
    writeFileSync(join(stand.siteDir, 'pages', 'home', 'hero.md'), '# Hero, theirs\n')
    const made = stand.commit({ parent: repo.head, subject: 'test', origin: ORIGIN, siteUuid: 'SITE' })
    assert.ok(made.commit, 'the content beside it was not committed')
    assert.deepEqual(stand.placeIgnored(), ['public/assets/a.png'])
  } finally {
    stand.close()
  }
  assert.equal(readFileSync(join(dir, 'site', 'public', 'assets', 'a.png'), 'utf8'), 'bytes')
})

test('⛔ a content root reached through a link stops the stand-in — a write there would land in the project', () => {
  const { dir, repo } = project()
  const elsewhere = mkdtempSync(join(scratch, 'shared-'))
  mkdirSync(join(elsewhere, 'pages'), { recursive: true })
  symlinkSync(elsewhere, join(dir, 'site', 'content'), 'junction')
  assert.throws(() => openStandIn(repo, { roots: ['content/pages'], rev: repo.head }), /is a link/)
  // Out of the repository: in no commit of it. (`../outside` is the repository's own `outside/`.)
  assert.throws(() => openStandIn(repo, { roots: ['../../outside'], rev: repo.head }), /outside the site's repository/)
})

test('⭐ a root outside the site\'s folder, in its repository, is filled from the base and committed with the rest — a mounted folder', () => {
  const { dir } = project()
  mkdirSync(join(dir, 'docs'), { recursive: true })
  writeFileSync(join(dir, 'docs', 'intro.md'), '# Intro\n')
  git(dir, 'add', '-A')
  git(dir, 'commit', '-qm', 'docs')
  const repo = repoOf(join(dir, 'site'))
  // The working tree holds an edit the base does not: the stand-in must read the base, not it.
  writeFileSync(join(dir, 'docs', 'intro.md'), '# Intro, edited here\n')
  const stand = openStandIn(repo, { roots: ['site.yml', 'pages', '../docs'], rev: repo.head })
  try {
    assert.equal(readFileSync(join(stand.siteDir, '..', 'docs', 'intro.md'), 'utf8'), '# Intro\n')
    writeFileSync(join(stand.siteDir, '..', 'docs', 'intro.md'), '# Intro, from the backend\n')
    assert.deepEqual(stand.changes(), [['M', '../docs/intro.md']])
    const made = stand.commit({ parent: repo.head, subject: 'sync', origin: ORIGIN, siteUuid: 'u-1' })
    assert.equal(git(dir, 'show', `${made.commit}:docs/intro.md`), '# Intro, from the backend\n')
  } finally {
    stand.close()
  }
  // CONTROL — the working tree's own edit is untouched.
  assert.equal(readFileSync(join(dir, 'docs', 'intro.md'), 'utf8'), '# Intro, edited here\n')
})

// A project whose site mounts `docs/`, a folder of its repository outside the site's, with a sync point
// that wrote into it, merged.
function mountedProject() {
  const { dir } = project()
  mkdirSync(join(dir, 'docs'), { recursive: true })
  writeFileSync(join(dir, 'docs', 'intro.md'), '# Intro\n')
  writeFileSync(join(dir, 'docs', 'use.md'), '# Use\n')
  git(dir, 'add', '-A')
  git(dir, 'commit', '-qm', 'docs')
  const repo = repoOf(join(dir, 'site'))
  const roots = ['site.yml', 'pages', '../docs']
  const stand = openStandIn(repo, { roots, rev: repo.head })
  let sp
  try {
    writeFileSync(join(stand.siteDir, '..', 'docs', 'intro.md'), '# Intro, from the backend\n')
    sp = stand.commit({ parent: repo.head, subject: 'sync', origin: ORIGIN, siteUuid: 'SITE' }).commit
  } finally {
    stand.close()
  }
  git(dir, 'merge', '-q', '--no-edit', sp)
  return { dir, sp, roots }
}

test('⭐ a sync point names the tree of each root outside the site\'s folder — and a copy that changed only it is no sync point', () => {
  const { dir, sp } = mountedProject()
  const body = git(dir, 'log', '-1', '--format=%B', sp)
  const mountTree = git(dir, 'rev-parse', `${sp}:docs`).trim()
  assert.ok(body.split('\n').includes(`Uniweb-Root: docs:${mountTree}`), body)
  assert.equal(historySyncPoint(repoOf(join(dir, 'site')), { origin: ORIGIN, siteUuid: 'SITE' }), sp)
  // The trailers copied onto a commit that holds a teammate's edit to the mounted folder, as a rebase
  // leaves one: the site's own tree is as the backend's, the mount's is not.
  writeFileSync(join(dir, 'docs', 'use.md'), '# Use, a teammate\'s edit\n')
  git(dir, 'add', '-A')
  git(dir, 'commit', '-q', '-m', body)
  const copy = git(dir, 'rev-parse', 'HEAD').trim()
  const r = repoOf(join(dir, 'site'))
  assert.equal(siteTreeIn(r, copy), siteTreeIn(r, sp), "CONTROL — the site's own tree is the sync point's")
  assert.equal(historySyncPoint(r, { origin: ORIGIN, siteUuid: 'SITE' }), sp)
})

test('⭐ a merge reaches each root outside the site\'s folder: a file not under git in its way stops it, and what it changes there is listed', () => {
  const { dir, roots } = mountedProject()
  const repo = repoOf(join(dir, 'site'))
  const stand = openStandIn(repo, { roots, rev: repo.head })
  let sp
  try {
    writeFileSync(join(stand.siteDir, '..', 'docs', 'faq.md'), '# FAQ, from the backend\n')
    writeFileSync(join(stand.siteDir, '..', 'docs', 'use.md'), '# Use, from the backend\n')
    sp = stand.commit({ parent: repo.head, subject: 'sync', origin: ORIGIN, siteUuid: 'SITE' }).commit
  } finally {
    stand.close()
  }
  writeFileSync(join(dir, 'docs', 'faq.md'), '# FAQ, mine, not committed\n')
  const stopped = mergeSyncPoint(repo, sp, { message: 'merge', roots })
  assert.equal(stopped.ok, false)
  assert.deepEqual(stopped.paths, ['docs/faq.md'])
  assert.equal(readFileSync(join(dir, 'docs', 'faq.md'), 'utf8'), '# FAQ, mine, not committed\n')

  rmSync(join(dir, 'docs', 'faq.md')) // moved aside, as the pull says to
  const files = snapshotFiles(repo)
  const merged = mergeSyncPoint(repo, sp, { message: 'merge', roots })
  assert.equal(merged.ok, true)
  assert.deepEqual(changedInFiles(repo, { from: repo.head, files, roots }), [['A', '../docs/faq.md'], ['M', '../docs/use.md']])
  // CONTROL — without the roots, the site's folder alone: nothing it changed is there.
  assert.deepEqual(changedInFiles(repo, { from: repo.head, files }), [])
})

test('⭐ committing the roots takes what the files hold there — a rename whole, a new file — and leaves what else is staged staged', () => {
  const { dir, repo } = project()
  mkdirSync(join(dir, 'site', 'pages', '[slug]'), { recursive: true })
  git(dir, 'mv', 'site/pages/home/hero.md', 'site/pages/[slug]/hero.md')
  writeFileSync(join(dir, 'site', 'pages', 'home', 'new.md'), '# New\n')
  writeFileSync(join(dir, 'notes.txt'), 'mine\n')
  git(dir, 'add', 'notes.txt')
  assert.deepEqual(uncommittedPaths(repo, ['pages', 'head.html']).sort(), ['pages/[slug]/hero.md', 'pages/home/hero.md', 'pages/home/new.md'])
  const made = commitRoots(repo, ['pages', 'head.html', 'site.yml'], { message: 'roots' })
  assert.ok(made?.commit, 'nothing was committed')
  assert.deepEqual(git(dir, 'show', '--name-status', '--format=', '--no-renames', 'HEAD').trim().split('\n').sort(), [
    'A\tsite/pages/[slug]/hero.md',
    'A\tsite/pages/home/new.md',
    'D\tsite/pages/home/hero.md'
  ])
  assert.equal(git(dir, 'status', '--porcelain').trim(), 'A  notes.txt')
  assert.deepEqual(uncommittedPaths(repoOf(join(dir, 'site')), ['pages']), [])
  // And with nothing left there, nothing to commit.
  assert.equal(commitRoots(repoOf(join(dir, 'site')), ['pages'], { message: 'again' }), null)
})
