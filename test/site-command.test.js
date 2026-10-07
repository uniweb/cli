/**
 * `uniweb site list | unpublish | delete` — a workspace's sites, on the backend you are
 * logged in to.
 *
 * The backend's half is its own: `GET /dev/site` lists the workspace's sites, page by
 * page; `DELETE /dev/site/{uuid}` deletes one, refusing `409` with `blockers` while
 * anything is still active (`published` among them); `POST /dev/site/unpublish/{uuid}`
 * takes one offline. These tests answer those routes as the backend says it does and
 * check what the CLI sends and says.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { runVerb, tmp } from './helpers/run-verb.js'

const ORIGIN = 'http://backend.test'
const ENV = { UNIWEB_REGISTER_URL: ORIGIN, UNIWEB_TOKEN: 'TKN' }
const UUID = '01a116cf-1a07-79f0-86e1-855d3a95e987'
const OTHER = '01a116e8-8dd0-7990-8a15-6912794b0a7b'

/**
 * Answers the site routes, and `/dev/orgs` (the workspace a command with none chosen asks
 * about), and records every request: method, path, query and the workspace it named.
 */
function sitesBackend({ sites = [], onDelete, onUnpublish } = {}) {
  const seen = []
  const respond = async (url, init = {}) => {
    const u = new URL(url)
    const method = init.method || 'GET'
    seen.push({ method, path: u.pathname, query: u.search, workspace: init.headers?.['x-uniweb-workspace'] ?? null })
    if (u.pathname === '/dev/orgs') return Response.json({ account_handle: 'jane', orgs: [] })
    if (u.pathname === '/dev/site' && method === 'GET') {
      const limit = Number(u.searchParams.get('limit'))
      const offset = Number(u.searchParams.get('offset'))
      return Response.json({ sites: sites.slice(offset, offset + limit) })
    }
    if (u.pathname.startsWith('/dev/site/unpublish/') && method === 'POST') {
      return onUnpublish ? onUnpublish(u.pathname) : Response.json({ was_published: true })
    }
    if (u.pathname.startsWith('/dev/site/') && method === 'DELETE') {
      return onDelete ? onDelete(u.pathname) : new Response(null, { status: 204 })
    }
    return undefined
  }
  return { respond, seen, deletes: () => seen.filter((r) => r.method === 'DELETE') }
}

const site = (uuid, name, status) => ({
  uuid,
  name,
  updated_at: '2026-10-07T15:00:00Z',
  ...(status ? { deployment: { status, published_url: `https://${name}.example.test/` } } : {})
})

test('`site list --json` reads every page, in the workspace named, and keeps stdout to the JSON', async () => {
  const { site: verb } = await import('../src/commands/site.js')
  const many = Array.from({ length: 1001 }, (_, i) => site(`00000000-0000-0000-0000-${String(i).padStart(12, '0')}`, `s${i}`))
  const backend = sitesBackend({ sites: many })
  const run = await runVerb(tmp('uw-site-'), verb, ['list', '--json', '--org', '@acme'], { env: ENV, respond: backend.respond })
  assert.equal(run.exitCode, 0)
  const listed = backend.seen.filter((r) => r.path === '/dev/site')
  assert.deepEqual(listed.map((r) => r.query), ['?limit=1000&offset=0', '?limit=1000&offset=1000'], 'it reads until a short page')
  assert.ok(listed.every((r) => r.workspace === '@acme'), 'every page names the workspace')
  const json = JSON.parse(run.output.trim())
  assert.equal(json.sites.length, 1001)
  assert.equal(json.workspace, '@acme')
  assert.deepEqual(Object.keys(json.sites[0]).sort(), ['name', 'published', 'status', 'updated_at', 'url', 'uuid'])
})

test('`site delete <uuid> --yes` deletes it, in the workspace named', async () => {
  const { site: verb } = await import('../src/commands/site.js')
  const backend = sitesBackend({ sites: [site(UUID, 'blog')] })
  const run = await runVerb(tmp('uw-site-'), verb, ['delete', UUID, '--yes', '--org', '@acme'], { env: ENV, respond: backend.respond })
  assert.equal(run.exitCode, 0, run.output)
  assert.deepEqual(backend.deletes().map((r) => [r.path, r.workspace]), [[`/dev/site/${UUID}`, '@acme']])
  assert.match(run.output, /Deleted “blog”/)
})

test('without --yes and with nobody to ask, delete refuses — exit 2, nothing deleted', async () => {
  const { site: verb } = await import('../src/commands/site.js')
  const backend = sitesBackend({ sites: [site(UUID, 'blog')] })
  const run = await runVerb(tmp('uw-site-'), verb, ['delete', UUID], { env: ENV, respond: backend.respond })
  assert.equal(run.exitCode, 2)
  assert.equal(backend.deletes().length, 0)
  assert.match(run.output, /pass --yes/)
})

