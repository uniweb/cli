/**
 * site-sync — pushSyncPackages (the two-lane submission core, extracted from the push
 * command) + the response helpers. The push command flow has no DI seam, but
 * pushSyncPackages takes the client + report as parameters, so the lane orchestration
 * (CREATE vs UPDATE, the minted-uuid write-back, the failure exit codes, the
 * send-only-changed cache) is unit-driven here with a mock client + a temp site dir.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { extractFinalized, pushSyncPackages } from '../src/backend/site-sync.js'

const ok = (body) => ({ ok: true, status: 200, statusText: 'OK', json: async () => body, text: async () => JSON.stringify(body) })
const fail = (status, body = 'boom') => ({ ok: false, status, statusText: 'Error', json: async () => ({}), text: async () => body })
const finalized = (entries) => ({ report: { finalized: entries } })

function tmpSite() {
  const dir = mkdtempSync(join(tmpdir(), 'site-sync-'))
  writeFileSync(join(dir, 'site.yml'), "name: Acme\nfoundation: '@a/base'\n")
  return dir
}

function makeReport() {
  const calls = { info: [], note: [], error: [] }
  const report = {
    info: (m) => calls.info.push(m),
    note: (m) => calls.note.push(m),
    error: (m) => calls.error.push(m),
    dim: (s) => s,
  }
  return { report, calls }
}

const siteOnlyPkg = (extra) => ({
  siteContent: { buffer: Buffer.from('site'), entityCount: 1, models: ['@uniweb/site-content'], index: [{ kind: 'site' }] },
  collections: null,
  hashes: {},
  ...extra,
})

test('extractFinalized tolerates the report.finalized / bare-array shapes and drops invalid entries', () => {
  assert.deepEqual(
    extractFinalized({ report: { finalized: [{ index: 0, uuid: 'A', changed: true }] } }),
    [{ index: 0, uuid: 'A', changed: true, document: null }]
  )
  assert.deepEqual(extractFinalized([{ index: 1, uuid: 'B' }]), [{ index: 1, uuid: 'B', changed: undefined, document: null }])
  // entries without a valid index + uuid are dropped; a non-list payload → null
  assert.deepEqual(extractFinalized({ finalized: [{ uuid: 'no-index' }, { index: 2 }] }), [])
  assert.equal(extractFinalized({}), null)
})

test('pushSyncPackages CREATE: mints + records the site $uuid, persists the cache, exit 0', async () => {
  const dir = tmpSite()
  let created = 0
  const client = {
    origin: 'http://x',
    createSiteContent: async () => { created++; return ok(finalized([{ index: 0, uuid: 'NEW-UUID', changed: true }])) },
  }
  const { report } = makeReport()
  const pkg = siteOnlyPkg({ siteContentUuid: undefined, hashes: { '@uniweb/site-content site': 'h1' } })

  const res = await pushSyncPackages({ client, siteDir: dir, pkg, asOrg: null, report })

  assert.equal(created, 1)
  assert.equal(res.exitCode, 0)
  assert.equal(res.boundSiteUuid, 'NEW-UUID')
  assert.match(readFileSync(join(dir, 'site.yml'), 'utf8'), /^\$uuid: NEW-UUID$/m)
  assert.ok(res.wrote.includes('recorded site $uuid in site.yml'))
  // the send-only-changed cache is persisted on success
  const cache = JSON.parse(readFileSync(join(dir, '.uniweb/sync-cache.json'), 'utf8'))
  assert.equal(cache.hashes['@uniweb/site-content site'], 'h1')
  rmSync(dir, { recursive: true, force: true })
})

test('pushSyncPackages UPDATE: a known $uuid updates by uuid (never CREATE)', async () => {
  const dir = tmpSite()
  let updatedWith = null
  let created = 0
  const client = {
    origin: 'http://x',
    createSiteContent: async () => { created++; return ok(finalized([])) },
    updateSiteContent: async (uuid) => { updatedWith = uuid; return ok(finalized([{ index: 0, uuid: 'EXIST', changed: false }])) },
  }
  const { report } = makeReport()
  const res = await pushSyncPackages({ client, siteDir: dir, pkg: siteOnlyPkg({ siteContentUuid: 'EXIST' }), asOrg: null, report })

  assert.equal(created, 0, 'a known uuid must UPDATE, never CREATE')
  assert.equal(updatedWith, 'EXIST')
  assert.equal(res.exitCode, 0)
  assert.equal(res.boundSiteUuid, 'EXIST')
  rmSync(dir, { recursive: true, force: true })
})

test('pushSyncPackages: a rejected lane returns exit 1, reports the error, and does NOT persist the cache', async () => {
  const dir = tmpSite()
  const client = { origin: 'http://x', createSiteContent: async () => fail(500, 'server boom') }
  const { report, calls } = makeReport()
  const res = await pushSyncPackages({ client, siteDir: dir, pkg: siteOnlyPkg({ siteContentUuid: undefined, hashes: { x: 'y' } }), asOrg: null, report })

  assert.equal(res.exitCode, 1)
  assert.ok(calls.error.some((m) => /rejected: HTTP 500/.test(m)))
  assert.equal(existsSync(join(dir, '.uniweb/sync-cache.json')), false, 'a failed push must not persist the cache')
  rmSync(dir, { recursive: true, force: true })
})

test('pushSyncPackages: a 409 explains the facet-genesis fix (delete + redeploy) instead of a bare error', async () => {
  const dir = tmpSite()
  const client = { origin: 'http://x', createSiteContent: async () => fail(409, 'folder facet already established') }
  const { report, calls } = makeReport()
  const res = await pushSyncPackages({ client, siteDir: dir, pkg: siteOnlyPkg({ siteContentUuid: undefined, hashes: { x: 'y' } }), asOrg: null, report })

  assert.equal(res.exitCode, 1)
  assert.ok(calls.error.some((m) => /rejected: HTTP 409/.test(m)))
  // the friendlier guidance — the v1 folder is genesis-owned; delete + redeploy (or clear $uuid)
  assert.ok(
    calls.note.some((m) => /delete the deployed site and redeploy/.test(m) && /clear `\$uuid`/.test(m)),
    'explains the delete+redeploy / clear-$uuid fix'
  )
  rmSync(dir, { recursive: true, force: true })
})

test('pushSyncPackages: the folder lane is keyed by the bound site uuid', async () => {
  const dir = tmpSite()
  let folderKey = null
  const client = {
    origin: 'http://x',
    updateSiteContent: async () => ok(finalized([{ index: 0, uuid: 'SITE', changed: true }])),
    pushFolder: async (uuid) => { folderKey = uuid; return ok(finalized([{ index: 0, uuid: 'FOLDER', changed: true }])) },
  }
  const { report } = makeReport()
  const pkg = siteOnlyPkg({
    siteContentUuid: 'SITE',
    collections: { buffer: Buffer.from('c'), entityCount: 1, models: ['@uniweb/folder'], index: [{ kind: 'folder' }] },
  })

  const res = await pushSyncPackages({ client, siteDir: dir, pkg, asOrg: null, report })

  assert.equal(res.exitCode, 0)
  assert.equal(folderKey, 'SITE', 'the folder push is keyed by the site-content uuid')
  rmSync(dir, { recursive: true, force: true })
})
