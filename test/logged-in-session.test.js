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

test('every login replaces the session; logging out leaves nobody logged in', async () => {
  // [Diego, 2026-09-21] — one session at a time: login replaces, logout clears.
  const { writeRegistryAuth, clearRegistryAuth } = await import('../src/utils/registry-auth.js')
  const { loggedInOrigin } = await import('../src/utils/config.js')
  await withHome(null, async (home) => {
    await writeRegistryAuth({ origin: A, token: 'ta' })
    assert.equal(loggedInOrigin(), A)
    await writeRegistryAuth({ origin: `${B}/dev/whatever`, token: 'tb' })
    assert.equal(loggedInOrigin(), B, 'the second login is the one')
    const file = JSON.parse(readFileSync(join(home, '.uniweb', 'registry-auth.json'), 'utf8'))
    assert.deepEqual(Object.keys(file.sessions), [B], 'and A is logged out')

    await clearRegistryAuth()
    assert.equal(loggedInOrigin(), null, 'logged out')
  })
})

test('⭐ `uniweb login --backend X` when X is the session: nothing to do', async () => {
  // Logging in again is behind a method flag. Also where a file from the per-backend
  // days, holding X among others, becomes single: only X's session is kept.
  const { runRegistryLogin } = await import('../src/utils/registry-auth.js')
  const { loggedInOrigin } = await import('../src/utils/config.js')
  await withHome({ version: 2, current: B, sessions: sessions(A, B) }, async (home) => {
    const err = console.error
    console.error = () => {}
    try {
      const got = await runRegistryLogin({ apiBase: A, args: [] })
      assert.equal(got?.origin, A, 'the stored session is reused')
    } finally {
      console.error = err
    }
    assert.equal(loggedInOrigin(), A)
    const file = JSON.parse(readFileSync(join(home, '.uniweb', 'registry-auth.json'), 'utf8'))
    assert.deepEqual(Object.keys(file.sessions), [A], 'one session left: A')
  })
})

test('logging in elsewhere keeps you where you were until the new login succeeds', async () => {
  // Replace ON SUCCESS: a cancelled or failed login must not leave you logged out of both.
  const { runRegistryLogin } = await import('../src/utils/registry-auth.js')
  const { loggedInOrigin } = await import('../src/utils/config.js')
  await withHome({ version: 2, current: A, sessions: sessions(A) }, async () => {
    const saved = { err: console.error, exit: process.exit, user: process.env.UNIWEB_USERNAME }
    console.error = () => {}
    delete process.env.UNIWEB_USERNAME
    process.exit = (code) => {
      throw new Error(`exit ${code}`)
    }
    try {
      // No method and no terminal: this login cannot complete.
      await assert.rejects(runRegistryLogin({ apiBase: B, args: ['--non-interactive'] }), /exit/)
    } finally {
      console.error = saved.err
      process.exit = saved.exit
      if (saved.user !== undefined) process.env.UNIWEB_USERNAME = saved.user
    }
    assert.equal(loggedInOrigin(), A, 'still logged in to A')
  })
})

test('a method flag means LOG IN AGAIN, not switch', async () => {
  const { runRegistryLogin } = await import('../src/utils/registry-auth.js')
  const { loggedInOrigin } = await import('../src/utils/config.js')
  await withHome({ version: 2, current: B, sessions: sessions(A, B) }, async () => {
    const saved = { err: console.error, exit: process.exit, user: process.env.UNIWEB_USERNAME }
    console.error = () => {}
    delete process.env.UNIWEB_USERNAME
    process.exit = (code) => {
      throw new Error(`exit ${code}`)
    }
    try {
      // --password without a terminal or credentials cannot complete — which is the
      // point: it went for a login instead of returning the stored session.
      await assert.rejects(
        runRegistryLogin({ apiBase: A, args: ['--password', '--non-interactive'] }),
        /exit/
      )
    } finally {
      console.error = saved.err
      process.exit = saved.exit
      if (saved.user !== undefined) process.env.UNIWEB_USERNAME = saved.user
    }
    assert.equal(loggedInOrigin(), B, 'no switch happened')
  })
})

test('⭐ a bare `uniweb login` goes to the default backend — never the current one', async () => {
  // [Diego, 2026-09-21] — "the default backend for login, if not specified, is uniweb.app".
  const { resolveLoginOrigin, getRegistryApiBaseUrl } = await import('../src/utils/config.js')
  await withHome({ version: 2, current: A, sessions: sessions(A) }, () => {
    assert.equal(getRegistryApiBaseUrl(), A, 'commands go to the backend you are on (control)')
    assert.equal(resolveLoginOrigin(undefined), DEFAULT, 'a bare login does not')
    assert.equal(resolveLoginOrigin(`${B}/dev/x`), B, '--backend names it, by origin')
  })
})

test('a mistyped --backend on login is refused, never quietly replaced', async () => {
  const { resolveLoginOrigin } = await import('../src/utils/config.js')
  // The realistic slip: no scheme. `new URL()` PARSES it — as the scheme `localhost:` — with
  // the origin "null"; accepted, it would have logged in to a backend called "null".
  assert.throws(() => resolveLoginOrigin('localhost:8080'), /Not a URL/)
  assert.throws(() => resolveLoginOrigin('localhost:8080x'), /Not a URL/)
  assert.throws(() => resolveLoginOrigin(null), /needs a URL/)
})
