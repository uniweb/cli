/**
 * ⭐ UNIWEB_TOKEN IS NOT A WAY TO LOG IN — it is how a process skips the login.
 *
 * Every backend command reads it first, ahead of any stored session, and nothing stores
 * it (ensureRegistryAuth). `uniweb login` never read it, yet its refusal without a
 * terminal said "set UNIWEB_TOKEN" — and with it set, refused the same way, word for
 * word (measured on 0.88.0). Pinned here:
 *
 *   - the refusal names only what works without a terminal: `--token <bearer>`, or
 *     UNIWEB_USERNAME + UNIWEB_PASSWORD — and UNIWEB_TOKEN as skipping the login;
 *   - a login that asks for nothing, in a process with UNIWEB_TOKEN, checks the token
 *     with the backend that process's commands go to, and says who and where they work
 *     as — storing nothing;
 *   - it never sends the token to a backend those commands do not go to;
 *   - a login that asks for something — a way of signing in, a workspace switch — still
 *     does it, for the stored session, and says this process does not use it.
 *
 * ⚠️ These redirect `$HOME`: the session file resolves `~/.uniweb` at CALL time.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runRegistryLogin } from '../src/utils/registry-auth.js'

const ORIGIN = 'http://backend.test'
const OTHER = 'http://other.test'
const ENV_KEYS = [
  'HOME',
  'CI',
  'UNIWEB_TOKEN',
  'UNIWEB_WORKSPACE',
  'UNIWEB_SERVER',
  'UNIWEB_USERNAME',
  'UNIWEB_PASSWORD',
  'npm_config_user_agent'
]

/**
 * Run a login with HOME holding `session` for ORIGIN (or none), no terminal, `env` set,
 * and a backend that accepts the bearer `GOOD` — every request recorded with its bearer.
 */
async function scene({ session = null, env = {}, orgs = [] } = {}, fn) {
  const home = mkdtempSync(join(tmpdir(), 'uw-login-token-'))
  if (session) {
    mkdirSync(join(home, '.uniweb'), { recursive: true })
    writeFileSync(
      join(home, '.uniweb', 'registry-auth.json'),
      JSON.stringify({ version: 2, current: ORIGIN, sessions: { [ORIGIN]: session } })
    )
  }
  const saved = { fetch: globalThis.fetch, exit: process.exit, err: console.error }
  const savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]))
  for (const k of ENV_KEYS) delete process.env[k]
  process.env.HOME = home
  process.env.CI = '1' // no terminal
  Object.assign(process.env, env)

  const requests = []
  globalThis.fetch = async (url, init = {}) => {
    const bearer = String(init.headers?.Authorization || '').replace(/^Bearer /, '')
    requests.push({ url: String(url), bearer })
    if (bearer !== 'GOOD') return new Response('{}', { status: 401, statusText: 'Unauthorized' })
    if (String(url).endsWith('/dev/auth/me')) {
      return new Response(JSON.stringify({ account: { uuid: 'u-1', username: 'dev', handle: 'dev' } }), {
        status: 200
      })
    }
    if (String(url).endsWith('/dev/orgs')) {
      return new Response(JSON.stringify({ account_handle: 'dev', orgs }), { status: 200 })
    }
    return new Response('{}', { status: 404 })
  }
  const printed = []
  console.error = (...a) => printed.push(a.join(' '))
  process.exit = (code) => {
    throw Object.assign(new Error(`exit ${code}`), { exitCode: code })
  }
  let result
  let exitCode = 0
  try {
    result = await fn()
  } catch (err) {
    if (err.exitCode === undefined) throw err
    exitCode = err.exitCode
  } finally {
    globalThis.fetch = saved.fetch
    process.exit = saved.exit
    console.error = saved.err
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  }
  // eslint-disable-next-line no-control-regex
  const text = printed.join('\n').replace(/\x1b\[[0-9;]*m/g, '')
  const file = join(home, '.uniweb', 'registry-auth.json')
  const stored = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null
  return { result, exitCode, text, requests, stored }
}

test('without a terminal, the refusal names what works — and UNIWEB_TOKEN only as skipping the login', async () => {
  const { exitCode, text, requests } = await scene({}, () =>
    runRegistryLogin({ apiBase: ORIGIN, args: [] })
  )
  assert.equal(exitCode, 1)
  assert.match(text, /uniweb login --token <bearer>/)
  assert.match(text, /UNIWEB_USERNAME \+ UNIWEB_PASSWORD/)
  assert.match(text, /skip the login: with UNIWEB_TOKEN set/)
  assert.doesNotMatch(text, /--password \/ --token-paste/, 'both prompt: no use without a terminal')
  assert.deepEqual(requests, [])

  // Re-run as printed, the command must reach the backend named — not the default.
  const named = await scene({}, () => runRegistryLogin({ apiBase: OTHER, args: ['--server', OTHER] }))
  assert.match(named.text, /uniweb login --server http:\/\/other\.test --token <bearer>/)
})

