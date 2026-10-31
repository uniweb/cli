/**
 * What `create` says for whoever reads it next — a person, or an AI agent.
 *
 *   - Its "Next steps" name AGENTS.md, the project's manual: an agent that creates a
 *     project partway through a conversation does not load the file on its own, since
 *     agents read their instruction files when a session starts.
 *   - Unattended and given no name, it says that an agent building a site for someone
 *     starts with `npx uniweb@latest start`.
 *
 * Each case runs the CLI with HOME pointed at a temp directory holding a fresh
 * update-check cache that names this version as the latest, so `create` proceeds and no
 * request leaves the machine (as in create-outdated.test.js).
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const CLI = join(ROOT, 'src/index.js')
const CURRENT = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version

/** Run the CLI in a fresh cwd, with no terminal. */
function run(args) {
  const home = mkdtempSync(join(tmpdir(), 'uniweb-home-'))
  const cwd = mkdtempSync(join(tmpdir(), 'uniweb-cwd-'))
  mkdirSync(join(home, '.uniweb'))
  writeFileSync(
    join(home, '.uniweb', 'update-check.json'),
    JSON.stringify({ lastCheck: Date.now(), latestVersion: CURRENT })
  )
  const r = spawnSync('node', [CLI, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, HOME: home, CI: 'true' }
  })
  rmSync(home, { recursive: true, force: true })
  // eslint-disable-next-line no-control-regex
  const plain = (s) => (s || '').replace(/\x1b\[[0-9;]*m/g, '')
  return { code: r.status, out: plain(r.stdout), err: plain(r.stderr), cwd }
}

test('unattended, with no name: the usage, and `start` for an agent', () => {
  const r = run(['create'])
  assert.equal(r.code, 1)
  assert.match(r.err, /Missing project name/)
  assert.match(r.out, /Usage: .* create <project-name>/)
  assert.match(r.out, /An AI agent building a site for someone: run npx uniweb@latest start first/)
  rmSync(r.cwd, { recursive: true, force: true })
})

test('a second word is refused, naming the flag it lost, and nothing is written', () => {
  const r = run(['create', 'probe', 'docs'])
  assert.equal(r.code, 1)
  assert.match(r.err, /Unexpected argument: docs/)
  assert.match(r.out, /create probe --template docs/)
  assert.match(r.out, /npm create uniweb@latest probe -- --template docs/)
  assert.ok(!existsSync(join(r.cwd, 'probe')), 'it created a project anyway')
  rmSync(r.cwd, { recursive: true, force: true })

  const here = run(['create', '.', 'docs'])
  assert.equal(here.code, 1)
  assert.match(here.err, /Unexpected argument: docs/)
  rmSync(here.cwd, { recursive: true, force: true })
})

test('a flag and its value are not a second word', () => {
  for (const args of [
    ['create', 'probe', '--template', 'none', '--no-git'],
    ['create', 'probe', '--no-git', '--template', 'none'],
    ['create', '--template', 'none', 'probe', '--no-git'].slice(0, 3).concat('--name', 'probe', '--no-git')
  ]) {
    const r = run(args)
    assert.doesNotMatch(r.err, /Unexpected argument/, args.join(' '))
    rmSync(r.cwd, { recursive: true, force: true })
  }
})

test('Next steps name AGENTS.md, which the project has', () => {
  const r = run(['create', 'probe', '--template', 'none', '--no-git'])
  assert.equal(r.code, 0, r.err)
  const next = r.out.slice(r.out.indexOf('Next steps:'))
  assert.match(next, /AGENTS\.md is the project's manual, for you and for AI agents: its Part 0 says where to begin/)
  assert.ok(existsSync(join(r.cwd, 'probe', 'AGENTS.md')), 'the manual the steps name is not there')
  rmSync(r.cwd, { recursive: true, force: true })
})
