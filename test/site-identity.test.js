/**
 * Site identity, read from `sync.json` — and the guard that no longer exists.
 *
 * ⭐ **The headline is a DELETION.** `assertSiteBackendScope` refused a command whose
 * resolved origin disagreed with the project's recorded `$backend`, and it carried an
 * accepted false positive: an absent `$backend` read as the default backend, so a
 * project synced elsewhere before the key existed was stopped and told it belonged to
 * a backend it had never used.
 *
 * Keyed by origin, the confusion it guarded against is unrepresentable — a command for
 * B reads B's section and finds B's ids or nothing. These tests assert that shape
 * directly rather than asserting the guard is gone, because "the function was deleted"
 * is a fact about the module and "identity cannot cross" is a fact about the design.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  readSiteIdentity,
  syncedBackends,
  syncedElsewhere,
  normalizeOrigin
} from '../src/utils/site-identity.js'

const A = 'https://uniweb.app'
const B = 'http://localhost:8080'
const dirs = []

process.on('exit', () => {
  for (const d of dirs) {
    try {
      rmSync(d, { recursive: true, force: true })
    } catch {
      /* best effort */
    }
  }
})

/** A site dir, optionally bound to one or more backends. */
function site(bound = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'uw-identity-'))
  dirs.push(dir)
  writeFileSync(join(dir, 'site.yml'), 'name: demo\nfoundation: "@acme/f"\n')
  const backends = {}
  for (const [origin, siteState] of Object.entries(bound)) {
    backends[origin] = { site: siteState }
  }
  if (Object.keys(backends).length) {
    writeFileSync(join(dir, 'sync.json'), JSON.stringify({ version: 1, backends }))
  }
  return dir
}

// ───────────────────────────── identity is per backend ─────────────────────────

test('identity is read for ONE backend, and another backend sees nothing', () => {
  const dir = site({ [A]: { uuid: 'SITE-A', org: 'acme' } })

  assert.deepEqual(readSiteIdentity(dir, A), { uuid: 'SITE-A', org: 'acme' })
  assert.deepEqual(
    readSiteIdentity(dir, B),
    { uuid: null, org: null },
    "B must not inherit A's identity — this is the guard's whole job, done structurally"
  )
})

test('two backends coexist without either shadowing the other', () => {
  const dir = site({ [A]: { uuid: 'SITE-A' }, [B]: { uuid: 'SITE-B' } })

  assert.equal(readSiteIdentity(dir, A).uuid, 'SITE-A')
  assert.equal(readSiteIdentity(dir, B).uuid, 'SITE-B')
  assert.deepEqual(syncedBackends(dir), [A, B].sort())
})

test('an unsynced project reads as nothing, not as the default backend', () => {
  const dir = site()
  assert.deepEqual(readSiteIdentity(dir, A), { uuid: null, org: null })
  assert.deepEqual(syncedBackends(dir), [])
})

test('a full endpoint URL addresses the same backend as its bare origin', () => {
  const dir = site({ [B]: { uuid: 'SITE-B' } })
  assert.equal(readSiteIdentity(dir, `${B}/dev/site/abc`).uuid, 'SITE-B')
  assert.equal(normalizeOrigin(`${B}/anything`), B)
})

test('a malformed or missing sync.json reads as unsynced rather than throwing', () => {
  const dir = site()
  writeFileSync(join(dir, 'sync.json'), '{ not json')
  assert.deepEqual(readSiteIdentity(dir, A), { uuid: null, org: null })
  assert.deepEqual(syncedBackends(dir), [])
})

// ─────────────────────────────── where the site is ─────────────────────────────
//
// A project's record routes nothing — every command goes to the backend the user is
// logged in to [Diego, 2026-09-21]. What the record still does is SAY where the site is,
// when a command lands on a backend where it has none.

test('⭐ names where the site is when the command goes somewhere it is not', () => {
  const dir = site({ [A]: { uuid: 'S' } })
  assert.deepEqual(syncedElsewhere(dir, B), [A])
  assert.deepEqual(syncedElsewhere(dir, `${B}/dev/x`), [A], 'by origin')
})

test('silent when the site IS there, or the project has synced nowhere', () => {
  assert.equal(syncedElsewhere(site({ [A]: { uuid: 'S' }, [B]: { uuid: 'T' } }), B), null)
  assert.equal(syncedElsewhere(site(), B), null)
  assert.equal(syncedElsewhere(site({ [A]: { uuid: 'S' } }), 'not a url'), null)
  assert.equal(syncedElsewhere(site({ [A]: { uuid: 'S' } }), 'localhost:8080'), null, 'no scheme is no origin')
})
