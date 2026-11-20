/**
 * `uniweb site admin | visit` — the site owner's one-time sign-ins, opened in the browser.
 *
 * The backend's half is its own: `POST /dev/site/manage/{uuid}` and `POST /dev/site/visit/{uuid}`
 * answer `{ url }`, a single-use sign-in; `404` to anyone but the owner; `409` until the site's
 * backend is running (and, for `visit`, while the site has no address). These tests answer those
 * routes as the backend says it does and check what the CLI sends, opens and says — above all,
 * that the address, a credential, is never printed.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runVerb, tmp } from './helpers/run-verb.js'

const ORIGIN = 'http://backend.test'
const ENV = { UNIWEB_SERVER: ORIGIN, UNIWEB_TOKEN: 'TKN' }
const UUID = '01a116cf-1a07-79f0-86e1-855d3a95e987'
const SECRET = 'http://backend.test/admin/api/auth/handoff?token=ONE-TIME-SECRET'

function doorBackend({ sites = [{ uuid: UUID, name: 'blog', updated_at: '2026-11-20T00:00:00Z' }], answer } = {}) {
  const seen = []
  const respond = async (url, init = {}) => {
    const u = new URL(url)
    const method = init.method || 'GET'
    seen.push({ method, path: u.pathname, workspace: init.headers?.['x-uniweb-workspace'] ?? null })
    if (u.pathname === '/dev/orgs') return Response.json({ account_handle: 'jane', orgs: [], workspaces: [] })
    if (u.pathname === '/dev/site' && method === 'GET') return Response.json({ sites })
    if (/^\/dev\/site\/(manage|visit)\//.test(u.pathname) && method === 'POST') {
      return answer ? answer(u.pathname) : Response.json({ url: SECRET })
    }
    return undefined
  }
  return { respond, seen, doors: () => seen.filter((r) => /\/(manage|visit)\//.test(r.path)) }
}

async function run(verb, args, backend, open) {
  const { siteOwnerDoor } = await import('../src/commands/site.js')
  return runVerb(tmp('uw-door-'), (a) => siteOwnerDoor(a, verb, { open }), args, { env: ENV, respond: backend.respond })
}

test('`site admin <uuid>` asks for the manage door, in the workspace named, and opens what it answers', async () => {
  const backend = doorBackend()
  const opened = []
  const r = await run('admin', ['admin', UUID, '--org', '@studio'], backend, async (u) => (opened.push(u), true))
  assert.equal(r.exitCode, 0, r.output)
  assert.deepEqual(backend.doors().map((d) => [d.method, d.path, d.workspace]), [['POST', `/dev/site/manage/${UUID}`, '@studio']])
  assert.deepEqual(opened, [SECRET])
  assert.match(r.output, /Opened the administration of “blog” \(01a116cf[^)]*\)’s backend in your browser/)
  assert.doesNotMatch(r.output, /ONE-TIME-SECRET/, 'the sign-in is never printed')
})

test('`site visit <uuid>` asks for the visit door', async () => {
  const backend = doorBackend()
  const r = await run('visit', ['visit', UUID], backend, async () => true)
  assert.equal(r.exitCode, 0, r.output)
  assert.deepEqual(backend.doors().map((d) => d.path), [`/dev/site/visit/${UUID}`])
  assert.match(r.output, /Opened “blog” \(01a116cf[^)]*\) in your browser, signed in as its owner/)
})

test('with no browser to open, it says so, exits 1, and still prints no address', async () => {
  const backend = doorBackend()
  const r = await run('admin', ['admin', UUID], backend, async () => false)
  assert.equal(r.exitCode, 1)
  assert.match(r.output, /Couldn't open a browser here/)
  assert.match(r.output, new RegExp(`uniweb site admin ${UUID}`))
  assert.doesNotMatch(r.output, /ONE-TIME-SECRET|handoff/)
})

test('a 404 for a site the workspace lists says only the owner can open it — no address, nothing opened', async () => {
  const backend = doorBackend({ answer: () => new Response(null, { status: 404 }) })
  let opened = false
  const r = await run('admin', ['admin', UUID], backend, async () => (opened = true))
  assert.equal(r.exitCode, 1)
  assert.equal(opened, false)
  assert.match(r.output, /only the site's owner can/)
})

test("a 409 gives the backend's own words when it has them, and says to publish when it does not", async () => {
  const said = doorBackend({ answer: () => Response.json({ detail: 'The site backend is starting.' }, { status: 409 }) })
  const r1 = await run('admin', ['admin', UUID], said, async () => true)
  assert.equal(r1.exitCode, 1)
  assert.match(r1.output, /The site backend is starting\./)

  const bare = doorBackend({ answer: () => new Response(null, { status: 409 }) })
  const r2 = await run('visit', ['visit', UUID], bare, async () => true)
  assert.equal(r2.exitCode, 1)
  assert.match(r2.output, /no address\. Publish it first: uniweb publish/)
})

test('an answer that is not an http(s) address is not opened', async () => {
  const backend = doorBackend({ answer: () => Response.json({ url: 'file:///etc/passwd' }) })
  let opened = false
  const r = await run('admin', ['admin', UUID], backend, async () => (opened = true))
  assert.equal(r.exitCode, 1)
  assert.equal(opened, false)
})

test('a name where a uuid goes is refused before any door is asked', async () => {
  const backend = doorBackend()
  const r = await run('admin', ['admin', 'blog'], backend, async () => true)
  assert.equal(r.exitCode, 2)
  assert.equal(backend.doors().length, 0)
  assert.match(r.output, /not a site uuid/)
})
