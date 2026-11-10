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
import { mkdirSync, readFileSync, writeFileSync, utimesSync } from 'node:fs'
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
async function register({ library, held = [], orgs = { account_handle: 'jane', orgs: [{ handle: 'acme' }] }, args = ['--schema-only'], setup } = {}) {
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
  const shop = workspace()
  if (setup) setup(shop, dirname(dirname(shop)))
  const run = await runVerb(shop, register, args, { env: ENV, respond })
  return { ...run, sent }
}

/** Write files under `root`. */
function put(root, files) {
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true })
    writeFileSync(join(root, rel), body)
  }
}

/** Rewrite the built foundation's `dataSchemas`, as a build naming those types would have. */
function named(shop, dataSchemas) {
  const path = join(shop, 'dist/meta/schema.json')
  writeFileSync(path, JSON.stringify({ _self: { name: '@acme/shop', version: '0.1.0' }, dataSchemas }))
  const future = Date.now() / 1000 + 3600
  utimesSync(path, future, future)
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
  const schemas = Object.fromEntries(['@/order', '@acme/member', '@acme/plan', '@std/person', '@acme/gone'].map((ref) => [ref, { fields: {} }]))
  const found = await typesFromLibraries({ schemas, foundationDir: shop })
  assert.deepEqual(found, [{ dir: join(dirname(dirname(shop)), 'libraries/data'), scope: '@acme', refs: ['@acme/plan'] }])
})

test('⭐ libraries go in the order their types reference each other: a referenced one first', async () => {
  const run = await register({
    library: (names) => registered(names),
    setup: (shop, root) => {
      put(root, {
        'libraries/people/package.json': JSON.stringify({ name: 'people', uniweb: { scope: '@acme' } }),
        'libraries/people/schemas/person.yml': 'name: person\nfields:\n  name: { type: string }\n'
      })
      // The build lists a type before the types it references.
      named(shop, {
        '@acme/plan': { name: 'plan', fields: { owner: { type: 'ref', ref: '@acme/person' } } },
        '@acme/person': { name: 'person', fields: { name: { type: 'string' } } }
      })
    }
  })
  assert.equal(run.exitCode, 0, run.output)
  assert.deepEqual(run.sent.map((s) => s.names), [['@acme/person'], ['@acme/plan'], ['@acme/shop']])
})

test("a library sends the types the foundation names from it, not the rest of its files", async () => {
  const run = await register({
    library: (names) => registered(names),
    setup: (shop, root) => put(root, { 'libraries/data/schemas/order.yml': 'name: order\nfields:\n  amount: { type: number }\n' })
  })
  assert.equal(run.exitCode, 0, run.output)
  assert.deepEqual(run.sent[0], { foundation: false, names: ['@acme/plan'] })
})

test("a refusal with a reason stops the release, whoever the account is, even with the type held", async () => {
  const run = await register({
    library: () => json({ detail: 'data-schema `@acme/plan` cannot be republished: records of it lack `price`.', reason: 'destructive_republish' }, 409),
    held: ['@acme/plan'],
    orgs: { account_handle: 'jane', orgs: [] }
  })
  assert.equal(run.exitCode, 1, run.output)
  assert.deepEqual(run.sent.map((s) => s.foundation), [false])
  assert.match(run.output, /cannot be republished/)
})

test('CONTROL: an orgs answer that does not parse is unknown, and the refusal stops the release', async () => {
  const sent = []
  const respond = async (url, init) => {
    if (url === `${ORIGIN}/dev/registry/register`) {
      const doc = JSON.parse(init.body)
      sent.push(doc.entities.some((e) => e.model === '@uniweb/foundation-schema'))
      return json({ detail: 'not allowed' }, 400)
    }
    if (url === `${ORIGIN}/dev/orgs`) return new Response('<html>a proxy page</html>', { status: 200 })
    if (/data-schemas/.test(url)) return json({ name: '@acme/plan' })
  }
  const { register: run } = await import('../src/commands/register.js')
  const result = await runVerb(workspace(), run, ['--schema-only'], { env: ENV, respond })
  assert.equal(result.exitCode, 1, result.output)
  assert.deepEqual(sent, [false])
})

test("a type schemas.config.js routes is read from the route, so no library registers it", async () => {
  const run = await register({
    library: () => assert.fail('a routed type was sent from the library'),
    setup: (shop) => put(shop, {
      'schemas.config.js': "export default { '@acme/plan': './overrides/plan.yml' }\n",
      'overrides/plan.yml': 'name: plan\nfields:\n  title: { type: string }\n  price: { type: string }\n'
    })
  })
  assert.equal(run.exitCode, 0, run.output)
  assert.deepEqual(run.sent.map((s) => s.foundation), [true])
})

test("a library inside the foundation's own folder is a library too", async () => {
  const run = await register({
    library: (names) => registered(names),
    setup: (shop) => {
      put(shop, {
        'types/package.json': JSON.stringify({ name: 'types', uniweb: { scope: '@acme' } }),
        'types/schemas/kind.yml': 'name: kind\nfields:\n  label: { type: string }\n'
      })
      const pkg = JSON.parse(readFileSync(join(shop, 'package.json'), 'utf8'))
      writeFileSync(join(shop, 'package.json'), JSON.stringify({ ...pkg, dependencies: { ...pkg.dependencies, types: 'file:./types' } }))
      const past = Date.now() / 1000 - 3600
      utimesSync(join(shop, 'package.json'), past, past)
      named(shop, { '@acme/kind': { name: 'kind', fields: { label: { type: 'string' } } } })
    }
  })
  assert.equal(run.exitCode, 0, run.output)
  assert.deepEqual(run.sent[0], { foundation: false, names: ['@acme/kind'] })
})

test('register in an @org/schemas package with no uniweb.scope names its types under @org', async () => {
  const dir = tmp('uw-orgschemas-')
  put(dir, {
    'package.json': JSON.stringify({ name: '@acme/schemas', type: 'module' }),
    'schemas/plan.yml': 'name: plan\nfields:\n  title: { type: string }\n'
  })
  const { register: run } = await import('../src/commands/register.js')
  const result = await runVerb(dir, run, ['--dry-run'], { env: ENV })
  assert.equal(result.exitCode, 0, result.output)
  assert.match(result.output, /"name": "@acme\/plan"/)
  assert.match(result.output, /scope: @acme \(package\.json uniweb\.scope\)/)
})

