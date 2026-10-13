/**
 * What `uniweb update` says about AGENTS.md when the deps lag, and how it sums up a breaking crossing.
 *
 * ⛔ Until 2026-10-13 a dry run on a lagging project said "AGENTS.md refresh skipped … Re-run
 * without --no-deps" — with no `--no-deps` passed. A dry run moves no deps, so they still lag
 * when the AGENTS.md step looks, while the run it previews aligns and installs them first. The
 * same hint named `--no-deps` under `--agents-only`, and after a declined or non-interactive
 * deps step. And the breaking summary sent people to changelogs most packages do not keep.
 *
 * Each case runs the CLI in a fresh workspace whose deps lag the CLI's table, with HOME pointed
 * at a temp directory whose update-check cache names this CLI as the latest, so no request
 * leaves the machine (the pattern of `create-outdated.test.js`).
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const CLI = join(ROOT, 'src/index.js')
const CURRENT = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version

const FILES = {
  'package.json': JSON.stringify({ name: 'demo', private: true, devDependencies: { uniweb: '~0.1.0' } }),
  'pnpm-workspace.yaml': 'packages:\n  - src\n  - site\n',
  'src/package.json': JSON.stringify({ name: 'src', private: true, dependencies: { '@uniweb/core': '~0.1.0' } }),
  'site/package.json': JSON.stringify({ name: 'site', private: true, dependencies: { '@uniweb/runtime': '~0.1.0' } }),
  'AGENTS.md': '<!-- uniweb-agents v0.1.0 -->\n# An old AGENTS.md\n',
}

/** Run `uniweb update <args>` in a fresh lagging workspace; report its output and whether it wrote. */
function run(args) {
  const home = mkdtempSync(join(tmpdir(), 'uniweb-home-'))
  const cwd = mkdtempSync(join(tmpdir(), 'uniweb-update-'))
  mkdirSync(join(home, '.uniweb'))
  writeFileSync(
    join(home, '.uniweb', 'update-check.json'),
    JSON.stringify({ lastCheck: Date.now(), latestVersion: CURRENT })
  )
  for (const [path, content] of Object.entries(FILES)) {
    mkdirSync(dirname(join(cwd, path)), { recursive: true })
    writeFileSync(join(cwd, path), content)
  }
  const r = spawnSync('node', [CLI, 'update', ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, HOME: home, CI: 'true' }
  })
  const changed = Object.entries(FILES)
    .filter(([path, content]) => readFileSync(join(cwd, path), 'utf8') !== content)
    .map(([path]) => path)
  rmSync(home, { recursive: true, force: true })
  rmSync(cwd, { recursive: true, force: true })
  const out = `${r.stdout}${r.stderr}`.replace(/\x1b\[[0-9;]*m/g, '')
  return { code: r.status, out, changed }
}

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

test('a dry run says AGENTS.md would follow the deps, not that the step would skip', () => {
  const r = run(['--dry-run'])
  assert.equal(r.code, 0, r.out)
  assert.match(
    r.out,
    new RegExp(`Dry-run: would update AGENTS\\.md \\(v0\\.1\\.0 → v${escape(CURRENT)}\\), once the deps above are installed\\.`)
  )
  assert.doesNotMatch(r.out, /refresh skipped/)
  assert.doesNotMatch(r.out, /--no-deps/)
  assert.deepEqual(r.changed, [], 'a dry run wrote files')
})

test('the breaking summary asks for a build and a check, and names no changelog', () => {
  const r = run(['--dry-run'])
  assert.match(r.out, /cross(es)? a breaking boundary/)
  assert.match(r.out, /build and check before shipping/)
  assert.doesNotMatch(r.out, /changelog/i)
})

test('--no-deps: the step skips, and the hint names --no-deps', () => {
  const r = run(['--dry-run', '--no-deps'])
  assert.match(r.out, /AGENTS\.md refresh skipped: workspace deps still lag the CLI\./)
  assert.match(r.out, /Re-run without --no-deps, or pass --allow-mismatch to override\./)
  assert.doesNotMatch(r.out, /would update AGENTS\.md/)
})

test('--agents-only: the hint names --agents-only, and the run fails', () => {
  const r = run(['--agents-only'])
  assert.equal(r.code, 1, r.out)
  assert.match(r.out, /Re-run without --agents-only, or pass --allow-mismatch to override\./)
  assert.doesNotMatch(r.out, /--no-deps/)
  assert.deepEqual(r.changed, [])
})

test('a deps step left to a non-interactive plan: the hint says to align them, not --no-deps', () => {
  const r = run(['--non-interactive'])
  assert.match(r.out, /AGENTS\.md refresh skipped: workspace deps still lag the CLI\./)
  assert.match(r.out, /Align the deps first — accept the edit, or re-run with --yes — or pass --allow-mismatch to override\./)
  assert.doesNotMatch(r.out, /--no-deps/)
  assert.deepEqual(r.changed, [], 'a non-interactive run without --yes wrote files')
})
