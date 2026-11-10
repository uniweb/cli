/**
 * `uniweb add library` makes a library and wires foundations to it: a `file:` dependency in each,
 * and a line in each one's stylesheet that has Tailwind read the library's classes.
 *
 * A library is any local package a foundation depends on, so the command wires a package that is
 * there already as readily as one it makes. Measured 2026-11-09 on a workspace it made, installed
 * with pnpm from npm: the prerendered page drew the library's component, the class only the
 * library used was in the foundation's CSS and the site's, and an edit to the library alone
 * rebuilt the foundation ("ui, a library it bundles, changed").
 */

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { libraryLine, libraryManifest, withLibraryLine } from '../src/commands/add-library.js'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const CLI = join(ROOT, 'src/index.js')
const VERSION = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version

let home, workspace

/** Run the CLI offline: HOME holds an update cache saying this CLI is the latest. */
function cli(args, cwd = workspace) {
  const r = spawnSync('node', [CLI, ...args], { cwd, encoding: 'utf8', env: { ...process.env, HOME: home, CI: 'true' } })
  return { code: r.status, out: (r.stdout + r.stderr).replace(/\x1b\[[0-9;]*m/g, '') }
}
const read = (path) => readFileSync(join(workspace, path), 'utf8')
const json = (path) => JSON.parse(read(path))

before(() => {
  home = mkdtempSync(join(tmpdir(), 'uniweb-home-'))
  mkdirSync(join(home, '.uniweb'))
  writeFileSync(join(home, '.uniweb', 'update-check.json'), JSON.stringify({ lastCheck: Date.now(), latestVersion: VERSION }))
  const parent = mkdtempSync(join(tmpdir(), 'uniweb-ws-'))
  assert.equal(cli(['create', 'ws', '--blank', '--no-git'], parent).code, 0)
  workspace = join(parent, 'ws')
  for (const name of ['classic', 'modern']) assert.equal(cli(['add', 'foundation', `foundations/${name}`]).code, 0)
})

after(() => {
  rmSync(home, { recursive: true, force: true })
  rmSync(dirname(workspace), { recursive: true, force: true })
})

test('⭐ makes the package, lists it in the workspace, and wires each foundation named', () => {
  const r = cli(['add', 'library', 'libraries/ui', '--foundation', 'classic,modern'])
  assert.equal(r.code, 0, r.out)
  assert.match(r.out, /Created library ui at libraries\/ui\/ → classic, modern/)
  const pkg = json('libraries/ui/package.json')
  assert.equal(pkg.name, 'ui')
  assert.equal(pkg.private, true)
  assert.deepEqual(Object.keys(pkg.peerDependencies).sort(), ['@uniweb/kit', 'react'])
  assert.equal(pkg.exports['./styles.css'], './styles.css')
  assert.match(read('libraries/ui/styles.css'), /^@source "\.\/\*\*\/\*\.\{js,jsx\}";$/m)
  assert.ok(existsSync(join(workspace, 'libraries/ui/components')))
  assert.match(read('pnpm-workspace.yaml'), /^ {2}- "?libraries\/ui"?$/m)
  assert.ok(json('package.json').workspaces.includes('libraries/ui'))
  for (const f of ['classic', 'modern']) {
    assert.equal(json(`foundations/${f}/package.json`).dependencies.ui, 'file:../../libraries/ui')
    assert.match(read(`foundations/${f}/styles.css`), /^@import "@uniweb\/kit\/theme-tokens\.css";\n@import "ui\/styles\.css";$/m)
  }
})

test('run again, it changes nothing, and says so', () => {
  const before = read('foundations/classic/styles.css')
  const r = cli(['add', 'library', 'libraries/ui', '--foundation', 'classic'])
  assert.equal(r.code, 0, r.out)
  assert.match(r.out, /classic: wired to ui already/)
  assert.equal(read('foundations/classic/styles.css'), before)
})

test('several foundations and none named: it is made and none is wired, with the command that wires them', () => {
  const r = cli(['add', 'library', 'kit2'])
  assert.equal(r.code, 0, r.out)
  assert.match(r.out, /none was wired\. Name them: (?:\S+ )?uniweb add library kit2 --foundation classic,modern/)
  assert.equal(json('foundations/classic/package.json').dependencies.kit2, undefined)
})

test('a package made by hand is wired, with a @source when it has no stylesheet of its own', () => {
  mkdirSync(join(workspace, 'vendor/charts'), { recursive: true })
  writeFileSync(join(workspace, 'vendor/charts/package.json'), JSON.stringify({ name: '@acme/charts', type: 'module' }))
  const r = cli(['add', 'library', 'vendor/charts', '--foundation', 'modern'])
  assert.equal(r.code, 0, r.out)
  assert.match(r.out, /Wired library @acme\/charts → modern/)
  assert.equal(json('foundations/modern/package.json').dependencies['@acme/charts'], 'file:../../vendor/charts')
  assert.match(read('foundations/modern/styles.css'), /^@source "\.\.\/\.\.\/vendor\/charts";$/m)
  assert.ok(!existsSync(join(workspace, 'vendor/charts/index.js')), 'made what was there already')
})

test('--schemas: a schemas/ folder, and the scope its types are named under', () => {
  const r = cli(['add', 'library', 'libraries/data', '--foundation', 'classic', '--schemas', '--scope', 'acme'])
  assert.equal(r.code, 0, r.out)
  assert.deepEqual(json('libraries/data/package.json').uniweb, { scope: '@acme' })
  assert.match(read('libraries/data/schemas/README.md'), /`plan\.yml` is\n`@acme\/plan`/)
})

test('--schemas with no scope known is refused, with the flag that gives one', () => {
  const r = cli(['add', 'library', 'libraries/types', '--foundation', 'classic', '--schemas'])
  assert.equal(r.code, 1)
  assert.match(r.out, /none is known yet/)
  assert.match(r.out, /--schemas --scope @<org>/)
  assert.ok(!existsSync(join(workspace, 'libraries/types')))
})

test('what is refused, and nothing made', () => {
  const refusals = [
    [['@acme/ui'], /named for its folder/],
    [['foundations/classic'], /is a foundation, not a library/],
    [['classic'], /A package named classic is in this workspace already, at foundations\/classic\//],
    [['lib5', '--project', 'shop'], /goes in the folder you name/],
    [['lib6', '--foundation', 'nope'], /No foundation named 'nope'/],
    [['lib7', '--scope', '@uniweb'], /@uniweb is reserved/]
  ]
  for (const [args, said] of refusals) {
    const r = cli(['add', 'library', ...args])
    assert.equal(r.code, 1, `${args.join(' ')}: ${r.out}`)
    assert.match(r.out, said)
  }
  for (const made of ['lib5', 'lib6', 'lib7']) assert.ok(!existsSync(join(workspace, made)), made)
  assert.doesNotMatch(read('pnpm-workspace.yaml'), /lib[5-7]/)
})

test('⭐ a folder outside the workspace: made there, wired by its path, and not listed in the workspace', () => {
  const r = cli(['add', 'library', '../acme-shared', '--foundation', 'modern'])
  assert.equal(r.code, 0, r.out)
  const lib = join(dirname(workspace), 'acme-shared')
  assert.ok(existsSync(join(lib, 'package.json')))
  assert.equal(JSON.parse(readFileSync(join(lib, 'package.json'), 'utf8')).name, 'acme-shared')
  assert.equal(json('foundations/modern/package.json').dependencies['acme-shared'], 'file:../../../acme-shared')
  assert.match(read('foundations/modern/styles.css'), /^@import "acme-shared\/styles\.css";$/m)
  assert.doesNotMatch(read('pnpm-workspace.yaml'), /acme-shared/)
  assert.ok(!json('package.json').workspaces.some((w) => w.includes('acme-shared')))
  assert.match(r.out, /\.\.\/acme-shared\/ is outside the workspace/)
})

test('libraryManifest: private, kit and React as peers, and the scope only when given', () => {
  const versions = { '@uniweb/kit': '~1.7.18', react: '^19.0.0' }
  assert.equal(libraryManifest({ name: 'ui', projectName: 'p', versions }).uniweb, undefined)
  assert.deepEqual(libraryManifest({ name: 'ui', projectName: 'p', scope: '@acme', versions }).uniweb, { scope: '@acme' })
  assert.deepEqual(libraryManifest({ name: 'ui', projectName: 'p', versions }).peerDependencies, versions)
})

test('withLibraryLine: after the last @import, and not twice', () => {
  const css = '/* c */\n@import "tailwindcss" source("./");\n@import "@uniweb/kit/theme-tokens.css";\n\n.x { color: red; }\n'
  const wired = withLibraryLine(css, '@import "ui/styles.css";')
  assert.equal(wired, '/* c */\n@import "tailwindcss" source("./");\n@import "@uniweb/kit/theme-tokens.css";\n@import "ui/styles.css";\n\n.x { color: red; }\n')
  assert.equal(withLibraryLine(wired, '@import "ui/styles.css";'), null)
  assert.equal(withLibraryLine("@import 'tailwindcss';\n@source '../ui/';\n", '@source "../ui";'), null)
})

test("libraryLine: the library's stylesheet when a foundation can import it, else a @source to its folder", () => {
  const dir = mkdtempSync(join(tmpdir(), 'uniweb-line-'))
  try {
    const lib = join(dir, 'ui')
    mkdirSync(lib)
    writeFileSync(join(lib, 'package.json'), JSON.stringify({ name: 'ui' }))
    const stylesDir = join(dir, 'classic')
    assert.equal(libraryLine({ libraryDir: lib, libraryName: 'ui', stylesDir }), '@source "../ui";')
    writeFileSync(join(lib, 'styles.css'), '@source "./";\n')
    assert.equal(libraryLine({ libraryDir: lib, libraryName: 'ui', stylesDir }), '@import "ui/styles.css";')
    writeFileSync(join(lib, 'package.json'), JSON.stringify({ name: 'ui', exports: { '.': './index.js' } }))
    assert.equal(libraryLine({ libraryDir: lib, libraryName: 'ui', stylesDir }), '@source "../ui";')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
