/**
 * A site create the backend refuses, said as what happened.
 *
 * A site's first push creates it from its content (`createSiteFromItsContent`, `POST /dev/site/content`),
 * and the backend can refuse that create: for space (a typed `507`, account capacity — a site costs
 * against the workspace's allowance before any content moves), for its foundation, or for a reason it
 * types and we do not explain, such as a plan's limit. Each is said, with the numbers or the next step,
 * and never as the raw problem document.
 *
 * ⛔ These tests pin the BRANCH KEY as much as the wording. Branching on the status would match any
 * other 507 and carry none of the numbers; branching on `detail` would break the moment the backend
 * rewords its prose.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSiteFromItsContent } from '../src/backend/site-sync.js'
import { readSiteIdentity } from '../src/utils/site-identity.js'

const ORIGIN = 'http://localhost:8080'

function siteDir(yml = 'name: demo\nfoundation: "@acme/base@1.0.0"\n') {
  const dir = mkdtempSync(join(tmpdir(), 'uw-create-'))
  writeFileSync(join(dir, 'site.yml'), yml)
  return dir
}

/** A client whose create returns one canned non-ok response. */
const refusingClient = (status, statusText, body) => ({
  origin: ORIGIN,
  token: async () => 't',
  createSiteContent: async () => ({
    ok: false,
    status,
    statusText,
    text: async () => body
  })
})

/** The site's content as a push would send it — the create takes the site-content lane alone. */
const sitePkg = () => ({
  siteContent: { buffer: Buffer.from('site'), entityCount: 1, models: ['@uniweb/site-content'], index: [{ kind: 'site' }] },
  records: null,
  hashes: {},
  siteContentUuid: undefined
})

/** Create the site in `dir` against `client`; what the person was told, as one string. */
async function create(dir, client) {
  const said = []
  const report = { info: (m) => said.push(m), note: (m) => said.push(m), error: (m) => said.push(m), dim: (s) => s }
  const res = await createSiteFromItsContent({ client, siteDir: dir, emit: async () => sitePkg(), report })
  return { res, said: said.join('\n') }
}

const QUOTA = JSON.stringify({
  status: 507,
  title: 'Insufficient Storage',
  detail: "this site would exceed the workspace's storage allowance",
  reason: 'storage_quota_exceeded',
  used_bytes: 1073741824,
  limit_bytes: 1073741824,
  needed_bytes: 104857600
})

