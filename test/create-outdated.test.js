/**
 * A global CLI that a newer release has replaced does not start a project.
 *
 * A project starts on the packages and templates of the CLI that creates it, and
 * outside a project a global install runs `create` and `clone` itself. So when
 * the registry knows a newer release, both stop before anything is written and
 * name the two ways on. Measured 2026-10-08: `npx uniweb create` ran a global
 * 0.12.28, which offered the ten templates it knew while sixteen shipped.
 *
 * Each case runs the CLI with HOME pointed at a temp directory holding a fresh
 * update-check cache, so the "latest release" is decided here and no request
 * leaves the machine. Run from its source path, the CLI counts as a global
 * install (no node_modules segment) — the case under test.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isBehind, shellJoin } from '../src/utils/update-check.js'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const CLI = join(ROOT, 'src/index.js')
const CURRENT = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version

/** Run the CLI in a fresh cwd, with a HOME whose cache says `latest` is the newest release. */
function run(args, latest) {
  const home = mkdtempSync(join(tmpdir(), 'uniweb-home-'))
  const cwd = mkdtempSync(join(tmpdir(), 'uniweb-cwd-'))
  mkdirSync(join(home, '.uniweb'))
  writeFileSync(
    join(home, '.uniweb', 'update-check.json'),
    JSON.stringify({ lastCheck: Date.now(), latestVersion: latest })
  )
  const r = spawnSync('node', [CLI, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, HOME: home, CI: 'true' }
  })
  const result = { code: r.status, out: r.stdout, err: r.stderr, cwd }
  rmSync(home, { recursive: true, force: true })
  return result
}

test('create stops when a newer release is published, and writes nothing', () => {
  const r = run(['create', 'probe', '--template', 'none', '--no-git'], '999.0.0')
  assert.equal(r.code, 1)
  assert.match(r.err, new RegExp(`This uniweb is ${CURRENT.replace(/\./g, '\\.')}; the latest release is 999\\.0\\.0`))
  assert.match(r.err, /npx uniweb@latest create probe --template none --no-git/)
  assert.match(r.err, /uniweb@latest/)
  assert.ok(!existsSync(join(r.cwd, 'probe')), 'a refused create wrote the project')
  rmSync(r.cwd, { recursive: true, force: true })
})

test('clone stops the same way, before it reaches any backend', () => {
  const r = run(['clone', 'some-site-uuid'], '999.0.0')
  assert.equal(r.code, 1)
  assert.match(r.err, /npx uniweb@latest clone some-site-uuid/)
  rmSync(r.cwd, { recursive: true, force: true })
})

test('control: --help still prints while behind', () => {
  const r = run(['create', '--help'], '999.0.0')
  assert.equal(r.code, 0)
  assert.match(r.out, /uniweb create/)
  rmSync(r.cwd, { recursive: true, force: true })
})

test('control: a current CLI creates the project', () => {
  const r = run(['create', 'probe', '--template', 'none', '--no-git'], CURRENT)
  assert.equal(r.code, 0, r.err)
  assert.ok(existsSync(join(r.cwd, 'probe', 'package.json')), 'the project was not created')
  rmSync(r.cwd, { recursive: true, force: true })
})

test('isBehind: only a newer published release, and never an unknown one', () => {
  assert.equal(isBehind('0.87.4', '0.87.5'), true)
  assert.equal(isBehind('0.87.4', '0.88.0'), true)
  assert.equal(isBehind('0.87.4', '0.87.4'), false)
  assert.equal(isBehind('0.87.5', '0.87.4'), false, 'a build ahead of npm is not behind')
  assert.equal(isBehind('0.87.4', null), false, 'offline proceeds')
})

test('shellJoin repeats the arguments as they must be typed', () => {
  assert.equal(shellJoin(['create', 'my-site', '--template', 'paste']), 'create my-site --template paste')
  assert.equal(shellJoin(['create', '--name=My Site']), "create '--name=My Site'")
  assert.equal(shellJoin(["it's"]), "'it'\\''s'")
})
