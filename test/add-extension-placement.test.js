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
 * in `<name>/` or `extensions/<name>/`, in the folder the site is in or a folder
 * above it up to the workspace root (`@uniweb/build`, findSiteExtension). What it
 * finds is wired; anything else is not, and the command says why.
 *
 * ⛔ Until 2026-10-13 `add` judged that from the workspace root while the build
 * looked only beside the site: a site at `sites/main` was wired to
 * `extensions/effects`, and its build could not find it. `add` asks the build now.
 */

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { findSiteExtension } from '@uniweb/build'

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
  assert.match(r.out, /the build finds in fx\/ or extensions\/fx\/ .*For site\/ that is not libs\/fx\//)
})

test('a site in sites/ is wired to a shared extension at the workspace root — the folder its build finds', () => {
  // `--foundation`: the extensions made above are foundations too, so `add site` asks which.
  const site = cli(['add', 'site', 'sites/main', '--foundation', 'src'], workspace)
  assert.equal(site.code, 0, site.out)
  const r = cli(['add', 'extension', 'extensions/shared', '--site', 'main'], workspace)
  assert.equal(r.code, 0, r.out)
  assert.match(read('sites/main/site.yml'), /^ {2}- \/shared\/entry\.js$/m)
  // What `add` wired is what the build loads — the same rule, asked of the same package.
  const found = findSiteExtension('shared', join(workspace, 'sites', 'main'))
  assert.equal(found && realpathSync(found), realpathSync(join(workspace, 'extensions', 'shared')))
})

test('from a site in sites/, a folder the build does not search is not wired, and the command says where it does', () => {
  const r = cli(['add', 'extension', 'libs2/far', '--site', 'main'], workspace)
  assert.equal(r.code, 0, r.out)
  assert.doesNotMatch(read('sites/main/site.yml'), /\/far\//)
  assert.match(r.out, /far\/ or extensions\/far\/ .*For sites\/main\/ that is not libs2\/far\//)
})

test('a nearer extension of the same name is named, and the farther one is not wired', () => {
  const near = cli(['add', 'extension', 'sites/shadow', '--site', 'main'], workspace)
  assert.equal(near.code, 0, near.out)
  assert.match(read('sites/main/site.yml'), /^ {2}- \/shadow\/entry\.js$/m)

  const far = cli(['add', 'extension', 'extensions/shadow', '--site', 'main'], workspace)
  assert.equal(far.code, 0, far.out)
  assert.match(far.out, /would load the nearer extension named 'shadow', at sites\/shadow\/ — not extensions\/shadow\//)
})
