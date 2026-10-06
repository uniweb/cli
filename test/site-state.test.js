/**
 * ⭐ WHETHER THE BACKEND STILL HOLDS A BINDING'S SITE — live, gone or unknown, never folded.
 *
 * A script deciding, before any push, whether to forget a binding reads `remote.site_state`
 * from `uniweb status --remote --json`. A push from an unbound copy CREATES a site, so a
 * binding dropped because its site was merely unreadable leaves a second copy beside the
 * first: ⛔ `gone` is said only on the backend's own word about THIS site — a `404` naming it.
 *
 * The answers below are the ones a local backend gave on 2026-10-06; its wire is its to change.
 *
 * Run: `pnpm test` or `node --test test/`
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BackendClient } from '../src/backend/client.js'

const ORIGIN = 'http://backend.test'
const UUID = '01a10f88-be6e-7cc1-81ce-98f11e2a045e'

/** A client whose one request answers `status` with `body` (or throws `body` when it is an Error). */
function answering(status, body, { workspace = '@acme' } = {}) {
  const client = new BackendClient({
    origin: ORIGIN,
    token: 't',
    fetchImpl: async () => {
      if (body instanceof Error) throw body
      return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/problem+json' }
      })
    }
  })
  return client.setWorkspace(workspace)
}

test('live: the status came back', async () => {
  const s = await answering(200, { published: false, draft_dirty: true }).siteState(UUID)
  assert.equal(s.state, 'live')
  assert.equal(s.site.draft_dirty, true)
})

test('live: refused as another workspace\'s — the refusal says where it is', async () => {
  const s = await answering(409, {
    status: 409, title: 'Wrong Workspace', reason: 'wrong_workspace', what: 'site',
    detail: 'this site belongs to the @acme workspace; open it there to work on it',
    workspace: { unit_uuid: '01a10f84-65f4-7332-ad55-a76018ce5a07', handle: 'acme' }
  }, { workspace: '@hooli' }).siteState(UUID)
  assert.equal(s.state, 'live')
  assert.equal(s.workspace, '@acme')
})

test('gone: a 404 that names this site', async () => {
  const s = await answering(404, {
    status: 404, title: 'Not Found', detail: `site ${UUID} not found`, kind: 'site', key: UUID
  }).siteState(UUID)
  assert.equal(s.state, 'gone')
})

test('⛔ unknown — never gone — for everything that is not the backend\'s word about THIS site', async () => {
  const cases = [
    ['a 404 naming another site', answering(404, { status: 404, kind: 'site', key: '0199aaaa-bbbb-7ccc-8ddd-eeeeffff0000' })],
    ['a 404 naming no site (a backend too old for the route)', answering(404, { status: 404, title: 'Not Found' })],
    ['a 404 with no body', answering(404, '')],
    ['a refused credential', answering(401, { status: 401, title: 'Unauthorized' })],
    ['a refused id', answering(400, { status: 400, title: 'Bad Request', detail: 'invalid uuid: x' })],
    ['a server error', answering(500, 'boom')],
    ['no answer at all', answering(0, new TypeError('fetch failed'))]
  ]
  for (const [what, client] of cases) {
    const s = await client.siteState(UUID)
    assert.equal(s.state, 'unknown', what)
  }
})
