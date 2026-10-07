/**
 * ⭐ A BARE NAME REGISTERS UNDER THE WORKSPACE THE COMMAND WORKS IN *[Diego, 2026-10-06]* —
 * an organization's handle, or your own for your personal workspace — said, not asked.
 * Until then the default was your personal scope wherever you worked, so a team working in
 * `@acme` registered `@jane/…`, which only Jane could release.
 *
 * Pinned here: the default for each way a workspace is chosen (the login, the command,
 * UNIWEB_WORKSPACE, no organization), the fallback to the old derivation when no workspace
 * is chosen, that a scoped name and `--scope` are untouched, and that the release a push or
 * publish runs carries the workspace named on that command.
 *
 * ⚠️ These redirect `$HOME`: the session file resolves `~/.uniweb` at CALL time.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { settleFoundationScope } from '../src/commands/register.js'
import { scopeOfWorkspace } from '../src/backend/workspace.js'
import { forwardedFlags } from '../src/backend/foundation-bring-along.js'
import { BackendClient } from '../src/backend/client.js'

const ORIGIN = 'http://backend.test'

/** A foundation whose main.js names it `name` — bare unless the test scopes it. */
function foundation(name = 'marketing') {
  const dir = mkdtempSync(join(tmpdir(), 'uw-scope-'))
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'src', version: '0.1.0', type: 'module' }))
  mkdirSync(join(dir, 'src'))
  writeFileSync(join(dir, 'src', 'main.js'), `export default {\n  name: '${name}',\n}\n`)
  return dir
}

const mainOf = (dir) => readFileSync(join(dir, 'src', 'main.js'), 'utf8')

/**
 * Settle a foundation's scope with HOME holding `session` for ORIGIN (or none), env set,
 * and `/dev/orgs` answering `account` + `orgs`. No terminal: a pick is never prompted.
 */
async function settle({ session = null, env = {}, orgs = [], account = 'dev', args = [], flagScope = null, name } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'uw-scope-home-'))
  if (session) {
    mkdirSync(join(home, '.uniweb'), { recursive: true })
    writeFileSync(
      join(home, '.uniweb', 'registry-auth.json'),
      JSON.stringify({ version: 2, current: ORIGIN, sessions: { [ORIGIN]: { token: 'tok', ...session } } })
    )
  }
  const keys = ['UNIWEB_WORKSPACE', 'UNIWEB_TOKEN', 'UNIWEB_SERVER', 'CI', ...Object.keys(env)]
  const saved = {
    home: process.env.HOME,
    fetch: globalThis.fetch,
    err: console.error,
    log: console.log,
    env: Object.fromEntries(keys.map((k) => [k, process.env[k]]))
  }
  process.env.HOME = home
  for (const k of ['UNIWEB_WORKSPACE', 'UNIWEB_TOKEN', 'UNIWEB_SERVER']) delete process.env[k]
  process.env.CI = '1'
  Object.assign(process.env, env)
  const requests = []
  globalThis.fetch = async (url) => {
    requests.push(String(url))
    if (String(url).endsWith('/dev/orgs')) {
      return new Response(JSON.stringify({ account_handle: account, orgs }), { status: 200 })
    }
    return new Response('{}', { status: 404 })
  }
  const printed = []
  console.error = (...a) => printed.push(a.join(' '))
  console.log = (...a) => printed.push(a.join(' '))
  const dir = foundation(name)
  try {
    const client = new BackendClient({ origin: ORIGIN, token: process.env.UNIWEB_TOKEN || 'tok', args })
    const result = await settleFoundationScope(dir, { args, isPreview: false, flagScope, client })
    return { result, main: mainOf(dir), printed: printed.join('\n'), requests }
  } finally {
    process.env.HOME = saved.home
    globalThis.fetch = saved.fetch
    console.error = saved.err
    console.log = saved.log
    for (const [k, v] of Object.entries(saved.env)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  }
}

test('the login works in @acme → a bare name registers as @acme/…, said', async () => {
  const r = await settle({ session: { workspace: '@acme' }, orgs: [{ handle: 'acme' }] })
  assert.deepEqual(r.result, { scope: '@acme', source: 'login' })
  assert.match(r.main, /name: '@acme\/marketing'/)
  assert.match(r.printed, /Registering under .*@acme.* — the workspace you work in \(your login\)/)
})

