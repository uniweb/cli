/**
 * Page folders mounted from a repository of their own (`paths: { pages/<segment>: <dir> }`).
 *
 * A push sends a mounted folder as it is on disk, and a pull never writes into one, so nothing
 * else keeps it current: a `git pull` of the site leaves a submodule's checkout where it was,
 * and after a teammate pushes newer docs a pull here takes nothing. These pin what was agreed
 * [Diego, 2026-11-04]: `status` says where each mount stands, `refresh` takes its latest (the
 * tip of the branch it follows: what `.gitmodules` names, else the remote's default branch), and
 * a push or publish stops on one that is not current, with `--mounts-as-is` to send it anyway.
 *
 * Every repository here is real: a bare one for the docs' remote, an author's clone that pushes
 * to it, and the site's repository, which mounts it as a submodule.
 *
 * Run: `pnpm test` or `node --test test/`
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmp, runVerb } from './helpers/run-verb.js'
import { mountedRepositories, takeLatest } from '../src/utils/mounted-repositories.js'
import { mountsBeforeSending } from '../src/backend/mounts-before-sending.js'
import { refresh } from '../src/commands/refresh.js'
import { planNext } from '../src/utils/status-next.js'
import { checkFlags } from '../src/utils/flag-guard.js'

// A submodule from a local path needs git told it may (`protocol.file.allow`, since git 2.38.1),
// and a commit needs a name, whoever runs this. Each test file runs in its own process.
process.env.GIT_CONFIG_COUNT = '1'
process.env.GIT_CONFIG_KEY_0 = 'protocol.file.allow'
process.env.GIT_CONFIG_VALUE_0 = 'always'
process.env.GIT_AUTHOR_NAME = process.env.GIT_COMMITTER_NAME = 'Test'
process.env.GIT_AUTHOR_EMAIL = process.env.GIT_COMMITTER_EMAIL = 'test@example.test'

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()

function write(root, files) {
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(join(root, rel, '..'), { recursive: true })
    writeFileSync(join(root, rel), body)
  }
}

function commitAll(dir, message) {
  git(dir, 'add', '-A')
  git(dir, 'commit', '-qm', message)
  return git(dir, 'rev-parse', 'HEAD')
}

/**
 * The docs' remote and an author's clone of it, with the pages at the top, or in `docs/` beside
 * some code; and the site's repository, mounting them as the submodule `external/docs`, or as a
 * clone the site's repository ignores (`clone: true`).
 */
function fixture({ folder = '', clone = false } = {}) {
  const root = tmp('uw-mounts-')
  const remote = join(root, 'docs.git')
  git(root, 'init', '-q', '--bare', '-b', 'main', remote)
  const author = join(root, 'author')
  git(root, 'clone', '-q', remote, author)
  const pages = folder ? `${folder}/` : ''
  write(author, { [`${pages}intro/page.yml`]: 'title: Intro\n', 'src/tool.js': 'export default 1\n' })
  const first = commitAll(author, 'the docs')
  git(author, 'push', '-q', 'origin', 'HEAD:main')

  const repo = join(root, 'site-repo')
  mkdirSync(repo)
  git(repo, 'init', '-q', '-b', 'main')
  write(repo, {
    'site/site.yml': `name: S\nfoundation: '@a/base'\npaths:\n  pages/docs: ../external/docs${folder ? `/${folder}` : ''}\n`,
    'site/pages/home/page.yml': 'title: Home\n',
    ...(clone ? { '.gitignore': 'external/\n' } : {})
  })
  if (clone) git(root, 'clone', '-q', remote, join(repo, 'external', 'docs'))
  else git(repo, 'submodule', 'add', '-q', remote, 'external/docs')
  commitAll(repo, 'the site')
  return { root, remote, author, repo, siteDir: join(repo, 'site'), docs: join(repo, 'external', 'docs'), first }
}

