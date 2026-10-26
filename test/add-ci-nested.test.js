/**
 * `uniweb add ci` in a project that is a folder of a larger repository: refused, and nothing written.
 *
 * GitHub runs workflows only from the top of a repository, and `add ci` writes into the project's
 * own `.github/` — where, in such a project, it would never run. [Diego, 2026-10-26: "refuse for
 * now."] Measured the same day on a repository of client projects, one of which carried a GitHub
 * Pages workflow from its old repository that had not run since it moved.
 *
 * Run: `pnpm test` or `node --test test/`
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmp } from './helpers/run-verb.js'

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'index.js')
const git = (dir, args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })

function write(root, files) {
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(join(root, rel, '..'), { recursive: true })
    writeFileSync(join(root, rel), body)
  }
}

/** A default project (a site and its foundation) at `prefix` inside a new repository. */
function repoWithProject(prefix) {
  const top = tmp('uw-add-ci-')
  const at = (rel) => (prefix ? `${prefix}/${rel}` : rel)
  write(top, {
    [at('pnpm-workspace.yaml')]: 'packages:\n  - src\n  - site\n',
    [at('package.json')]: JSON.stringify({ name: 'p', private: true }),
    [at('src/package.json')]: JSON.stringify({ name: 'src', private: true, main: './_entry.generated.js' }),
    [at('site/package.json')]: JSON.stringify({ name: 'site', dependencies: { src: 'file:../src' } }),
    [at('site/site.yml')]: 'name: P\nfoundation: src\n',
    [at('site/pages/home/page.yml')]: 'title: Home\n'
  })
  git(top, ['init', '-q'])
  return { top, project: prefix ? join(top, prefix) : top }
}

const run = (cwd) =>
  spawnSync(process.execPath, [CLI, 'add', 'ci', '--host=github-pages'], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, HOME: tmp('uw-add-ci-home-'), CI: '1', NO_COLOR: '1' },
    timeout: 60_000
  })
const plain = (s) => (s || '').replace(/\x1b\[[0-9;]*m/g, '')

test('⭐ a project inside a larger repository gets no workflow, and is told where GitHub runs them', { timeout: 90_000 }, () => {
  const { top, project } = repoWithProject('client')
  const r = run(project)
  const out = plain(r.stdout) + plain(r.stderr)
  assert.equal(r.status, 1, out)
  assert.match(out, /Not added: this project is the folder client of the repository at /)
  assert.match(out, /GitHub runs workflows only from the top of a repository \(\.\.\/\.github\/workflows\/\)/)
  assert.equal(existsSync(join(project, '.github')), false, 'nothing written in the project')
  assert.equal(existsSync(join(top, '.github')), false, 'nor at the top')
})

test('control: a project at the top of its repository is not refused', { timeout: 90_000 }, () => {
  const { project } = repoWithProject('')
  const r = run(project)
  assert.doesNotMatch(plain(r.stdout) + plain(r.stderr), /Not added: this project is the folder/)
})
