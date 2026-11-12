/**
 * ⭐ A SESSION MADE FOR ANOTHER OF THE BACKEND'S CLIENTS — what the CLI says, and what it does.
 *
 * A backend binds each session to its client: one made by the CLI's own sign-in opens the
 * CLI's routes, and one made for the Uniweb app is refused on them with a `401` whose body says
 * `reason: "session_for_another_client"` and `client: "cli"`. Three ways hand the CLI a bearer it
 * did not make (`login --token`, the paste prompt, `UNIWEB_TOKEN`), and a password login from
 * before that binding left the app's kind of session stored.
 *
 * ⛔ Until 2026-11-11 the token checks said only "HTTP 401", a push said nothing past the
 * status, and a bare `uniweb login` answered "Already logged in" for a stored session the
 * backend refused, while every command named that login as the fix. Pinned here:
 *
 *   - the token checks say whose session it is and name a sign-in on that backend;
 *   - a bare login asks the backend about the stored session, and signs in again on a 401;
 *   - a session the backend accepts, or a check that can't reach it, keeps "Already logged in".
 *
 * ⚠️ These redirect `$HOME`: the session file resolves `~/.uniweb` at CALL time.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runRegistryLogin, anotherClientsSessionLines } from '../src/utils/registry-auth.js'

const ORIGIN = 'http://backend.test'
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

/** The backend's refusal of the app's session on the CLI's routes. */
const APP_REFUSAL = {
  type: 'about:blank',
  status: 401,
  title: 'Session For Another Client',
  detail: 'This session belongs to the app.',
  reason: 'session_for_another_client',
  client: 'cli'
}

/**
 * Run a login with HOME holding `session` for ORIGIN (or none), no terminal, `env` set, and a
 * backend that takes the bearer `GOOD`, refuses `APP` as the app's session, refuses anything else
 * with a bare 401, and (with `offline`) cannot be reached.
 */