/** A commit on the docs' remote, as a teammate would push it. */
function landDocs(f, file = `intro/page.yml`, body = 'title: Intro, again\n', branch = 'main') {
  write(f.author, { [file]: body })
  const sha = commitAll(f.author, `more of ${file}`)
  git(f.author, 'push', '-q', 'origin', `HEAD:${branch}`)
  return sha
}

/** A `say` for the gate, keeping what it said. */
function sayInto() {
  const lines = []
  const keep = (m) => lines.push(String(m))
  return { say: { success: keep, info: keep, error: keep, note: keep }, text: () => lines.join('\n') }
}

const gate = (f, args, opts = {}) => {
  const said = sayInto()
  return mountsBeforeSending(f.siteDir, args, { verb: 'publish', dryRun: false, ...opts, say: said.say }).then((stop) => ({ stop, text: said.text() }))
}

async function status(dir, args) {
  const { status: verb } = await import('../src/commands/status.js')
  return runVerb(dir, verb, args, {})
}
const docOf = (run) => JSON.parse(run.output.trim().split('\n').pop())
const checkOf = (doc, id) => doc.checks.find((c) => c.id === id)

test('⭐ a submodule mount, read: its pin, what it follows, the folder it mounts', { timeout: 60_000 }, async () => {
  const f = fixture({ folder: 'docs' })
  const [m] = await mountedRepositories(f.siteDir)
  assert.equal(m.segment, 'docs')
  assert.deepEqual({ path: m.submodule.path, recorded: m.submodule.recorded }, { path: 'external/docs', recorded: f.first })
  assert.equal(m.pin, 'same')
  assert.equal(m.prefix, 'docs')
  assert.equal(m.follows.branch, null, "no branch named in .gitmodules: the remote's default")
  assert.deepEqual(m.edits, [])
})

test('a mount in the site\'s own repository, or in none, is not one of them', { timeout: 60_000 }, async () => {
  const root = tmp('uw-mounts-own-')
  write(root, { 'site/site.yml': "name: S\nfoundation: '@a/base'\npaths:\n  pages/docs: ../docs\n", 'docs/intro/page.yml': 'title: Intro\n' })
  assert.deepEqual(await mountedRepositories(join(root, 'site')), [])
  git(root, 'init', '-q', '-b', 'main')
  commitAll(root, 'all of it')
  assert.deepEqual(await mountedRepositories(join(root, 'site')), [])
})

test('⭐ a publish stops on a mount whose remote has newer commits, naming both ways on', { timeout: 60_000 }, async () => {
  const f = fixture()
  landDocs(f)
  const { stop, text } = await gate(f, ['--non-interactive'])
  assert.deepEqual(stop, { exitCode: 1 })
  assert.match(text, /Not published — a page folder mounted from another repository is not ready to send:/)
  assert.match(text, /pages\/docs ← external\/docs: .*docs\.git has newer commits for it on main\./)
  assert.match(text, /Take the latest with `npx uniweb refresh`, then publish again — or publish it as it is with --mounts-as-is\./)

  const asIs = await gate(f, ['--non-interactive', '--mounts-as-is'])
  assert.equal(asIs.stop, null)
  assert.match(asIs.text, /pages\/docs ← external\/docs: sent as it is \(--mounts-as-is\)\./)
  assert.equal(git(f.docs, 'rev-parse', 'HEAD'), f.first, 'nothing moved')
})

test('a dry run stops where the publish would', { timeout: 60_000 }, async () => {
  const f = fixture()
  landDocs(f)
  const { stop } = await gate(f, ['--non-interactive'], { dryRun: true })
  assert.deepEqual(stop, { exitCode: 1 })
})

