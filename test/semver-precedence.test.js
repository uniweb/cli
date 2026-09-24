/**
 * SemVer 2.0.0 precedence, as a registry orders a foundation's versions.
 *
 * Run: `pnpm test` or `node --test test/`
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  compareSemverPrecedence,
  nextVersionAbove,
  parseSemver
} from '../src/utils/semver-precedence.js'

test('the precedence example from the SemVer 2.0.0 specification, in order', () => {
  const ordered = [
    '1.0.0-alpha',
    '1.0.0-alpha.1',
    '1.0.0-alpha.beta',
    '1.0.0-beta',
    '1.0.0-beta.2',
    '1.0.0-beta.11',
    '1.0.0-rc.1',
    '1.0.0',
    '1.0.1',
    '1.1.0',
    '2.0.0'
  ]
  for (let i = 0; i < ordered.length - 1; i++) {
    assert.equal(compareSemverPrecedence(ordered[i], ordered[i + 1]), -1, `${ordered[i]} < ${ordered[i + 1]}`)
    assert.equal(compareSemverPrecedence(ordered[i + 1], ordered[i]), 1, `${ordered[i + 1]} > ${ordered[i]}`)
  }
})

test('numeric parts compare as numbers, not text', () => {
  assert.equal(compareSemverPrecedence('0.10.0', '0.9.0'), 1)
  assert.equal(compareSemverPrecedence('1.0.0-beta.11', '1.0.0-beta.2'), 1)
})

test('build metadata carries no order', () => {
  assert.equal(compareSemverPrecedence('1.2.0+b', '1.2.0'), 0)
  assert.equal(compareSemverPrecedence('1.2.0+a', '1.2.0+b'), 0)
})

test('anything that is not SemVer is null, never a guess', () => {
  for (const v of ['1.2', 'v1.2.3', '01.2.3', '1.2.3-', 'latest', '', null, undefined, 3]) {
    assert.equal(parseSemver(v), null, String(v))
    assert.equal(compareSemverPrecedence(v, '1.0.0'), null, String(v))
  }
  assert.deepEqual(parseSemver('1.2.3-rc.1+build.5'), { major: 1, minor: 2, patch: 3, pre: ['rc', '1'] })
})

// ─── nextVersionAbove — what `--bump` releases under ──────────────────────────
// A registry takes a new version only when it is greater than every one it holds,
// so the one property that matters is: the result sorts ABOVE the input.

test('nextVersionAbove: the next patch of a release, the next pre-release of a pre-release', () => {
  const cases = [
    ['1.4.2', '1.4.3'],
    ['0.2.1', '0.2.2'],
    ['2.0.0-beta.3', '2.0.0-beta.4'],
    ['1.0.0-rc', '1.0.0-rc.0'],
    ['1.0.0-alpha.9', '1.0.0-alpha.10'],
    ['1.2.0+build.7', '1.2.1']
  ]
  for (const [from, to] of cases) {
    assert.equal(nextVersionAbove(from), to, from)
    assert.equal(compareSemverPrecedence(to, from), 1, `${to} must sort above ${from}`)
  }
})

test('nextVersionAbove never promotes a pre-release line to a release', () => {
  // `1.0.0` is also above `1.0.0-rc.1`, but a bump nobody chose must not ship the
  // final release of a line that is still in pre-release.
  assert.equal(nextVersionAbove('1.0.0-rc.1'), '1.0.0-rc.2')
})

test('nextVersionAbove: null for what is not SemVer — nothing to bump from', () => {
  for (const v of ['1.0', 'v1.0.0', 'latest', '', null, undefined]) {
    assert.equal(nextVersionAbove(v), null, String(v))
  }
})
