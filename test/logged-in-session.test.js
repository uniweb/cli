/**
 * "The backend the user logged in to" — which one that is, now that there can be several.
 *
 * Sessions are one per backend, so "logged in to" means the MOST RECENT login (`current`,
 * set by every login, and by naming a backend you are already logged in to). The origin
 * ladder read the session file through a copy of its old shape — a top-level `origin` the
 * per-backend file does not have — so for every login since sessions went per-backend,
 * "logged in to X" routed nothing and commands fell through to the default backend.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmp } from './helpers/run-verb.js'
import { normalizeSessionFile, loggedInOriginOf } from '../src/utils/session-file.js'

const A = 'http://a.test'
const B = 'http://b.test'
const C = 'http://c.test'
const DEFAULT = 'https://uniweb.app'

/** Run `fn` with HOME pointed at a fresh dir holding `session` (if any). */
async function withHome(session, fn) {
  const saved = { home: process.env.HOME, env: process.env.UNIWEB_REGISTER_URL }
  const home = tmp('uw-home-')
  if (session) {
    mkdirSync(join(home, '.uniweb'), { recursive: true })
    writeFileSync(join(home, '.uniweb', 'registry-auth.json'), JSON.stringify(session))
  }
  process.env.HOME = home
  delete process.env.UNIWEB_REGISTER_URL
  try {
    return await fn(home)
  } finally {
    process.env.HOME = saved.home
    if (saved.env !== undefined) process.env.UNIWEB_REGISTER_URL = saved.env
  }
}

const sessions = (...origins) =>
  Object.fromEntries(origins.map((o) => [o, { token: `t-${o}` }]))

// ─── which backend is "logged in to" ──────────────────────────────────────────

test('the most recent login answers; one session answers alone; several unmarked do not', () => {
  const of = (raw) => loggedInOriginOf(normalizeSessionFile(raw, DEFAULT))
  assert.equal(of({ version: 2, current: B, sessions: sessions(A, B) }), B)
  assert.equal(of({ version: 2, sessions: sessions(A) }), A)
  assert.equal(of({ version: 2, sessions: sessions(A, B) }), null, 'never a guess between two')
  assert.equal(of({ version: 2, current: C, sessions: sessions(A) }), A, 'a current with no session is not an answer')
  assert.equal(of({ token: 't', origin: `${A}/dev` }), A, 'a v1 file: its one login')
  assert.equal(of({ token: 't' }), DEFAULT, 'a v1 file with no stamp: the default backend')
  assert.equal(of(null), null)
})

test('⭐ the ladder honours the login — the per-backend file routed nothing before', async () => {
  const { getRegistryApiBaseUrl } = await import('../src/utils/config.js')
  await withHome({ version: 2, sessions: sessions(A) }, () => {
    assert.equal(getRegistryApiBaseUrl(), A, 'logged in to A only')
  })
  await withHome({ version: 2, current: B, sessions: sessions(A, B) }, () => {
    assert.equal(getRegistryApiBaseUrl(), B, 'the most recent of two')
  })
  await withHome(null, () => {
    assert.equal(getRegistryApiBaseUrl(), DEFAULT, 'logged in nowhere: the default (control)')
  })
})

test('every login becomes current; logging out of it leaves the one remaining', async () => {
  const { writeRegistryAuth, clearRegistryAuth } = await import('../src/utils/registry-auth.js')
  const { loggedInOrigin } = await import('../src/utils/config.js')
  await withHome(null, async (home) => {
    await writeRegistryAuth({ origin: A, token: 'ta' })
    assert.equal(loggedInOrigin(), A)
    await writeRegistryAuth({ origin: `${B}/dev/whatever`, token: 'tb' })
    assert.equal(loggedInOrigin(), B, 'the second login is the current one')
    const file = JSON.parse(readFileSync(join(home, '.uniweb', 'registry-auth.json'), 'utf8'))
    assert.deepEqual(Object.keys(file.sessions).sort(), [A, B], 'and the first session is kept')

    await clearRegistryAuth(B)
    assert.equal(loggedInOrigin(), A, 'out of B: the one left answers')
    await writeRegistryAuth({ origin: B, token: 'tb' })
    await writeRegistryAuth({ origin: C, token: 'tc' })
    await clearRegistryAuth(C)
    assert.equal(loggedInOrigin(), null, 'out of the current one with two left: no guess')
  })
})

test('`uniweb login --backend X` with a session for X already switches to it', async () => {
  const { runRegistryLogin } = await import('../src/utils/registry-auth.js')
  const { loggedInOrigin } = await import('../src/utils/config.js')
  await withHome({ version: 2, current: B, sessions: sessions(A, B) }, async () => {
    const err = console.error
    console.error = () => {}
    try {
      const got = await runRegistryLogin({ apiBase: A, args: ['--non-interactive'] })
      assert.equal(got?.origin, A, 'no login method needed: the session is reused')
    } finally {
      console.error = err
    }
    assert.equal(loggedInOrigin(), A, 'naming it chose it')
  })
})
