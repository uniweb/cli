/**
 * `uniweb vendor run <file>#<function>`: a vendor function run on this machine under the rules it
 * runs by. The rules themselves are `@uniweb/build`'s (`build/tests/vendor-run.test.js`); this holds
 * the verb: how it finds the file, where the input comes from, and what it prints and exits with.
 *
 * Run: `pnpm test` or `node --test test/`
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'index.js')
const GRADER = 'export function grade(input) {\n  return { points: input.answers.length }\n}\nexport function rename() {\n  const e = new Error(\'bad key\')\n  e.name = \'GradingError\'\n  throw e\n}\n'
const SCORE = 'export function score(input) {\n  return { s: input.n * 2 }\n}\n'

function put(root, files) {
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true })
    writeFileSync(join(root, rel), body)
  }
}

function workspace(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'uw-vendor-run-')))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  put(root, {
    'pnpm-workspace.yaml': 'packages:\n  - foundations/*\n  - libraries/*\n',
    'package.json': JSON.stringify({ name: 'w', private: true }),
    'libraries/grading/package.json': JSON.stringify({ name: 'grading', uniweb: { scope: '@lib' } }),
    'libraries/grading/vendors/grading.js': SCORE,
    'foundations/shop/package.json': JSON.stringify({ name: 'shop', type: 'module', version: '0.1.0' }),
    'foundations/shop/main.js': "export default { name: '@acme/shop', vendors: ['@lib/grading'] }\n",
    'foundations/shop/vendors/courses.js': GRADER,
    'in.json': JSON.stringify({ answers: [1, 2, 3], n: 4 }),
  })
  return root
}

function run(cwd, args, input) {
  const r = spawnSync(process.execPath, [CLI, 'vendor', 'run', ...args], { cwd, input, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } })
  return { code: r.status, out: r.stdout, err: r.stderr }
}

test('runs a foundation\'s own file by its name, the input from --input, the answer on stdout', (t) => {
  const root = workspace(t)
  const r = run(join(root, 'foundations/shop'), ['courses#grade', '--input', join(root, 'in.json')])
  assert.equal(r.code, 0, r.err)
  assert.deepEqual(JSON.parse(r.out), { points: 3 })
  assert.match(r.err, /ms of CPU on this machine|ms on this machine/)
})

test('takes the input from stdin with `--input -`, and `@/name` as an integration writes it', (t) => {
  const root = workspace(t)
  const r = run(join(root, 'foundations/shop'), ['@/courses#grade', '--input', '-'], JSON.stringify({ answers: [1] }))
  assert.equal(r.code, 0, r.err)
  assert.deepEqual(JSON.parse(r.out), { points: 1 })
})

test('finds a library\'s file by its full name, from a foundation of the workspace', (t) => {
  const root = workspace(t)
  const r = run(join(root, 'foundations/shop'), ['@lib/grading#score', '--input', join(root, 'in.json'), '--json'])
  assert.equal(r.code, 0, r.err)
  assert.deepEqual(JSON.parse(r.out).answer, { s: 8 })
})

test('⭐ a failure exits 1 and says why; --json prints one object on stdout', (t) => {
  const root = workspace(t)
  const human = run(join(root, 'foundations/shop'), ['courses#rename', '--input', join(root, 'in.json')])
  assert.equal(human.code, 1)
  assert.equal(human.out, '')
  assert.match(human.err, /Cannot assign to read only property 'name'.*class field/s)

  const machine = run(join(root, 'foundations/shop'), ['courses#rename', '--input', join(root, 'in.json'), '--json'])
  assert.equal(machine.code, 1)
  const result = JSON.parse(machine.out)
  assert.equal(result.ok, false)
  assert.match(result.failure, /^It threw TypeError/)
})

test('names what it can\'t find: the file, the function, and a missing input', (t) => {
  const root = workspace(t)
  const shop = join(root, 'foundations/shop')
  assert.match(run(shop, ['nope#grade', '--input', join(root, 'in.json')]).err, /no vendor file `nope`: `vendors\/nope.js` isn't there/)
  assert.match(run(shop, ['courses#nope', '--input', join(root, 'in.json')]).err, /doesn't export `nope`\. It exports `grade`, `rename`/)
  assert.match(run(shop, ['@lib/other#x', '--input', join(root, 'in.json')]).err, /No package here defines `@lib\/other`/)
  assert.match(run(shop, ['courses', '--input', join(root, 'in.json')]).err, /`<file>#<function>`/)
  assert.match(run(root, ['courses#grade', '--input', join(root, 'in.json')]).err, /not a foundation or a library/)
})

test('⛔ never reads stdin unasked: without --input it says so at once, even with stdin an open pipe', (t) => {
  const root = workspace(t)
  const r = spawnSync(process.execPath, [CLI, 'vendor', 'run', 'courses#grade'], {
    cwd: join(root, 'foundations/shop'),
    stdio: ['pipe', 'pipe', 'pipe'],
    encoding: 'utf8',
    timeout: 10000,
  })
  assert.equal(r.status, 1)
  assert.match(r.stderr, /--input -/)
})

test('takes `--input=<file>` too', (t) => {
  const root = workspace(t)
  const r = run(join(root, 'foundations/shop'), ['courses#grade', `--input=${join(root, 'in.json')}`])
  assert.equal(r.code, 0, r.err)
  assert.deepEqual(JSON.parse(r.out), { points: 3 })
})
