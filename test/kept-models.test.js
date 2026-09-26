/**
 * The Models a push or a pull reads are kept, per backend, so an offline emit resolves them too.
 *
 * A clone's foundation is a catalog ref: nothing in the project declares its Models, and
 * `uniweb status` is offline by design. Until 2026-09-26 it could not resolve them — "Model
 * … could not be resolved" — and so could not say whether anything was left to push.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { emitSyncPackages } from '@uniweb/build/uwx'
import {
  makeModelResolver,
  keptModels,
  writeSyncCache,
  probeUnpushed
} from '../src/backend/site-sync.js'

const ORIGIN = 'http://backend.test'
const NOTE = {
  name: '@acme/note',
  sections: { brief: { brief: true, fields: { title: { type: 'string', localized: true } } } }
}

const clientServing = (models) => {
  const client = { origin: ORIGIN, reads: 0 }
  client.readDataSchema = async (name) => {
    client.reads++
    return models[name] ?? null
  }
  return client
}

test('an online read keeps each Model it reads; an offline one answers from them', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'kept-models-'))
  try {
    const online = makeModelResolver({ client: clientServing({ '@acme/note': NOTE }), siteDir: dir })
    assert.deepEqual(await online('@acme/note'), NOTE)
    assert.deepEqual(keptModels(dir, ORIGIN), { '@acme/note': NOTE })

    const offline = makeModelResolver({ client: null, offline: true, siteDir: dir, backend: ORIGIN })
    assert.deepEqual(await offline('@acme/note'), NOTE)
    assert.equal(await offline('@acme/other'), null)
    // Per backend: another backend's reader keeps nothing it can see here.
    const elsewhere = makeModelResolver({ client: null, offline: true, siteDir: dir, backend: 'http://other.test' })
    assert.equal(await elsewhere('@acme/note'), null)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('⭐ `status` in a clone compares, with the Models its pull kept', async () => {
  const root = mkdtempSync(join(tmpdir(), 'kept-models-clone-'))
  const site = join(root, 'site')
  const w = (rel, body) => {
    const p = join(site, rel)
    mkdirSync(join(p, '..'), { recursive: true })
    writeFileSync(p, body)
  }
  try {
    // A clone: its foundation a catalog ref, its Model declared nowhere in the project.
    w('site.yml', "name: T\nfoundation: '@acme/fnd@1.0.0'\n")
    w('queries.yml', "notes:\n  schema: '@acme/note'\n")
    w('pages/home/page.yml', 'title: Home\n')
    w('records/note/a.yml', 'title: A note\n')

    await assert.rejects(probeUnpushed(site, { backend: ORIGIN }), /could not be resolved/)

    // What its pull does: read the Model online — which keeps it — and bank the hashes.
    const resolveModel = makeModelResolver({ client: clientServing({ '@acme/note': NOTE }), siteDir: site })
    const pushed = await emitSyncPackages(site, { backend: ORIGIN, resolveModel })
    writeSyncCache(site, ORIGIN, pushed.hashes, pushed.applied)

    assert.equal((await probeUnpushed(site, { backend: ORIGIN })).changed, 0)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
