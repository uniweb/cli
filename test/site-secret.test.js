/**
 * `uniweb site secret <service> <name> [<site-uuid>]` — set a secret one of the site's services
 * uses; `--clear` removes it.
 *
 * The backend's half is its own: `PUT /dev/site/secrets/{uuid}` takes
 * `{ service?, name, consumer?, value }` and answers `{ service, name, consumer, set: true, mask }`,
 * never the value; `DELETE` takes `{ service?, name }` and answers `{ …, set: false }`. Only an
 * admin of the site may (`403` for an editor), and a refused body is `400 invalid_field` naming
 * its key. These tests answer those routes as the backend says it does, and check what the CLI
 * sends, what it says, and that the value goes nowhere but the request.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { runVerb, tmp } from './helpers/run-verb.js'

const ORIGIN = 'http://backend.test'
const ENV = { UNIWEB_SERVER: ORIGIN, UNIWEB_TOKEN: 'TKN' }
const UUID = '01a169f2-1e71-7bd3-942e-47d5675f2bd2'
const VALUE = 'tok-0123456789abcdef'

/** Answers the routes a secret command meets, recording every request and its body. */
function secretsBackend({ onPut, onDelete } = {}) {
  const seen = []
  const respond = async (url, init = {}) => {
    const u = new URL(url)
    const method = init.method || 'GET'
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : null
    seen.push({ method, path: u.pathname, body, workspace: init.headers?.['x-uniweb-workspace'] ?? null })
    if (u.pathname === '/dev/orgs') return Response.json({ account_handle: 'jane', orgs: [], workspaces: [] })
    if (u.pathname === '/dev/site' && method === 'GET') {
      return Response.json({ sites: [{ uuid: UUID, name: 'uniweb.io', updated_at: '2026-11-03T00:00:00Z' }] })
    }
    if (u.pathname === `/dev/site/secrets/${UUID}` && method === 'PUT') {
      if (onPut) return onPut(body)
      return Response.json({ service: body.service, name: body.name, consumer: body.consumer ?? 'self', set: true, mask: '••••cdef' })
    }
    if (u.pathname === `/dev/site/secrets/${UUID}` && method === 'DELETE') {
      if (onDelete) return onDelete(body)
      return Response.json({ service: body.service, name: body.name, consumer: 'hosting', set: false })
    }
    return undefined
  }
  return { respond, seen, writes: () => seen.filter((r) => r.path.startsWith('/dev/site/secrets/')) }
}

/** The verb with the value typed at its prompt — the one thing a test cannot do at a terminal. */
async function typed(value) {
  const { siteSecret } = await import('../src/commands/site.js')
  const asked = []
  const verb = (args) =>
    siteSecret(args, {
      readValue: async (_args, label) => {
        asked.push(label)
        return { value }
      },
    })
  return { verb, asked }
}

