/**
 * ONE SESSION PER BACKEND ORIGIN.
 *
 * ⛔ The store was a single flat record until 2026-09-20, and the headline test here is
 * the CORRECTNESS bug that shape caused, not the new capability: `ensureRegistryAuth`
 * returned the stored token whenever it was unexpired, without checking which origin
 * issued it. A bearer minted by backend A was sent to backend B, which rejects it —
 * and `BackendClient.token()` could only warn afterwards, because with one slot there
 * was nothing better available.
 *
 * The second group is the upgrade: a v1 record must keep its owner logged in. Getting
 * that wrong logs out every existing user on a patch, which is the kind of thing a
 * release notices only from the support channel.
 *
 * ⚠️ These redirect `$HOME`, because the store resolves `~/.uniweb` through
 * `os.homedir()` at CALL time. Each test restores it.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir, homedir } from 'node:os'
import { join } from 'node:path'
import {
  readRegistryAuth,
  writeRegistryAuth,
  clearRegistryAuth,
  listRegistrySessions,
  getRegistryAuthPath
} from '../src/utils/registry-auth.js'
import { DEFAULT_BACKEND_ORIGIN } from '../src/utils/config.js'

const A = 'https://uniweb.app'
const B = 'http://localhost:8080'
const C = 'https://proximify.app'

const dirs = []

/** A fresh fake HOME. Returns a restore function. */
function fakeHome() {
  const d = mkdtempSync(join(tmpdir(), 'uw-auth-'))
  dirs.push(d)
  const prior = process.env.HOME
  process.env.HOME = d
  // Sanity: the module must actually follow us, or every assertion below is vacuous.
  assert.ok(
    getRegistryAuthPath().startsWith(d),
    `the store did not follow $HOME (got ${getRegistryAuthPath()}) — this test cannot assert anything`
  )
  return () => {
    if (prior === undefined) delete process.env.HOME
    else process.env.HOME = prior
  }
}

/** Write a legacy v1 flat record straight to disk. */
function seedLegacy(record) {
  mkdirSync(join(process.env.HOME, '.uniweb'), { recursive: true })
  writeFileSync(getRegistryAuthPath(), JSON.stringify(record, null, 2))
}

process.on('exit', () => {
  for (const d of dirs) {
    try {
      rmSync(d, { recursive: true, force: true })
    } catch {
      /* best effort */
    }
  }
})

// ───────────────────────── the bug the flat record caused ─────────────────────────

test("a session for one backend is NOT handed to another", async () => {
  const restore = fakeHome()
  try {
    await writeRegistryAuth({ origin: A, token: 'token-for-A' })

    assert.equal((await readRegistryAuth(A))?.token, 'token-for-A')
    assert.equal(
      await readRegistryAuth(B),
      null,
      'asking for a backend with no session must be null — returning A\'s token here is the bug'
    )
  } finally {
    restore()
  }
})

test('logging into a second backend does not evict the first', async () => {
  const restore = fakeHome()
  try {
    await writeRegistryAuth({ origin: A, token: 'a' })
    await writeRegistryAuth({ origin: B, token: 'b' })
    await writeRegistryAuth({ origin: C, token: 'c' })

    assert.equal((await readRegistryAuth(A))?.token, 'a')
    assert.equal((await readRegistryAuth(B))?.token, 'b')
    assert.equal((await readRegistryAuth(C))?.token, 'c')
  } finally {
    restore()
  }
})

test('a full URL and a bare origin address the same session', async () => {
  const restore = fakeHome()
  try {
    await writeRegistryAuth({ origin: `${B}/dev/auth/login`, token: 'b' })
    assert.equal((await readRegistryAuth(B))?.token, 'b')
    assert.equal((await readRegistryAuth(`${B}/anything`))?.token, 'b')
  } finally {
    restore()
  }
})

test('the session carries its own origin back, so a caller never has to remember it', async () => {
  const restore = fakeHome()
  try {
    await writeRegistryAuth({ origin: B, token: 'b', username: 'diego' })
    const s = await readRegistryAuth(B)
    assert.equal(s.origin, B)
    assert.equal(s.username, 'diego')
  } finally {
    restore()
  }
})

// ─────────────────────────── the v1 upgrade: nobody logs out ───────────────────────