test('a typed storage refusal on the create becomes a sentence with the numbers', async () => {
  const dir = siteDir()
  try {
    const { res, said } = await create(dir, refusingClient(507, 'Insufficient Storage', QUOTA))
    assert.equal(res.uuid, null)
    assert.match(said, /storage quota reached/i)
    assert.match(said, /1 GiB of 1 GiB used/)
    assert.match(said, /a new site needs 100 MiB/)
    // Rule carried over from the asset lane: freeing is entity-granular, so never
    // send the user editing content to make room.
    assert.match(said, /deleting a site or entity/)
    // ⛔ The raw dump must be GONE, not merely followed by a sentence.
    assert.ok(!/HTTP 507/.test(said) && !/"status"/.test(said), `raw dump leaked into the message: ${said}`)
    // And the backend refused, so nothing was created: said, and nothing recorded here.
    assert.match(said, /no site was created/)
    assert.equal(readSiteIdentity(dir, ORIGIN).uuid, null)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the branch key is `reason`, not the status — a bare 507 still falls through', async () => {
  // CONTROL for the test above: same status, no typed reason. If this ever starts
  // reading as a storage refusal, the implementation has begun matching on 507 and
  // will mislabel every unrelated one.
  const dir = siteDir()
  try {
    const { said } = await create(dir, refusingClient(507, 'Insufficient Storage', 'upstream is out of disk'))
    assert.match(said, /HTTP 507/)
    assert.doesNotMatch(said, /storage quota reached/i)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('an unrecognised typed reason is named rather than dumped, and is not called a login problem', async () => {
  const dir = siteDir()
  try {
    const { said } = await create(
      dir,
      refusingClient(403, 'Forbidden', JSON.stringify({ reason: 'site_limit_reached', detail: 'plan allows 3 sites' }))
    )
    assert.match(said, /refused the site create \(site_limit_reached\): plan allows 3 sites/)
    // ⛔ Load-bearing: the raw dump CONTAINS both strings above, so without this the test
    // passes with the sentence disabled. "Named rather than dumped" has to assert the dump is gone.
    assert.ok(!/"reason"/.test(said), `raw dump leaked into the message: ${said}`)
    // A 403 that types its cause is that cause, not the credentials.
    assert.doesNotMatch(said, /Credentials weren't accepted/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('content the backend will not take is named with its own words, and nothing was created', async () => {
  // Measured on a local uniwebd, 2026-11-09: a query of a type no foundation of the site declares.
  const dir = siteDir()
  try {
    const { res, said } = await create(
      dir,
      refusingClient(
        400,
        'Bad Request',
        JSON.stringify({
          status: 400,
          title: 'Validation',
          detail: "query `ghosts` names `@alice/probe`, which this site's foundations do not declare",
          reason: 'invalid_field',
          field: 'queries.ghosts.schema',
          rule: 'undeclared_type'
        })
      )
    )
    assert.equal(res.refused, true)
    assert.match(said, /refused the site create \(invalid_field\): query `ghosts` names `@alice\/probe`/)
    assert.match(said, /no site was created/)
    assert.ok(!/"rule"/.test(said), `raw dump leaked into the message: ${said}`)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a refusal with no typed reason keeps the credentials line where it belongs', async () => {
  // Measured on a local uniwebd, 2026-11-09: a missing or bad token answers this, untyped.
  const dir = siteDir()
  try {
    const { said } = await create(dir, refusingClient(401, 'Unauthorized', JSON.stringify({ status: 401, title: 'Unauthorized' })))
    assert.match(said, /HTTP 401/)
    assert.match(said, /Credentials weren't accepted/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a prose (non-JSON) refusal still falls through to the generic line', async () => {
  const dir = siteDir()
  try {
    const { said } = await create(dir, refusingClient(500, 'Server Error', '<html>nginx</html>'))
    assert.match(said, /HTTP 500/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// ⭐ The create names the site's foundation, and a site takes a new foundation only from a
// scope its author owns — so a create can be refused for it. Said, with the next step,
// rather than as the reason's bare name.
test('a foundation that is not yours to attach: the templates that carry it, then clone', async () => {
  const dir = siteDir()
  try {
    const { res, said } = await create(
      dir,
      refusingClient(
        403,
        'Forbidden',
        JSON.stringify({
          status: 403,
          reason: 'foundation_not_licensed',
          package: '@acme/base',
          templates: [{ uuid: 't-1', name: 'Acme Starter' }, { uuid: 't-2', name: 'Acme Blog' }]
        })
      )
    )
    assert.equal(res.uuid, null)
    assert.match(said, /@acme\/base is not yours to attach/)
    assert.match(said, /one of “Acme Starter”, “Acme Blog” in the app/)
    assert.match(said, /uniweb clone/)
    assert.ok(!/foundation_not_licensed/.test(said), `the reason's name leaked: ${said}`)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a foundation that is not yours, with no template carrying it: register one you own', async () => {
  const dir = siteDir()
  try {
    const { said } = await create(
      dir,
      refusingClient(403, 'Forbidden', JSON.stringify({ status: 403, reason: 'foundation_not_licensed', package: '@acme/base', templates: [] }))
    )
    assert.match(said, /@acme\/base is not yours to attach/)
    assert.match(said, /Register a foundation under a scope you own/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a foundation version this backend has not registered is named', async () => {
  const dir = siteDir()
  try {
    const { said } = await create(
      dir,
      refusingClient(400, 'Bad Request', JSON.stringify({ status: 400, reason: 'foundation_not_registered', foundation: '@acme/base@1.0.0' }))
    )
    assert.match(said, /@acme\/base@1\.0\.0 is not registered on this backend/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
