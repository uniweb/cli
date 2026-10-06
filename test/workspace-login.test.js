/**
 * ⭐ A COMMAND WORKS IN ONE WORKSPACE, CHOSEN WITH THE LOGIN *[Diego, 2026-09-23: "when a
 * user has workspace in the backend, I expected them to explicitly login into one" · "that's
 * the intent of the workspace concept"]*.
 *
 * Pinned here: where a command's workspace comes from (`resolveWorkspace` — the command's
 * flag, then UNIWEB_WORKSPACE, then the login's, then personal for a user with no org, else
 * refused), and how a login chooses and stores one (`uniweb login`, and switching without
 * logging in again).
 *
 * ⚠️ These redirect `$HOME`: the session file resolves `~/.uniweb` at CALL time.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveWorkspace, chooseWorkspace, PERSONAL } from '../src/backend/workspace.js'

const ORIGIN = 'http://backend.test'

/** Run `fn` with HOME holding `session` for ORIGIN (or none), env set, fetch stubbed. */
async function scene({ session = null, env = {}, orgs = null, account = 'dev', me = true } = {}, fn) {
  const home = mkdtempSync(join(tmpdir(), 'uw-ws-'))
  if (session) {
    mkdirSync(join(home, '.uniweb'), { recursive: true })
    writeFileSync(
      join(home, '.uniweb', 'registry-auth.json'),
      JSON.stringify({ version: 2, current: ORIGIN, sessions: { [ORIGIN]: session } })
    )
  }
  const saved = { home: process.env.HOME, fetch: globalThis.fetch, exit: process.exit, err: console.error }
  const savedEnv = Object.fromEntries(
    ['UNIWEB_WORKSPACE', 'UNIWEB_TOKEN', 'CI', ...Object.keys(env)].map((k) => [k, process.env[k]])
  )
  process.env.HOME = home
  delete process.env.UNIWEB_WORKSPACE
  delete process.env.UNIWEB_TOKEN
  process.env.CI = '1' // no terminal: a pick is refused, never prompted
  Object.assign(process.env, env)
  const requests = []
  globalThis.fetch = async (url) => {
    requests.push(String(url))
    if (String(url).endsWith('/dev/orgs')) {
      return new Response(JSON.stringify({ account_handle: account, orgs: orgs || [] }), { status: 200 })
    }
    if (String(url).endsWith('/dev/auth/me') && me) {
      return new Response(JSON.stringify({ account: { uuid: 'u-1', username: account, handle: account } }), { status: 200 })
    }
    return new Response('{}', { status: 404 })
  }
  const printed = []
  console.error = (...a) => printed.push(a.join(' '))
  process.exit = (code) => {
    throw Object.assign(new Error(`exit ${code}`), { exitCode: code })
  }
  try {
    const result = await fn({ home, requests })
    return { result, printed: printed.join('\n'), requests, home }
  } finally {
    process.env.HOME = saved.home
    globalThis.fetch = saved.fetch
    process.exit = saved.exit
    console.error = saved.err
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  }
}

/** A client as `resolveWorkspace` uses one: origin, token, and the orgs read. */
const client = () => ({
  origin: ORIGIN,
  token: async () => 'TKN',
  fetchOrgs: async () => (await globalThis.fetch(`${ORIGIN}/dev/orgs`)).json()
})

const ACME = [{ handle: 'acme', is_primary: true }]

// ─── resolveWorkspace — where a command's workspace comes from ────────────────

test('the command\'s own flag wins over everything — --org, then --personal', async () => {
  const { result: a } = await scene({ session: { token: 't', workspace: '@beta' }, env: { UNIWEB_WORKSPACE: '@gamma' } }, () =>
    resolveWorkspace({ client: client(), args: ['--org', 'acme'] })
  )
  assert.deepEqual(a, { workspace: '@acme', source: 'flag' })
  const { result: p } = await scene({ session: { token: 't', workspace: '@beta' } }, () =>
    resolveWorkspace({ client: client(), args: ['--personal'] })
  )
  assert.deepEqual(p, { workspace: null, source: 'flag' })
})

test('UNIWEB_WORKSPACE names a token-logged process\'s workspace; a bad value is refused', async () => {
  const { result } = await scene({ env: { UNIWEB_WORKSPACE: 'personal' } }, () => resolveWorkspace({ client: client() }))
  assert.deepEqual(result, { workspace: null, source: 'env' })
  const { result: org } = await scene({ env: { UNIWEB_WORKSPACE: '@acme' } }, () => resolveWorkspace({ client: client() }))
  assert.deepEqual(org, { workspace: '@acme', source: 'env' })
  const { result: bad } = await scene({ env: { UNIWEB_WORKSPACE: '@' } }, () => resolveWorkspace({ client: client() }))
  assert.equal(bad.refused, true)
})