test('⭐ with UNIWEB_TOKEN, a login checks it where the commands go, stores nothing, and exits 0', async () => {
  const { exitCode, text, requests, stored } = await scene(
    { env: { UNIWEB_TOKEN: 'GOOD', UNIWEB_SERVER: ORIGIN } },
    () => runRegistryLogin({ apiBase: ORIGIN, args: [] })
  )
  assert.equal(exitCode, 0)
  assert.match(text, /No login needed: this process's backend commands use UNIWEB_TOKEN, which http:\/\/backend\.test accepts as dev/)
  assert.match(text, /They work in your personal workspace — the account belongs to no organization/)
  assert.deepEqual(
    requests.map((r) => r.url),
    [`${ORIGIN}/dev/auth/me`, `${ORIGIN}/dev/orgs`]
  )
  assert.equal(stored, null, 'nothing is stored')
})

test('a token the backend refuses is said so, and exits 1', async () => {
  const { exitCode, text } = await scene({ env: { UNIWEB_TOKEN: 'BAD', UNIWEB_SERVER: ORIGIN } }, () =>
    runRegistryLogin({ apiBase: ORIGIN, args: [] })
  )
  assert.equal(exitCode, 1)
  assert.match(text, /http:\/\/backend\.test refuses UNIWEB_TOKEN \(HTTP 401\)/)
})

test('⛔ a login naming a backend the commands do not go to is refused — and the token is not sent there', async () => {
  // The reported case: `--server` named, UNIWEB_SERVER not, so the commands go elsewhere.
  const { exitCode, text, requests } = await scene(
    { env: { UNIWEB_TOKEN: 'GOOD', UNIWEB_SERVER: ORIGIN } },
    () => runRegistryLogin({ apiBase: OTHER, args: ['--server', OTHER] })
  )
  assert.equal(exitCode, 1)
  assert.match(text, /send it to http:\/\/backend\.test — not http:\/\/other\.test/)
  assert.match(text, /UNIWEB_SERVER=http:\/\/other\.test/)
  assert.deepEqual(requests, [], 'no request at all')
})

test('with no backend named, the token is checked with the one logged in to — where the commands go', async () => {
  // A bare login's own target is the default backend; the commands go to the session's.
  const { exitCode, requests } = await scene(
    { session: { token: 'stored', workspace: 'personal' }, env: { UNIWEB_TOKEN: 'GOOD' } },
    () => runRegistryLogin({ apiBase: 'https://uniweb.app', args: [] })
  )
  assert.equal(exitCode, 0)
  assert.ok(requests.length > 0)
  for (const r of requests) assert.ok(r.url.startsWith(ORIGIN), r.url)
})

test('its workspace is UNIWEB_WORKSPACE — and an account in organizations, with none named, is told to name one (exit 2)', async () => {
  const ACME = [{ handle: 'acme', is_primary: true }]
  const named = await scene(
    { env: { UNIWEB_TOKEN: 'GOOD', UNIWEB_SERVER: ORIGIN, UNIWEB_WORKSPACE: '@acme' }, orgs: ACME },
    () => runRegistryLogin({ apiBase: ORIGIN, args: [] })
  )
  assert.equal(named.exitCode, 0)
  assert.match(named.text, /They work in @acme \(UNIWEB_WORKSPACE\)/)

  const none = await scene({ env: { UNIWEB_TOKEN: 'GOOD', UNIWEB_SERVER: ORIGIN }, orgs: ACME }, () =>
    runRegistryLogin({ apiBase: ORIGIN, args: [] })
  )
  assert.equal(none.exitCode, 2)
  assert.match(none.text, /no workspace is assumed: set UNIWEB_WORKSPACE=@acme/)

  const stranger = await scene(
    { env: { UNIWEB_TOKEN: 'GOOD', UNIWEB_SERVER: ORIGIN, UNIWEB_WORKSPACE: '@nope' }, orgs: ACME },
    () => runRegistryLogin({ apiBase: ORIGIN, args: [] })
  )
  assert.equal(stranger.exitCode, 2)
  assert.match(stranger.text, /UNIWEB_WORKSPACE=@nope is not one of this account's organizations/)

  const garbled = await scene(
    { env: { UNIWEB_TOKEN: 'GOOD', UNIWEB_SERVER: ORIGIN, UNIWEB_WORKSPACE: '@' } },
    () => runRegistryLogin({ apiBase: ORIGIN, args: [] })
  )
  assert.equal(garbled.exitCode, 2)
  assert.match(garbled.text, /names no workspace/)
})

test('a login that names a way to sign in still stores its session — saying this process does not use it', async () => {
  const { exitCode, text, stored } = await scene(
    { env: { UNIWEB_TOKEN: 'ENV', UNIWEB_SERVER: ORIGIN } },
    () => runRegistryLogin({ apiBase: ORIGIN, args: ['--token', 'GOOD', '--personal'] })
  )
  assert.equal(exitCode, 0)
  assert.match(text, /UNIWEB_TOKEN is set, so this process's backend commands use it/)
  assert.equal(stored?.sessions?.[ORIGIN]?.token, 'GOOD')
})

test('a workspace switch still switches the stored session\'s workspace', async () => {
  const { exitCode, text, stored } = await scene(
    {
      session: { token: 'GOOD', username: 'dev', workspace: 'personal' },
      env: { UNIWEB_TOKEN: 'ENV', UNIWEB_SERVER: ORIGIN },
      orgs: [{ handle: 'acme', is_primary: true }]
    },
    () => runRegistryLogin({ apiBase: ORIGIN, args: ['--org', '@acme'] })
  )
  assert.equal(exitCode, 0)
  assert.match(text, /UNIWEB_TOKEN is set, so this process's backend commands use it/)
  assert.equal(stored?.sessions?.[ORIGIN]?.workspace, '@acme')
})