test('the login works in the personal workspace → your own handle, though you belong to orgs', async () => {
  const r = await settle({ session: { workspace: 'personal' }, orgs: [{ handle: 'acme' }] })
  assert.equal(r.result.scope, '@dev')
  assert.match(r.main, /name: '@dev\/marketing'/)
  assert.match(r.printed, /your personal scope .*@dev.* — you work in your personal workspace/)
})

test('no organization and no workspace chosen → your personal scope, as before', async () => {
  const r = await settle({ session: {}, orgs: [] })
  assert.equal(r.result.scope, '@dev')
  assert.match(r.printed, /you belong to no organization/)
})

test('--org on the command names the scope, for this command', async () => {
  const r = await settle({ session: { workspace: '@acme' }, orgs: [{ handle: 'acme' }, { handle: 'team' }], args: ['--org', '@team'] })
  assert.equal(r.result.scope, '@team')
  assert.match(r.printed, /named on this command/)
})

test('a UNIWEB_TOKEN process takes UNIWEB_WORKSPACE, never the session\'s', async () => {
  const r = await settle({
    session: { workspace: '@other' },
    env: { UNIWEB_TOKEN: 'env-token', UNIWEB_WORKSPACE: '@acme' },
    orgs: [{ handle: 'acme' }]
  })
  assert.equal(r.result.scope, '@acme')
  assert.match(r.printed, /UNIWEB_WORKSPACE/)
})

// ⛔ "someone in an org, with no workspace chosen must choose one. we should not default to
// personal" *[Diego, 2026-10-06]*. Until then this registered under your personal scope, said.
test('no workspace chosen and organizations, no terminal → refused, and nothing is written', async () => {
  const r = await settle({ session: {}, orgs: [{ handle: 'acme' }] })
  assert.equal(r.result, null, 'refused — register exits 2')
  assert.match(r.main, /name: 'marketing'/, 'the name is left bare')
  assert.match(r.printed, /so no scope is assumed/)
  assert.doesNotMatch(r.printed, /Registering under/)
})

test('a scoped name is untouched, and no workspace or org is read for it', async () => {
  const r = await settle({ session: { workspace: '@acme' }, name: '@other/marketing' })
  assert.deepEqual(r.result, { scope: '@other', source: 'main.js' })
  assert.match(r.main, /name: '@other\/marketing'/)
  assert.equal(r.requests.length, 0)
})

test('--scope names another scope over the workspace', async () => {
  const r = await settle({ session: { workspace: '@acme' }, flagScope: '@else' })
  assert.deepEqual(r.result, { scope: '@else', source: '--scope' })
  assert.match(r.main, /name: '@else\/marketing'/)
  assert.equal(r.requests.length, 0)
})

test('scopeOfWorkspace — what names a scope and what does not', () => {
  assert.equal(scopeOfWorkspace({ workspace: '@acme', source: 'login' }, 'dev'), '@acme')
  assert.equal(scopeOfWorkspace({ workspace: null, source: 'login' }, 'dev'), '@dev')
  assert.equal(scopeOfWorkspace({ workspace: null, source: 'personal' }, '@dev'), '@dev')
  // none of these is a scope: the caller derives one as before
  assert.equal(scopeOfWorkspace({ refused: true, reason: 'x' }, 'dev'), null)
  assert.equal(scopeOfWorkspace({ workspace: null, source: 'offline' }, 'dev'), null)
  assert.equal(scopeOfWorkspace({ workspace: '0c44a1b2-1111-4222-8333-944455556666', source: 'login' }, 'dev'), null)
  assert.equal(scopeOfWorkspace({ workspace: null, source: 'login' }, null), null)
  assert.equal(scopeOfWorkspace({ workspace: null, source: 'login' }, 'Not_A_Handle'), null)
})

test('the release a push or publish runs carries the workspace named on that command', () => {
  assert.deepEqual(forwardedFlags(['--org', '@acme']).filter((f) => f !== '--non-interactive'), ['--org', '@acme'])
  assert.deepEqual(forwardedFlags(['--org=@acme']).filter((f) => f !== '--non-interactive'), ['--org', '@acme'])
  assert.deepEqual(forwardedFlags(['--personal']).filter((f) => f !== '--non-interactive'), ['--personal'])
  // nothing else of the command travels — the control
  assert.deepEqual(forwardedFlags(['--force', '--yes', '--no-save']).filter((f) => f !== '--non-interactive'), [])
})
