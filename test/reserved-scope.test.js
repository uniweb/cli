/**
 * ⛔ The `@uniweb` scope is reserved *[Diego, 2026-10-23]*: it names the Uniweb framework's
 * own packages and the system account of every Uniweb backend, so no foundation is named
 * under it.
 *
 * `create` and `add` write a foundation's name without a scope — `register` gives it one —
 * so a name typed under `@uniweb` would lose its scope in silence, and read as granted
 * until `register` refused it. Both refuse it instead, before anything is written, and say
 * why. (`register`'s own refusals are pinned in `register-delivery-name.test.js` and
 * `register-default-scope.test.js`.)
 *
 * Each case runs the CLI offline: HOME holds an update cache saying this CLI is the latest.
 */

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const CLI = join(ROOT, 'src/index.js')
const VERSION = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version

let home, workspace
const made = []

function cli(args, cwd) {
  const r = spawnSync('node', [CLI, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, HOME: home, CI: 'true' }
  })
  return { code: r.status, out: (r.stdout + r.stderr).replace(/\x1b\[[0-9;]*m/g, '') }
}

const emptyDir = () => {
  const dir = mkdtempSync(join(tmpdir(), 'uniweb-reserved-'))
  made.push(dir)
  return dir
}

before(() => {
  home = mkdtempSync(join(tmpdir(), 'uniweb-home-'))
  mkdirSync(join(home, '.uniweb'))
  writeFileSync(
    join(home, '.uniweb', 'update-check.json'),
    JSON.stringify({ lastCheck: Date.now(), latestVersion: VERSION })
  )
  // CONTROL — the same CLI creates a project with a name it may use
  const parent = emptyDir()
  assert.equal(cli(['create', 'ws', '--template', 'none', '--no-git'], parent).code, 0)
  workspace = join(parent, 'ws')
})

after(() => {
  rmSync(home, { recursive: true, force: true })
  for (const dir of made) rmSync(dir, { recursive: true, force: true })
})

test('⛔ create refuses a name under @uniweb, says why, writes nothing and names the way on', () => {
  const cwd = emptyDir()
  const r = cli(['create', '@uniweb/marketing', '--template', 'none', '--no-git'], cwd)
  assert.equal(r.code, 1, r.out)
  assert.match(r.out, /"@uniweb\/marketing" is named under @uniweb, which is reserved/)
  assert.match(r.out, /the Uniweb framework's own packages and the system account of every Uniweb backend/)
  assert.match(r.out, /create marketing — and .*register gives its foundation the scope of the workspace you work in/)
  assert.deepEqual(readdirSync(cwd), [], 'a refused create wrote something')
})

test('⛔ …in any case, and in place too, naming the in-place form', () => {
  const cwd = emptyDir()
  const r = cli(['create', '.', '--name', '@UniWeb/marketing', '--template', 'none', '--no-git'], cwd)
  assert.equal(r.code, 1, r.out)
  assert.match(r.out, /is named under @uniweb, which is reserved/)
  assert.match(r.out, /create \. --name marketing/)
  assert.deepEqual(readdirSync(cwd), [], 'a refused create wrote something')
})

test('⛔ add refuses a foundation, extension or project named under @uniweb, writing nothing', () => {
  const workspaceFile = readFileSync(join(workspace, 'pnpm-workspace.yaml'), 'utf8')
  for (const kind of ['foundation', 'extension', 'project']) {
    const r = cli(['add', kind, '@uniweb/kit-x'], workspace)
    assert.equal(r.code, 1, `${kind}: ${r.out}`)
    assert.match(r.out, /"@uniweb\/kit-x" is named under @uniweb, which is reserved/, kind)
    assert.match(r.out, new RegExp(`add ${kind} kit-x — and .*register gives it the scope`), kind)
  }
  assert.ok(!existsSync(join(workspace, '@uniweb')), 'a refused add made the folder')
  assert.ok(!existsSync(join(workspace, 'kit-x')), 'a refused add made the folder')
  assert.equal(readFileSync(join(workspace, 'pnpm-workspace.yaml'), 'utf8'), workspaceFile)
})
