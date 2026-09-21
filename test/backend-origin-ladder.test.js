/**
 * resolveBackendOrigin — which backend a command talks to.
 *
 * The whole ladder, for every command: UNIWEB_REGISTER_URL → the backend the user is
 * LOGGED IN TO → the default backend, where the command's first request asks for that
 * login. No `--backend`: switching is `uniweb login --backend` (2026-09-21). *[Diego, 2026-09-21: "push and pull are also meant to go to the backend
 * you are logged into" · "We do not allow any communication with backend if the user is
 * not logged into a backend. The default backend for login, if not specified, is
 * uniweb.app".]* A project's own record — its synced backend, deploy.yml's target —
 * routes nothing.
 *
 * ⛔ Every case runs in its OWN HOME. The ladder reads `~/.uniweb/registry-auth.json`,
 * and a test that saw the developer's real session would pass in CI and fail on every
 * machine that has logged in — the same trap `pull.test.js` pins `--backend` against.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { resolveBackendOrigin } from '../src/backend/client.js'
import { tmp } from './helpers/run-verb.js'

const ENV = 'https://env.example'
const LOGIN = 'https://login.example'
const DEFAULT = 'https://uniweb.app'

/**
 * Run `fn` in a fresh HOME — logged in to `login` when given — with no
 * UNIWEB_REGISTER_URL inherited from the developer's shell.
 */
function isolated(login, fn) {
  const saved = { home: process.env.HOME, env: process.env.UNIWEB_REGISTER_URL }
  const home = tmp('uw-ladder-')
  if (login) {
    mkdirSync(join(home, '.uniweb'), { recursive: true })
    writeFileSync(
      join(home, '.uniweb', 'registry-auth.json'),
      JSON.stringify({ version: 2, current: login, sessions: { [login]: { token: 't' } } })
    )
  }
  process.env.HOME = home
  delete process.env.UNIWEB_REGISTER_URL
  try {
    return fn()
  } finally {
    process.env.HOME = saved.home
    if (saved.env !== undefined) process.env.UNIWEB_REGISTER_URL = saved.env
  }
}

test('the env override outranks the login — the one override, for automation', () => {
  isolated(LOGIN, () => {
    process.env.UNIWEB_REGISTER_URL = ENV
    assert.equal(resolveBackendOrigin(), ENV)
  })
})

test('⭐ otherwise, the backend you are logged in to', () => {
  isolated(LOGIN, () => {
    assert.equal(resolveBackendOrigin(), LOGIN)
  })
})

test('logged in nowhere: the default backend — where the login is asked for', () => {
  isolated(null, () => {
    assert.equal(resolveBackendOrigin(), DEFAULT)
  })
})

test('⛔ there is no flag tier — an argument is ignored, not obeyed', () => {
  // `--backend` left the backend verbs on 2026-09-21; switching is a login. A stale
  // caller passing one must not steer anything.
  isolated(LOGIN, () => {
    assert.equal(resolveBackendOrigin('https://flag.example'), LOGIN)
  })
})

test('an unparseable override falls through instead of winning with a broken value', () => {
  isolated(LOGIN, () => {
    process.env.UNIWEB_REGISTER_URL = 'not-a-url'
    assert.equal(resolveBackendOrigin(), LOGIN)
    // no scheme: parses as `localhost:` with the origin "null" — must fall through too
    process.env.UNIWEB_REGISTER_URL = 'localhost:8080'
    assert.equal(resolveBackendOrigin(), LOGIN)
  })
})

test('a full endpoint URL is reduced to its origin', () => {
  isolated(null, () => {
    process.env.UNIWEB_REGISTER_URL = 'https://env.example/a/b?c=1'
    assert.equal(resolveBackendOrigin(), ENV)
  })
})
