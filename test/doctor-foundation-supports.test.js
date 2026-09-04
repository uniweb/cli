/**
 * `uniweb doctor` — `package.json::uniweb.supports` on a foundation.
 *
 * The failure this catches is invisible at every other moment: a foundation
 * renders a search box, its operator is never offered search because the
 * artifact never said it honours one, and nothing errors anywhere. `doctor` is
 * the only point in the chain where the developer who can fix it is looking.
 *
 * ⭐ The suppressions carry as much weight as the warnings. A foundation that
 * reaches for no service has nothing to declare, and a checker that fires on
 * correct configuration is how everyone learns to ignore the checker.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { checkFoundationSupports } from '../src/commands/doctor.js'

/**
 * A foundation source tree with one section whose body is `source`.
 * Returns the ids of every issue raised for it.
 */
function idsFor(source, uniweb) {
  const dir = mkdtempSync(join(tmpdir(), 'uw-doctor-supports-'))
  try {
    mkdirSync(join(dir, 'sections', 'Widget'), { recursive: true })
    writeFileSync(join(dir, 'sections', 'Widget', 'index.jsx'), source)
    const issues = []
    checkFoundationSupports({
      foundationName: 'acme',
      folderName: 'foundation',
      srcDir: dir,
      pkg: uniweb ? { uniweb } : {},
      issues
    })
    return issues.map((i) => i.id)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const SEARCH_BOX = `
import { resolveService } from '@uniweb/kit'
export default function Widget({ block }) {
  const { url } = resolveService(block.website, 'search')
  return url ? <input /> : null
}
`

test('says nothing when the foundation reaches for no service', () => {
  assert.deepEqual(idsFor(`export default function Widget() { return <div /> }`), [])
  // …and still nothing when it declares none either. Absence on both sides is
  // a consistent, correct state and must not be nagged about.
  assert.deepEqual(
    idsFor(`export default function Widget() { return <div /> }`, { supports: [] }),
    []
  )
})

test('says nothing when what it uses is what it declares', () => {
  assert.deepEqual(idsFor(SEARCH_BOX, { supports: ['search'] }), [])
  // A superset is fine: a foundation may honour a service through a path this
  // scan cannot see, and warning about that would be a false positive.
  assert.deepEqual(idsFor(SEARCH_BOX, { supports: ['search', 'submit'] }), [])
})

test('flags a service used and not declared', () => {
  assert.deepEqual(idsFor(SEARCH_BOX, { supports: ['submit'] }), [
    'foundation-supports-incomplete'
  ])
})

test('flags a service used with no declaration at all', () => {
  assert.deepEqual(idsFor(SEARCH_BOX), ['foundation-supports-incomplete'])
  assert.deepEqual(idsFor(SEARCH_BOX, { scope: '@acme' }), [
    'foundation-supports-incomplete'
  ])
})

test('recognizes the service-specific readers, which name no service string', () => {
  // Each of these IS the integration for its service, so a foundation using one
  // and declaring nothing is exactly the case this check exists for.
  assert.deepEqual(
    idsFor(`export default (p) => p.website.isSearchEnabled() ? <input/> : null`),
    ['foundation-supports-incomplete']
  )
  assert.deepEqual(
    idsFor(`import { useTracker } from '@uniweb/kit'\nexport default () => { useTracker(); return null }`),
    ['foundation-supports-incomplete']
  )
  assert.deepEqual(
    idsFor(`import { useSession } from '@uniweb/api'\nexport default () => useSession() ? null : null`),
    ['foundation-supports-incomplete']
  )
})

test('reports what it saw, so the message can be acted on', () => {
  const dir = mkdtempSync(join(tmpdir(), 'uw-doctor-supports-'))
  try {
    mkdirSync(join(dir, 'sections'), { recursive: true })
    writeFileSync(join(dir, 'sections', 'Widget.jsx'), SEARCH_BOX)
    const issues = []
    checkFoundationSupports({
      foundationName: 'acme',
      folderName: 'foundation',
      srcDir: dir,
      pkg: {},
      issues
    })
    assert.equal(issues.length, 1)
    assert.deepEqual(issues[0].details.used, ['search'])
    assert.equal(issues[0].details.declared, null)
    assert.match(issues[0].message, /uniweb\.supports/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
