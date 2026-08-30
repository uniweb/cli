/**
 * `/dev/*` is the uniweb CLI's lane, and the CLI is an AUTHENTICATED client — top-level
 * routes are segregated by client type [Diego, 2026-08-30]. `discover()` is the only
 * place that ever bent that rule, so it is the only place worth pinning.
 *
 * The rule it must keep: apart from the login routes themselves, no `/dev/*` request
 * leaves without a bearer. That was FALSE until 2026-08-30 — `GET /dev/config` went out
 * anonymously, and on `publish --dry-run` it was never followed by a credential at all
 * (measured at the wire: one request, cold, then exit).
 *
 * ⚠️ The failure mode is silent in both directions, which is why it is a test and not a
 * comment: an anonymous probe still WORKS while the route is open, and a `token()` call
 * here would still work while a session happens to be stored. Neither shows up until it
 * is someone else's problem — a disclosure on one side, a surprise password prompt on
 * the other.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BackendClient, DISCOVERY_DEFAULTS } from '../src/backend/client.js'

const ORIGIN = 'https://backend.example'

function recordingFetch(calls, body = { delivery: { publish: true } }) {
  return async (url, init) => {
    calls.push({ url, headers: init?.headers || {} })
    return {
      ok: true,
      status: 200,
      json: async () => body
    }
  }
}

test('discover(): with a token, /dev/config is sent AND carries the bearer', async () => {
  const calls = []
  const client = new BackendClient({
    origin: ORIGIN,
    token: 'TOK',
    fetchImpl: recordingFetch(calls)
  })
  const cfg = await client.discover()

  assert.equal(calls.length, 1)
  assert.match(calls[0].url, /\/dev\/config$/)
  assert.equal(calls[0].headers.Authorization, 'Bearer TOK')
  assert.equal(cfg.delivery.publish, true)
})

test('discover(): ⛔ with NO credential, NO request is made — defaults instead', async () => {
  // The load-bearing assertion. `getToken` returning null stands in for "nothing
  // explicit, nothing in the env, no stored session".
  const calls = []
  const client = new BackendClient({
    origin: ORIGIN,
    getToken: async () => null,
    fetchImpl: recordingFetch(calls)
  })
  const cfg = await client.discover()

  assert.equal(calls.length, 0, 'no credential must mean no /dev request')
  assert.deepEqual(cfg, { ...DISCOVERY_DEFAULTS })
})

test('discover(): never PROMPTS for a credential to satisfy itself', async () => {
  // It must use the non-prompting resolver. If it ever reached `token()` ->
  // ensureRegistryAuth, a capability probe could open a password prompt — a worse
  // defect than the anonymous call this replaced. A throwing getToken proves which
  // path it takes: `_tokenIfAvailable` swallows, `token()` would propagate.
  const calls = []
  const client = new BackendClient({
    origin: ORIGIN,
    getToken: async () => {
      throw new Error('ensureRegistryAuth would have prompted here')
    },
    fetchImpl: recordingFetch(calls)
  })

  const cfg = await client.discover()
  assert.equal(calls.length, 0)
  assert.deepEqual(cfg, { ...DISCOVERY_DEFAULTS })
})

test('discover(): a 401 degrades to defaults rather than failing the command', async () => {
  // Forward-compatibility with the route moving behind auth: a rejected bearer must
  // never be the reason a publish stops. Defaults report the publish lane as offered,
  // which is the safe direction.
  const client = new BackendClient({
    origin: ORIGIN,
    token: 'STALE',
    fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({}) })
  })
  assert.deepEqual(await client.discover(), { ...DISCOVERY_DEFAULTS })
})

test('DISCOVERY_DEFAULTS carry no serve location and no runtime set', async () => {
  // Both were deleted (assetBase 2026-08-17, gatewayBase 2026-07-29 unread, runtime
  // 2026-08-22) because a serve location is read from the response that carries it and
  // a backend holds no runtimes. A default here would be a reader waiting to happen.
  assert.equal(DISCOVERY_DEFAULTS.assetBase, undefined)
  assert.equal(DISCOVERY_DEFAULTS.gatewayBase, undefined)
  assert.equal(DISCOVERY_DEFAULTS.runtime, undefined)
})
