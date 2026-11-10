/**
 * `register` in a foundation registers the types it names that a library defines, from the library,
 * before the foundation (`src/backend/library-types.js`). `push` and `publish` release a site's
 * foundation with `register`, so they do too [Diego, 2026-11-10: "yes, push and publish should
 * register a library's types automatically"].
 *
 * The registry refuses a foundation that names a type it doesn't hold: measured 2026-11-10 on a
 * local backend, a push released a foundation naming `@acme/libplan` from a library it bundles and
 * was answered 400 until `uniweb register` ran in the library.
 *
 * Run: `pnpm test` or `node --test test/`
 */

import { runVerb, tmp } from './helpers/run-verb.js' // before the verb — see the helper
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, utimesSync } from 'node:fs'
import { dirname, join } from 'node:path'

const ORIGIN = 'http://registry.test'
const ENV = { UNIWEB_SERVER: ORIGIN, UNIWEB_TOKEN: 'test-token' }

/**
 * A workspace: the foundation `@acme/shop`, built, naming `@acme/plan` from the library
 * `libraries/data` it bundles, its own `@/order`, and `@acme/member` from the foundation `hub`.
 * The library's entry exports a component, as a library's does.
 */
function workspace() {
  const root = tmp('uw-libtypes-')
  const plan = { name: 'plan', fields: { title: { type: 'string' } } }
  const files = {
    'pnpm-workspace.yaml': 'packages:\n  - foundations/*\n  - libraries/*\n',
    'package.json': JSON.stringify({ name: 'w', private: true }),
    'libraries/data/package.json': JSON.stringify({ name: 'data', type: 'module', exports: { '.': './index.js' }, uniweb: { scope: '@acme' } }),
    'libraries/data/index.js': "export { default as PlanCard } from './components/PlanCard.jsx'\n",
    'libraries/data/components/PlanCard.jsx': 'export default function PlanCard() { return <div /> }\n',
    'libraries/data/schemas/plan.yml': 'name: plan\nfields:\n  title: { type: string }\n',
    'foundations/hub/package.json': JSON.stringify({ name: 'hub', type: 'module', main: './_entry.generated.js' }),
    'foundations/hub/main.js': "export default { name: '@acme/hub' }\n",
    'foundations/hub/schemas/member.yml': 'name: member\nfields:\n  name: { type: string }\n',
    'foundations/shop/package.json': JSON.stringify({
      name: 'shop',
      type: 'module',
      version: '0.1.0',
      main: '_entry.generated.js',
      dependencies: { data: 'file:../../libraries/data' }
    }),
    'foundations/shop/main.js': "export default { name: '@acme/shop' }\n",
    'foundations/shop/schemas/order.yml': 'name: order\nfields:\n  total: { type: number }\n',
    'foundations/shop/dist/entry.js': 'export default {}\n',
    'foundations/shop/dist/entry-ssr.js': 'export default {}\n',
    'foundations/shop/dist/meta/schema.json': JSON.stringify({
      _self: { name: '@acme/shop', version: '0.1.0' },
      dataSchemas: {
        '@/order': { name: 'order', fields: { total: { type: 'decimal' } } },
        '@acme/plan': plan,
        '@acme/member': { name: 'member', fields: { name: { type: 'string' } } }
      }
    })
  }
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true })
    writeFileSync(join(root, rel), body)
  }
  // Built after its sources, so register submits it as it stands.
  const shop = join(root, 'foundations/shop')
  const past = Date.now() / 1000 - 3600
  for (const f of ['package.json', 'main.js', 'schemas/order.yml']) utimesSync(join(shop, f), past, past)
  for (const f of ['libraries/data/package.json', 'libraries/data/index.js', 'libraries/data/components/PlanCard.jsx', 'libraries/data/schemas/plan.yml']) {
    utimesSync(join(root, f), past, past)
  }
  const future = Date.now() / 1000 + 3600
  for (const f of ['entry.js', 'entry-ssr.js', 'meta/schema.json']) utimesSync(join(shop, 'dist', f), future, future)
  return shop
}

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

/**
 * Run `register --schema-only` in the foundation. `library(names)` answers the library's submit;
 * `held` is what the registry holds when asked; `orgs` is the account's orgs read.
 */
async function register({ library, held = [], orgs = { account_handle: 'jane', orgs: [{ handle: 'acme' }] }, args = ['--schema-only'] } = {}) {
  const sent = []
  const respond = async (url, init) => {
    if (url === `${ORIGIN}/dev/registry/register`) {
      const doc = JSON.parse(init.body)
      const names = doc.entities.map((e) => e.name ?? e.info?.name)
      const foundation = doc.entities.some((e) => e.model === '@uniweb/foundation-schema')
      sent.push({ foundation, names })
      if (!foundation) return library(names)
      return json({ foundation_schema: { registered: { name: '@acme/shop', version: '0.1.0' } } })
    }
    if (url === `${ORIGIN}/dev/orgs`) return json(orgs)
    const read = /\/dev\/registry\/data-schemas\/([^/]+)\/([^/]+)$/.exec(url)
    if (read) {
      const ref = `@${decodeURIComponent(read[1])}/${decodeURIComponent(read[2])}`
      return held.includes(ref) ? json({ name: ref }) : json({ detail: 'no such model' }, 404)
    }
  }
  const { register } = await import('../src/commands/register.js')
  const run = await runVerb(workspace(), register, args, { env: ENV, respond })
  return { ...run, sent }
}

