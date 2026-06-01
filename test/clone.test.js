/**
 * uniweb clone — verb structure, mock-backed.
 *
 * Drives clone with an injected fetch (a synthetic site-content document),
 * getToken (no auth), and skipInstall/skipPull (no spawn), into a temp cwd, and
 * asserts the harness scaffold + uuid seeding. The projection itself is delegated
 * to `uniweb pull` (covered by pull.test.js); here we pin clone's own job:
 * read seeds → scaffold a ref-only site → seed $uuid.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { clone, extractCloneSeeds, extractDocument } from '../src/commands/clone.js'

const jsonRes = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, statusText: '', json: async () => body })

// A site-content $-document as the backend would return it on the pull lane.
const siteDoc = () => ({
  $model: '@uniweb/site-content',
  $uuid: 'SITE-1',
  info: { name: 'My Site', foundation: '@acme/base@1.0.0' },
})

const tmpCwd = () => mkdtempSync(join(tmpdir(), 'uniweb-clone-'))
const noSpawn = { getToken: async () => 'tok', skipInstall: true, skipPull: true }

test('extractCloneSeeds reads the foundation ref and name (no folder uuid)', () => {
  assert.deepEqual(extractCloneSeeds(siteDoc()), {
    foundationRef: '@acme/base@1.0.0',
    name: 'My Site',
  })
})

test('extractCloneSeeds tolerates a localized name', () => {
  const seeds = extractCloneSeeds({ info: { name: { en: 'Hi', fr: 'Salut' } } })
  assert.equal(seeds.name, 'Hi')
  assert.equal(seeds.foundationRef, null)
  assert.equal(seeds.folderUuid, undefined) // no folder uuid is read anymore
})

test('extractDocument tolerates raw and {document}/{entity} envelopes', () => {
  const raw = siteDoc()
  assert.equal(extractDocument(raw), raw)
  assert.equal(extractDocument({ document: raw }), raw)
  assert.equal(extractDocument(null), null)
})

test('clone errors without a site uuid', async () => {
  const res = await clone([], noSpawn)
  assert.equal(res.exitCode, 2)
})

test('clone reports a 404 cleanly', async () => {
  const dir = tmpCwd()
  try {
    const res = await clone(['MISSING', 'x'], { ...noSpawn, cwd: dir, fetch: async () => jsonRes(null, 404) })
    assert.equal(res.exitCode, 1)
    assert.equal(existsSync(join(dir, 'x')), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('clone scaffolds a ref-only harness and seeds the uuids (new workspace)', async () => {
  const dir = tmpCwd()
  try {
    const res = await clone(['SITE-1', 'my-site'], {
      ...noSpawn,
      cwd: dir,
      fetch: async (url) => (url.includes('/dev/site/content/pull/SITE-1') ? jsonRes(siteDoc()) : jsonRes(null, 404)),
    })
    assert.equal(res.exitCode, 0)

    const root = join(dir, 'my-site')
    const siteDir = join(root, 'site')

    // Harness present (workspace AGENTS.md + the site's Vite entry).
    assert.ok(existsSync(join(root, 'AGENTS.md')), 'AGENTS.md scaffolded')
    assert.ok(existsSync(join(siteDir, 'entry.js')), 'site entry.js scaffolded')

    // site.yml carries the seeded entity uuid + the carried foundation ref.
    const siteYml = readFileSync(join(siteDir, 'site.yml'), 'utf8')
    assert.match(siteYml, /^\$uuid: SITE-1$/m)
    assert.match(siteYml, /foundation: @acme\/base@1\.0\.0/)

    // Ref-only: package.json has @uniweb/runtime and NO local foundation dep.
    const pkg = JSON.parse(readFileSync(join(siteDir, 'package.json'), 'utf8'))
    assert.deepEqual(Object.keys(pkg.dependencies), ['@uniweb/runtime'])

    // No folder uuid is seeded — the folder is pulled by the site-content uuid.
    assert.equal(existsSync(join(siteDir, 'collections', 'collections.yml')), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('clone forwards --no-collections to the delegated pull', async () => {
  const dir = tmpCwd()
  let pulledArgs = null
  try {
    const res = await clone(['SITE-1', 'solo', '--no-collections'], {
      getToken: async () => 'tok',
      skipInstall: true,
      runPull: async (_siteDir, _pm, extra) => {
        pulledArgs = extra
      },
      cwd: dir,
      fetch: async () => jsonRes(siteDoc()),
    })
    assert.equal(res.exitCode, 0)
    assert.ok(pulledArgs && pulledArgs.includes('--no-collections'), 'forwarded --no-collections to pull')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
