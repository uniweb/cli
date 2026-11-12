/**
 * Vendor files at `register`: one `@uniweb/vendor-schema` artifact per file, in the call of the
 * package that defines it, then its bytes, addressed by their sha256 (`vendor-uploads`). A library's
 * go up after the library's call and before the foundation that names them; a foundation's own after
 * its call, and again on a re-run that its 409 answers.
 *
 * The bytes are the wire agreed with the registry: the artifact is `{ model, name, exports, sha256,
 * size }`, the foundation-schema carries `vendors: { refs: [{ name }] }`, and the upload call is
 * `{ name, sha256, size }`, answered with one `code-uploads` target plus `mode` and `version`.
 *
 * Run: `pnpm test` or `node --test test/`
 */

import { runVerb, tmp } from './helpers/run-verb.js' // before the verb — see the helper
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync, utimesSync } from 'node:fs'
import { dirname, join } from 'node:path'

const ORIGIN = 'http://registry.test'
const ENV = { UNIWEB_SERVER: ORIGIN, UNIWEB_TOKEN: 'test-token' }
const GRADER = 'export function grade(input) {\n  return { points: input.answers.length }\n}\nexport const eligible = (input) => ({ ok: true })\n'
const SCORE = 'export function score(input) {\n  return { s: 1 }\n}\n'
const sha = (s) => createHash('sha256').update(s).digest('hex')
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

function put(root, files) {
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true })
    writeFileSync(join(root, rel), body)
  }
}

/** A workspace: the built foundation `@acme/shop` with its own `vendors/courses.js`, carrying `@lib/grading` from a library. */
function workspace() {
  const root = tmp('uw-vendors-')
  put(root, {
    'pnpm-workspace.yaml': 'packages:\n  - foundations/*\n  - libraries/*\n',
    'package.json': JSON.stringify({ name: 'w', private: true }),
    'libraries/grading/package.json': JSON.stringify({ name: 'grading', uniweb: { scope: '@lib' } }),
    'libraries/grading/vendors/grading.js': SCORE,
    'libraries/grading/vendors/unused.js': 'export function x() { return {} }\n',
    'foundations/shop/package.json': JSON.stringify({ name: 'shop', type: 'module', version: '0.1.0', main: '_entry.generated.js' }),
    'foundations/shop/main.js': "export default { name: '@acme/shop', vendors: ['@lib/grading'] }\n",
    'foundations/shop/vendors/courses.js': GRADER,
    'foundations/shop/dist/entry.js': 'export default {}\n',
    'foundations/shop/dist/entry-ssr.js': 'export default {}\n',
    'foundations/shop/dist/meta/schema.json': JSON.stringify({
      _self: { name: '@acme/shop', version: '0.1.0' },
      _vendors: { '@/courses': { exports: ['eligible', 'grade'] }, '@lib/grading': { exports: ['score'] } },
    }),
  })
  const shop = join(root, 'foundations/shop')
  const past = Date.now() / 1000 - 3600
  for (const f of ['package.json', 'main.js', 'vendors/courses.js']) utimesSync(join(shop, f), past, past)
  for (const f of ['package.json', 'vendors/grading.js', 'vendors/unused.js']) utimesSync(join(root, 'libraries/grading', f), past, past)
  const future = Date.now() / 1000 + 3600
  for (const f of ['entry.js', 'entry-ssr.js', 'meta/schema.json']) utimesSync(join(shop, 'dist', f), future, future)
  return shop
}

/** A registry that holds what it is sent; `stored` is the sha256s it already has bytes for. */
function registry({ stored = [], foundation = () => json({ foundation_schema: { registered: { name: '@acme/shop', version: '0.1.0' } } }), mode = 'presigned', refuseUpload = null } = {}) {
  const calls = []
  const respond = async (url, init = {}) => {
    const body = typeof init.body === 'string' ? init.body : null
    if (url === `${ORIGIN}/dev/registry/register`) {
      const doc = JSON.parse(body)
      const isFoundation = doc.entities.some((e) => e.model === '@uniweb/foundation-schema')
      calls.push({ call: 'register', doc })
      if (isFoundation) return foundation(doc)
      return json({ data_schemas: [], vendors: doc.entities.map((e) => ({ registered: { name: e.name, version: 1, artifact_uuid: 'u' }, unchanged: false })) })
    }
    if (url === `${ORIGIN}/dev/registry/vendor-uploads`) {
      const ask = JSON.parse(body)
      calls.push({ call: 'vendor-uploads', ask })
      if (refuseUpload) return refuseUpload(ask)
      if (stored.includes(ask.sha256)) return json({ mode, version: 1, present: true })
      const url = mode === 'direct' ? `/dev/registry/vendor/${ask.name}/1` : `https://store.test/${ask.name}`
      return json({ mode, version: 1, present: false, method: 'PUT', url, headers: { 'content-type': 'text/javascript' } })
    }
    if (String(url).startsWith('https://store.test/') || String(url).startsWith(`${ORIGIN}/dev/registry/vendor/`)) {
      calls.push({ call: 'put', url: String(url), headers: init.headers, bytes: Buffer.from(init.body).toString('utf8') })
      return new Response(null, { status: 200 })
    }
    if (url === `${ORIGIN}/dev/registry/code-uploads`) {
      calls.push({ call: 'code-uploads' })
      return json({ mode: 'direct', uploads: JSON.parse(body).files.map((f) => ({ path: f.path, present: true })) })
    }
    if (url === `${ORIGIN}/dev/orgs`) return json({ account_handle: 'jane', orgs: [{ handle: 'acme' }, { handle: 'lib' }] })
  }
  return { calls, respond }
}