test('an ad platform’s token is sent for the host, in the workspace named; the reply’s mask is shown, never the value', async () => {
  const { verb, asked } = await typed(VALUE)
  const backend = secretsBackend()
  const run = await runVerb(tmp('uw-secret-'), verb, ['secret', 'x', 'token', UUID, '--org', '@acme'], { env: ENV, respond: backend.respond })
  assert.equal(run.exitCode, 0, run.output)
  assert.deepEqual(backend.writes().map((r) => [r.method, r.path, r.workspace]), [['PUT', `/dev/site/secrets/${UUID}`, '@acme']])
  assert.deepEqual(backend.writes()[0].body, { service: 'x', name: 'token', consumer: 'hosting', value: VALUE })
  assert.equal(asked.length, 1, 'it asked once')
  assert.match(run.output, /Set x's token on “uniweb\.io”/)
  assert.match(run.output, /••••cdef/)
  assert.match(run.output, /next publish: uniweb publish/)
  assert.ok(!run.output.includes(VALUE), 'the value is never printed')
})

test('a secret of a service that is not an ad platform names no reader, so the backend keeps the one it has', async () => {
  const { verb } = await typed(VALUE)
  const backend = secretsBackend()
  const run = await runVerb(tmp('uw-secret-'), verb, ['secret', 'submit', 'webhook', UUID], { env: ENV, respond: backend.respond })
  assert.equal(run.exitCode, 0, run.output)
  assert.deepEqual(backend.writes()[0].body, { service: 'submit', name: 'webhook', value: VALUE })
})

test('with no terminal to ask in, it refuses — exit 2, nothing sent — and says a person runs it', async () => {
  const { site: verb } = await import('../src/commands/site.js')
  const backend = secretsBackend()
  // `runVerb` sets CI=1, so the command's own prompt has nobody to ask.
  const run = await runVerb(tmp('uw-secret-'), verb, ['secret', 'x', 'token', UUID], { env: ENV, respond: backend.respond })
  assert.equal(run.exitCode, 2, run.output)
  assert.equal(backend.writes().length, 0)
  assert.match(run.output, /no terminal here to ask in/)
  assert.match(run.output, /uniweb site secret x token/)
})

test('a value typed as an argument is refused, never echoed, and nothing is sent', async () => {
  const { verb, asked } = await typed('unused')
  const backend = secretsBackend()
  for (const args of [
    ['secret', 'x', 'token', VALUE],
    ['secret', 'x', 'token', UUID, VALUE],
  ]) {
    const run = await runVerb(tmp('uw-secret-'), verb, args, { env: ENV, respond: backend.respond })
    assert.equal(run.exitCode, 2, run.output)
    assert.ok(!run.output.includes(VALUE), `the argument is not echoed: ${args.join(' ')}`)
    assert.match(run.output, /never given on the command line/)
    assert.match(run.output, /shell history/)
  }
  assert.equal(asked.length, 0)
  assert.equal(backend.seen.length, 0, 'it stops before any request')
})

test('nothing typed changes nothing', async () => {
  const { verb } = await typed('')
  const backend = secretsBackend()
  const run = await runVerb(tmp('uw-secret-'), verb, ['secret', 'x', 'token', UUID], { env: ENV, respond: backend.respond })
  assert.equal(run.exitCode, 0, run.output)
  assert.equal(backend.writes().length, 0)
  assert.match(run.output, /nothing changed/)
})

test('`--clear --yes` removes it by service and name; without --yes and a terminal it refuses', async () => {
  const { site: verb } = await import('../src/commands/site.js')
  const backend = secretsBackend()
  const run = await runVerb(tmp('uw-secret-'), verb, ['secret', 'x', 'token', UUID, '--clear', '--yes'], { env: ENV, respond: backend.respond })
  assert.equal(run.exitCode, 0, run.output)
  assert.deepEqual(backend.writes().map((r) => [r.method, r.body]), [['DELETE', { service: 'x', name: 'token' }]])
  assert.match(run.output, /Cleared x's token/)

  const asked = secretsBackend()
  const refused = await runVerb(tmp('uw-secret-'), verb, ['secret', 'x', 'token', UUID, '--clear'], { env: ENV, respond: asked.respond })
  assert.equal(refused.exitCode, 2)
  assert.equal(asked.writes().length, 0)
  assert.match(refused.output, /pass --yes/)
})

test('a refusal is said in words: the field the backend names, an editor, and a site the backend lists but has no secrets door for', async () => {
  const { verb } = await typed(VALUE)
  const cases = [
    [() => Response.json({ reason: 'one_of', field: 'consumer' }, { status: 400 }), /the consumer is not one the backend takes/],
    [() => Response.json({ title: 'Forbidden' }, { status: 403 }), /You may not set a secret on this site/],
    [() => new Response(null, { status: 404 }), /lists this site but answered 404/],
  ]
  for (const [onPut, said] of cases) {
    const backend = secretsBackend({ onPut })
    const run = await runVerb(tmp('uw-secret-'), verb, ['secret', 'x', 'token', UUID], { env: ENV, respond: backend.respond })
    assert.equal(run.exitCode, 1, run.output)
    assert.match(run.output, said)
    assert.ok(!run.output.includes(VALUE))
  }
})

test("inside a project, it acts on the project's site", async () => {
  const { verb } = await typed(VALUE)
  const dir = tmp('uw-secret-project-')
  writeFileSync(join(dir, 'site.yml'), "name: T\nfoundation: '@a/base'\n")
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 't', dependencies: { uniweb: '*' } }))
  writeFileSync(join(dir, 'sync.json'), JSON.stringify({ version: 1, backends: { [ORIGIN]: { site: { uuid: UUID } } } }))
  mkdirSync(join(dir, '.uniweb'), { recursive: true })
  const backend = secretsBackend()
  const run = await runVerb(dir, verb, ['secret', 'x', 'token'], { env: ENV, respond: backend.respond })
  assert.equal(run.exitCode, 0, run.output)
  assert.deepEqual(backend.writes().map((r) => r.path), [`/dev/site/secrets/${UUID}`])
})

test('a missing service or name is said, and nothing is sent', async () => {
  const { site: verb } = await import('../src/commands/site.js')
  const backend = secretsBackend()
  const run = await runVerb(tmp('uw-secret-'), verb, ['secret', 'x'], { env: ENV, respond: backend.respond })
  assert.equal(run.exitCode, 2)
  assert.equal(backend.seen.length, 0)
  assert.match(run.output, /uniweb site secret x token/)
})
