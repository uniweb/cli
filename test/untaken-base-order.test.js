/**
 * A push or publish the `untakenBase` gate refuses has released nothing.
 *
 * The gate refuses a push from a copy that has not taken the site from the backend
 * (`backend/site-sync.js`). It reads only local files, so it runs before anything reaches
 * the backend — the foundation release included. ⛔ Until 2026-10-17 push and publish
 * brought a local foundation along first, so a refused push could register a version for
 * content it then did not send.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmp, runVerb } from './helpers/run-verb.js'

const A = 'http://dev.test'
// Logged in to A, working in the personal workspace — so a verb past the gate goes on to
// release the foundation, the first thing that reaches the backend.
const LOGGED_IN_A = {
  session: { version: 2, current: A, sessions: { [A]: { token: 't' } } },
  env: { UNIWEB_WORKSPACE: 'personal' }
}
const GATE = /Not pushed — this copy holds no record of the backend content it last took/

// `site/`, bound to SITE-1 on A, beside the local foundation it names — `src/`, which a
// push or publish releases before sending content. `took`: the copy holds the versions
// of the backend content it last took.
function project({ took = false } = {}) {
  const ws = tmp('uw-gate-')
  const site = join(ws, 'site')
  mkdirSync(site, { recursive: true })
  mkdirSync(join(ws, 'src'), { recursive: true })
  writeFileSync(
    join(ws, 'src', 'package.json'),
    JSON.stringify({ name: '@acme/base', version: '1.0.0', main: './_entry.generated.js' })
  )
  writeFileSync(join(site, 'site.yml'), 'name: T\nfoundation: src\n')
  writeFileSync(join(site, 'package.json'), JSON.stringify({ name: 't', dependencies: { uniweb: '*' } }))
  writeFileSync(join(site, 'sync.json'), JSON.stringify({ version: 1, backends: { [A]: { site: { uuid: 'SITE-1' } } } }))
  if (took) {
    mkdirSync(join(site, '.uniweb'), { recursive: true })
    writeFileSync(
      join(site, '.uniweb', 'backend-cache.json'),
      JSON.stringify({ version: 1, backends: { [A]: { baseVersions: { 'SITE-1': 'V1' } } } })
    )
  }
  return site
}

test('⛔ a push the gate refuses reaches the backend for nothing — the foundation is not released', { timeout: 30_000 }, async () => {
  const { push } = await import('../src/commands/push.js')
  const res = await runVerb(project(), push, [], LOGGED_IN_A)
  assert.equal(res.exitCode, 1, res.output)
  assert.match(res.output, GATE)
  assert.equal(res.requests, 0, `refused after reaching the backend:\n${res.urls.join('\n')}`)
})

test('⛔ a publish the gate refuses reaches the backend for nothing — the foundation is not released', { timeout: 30_000 }, async () => {
  const { publish } = await import('../src/commands/publish.js')
  const res = await runVerb(project(), publish, [], LOGGED_IN_A)
  assert.equal(res.exitCode, 1, res.output)
  assert.match(res.output, GATE)
  assert.equal(res.requests, 0, `refused after reaching the backend:\n${res.urls.join('\n')}`)
})

test('CONTROL — a copy that took the site passes the gate, and the push and the publish go on to the backend', { timeout: 30_000 }, async () => {
  const { push } = await import('../src/commands/push.js')
  const { publish } = await import('../src/commands/publish.js')
  for (const verb of [push, publish]) {
    const res = await runVerb(project({ took: true }), verb, [], LOGGED_IN_A)
    assert.doesNotMatch(res.output, GATE)
    assert.ok(res.requests > 0, `nothing reached the backend, so the gate was never what stopped it:\n${res.output}`)
  }
})