test('⭐ the login\'s workspace — and it answers without a request', async () => {
  const { result, requests } = await scene({ session: { token: 't', workspace: '@acme' } }, () =>
    resolveWorkspace({ client: client() })
  )
  assert.deepEqual(result, { workspace: '@acme', source: 'login' })
  assert.deepEqual(requests, [])
})

test('⛔ a process logged in with UNIWEB_TOKEN does not borrow the session\'s workspace', async () => {
  const { result } = await scene({ session: { token: 't', workspace: '@acme' }, env: { UNIWEB_TOKEN: 'other' }, orgs: [] }, () =>
    resolveWorkspace({ client: client() })
  )
  assert.deepEqual(result, { workspace: null, source: 'personal' }, 'the token\'s account has no org')
})

test('none chosen: personal when you belong to no organization; refused when you do', async () => {
  const { result: none } = await scene({ session: { token: 't' }, orgs: [] }, () => resolveWorkspace({ client: client() }))
  assert.deepEqual(none, { workspace: null, source: 'personal' })
  const { result: some } = await scene({ session: { token: 't' }, orgs: ACME }, () => resolveWorkspace({ client: client() }))
  assert.equal(some.refused, true)
  assert.match(some.reason, /uniweb login --backend http:\/\/backend\.test --org @acme/)
})

test('a preview never authenticates: none chosen is "not resolved", not a request', async () => {
  const { result, requests } = await scene({}, () => resolveWorkspace({ client: client(), offline: true }))
  assert.deepEqual(result, { workspace: null, source: 'offline' })
  assert.deepEqual(requests, [])
})

// ─── chooseWorkspace — what a login works in ──────────────────────────────────

test('a login with no organization works in the personal workspace, said not asked', async () => {
  const { result } = await scene({ orgs: [] }, () => chooseWorkspace({ apiBase: ORIGIN, token: 't' }))
  assert.equal(result.choice, PERSONAL)
  assert.match(result.note, /no organization/)
})

test('--org must name an organization you belong to', async () => {
  const { result: ok } = await scene({ orgs: ACME }, () => chooseWorkspace({ apiBase: ORIGIN, token: 't', args: ['--org', '@acme'] }))
  assert.equal(ok.choice, '@acme')
  const { result: no } = await scene({ orgs: ACME }, () => chooseWorkspace({ apiBase: ORIGIN, token: 't', args: ['--org', '@beta'] }))
  assert.equal(no.refused, true)
  assert.match(no.reason, /not a member of @beta/)
})

test('organizations and no terminal: refused, naming every workspace you can choose', async () => {
  const { result } = await scene({ orgs: ACME }, () => chooseWorkspace({ apiBase: ORIGIN, token: 't' }))
  assert.equal(result.refused, true)
  // ⛔ The backend is named — a bare `uniweb login` goes to the default backend, not this one.
  assert.match(result.reason, /login --backend http:\/\/backend\.test --org @acme \(or --personal\)/)
  assert.match(result.reason, /will not ask you to sign in again/)
})

// ─── uniweb login ─────────────────────────────────────────────────────────────

const readSession = (home) =>
  JSON.parse(readFileSync(join(home, '.uniweb', 'registry-auth.json'), 'utf8')).sessions[ORIGIN]

test('⭐ `uniweb login --token … --org @acme` stores the workspace with the session', async () => {
  const { runRegistryLogin } = await import('../src/utils/registry-auth.js')
  const { result, printed, home } = await scene({ orgs: ACME }, () =>
    runRegistryLogin({ apiBase: ORIGIN, args: ['--token', 'T1', '--org', '@acme'] })
  )
  assert.equal(result.workspace, '@acme')
  assert.equal(readSession(home).workspace, '@acme')
  assert.match(printed, /working in .*@acme/)
})

test('a login with organizations and no workspace named keeps the session and exits 2', async () => {
  const { runRegistryLogin } = await import('../src/utils/registry-auth.js')
  let exit = null
  const { printed, home } = await scene({ orgs: ACME }, async () => {
    try {
      await runRegistryLogin({ apiBase: ORIGIN, args: ['--token', 'T1'] })
    } catch (err) {
      exit = err.exitCode
    }
  })
  assert.equal(exit, 2)
  assert.equal(readSession(home).token, 'T1', 'the login itself stands')
  assert.equal(readSession(home).workspace, undefined)
  // ⭐ It says what happened: logged in, no workspace yet, and the one command that finishes it.
  assert.match(printed, /Logged in to http:\/\/backend\.test.* — with no workspace chosen yet/)
  assert.match(printed, /login --backend http:\/\/backend\.test --org @acme \(or --personal\) — it will not ask you to sign in again/)
})

