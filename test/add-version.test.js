/**
 * `uniweb add version`, as an agent or a person runs it: a real process in a real workspace, in which
 * what the copy holds is `@uniweb/build`'s to test (`build/tests/add-version.test.js`). Here it's
 * which site, what it says, and that a refusal says why and exits 1.
 */

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'index.js')
let root

function write(path, text) {
  const file = join(root, path)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, text)
}

function site(name) {
  write(`${name}/package.json`, JSON.stringify({ name, private: true }))
  write(`${name}/site.yml`, 'name: test\nindex: home\n')
  write(`${name}/theme.yml`, "colors:\n  primary: '#000000'\n")
  write(`${name}/pages/home/page.yml`, 'title: Home\n')
  write(`${name}/pages/home/1-home.md`, '---\ntype: Text\n---\n\n# Home\n')
  write(`${name}/pages/docs/guide/page.yml`, 'id: guide\ntitle: Guide\n')
  write(`${name}/pages/docs/guide/1-guide.md`, '---\ntype: Text\n---\n\n# Guide\n\n[Self](page:guide)\n')
}

function run(args, cwd = root) {
  const result = spawnSync(process.execPath, [CLI, 'add', 'version', ...args, '--non-interactive'], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, CI: 'true' },
  })
  return { code: result.status, out: result.stdout, all: (result.stdout + result.stderr).replace(/\x1b\[[0-9;]*m/g, '') }
}

before(() => {
  root = mkdtempSync(join(tmpdir(), 'uniweb-add-version-'))
  write('package.json', JSON.stringify({ name: 'workspace', private: true }))
  write('pnpm-workspace.yaml', "packages:\n  - 'one'\n  - 'two'\n")
  site('one')
  site('two')
})

after(() => rmSync(root, { recursive: true, force: true }))

test('with no name, it says how, and exits 1', () => {
  const { code, all } = run([], join(root, 'one'))
  assert.equal(code, 1)
  assert.match(all, /Missing the version's name/)
  assert.match(all, /add version v2/)
})

test('with a name that is not a version, it says so, and exits 1', () => {
  const { code, all } = run(['2'], join(root, 'one'))
  assert.equal(code, 1)
  assert.match(all, /Did you mean v2/)
  assert.equal(existsSync(join(root, 'one/pages/docs/2')), false)
})

test('from the workspace root with two sites, it asks which, and names them', () => {
  const { code, all } = run(['v1'])
  assert.equal(code, 1)
  assert.match(all, /Multiple sites/)
  assert.match(all, /one/)
  assert.match(all, /two/)
})

test('a dry run says what it would do, and writes nothing', () => {
  const { code, all } = run(['v1', '--dry-run'], join(root, 'one'))
  assert.equal(code, 0, all)
  assert.match(all, /Would freeze 1 page of pages\/docs as pages\/docs\/v1, at \/docs\/v1/)
  assert.equal(existsSync(join(root, 'one/pages/docs/v1')), false)
})

test('inside a site, it freezes that site, and says what happened', () => {
  const { code, all } = run(['v1', '--label', '1.x'], join(root, 'one'))
  assert.equal(code, 0, all)
  assert.match(all, /Froze 1 page of pages\/docs/)
  assert.match(all, /1 link leads to the copy/)
  assert.match(all, /Kept out of search engines/)
  assert.equal(existsSync(join(root, 'one/pages/docs/v1/guide/page.yml')), true)
  assert.equal(existsSync(join(root, 'two/pages/docs/v1')), false)
})

test('--site names one from anywhere, and --json is only JSON', () => {
  const { code, out, all } = run(['v1', '--site', 'two', '--json', '--keep-in-search'])
  assert.equal(code, 0, all)
  const report = JSON.parse(out)
  assert.equal(report.route, '/docs/v1')
  assert.equal(report.pages, 1)
  assert.equal(report.keptOutOfSearch, false)
  assert.equal(existsSync(join(root, 'two/pages/docs/v1/guide/page.yml')), true)
})

test('a version that exists is refused, with the reason', () => {
  const { code, all } = run(['v1'], join(root, 'one'))
  assert.equal(code, 1)
  assert.match(all, /already exists/)
})
