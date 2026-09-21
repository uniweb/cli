/**
 * Several backends on record, none named: the backend verbs refuse and list them.
 *
 * A project can sync with any number of backends. With exactly one, a bare `uniweb
 * push` goes there; with several, something has to say which — `--backend`,
 * `UNIWEB_REGISTER_URL`, or deploy.yml's default target. When nothing does, the
 * ladder used to fall through to the logged-in session, which may be either synced
 * backend or a third one: a push landing wherever someone last logged in. Plan
 * §3.2: refuse, and list them.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmp, runVerb } from './helpers/run-verb.js'

const A = 'http://dev.test'
const B = 'https://uniweb.app'
const REFUSAL = /synced with 2 backends: http:\/\/dev\.test, https:\/\/uniweb\.app/

function project(backends = { [A]: { site: { uuid: 'SITE-A' } }, [B]: { site: { uuid: 'SITE-B' } } }) {
  const dir = join(tmp('uw-amb-'), 'site')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'site.yml'), "name: T\nfoundation: '@a/base'\n")
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 't', dependencies: { uniweb: '*' } }))
  writeFileSync(join(dir, 'sync.json'), JSON.stringify({ version: 1, backends }))
  return dir
}

const verbs = async () => ({
  push: (await import('../src/commands/push.js')).push,
  publish: (await import('../src/commands/publish.js')).publish,
  pull: (await import('../src/commands/pull.js')).pull
})

test('⭐ push, publish and pull refuse — before any request — and name both backends', { timeout: 30_000 }, async () => {
  const dir = project()
  for (const [name, verb] of Object.entries(await verbs())) {
    const res = await runVerb(dir, verb, name === 'pull' ? ['--force'] : [])
    assert.equal(res.exitCode, 2, `${name}: ${res.output}`)
    assert.match(res.output, REFUSAL, name)
    assert.match(res.output, /--backend <url>/, name)
    assert.equal(res.requests, 0, `${name} sent nothing`)
  }
})

test('--backend names one — no refusal, and the push reaches the wire', { timeout: 30_000 }, async () => {
  const { push } = await verbs()
  const res = await runVerb(project(), push, ['--backend', A, '--token', 'test'])
  assert.doesNotMatch(res.output, REFUSAL, res.output)
  assert.ok(res.requests > 0, res.output)
})

test('a deploy.yml default target naming a backend is an answer', { timeout: 30_000 }, async () => {
  const { push } = await verbs()
  const dir = project()
  writeFileSync(join(dir, 'deploy.yml'), `default: production\ntargets:\n  production:\n    host: uniweb\n    backend: ${B}\n`)
  const res = await runVerb(dir, push, ['--token', 'test'])
  assert.doesNotMatch(res.output, REFUSAL, res.output)
  assert.ok(res.requests > 0, res.output)
})

test('UNIWEB_REGISTER_URL is an answer', { timeout: 30_000 }, async () => {
  const { push } = await verbs()
  process.env.UNIWEB_REGISTER_URL = A
  try {
    const res = await runVerb(project(), push, ['--token', 'test'])
    assert.doesNotMatch(res.output, REFUSAL, res.output)
  } finally {
    delete process.env.UNIWEB_REGISTER_URL
  }
})

test('one backend on record is never ambiguous (control)', { timeout: 30_000 }, async () => {
  const { push } = await verbs()
  const res = await runVerb(project({ [A]: { site: { uuid: 'SITE-A' } } }), push, ['--token', 'test'])
  assert.doesNotMatch(res.output, /synced with \d+ backends/, res.output)
  assert.ok(res.requests > 0, res.output)
})