/** As an interactive terminal inside `scene`: a TTY, and no CI. */
async function atTerminal(fn) {
  const tty = process.stdin.isTTY
  const ci = process.env.CI
  process.stdin.isTTY = true
  delete process.env.CI
  try {
    return await fn()
  } finally {
    process.stdin.isTTY = tty
    if (ci === undefined) delete process.env.CI
    else process.env.CI = ci
  }
}

test('⛔ a workspace pick cancelled at a terminal is not a cancelled login: said, session kept, exit 2', async () => {
  const { runRegistryLogin } = await import('../src/utils/registry-auth.js')
  const prompts = (await import('prompts')).default
  let exit = null
  const { printed, home } = await scene({ orgs: ACME }, () =>
    atTerminal(async () => {
      prompts.inject([new Error('cancelled')]) // what prompts does when the user escapes
      try {
        await runRegistryLogin({ apiBase: ORIGIN, args: ['--token', 'T1'] })
      } catch (err) {
        exit = err.exitCode
      }
    })
  )
  // Until 2026-10-06: "Cancelled." and exit 0 — with the new session already in place.
  assert.equal(exit, 2)
  assert.equal(readSession(home).token, 'T1')
  assert.match(printed, /with no workspace chosen yet/)
  assert.match(printed, /No workspace chosen\. Choose one: .*login --backend http:\/\/backend\.test --org @acme/)
  assert.doesNotMatch(printed, /^Cancelled\./m)
})

test('a switch to a workspace you are not a member of leaves the one you work in — and says so', async () => {
  const { runRegistryLogin } = await import('../src/utils/registry-auth.js')
  let exit = null
  const { printed, home } = await scene({ session: { token: 'T1', workspace: '@acme' }, orgs: ACME }, async () => {
    try {
      await runRegistryLogin({ apiBase: ORIGIN, args: ['--org', '@beta'] })
    } catch (err) {
      exit = err.exitCode
    }
  })
  assert.equal(exit, 2)
  assert.equal(readSession(home).workspace, '@acme')
  assert.match(printed, /working in .*@acme.* — unchanged/)
  assert.doesNotMatch(printed, /no workspace chosen yet/)
  assert.match(printed, /not a member of @beta/)
})

test('⭐ switching workspace needs no new login — --org on a valid session', async () => {
  const { runRegistryLogin } = await import('../src/utils/registry-auth.js')
  const { result, printed, home, requests } = await scene(
    { session: { token: 'T1', workspace: PERSONAL }, orgs: ACME },
    () => runRegistryLogin({ apiBase: ORIGIN, args: ['--org', '@acme'] })
  )
  assert.equal(result.workspace, '@acme')
  assert.equal(readSession(home).token, 'T1', 'the same session')
  assert.equal(readSession(home).workspace, '@acme')
  assert.match(printed, /Now working in .*@acme/)
  assert.ok(!requests.some((u) => u.endsWith('/dev/auth/login')), 'no authentication')
})

// ⛔ A bare `uniweb login` goes to the DEFAULT backend, never to the one you are logged in to — so a
// hint that names a login must name any other backend. Measured 2026-10-06 against a local backend:
// "uniweb login --org @acme" went to https://uniweb.app and began a new login there.
test('loginCommand names the backend unless it is where a bare login goes', async () => {
  const { loginCommand } = await import('../src/utils/config.js')
  const saved = { home: process.env.HOME, url: process.env.UNIWEB_REGISTER_URL }
  process.env.HOME = mkdtempSync(join(tmpdir(), 'uw-login-cmd-')) // no saved registryApiUrl
  delete process.env.UNIWEB_REGISTER_URL
  try {
    assert.equal(loginCommand('https://uniweb.app'), 'uniweb login')
    assert.equal(loginCommand('http://localhost:8080'), 'uniweb login --backend http://localhost:8080')
    assert.equal(loginCommand('http://localhost:8080/dev/site', 'pnpm uniweb'), 'pnpm uniweb login --backend http://localhost:8080')
    // UNIWEB_REGISTER_URL is where a bare login goes, so it needs no flag
    process.env.UNIWEB_REGISTER_URL = 'http://localhost:8080'
    assert.equal(loginCommand('http://localhost:8080'), 'uniweb login')
  } finally {
    process.env.HOME = saved.home
    if (saved.url === undefined) delete process.env.UNIWEB_REGISTER_URL
    else process.env.UNIWEB_REGISTER_URL = saved.url
  }
})
