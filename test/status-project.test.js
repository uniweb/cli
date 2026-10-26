/**
 * `uniweb status` says where a site sits in its project — as the wiring says, never as a layout
 * name guessed from folders.
 *
 * [Diego, 2026-10-26] "An agent starting from a project may be expecting the default and may be
 * taken by surprise." The standard project is one site and its foundation; power users keep a
 * test site and several sites on one foundation, and more. So status names the workspace's sites
 * and foundations, the foundation this site is built with and which other sites a change to it
 * reaches, its extensions, the pages it takes from outside its folder — in another repository,
 * or not — and its languages; at a workspace of several sites it says what each one is.
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
const foundationPkg = (name) => JSON.stringify({ name, private: true, main: './_entry.generated.js' })

function write(root, files) {
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(join(root, rel, '..'), { recursive: true })
    writeFileSync(join(root, rel), body)
  }
}

function commit(dir, message) {
  git(dir, ['init', '-q'])
  git(dir, ['config', 'user.email', 'test@example.test'])
  git(dir, ['config', 'user.name', 'Test'])
  git(dir, ['add', '-A'])
  git(dir, ['commit', '-qm', message])
}

/**
 * Three sites: `a` and `b` on one foundation, `a` in three languages with pages mounted from a
 * folder that is its own repository; `c` on a catalog foundation, with an extension.
 */
function workspace() {
  const root = tmp('uw-status-project-')
  write(root, {
    'pnpm-workspace.yaml': 'packages:\n  - foundations/*\n  - sites/*\n',
    'package.json': JSON.stringify({ name: 'w', private: true }),
    '.gitignore': 'external/\n',
    'foundations/shared/package.json': foundationPkg('shared'),
    'foundations/solo/package.json': foundationPkg('@acme/solo'),
    'extensions/fx/package.json': foundationPkg('fx'),
    'sites/a/package.json': JSON.stringify({ name: 'a', dependencies: { shared: 'file:../../foundations/shared' } }),
    'sites/a/site.yml': 'name: A\nfoundation: shared\nlanguages: [en, fr, es]\npaths:\n  pages/docs: ../../external/docs\n',
    'sites/a/pages/home/page.yml': 'title: Home\n',
    'sites/b/package.json': JSON.stringify({ name: 'b', dependencies: { shared: 'file:../../foundations/shared' } }),
    'sites/b/site.yml': 'name: B\nfoundation: shared\n',
    'sites/b/pages/home/page.yml': 'title: Home\n',
    'sites/c/package.json': JSON.stringify({ name: 'c' }),
    'sites/c/site.yml': "name: C\nfoundation: '@acme/solo@1.0.0'\nextensions:\n  - /fx/entry.js\n",
    'sites/c/pages/home/page.yml': 'title: Home\n',
    'external/docs/intro/page.yml': 'title: Intro\n'
  })
  commit(join(root, 'external', 'docs'), 'the docs')
  commit(root, 'the workspace')
  return root
}

