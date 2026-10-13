/**
 * Workspace layouts, driven through the CLI: a project per type with several sites
 * each (`<type>/src` + `<type>/sites/<name>`), and what `add`, `rename`, `update`,
 * `dev` and `doctor` do to and with the workspace file.
 *
 * ⛔ Until 2026-10-13, in such a workspace:
 *   - the patterns pnpm reads for it found nothing (`No sites found`);
 *   - `update` could not see a package that `add project`'s own pattern lists, and
 *     called a stale foundation aligned;
 *   - `add` listed a folder a pattern already covered, so discovery found it twice;
 *   - `add`, `rename` and `doctor --fix` rewrote pnpm-workspace.yaml from its
 *     `packages` alone, deleting its comments, `onlyBuiltDependencies` and
 *     `allowBuilds`;
 *   - `add site <name> --project <p>` put the site at the workspace root, silently;
 *   - per-site scripts were only ever added, so a renamed site's stayed behind.
 */

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import yaml from 'js-yaml'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const CLI = join(ROOT, 'src/index.js')
const VERSION = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version

let home, scratch

/** Run the CLI offline: HOME holds an update cache saying this CLI is the latest. */
function cli(args, cwd) {
  const r = spawnSync('node', [CLI, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, HOME: home, CI: 'true' }
  })
  return { code: r.status, out: (r.stdout + r.stderr).replace(/\x1b\[[0-9;]*m/g, '') }
}

/** A new workspace from `create`, with these flags; returns its path. */
function workspace(...flags) {
  const parent = mkdtempSync(join(scratch, 'ws-'))
  const r = cli(['create', 'ws', '--no-git', ...flags], parent)
  assert.equal(r.code, 0, r.out)
  return join(parent, 'ws')
}

const read = (ws, rel) => readFileSync(join(ws, rel), 'utf8')
const json = (ws, rel) => JSON.parse(read(ws, rel))
const available = (ws) => (cli(['dev', '--site', '?'], ws).out.match(/Available: (.*)/) || [])[1]

before(() => {
  home = mkdtempSync(join(tmpdir(), 'uniweb-home-'))
  mkdirSync(join(home, '.uniweb'))
  writeFileSync(
    join(home, '.uniweb', 'update-check.json'),
    JSON.stringify({ lastCheck: Date.now(), latestVersion: VERSION })
  )
  scratch = mkdtempSync(join(tmpdir(), 'uniweb-layouts-'))
})

after(() => {
  rmSync(home, { recursive: true, force: true })
  rmSync(scratch, { recursive: true, force: true })
})

/** The by-type layout: memberships/src with two sites under memberships/sites/. */
function byType() {
  const ws = workspace('--blank')
  assert.equal(cli(['add', 'foundation', '--project', 'memberships'], ws).code, 0)
  for (const site of ['fitness', 'society']) {
    const r = cli(['add', 'site', `memberships/sites/${site}`, '--foundation', 'memberships-src'], ws)
    assert.equal(r.code, 0, r.out)
  }
  const doc = yaml.load(read(ws, 'pnpm-workspace.yaml'))
  doc.packages = ['*/src', '*/sites/*']
  writeFileSync(join(ws, 'pnpm-workspace.yaml'), yaml.dump(doc))
  return ws
}

test('*/src and */sites/* are read as pnpm reads them', () => {
  const ws = byType()
  assert.equal(available(ws), 'fitness, society')
})

test('update sees the foundation */src lists, and flags it when stale', () => {
  const ws = byType()
  // CONTROL: aligned as scaffolded.
  assert.match(cli(['update', '--dry-run', '--non-interactive'], ws).out, /aligned/)

  const pkg = json(ws, 'memberships/src/package.json')
  pkg.dependencies['@uniweb/kit'] = '~0.1.0'
  writeFileSync(join(ws, 'memberships/src/package.json'), JSON.stringify(pkg, null, 2))
  const r = cli(['update', '--dry-run', '--non-interactive'], ws)
  assert.match(r.out, /memberships\/src\/[\s\S]*@uniweb\/kit\s+~0\.1\.0/)
  assert.doesNotMatch(r.out, /deps are aligned/)
})

