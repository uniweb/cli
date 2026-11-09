/**
 * `uniweb doctor` — `blueprint.yml`, how a backend started from the site begins.
 *
 * What a build and a push would refuse is an error. A line a backend started from the site would
 * leave out — a type none of the site's foundations declares — is a warning, as a push says it, and
 * never an error: the backend accepts that line and leaves it out when it starts. A blueprint whose
 * types could not be checked here gets a note, so a clean report does not read as checked.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkBlueprint } from '../src/commands/doctor.js'

const SITE_YML = { name: 'T', foundation: 'fnd', services: { backend: true } }

/** A site on a local foundation named `@acme/fnd` whose own data schema is `vehicle`. */
function project(t, blueprint, { foundationName = '@acme/fnd' } = {}) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'uniweb-doctor-blueprint-')))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const write = (rel, body) => {
    mkdirSync(join(dir, rel, '..'), { recursive: true })
    writeFileSync(join(dir, rel), typeof body === 'string' ? body : JSON.stringify(body))
  }
  write('site/package.json', { name: 'site', dependencies: { fnd: 'file:../fdn' } })
  write('site/site.yml', 'name: T\nfoundation: fnd\nservices:\n  backend: true\n')
  if (blueprint !== null) write('site/blueprint.yml', blueprint)
  write('fdn/package.json', { name: 'fnd', type: 'module', main: './_entry.generated.js' })
  write('fdn/main.js', `export default { name: '${foundationName}' }\n`)
  write('fdn/schemas/vehicle.yml', 'name: vehicle\nfields:\n  title: { type: string }\n')
  return join(dir, 'site')
}

async function issuesFor(sitePath, siteYml = SITE_YML) {
  const issues = []
  await checkBlueprint({ sitePath, siteName: 'site', siteYml, issues })
  return issues
}

test('no blueprint, nothing to say', async (t) => {
  assert.deepEqual(await issuesFor(project(t, null)), [])
})

test('CONTROL — a blueprint naming only declared types is fine', async (t) => {
  assert.deepEqual(await issuesFor(project(t, "access:\n  '@/vehicle': { add: open }\n")), [])
})

test('⛔ what a push would refuse is an error, naming the key', async (t) => {
  const [issue, ...rest] = await issuesFor(project(t, "access:\n  '@/vehicle': { all: { members: view } }\n"))
  assert.equal(rest.length, 0)
  assert.equal(issue.id, 'blueprint-unreadable')
  assert.equal(issue.type, 'error')
  assert.match(issue.message, /`access\.@\/vehicle\.all\.members` is `view`: the level that reads every entry is `read`/)
})

test('⭐ a type none of the foundations declares is a warning, never an error', async (t) => {
  const [issue, ...rest] = await issuesFor(project(t, "access:\n  '@/vehicel': { add: open }\n"))
  assert.equal(rest.length, 0)
  assert.equal(issue.id, 'blueprint-leaves-out')
  assert.equal(issue.type, 'warn')
  assert.match(issue.message, /`access\.@\/vehicel` names a type none of this site's foundations declares/)
})

test('⭐ …and while the foundation has no scope, as a new project has until its first register', async (t) => {
  const [issue, ...rest] = await issuesFor(project(t, "access:\n  '@/vehicel': { add: open }\n", { foundationName: 'fnd' }))
  assert.equal(rest.length, 0)
  assert.equal(issue.id, 'blueprint-leaves-out')
  assert.match(issue.message, /`access\.@\/vehicel` names a type none of this site's foundations declares/)
})

test('CONTROL — with no scope, a declared type is fine', async (t) => {
  assert.deepEqual(await issuesFor(project(t, "access:\n  '@/vehicle': { add: open }\n", { foundationName: 'fnd' })), [])
})

test('a cataloged foundation leaves the types unchecked, and doctor says so', async (t) => {
  const sitePath = project(t, "access:\n  '@acme/vehicle': { add: open }\n")
  const [issue, ...rest] = await issuesFor(sitePath, { ...SITE_YML, foundation: '@acme/fnd@1.0.0' })
  assert.equal(rest.length, 0)
  assert.equal(issue.id, 'blueprint-types-unchecked')
  assert.equal(issue.type, 'info')
  assert.match(issue.message, /its types were not checked against the site's foundations — its foundation, `@acme\/fnd@1\.0\.0`, is not in this project/)
})
