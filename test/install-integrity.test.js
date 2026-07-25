/**
 * The install-integrity check.
 *
 * A `file:` foundation dependency can be satisfied by a symlink to the
 * workspace source or by a materialized copy, and only the link stays true. The
 * copy carries its own nested node_modules, so it keeps resolving whatever
 * `@uniweb/*` versions were current when it was made.
 *
 * What makes that state expensive is where it hides: `uniweb build` resolves
 * the workspace source directly and stays correct throughout, so the build is
 * green and the tests pass while the dev server — which serves out of
 * node_modules — runs code from weeks ago. It cost a long debugging detour and
 * two wrong diagnoses before this check existed, including a framework "fix"
 * that had to be reverted.
 *
 * These tests build both trees on disk, because the distinction under test is
 * literally a filesystem one.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { checkSiteInstall, readDeclaredFoundation } from '../src/utils/install-integrity.js'

/**
 * A workspace with a site and the foundation it declares.
 *
 * @param {Object} opts
 * @param {'link'|'copy'|'none'} opts.install - how the site reaches the foundation
 * @param {string} opts.declaredKit - what the foundation's package.json asks for
 * @param {string} [opts.reachedKit] - what is actually installed where the site looks
 */
function makeWorkspace({ install = 'link', declaredKit = '0.9.34', reachedKit = null } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'uniweb-integrity-'))
  const sitePath = join(root, 'site')
  const foundationPath = join(root, 'src')

  mkdirSync(join(sitePath, 'node_modules'), { recursive: true })
  writeFileSync(join(sitePath, 'site.yml'), 'name: Test\nfoundation: src\n')
  writeFileSync(
    join(sitePath, 'package.json'),
    JSON.stringify({ name: 'site', dependencies: { src: 'file:../src' } })
  )

  mkdirSync(foundationPath, { recursive: true })
  writeFileSync(
    join(foundationPath, 'package.json'),
    JSON.stringify({ name: 'src', dependencies: { '@uniweb/kit': declaredKit } })
  )

  // What the foundation source itself resolves — always what it declares.
  const writeKit = (under, version) => {
    const dir = join(under, 'node_modules', '@uniweb', 'kit')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: '@uniweb/kit', version }))
  }
  writeKit(foundationPath, declaredKit)

  const linkPath = join(sitePath, 'node_modules', 'src')

  if (install === 'link') {
    symlinkSync(foundationPath, linkPath, 'dir')
  } else if (install === 'copy') {
    // A snapshot: same files, but its own nested dependency tree, pinned to
    // whatever was current when the copy was taken.
    mkdirSync(linkPath, { recursive: true })
    writeFileSync(
      join(linkPath, 'package.json'),
      JSON.stringify({ name: 'src', dependencies: { '@uniweb/kit': declaredKit } })
    )
    writeKit(linkPath, reachedKit ?? declaredKit)
  }

  return {
    root,
    site: { name: 'site', path: sitePath },
    foundation: { name: 'src', path: foundationPath },
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  }
}

const ids = (findings) => findings.map((f) => f.id)

test('a linked foundation is clean', () => {
  const ws = makeWorkspace({ install: 'link' })
  try {
    assert.deepEqual(checkSiteInstall(ws.site, ws.foundation, ws.root), [])
  } finally {
    ws.cleanup()
  }
})

test('a copied foundation is reported', () => {
  const ws = makeWorkspace({ install: 'copy' })
  try {
    const findings = checkSiteInstall(ws.site, ws.foundation, ws.root)
    assert.ok(ids(findings).includes('foundation-not-linked'))
    assert.match(findings[0].message, /copy, not a link/)
    assert.ok(findings[0].remedy.length > 0)
  } finally {
    ws.cleanup()
  }
})

test('a copy running an older dependency than declared is reported', () => {
  // The exact shape of the real incident: declared 0.9.34, running 0.9.33,
  // build green, dev serving the old one.
  const ws = makeWorkspace({ install: 'copy', declaredKit: '0.9.34', reachedKit: '0.9.33' })
  try {
    const findings = checkSiteInstall(ws.site, ws.foundation, ws.root)
    assert.ok(ids(findings).includes('foundation-dep-skew'))
    const skew = findings.find((f) => f.id === 'foundation-dep-skew')
    assert.match(skew.message, /0\.9\.33/)
    assert.match(skew.message, /0\.9\.34/)
  } finally {
    ws.cleanup()
  }
})

test('a link never skews, because both sides are one tree', () => {
  const ws = makeWorkspace({ install: 'link', declaredKit: '0.9.34' })
  try {
    assert.equal(ids(checkSiteInstall(ws.site, ws.foundation, ws.root)).length, 0)
  } finally {
    ws.cleanup()
  }
})

test('nothing installed is left to the checks that own it', () => {
  // `uniweb doctor` already reports a missing dependency; a second voice
  // saying the same thing in different words helps nobody.
  const ws = makeWorkspace({ install: 'none' })
  try {
    assert.deepEqual(checkSiteInstall(ws.site, ws.foundation, ws.root), [])
  } finally {
    ws.cleanup()
  }
})

test('a range spec is not treated as a promise about the exact version', () => {
  // "^0.9.0" says any compatible version; only an exact pin can be violated.
  const ws = makeWorkspace({ install: 'copy', declaredKit: '^0.9.0', reachedKit: '0.9.12' })
  try {
    assert.ok(!ids(checkSiteInstall(ws.site, ws.foundation, ws.root)).includes('foundation-dep-skew'))
  } finally {
    ws.cleanup()
  }
})

test('readDeclaredFoundation reads site.yml, and tolerates its absence', () => {
  const ws = makeWorkspace()
  try {
    assert.equal(readDeclaredFoundation(ws.site.path), 'src')
    assert.equal(readDeclaredFoundation(ws.root), null)
  } finally {
    ws.cleanup()
  }
})