async function status(dir, args) {
  const { status: verb } = await import('../src/commands/status.js')
  return runVerb(dir, verb, args, {})
}
const docOf = (run) => JSON.parse(run.output.trim().split('\n').pop())
const checkOf = (doc, id) => doc.checks.find((c) => c.id === id)
const plain = (out) => out.replace(/\x1b\[[0-9;]*m/g, '')

test("⭐ a site's foundation, and the other sites a change to it reaches", { timeout: 60_000 }, async () => {
  const doc = docOf(await status(join(workspace(), 'sites', 'a'), ['--offline', '--json']))
  assert.equal(checkOf(doc, 'project.workspace').summary, '3 sites and 2 foundations in this workspace, from `foundations/*`, `sites/*`.')
  const fnd = checkOf(doc, 'project.foundation')
  assert.equal(fnd.state, 'ok')
  assert.deepEqual(
    { kind: fnd.detail.kind, name: fnd.detail.name, path: fnd.detail.path, editable: fnd.detail.editable, sharedWith: fnd.detail.sharedWith },
    { kind: 'local', name: 'shared', path: 'foundations/shared', editable: true, sharedWith: ['sites/b'] }
  )
  assert.equal(fnd.summary, 'Foundation shared, in foundations/shared/ — its source is here, and another site uses it too: sites/b — a change to a section type changes it as well.')
})

test('⭐ pages from a folder that is its own repository are said, with what that means', { timeout: 60_000 }, async () => {
  const doc = docOf(await status(join(workspace(), 'sites', 'a'), ['--offline', '--json']))
  const mounts = checkOf(doc, 'project.mounts')
  assert.deepEqual(mounts.detail.mounts, [{ segment: 'docs', dir: '../../external/docs', exists: true, repository: 'other' }])
  assert.equal(mounts.summary, 'pages/docs comes from ../../external/docs, its own git repository — edits there are commits in it.')
  assert.match(mounts.lines.join('\n'), /does not come back on a pull, and the next push replaces it with the files/)
})

test('a mounted folder that is not there is said', { timeout: 60_000 }, async () => {
  const root = workspace()
  writeFileSync(join(root, 'sites', 'b', 'site.yml'), 'name: B\nfoundation: shared\npaths:\n  pages/guide: ../../nowhere\n')
  const mounts = checkOf(docOf(await status(join(root, 'sites', 'b'), ['--offline', '--json'])), 'project.mounts')
  assert.equal(mounts.state, 'attention')
  assert.equal(mounts.summary, 'pages/guide names ../../nowhere, which does not exist.')
})

test('the languages: the one the files are written in, and the translations', { timeout: 60_000 }, async () => {
  const doc = docOf(await status(join(workspace(), 'sites', 'a'), ['--offline', '--json']))
  const langs = checkOf(doc, 'project.languages')
  assert.deepEqual(langs.detail, { source: 'en', translations: ['fr', 'es'], wildcard: false })
  assert.match(langs.summary, /^Written in en, and translated into fr, es — a text you change in en needs translating again\.$/)
})

test('a catalog foundation is not editable here; an extension is found where the site finds it', { timeout: 60_000 }, async () => {
  const fnd = checkOf(docOf(await status(join(workspace(), 'sites', 'c'), ['--offline', '--json'])), 'project.foundation')
  assert.equal(fnd.detail.kind, 'catalog')
  assert.equal(fnd.detail.editable, false)
  assert.match(fnd.summary, /^Foundation @acme\/solo@1\.0\.0, from the catalog — its source is not in this workspace/)
  assert.deepEqual(fnd.detail.extensions, [{ value: '/fx/entry.js', kind: 'local', name: 'fx', path: 'extensions/fx' }])
  assert.deepEqual(fnd.lines, ['Extension fx, in extensions/fx/ — its source is here.'])
})

test("in a workspace of several sites, the dev command is this site's", { timeout: 60_000 }, async () => {
  const dev = checkOf(docOf(await status(join(workspace(), 'sites', 'b'), ['--offline', '--json'])), 'dev.server')
  assert.equal(dev.detail.command, 'npx uniweb dev b')
  assert.match(dev.summary, /\(a bare `uniweb dev` starts a\)/)
})

test('⭐ at a workspace of several sites, what each one is — and nothing is asked of a backend', { timeout: 60_000 }, async () => {
  const root = workspace()
  const run = await status(root, ['--json'])
  assert.equal(run.exitCode, 0)
  assert.equal(run.requests, 0, run.urls.join('\n'))
  const doc = docOf(run)
  assert.equal(doc.scope, 'workspace')
  assert.deepEqual(doc.sites.map((s) => s.path), ['sites/a', 'sites/b', 'sites/c'])
  assert.equal(doc.sites[0].summary, 'sites/a — not synced · foundation shared · pages/docs from ../../external/docs, its own repository · 3 languages')
  assert.equal(doc.sites[2].summary, 'sites/c — not synced · foundation @acme/solo@1.0.0, not in this workspace')

  const human = plain((await status(root, [])).output)
  assert.match(human, /3 sites and 2 foundations in this workspace/)
  assert.match(human, /A bare `uniweb dev` starts a\./)
  assert.match(human, /cd sites\/a && npx uniweb status/)
})

test('control: the default project — one site and its foundation — says so, and nothing more', { timeout: 60_000 }, async () => {
  const root = tmp('uw-status-single-')
  write(root, {
    'pnpm-workspace.yaml': 'packages:\n  - src\n  - site\n',
    'package.json': JSON.stringify({ name: 'p', private: true }),
    'src/package.json': foundationPkg('src'),
    'site/package.json': JSON.stringify({ name: 'site', dependencies: { src: 'file:../src' } }),
    'site/site.yml': 'name: P\nfoundation: src\n',
    'site/pages/home/page.yml': 'title: Home\n'
  })
  const doc = docOf(await status(join(root, 'site'), ['--offline', '--json']))
  assert.equal(checkOf(doc, 'project.workspace').summary, 'One site and one foundation in this workspace: site/ and src/.')
  assert.equal(checkOf(doc, 'project.foundation').summary, 'Foundation src, in src/ — its source is here.')
  assert.equal(checkOf(doc, 'project.mounts').state, 'skipped')
  assert.equal(checkOf(doc, 'project.languages').summary, 'One language: en.')
  assert.equal(checkOf(doc, 'dev.server').detail.command, 'npx uniweb dev')
})
