/**
 * `uniweb register` delivers a foundation's code under the name it REGISTERED.
 *
 * Phase 1 submits a `.uwx` whose foundation-schema `info.name` is `@org/name`, built
 * from the scope by `@uniweb/build` — which reads `acme` and `@acme` alike. Phase 2
 * asks for an upload plan by name, and the plan authorizes against the registered
 * (name, version), so the two must be one name — and a scoped one, `@scope/name`.
 *
 * They were two until 2026-09-21. Phase 2 composed its own name from the RAW scope, so
 * `register --scope std` registered `@std/src` and then asked to deliver `std/src`,
 * which a registry refuses. Every case was green here because no test passed a scope
 * without its `@` — the one spelling the `.uwx` assembly accepted and phase 2 did not.
 *
 * Run: `pnpm test` or `node --test test/`
 */

import { runVerb, tmp } from './helpers/run-verb.js' // before the verb — see the helper
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync, utimesSync } from 'node:fs'
import { join } from 'node:path'

const ORIGIN = 'http://registry.test'
const ENV = { UNIWEB_REGISTER_URL: ORIGIN, UNIWEB_TOKEN: 'test-token' }

/**
 * A built foundation register can submit as it stands. Its source is older than its
 * dist/, so register does not rebuild — which would spawn a real build. `name` is
 * main.js's `name`, when given; the built schema carries the name the build would
 * read — main.js's, else the package's.
 *
 * ⭐ dist/ is dated in the FUTURE as well: register writes the scope it chooses into
 * main.js's name (2026-09-22), and a main.js written during the run must not read as
 * newer than the build — a real register rebuilds then, which is right for a user and
 * a real build here.
 */
function foundation(pkg, { name } = {}) {
  const dir = tmp('uw-reg-name-')
  const version = '0.1.0'
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ version, main: '_entry.generated.js', ...pkg })
  )
  const sources = [join(dir, 'package.json')]
  if (name) {
    writeFileSync(join(dir, 'main.js'), `export default { name: '${name}' }\n`)
    sources.push(join(dir, 'main.js'))
  }
  mkdirSync(join(dir, 'dist', 'meta'), { recursive: true })
  writeFileSync(join(dir, 'dist', 'entry.js'), 'export default {}\n')
  writeFileSync(join(dir, 'dist', 'entry-ssr.js'), 'export default {}\n')
  writeFileSync(
    join(dir, 'dist', 'meta', 'schema.json'),
    JSON.stringify({ _self: { name: name || pkg.name, version } })
  )
  const past = Date.now() / 1000 - 3600
  for (const f of sources) utimesSync(f, past, past)
  const future = Date.now() / 1000 + 3600
  for (const f of ['entry.js', 'entry-ssr.js', 'meta/schema.json']) {
    utimesSync(join(dir, 'dist', f), future, future)
  }
  return dir
}

const json = (body, status) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  })

/**
 * The registry as far as register reaches it: phase 1 accepted, phase 2's plan request
 * recorded and then refused, so the run stops there. `registered` and `planned` are
 * the names each phase SENT.
 */
function registry() {
  const registered = []
  const planned = []
  const respond = async (url, init) => {
    if (url === `${ORIGIN}/dev/registry/register`) {
      const doc = JSON.parse(init.body)
      registered.push(
        doc.entities.find((e) => e.model === '@uniweb/foundation-schema')?.info?.name
      )
      return json({}, 200)
    }
    if (url === `${ORIGIN}/dev/registry/code-uploads`) {
      planned.push(JSON.parse(init.body).name)
      return json({ detail: 'stopped by the test', code: 'test_stop' }, 409)
    }
  }
  return { registered, planned, respond }
}

async function register(dir, args) {
  const { register } = await import('../src/commands/register.js')
  const reg = registry()
  const run = await runVerb(dir, register, args, { env: ENV, respond: reg.respond })
  return { ...run, ...reg }
}

test('--scope WITHOUT its @: the code is delivered under the registered @org name', async () => {
  const dir = foundation({ name: 'src' }, { name: 'marketing' })
  const run = await register(dir, ['--scope', 'std'])
  assert.deepEqual(run.registered, ['@std/marketing'], run.output)
  assert.deepEqual(run.planned, ['@std/marketing'], run.output)
  assert.match(run.output, /Registered @std\/marketing@0\.1\.0/)
  assert.match(run.output, /Delivering code for .*@std\/marketing@0\.1\.0/)
  // ⭐ …and the scope is kept in the name, so it is chosen once (2026-09-22).
  assert.match(readFileSync(join(dir, 'main.js'), 'utf8'), /name: '@std\/marketing'/)
})

test('CONTROL: --scope with its @ — the spelling that always worked, still one name', async () => {
  const run = await register(foundation({ name: 'src' }, { name: 'marketing' }), ['--scope', '@std'])
  assert.deepEqual(run.registered, ['@std/marketing'], run.output)
  assert.deepEqual(run.planned, ['@std/marketing'], run.output)
})

