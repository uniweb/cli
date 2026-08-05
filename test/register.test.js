/**
 * `uniweb register` — build-if-stale. Unit-pins `foundationNeedsBuild`: the
 * pure predicate that decides whether a foundation's dist/ must be (re)built
 * before registering. Mirrors `uniweb publish`'s staleness rule (missing dist,
 * or a schema version that disagrees with package.json).
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { foundationNeedsBuild } from '../src/commands/register.js'

/** A foundation dir with package.json version + (optionally) a built dist/. */
function makeFoundation({ pkgVersion = '1.0.0', dist = null } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'uw-reg-'))
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name: 'src', version: pkgVersion })
  )
  if (dist) {
    const distDir = join(dir, 'dist')
    mkdirSync(join(distDir, 'meta'), { recursive: true })
    if (dist.entry !== false)
      writeFileSync(
        join(distDir, dist.entry || 'entry.js'),
        'export default 1\n'
      )
    // A real build emits the SSR bundle alongside the browser entry, so the
    // fixture does too — otherwise every "fresh dist" case here would describe
    // a dist no toolchain since 0.14.25 actually produces. `ssr: false` models
    // the two that do occur: a dist left by `uniweb dev`, and one built by a
    // pre-0.14.25 toolchain.
    if (dist.ssr !== false)
      writeFileSync(join(distDir, 'entry-ssr.js'), 'export default 1\n')
    if (dist.schema !== undefined) {
      writeFileSync(join(distDir, 'meta', 'schema.json'), dist.schema)
    }
  }
  return dir
}

test('no dist/ → needs build', () => {
  const dir = makeFoundation({ dist: null })
  try {
    assert.deepEqual(foundationNeedsBuild(dir), {
      needs: true,
      reason: 'no dist/ found'
    })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('entry.js but no schema.json → needs build', () => {
  const dir = makeFoundation({ dist: { entry: 'entry.js' } }) // no schema key
  try {
    assert.equal(foundationNeedsBuild(dir).needs, true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('fresh dist (schema version matches package.json) → no build', () => {
  const dir = makeFoundation({
    pkgVersion: '2.3.1',
    dist: {
      schema: JSON.stringify({ _self: { name: '@a/b', version: '2.3.1' } })
    }
  })
  try {
    assert.deepEqual(foundationNeedsBuild(dir), { needs: false })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('stale dist (schema version differs from package.json) → needs build', () => {
  const dir = makeFoundation({
    pkgVersion: '2.4.0',
    dist: {
      schema: JSON.stringify({ _self: { name: '@a/b', version: '2.3.1' } })
    }
  })
  try {
    const r = foundationNeedsBuild(dir)
    assert.equal(r.needs, true)
    assert.match(r.reason, /2\.4\.0.*2\.3\.1/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('legacy dist/foundation.js artifact is accepted (no rebuild forced)', () => {
  const dir = makeFoundation({
    pkgVersion: '1.0.0',
    dist: {
      entry: 'foundation.js',
      schema: JSON.stringify({ _self: { version: '1.0.0' } })
    }
  })
  try {
    assert.deepEqual(foundationNeedsBuild(dir), { needs: false })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('unparseable schema.json → needs build', () => {
  const dir = makeFoundation({ dist: { schema: '{ not json' } })
  try {
    assert.deepEqual(foundationNeedsBuild(dir), {
      needs: true,
      reason: 'dist/meta/schema.json could not be parsed'
    })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('schema without _self.version is treated as fresh (nothing to compare)', () => {
  const dir = makeFoundation({
    dist: { schema: JSON.stringify({ _self: { name: '@a/b' } }) }
  })
  try {
    assert.deepEqual(foundationNeedsBuild(dir), { needs: false })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

/**
 * A dist can look complete and still be unshippable: `uniweb dev` rebuilds the
 * foundation on every save and skips the SSR sub-build, and any toolchain older
 * than @uniweb/build@0.14.25 never emitted it at all. Both leave entry.js and a
 * version-matching schema.json, so every other check here passes.
 *
 * Shipping one produces a site that renders client-side at HTTP 200 with nothing
 * reporting why — the failure that cost three lanes a night on 2026-08-04. The
 * remedy is cheap and local: treat it as stale and rebuild.
 */
test('dist with no entry-ssr.js → needs build (dev leftovers, pre-0.14.25 builds)', () => {
  const dir = makeFoundation({
    pkgVersion: '2.3.1',
    dist: {
      ssr: false,
      schema: JSON.stringify({ _self: { name: '@a/b', version: '2.3.1' } })
    }
  })
  try {
    const r = foundationNeedsBuild(dir)
    assert.equal(r.needs, true)
    assert.match(r.reason, /entry-ssr\.js/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a legacy dist/foundation.js build also needs one', () => {
  // The legacy artifact name is accepted, but it predates SSR emission, so a
  // dist carrying it and no SSR bundle is still stale for shipping purposes.
  const dir = makeFoundation({
    pkgVersion: '1.0.0',
    dist: {
      entry: 'foundation.js',
      ssr: false,
      schema: JSON.stringify({ _self: { name: '@a/b', version: '1.0.0' } })
    }
  })
  try {
    assert.equal(foundationNeedsBuild(dir).needs, true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
