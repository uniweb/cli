/**
 * ⭐ A RELEASE INTO A SCOPE YOU ARE NOT A MEMBER OF IS SAID AS THAT *[Diego, 2026-10-06]* —
 * "You can't release @agency/theme: you're not a member of @agency" — with the ways on:
 * `--no-release` where a released version exists, or a member releasing it.
 *
 * ⛔ Until then `register` answered the refusal with "log in again", and a push or publish
 * that released the foundation along with it said only "Foundation release failed: Command
 * failed: node … register". The registry still decides membership; the orgs read only
 * names it after a refusal, and nothing here gates a release.
 *
 * Run: `pnpm test` or `node --test test/`
 */

import { runVerb, tmp } from './helpers/run-verb.js' // before the verb — see the helper
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { belongsToScope } from '../src/utils/registry-orgs.js'
import { explainReleaseFailure } from '../src/backend/foundation-bring-along.js'

const ORIGIN = 'http://registry.test'
const ENV = { UNIWEB_SERVER: ORIGIN, UNIWEB_TOKEN: 'test-token' }

test('belongsToScope: your own handle, or an org you belong to — from the orgs read', () => {
  const env = { account_handle: 'jane', orgs: [{ handle: 'acme' }] }
  assert.equal(belongsToScope('@jane', env), true)
  assert.equal(belongsToScope('@acme', env), true)
  assert.equal(belongsToScope('@acme/theme', env), true)
  assert.equal(belongsToScope('acme', env), true)
  assert.equal(belongsToScope('@agency', env), false)
  // nothing to say
  assert.equal(belongsToScope(null, env), null)
  assert.equal(belongsToScope('@agency', null), null)
})

/** A foundation named `name` in src/main.js. */
function scopedFoundation(name) {
  const dir = mkdtempSync(join(tmpdir(), 'uw-member-'))
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'src', version: '0.2.0', type: 'module' }))
  mkdirSync(join(dir, 'src'))
  writeFileSync(join(dir, 'src', 'main.js'), `export default { name: '${name}' }\n`)
  return dir
}

const orgsClient = (envelope) => ({
  fetchOrgs: async () => {
    if (envelope instanceof Error) throw envelope
    return envelope
  }
})

test('a release refused in a scope you are not a member of: said, with --no-release when a version is released', async () => {
  const failed = new Error('Command failed: node uniweb register')
  const err = await explainReleaseFailure(failed, {
    client: orgsClient({ account_handle: 'jane', orgs: [{ handle: 'client' }] }),
    local: { dir: scopedFoundation('@agency/theme') },
    reg: { latest_version: '1.4.0' },
    verb: 'publish'
  })
  assert.equal(err.notMember, true)
  // register has just said why (its own output); the push says what that means for it.
  assert.equal(err.message, '@agency/theme was not released, so nothing was sent.')
  assert.match(err.ways[0], /released 1\.4\.0: `uniweb publish --no-release`/)
  assert.match(err.ways[1], /member of @agency/)
})

test('never released: the only way on is a member releasing it — no --no-release to offer', async () => {
  const err = await explainReleaseFailure(new Error('x'), {
    client: orgsClient({ account_handle: 'jane', orgs: [] }),
    local: { dir: scopedFoundation('@agency/theme') },
    reg: null,
    verb: 'push'
  })
  assert.equal(err.notMember, true)
  assert.deepEqual(err.ways, ['Ask a member of @agency to release it.'])
})

test('CONTROL: a member\'s failed release, or an orgs read that fails, passes through as it came', async () => {
  const failed = new Error('Command failed: node uniweb register')
  const member = await explainReleaseFailure(failed, {
    client: orgsClient({ account_handle: 'jane', orgs: [{ handle: 'agency' }] }),
    local: { dir: scopedFoundation('@agency/theme') },
    reg: { latest_version: '1.4.0' },
    verb: 'publish'
  })
  assert.equal(member, failed)
  const unknown = await explainReleaseFailure(failed, {
    client: orgsClient(new Error('offline')),
    local: { dir: scopedFoundation('@agency/theme') },
    reg: null,
    verb: 'publish'
  })
  assert.equal(unknown, failed)
})

// ── `register` itself ─────────────────────────────────────────────────────────

// A built foundation register submits as it stands (its dist/ newer than its source).
function builtFoundation() {
  const dir = tmp('uw-reg-403-')
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'src', version: '0.1.0', main: '_entry.generated.js' }))
  writeFileSync(join(dir, 'main.js'), "export default { name: '@agency/theme' }\n")
  mkdirSync(join(dir, 'dist', 'meta'), { recursive: true })
  writeFileSync(join(dir, 'dist', 'entry.js'), 'export default {}\n')
  writeFileSync(join(dir, 'dist', 'entry-ssr.js'), 'export default {}\n')
  writeFileSync(join(dir, 'dist', 'meta', 'schema.json'), JSON.stringify({ _self: { name: '@agency/theme', version: '0.1.0' } }))
  const past = Date.now() / 1000 - 3600
  for (const f of ['package.json', 'main.js']) utimesSync(join(dir, f), past, past)
  const future = Date.now() / 1000 + 3600
  for (const f of ['entry.js', 'entry-ssr.js', 'meta/schema.json']) utimesSync(join(dir, 'dist', f), future, future)
  return dir
}

const json = (body, status) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/problem+json' } })

async function registerRefused(orgs) {
  const respond = async (url) => {
    if (url === `${ORIGIN}/dev/registry/register`) return json({ status: 403, title: 'Forbidden' }, 403)
    if (url === `${ORIGIN}/dev/orgs`) return json({ account_handle: 'jane', orgs }, 200)
  }
  const { register } = await import('../src/commands/register.js')
  return runVerb(builtFoundation(), register, [], { env: ENV, respond })
}

test('⭐ register: a 403 for a scope you are not a member of names the membership, not your credentials', async () => {
  const run = await registerRefused([{ handle: 'client' }])
  assert.equal(run.exitCode, 1, run.output)
  assert.match(run.output, /You can't release @agency\/theme: you're not a member of @agency\./)
  assert.doesNotMatch(run.output, /didn't accept your credentials/)
})

test('CONTROL: register: a 403 while you ARE a member is still a credential problem', async () => {
  const run = await registerRefused([{ handle: 'agency' }])
  assert.equal(run.exitCode, 1, run.output)
  assert.match(run.output, /didn't accept your credentials/)
  assert.doesNotMatch(run.output, /not a member/)
})
