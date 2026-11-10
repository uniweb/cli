/**
 * A package `add` (and `clone`) makes is inside the workspace, however its folder is named
 * (`resolvePlacement`, `src/utils/placement.js`).
 *
 * ⛔ Until 2026-11-09 only `--path` was checked, and a name naming a path was taken as written.
 * Measured: `add foundation /tmp/x` made `<workspace>/tmp/x/` while both manifests listed
 * `/tmp/x`, and `add foundation ../x` made a package outside the workspace and listed `../x`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolvePlacement, FOUNDATION_KIND } from '../src/utils/placement.js'

const ROOT = '/ws'
const at = (name, opts = {}) => resolvePlacement(ROOT, name, opts, FOUNDATION_KIND)

test('⭐ a name that is a path outside the workspace, or climbs out of it, is outside', () => {
  for (const name of ['/tmp/x', '../x', '..', 'foundations/../../x']) {
    assert.equal(at(name).outsideRoot, name, name)
    assert.equal(at(name).relativePath, null, name)
  }
  assert.equal(at('../../x', { path: 'libs' }).outsideRoot, 'libs/../../x')
  assert.equal(at(null, { path: '/tmp' }).outsideRoot, '/tmp')
})

test('an absolute path inside the workspace is its root-relative folder', () => {
  assert.deepEqual(at('/ws/foundations/ui'), { relativePath: 'foundations/ui', packageName: 'ui' })
  assert.deepEqual(at('foundations/./ui/'), { relativePath: 'foundations/ui', packageName: 'ui' })
})

test('CONTROL: the forms inside it place as before', () => {
  assert.deepEqual(at('ui'), { relativePath: 'ui', packageName: 'ui' })
  assert.deepEqual(at('foundations/ui'), { relativePath: 'foundations/ui', packageName: 'ui' })
  assert.deepEqual(at('x', { path: 'libs' }), { relativePath: 'libs/x', packageName: 'x' })
  assert.deepEqual(at(null), { relativePath: 'src', packageName: 'src' })
  assert.deepEqual(at(null, { project: 'shop' }), { relativePath: 'shop/src', packageName: 'shop-src' })
})