test('⭐ --yes takes the latest first, and commits the new pin on its own', { timeout: 60_000 }, async () => {
  const f = fixture()
  const tip = landDocs(f)
  write(f.repo, { 'notes.txt': 'not part of it\n' })
  git(f.repo, 'add', 'notes.txt')
  const { stop, text } = await gate(f, ['--yes'], { verb: 'push' })
  assert.equal(stop, null, text)
  assert.equal(git(f.docs, 'rev-parse', 'HEAD'), tip)
  assert.deepEqual(git(f.repo, 'show', '--name-only', '--format=', 'HEAD').split('\n'), ['external/docs'], 'the pin alone')
  assert.match(git(f.repo, 'log', '-1', '--format=%s'), /^site: pages\/docs from external\/docs at [0-9a-f]{7}, the latest of /)
  assert.equal(git(f.repo, 'diff', '--cached', '--name-only'), 'notes.txt', 'what else was staged stays staged')
  assert.equal((await gate(f, ['--non-interactive'])).stop, null, 'current now')
})

test('⭐ refresh takes each mount to the latest of its branch', { timeout: 60_000 }, async () => {
  const f = fixture()
  const tip = landDocs(f)
  const run = await runVerb(f.siteDir, (args) => refresh(args, { resolveSiteDir: async () => f.siteDir }), ['--no-backend'])
  assert.equal(run.exitCode, 0, run.output)
  assert.match(run.output, /Taking the latest of the page folder mounted from another repository/)
  assert.match(run.output, /pages\/docs ← external\/docs: [0-9a-f]{7} → [0-9a-f]{7} \(1 commit\), committed as [0-9a-f]{7}\./)
  assert.match(run.output, /Checked: mounts/)
  assert.match(run.output, /Up to date\./)
  assert.equal(git(f.docs, 'rev-parse', 'HEAD'), tip)
  assert.equal(git(f.repo, 'ls-tree', 'HEAD', 'external/docs').split(/\s+/)[2], tip, 'the site records it')

  const again = await runVerb(f.siteDir, (args) => refresh(args, { resolveSiteDir: async () => f.siteDir }), ['--no-backend'])
  assert.match(again.output, /pages\/docs ← external\/docs: at the latest of .*docs\.git \(main\)\./)
})

test('refresh --no-mounts and --no-git leave the mounts, and say so', { timeout: 60_000 }, async () => {
  const f = fixture()
  landDocs(f)
  for (const flag of ['--no-mounts', '--no-git']) {
    const run = await runVerb(f.siteDir, (args) => refresh(args, { resolveSiteDir: async () => f.siteDir }), [flag, '--no-backend'])
    assert.match(run.output, new RegExp(`Skipped: mounts \\(${flag}\\)`))
    assert.equal(git(f.docs, 'rev-parse', 'HEAD'), f.first)
  }
})

test('⭐ a checkout behind the pin its repository records — git pull moved it — stops a push, and refresh fixes it', { timeout: 60_000 }, async () => {
  const f = fixture()
  const tip = landDocs(f)
  // A teammate's pin, taken by `git pull`; the checkout stayed.
  git(f.docs, 'fetch', '-q', 'origin')
  git(f.docs, 'checkout', '-q', '--detach', tip)
  commitAll(f.repo, 'a newer pin')
  git(f.docs, 'checkout', '-q', '--detach', f.first)

  const [m] = await mountedRepositories(f.siteDir)
  assert.equal(m.pin, 'behind')
  const { stop, text } = await gate(f, ['--non-interactive'])
  assert.deepEqual(stop, { exitCode: 1 })
  assert.match(text, /checked out at [0-9a-f]{7}, behind the [0-9a-f]{7} this repository records — `git pull` moved it, and the checkout stayed\./)

  const r = await takeLatest(f.siteDir, m)
  assert.equal(r.error, null)
  assert.equal(r.to, tip)
  assert.equal(r.committed, null, 'the pin was already that commit')
  assert.equal((await mountedRepositories(f.siteDir))[0].pin, 'same')
})

