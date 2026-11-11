/**
 * Every command that tells someone to install a project tells them the same thing (`pmToInstall`,
 * `src/utils/pm.js`): the package manager the workspace's lockfile names; with none yet, pnpm where
 * it is installed, else the one that ran the CLI.
 *
 * ⛔ Until 2026-11-11 `uniweb start` said `npm install` before a project existed, while the `create`
 * it sends you to said `pnpm install` wherever pnpm is installed: an agent building a site was told
 * both in one session.
 *
 * Run: `pnpm test` or `node --test test/`
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pmToInstall } from '../src/utils/pm.js'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const CLI = join(ROOT, 'src/index.js')
const CURRENT = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version

// A PATH with a `pnpm` on it, and one with none. Nothing else these commands run needs the PATH:
// node is run by its own path, and `create` is given `--no-git`.
const BIN = mkdtempSync(join(tmpdir(), 'uniweb-fake-pnpm-'))
writeFileSync(join(BIN, 'pnpm'), '#!/bin/sh\necho 10.30.0\n')
chmodSync(join(BIN, 'pnpm'), 0o755)
const WITH_PNPM = `${BIN}:/usr/bin:/bin`
const WITHOUT_PNPM = '/usr/bin:/bin'
// What `npx` says ran the CLI.
const NPX = 'npm/10.9.0 node/v22.12.0 darwin arm64 workspaces/false'

/** Run the CLI with no terminal, the PATH given, and an update check that asks no one. */
function run(args, { path, cwd }) {
  const home = mkdtempSync(join(tmpdir(), 'uniweb-home-'))
  mkdirSync(join(home, '.uniweb'))
  writeFileSync(
    join(home, '.uniweb', 'update-check.json'),
    JSON.stringify({ lastCheck: Date.now(), latestVersion: CURRENT })
  )
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, PATH: path, HOME: home, CI: 'true', npm_config_user_agent: NPX }
  })
  rmSync(home, { recursive: true, force: true })
  // eslint-disable-next-line no-control-regex
  const plain = (s) => (s || '').replace(/\x1b\[[0-9;]*m/g, '')
  return { code: r.status, out: plain(r.stdout), err: plain(r.stderr) }
}

/** Each install command a text names, once. */
const installs = (text) => [...new Set(text.match(/\b(?:pnpm|npm|yarn) install\b/g) || [])]

for (const [situation, path, line] of [
  ['with pnpm installed', WITH_PNPM, 'pnpm install'],
  ['without pnpm', WITHOUT_PNPM, 'npm install']
]) {
  test(`start, then the create it sends you to, name one install — ${situation}`, () => {
    const cwd = mkdtempSync(join(tmpdir(), 'uniweb-cwd-'))
    try {
      const start = run(['start'], { path, cwd })
      assert.equal(start.code, 0, start.err)
      assert.deepEqual(installs(start.out), [line], start.out)

      const create = run(['create', 'probe', '--no-git'], { path, cwd })
      assert.equal(create.code, 0, create.err)
      assert.deepEqual(installs(create.out.slice(create.out.indexOf('Next steps:'))), [line], create.out)

      // Then, in the project made: no lockfile yet, so the same line again.
      const inside = run(['start'], { path, cwd: join(cwd, 'probe') })
      assert.deepEqual(installs(inside.out), [line], inside.out)
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })
}

test("once a project is installed, its lockfile decides, whatever else is installed", () => {
  const cwd = mkdtempSync(join(tmpdir(), 'uniweb-cwd-'))
  try {
    assert.equal(run(['create', 'probe', '--no-git'], { path: WITHOUT_PNPM, cwd }).code, 0)
    writeFileSync(join(cwd, 'probe', 'package-lock.json'), '{}\n')
    const start = run(['start'], { path: WITH_PNPM, cwd: join(cwd, 'probe') })
    assert.deepEqual(installs(start.out), ['npm install'], start.out)
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('the rule: the lockfile, else pnpm where it is installed, else what ran the CLI', () => {
  const saved = { PATH: process.env.PATH, agent: process.env.npm_config_user_agent }
  const dir = (lock) => {
    const d = mkdtempSync(join(tmpdir(), 'uniweb-pm-'))
    if (lock) writeFileSync(join(d, lock), '')
    return d
  }
  try {
    process.env.PATH = WITH_PNPM
    process.env.npm_config_user_agent = NPX
    assert.equal(pmToInstall(dir('pnpm-lock.yaml')), 'pnpm')
    assert.equal(pmToInstall(dir('package-lock.json')), 'npm')
    assert.equal(pmToInstall(dir('yarn.lock')), 'yarn')
    assert.equal(pmToInstall(dir(null)), 'pnpm')
    assert.equal(pmToInstall(null), 'pnpm')

    process.env.PATH = WITHOUT_PNPM
    assert.equal(pmToInstall(dir(null)), 'npm')
    process.env.npm_config_user_agent = 'pnpm/10.30.0 npm/? node/v22.12.0'
    assert.equal(pmToInstall(dir(null)), 'pnpm', 'pnpm dlx ran it')
  } finally {
    process.env.PATH = saved.PATH
    if (saved.agent === undefined) delete process.env.npm_config_user_agent
    else process.env.npm_config_user_agent = saved.agent
  }
})
