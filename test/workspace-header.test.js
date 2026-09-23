/**
 * The workspace a request names — `x-uniweb-workspace: @<handle>` — and the backend's
 * `409 wrong_workspace` when it is the wrong one for an existing site.
 *
 * The properties pinned here were agreed with the backend rather than assumed:
 *
 *   - `@` REQUIRED on the wire — a bare value is read as a unit uuid on the other end;
 *   - only the SITE routes name one: registration takes its owner from the `@scope` in
 *     the name, and a refused workspace must never fail a registration;
 *   - the `409` DECIDES, and the CLI compares no handles — a site in a sub-org is
 *     legitimately worked on from its parent;
 *   - the user NAMED it (`--org`, `--personal`) → stop; nothing named, or a stale
 *     record → adopt the backend's answer, record it, retry ONCE.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  BackendClient,
  WORKSPACE_HEADER,
  WorkspaceMismatchError,
  workspaceHandle,
  namesWorkspace,
  describeRequestError
} from '../src/backend/client.js'
import { nameSiteWorkspace, readSiteOrg } from '../src/backend/site-sync.js'

const ORIGIN = 'http://backend.test'
const SITE = '/dev/site/content/pull/SITE-1'

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

function tmpSite() {
  const dir = mkdtempSync(join(tmpdir(), 'uniweb-workspace-'))
  writeFileSync(join(dir, 'site.yml'), 'name: Acme\n')
  return dir
}

// ─── the header ───────────────────────────────────────────────────────────────

test('a workspace is written `@handle` whatever spelling it arrives in', () => {
  assert.equal(workspaceHandle('@acme'), '@acme')
  assert.equal(workspaceHandle('acme'), '@acme')
  assert.equal(workspaceHandle('@acme/marketing'), '@acme')
  assert.equal(workspaceHandle('  @acme '), '@acme')
  for (const none of [null, undefined, '', '@', 42]) assert.equal(workspaceHandle(none), null)
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

test('naming none sends no header — the personal workspace is named by omission', async () => {
  const { client, calls } = recorded()
  await client.request(SITE)
  client.setWorkspace(null)
  await client.request(SITE)
  for (const c of calls) assert.equal(WORKSPACE_HEADER in c.headers, false)
})

// ─── the 409 ──────────────────────────────────────────────────────────────────

test('nothing named ⇒ adopt the workspace the backend names, record it, retry ONCE', async () => {
  const { client, calls } = recorded(wrongWorkspace('acme'))
  const adopted = []
  client.setWorkspace(null, { onAdopted: (h) => adopted.push(h) })
  const res = await client.request(SITE)
  assert.equal(res.status, 200)
  assert.equal(calls.length, 2)
  assert.equal(calls[1].headers[WORKSPACE_HEADER], '@acme')
  assert.deepEqual(adopted, ['@acme'])
  // …and every later request names it, without asking again.
  await client.request(SITE)
  assert.equal(calls[2].headers[WORKSPACE_HEADER], '@acme')
})

test('a stale record is replaced — and a parent workspace is adopted as-is', async () => {
  // The backend may name a PARENT the caller belongs to rather than the site's own unit.
  // No handle comparison here: the answer is what later requests name.
  const { client, calls } = recorded(wrongWorkspace('acme'))
  client.setWorkspace('@acme-labs')
  await client.request(SITE)
  assert.equal(calls[0].headers[WORKSPACE_HEADER], '@acme-labs')
  assert.equal(calls[1].headers[WORKSPACE_HEADER], '@acme')
  assert.equal(client.workspace, '@acme')
})

test('both null ⇒ the personal workspace: the retry names none', async () => {
  const { client, calls } = recorded(wrongWorkspace(null))
  client.setWorkspace('@acme')
  const res = await client.request(SITE)
  assert.equal(res.status, 200)
  assert.equal(calls[1].headers[WORKSPACE_HEADER], undefined)
  assert.equal(client.workspace, null)
})

test('⛔ the user NAMED it ⇒ stop, and say which workspace the backend works from', async () => {
  const { client, calls } = recorded(wrongWorkspace('acme'))
  client.setWorkspace('@client', { explicit: true })
  await assert.rejects(client.request(SITE), (err) => {
    assert.ok(err instanceof WorkspaceMismatchError)
    assert.equal(err.named, '@client')
    assert.equal(err.answer, '@acme')
    assert.match(err.message, /works on this site from @acme, not @client \(--org @client\)/)
    assert.match(err.message, /Pass --org @acme, or drop --org\./)
    return true
  })
  assert.equal(calls.length, 1, 'no retry — adopting would override the user')
  assert.equal(client.workspace, '@client')
})

test('⛔ `--personal` is explicit too', async () => {
  const { client } = recorded(wrongWorkspace('acme'))
  client.setWorkspace(null, { explicit: true })
  await assert.rejects(client.request(SITE), (err) => {
    assert.ok(err instanceof WorkspaceMismatchError)
    assert.equal(err.named, null)
    assert.match(err.message, /from @acme, not your personal workspace \(--personal\)/)
    assert.match(err.message, /or drop --personal\./)
    return true
  })
})

test('never a loop: refused while naming what the backend names ⇒ the 409 as-is', async () => {
  for (const explicit of [false, true]) {
    const { client, calls } = recorded(wrongWorkspace('acme'), wrongWorkspace('acme'))
    client.setWorkspace('@acme', { explicit })
    const res = await client.request(SITE)
    assert.equal(res.status, 409)
    assert.equal(calls.length, 1)
  }
  // And a retry that is refused again is returned, not retried.
  const { client, calls } = recorded(wrongWorkspace('acme'), wrongWorkspace('other'))
  const res = await client.request(SITE)
  assert.equal(res.status, 409)
  assert.equal(calls.length, 2)
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

test('a workspace named only by uuid is not adopted — there is no handle to send', async () => {
  const { client, calls } = recorded(wrongWorkspace(null, 'UNIT-9'))
  const res = await client.request(SITE)
  assert.equal(res.status, 409)
  assert.equal(calls.length, 1)
})

// ─── recording and reporting ──────────────────────────────────────────────────

test('nameSiteWorkspace records an adopted workspace in sync.json, bare, and says so', async () => {
  const dir = tmpSite()
  const { client } = recorded(wrongWorkspace('acme'))
  const notes = []
  nameSiteWorkspace(client, { siteDir: dir, workspace: null, note: (m) => notes.push(m) })
  await client.request(SITE)
  assert.equal(readSiteOrg(dir, ORIGIN), '@acme')
  // "the workspace these requests name" — never "the site's org": it may be a parent.
  assert.equal(notes.length, 1)
  assert.match(notes[0], /Requests for this site now name @acme, the workspace/)
  assert.doesNotMatch(notes[0], /site's org/)
})

test('a mismatch prints as itself, never as "could not reach the backend"', () => {
  const mismatch = new WorkspaceMismatchError({ named: '@client', answer: '@acme' })
  assert.equal(describeRequestError(mismatch, ORIGIN), mismatch.message)
  assert.match(
    describeRequestError(new Error('ECONNREFUSED'), ORIGIN),
    /^Could not reach the backend at http:\/\/backend\.test: ECONNREFUSED$/
  )
})