test('⭐ uncommitted changes in a mount stop a push, and refresh leaves them', { timeout: 60_000 }, async () => {
  const f = fixture()
  landDocs(f)
  write(f.docs, { 'intro/page.yml': 'title: Mine\n' })
  const { stop, text } = await gate(f, ['--non-interactive'])
  assert.deepEqual(stop, { exitCode: 1 })
  assert.match(text, /1 uncommitted change, which no commit holds\. Commit or discard it there\./)
  assert.match(text, /Settle it as above, then publish again — or publish it as it is with --mounts-as-is\./)

  const run = await runVerb(f.siteDir, (args) => refresh(args, { resolveSiteDir: async () => f.siteDir }), ['--no-backend'])
  assert.match(run.output, /pages\/docs ← external\/docs: left at [0-9a-f]{7}, since it has 1 uncommitted change\./)
  assert.match(run.output, /Up to date, except pages\/docs, as said above\./)
  assert.equal(git(f.docs, 'rev-parse', 'HEAD'), f.first)
})

test('a commit made in the mount stops a push until it is committed here — --commit does it', { timeout: 60_000 }, async () => {
  const f = fixture()
  write(f.docs, { 'intro/page.yml': 'title: Better\n' })
  const made = commitAll(f.docs, 'a better title')
  const refused = await gate(f, ['--non-interactive'], { verb: 'push' })
  assert.deepEqual(refused.stop, { exitCode: 1 })
  assert.match(refused.text, /ahead of the [0-9a-f]{7} this repository records\. Commit it here, or re-run with --commit\./)

  const { stop, text } = await gate(f, ['--non-interactive', '--commit'], { verb: 'push' })
  assert.equal(stop, null, text)
  assert.match(text, new RegExp(`Committed external/docs at ${made.slice(0, 7)}`))
  assert.equal(git(f.repo, 'ls-tree', 'HEAD', 'external/docs').split(/\s+/)[2], made)
})

test('⭐ a commit that leaves the mounted folder as it was is nothing to take', { timeout: 60_000 }, async () => {
  const f = fixture({ folder: 'docs' })
  landDocs(f, 'src/tool.js', 'export default 2\n')
  assert.equal((await gate(f, ['--non-interactive'])).stop, null)
  landDocs(f, 'docs/intro/page.yml', 'title: Intro, again\n')
  assert.deepEqual((await gate(f, ['--non-interactive'])).stop, { exitCode: 1 })
})

test('a remote that does not answer is said, and the folder goes as it is', { timeout: 60_000 }, async () => {
  const f = fixture()
  git(f.docs, 'remote', 'set-url', 'origin', join(f.root, 'nowhere.git'))
  const { stop, text } = await gate(f, ['--non-interactive'])
  assert.equal(stop, null)
  assert.match(text, /did not answer, so whether it has newer commits is unknown\. It goes as it is\./)
})

test('⭐ a submodule follows the branch .gitmodules names for it', { timeout: 60_000 }, async () => {
  const f = fixture()
  git(f.author, 'push', '-q', 'origin', `${f.first}:refs/heads/stable`)
  git(f.repo, 'config', '-f', '.gitmodules', 'submodule.external/docs.branch', 'stable')
  commitAll(f.repo, 'follow stable')
  landDocs(f) // on main: not the branch it follows
  assert.equal((await gate(f, ['--non-interactive'])).stop, null)
  git(f.author, 'checkout', '-q', '-b', 'stable', 'origin/stable')
  const tip = landDocs(f, 'intro/page.yml', 'title: Stable\n', 'stable')
  assert.deepEqual((await gate(f, ['--non-interactive'])).stop, { exitCode: 1 })
  const r = await takeLatest(f.siteDir, (await mountedRepositories(f.siteDir))[0])
  assert.equal(r.to, tip)
  assert.equal(r.branch, 'stable')
})

test('a pin on a branch it is not told to follow is left where it is', { timeout: 60_000 }, async () => {
  const f = fixture()
  git(f.author, 'checkout', '-q', '-b', 'side')
  const side = landDocs(f, 'intro/page.yml', 'title: Side\n', 'side')
  git(f.docs, 'fetch', '-q', 'origin')
  git(f.docs, 'checkout', '-q', '--detach', side)
  commitAll(f.repo, 'pin the side branch')
  git(f.author, 'checkout', '-q', 'main')
  landDocs(f)
  const r = await takeLatest(f.siteDir, (await mountedRepositories(f.siteDir))[0])
  assert.equal(r.kind, 'off-branch')
  assert.equal(git(f.docs, 'rev-parse', 'HEAD'), side)
  const { stop, text } = await gate(f, ['--non-interactive'])
  assert.deepEqual(stop, { exitCode: 1 })
  assert.match(text, /have each moved\. Bring them together there, or name the branch it follows: `git config -f \.gitmodules submodule\.external\/docs\.branch <branch>`\./)
})

