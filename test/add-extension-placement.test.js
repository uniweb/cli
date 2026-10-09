/**
 * `add extension` places a package by the rule `add foundation` follows — the
 * folder you name is the folder created, `--path` is the folder it goes in — and
 * registers that exact folder in the workspace.
 *
 * ⛔ Until 2026-10-08 an extension went to `extensions/<name>/` whatever was asked,
 * `--path` named the folder itself, the workspace glob added was always
 * `extensions/*` (so `--path elsewhere/fx` made a package pnpm never saw), and the
 * site was wired with `/<folder>/dist/entry.js`, a URL the build reads as an
 * extension named after the folder's first segment — so the site 404'd on it.
 *
 * A site loads a workspace extension from `/<name>/entry.js`, which the build finds
 * in `<name>/` or `extensions/<name>/`: those two are wired, any other folder is
 * not, and the command says why.
 */

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const CLI = join(ROOT, 'src/index.js')
const VERSION = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version

let home, workspace

/** Run the CLI offline: HOME holds an update cache saying this CLI is the latest. */
function cli(args, cwd) {
  const r = spawnSync('node', [CLI, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, HOME: home, CI: 'true' }
  })
  return { code: r.status, out: (r.stdout + r.stderr).replace(/\x1b\[[0-9;]*m/g, '') }
}

const read = (path) => readFileSync(join(workspace, path), 'utf8')

before(() => {
  home = mkdtempSync(join(tmpdir(), 'uniweb-home-'))
  mkdirSync(join(home, '.uniweb'))
  writeFileSync(
    join(home, '.uniweb', 'update-check.json'),
    JSON.stringify({ lastCheck: Date.now(), latestVersion: VERSION })
  )
  const parent = mkdtempSync(join(tmpdir(), 'uniweb-ws-'))
  assert.equal(cli(['create', 'ws', '--template', 'none', '--no-git'], parent).code, 0)
  workspace = join(parent, 'ws')
})

after(() => {
  rmSync(home, { recursive: true, force: true })
  rmSync(dirname(workspace), { recursive: true, force: true })
})

test('a bare name is the folder created, registered and wired as /<name>/entry.js', () => {
  const r = cli(['add', 'extension', 'effects', '--site', 'site'], workspace)
  assert.equal(r.code, 0, r.out)
  assert.ok(existsSync(join(workspace, 'effects', 'package.json')))
  assert.ok(!existsSync(join(workspace, 'extensions')), 'nested under extensions/ unasked')
  assert.match(read('pnpm-workspace.yaml'), /^ {2}- "?effects"?$/m)
  assert.match(read('site/site.yml'), /^ {2}- \/effects\/entry\.js$/m)
})

test('a path is the folder created; extensions/<name> is wired the same way', () => {
  const r = cli(['add', 'extension', 'extensions/glow', '--site', 'site'], workspace)
  assert.equal(r.code, 0, r.out)
  assert.ok(existsSync(join(workspace, 'extensions', 'glow', 'package.json')))
  assert.match(read('pnpm-workspace.yaml'), /^ {2}- "?extensions\/glow"?$/m)
  assert.match(read('site/site.yml'), /^ {2}- \/glow\/entry\.js$/m)
})

test('--path is the folder it goes in, registered exactly — and not wired, saying why', () => {
  const r = cli(['add', 'extension', 'fx', '--path', 'libs', '--site', 'site'], workspace)
  assert.equal(r.code, 0, r.out)
  assert.ok(existsSync(join(workspace, 'libs', 'fx', 'package.json')))
  assert.match(read('pnpm-workspace.yaml'), /^ {2}- "?libs\/fx"?$/m)
  assert.doesNotMatch(read('pnpm-workspace.yaml'), /extensions\/\*/)
  assert.doesNotMatch(read('site/site.yml'), /\/fx\//)
  assert.match(r.out, /builds? finds? .*fx\/ or extensions\/fx\/ — not libs\/fx\//)
})
