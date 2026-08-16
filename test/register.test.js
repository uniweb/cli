/**
 * `uniweb register` — build-if-stale. Unit-pins `foundationNeedsBuild`: the
 * pure predicate that decides whether a foundation's dist/ must be (re)built
 * before registering. Three signals: a missing dist, a schema version that
 * disagrees with package.json, and a source file newer than the built entry.
 *
 * ⚠️ This header used to say it "mirrors `uniweb publish`'s staleness rule".
 * `publish` has no staleness rule — it builds UNCONDITIONALLY before digesting
 * (`backend/foundation-bring-along.js`). The sentence was in the predicate's own
 * docblock too, and it is why the missing source signal went unnoticed: it read
 * as already-verified-elsewhere.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  utimesSync,
  statSync
} from 'node:fs'
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

// ─── the source signal ────────────────────────────────────────────────────────
//
// The defect this closes shipped silently: edit a component, re-run `register`
// with a dist/ present, and the OLD bytes upload with a content digest that
// honestly reports "unchanged" — because the input it hashes never changed.
// Found by end-to-end testing against a live backend.

/** Set a file's mtime to an absolute epoch-seconds value. */
function setMtime(path, epochSeconds) {
  utimesSync(path, epochSeconds, epochSeconds)
}

const BASE = 1_000_000

/**
 * A fresh foundation whose dist/ is internally consistent, plus a source file.
 *
 * Every SOURCE file is normalized to `BASE` so a test only has to move the one
 * it is actually about. ⚠️ `package.json` needs this too — it IS source (a
 * dependency change changes the build), and the base helper writes it at
 * wall-clock time, which is ~700_000 times larger than these synthetic stamps.
 * Leaving it alone made three "should be fresh" cases report stale.
 */
function makeWithSource() {
  const dir = makeFoundation({
    pkgVersion: '2.3.1',
    dist: {
      schema: JSON.stringify({ _self: { name: '@a/b', version: '2.3.1' } })
    }
  })
  mkdirSync(join(dir, 'src', 'sections'), { recursive: true })
  const srcFile = join(dir, 'src', 'sections', 'Hero.jsx')
  writeFileSync(srcFile, 'export default () => null\n')
  const pkg = join(dir, 'package.json')
  setMtime(pkg, BASE)
  setMtime(srcFile, BASE)
  return { dir, srcFile, pkg, entry: join(dir, 'dist', 'entry.js') }
}

test('a source file NEWER than dist/entry.js → needs build', () => {
  const { dir, srcFile, entry } = makeWithSource()
  try {
    setMtime(entry, BASE)
    setMtime(srcFile, BASE + 10) // edited after the build
    const r = foundationNeedsBuild(dir)
    assert.equal(r.needs, true)
    assert.match(r.reason, /source file is newer/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a source file OLDER than dist/entry.js → no build — the control', () => {
  // Without this pairing the test above passes for a predicate that always says
  // "needs build", which would make every publish build twice (publish shells
  // out to register after building).
  const { dir, entry } = makeWithSource()
  try {
    setMtime(entry, BASE + 10) // built after the edit — the publish path
    assert.deepEqual(foundationNeedsBuild(dir), { needs: false })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('dist/ is excluded from the source walk', () => {
  // Load-bearing, and it fails in the always-rebuild direction if broken: a real
  // build writes meta/schema.json AFTER entry.js, so walking dist/ would make
  // every foundation permanently stale against its own output.
  const { dir, entry } = makeWithSource()
  try {
    setMtime(entry, BASE + 10)
    setMtime(join(dir, 'dist', 'meta', 'schema.json'), BASE + 20) // newer than entry
    assert.deepEqual(foundationNeedsBuild(dir), { needs: false })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('equal mtimes count as fresh, not stale', () => {
  // A build writes its output after reading its input, so equal mtimes mean a
  // same-instant build. `>=` here would rebuild every foundation once on a fresh
  // clone, where whole trees share a timestamp.
  const { dir, entry } = makeWithSource()
  try {
    setMtime(entry, BASE) // equal to every source file
    assert.deepEqual(foundationNeedsBuild(dir), { needs: false })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the walk really reaches nested source — the instrument control', () => {
  // Proves the recursion works. Without it, every assertion above could pass on a
  // walker that only ever looks at the foundation root.
  const { dir, entry } = makeWithSource()
  try {
    setMtime(entry, BASE)
    const nested = join(dir, 'src', 'sections', 'Hero.jsx')
    setMtime(nested, BASE + 10)
    assert.equal(foundationNeedsBuild(dir).needs, true)
    // …and the file really is nested, not at the root.
    assert.ok(statSync(nested).isFile())
    assert.notEqual(join(dir, 'Hero.jsx'), nested)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

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
