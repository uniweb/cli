/**
 * The workspace a request names — `x-uniweb-workspace: @<handle>` — and the backend's
 * `409 wrong_workspace` when the site is not in it.
 *
 * The properties pinned here were agreed with the backend rather than assumed:
 *
 *   - `@` REQUIRED on the wire — a bare value is read as a unit uuid on the other end;
 *   - only the SITE routes name one: registration takes its owner from the `@scope` in
 *     the name, and a refused workspace must never fail a registration;
 *   - the `409` DECIDES, and the CLI compares no handles — a site in a sub-org is
 *     legitimately worked on from its parent;
 *   - ⭐ a command works in ONE workspace, chosen with the login (backend/workspace.js):
 *     a site outside it STOPS the command, whatever named the workspace — nothing is
 *     adopted, nothing is retried *[Diego, 2026-09-23]*.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  BackendClient,
  WORKSPACE_HEADER,
  WorkspaceMismatchError,
  workspaceHandle,
  workspaceHeader,
  namesWorkspace,
  describeRequestError,
  describeWorkspace,
  refusalDetail
} from '../src/backend/client.js'

const ORIGIN = 'http://backend.test'
const SITE = '/dev/site/content/pull/SITE-1'
const UNIT = '01926d5e-0000-7000-8000-0000000000c1'

/** A client whose requests are recorded and answered in order (then 200). */
function recorded(...answers) {
  const calls = []
  const client = new BackendClient({
    origin: ORIGIN,
    token: 'TKN',
    fetchImpl: async (url, init) => {
      calls.push({ url, headers: init.headers })
      const next = answers.shift()
      return next ? next() : new Response('{}', { status: 200 })
    }
  })
  return { client, calls }
}

/** The backend's refusal, in the shape it ships (bare handle; both null = personal). */
const wrongWorkspace = (handle, unitUuid = handle ? 'UNIT-1' : null) => () =>
  new Response(
    JSON.stringify({
      status: 409,
      reason: 'wrong_workspace',
      what: 'site',
      workspace: { unit_uuid: unitUuid, handle }
    }),
    { status: 409, headers: { 'content-type': 'application/problem+json' } }
  )

// ─── the header ───────────────────────────────────────────────────────────────

test('a workspace is written `@handle` whatever spelling it arrives in', () => {
  assert.equal(workspaceHandle('@acme'), '@acme')
  assert.equal(workspaceHandle('acme'), '@acme')
  assert.equal(workspaceHandle('@acme/marketing'), '@acme')
  assert.equal(workspaceHandle('  @acme '), '@acme')
  for (const none of [null, undefined, '', '@', 42]) assert.equal(workspaceHandle(none), null)
})

test('the header takes a handle-less unit by its uuid, bare — and a handle keeps its @', () => {
  assert.equal(workspaceHeader(UNIT), UNIT)
  assert.equal(workspaceHeader('@acme'), '@acme')
  assert.equal(workspaceHeader('acme'), '@acme')
  // ⚠️ Our handle grammar admits a uuid-shaped handle, so a HANDLE must arrive dressed.
  assert.equal(workspaceHeader(workspaceHandle(UNIT)), `@${UNIT}`)
  assert.equal(workspaceHeader(null), null)
})

test('site routes name the workspace; registry, assets, auth, orgs and config do not', async () => {
  assert.equal(namesWorkspace('/dev/site'), true)
  assert.equal(namesWorkspace('/dev/site/publish/S'), true)
  assert.equal(namesWorkspace('/dev/site/data-uploads/S'), true)
  for (const p of ['/dev/registry/register', '/dev/assets', '/dev/auth/me', '/dev/orgs', '/dev/config', '/dev/sites'])
    assert.equal(namesWorkspace(p), false, p)

  const { client, calls } = recorded()
  client.setWorkspace('acme')
  await client.request(SITE)
  await client.request('/dev/registry/acme/marketing')
  assert.equal(calls[0].headers[WORKSPACE_HEADER], '@acme', 'the @ is required on the wire')
  assert.equal(calls[1].headers[WORKSPACE_HEADER], undefined)
})

test('the personal workspace is named by omission — no header', async () => {
  const { client, calls } = recorded()
  client.setWorkspace(null)
  await client.request(SITE)
  assert.equal(WORKSPACE_HEADER in calls[0].headers, false)
})