const registered = (names, unchanged = false) =>
  json({ data_schemas: names.map((name) => ({ registered: { name, version: '1' }, unchanged })) })

test('⭐ a type a library defines is registered from the library, before the foundation', async () => {
  const run = await register({ library: (names) => registered(names) })
  assert.equal(run.exitCode, 0, run.output)
  assert.deepEqual(run.sent, [
    { foundation: false, names: ['@acme/plan'] },
    { foundation: true, names: ['@acme/order', '@acme/shop'] }
  ])
  assert.match(run.output, /data schemas from libraries\/data\/: @acme\/plan — registered from there first/)
  assert.match(run.output, /Registering the data schemas in libraries\/data\/ \(@acme\/plan\)/)
  assert.match(run.output, /Registered 1 data schema\(s\) under @acme, from libraries\/data\//)
})

test('a library the registry holds as it is: said so, and the foundation goes on', async () => {
  const run = await register({ library: (names) => registered(names, true) })
  assert.equal(run.exitCode, 0, run.output)
  assert.equal(run.sent.length, 2)
  assert.match(run.output, /Unchanged: the registry holds them as they are/)
})

test('a refused library stops the release before the foundation, in the registry\'s words', async () => {
  const run = await register({
    library: () =>
      json(
        {
          detail: 'data-schema `@acme/plan` cannot be republished: publish the new shape under a new name instead.',
          reason: 'destructive_republish'
        },
        409
      )
  })
  assert.equal(run.exitCode, 1, run.output)
  assert.deepEqual(run.sent.map((s) => s.foundation), [false], 'the foundation was submitted')
  assert.match(run.output, /cannot be republished/)
  assert.match(run.output, /destructive_republish/)
  assert.match(run.output, /The foundation was not submitted/)
})

test('another org\'s library, its types registered: the foundation is released against them as registered', async () => {
  const run = await register({
    library: () => json({ detail: 'not allowed' }, 403),
    held: ['@acme/plan'],
    orgs: { account_handle: 'jane', orgs: [{ handle: 'jane-co' }] }
  })
  assert.equal(run.exitCode, 0, run.output)
  assert.deepEqual(run.sent.map((s) => s.foundation), [false, true])
  assert.match(run.output, /@acme\/plan is registered under @acme, whose members change it/)
  assert.doesNotMatch(run.output, /✗/)
})

test('another org\'s library, its types NOT registered: stopped, and a member registers them', async () => {
  const run = await register({
    library: () => json({ detail: 'not allowed' }, 403),
    held: [],
    orgs: { account_handle: 'jane', orgs: [] }
  })
  assert.equal(run.exitCode, 1, run.output)
  assert.deepEqual(run.sent.map((s) => s.foundation), [false])
  assert.match(run.output, /You can't release data schemas under @acme: you're not a member of @acme/)
})

test('--json: the library\'s types are in the entities, with the foundation\'s', async () => {
  const lines = []
  const write = process.stdout.write
  process.stdout.write = (chunk, ...rest) => {
    if (String(chunk).startsWith('{"ok"')) {
      lines.push(String(chunk))
      return true
    }
    return write.call(process.stdout, chunk, ...rest)
  }
  try {
    const run = await register({ library: (names) => registered(names), args: ['--schema-only', '--json'] })
    assert.equal(run.exitCode, 0, run.output)
  } finally {
    process.stdout.write = write
  }
  assert.equal(lines.length, 1)
  const out = JSON.parse(lines[0])
  assert.deepEqual(out.entities.map((e) => e.name), ['@acme/plan', '@acme/order', '@acme/shop'])
})

test('--dry-run says what would be registered first, and asks nothing', async () => {
  const run = await register({ library: () => assert.fail('submitted'), args: ['--dry-run'] })
  assert.equal(run.exitCode, 0, run.output)
  assert.equal(run.requests, 0)
  assert.match(run.output, /data schemas from libraries\/data\/: @acme\/plan — would be registered from there first/)
})

test('CONTROL: a type the foundation defines, or another foundation does, is not a library\'s', async () => {
  const { typesFromLibraries } = await import('../src/backend/library-types.js')
  const shop = workspace()
  const found = await typesFromLibraries({ named: ['@/order', '@acme/member', '@acme/plan', '@std/person', '@acme/gone'], foundationDir: shop })
  assert.deepEqual(found, [{ dir: join(dirname(dirname(shop)), 'libraries/data'), scope: '@acme', refs: ['@acme/plan'] }])
})