test('a v1 flat record keeps its owner logged in, under its own origin stamp', async () => {
  const restore = fakeHome()
  try {
    seedLegacy({ token: 'legacy', origin: B, username: 'diego' })

    const s = await readRegistryAuth(B)
    assert.equal(s?.token, 'legacy', 'the upgrade must not log anyone out')
    assert.equal(s.username, 'diego')
    assert.equal(await readRegistryAuth(A), null, 'and it belongs to B alone')
  } finally {
    restore()
  }
})

test('a v1 record with NO origin stamp reads as the default backend', async () => {
  const restore = fakeHome()
  try {
    seedLegacy({ token: 'ancient' })
    // Same "absent means the default" rule site.yml::$backend uses — the only
    // inference available, and the one that keeps the 98% logged in.
    assert.equal((await readRegistryAuth(DEFAULT_BACKEND_ORIGIN))?.token, 'ancient')
  } finally {
    restore()
  }
})

test('an unreadable store reads as "no sessions" rather than throwing', async () => {
  const restore = fakeHome()
  try {
    mkdirSync(join(process.env.HOME, '.uniweb'), { recursive: true })
    writeFileSync(getRegistryAuthPath(), '{ not json')
    assert.equal(await readRegistryAuth(A), null)
    assert.deepEqual(await listRegistrySessions(), [])
  } finally {
    restore()
  }
})

test('writing after a v1 record upgrades the file without losing the old session', async () => {
  const restore = fakeHome()
  try {
    seedLegacy({ token: 'legacy', origin: A })
    await writeRegistryAuth({ origin: B, token: 'new' })

    assert.equal((await readRegistryAuth(A))?.token, 'legacy')
    assert.equal((await readRegistryAuth(B))?.token, 'new')
    const onDisk = JSON.parse(readFileSync(getRegistryAuthPath(), 'utf8'))
    assert.equal(onDisk.version, 2)
    assert.deepEqual(Object.keys(onDisk.sessions).sort(), [A, B].sort())
  } finally {
    restore()
  }
})

// ──────────────────────────────── listing and clearing ────────────────────────────

test('listRegistrySessions reports every backend the machine knows', async () => {
  const restore = fakeHome()
  try {
    assert.deepEqual(await listRegistrySessions(), [], 'nothing stored ⇒ empty')
    await writeRegistryAuth({ origin: A, token: 'a' })
    await writeRegistryAuth({ origin: B, token: 'b' })
    const origins = (await listRegistrySessions()).map((s) => s.origin).sort()
    assert.deepEqual(origins, [A, B].sort())
  } finally {
    restore()
  }
})

test('clearing one backend leaves the others signed in', async () => {
  const restore = fakeHome()
  try {
    await writeRegistryAuth({ origin: A, token: 'a' })
    await writeRegistryAuth({ origin: B, token: 'b' })

    assert.deepEqual(await clearRegistryAuth(B), [B], 'reports what it cleared')
    assert.equal(await readRegistryAuth(B), null)
    assert.equal((await readRegistryAuth(A))?.token, 'a', 'A survives')
  } finally {
    restore()
  }
})

test('clearing a backend with no session is a no-op that says so', async () => {
  const restore = fakeHome()
  try {
    await writeRegistryAuth({ origin: A, token: 'a' })
    assert.deepEqual(await clearRegistryAuth(C), [])
    assert.equal((await readRegistryAuth(A))?.token, 'a')
  } finally {
    restore()
  }
})

test('clearing with no argument clears every session and removes the file', async () => {
  const restore = fakeHome()
  try {
    await writeRegistryAuth({ origin: A, token: 'a' })
    await writeRegistryAuth({ origin: B, token: 'b' })

    const cleared = await clearRegistryAuth()
    assert.deepEqual(cleared.sort(), [A, B].sort())
    assert.equal(existsSync(getRegistryAuthPath()), false)
    assert.deepEqual(await listRegistrySessions(), [])
  } finally {
    restore()
  }
})

test('clearing the last session removes the file rather than leaving an empty map', async () => {
  const restore = fakeHome()
  try {
    await writeRegistryAuth({ origin: A, token: 'a' })
    await clearRegistryAuth(A)
    assert.equal(
      existsSync(getRegistryAuthPath()),
      false,
      'an empty store and no store must not be two different states'
    )
  } finally {
    restore()
  }
})
