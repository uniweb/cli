/**
 * resolveBackendOrigin — which backend a command talks to.
 *
 * The whole ladder, for every command: `--backend` → UNIWEB_REGISTER_URL → the backend
 * the user is LOGGED IN TO → the default backend, where the command's first request asks
 * for that login. *[Diego, 2026-09-21: "push and pull are also meant to go to the backend
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

const FLAG = 'https://flag.example'
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

test('an explicit flag outranks everything, the login included', () => {
  isolated(LOGIN, () => {
    assert.equal(resolveBackendOrigin(FLAG), FLAG)
  })
  // `--backend` is how you deliberately aim elsewhere for one run — at a staging mirror,
  // say — without changing who you are logged in as.
})

test('the env override outranks the login, and the flag outranks the env', () => {
  isolated(LOGIN, () => {
    process.env.UNIWEB_REGISTER_URL = ENV
    assert.equal(resolveBackendOrigin(null), ENV)
    assert.equal(resolveBackendOrigin(FLAG), FLAG)
  })
})

test('⭐ otherwise, the backend you are logged in to', () => {
  isolated(LOGIN, () => {
    assert.equal(resolveBackendOrigin(null), LOGIN)
    assert.equal(resolveBackendOrigin(undefined), LOGIN)
  })
})

test('logged in nowhere: the default backend — where the login is asked for', () => {
  isolated(null, () => {
    assert.equal(resolveBackendOrigin(null), DEFAULT)
  })
})

test('an unparseable flag falls through instead of winning with a broken value', () => {
  isolated(LOGIN, () => {
    assert.equal(resolveBackendOrigin('not-a-url'), LOGIN)
    // no scheme: parses as `localhost:` with the origin "null" — must fall through too
    assert.equal(resolveBackendOrigin('localhost:8080'), LOGIN)
  })
})

test('a full endpoint URL is reduced to its origin', () => {
  isolated(null, () => {
    assert.equal(resolveBackendOrigin('https://flag.example/a/b?c=1'), FLAG)
  })
})
