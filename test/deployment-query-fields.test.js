/**
 * The keys a deployment's `queries` Section takes — read from the deployment, banked by
 * the push, replayed by `status`.
 *
 * A push sends `typed_by_data_key` on a query typed by its data key only where the
 * deployment declares the key (`GET /dev/config` → `siteContent.queryFields`); one that
 * does not refuses a push carrying it. The list is hash-affecting — it changes the
 * `queries` Section — so the push banks it with its hashes, and an offline re-emit
 * replays it: without it, `status` reports the site as changed after every push.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { emitSyncPackages } from '@uniweb/build/uwx'
import {
  deploymentQueryFields,
  writeSyncCache,
  probeUnpushed
} from '../src/backend/site-sync.js'

const ORIGIN = 'http://backend.test'
const FIELDS = ['name', 'schema', 'sort', 'typed_by_data_key']

const clientAnswering = (doc) => {
  const client = { origin: ORIGIN, asked: 0 }
  client.discover = async () => {
    client.asked++
    return doc
  }
  return client
}

// A site on a local foundation `@acme/fnd` whose section type reads the data key `team`
// as `@/member`, and a query `team` naming no schema — the international template's shape.
function makeSite() {
  const root = mkdtempSync(join(tmpdir(), 'query-fields-'))
  const w = (rel, body) => {
    const p = join(root, rel)
    mkdirSync(join(p, '..'), { recursive: true })
    writeFileSync(p, typeof body === 'string' ? body : JSON.stringify(body))
  }
  w('site/site.yml', 'name: T\nfoundation: fnd\n')
  w('site/package.json', { name: 'site', dependencies: { fnd: 'file:../fdn' } })
  w('site/queries.yml', 'team: {}\n')
  w('site/pages/home/page.yml', 'title: Home\n')
  w('site/records/team/wei.yml', 'name: Wei\n')
  w('fdn/package.json', { name: 'fnd', type: 'module', main: './_entry.generated.js' })
  w('fdn/main.js', "export default { name: '@acme/fnd' }\n")
  w('fdn/dist/meta/schema.json', {
    _self: { name: '@acme/fnd', version: '1.0.0', role: 'foundation' },
    dataSchemas: { '@/member': { name: 'member', fields: { name: { type: 'string' } } } },
    Team: { data: { team: '@/member' } }
  })
  return { root, site: join(root, 'site') }
}

test('deploymentQueryFields reads the deployment’s answer', async () => {
  const { root, site } = makeSite()
  try {
    const client = clientAnswering({ siteContent: { queryFields: FIELDS } })
    assert.deepEqual(await deploymentQueryFields({ client, siteDir: site }), FIELDS)
    // Not an array — an older deployment, or no answer: nothing optional is sent.
    for (const doc of [{}, { siteContent: {} }, { siteContent: { queryFields: 'typed_by_data_key' } }]) {
      assert.equal(await deploymentQueryFields({ client: clientAnswering(doc), siteDir: site }), null)
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('deploymentQueryFields, offline, is what the last push banked — and asks nothing', async () => {
  const { root, site } = makeSite()
  try {
    const client = clientAnswering({ siteContent: { queryFields: ['name'] } })
    assert.equal(await deploymentQueryFields({ client, siteDir: site, offline: true }), null)
    writeSyncCache(site, ORIGIN, {}, { queryFields: FIELDS })
    assert.deepEqual(await deploymentQueryFields({ client, siteDir: site, offline: true }), FIELDS)
    assert.equal(client.asked, 0)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('⭐ `status` after a push that sent the mark finds nothing to send', async () => {
  const { root, site } = makeSite()
  try {
    // As the push does: emit with the deployment's list, bank the hashes with what it applied.
    const pushed = await emitSyncPackages(site, { backend: ORIGIN, queryFields: FIELDS })
    writeSyncCache(site, ORIGIN, pushed.hashes, pushed.applied)
    assert.equal((await probeUnpushed(site, { backend: ORIGIN })).changed, 0)

    // CONTROL — the same hashes banked WITHOUT the list: the re-emit omits the mark, and
    // the site document reads as changed. The banked list is what makes the two agree.
    const { queryFields: _dropped, ...rest } = pushed.applied
    writeSyncCache(site, ORIGIN, pushed.hashes, rest)
    assert.ok((await probeUnpushed(site, { backend: ORIGIN })).changed > 0)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