test('a scoped name needs no --scope: the scope is the one in the name', async () => {
  const run = await register(foundation({ name: 'src' }, { name: '@std/marketing' }), [])
  assert.deepEqual(run.registered, ['@std/marketing'], run.output)
  assert.deepEqual(run.planned, ['@std/marketing'], run.output)
  assert.match(run.output, /scope: @std \(main\.js\)/)
})

test('⛔ a leftover package.json uniweb.scope is refused before anything is sent, naming the line', async () => {
  // Retired 2026-09-22: the scope is part of the name. A leftover would have put the
  // name and the data schemas under two different orgs.
  const run = await register(
    foundation({ name: 'src', uniweb: { scope: 'std' } }, { name: 'marketing' }),
    []
  )
  assert.equal(run.exitCode, 2, run.output)
  assert.equal(run.requests, 0, run.output)
  assert.match(run.output, /uniweb\.scope` is no longer read/)
  assert.match(run.output, /name: '@std\/marketing'/)
})

test('with no main.js name, the package name is the name — and the scope is written into main.js', async () => {
  const dir = foundation({ name: 'marketing' })
  const run = await register(dir, ['--scope', 'std'])
  assert.deepEqual(run.registered, ['@std/marketing'], run.output)
  assert.deepEqual(run.planned, ['@std/marketing'], run.output)
  assert.match(readFileSync(join(dir, 'main.js'), 'utf8'), /name: '@std\/marketing'/)
})

// ── a name that cannot register ──────────────────────────────────────────────
//
// `src` and `foundation` are the folder the code sits in. Every project scaffolded
// before the name moved to main.js has package name `src`, so each would register
// the same `@org/src`. With nobody to ask (these runs are CI=1), register refuses —
// before a build, a login or a request — and prints the line to add.

test('⛔ a foundation named src is refused before anything is sent, naming the fix', async () => {
  const run = await register(foundation({ name: 'src' }), ['--scope', 'std'])
  assert.equal(run.exitCode, 2, run.output)
  assert.equal(run.requests, 0, run.output)
  assert.match(run.output, /"src" names the folder, not the foundation/)
  // the suggestion is the foundation's folder, normalized
  assert.match(run.output, /name: 'uw-reg-name-[a-z0-9-]+',/)
})

test('⛔ …and so is `foundation`, and main.js naming it src does not help', async () => {
  const bare = await register(foundation({ name: 'foundation' }), ['--scope', 'std'])
  assert.equal(bare.exitCode, 2, bare.output)
  assert.equal(bare.requests, 0, bare.output)
  const viaMain = await register(foundation({ name: 'x' }, { name: 'src' }), ['--scope', 'std'])
  assert.equal(viaMain.exitCode, 2, viaMain.output)
  assert.equal(viaMain.requests, 0, viaMain.output)
})

test('⛔ a --dry-run refuses too — a preview writes nothing, so it cannot ask', async () => {
  const run = await register(foundation({ name: 'src' }), ['--scope', 'std', '--dry-run'])
  assert.equal(run.exitCode, 2, run.output)
  assert.match(run.output, /no name it can register under/)
})

test('⛔ a leftover uniweb.id is refused, naming where the name lives now', async () => {
  const run = await register(foundation({ name: 'src', uniweb: { id: 'docs' } }), ['--scope', 'std'])
  assert.equal(run.exitCode, 2, run.output)
  assert.equal(run.requests, 0, run.output)
  assert.match(run.output, /uniweb\.id` is no longer read/)
  assert.match(run.output, /name: 'docs'/)
})

test('an already-scoped package name registers under its own scope', async () => {
  const run = await register(foundation({ name: '@acme/base' }), [])
  assert.deepEqual(run.registered, ['@acme/base'], run.output)
  assert.deepEqual(run.planned, ['@acme/base'], run.output)
})

test('⛔ a --scope that contradicts a scoped name is refused before anything is sent', async () => {
  // Until 2026-09-22 the name kept its scope while the data schemas took --scope — one
  // foundation, two orgs. Which one was meant is not ours to guess.
  const run = await register(foundation({ name: '@acme/base' }), ['--scope', 'std'])
  assert.equal(run.exitCode, 2, run.output)
  assert.equal(run.requests, 0, run.output)
  assert.match(run.output, /registers under @acme — --scope @std names another org/)
  assert.match(run.output, /name: '@std\/base'/)
})

test('a scope naming no org is refused before anything is sent — never read as absent', async () => {
  // Absent derives a scope from the login, which would register under an org the
  // caller did not name.
  const run = await register(foundation({ name: 'marketing' }), ['--scope', '@'])
  assert.equal(run.exitCode, 2, run.output)
  assert.equal(run.requests, 0, run.output)
  assert.match(run.output, /Not an org scope: @/)
})
