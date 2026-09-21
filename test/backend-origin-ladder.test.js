/**
 * resolveBackendOrigin — the backend resolution ladder.
 *
 * The order decides where every backend verb SENDS, and a wrong tier is silent. Since
 * 2026-09-21 the login ranks right under the two explicit overrides, for every verb:
 * *[Diego: "publish should publish to the backend the user logged in to" · "push and
 * pull are also meant to go to the backend you are logged into"]*. The project's own
 * record — its one synced backend, then deploy.yml's default target — answers only when
 * nobody is logged in.
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
const SCOPE = 'http://localhost:8080'
const DEPLOY = 'https://deploy.example'
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
    assert.equal(resolveBackendOrigin(FLAG, { siteScope: SCOPE, siteBackend: DEPLOY }), FLAG)
  })
  // `--backend` is how you deliberately aim elsewhere for one run — at a staging mirror,
  // say — without changing who you are logged in as.
})

test('the env override outranks the login, and the flag outranks the env', () => {
  isolated(LOGIN, () => {
    process.env.UNIWEB_REGISTER_URL = ENV
    assert.equal(resolveBackendOrigin(null, { siteScope: SCOPE }), ENV)
    assert.equal(resolveBackendOrigin(FLAG, { siteScope: SCOPE }), FLAG)
  })
})

test('⭐ the backend you are logged in to outranks the project', () => {
  isolated(LOGIN, () => {
    assert.equal(resolveBackendOrigin(null, { siteScope: SCOPE, siteBackend: DEPLOY }), LOGIN)
    assert.equal(resolveBackendOrigin(null), LOGIN)
  })
})

test('logged in nowhere: the project decides — its synced backend, then deploy.yml', () => {
  isolated(null, () => {
    assert.equal(resolveBackendOrigin(null, { siteScope: SCOPE, siteBackend: DEPLOY }), SCOPE)
    assert.equal(resolveBackendOrigin(null, { siteBackend: DEPLOY }), DEPLOY)
    assert.equal(resolveBackendOrigin(null), DEFAULT, 'and nothing at all: the default')
  })
})

test('⛔ an ABSENT synced backend defers to the next tier — it must not default', () => {
  // `resolveSyncedBackend` returns null for none or several. "Absent means the default"
  // is right for a comparison and wrong in a precedence chain: a defaulted value here
  // would shadow deploy.yml's target for every project that records nothing.
  isolated(null, () => {
    assert.equal(resolveBackendOrigin(null, { siteScope: null, siteBackend: DEPLOY }), DEPLOY)
    assert.equal(resolveBackendOrigin(null, { siteScope: undefined, siteBackend: DEPLOY }), DEPLOY)
  })
})

test('an unparseable tier falls through instead of winning with a broken value', () => {
  isolated(null, () => {
    assert.equal(resolveBackendOrigin('not-a-url', { siteScope: SCOPE }), SCOPE)
    assert.equal(resolveBackendOrigin(null, { siteScope: 'not-a-url', siteBackend: DEPLOY }), DEPLOY)
  })
})

test('a full endpoint URL is reduced to its origin at every tier', () => {
  isolated(null, () => {
    assert.equal(resolveBackendOrigin(null, { siteScope: 'http://localhost:8080/dev/site/push' }), SCOPE)
    assert.equal(resolveBackendOrigin('https://flag.example/a/b?c=1'), FLAG)
  })
})