const order = (calls) => calls.map((c) => (c.call === 'register' ? `register ${c.doc.entities.some((e) => e.model === '@uniweb/foundation-schema') ? 'foundation' : 'library'}` : c.call === 'vendor-uploads' ? `upload ${c.ask.name}` : c.call))

test('⭐ a foundation: the library\'s file registered and uploaded first, then the foundation, then its own file', async () => {
  const { register } = await import('../src/commands/register.js')
  const { calls, respond } = registry()
  const run = await runVerb(workspace(), register, [], { env: ENV, respond })
  assert.equal(run.exitCode, 0, run.output)
  assert.deepEqual(order(calls), [
    'register library', 'upload @lib/grading', 'put',
    'register foundation', 'upload @acme/courses', 'put',
    'code-uploads',
  ])
  // The library's call: only the file the foundation carries, literal.
  assert.deepEqual(calls[0].doc.entities, [
    { model: '@uniweb/vendor-schema', name: '@lib/grading', exports: ['score'], sha256: sha(SCORE), size: Buffer.byteLength(SCORE) },
  ])
  // The foundation's call: its own file, then the foundation naming both.
  const fdoc = calls[3].doc
  assert.deepEqual(fdoc.entities[0], {
    model: '@uniweb/vendor-schema', name: '@acme/courses', exports: ['eligible', 'grade'], sha256: sha(GRADER), size: Buffer.byteLength(GRADER),
  })
  assert.deepEqual(fdoc.entities.at(-1).vendors, { refs: [{ name: '@acme/courses' }, { name: '@lib/grading' }] })
  // The upload call and the PUT: by sha256, the bytes as written, no bearer on a presigned URL.
  assert.deepEqual(calls[4].ask, { name: '@acme/courses', sha256: sha(GRADER), size: Buffer.byteLength(GRADER) })
  assert.equal(calls[5].bytes, GRADER)
  assert.equal(calls[5].headers['x-uniweb-sha256'], sha(GRADER))
  assert.equal(calls[5].headers['content-type'], 'text/javascript')
  assert.equal(calls[5].headers.Authorization, undefined)
  assert.match(run.output, /from libraries\/grading\/: vendor files @lib\/grading — registered from there first/)
  assert.match(run.output, /vendor files defined: @acme\/courses/)
})

test('a file the registry already stores is not sent again', async () => {
  const { register } = await import('../src/commands/register.js')
  const { calls, respond } = registry({ stored: [sha(GRADER), sha(SCORE)] })
  const run = await runVerb(workspace(), register, [], { env: ENV, respond })
  assert.equal(run.exitCode, 0, run.output)
  assert.equal(calls.filter((c) => c.call === 'put').length, 0)
  assert.match(run.output, /@acme\/courses@1 \(already stored\)/)
})

test('direct mode: the PUT goes to the backend, with the bearer', async () => {
  const { register } = await import('../src/commands/register.js')
  const { calls, respond } = registry({ mode: 'direct' })
  const run = await runVerb(workspace(), register, [], { env: ENV, respond })
  assert.equal(run.exitCode, 0, run.output)
  const puts = calls.filter((c) => c.call === 'put')
  assert.equal(puts.length, 2)
  assert.equal(puts[1].url, `${ORIGIN}/dev/registry/vendor/@acme/courses/1`)
  assert.equal(puts[1].headers.Authorization, 'Bearer test-token')
})

test('⭐ a re-run the foundation\'s 409 answers still delivers its own file — by sha256, with no version to know', async () => {
  const { register } = await import('../src/commands/register.js')
  const { calls, respond } = registry({
    foundation: () => json({ title: 'Conflict', version: '0.1.0', detail: 'already registered' }, 409),
  })
  const run = await runVerb(workspace(), register, [], { env: ENV, respond })
  assert.equal(run.exitCode, 0, run.output)
  assert.deepEqual(order(calls).slice(3), ['register foundation', 'upload @acme/courses', 'put', 'code-uploads'])
})

test('a refused upload stops the release in the registry\'s words', async () => {
  const { register } = await import('../src/commands/register.js')
  const { calls, respond } = registry({
    refuseUpload: (ask) => json({ title: 'Not Found', detail: `no registered version of \`${ask.name}\` holds sha256 ${ask.sha256}: register it first`, code: 'vendor_not_registered' }, 404),
  })
  const run = await runVerb(workspace(), register, [], { env: ENV, respond })
  assert.equal(run.exitCode, 1)
  assert.match(run.output, /Vendor file refused: HTTP 404/)
  assert.match(run.output, /no registered version of `@lib\/grading` holds sha256/)
  assert.equal(calls.some((c) => c.call === 'register' && c.doc.entities.some((e) => e.model === '@uniweb/foundation-schema')), false)
})

test('--schema-only registers the files and uploads nothing', async () => {
  const { register } = await import('../src/commands/register.js')
  const { calls, respond } = registry()
  const run = await runVerb(workspace(), register, ['--schema-only'], { env: ENV, respond })
  assert.equal(run.exitCode, 0, run.output)
  assert.deepEqual(order(calls), ['register library', 'register foundation'])
})

test('register in a library of vendor files alone registers and uploads them, with no foundation', async () => {
  const root = tmp('uw-libvendors-')
  put(root, {
    'package.json': JSON.stringify({ name: 'grading', uniweb: { scope: '@lib' } }),
    'vendors/grading.js': SCORE,
  })
  const { register } = await import('../src/commands/register.js')
  const { calls, respond } = registry()
  const run = await runVerb(root, register, [], { env: ENV, respond })
  assert.equal(run.exitCode, 0, run.output)
  assert.deepEqual(order(calls), ['register library', 'upload @lib/grading', 'put'])
  assert.match(run.output, /Registered 1 vendor file\(s\) under @lib/)
})