test('add under a pattern that covers the folder leaves the file as it is, and the site is found once', () => {
  const ws = byType()
  const before = read(ws, 'pnpm-workspace.yaml')
  const r = cli(['add', 'site', 'memberships/sites/gym', '--foundation', 'memberships-src'], ws)
  assert.equal(r.code, 0, r.out)
  assert.equal(read(ws, 'pnpm-workspace.yaml'), before)
  assert.equal(available(ws), 'fitness, gym, society')
})

test("add project keeps the file's comments and build settings", () => {
  const ws = workspace('--template', 'none')
  const before = yaml.load(read(ws, 'pnpm-workspace.yaml'))
  assert.equal(cli(['add', 'project', 'memberships'], ws).code, 0)
  const text = read(ws, 'pnpm-workspace.yaml')
  const doc = yaml.load(text)
  assert.deepEqual(doc.packages, [...before.packages, '*/src', '*/site'])
  assert.deepEqual(doc.allowBuilds, before.allowBuilds)
  assert.deepEqual(doc.onlyBuiltDependencies, before.onlyBuiltDependencies)
  assert.match(text, /^# pnpm 11 ignores the old name entirely/m)
})

test("a blank workspace's first add writes the file from the template — build settings included", () => {
  const ws = workspace('--blank')
  assert.ok(!existsSync(join(ws, 'pnpm-workspace.yaml')), 'blank has none until a package exists')
  assert.equal(cli(['add', 'foundation'], ws).code, 0)
  const doc = yaml.load(read(ws, 'pnpm-workspace.yaml'))
  assert.deepEqual(doc.packages, ['src'])
  assert.ok(doc.allowBuilds && doc.onlyBuiltDependencies)
})

test('--project with a name is refused, naming the folder form — nothing is created', () => {
  const ws = byType()
  const site = cli(['add', 'site', 'pool', '--project', 'memberships'], ws)
  assert.equal(site.code, 1, site.out)
  assert.match(site.out, /add site memberships\/sites\/pool/)
  assert.ok(!existsSync(join(ws, 'pool')) && !existsSync(join(ws, 'memberships', 'pool')))

  const foundation = cli(['add', 'foundation', 'core', '--project', 'memberships'], ws)
  assert.equal(foundation.code, 1, foundation.out)
  assert.match(foundation.out, /add foundation memberships\/core/)
  assert.ok(!existsSync(join(ws, 'core')))

  // CONTROL: the folder form does what was meant.
  assert.equal(cli(['add', 'site', 'memberships/sites/pool', '--foundation', 'memberships-src'], ws).code, 0)
  assert.ok(existsSync(join(ws, 'memberships', 'sites', 'pool', 'site.yml')))
})

test("rename drops the scripts it wrote for the old name, and keeps the user's own", () => {
  const ws = workspace('--template', 'none')
  assert.equal(cli(['add', 'site', 'blog'], ws).code, 0)
  const pkg = json(ws, 'package.json')
  assert.equal(pkg.scripts['dev:blog'], 'uniweb dev blog')
  pkg.scripts['dev:blog:fast'] = 'vite --port 4000'
  writeFileSync(join(ws, 'package.json'), JSON.stringify(pkg, null, 2))

  const r = cli(['rename', 'site', 'blog', 'journal'], ws)
  assert.equal(r.code, 0, r.out)
  const scripts = json(ws, 'package.json').scripts
  assert.equal(scripts['dev:journal'], 'uniweb dev journal')
  assert.ok(!('dev:blog' in scripts) && !('preview:blog' in scripts), Object.keys(scripts).join(', '))
  assert.equal(scripts['dev:blog:fast'], 'vite --port 4000')
})

test('doctor --fix brings the two manifests in step without touching the rest of the yaml', () => {
  const ws = workspace('--template', 'none')
  const pkg = json(ws, 'package.json')
  pkg.workspaces = [...pkg.workspaces, 'tools/*']
  writeFileSync(join(ws, 'package.json'), JSON.stringify(pkg, null, 2))
  const before = yaml.load(read(ws, 'pnpm-workspace.yaml'))

  cli(['doctor', '--fix', 'workspace-manifests-out-of-sync'], ws)
  const doc = yaml.load(read(ws, 'pnpm-workspace.yaml'))
  assert.deepEqual(doc.packages, [...before.packages, 'tools/*'])
  assert.deepEqual(doc.allowBuilds, before.allowBuilds)
  assert.deepEqual(doc.onlyBuiltDependencies, before.onlyBuiltDependencies)
})
