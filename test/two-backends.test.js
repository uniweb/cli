/**
 * TWO BACKENDS, ONE PROJECT — the acceptance test for
 * `kb/framework/plans/backend-scoped-project-state.md`.
 *
 * ⭐ **Most of this file is expected to FAIL until that plan lands, and is skipped
 * with the step that un-skips it.** It is written first on purpose: every step of
 * the migration threads a backend origin through code that never had one, and a
 * missed thread is SILENT — state lands in the wrong place, or stops being
 * restored, and no existing suite spans the seam to notice.
 *
 * ⛔ **No `uniwebd` and no backend lane.** `pushSyncPackages` takes its client as a
 * parameter, so two backends are two mock clients with different origins over one
 * temp site directory. Everything here is framework's own.
 *
 * ⚖️ **The control at the bottom passes today** and must keep passing. Without it a
 * harness that quietly did nothing would look like a clean run of skipped work.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import yaml from 'js-yaml'
import { pushSyncPackages } from '../src/backend/site-sync.js'

const A = 'http://backend-a.test'
const B = 'http://backend-b.test'

/** The step of §7 that makes each group pass. */
const NEEDS = (n, what) => ({ skip: `plan §7 step ${n} — ${what}` })

const dirs = []
process.on('exit', () => {
  for (const d of dirs) {
    try {
      rmSync(d, { recursive: true, force: true })
    } catch {
      /* best effort */
    }
  }
})

function tmpSite() {
  const dir = mkdtempSync(join(tmpdir(), 'two-backends-'))
  dirs.push(dir)
  writeFileSync(join(dir, 'site.yml'), "name: Acme\nfoundation: '@a/base'\n")
  return dir
}

const ok = (body) => ({
  ok: true,
  status: 200,
  statusText: 'OK',
  json: async () => body,
  text: async () => JSON.stringify(body)
})

/** A backend that mints `uuid` for the site-content lane and nothing else. */
function mockBackend(origin, uuid) {
  return {
    origin,
    createSiteContent: async () =>
      ok({ report: { finalized: [{ index: 0, uuid, changed: true, version: 'v1' }] } })
  }
}

const sitePkg = () => ({
  siteContent: {
    buffer: Buffer.from('site'),
    entityCount: 1,
    models: ['@uniweb/site-content'],
    index: [{ kind: 'site' }]
  },
  records: null,
  hashes: { '@uniweb/site-content site': 'h1' },
  siteContentUuid: undefined
})

const silent = () => ({
  info: () => {},
  note: () => {},
  error: () => {},
  dim: (s) => s
})

/** Push this site to one backend, as the CLI would. */
async function pushTo(dir, backend) {
  return pushSyncPackages({
    client: backend,
    siteDir: dir,
    pkg: sitePkg(),
    asOrg: null,
    report: silent()
  })
}

/** `sync.json`'s section for one origin — the shape the plan targets. */
function stateFor(dir, origin) {
  const p = join(dir, 'sync.json')
  if (!existsSync(p)) return {}
  try {
    return JSON.parse(readFileSync(p, 'utf8'))?.backends?.[origin] || {}
  } catch {
    return {}
  }
}

// ───────────────────────────── the acceptance criteria ─────────────────────────

test(
  '⭐ two backends each keep their own site uuid, and neither overwrites the other',
  NEEDS(4, 'site identity moves to sync.json'),
  async () => {
    const dir = tmpSite()

    assert.equal((await pushTo(dir, mockBackend(A, 'SITE-A'))).exitCode, 0)
    assert.equal((await pushTo(dir, mockBackend(B, 'SITE-B'))).exitCode, 0)

    assert.equal(stateFor(dir, A).site?.uuid, 'SITE-A')
    assert.equal(stateFor(dir, B).site?.uuid, 'SITE-B')
  }
)

test(
  "⭐ site.yml holds no backend-minted identity at all",
  NEEDS(4, '$uuid / $org / $backend leave site.yml'),
  async () => {
    const dir = tmpSite()
    await pushTo(dir, mockBackend(A, 'SITE-A'))

    const y = yaml.load(readFileSync(join(dir, 'site.yml'), 'utf8'))
    for (const key of ['$uuid', '$org', '$backend']) {
      assert.equal(y[key], undefined, `site.yml still carries ${key}`)
    }
    // The author's own keys are untouched — this is the whole point.
    assert.equal(y.name, 'Acme')
    assert.equal(y.foundation, '@a/base')
  }
)

