/**
 * `uniweb org` — the orgs you belong to, beside the personal scope you need none for.
 *
 * ⭐ A scope is a namespace (2026-09-23): `@<your handle>` is your own, with no org. An
 * org needs a handle of its own, and a backend refuses one named after an account —
 * so asking for an org named after yourself is answered here, before any create.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runVerb, tmp } from './helpers/run-verb.js'

const ORIGIN = 'http://backend.test'
const ENV = { UNIWEB_REGISTER_URL: ORIGIN, UNIWEB_TOKEN: 'TKN' }

/** Answers `GET /dev/orgs` as the backend does, and records every other request. */
function orgsBackend({ accountHandle = 'jane', orgs = [] } = {}) {
  const posts = []
  const respond = async (url, init = {}) => {
    if (!url.endsWith('/dev/orgs')) return undefined
    if ((init.method || 'GET') === 'GET') {
      return new Response(JSON.stringify({ account_handle: accountHandle, orgs }), { status: 200 })
    }
    posts.push(JSON.parse(init.body))
    return new Response(JSON.stringify({ handle: posts.at(-1).handle, is_primary: false }), {
      status: 201
    })
  }
  return { respond, posts }
}

test('`org create <your own handle>` is refused before any create — it is your personal scope', async () => {
  const { org } = await import('../src/commands/org.js')
  const backend = orgsBackend()
  const run = await runVerb(tmp('uw-org-'), org, ['create', 'jane'], { env: ENV, respond: backend.respond })
  assert.equal(run.exitCode, 2)
  assert.match(run.output, /@jane is your personal scope already/)
  assert.deepEqual(backend.posts, [], 'no create was sent')
})

test('`org create <another handle>` creates it', async () => {
  const { org } = await import('../src/commands/org.js')
  const backend = orgsBackend()
  const run = await runVerb(tmp('uw-org-'), org, ['create', 'acme'], { env: ENV, respond: backend.respond })
  assert.equal(run.exitCode, 0)
  assert.deepEqual(backend.posts, [{ handle: 'acme' }])
})

test('`org list` names your personal scope, and an org named after you only once', async () => {
  const { org } = await import('../src/commands/org.js')
  const backend = orgsBackend({
    orgs: [
      { handle: 'jane', is_primary: false }, // a personal org made before 2026-09-23
      { handle: 'acme', is_primary: true }
    ]
  })
  const run = await runVerb(tmp('uw-org-'), org, ['list'], { env: ENV, respond: backend.respond })
  assert.equal(run.exitCode, 0)
  assert.match(run.output, /Your personal scope: .*@jane/)
  assert.match(run.output, /@acme/)
  assert.equal(run.output.match(/@jane/g).length, 1)
})