test('a published site is not deleted: the CLI says to unpublish it first, before asking anything', async () => {
  const { site: verb } = await import('../src/commands/site.js')
  const backend = sitesBackend({ sites: [site(UUID, 'blog', 'published')] })
  const run = await runVerb(tmp('uw-site-'), verb, ['delete', UUID, '--yes'], { env: ENV, respond: backend.respond })
  assert.equal(run.exitCode, 1)
  assert.equal(backend.deletes().length, 0)
  assert.match(run.output, new RegExp(`uniweb site unpublish ${UUID}`))
})

test("a refused delete shows each blocker in the backend's words — one it does not know too", async () => {
  const { site: verb } = await import('../src/commands/site.js')
  const backend = sitesBackend({
    sites: [site(UUID, 'blog')],
    onDelete: () =>
      Response.json(
        {
          title: 'Resource Active',
          blockers: [
            { resource: 'billing', detail: 'A hosting plan is active.', resolve_hint: '/app/…' },
            { resource: 'some-new-thing', detail: 'Something new is still on.' }
          ]
        },
        { status: 409 }
      )
  })
  const run = await runVerb(tmp('uw-site-'), verb, ['delete', UUID, '--yes'], { env: ENV, respond: backend.respond })
  assert.equal(run.exitCode, 1)
  assert.match(run.output, /A hosting plan is active\./)
  assert.match(run.output, /Something new is still on\./)
  assert.doesNotMatch(run.output, /\/app\//, 'the hint names app routes and is not shown')
})

test('a name where a uuid goes is refused, and nothing is deleted', async () => {
  const { site: verb } = await import('../src/commands/site.js')
  const backend = sitesBackend({ sites: [site(UUID, 'blog')] })
  const run = await runVerb(tmp('uw-site-'), verb, ['delete', 'blog', '--yes'], { env: ENV, respond: backend.respond })
  assert.equal(run.exitCode, 2)
  assert.equal(backend.deletes().length, 0)
  assert.match(run.output, /not a site uuid/)
})

test('`site unpublish <uuid> --yes` takes it offline', async () => {
  const { site: verb } = await import('../src/commands/site.js')
  const backend = sitesBackend({ sites: [site(UUID, 'blog', 'published')] })
  const run = await runVerb(tmp('uw-site-'), verb, ['unpublish', UUID, '--yes'], { env: ENV, respond: backend.respond })
  assert.equal(run.exitCode, 0, run.output)
  assert.deepEqual(
    backend.seen.filter((r) => r.method === 'POST').map((r) => r.path),
    [`/dev/site/unpublish/${UUID}`]
  )
  assert.match(run.output, /Unpublished “blog”/)
})

test("inside a project, delete acts on the project's site and drops the project's record of it", async () => {
  const { site: verb } = await import('../src/commands/site.js')
  const dir = tmp('uw-site-project-')
  writeFileSync(join(dir, 'site.yml'), "name: T\nfoundation: '@a/base'\n")
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 't', dependencies: { uniweb: '*' } }))
  writeFileSync(
    join(dir, 'sync.json'),
    JSON.stringify({
      version: 1,
      backends: {
        [ORIGIN]: { site: { uuid: UUID } },
        'http://elsewhere.test': { site: { uuid: OTHER } }
      }
    })
  )
  mkdirSync(join(dir, '.uniweb'), { recursive: true })
  const backend = sitesBackend({ sites: [site(UUID, 'blog')] })
  const run = await runVerb(dir, verb, ['delete', '--yes'], { env: ENV, respond: backend.respond })
  assert.equal(run.exitCode, 0, run.output)
  assert.deepEqual(backend.deletes().map((r) => r.path), [`/dev/site/${UUID}`])
  const backends = JSON.parse(readFileSync(join(dir, 'sync.json'), 'utf8')).backends
  assert.equal(backends[ORIGIN], undefined, "the deleted site's backend is gone from sync.json")
  assert.ok(backends['http://elsewhere.test'], 'another backend is untouched')
  assert.match(run.output, /next push creates a new one/)
})

test('with no uuid outside a project, delete says to name one — and sends no delete', async () => {
  const { site: verb } = await import('../src/commands/site.js')
  const backend = sitesBackend()
  const run = await runVerb(tmp('uw-site-'), verb, ['delete', '--yes'], { env: ENV, respond: backend.respond })
  assert.equal(run.exitCode, 2)
  assert.equal(backend.deletes().length, 0)
  assert.match(run.output, /uniweb site delete <site-uuid>/)
})