test('a clone beside the site, on a branch, is fast-forwarded to its upstream — and nothing is committed here', { timeout: 60_000 }, async () => {
  const f = fixture({ clone: true })
  const head = git(f.repo, 'rev-parse', 'HEAD')
  const tip = landDocs(f)
  const [m] = await mountedRepositories(f.siteDir)
  assert.equal(m.submodule, null)
  assert.equal(m.follows.upstream, true)
  const r = await takeLatest(f.siteDir, m)
  assert.equal(r.to, tip)
  assert.equal(git(f.docs, 'symbolic-ref', '--short', 'HEAD'), 'main', 'still on its branch')
  assert.equal(git(f.repo, 'rev-parse', 'HEAD'), head)
})

test('⭐ status says where a mount stands, and refresh is the next step', { timeout: 60_000 }, async () => {
  const f = fixture()
  const current = checkOf(docOf(await status(f.siteDir, ['--json'])), 'git.mounts')
  assert.equal(current.state, 'ok')
  assert.match(current.summary, /^pages\/docs ← external\/docs is at the latest of .*docs\.git \(main\)\.$/)
  assert.deepEqual(current.blocks, [])

  landDocs(f)
  const doc = docOf(await status(f.siteDir, ['--json']))
  const behind = checkOf(doc, 'git.mounts')
  assert.equal(behind.state, 'attention')
  assert.match(behind.summary, /has newer commits on main\./)
  assert.deepEqual(behind.blocks, ['push', 'publish'])
  assert.ok(doc.next.some((n) => n.command === 'npx uniweb refresh' && /take the latest of pages\/docs ← external\/docs/.test(n.why)), JSON.stringify(doc.next))

  const offline = checkOf(docOf(await status(f.siteDir, ['--offline', '--json'])), 'git.mounts')
  assert.equal(offline.state, 'ok')
  assert.match(offline.summary, /is at [0-9a-f]{7}, the commit this repository records; .* was not asked \(--offline\)\./)
})

test("a moved submodule is the mounts check's to talk about, not the project's other files", { timeout: 60_000 }, async () => {
  const f = fixture()
  const tip = landDocs(f)
  git(f.docs, 'fetch', '-q', 'origin')
  git(f.docs, 'checkout', '-q', '--detach', tip)
  const doc = docOf(await status(f.siteDir, ['--offline', '--json']))
  const other = checkOf(doc, 'git.other')
  assert.ok(!other?.files?.some((p) => p.includes('external/docs')), JSON.stringify(other))
  assert.match(checkOf(doc, 'git.mounts').summary, /ahead of the [0-9a-f]{7} this repository records/)
})

test('two reasons to refresh are one step', () => {
  const next = planNext([
    { step: 'refresh', command: 'npx uniweb refresh', why: "take your teammates' commits" },
    { step: 'refresh', command: 'npx uniweb refresh', why: 'take the latest of pages/docs ← external/docs' }
  ])
  assert.deepEqual(next, [{ command: 'npx uniweb refresh', why: "take your teammates' commits, and take the latest of pages/docs ← external/docs", ask: false }])
})

test('the flags: --mounts-as-is on what sends, --no-mounts on refresh', () => {
  for (const verb of ['push', 'publish', 'sync']) assert.equal(checkFlags(verb, ['--mounts-as-is']), null, verb)
  for (const verb of ['refresh', 'sync']) assert.equal(checkFlags(verb, ['--no-mounts']), null, verb)
  assert.ok(checkFlags('status', ['--mounts-as-is']))
  assert.ok(checkFlags('pull', ['--mounts-as-is']))
})
