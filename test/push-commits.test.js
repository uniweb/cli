/**
 * In a repository, a push sends what is committed — and commits what it writes back.
 *
 * ⭐ The commit a push is made from is where the next pull merges from — this copy's, and
 * every copy the backend names it to (`x-uniweb-source`) — so what the push sends must be
 * what that commit holds (`uncommittedContent`, backend/site-sync.js). `--commit` commits
 * the site's content first. What the push then writes into the files — the ids the backend
 * gave it, `sync.json` — it commits itself, as uniweb's (`commitWriteBacks`).
 *
 * ⛔ Until 2026-10-18 a push sent uncommitted edits on top of HEAD and recorded HEAD.
 * Measured against a real backend: an edit pushed that way and undone before the next pull
 * came back with it — exit 0, no conflict, reported as the backend's change.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { tmp, runVerb } from './helpers/run-verb.js'

const A = 'http://dev.test'

// ⛔ Git, hermetic: no global or system config reaches these repositories.
const scratch = tmp('uw-commits-git-')
process.env.GIT_CONFIG_GLOBAL = join(scratch, 'gitconfig')
writeFileSync(process.env.GIT_CONFIG_GLOBAL, '[user]\n\tname = t\n\temail = t@t\n')
process.env.GIT_CONFIG_NOSYSTEM = '1'

// A backend that creates the site a push sends, and keeps the source each request names.
function backend() {
  const sent = []
  const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
  return {
    sent,
    opts: {
      session: { version: 2, current: A, sessions: { [A]: { token: 't' } } },
      env: { UNIWEB_WORKSPACE: 'personal' },
      respond: (url, init) => {
        if (url.endsWith('/dev/config')) return json({})
        if (url.includes('/dev/site/content')) {
          const h = init?.headers || {}
          sent.push({ url, source: (typeof h.get === 'function' ? h.get('x-uniweb-source') : h['x-uniweb-source']) ?? null })
          return json({ siteContentUuid: 'SITE-1', report: { finalized: [{ index: 0, uuid: 'SITE-1', changed: true, version: 'V1' }] } })
        }
      }
    }
  }
}

// A project with one site, committed — or, with `git: false`, outside any repository.
function project({ git: inGit = true } = {}) {
  const ws = tmp('uw-commits-')
  const site = join(ws, 'site')
  mkdirSync(join(site, 'pages', 'home'), { recursive: true })
  writeFileSync(join(ws, '.gitignore'), '.uniweb\nnode_modules\n')
  writeFileSync(join(site, 'site.yml'), "name: T\nfoundation: '@a/base@1.0.0'\n")
  writeFileSync(join(site, 'package.json'), JSON.stringify({ name: 't', dependencies: { uniweb: '*' } }))
  writeFileSync(join(site, 'pages', 'home', 'hero.md'), '# Hello\n\nWelcome.\n')
  const git = (...a) => execFileSync('git', a, { cwd: ws, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  if (inGit) {
    git('init', '-q')
    git('add', '-A')
    git('commit', '-qm', 'create')
  }
  return { ws, site, git }
}

const EDITED = '# Hello\n\nWelcome, edited.\n'

test('⛔ a push with the site not committed reaches the backend for nothing — `--force` and a dry run included — and names each file', { timeout: 60_000 }, async () => {
  const { push } = await import('../src/commands/push.js')
  const { site } = project()
  writeFileSync(join(site, 'pages', 'home', 'hero.md'), EDITED)
  writeFileSync(join(site, 'pages', 'home', 'more.md'), '# More\n')
  for (const args of [[], ['--force'], ['--dry-run']]) {
    const res = await runVerb(site, push, args, backend().opts)
    assert.equal(res.exitCode, 1, `${args.join(' ')}: ${res.output}`)
    assert.match(res.output, /Not pushed — 2 file\(s\) of the site are not committed/)
    assert.match(res.output, /pages\/home\/hero\.md/)
    assert.match(res.output, /pages\/home\/more\.md/)
    assert.match(res.output, /re-run with --commit/)
    assert.equal(res.requests, 0, `${args.join(' ')} reached the backend:\n${res.urls.join('\n')}`)
  }
})

test('⛔ so does a publish', { timeout: 60_000 }, async () => {
  const { publish } = await import('../src/commands/publish.js')
  const { site } = project()
  writeFileSync(join(site, 'pages', 'home', 'hero.md'), EDITED)
  const res = await runVerb(site, publish, [], backend().opts)
  assert.equal(res.exitCode, 1, res.output)
  assert.match(res.output, /Not published — 1 file\(s\) of the site are not committed/)
  assert.equal(res.requests, 0, res.urls.join('\n'))
})

test('⭐ `--commit -m` commits the site — and nothing else that is staged — then pushes from that commit', { timeout: 60_000 }, async () => {
  const { push } = await import('../src/commands/push.js')
  const { ws, site, git } = project()
  writeFileSync(join(site, 'pages', 'home', 'hero.md'), EDITED)
  writeFileSync(join(ws, 'notes.txt'), 'mine\n')
  git('add', 'notes.txt') // staged, and not the site's
  const be = backend()
  const res = await runVerb(site, push, ['--commit', '-m', 'Edit the hero'], be.opts)
  assert.equal(res.exitCode, 0, res.output)
  const commit = git('log', '--format=%H %s').split('\n').find((l) => l.endsWith(' Edit the hero'))?.split(' ')[0]
  assert.ok(commit, `no commit "Edit the hero":\n${git('log', '--format=%h %s')}`)
  assert.equal(git('log', '-1', '--format=%an', commit), 't', "the person's own commit")
  assert.deepEqual(git('show', '--name-only', '--format=', commit).split('\n'), ['site/pages/home/hero.md'])
  assert.match(git('status', '--porcelain'), /^A {2}notes\.txt$/m, 'what else was staged stays staged')
  assert.ok(be.sent.length > 0, res.output)
  assert.ok(be.sent.every((s) => s.source === commit), `the push named another commit: ${JSON.stringify(be.sent)}`)
})

test('a repository with no commit yet is refused and said so — and `--commit` makes the first commit and pushes from it', { timeout: 60_000 }, async () => {
  const { push } = await import('../src/commands/push.js')
  const { site, git } = project({ git: false })
  git('init', '-q') // no commit: every file untracked
  const refused = await runVerb(site, push, [], backend().opts)
  assert.equal(refused.exitCode, 1, refused.output)
  assert.match(refused.output, /Not pushed — this repository has no commit yet/)
  assert.match(refused.output, /to make that first commit/)
  assert.equal(refused.requests, 0, refused.urls.join('\n'))
  const be = backend()
  const res = await runVerb(site, push, ['--commit', '-m', 'The site'], be.opts)
  assert.equal(res.exitCode, 0, res.output)
  const first = git('rev-list', '--max-parents=0', 'HEAD')
  assert.equal(git('log', '-1', '--format=%s', first), 'The site')
  assert.ok(be.sent.length > 0 && be.sent.every((s) => s.source === first), JSON.stringify(be.sent))
})

test('`--commit` on a dry run only says it would', { timeout: 60_000 }, async () => {
  const { push } = await import('../src/commands/push.js')
  const { site, git } = project()
  writeFileSync(join(site, 'pages', 'home', 'hero.md'), EDITED)
  const head = git('rev-parse', 'HEAD')
  const res = await runVerb(site, push, ['--commit', '--dry-run'], backend().opts)
  assert.equal(res.exitCode, 0, res.output)
  assert.match(res.output, /Dry run — would commit 1 file\(s\) of the site first/)
  assert.equal(git('rev-parse', 'HEAD'), head)
  assert.match(git('status', '--porcelain'), /hero\.md/)
})

test('`-o` writes what the files hold, committed or not — it sends nothing', { timeout: 60_000 }, async () => {
  const { push } = await import('../src/commands/push.js')
  const { ws, site } = project()
  writeFileSync(join(site, 'pages', 'home', 'hero.md'), EDITED)
  const res = await runVerb(site, push, ['-o', join(ws, 'out.uwx')], backend().opts)
  assert.equal(res.exitCode, 0, res.output)
  assert.ok(existsSync(join(ws, 'out.site-content.uwx')), res.output)
  assert.equal(res.requests, 0, res.urls.join('\n'))
})

test('CONTROL — outside git nothing is kept to merge from, and the push goes on', { timeout: 60_000 }, async () => {
  const { push } = await import('../src/commands/push.js')
  const { site } = project({ git: false })
  writeFileSync(join(site, 'pages', 'home', 'hero.md'), EDITED)
  const be = backend()
  const res = await runVerb(site, push, [], be.opts)
  assert.equal(res.exitCode, 0, res.output)
  assert.doesNotMatch(res.output, /not committed/)
  assert.ok(be.sent.length > 0 && be.sent.every((s) => s.source === null), JSON.stringify(be.sent))
})

test("⭐ what a push writes into the files it commits as uniweb's — and that commit is where the next pull merges from", { timeout: 60_000 }, async () => {
  const { push } = await import('../src/commands/push.js')
  const { readSyncPoint } = await import('../src/utils/sync-point.js')
  const { site, git } = project()
  const pushedFrom = git('rev-parse', 'HEAD')
  const be = backend()
  const res = await runVerb(site, push, [], be.opts)
  assert.equal(res.exitCode, 0, res.output)
  assert.equal(git('status', '--porcelain'), '', `the push left what it wrote uncommitted:\n${git('status', '--porcelain')}`)
  assert.equal(git('log', '-1', '--format=%an %s'), `uniweb Record what ${A} gave the site`)
  // Marked, so a pull reads the commit a lane names through it (`recordedAfter`).
  assert.match(git('log', '-1', '--format=%B'), new RegExp(`^Uniweb-Recorded: ${A} SITE-1$`, 'm'))
  assert.ok(git('show', '--name-only', '--format=', 'HEAD').split('\n').includes('site/sync.json'))
  assert.equal(git('rev-parse', 'HEAD^'), pushedFrom)
  assert.ok(be.sent.every((s) => s.source === pushedFrom), JSON.stringify(be.sent))
  assert.equal(readSyncPoint(site, A), git('rev-parse', 'HEAD'))
  assert.match(res.output, /Committed what the backend gave the site — 1 file\(s\)/)
})
