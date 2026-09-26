/**
 * A 409 from `register` is not always the duplicate-version rejection a resume expects.
 *
 * Re-running `register` after a partial code delivery hits the duplicate rejection — a 409
 * naming the `version` it refused — and resumes the delivery. ⛔ Until 2026-09-26 EVERY 409 was
 * read that way: a data schema changed where the backend holds records of it is refused with a
 * 409 too (`reason: "destructive_republish"`), and register said "already registered — resuming
 * code delivery", then failed with a 404 for a version that was never registered — the refusal's
 * own sentence, which names the way out, never shown.
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

// A built foundation register submits as it stands (its dist/ newer than its source, so no rebuild).
function foundation() {
  const dir = tmp('uw-reg-409-')
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'src', version: '0.1.0', main: '_entry.generated.js' }))
  writeFileSync(join(dir, 'main.js'), "export default { name: '@std/marketing' }\n")
  mkdirSync(join(dir, 'dist', 'meta'), { recursive: true })
  writeFileSync(join(dir, 'dist', 'entry.js'), 'export default {}\n')
  writeFileSync(join(dir, 'dist', 'entry-ssr.js'), 'export default {}\n')
  writeFileSync(join(dir, 'dist', 'meta', 'schema.json'), JSON.stringify({ _self: { name: '@std/marketing', version: '0.1.0' } }))
  const past = Date.now() / 1000 - 3600
  for (const f of ['package.json', 'main.js']) utimesSync(join(dir, f), past, past)
  const future = Date.now() / 1000 + 3600
  for (const f of ['entry.js', 'entry-ssr.js', 'meta/schema.json']) utimesSync(join(dir, 'dist', f), future, future)
  return dir
}

const json = (body, status) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/problem+json' } })

// The registry answers the submit with `conflict`; a code-delivery plan, if one is asked for, is recorded and refused.
async function register(conflict) {
  const planned = []
  const respond = async (url, init) => {
    if (url === `${ORIGIN}/dev/registry/register`) return json(conflict, 409)
    if (url === `${ORIGIN}/dev/registry/code-uploads`) {
      planned.push(JSON.parse(init.body).name)
      return json({ detail: 'stopped by the test', code: 'test_stop' }, 409)
    }
  }
  const { register } = await import('../src/commands/register.js')
  const run = await runVerb(foundation(), register, [], { env: ENV, respond })
  return { ...run, planned }
}

test('⭐ a 409 that names a reason is a refusal: said in its own words, and no code is delivered', async () => {
  const run = await register({
    status: 409,
    title: 'Conflict',
    detail: 'data-schema `@std/member` cannot be republished: publish the new shape under a new name (`@std/member-v2`) instead.',
    reason: 'destructive_republish',
    name: '@std/member',
  })
  assert.deepEqual(run.planned, [], run.output)
  assert.doesNotMatch(run.output, /resuming code delivery/)
  assert.match(run.output, /publish the new shape under a new name/)
  assert.match(run.output, /destructive_republish/)
  assert.equal(run.exitCode, 1, run.output)
})

test('CONTROL: the duplicate-version 409 — it names the version — still resumes the delivery', async () => {
  const run = await register({ status: 409, title: 'Conflict', detail: 'version exists', name: '@std/marketing', version: '0.1.0' })
  assert.match(run.output, /resuming code delivery/)
  assert.deepEqual(run.planned, ['@std/marketing'], run.output)
})