// ─── the 409: the site is not in the workspace this command works in ──────────

test('⛔ a site in another workspace STOPS the command — nothing adopted, no retry', async () => {
  const { client, calls } = recorded(wrongWorkspace('client'))
  client.setWorkspace('@acme', { source: 'login' })
  await assert.rejects(client.request(SITE), (err) => {
    assert.ok(err instanceof WorkspaceMismatchError)
    assert.equal(err.named, '@acme')
    assert.equal(err.answer, '@client')
    assert.match(err.message, /This site is in @client, and you are working in @acme\./)
    assert.match(err.message, /To work on it: uniweb login --org @client$/)
    return true
  })
  assert.equal(calls.length, 1)
  assert.equal(client.workspace, '@acme', 'the workspace is not changed behind the user')
})

test('the way out is said the way the workspace was chosen — flag, env, login', async () => {
  const cases = [
    ['flag', /\(named on this command\)\. To work on it, pass --org @client\./],
    ['env', /\(UNIWEB_WORKSPACE\)\. To work on it, set UNIWEB_WORKSPACE=@client\./],
    ['login', /To work on it: uniweb login --org @client$/],
    ['personal', /To work on it: uniweb login --org @client$/]
  ]
  for (const [source, expected] of cases) {
    const { client } = recorded(wrongWorkspace('client'))
    client.setWorkspace(null, { source })
    await assert.rejects(client.request(SITE), (err) => {
      assert.match(err.message, /you are working in your personal workspace/, source)
      assert.match(err.message, expected, source)
      return true
    })
  }
})

test('a site in the personal workspace, or in a unit with no handle, is said as such', async () => {
  const personal = recorded(wrongWorkspace(null))
  personal.client.setWorkspace('@acme')
  await assert.rejects(personal.client.request(SITE), /in your personal workspace, .* uniweb login --personal/)

  const unit = recorded(wrongWorkspace(null, UNIT))
  unit.client.setWorkspace('@acme')
  await assert.rejects(unit.client.request(SITE), new RegExp(`in the unit ${UNIT}.*It has no handle`))
})

test('refused while naming what the backend names: the 409 is returned, not thrown', async () => {
  const { client, calls } = recorded(wrongWorkspace('acme'))
  client.setWorkspace('@acme')
  const res = await client.request(SITE)
  assert.equal(res.status, 409)
  assert.equal(calls.length, 1)
})

test('any other 409 is the caller’s — untouched', async () => {
  const { client, calls } = recorded(
    () => new Response(JSON.stringify({ reason: 'stale_version' }), { status: 409 })
  )
  const res = await client.request(SITE)
  assert.equal(res.status, 409)
  assert.equal((await res.json()).reason, 'stale_version', 'the body is still readable')
  assert.equal(calls.length, 1)
})

test('a one-workspace deployment’s plain 409 is surfaced as it is', async () => {
  // No `reason`, no `workspace`: that backend has nothing to switch to.
  const conflict = { status: 409, title: 'Conflict', detail: 'This deployment has one workspace, @home.' }
  const { client } = recorded(() => new Response(JSON.stringify(conflict), { status: 409 }))
  client.setWorkspace('@acme')
  const res = await client.request(SITE)
  assert.equal(res.status, 409)
  assert.equal(await refusalDetail(res), conflict.detail)
  assert.equal(await refusalDetail(new Response('upstream said no', { status: 502 })), 'upstream said no')
  assert.equal(await refusalDetail(new Response('', { status: 409 })), null)
})

// ─── reporting ────────────────────────────────────────────────────────────────

test('a mismatch prints as itself, never as "could not reach the backend"', () => {
  const mismatch = new WorkspaceMismatchError({ named: '@client', answer: '@acme' })
  assert.equal(describeRequestError(mismatch, ORIGIN), mismatch.message)
  assert.match(
    describeRequestError(new Error('ECONNREFUSED'), ORIGIN),
    /^Could not reach the backend at http:\/\/backend\.test: ECONNREFUSED$/
  )
})

test('a workspace in a sentence', () => {
  assert.equal(describeWorkspace('@acme'), '@acme')
  assert.equal(describeWorkspace(null), 'your personal workspace')
  assert.equal(describeWorkspace('personal'), 'your personal workspace')
  assert.equal(describeWorkspace(UNIT), `the unit ${UNIT}`)
})