test(
  '⭐ asset ids get a per-backend home, and the single-backend file is retired',
  NEEDS(2, 'assets move into sync.json'),
  async () => {
    const dir = tmpSite()
    const store = await import('@uniweb/build/uwx')

    // Two backends can hold an id for the SAME local path without colliding — which
    // `assets.json`, a single flat map, cannot represent at all.
    store.updateBackendMap(dir, A, 'assets', { '/hero.png': { id: 'id-from-A', ext: 'png' } })
    store.updateBackendMap(dir, B, 'assets', { '/hero.png': { id: 'id-from-B', ext: 'png' } })

    assert.equal(stateFor(dir, A).assets['/hero.png'].id, 'id-from-A')
    assert.equal(stateFor(dir, B).assets['/hero.png'].id, 'id-from-B')

    // ⛔ And the file-based map is GONE from the public surface. This is the half
    // that fails today: leaving both would be two homes for one fact.
    assert.equal(store.readAssetMap, undefined, '@uniweb/build/uwx still exports readAssetMap')
    assert.equal(store.updateAssetMap, undefined, '@uniweb/build/uwx still exports updateAssetMap')
    assert.equal(store.ASSET_MAP_FILE, undefined, '@uniweb/build/uwx still exports ASSET_MAP_FILE')
  }
)

test(
  '⭐ the send-only-changed cache is per backend, so B is not told A\'s content is unchanged',
  NEEDS(3, 'the cache is renamed and keyed by origin'),
  async () => {
    const dir = tmpSite()
    await pushTo(dir, mockBackend(A, 'SITE-A'))

    const cache = join(dir, '.uniweb', 'backend-cache.json')
    assert.ok(existsSync(cache), 'backend-cache.json should exist')
    const parsed = JSON.parse(readFileSync(cache, 'utf8'))

    assert.ok(parsed.backends?.[A], "A's cache section is missing")
    assert.equal(parsed.backends?.[B], undefined, "B must not inherit A's cache")
    assert.equal(parsed.siteUuid, undefined, 'the siteUuid stamp should be gone')
    assert.ok(!existsSync(join(dir, '.uniweb', 'sync-cache.json')), 'old cache name survived')
  }
)

test(
  '⭐ nothing can send one backend\'s identity to another — the scope guard is unnecessary',
  NEEDS(4, 'assertSiteBackendScope is deleted'),
  async () => {
    const dir = tmpSite()
    await pushTo(dir, mockBackend(A, 'SITE-A'))

    // The guard existed because one $uuid could be read against the wrong origin.
    // Reading B's section can only ever produce B's state, or nothing.
    const b = stateFor(dir, B)
    assert.equal(b.site?.uuid, undefined)

    const guard = await import('../src/utils/site-identity.js')
    assert.equal(
      guard.assertSiteBackendScope,
      undefined,
      'assertSiteBackendScope still exists — contamination is representable'
    )
  }
)

// ─────────────────────────────────── the control ───────────────────────────────

test('CONTROL — the harness really pushes, so a skipped suite is not mistaken for a passing one', async () => {
  const dir = tmpSite()
  const res = await pushTo(dir, mockBackend(A, 'SITE-A'))

  assert.equal(res.exitCode, 0, 'the mock push did not succeed')
  // Something was recorded about this push, wherever identity currently lives.
  // Deliberately shape-agnostic: this assertion must survive the migration it guards.
  const wroteSomething =
    existsSync(join(dir, 'sync.json')) ||
    existsSync(join(dir, '.uniweb', 'backend-cache.json')) ||
    existsSync(join(dir, '.uniweb', 'sync-cache.json')) ||
    /\$uuid/.test(readFileSync(join(dir, 'site.yml'), 'utf8'))
  assert.ok(wroteSomething, 'the push recorded nothing anywhere — the harness is inert')
})
