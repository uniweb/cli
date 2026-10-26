/**
 * `uniweb status` says what else in the project is not committed — not only the site's content.
 *
 * [Diego, 2026-10-26: "build both improvements"] After `npx uniweb update`, status said "Nothing
 * to do" over ten uncommitted files: its git check reads what a push sends, the site's content,
 * so a dependency update — or the foundation's source, which a push or publish releases from the
 * files as they are — went unsaid. Now `git.other` names them, relative to the site like every
 * file list, and the next steps ask for a commit. A folder that is a workspace of its own is a
 * project of its own, and is left out.
 *
 * Run: `pnpm test` or `node --test test/`
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmp, runVerb } from './helpers/run-verb.js'

const git = (dir, args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })

function write(root, files) {
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(join(root, rel, '..'), { recursive: true })
    writeFileSync(join(root, rel), body)
  }
}

/** The default project — a site and its foundation — beside a book that is a workspace of its own; all committed. */
function project() {
  const root = tmp('uw-status-git-other-')
  write(root, {
    'pnpm-workspace.yaml': 'packages:\n  - src\n  - site\n',
    'package.json': JSON.stringify({ name: 'p', private: true, devDependencies: { uniweb: '~1.0.0' } }),
    '.gitignore': 'node_modules/\ndist/\n',
    'src/package.json': JSON.stringify({ name: 'src', private: true, main: './_entry.generated.js' }),
    'src/sections/Intro.jsx': 'export default function Intro() { return null }\n',
    'site/package.json': JSON.stringify({ name: 'site', dependencies: { src: 'file:../src' } }),
    'site/site.yml': 'name: P\nfoundation: src\n',
    'site/pages/home/page.yml': 'title: Home\n',
    'book/pnpm-workspace.yaml': 'packages:\n  - site\n',
    'book/package.json': JSON.stringify({ name: 'book', private: true }),
    'book/site/site.yml': 'name: Book\n'
  })
  git(root, ['init', '-q'])
  git(root, ['config', 'user.email', 'test@example.test'])
  git(root, ['config', 'user.name', 'Test'])
  git(root, ['add', '-A'])
  git(root, ['commit', '-qm', 'the project'])
  return root
}

async function status(dir, args) {
  const { status: verb } = await import('../src/commands/status.js')
  return runVerb(dir, verb, args, {})
}
const docOf = (run) => JSON.parse(run.output.trim().split('\n').pop())
const checkOf = (doc, id) => doc.checks.find((c) => c.id === id)
const plain = (out) => out.replace(/\x1b\[[0-9;]*m/g, '')

test('⭐ an update and a foundation change are said, with a commit to make — the nested project is not', { timeout: 60_000 }, async () => {
  const root = project()
  write(root, {
    'package.json': JSON.stringify({ name: 'p', private: true, devDependencies: { uniweb: '~1.1.0' } }), // an update
    'src/sections/Hero.jsx': 'export default function Hero() { return null }\n', // the foundation's source
    'site/deploy.yml': 'default: production\n', // the site's, not its content
    'site/pages/home/page.yml': 'title: Welcome\n', // content: git.uncommitted's
    'book/package.json': JSON.stringify({ name: 'book', private: true, version: '2.0.0' }) // another project's
  })
  const doc = docOf(await status(join(root, 'site'), ['--offline', '--json']))

  const other = checkOf(doc, 'git.other')
  assert.equal(other.state, 'attention')
  assert.deepEqual([...other.files].sort(), ['../package.json', '../src/sections/Hero.jsx', 'deploy.yml'])
  assert.deepEqual(other.blocks, [], 'a push neither sends nor waits for them')
  assert.match(other.summary, /^3 other files here are not committed — a push sends only the site's content/)
  assert.deepEqual(other.lines, ["The foundation's files are among them: when a push or publish releases it, it is built from these files as they are, so commit them first."])

  // The content stays git.uncommitted's, and is not listed twice.
  assert.deepEqual(checkOf(doc, 'git.uncommitted').files, ['pages/home/page.yml'])

  const step = doc.next.find((s) => /commit the 3 other files here/.test(s.why))
  assert.ok(step, JSON.stringify(doc.next))
  assert.equal(step.command, null)
  assert.equal(step.ask, true)

  const human = plain((await status(join(root, 'site'), ['--offline'])).output)
  assert.match(human, /3 other files here are not committed/)
  assert.match(human, /\.\.\/src\/sections\/Hero\.jsx/)
  assert.match(human, /ask the person first — commit the 3 other files here/)
  assert.doesNotMatch(human, /book/)
})

test('a change outside the foundation says nothing about releasing it', { timeout: 60_000 }, async () => {
  const root = project()
  write(root, { 'package.json': JSON.stringify({ name: 'p', private: true, devDependencies: { uniweb: '~1.1.0' } }) })
  const other = checkOf(docOf(await status(join(root, 'site'), ['--offline', '--json'])), 'git.other')
  assert.deepEqual(other.files, ['../package.json'])
  assert.equal(other.summary.startsWith('1 other file here is not committed'), true)
  assert.deepEqual(other.lines, [])
})

test('control: with everything committed, nothing is said and nothing is asked', { timeout: 60_000 }, async () => {
  const root = project()
  const doc = docOf(await status(join(root, 'site'), ['--offline', '--json']))
  assert.equal(checkOf(doc, 'git.other').state, 'ok')
  assert.equal(checkOf(doc, 'git.uncommitted').summary, "The site's content is committed.")
  assert.equal(doc.next.some((s) => /commit/.test(s.why)), false, JSON.stringify(doc.next))
  assert.doesNotMatch(plain((await status(join(root, 'site'), ['--offline'])).output), /other file/)
})
