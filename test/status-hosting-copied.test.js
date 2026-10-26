/**
 * What `uniweb status` says about hosting for a project copied out of its own repository.
 *
 * [Diego, 2026-10-26] "Some sites may have originally been published to GitHub pages and now are
 * in Uniweb Cloud. I noticed that some are carrying a `.github` folder that may no longer be
 * needed." Measured the same day on such a project: status opened with "deployed to GitHub
 * Pages" for a target that had never deployed from that copy, and said nothing of the GitHub
 * Pages workflow beside it — which GitHub never runs, since it runs only the repository's
 * top-level workflows.
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

const WORKFLOW = 'name: Deploy\non:\n  push:\n    branches: [main, master]\njobs: {}\n'

/** A repository of projects, one copied in with its own `.github/` and a GitHub Pages target. */
function agency({ deployYml, workflowAtTop = false } = {}) {
  const root = tmp('uw-status-copied-')
  write(root, {
    'README.md': '# Projects\n',
    'client/pnpm-workspace.yaml': 'packages:\n  - src\n  - site\n',
    'client/package.json': JSON.stringify({ name: 'client', private: true }),
    'client/.github/workflows/deploy-github-pages.yml': WORKFLOW,
    'client/src/package.json': JSON.stringify({ name: 'src', private: true, main: './_entry.generated.js' }),
    'client/site/package.json': JSON.stringify({ name: 'site', dependencies: { src: 'file:../src' } }),
    'client/site/site.yml': 'name: Client\nfoundation: src\n',
    'client/site/pages/home/page.yml': 'title: Home\n',
    'client/site/deploy.yml':
      deployYml ?? 'default: github-pages\ntargets:\n  github-pages:\n    host: github-pages\n  uniweb.app:\n    host: uniweb\n',
    ...(workflowAtTop ? { '.github/workflows/deploy-github-pages.yml': WORKFLOW.replace('jobs: {}', 'jobs: {} # client/site/dist') } : {})
  })
  git(root, ['init', '-q'])
  git(root, ['config', 'user.email', 'test@example.test'])
  git(root, ['config', 'user.name', 'Test'])
  git(root, ['add', '-A'])
  git(root, ['commit', '-qm', 'the projects'])
  return root
}

async function status(dir, args) {
  const { status: verb } = await import('../src/commands/status.js')
  return runVerb(dir, verb, args, {})
}
const docOf = (run) => JSON.parse(run.output.trim().split('\n').pop())
const checkOf = (doc, id) => doc.checks.find((c) => c.id === id)

test('⭐ a target never deployed from this copy is named as one, and the summary does not call it deployed', { timeout: 60_000 }, async () => {
  const doc = docOf(await status(join(agency(), 'client', 'site'), ['--offline', '--json']))
  assert.equal(doc.summary, 'Client — not synced with a backend · not hosted anywhere yet')
  const deploys = checkOf(doc, 'hosting.deploys')
  assert.equal(deploys.state, 'attention')
  assert.equal(deploys.summary, 'deploy.yml names GitHub Pages, never deployed from this copy.')
  assert.equal(deploys.detail.targets[0].deployed, false)
  assert.match(deploys.lines.join('\n'), /the one a bare `uniweb deploy` uses: never deployed from this copy/)
  assert.match(deploys.lines.join('\n'), /when it left, remove the target from deploy\.yml, and `default:` when it names it/)
})

test("⭐ a project's own workflows, below the repository's top, are said never to run", { timeout: 60_000 }, async () => {
  const doc = docOf(await status(join(agency(), 'client', 'site'), ['--offline', '--json']))
  const workflows = checkOf(doc, 'hosting.workflows')
  assert.equal(workflows.state, 'attention')
  assert.deepEqual(workflows.files, ['../.github/workflows/deploy-github-pages.yml'])
  assert.equal(workflows.summary, '1 workflow here never runs: GitHub runs workflows only from the top of the repository, ../../.github/workflows.')
  // ⛔ Not read as CI: the target stays never deployed.
  assert.equal(checkOf(doc, 'hosting.deploys').detail.targets[0].ci, null)
})

test('a target with a receipt is deployed, and says so', { timeout: 60_000 }, async () => {
  const deployYml =
    'default: github-pages\ntargets:\n  github-pages:\n    host: github-pages\ndeploys:\n  github-pages:\n    at: 2026-10-20T00:00:00.000Z\n    host: github-pages\n'
  const doc = docOf(await status(join(agency({ deployYml }), 'client', 'site'), ['--offline', '--json']))
  assert.equal(checkOf(doc, 'hosting.deploys').summary, 'Also deployed to GitHub Pages.')
  assert.equal(doc.summary, 'Client — not synced with a backend · deployed to GitHub Pages')
})

test("control: the repository's own top-level workflow is CI, and the project's copy is still said", { timeout: 60_000 }, async () => {
  const doc = docOf(await status(join(agency({ workflowAtTop: true }), 'client', 'site'), ['--offline', '--json']))
  const [pages] = checkOf(doc, 'hosting.deploys').detail.targets
  assert.deepEqual(pages.ci, { file: '.github/workflows/deploy-github-pages.yml', branches: ['main', 'master'] })
  assert.equal(pages.deployed, true)
  assert.deepEqual(checkOf(doc, 'hosting.workflows').files, ['../.github/workflows/deploy-github-pages.yml'])
})

test('control: a site at the top of its repository has no workflow below the top', { timeout: 60_000 }, async () => {
  const root = tmp('uw-status-top-')
  write(root, {
    'package.json': JSON.stringify({ name: 'site', private: true }),
    'site.yml': 'name: Top\nfoundation: src\n',
    'pages/home/page.yml': 'title: Home\n',
    '.github/workflows/deploy-github-pages.yml': WORKFLOW
  })
  git(root, ['init', '-q'])
  git(root, ['config', 'user.email', 'test@example.test'])
  git(root, ['config', 'user.name', 'Test'])
  git(root, ['add', '-A'])
  git(root, ['commit', '-qm', 'a site'])
  assert.equal(checkOf(docOf(await status(root, ['--offline', '--json'])), 'hosting.workflows').state, 'ok')
})
