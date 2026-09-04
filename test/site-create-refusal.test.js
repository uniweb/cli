/**
 * The site create is the SECOND door that can now refuse for storage.
 *
 * `POST /dev/site` gained a typed `507` when the backend shipped account-level
 * capacity — a site costs against the workspace's allowance before a single byte
 * of content moves (channel backend↔framework). Until then a create could not
 * be refused for space at all, so the failure path fell through to
 * `HTTP 507 Insufficient Storage — {"status":507,…}`: the raw dump that
 * `describeAssetRefusal` already exists to prevent on the asset lane.
 *
 * ⛔ These tests pin the BRANCH KEY as much as the wording. Branching on the status
 * would match any other 507 and carry none of the numbers; branching on `detail`
 * would break the moment the backend rewords its prose.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ensureSiteExists } from '../src/backend/site-sync.js'

function siteDir(yml = 'name: demo\nfoundation: "@acme/base@1.0.0"\n') {
  const dir = mkdtempSync(join(tmpdir(), 'uw-create-'))
  writeFileSync(join(dir, 'site.yml'), yml)
  return dir
}

/** A client whose create returns one canned non-ok response. */
const refusingClient = (status, statusText, body) => ({
  origin: 'http://localhost:8080',
  token: async () => 't',
  createSite: async () => ({
    ok: false,
    status,
    statusText,
    text: async () => body
  })
})

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
    const res = await ensureSiteExists({
      client: refusingClient(507, 'Insufficient Storage', QUOTA),
      siteDir: dir
    })
    assert.equal(res.uuid, null)
    assert.match(res.reason, /storage quota reached/i)
    assert.match(res.reason, /1 GiB of 1 GiB used/)
    assert.match(res.reason, /a new site needs 100 MiB/)
    // Rule carried over from the asset lane: freeing is entity-granular, so never
    // send the user editing content to make room.
    assert.match(res.reason, /deleting a site or entity/)
    // ⛔ The raw dump must be GONE, not merely prefixed.
    assert.ok(
      !/HTTP 507/.test(res.reason) && !/"status"/.test(res.reason),
      `raw dump leaked into the message: ${res.reason}`
    )
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
    const res = await ensureSiteExists({
      client: refusingClient(
        507,
        'Insufficient Storage',
        'upstream is out of disk'
      ),
      siteDir: dir
    })
    assert.match(res.reason, /HTTP 507/)
    assert.doesNotMatch(res.reason, /storage quota reached/i)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('an unrecognised typed reason is named rather than dumped', async () => {
  const dir = siteDir()
  try {
    const res = await ensureSiteExists({
      client: refusingClient(
        403,
        'Forbidden',
        JSON.stringify({
          reason: 'site_limit_reached',
          detail: 'plan allows 3 sites'
        })
      ),
      siteDir: dir
    })
    assert.match(res.reason, /refused the site create \(site_limit_reached\)/)
    assert.match(res.reason, /plan allows 3 sites/)
    // ⛔ Load-bearing, and it caught a false green: the raw dump CONTAINS both
    // strings above, so without this the test passed with the describer disabled.
    // "Named rather than dumped" has to assert the dump is gone.
    assert.ok(
      !/HTTP 403/.test(res.reason) && !/"reason"/.test(res.reason),
      `raw dump leaked into the message: ${res.reason}`
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('404 keeps its own account — an old backend is not a refusal', async () => {
  const dir = siteDir()
  try {
    const res = await ensureSiteExists({
      client: refusingClient(404, 'Not Found', ''),
      siteDir: dir
    })
    assert.match(res.reason, /predates the empty-site create/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a prose (non-JSON) refusal still falls through to the generic line', async () => {
  const dir = siteDir()
  try {
    const res = await ensureSiteExists({
      client: refusingClient(500, 'Server Error', '<html>nginx</html>'),
      siteDir: dir
    })
    assert.match(res.reason, /HTTP 500/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
