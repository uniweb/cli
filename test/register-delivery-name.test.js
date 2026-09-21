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
import { mkdirSync, writeFileSync, utimesSync } from 'node:fs'
import { join } from 'node:path'

const ORIGIN = 'http://registry.test'
const ENV = { UNIWEB_REGISTER_URL: ORIGIN, UNIWEB_TOKEN: 'test-token' }

/**
 * A built foundation register can submit as it stands. Its source is older than its
 * dist/, so register does not rebuild — which would spawn a real build.
 */
function foundation(pkg) {
  const dir = tmp('uw-reg-name-')
  const version = '0.1.0'
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ version, main: '_entry.generated.js', ...pkg })
  )
  mkdirSync(join(dir, 'dist', 'meta'), { recursive: true })
  writeFileSync(join(dir, 'dist', 'entry.js'), 'export default {}\n')
  writeFileSync(join(dir, 'dist', 'entry-ssr.js'), 'export default {}\n')
  writeFileSync(
    join(dir, 'dist', 'meta', 'schema.json'),
    JSON.stringify({ _self: { name: pkg.uniweb?.id || pkg.name, version } })
  )
  const past = Date.now() / 1000 - 3600
  utimesSync(join(dir, 'package.json'), past, past)
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
  const run = await register(foundation({ name: 'src' }), ['--scope', 'std'])
  assert.deepEqual(run.registered, ['@std/src'], run.output)
  assert.deepEqual(run.planned, ['@std/src'], run.output)
  assert.match(run.output, /Registered @std\/src@0\.1\.0/)
  assert.match(run.output, /Delivering code for .*@std\/src@0\.1\.0/)
})

test('CONTROL: --scope with its @ — the spelling that always worked, still one name', async () => {
  const run = await register(foundation({ name: 'src' }), ['--scope', '@std'])
  assert.deepEqual(run.registered, ['@std/src'], run.output)
  assert.deepEqual(run.planned, ['@std/src'], run.output)
})

test('package.json uniweb.scope without its @ is read the same way', async () => {
  const run = await register(foundation({ name: 'src', uniweb: { scope: 'std' } }), [])
  assert.deepEqual(run.registered, ['@std/src'], run.output)
  assert.deepEqual(run.planned, ['@std/src'], run.output)
  assert.match(run.output, /scope: @std \(package\.json uniweb\.scope\)/)
})

test('an already-scoped package name passes through, whatever the scope says', async () => {
  const run = await register(foundation({ name: '@acme/base' }), ['--scope', 'std'])
  assert.deepEqual(run.registered, ['@acme/base'], run.output)
  assert.deepEqual(run.planned, ['@acme/base'], run.output)
})

test('a scope naming no org is refused before anything is sent — never read as absent', async () => {
  // Absent derives a scope from the login, which would register under an org the
  // caller did not name.
  const run = await register(foundation({ name: 'src' }), ['--scope', '@'])
  assert.equal(run.exitCode, 2, run.output)
  assert.equal(run.requests, 0, run.output)
  assert.match(run.output, /Not an org scope: @/)
})
