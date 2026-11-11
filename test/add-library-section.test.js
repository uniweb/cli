/**
 * `uniweb add section <Name> --library <library>` puts a section type in a library and has each
 * foundation offer it: two files in the foundation's `sections/<Name>/` that pass on the library's
 * `index.jsx` and `meta.js`. Authors pick a type from a foundation's `sections/`, so a library's type
 * is offered by the foundations that pass it on, and an edit to the library's files reaches them all.
 *
 * Also `uniweb add section` without `--library`, whose files the two share.
 */

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { exportsSubpath, withSectionsExport } from '../src/commands/add-library-section.js'
import { passOnFiles, sectionComponent, sectionMeta } from '../src/utils/section-files.js'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const CLI = join(ROOT, 'src/index.js')
const VERSION = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version

let home, workspace

/** Run the CLI offline: HOME holds an update cache saying this CLI is the latest. */
function cli(args, cwd = workspace) {
  const r = spawnSync('node', [CLI, ...args], { cwd, encoding: 'utf8', env: { ...process.env, HOME: home, CI: 'true' } })
  return { code: r.status, out: (r.stdout + r.stderr).replace(/\x1b\[[0-9;]*m/g, ''), stdout: r.stdout }
}
const read = (path) => readFileSync(join(workspace, path), 'utf8')
const json = (path) => JSON.parse(read(path))
const has = (path) => existsSync(join(workspace, path))

before(() => {
  home = mkdtempSync(join(tmpdir(), 'uniweb-home-'))
  mkdirSync(join(home, '.uniweb'))
  writeFileSync(join(home, '.uniweb', 'update-check.json'), JSON.stringify({ lastCheck: Date.now(), latestVersion: VERSION }))
  const parent = mkdtempSync(join(tmpdir(), 'uniweb-ws-'))
  assert.equal(cli(['create', 'ws', '--blank', '--no-git'], parent).code, 0)
  workspace = join(parent, 'ws')
  for (const name of ['classic', 'modern', 'docs']) assert.equal(cli(['add', 'foundation', `foundations/${name}`]).code, 0)
  assert.equal(cli(['add', 'library', 'libraries/ui', '--foundation', 'classic,modern']).code, 0)
})

after(() => {
  rmSync(home, { recursive: true, force: true })
  rmSync(dirname(workspace), { recursive: true, force: true })
})

test('⭐ the type goes in the library, and each foundation that depends on it passes it on', () => {
  const r = cli(['add', 'section', 'Banner', '--library', 'ui'])
  assert.equal(r.code, 0, r.out)
  assert.match(r.out, /Created section 'Banner' in the library ui, at libraries\/ui\/sections\/Banner\//)
  assert.match(r.out, /Offered by classic, modern: each one's sections\/Banner\/ passes on ui's index\.jsx and meta\.js/)
  assert.equal(read('libraries/ui/sections/Banner/index.jsx'), sectionComponent('Banner'))
  assert.equal(read('libraries/ui/sections/Banner/meta.js'), sectionMeta('Banner'))
  for (const f of ['classic', 'modern']) {
    assert.match(read(`foundations/${f}/sections/Banner/index.jsx`), /^export \{ default \} from 'ui\/sections\/Banner\/index\.jsx'$/m)
    assert.match(read(`foundations/${f}/sections/Banner/meta.js`), /^export \{ default \} from 'ui\/sections\/Banner\/meta\.js'$/m)
  }
  assert.ok(!has('foundations/docs/sections/Banner'), 'docs does not depend on ui, and was not named')
  assert.doesNotMatch(r.out, /Next: /, 'nothing to install: no foundation was wired')
})

test('run again, it changes nothing, and says so', () => {
  const before = read('foundations/classic/sections/Banner/meta.js')
  const r = cli(['add', 'section', 'Banner', '--library', 'ui'])
  assert.equal(r.code, 0, r.out)
  assert.match(r.out, /ui holds Banner already, at libraries\/ui\/sections\/Banner\//)
  assert.match(r.out, /classic, modern: pass on ui's Banner already/)
  assert.equal(read('foundations/classic/sections/Banner/meta.js'), before)
})

test('a foundation named that does not depend on the library is wired to it, then offers the type', () => {
  const r = cli(['add', 'section', 'Banner', '--library', 'libraries/ui', '--foundation', 'docs'])
  assert.equal(r.code, 0, r.out)
  assert.match(r.out, /Offered by docs: its sections\/Banner\/ passes on ui's index\.jsx and meta\.js/)
  assert.match(r.out, /Wired to ui: docs/)
  assert.match(r.out, /Next: /)
  assert.equal(json('foundations/docs/package.json').dependencies.ui, 'file:../../libraries/ui')
  assert.match(read('foundations/docs/styles.css'), /^@import "ui\/styles\.css";$/m)
  assert.match(read('foundations/docs/sections/Banner/index.jsx'), /from 'ui\/sections\/Banner\/index\.jsx'/)
})

test('a foundation with a type of that name of its own stops it, and nothing is written', () => {
  assert.equal(cli(['add', 'section', 'Hero', '--foundation', 'classic']).code, 0)
  const own = read('foundations/classic/sections/Hero/index.jsx')
  const r = cli(['add', 'section', 'Hero', '--library', 'ui', '--foundation', 'classic,modern'])
  assert.equal(r.code, 1)
  assert.match(r.out, /classic has a section type Hero of its own, at foundations\/classic\/sections\/Hero\/\. Nothing was written\./)
  assert.match(r.out, /--foundation modern/)
  assert.ok(!has('libraries/ui/sections/Hero'))
  assert.ok(!has('foundations/modern/sections/Hero'))
  assert.equal(read('foundations/classic/sections/Hero/index.jsx'), own)
})

test('a foundation that passes on the component alone, with its own meta.js, is left as it is', () => {
  assert.equal(cli(['add', 'section', 'Quote', '--library', 'ui', '--foundation', 'classic']).code, 0)
  const ownMeta = `export default { title: 'Quote, classic style' }\n`
  writeFileSync(join(workspace, 'foundations/classic/sections/Quote/meta.js'), ownMeta)
  const r = cli(['add', 'section', 'Quote', '--library', 'ui', '--foundation', 'classic,modern'])
  assert.equal(r.code, 0, r.out)
  assert.match(r.out, /Offered by modern/)
  assert.match(r.out, /classic: passes on ui's Quote already/)
  assert.equal(read('foundations/classic/sections/Quote/meta.js'), ownMeta)
})

test('a library made by hand: wired, listed, and its exports given ./sections/*', () => {
  mkdirSync(join(workspace, 'vendor/charts'), { recursive: true })
  writeFileSync(
    join(workspace, 'vendor/charts/package.json'),
    JSON.stringify({ name: '@acme/charts', type: 'module', exports: { '.': './index.js' } }, null, 2) + '\n'
  )
  const r = cli(['add', 'section', 'Chart', '--library', 'vendor/charts', '--foundation', 'modern'])
  assert.equal(r.code, 0, r.out)
  assert.match(r.out, /Created section 'Chart' in the library @acme\/charts, at vendor\/charts\/sections\/Chart\//)
  assert.match(r.out, /vendor\/charts\/package\.json exports \.\/sections\/\* now/)
  assert.deepEqual(json('vendor/charts/package.json').exports, { '.': './index.js', './sections/*': './sections/*' })
  assert.equal(json('foundations/modern/package.json').dependencies['@acme/charts'], 'file:../../vendor/charts')
  assert.ok(json('package.json').workspaces.includes('vendor/charts'))
  assert.match(read('foundations/modern/sections/Chart/meta.js'), /from '@acme\/charts\/sections\/Chart\/meta\.js'/)
  // Then by its package's name, now that the workspace lists it.
  const again = cli(['add', 'section', 'Chart', '--library', '@acme/charts', '--foundation', 'modern'])
  assert.equal(again.code, 0, again.out)
  assert.match(again.out, /modern: passes on @acme\/charts's Chart already/)
})

test('--starter: the library\'s meta.js gets the declaration, and the starter content is printed', () => {
  const r = cli(['add', 'section', 'Pricing', '--library', 'ui', '--starter'])
  assert.equal(r.code, 0, r.out)
  assert.match(read('libraries/ui/sections/Pricing/meta.js'), /content:/)
  assert.match(r.out, /Starter content for a page section:/)
  assert.match(read('foundations/modern/sections/Pricing/meta.js'), /from 'ui\/sections\/Pricing\/meta\.js'/)
})

test('what is refused', () => {
  const refusals = [
    [['Banner', '--library'], /--library takes the library's folder or name/],
    [['Banner', '--library', 'nope'], /No library named nope in this workspace/],
    [['Banner', '--library', 'foundations/classic'], /foundations\/classic\/ is a foundation, not a library/],
    [['Banner', '--library', 'ui', '--foundation', 'nope'], /No foundation named 'nope'/],
    [['banner', '--library', 'ui'], /PascalCase/]
  ]
  for (const [args, said] of refusals) {
    const r = cli(['add', 'section', ...args])
    assert.equal(r.code, 1, `${args.join(' ')}\n${r.out}`)
    assert.match(r.out, said, args.join(' '))
  }
})

test('a library none of several foundations depends on is refused with the command that names them', () => {
  mkdirSync(join(workspace, 'libraries/lonely'), { recursive: true })
  writeFileSync(join(workspace, 'libraries/lonely/package.json'), JSON.stringify({ name: 'lonely', type: 'module' }))
  const r = cli(['add', 'section', 'Banner', '--library', 'libraries/lonely'])
  assert.equal(r.code, 1)
  assert.match(r.out, /No foundation depends on lonely yet/)
  assert.match(r.out, /add section Banner --library libraries\/lonely --foundation \w+,\w+/)
  assert.ok(!has('libraries/lonely/sections'))
})

test('without --library: the same two files, in the foundation', () => {
  const r = cli(['add', 'section', 'Plain', '--foundation', 'modern'])
  assert.equal(r.code, 0, r.out)
  assert.match(r.out, /Created section 'Plain' at foundations\/modern\/sections\/Plain\//)
  assert.equal(read('foundations/modern/sections/Plain/index.jsx'), sectionComponent('Plain'))
  assert.equal(read('foundations/modern/sections/Plain/meta.js'), sectionMeta('Plain'))
  const again = cli(['add', 'section', 'Plain', '--foundation', 'modern'])
  assert.equal(again.code, 1)
  assert.match(again.out, /Section 'Plain' already exists/)
})

test('exportsSubpath reads a package\'s exports as Node does, for a subpath', () => {
  const sub = './sections/A/meta.js'
  assert.equal(exportsSubpath(undefined, sub), true)
  assert.equal(exportsSubpath('./index.js', sub), false)
  assert.equal(exportsSubpath(['./index.js'], sub), false)
  assert.equal(exportsSubpath({ import: './index.js' }, sub), false)
  assert.equal(exportsSubpath({ '.': './index.js', './sections/*': './sections/*' }, sub), true)
  assert.equal(exportsSubpath({ '.': './index.js', './*': './*' }, sub), true)
  assert.equal(exportsSubpath({ '.': './index.js', './sections/*.jsx': './sections/*.jsx' }, sub), false)
  assert.equal(exportsSubpath({ '.': './index.js', [sub]: './sections/A/meta.js' }, sub), true)
  assert.equal(exportsSubpath({ '.': './index.js', './sections/*': null }, sub), false)
})

test('withSectionsExport keeps what the package exported', () => {
  const add = { './sections/*': './sections/*' }
  assert.deepEqual(withSectionsExport('./index.js'), { '.': './index.js', ...add })
  assert.deepEqual(withSectionsExport({ import: './i.js' }), { '.': { import: './i.js' }, ...add })
  assert.deepEqual(withSectionsExport({ '.': './i.js', './x': './x.js' }), { '.': './i.js', './x': './x.js', ...add })
})

test('passOnFiles: each line passes on the library\'s file of its name', () => {
  const files = passOnFiles('@acme/ui', 'Banner')
  assert.match(files['index.jsx'], /^export \{ default \} from '@acme\/ui\/sections\/Banner\/index\.jsx'$/m)
  assert.match(files['meta.js'], /^export \{ default \} from '@acme\/ui\/sections\/Banner\/meta\.js'$/m)
})
