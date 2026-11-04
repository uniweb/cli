/**
 * ⭐ A VERSION IS BANKED FOR WHAT THE FILES TOOK, OR CHOSE NOT TO TAKE (P5, `kb` pulling-into-mounted-folders).
 *
 * A pull meets three outcomes for a page: its file took the backend's content; a mount's page, which the
 * folder wins; and a page held because its file cannot say what the app made of it. These pin what the
 * pull banks for each, which is what the per-item gate then does with the next push: a held page keeps
 * the version this copy last agreed on, so the gate keeps the backend's copy while the file is unchanged
 * (`pkg == base` keeps the host's, `delivery-lane.md`), and a mount's takes the backend's, so the next push
 * puts the folder's back. And a pull that left the files and the backend apart banks no hash for the
 * site's content, so that next push sends it.
 *
 * ⚠️ The gate's half is the backend's, measured both ways on a live `uniwebd` (2026-09-23,
 * `delivery-lane.md` § *The push staleness gate*); this suite holds the half the CLI sends.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { agreedVersions, mountedPagesMoved } from '../src/commands/pull.js'
import { rebankSyncHashes, readSyncCache } from '../src/backend/site-sync.js'

const ORIGIN = 'https://uniweb.app'

test('⭐ a held page keeps the version this copy last agreed on; every other item takes the backend\'s', () => {
  const pulled = { P1: 'v2', S1: 'v2', P2: 'v2' }
  const prior = { P1: 'v1', S1: 'v1', P2: 'v1' }
  assert.deepEqual(agreedVersions(pulled, [{ route: 'guide/use', uuids: ['P1', 'S1'] }], prior), { P1: 'v1', S1: 'v1', P2: 'v2' })
})

test('a held page this copy never agreed on keeps the backend\'s: there is no agreement to hold', () => {
  assert.deepEqual(agreedVersions({ P1: 'v2' }, [{ route: 'faq', uuids: ['P1'] }], {}), { P1: 'v2' })
})

test('the mounted pages the backend moved since this copy last agreed, by route — none for one it never saw', () => {
  const mounted = [
    { route: 'docs', uuids: ['D0'] },
    { route: 'docs/intro', uuids: ['D1', 'D1s'] },
    { route: 'docs/new', uuids: ['D2'] },
  ]
  assert.deepEqual(mountedPagesMoved(mounted, { D0: 'v1', D1: 'v1', D1s: 'v3', D2: 'v1' }, { D0: 'v1', D1: 'v1', D1s: 'v2' }), ['docs/intro'])
})

test('⭐ a pull that left the files and the backend apart banks no hash for the site\'s content — so the next push sends it', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'uw-pull-outcomes-'))
  mkdirSync(join(dir, 'pages', 'home'), { recursive: true })
  writeFileSync(join(dir, 'site.yml'), "name: S\nfoundation: '@acme/base@1.0.0'\n")
  writeFileSync(join(dir, 'pages', 'home', 'page.yml'), 'title: Home\n')
  writeFileSync(join(dir, 'pages', 'home', 'hero.md'), '# Hello\n')
  const siteKeys = () => Object.keys(readSyncCache(dir, ORIGIN)).filter((k) => k.startsWith('@uniweb/site-content '))

  await rebankSyncHashes(dir, ORIGIN, { contentTaken: true })
  assert.equal(siteKeys().length, 1, 'CONTROL — agreed, the site\'s content is banked')
  await rebankSyncHashes(dir, ORIGIN, { contentTaken: true, contentAgreed: false })
  assert.deepEqual(siteKeys(), [])
})
