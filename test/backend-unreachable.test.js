/**
 * A backend that cannot be reached is not an answer, and must not read as one.
 *
 * `readFoundationLatest` folded every failure into `null` — "not registered" — so a publish
 * with the backend down announced "Releasing the foundation (not yet registered)…", failed
 * inside `register`, and ended on "Fix the foundation". Now a transport failure throws
 * `BackendUnreachableError`, and every answer the backend gives still degrades to `null`
 * as before (a refusal on another scope is explained by the release path, not here).
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { BackendClient, BackendUnreachableError } from '../src/backend/client.js'

const client = (fetchImpl) =>
  new BackendClient({ origin: 'http://backend.test', token: 'TKN', fetchImpl })

const down = async () => {
  throw new TypeError('fetch failed')
}

test('a backend that does not answer throws BackendUnreachableError, naming the origin', async () => {
  await assert.rejects(client(down).readFoundationLatest('@acme/site'), (err) => {
    assert.ok(err instanceof BackendUnreachableError)
    assert.match(err.message, /Could not reach the backend at http:\/\/backend\.test: fetch failed/)
    return true
  })
})

test('every answer the backend gives still reads as not found', async () => {
  for (const status of [404, 403, 500]) {
    const c = client(async () => new Response('{}', { status }))
    assert.equal(await c.readFoundationLatest('@acme/site'), null, `status ${status}`)
  }
})

test('control: a registered foundation is read as before', async () => {
  const c = client(async () => new Response(JSON.stringify({ version: '1.2.0', digest: 'sha256:x' }), { status: 200 }))
  const got = await c.readFoundationLatest('@acme/site')
  assert.equal(got.latest_version, '1.2.0')
  assert.equal(got.digest, 'sha256:x')
})

test('an error that is not a transport failure is not mistaken for one', async () => {
  const c = client(async () => {
    throw new TypeError('something else')
  })
  assert.equal(await c.readFoundationLatest('@acme/site'), null)
})