async function scene({ session = null, env = {}, offline = false } = {}, fn) {
  const home = mkdtempSync(join(tmpdir(), 'uw-another-client-'))
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
    if (offline) throw new TypeError('fetch failed')
    if (bearer === 'APP') {
      return new Response(JSON.stringify(APP_REFUSAL), {
        status: 401,
        statusText: 'Unauthorized',
        headers: { 'content-type': 'application/problem+json' }
      })
    }
    if (bearer !== 'GOOD') return new Response('{}', { status: 401, statusText: 'Unauthorized' })
    if (String(url).endsWith('/dev/auth/me')) {
      return new Response(JSON.stringify({ account: { uuid: 'u-1', username: 'dev', handle: 'dev' } }), { status: 200 })
    }
    if (String(url).endsWith('/dev/orgs')) {
      return new Response(JSON.stringify({ account_handle: 'dev', orgs: [], workspaces: [] }), { status: 200 })
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

test('the lines are for that refusal alone: any other reason, or another client, keeps the caller\'s message', async () => {
  assert.equal(await anotherClientsSessionLines(null, { origin: ORIGIN }), null)
  assert.equal(await anotherClientsSessionLines({ status: 401 }, { origin: ORIGIN }), null, 'a refusal with no reason')
  assert.equal(await anotherClientsSessionLines({ reason: 'expired' }, { origin: ORIGIN }), null)
  assert.equal(
    await anotherClientsSessionLines({ ...APP_REFUSAL, client: 'app' }, { origin: ORIGIN }),
    null,
    'a CLI session on the app\'s routes is not something the CLI sends'
  )
  const lines = await anotherClientsSessionLines(APP_REFUSAL, { origin: ORIGIN })
  assert.equal(lines.length, 2)
  assert.match(lines[0], /made for the Uniweb app, and http:\/\/backend\.test takes only a session the uniweb CLI signed in with/)
  assert.match(lines[1], /--browser \(or --password\)/)
})

test('⭐ login --token with the app\'s session says whose it is and names a sign-in on that backend — nothing is stored', async () => {
  const { exitCode, text, stored } = await scene({}, () =>
    runRegistryLogin({ apiBase: ORIGIN, args: ['--token', 'APP'] })
  )
  assert.equal(exitCode, 1)
  assert.match(text, /http:\/\/backend\.test refuses this token\./)
  assert.match(text, /made for the Uniweb app/)
  // Logged in nowhere, a bare login would go to the default backend: the line names this one.
  assert.match(text, /login --server http:\/\/backend\.test --browser \(or --password\)/)
  assert.doesNotMatch(text, /HTTP 401/)
  assert.equal(stored, null)

  // CONTROL — a bad token is still "rejected", as before.
  const bad = await scene({}, () => runRegistryLogin({ apiBase: ORIGIN, args: ['--token', 'NOPE'] }))
  assert.equal(bad.exitCode, 1)
  assert.match(bad.text, /Token rejected by http:\/\/backend\.test: token check failed: HTTP 401/)
})

test('UNIWEB_TOKEN holding the app\'s session is said so, under the line it always printed', async () => {
  const { exitCode, text } = await scene({ env: { UNIWEB_TOKEN: 'APP', UNIWEB_SERVER: ORIGIN } }, () =>
    runRegistryLogin({ apiBase: ORIGIN, args: [] })
  )
  assert.equal(exitCode, 1)
  assert.match(text, /http:\/\/backend\.test refuses UNIWEB_TOKEN \(HTTP 401\)\./)
  assert.match(text, /UNIWEB_TOKEN holds a session made for the Uniweb app/)
  assert.match(text, /Set UNIWEB_TOKEN to a CLI session, or unset it and sign in: .*login --browser \(or --password\)/)
})

test('⭐ a bare login with a stored session the backend refuses signs in again — no "Already logged in"', async () => {
  const { exitCode, text, requests, stored } = await scene(
    { session: { token: 'APP', workspace: 'personal', username: 'dev' } },
    () => runRegistryLogin({ apiBase: ORIGIN, args: [] })
  )
  assert.deepEqual(requests[0], { url: `${ORIGIN}/dev/auth/me`, bearer: 'APP' }, 'it asks the backend first')
  assert.doesNotMatch(text, /Already logged in/)
  assert.match(text, /http:\/\/backend\.test refuses the session stored for it — signing in again\./)
  assert.match(text, /made for the Uniweb app/)
  // No terminal and no method named: it says how to sign in, as any login with no session does.
  assert.equal(exitCode, 1)
  assert.match(text, /uniweb login --browser/)
  assert.equal(stored.sessions[ORIGIN].token, 'APP', 'a failed sign-in replaces nothing')

  // A revoked session is refused with no reason: it signs in again too, naming the status.
  const revoked = await scene(
    { session: { token: 'REVOKED', workspace: 'personal' } },
    () => runRegistryLogin({ apiBase: ORIGIN, args: [] })
  )
  assert.match(revoked.text, /refuses the session stored for it \(HTTP 401\) — signing in again\./)
  assert.doesNotMatch(revoked.text, /Already logged in/)
})

test('CONTROL — a stored session the backend takes, or a check that can\'t reach it, is still "Already logged in"', async () => {
  const good = await scene({ session: { token: 'GOOD', workspace: 'personal', username: 'dev' } }, () =>
    runRegistryLogin({ apiBase: ORIGIN, args: [] })
  )
  assert.equal(good.exitCode, 0)
  assert.match(good.text, /Already logged in to http:\/\/backend\.test as dev/)
  assert.equal(good.requests[0].url, `${ORIGIN}/dev/auth/me`)

  const offline = await scene(
    { session: { token: 'GOOD', workspace: 'personal', username: 'dev' }, offline: true },
    () => runRegistryLogin({ apiBase: ORIGIN, args: [] })
  )
  assert.equal(offline.exitCode, 0)
  assert.match(offline.text, /Already logged in to http:\/\/backend\.test as dev/, 'no answer says nothing about the session')
})

test('a login that names a way of signing in asks nothing first — it replaces the session anyway', async () => {
  const { requests } = await scene(
    { session: { token: 'APP', workspace: 'personal' } },
    () => runRegistryLogin({ apiBase: ORIGIN, args: ['--token', 'GOOD'] })
  )
  assert.ok(requests.every((r) => r.bearer !== 'APP'), 'the stored session is not sent')
})
