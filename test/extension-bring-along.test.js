/**
 * `publish` brings a site's LOCAL extensions along, exactly as it does the
 * primary foundation.
 *
 * Ruling 2026-08-04: an extension IS a foundation, so it gets a foundation's
 * freshness guarantee. Before this, a site could go live against stale extension
 * code with nothing noticing — the primary was covered and the rest were not.
 *
 * These pin the resolver's branches. The releasing logic itself is the same
 * `bringLocalCodeAlong` the primary uses, so it is covered by the foundation
 * path; what is new — and what would silently regress — is WHICH declarations
 * count as local.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { resolveLocalExtensions } from '../src/backend/foundation-bring-along.js'

function tmpSite() {
  return mkdtempSync(join(tmpdir(), 'uniweb-ext-'))
}

test('no extensions declared → nothing to bring along', () => {
  const dir = tmpSite()
  try {
    assert.deepEqual(resolveLocalExtensions(dir, {}), [])
    assert.deepEqual(resolveLocalExtensions(dir, { extensions: [] }), [])
    // A malformed value must not throw mid-publish.
    assert.deepEqual(resolveLocalExtensions(dir, { extensions: 'nope' }), [])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('URL declarations are never local — the host already serves that code', () => {
  const dir = tmpSite()
  try {
    const siteYml = {
      extensions: [
        'https://cdn.example.com/effects/entry.js',
        '/effects/entry.js', // site-relative: publish rejects it separately
        { url: 'https://cdn.example.com/other/entry.js' }
      ]
    }
    assert.deepEqual(resolveLocalExtensions(dir, siteYml), [])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a versioned catalog ref is not local — the catalog has it', () => {
  const dir = tmpSite()
  try {
    const siteYml = { extensions: ['@acme/effects@1.2.3'] }
    assert.deepEqual(resolveLocalExtensions(dir, siteYml), [])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('an unresolvable name is skipped, not thrown — the build surfaces the canonical error', () => {
  const dir = tmpSite()
  try {
    // `detectFoundationType` throws for a name it cannot resolve. Bring-along
    // must not turn that into a publish crash: the site build reports it with
    // the full explanation, and this path simply has nothing local to act on.
    assert.deepEqual(
      resolveLocalExtensions(dir, { extensions: ['no-such-package'] }),
      []
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a workspace-local extension IS local, and carries its authored decl as the pin key', () => {
  const root = tmpSite()
  try {
    // A site with a `file:` dependency on a sibling extension — the same shape
    // `detectFoundationType` resolves for a local primary foundation.
    const siteDir = join(root, 'site')
    const extDir = join(root, 'effects')
    mkdirSync(siteDir, { recursive: true })
    mkdirSync(extDir, { recursive: true })
    writeFileSync(
      join(siteDir, 'package.json'),
      JSON.stringify({
        name: 'site',
        dependencies: { effects: 'file:../effects' }
      })
    )
    writeFileSync(
      join(extDir, 'package.json'),
      JSON.stringify({
        name: 'effects',
        version: '0.3.1',
        uniweb: { scope: '@acme' }
      })
    )

    const found = resolveLocalExtensions(siteDir, { extensions: ['effects'] })
    assert.equal(found.length, 1)
    // `decl` is what the author wrote — the wire entry's `$id`, and the key
    // `injectExtensions` stamps the pinned ref onto. It must NOT be rewritten
    // to the resolved path or the scoped name, or the stamp misses its entry.
    assert.equal(found[0].decl, 'effects')
    assert.equal(found[0].scopedName, '@acme/effects')
    assert.equal(found[0].version, '0.3.1')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
