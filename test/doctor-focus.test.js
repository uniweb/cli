/**
 * ⭐ WHAT `uniweb doctor` CHECKS IS WHERE YOU STAND (`doctorFocus`), by the rule `dev` and `status` read
 * the folder you stand in: in a site, that site and what it is built from — its foundation and its
 * extensions; in a foundation with no site around it, that foundation; elsewhere, the whole workspace.
 *
 * ⛔ Until 2026-11-08 only the sites were narrowed. Run in one site of a workspace holding seven
 * foundations, doctor reported on all seven before the site's own two findings.
 *
 * Run: `pnpm test` or `node --test test/`
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmp } from './helpers/run-verb.js'
import { doctorFocus } from '../src/commands/doctor.js'

const w = (root, rel, body) => {
  const p = join(root, rel)
  mkdirSync(join(p, '..'), { recursive: true })
  writeFileSync(p, body)
}

// A workspace of two projects, each a foundation and a site beside it, a shared extension, and a
// foundation in a folder of foundations no site stands beside.
function workspace() {
  const root = tmp('uw-doctor-focus-')
  for (const p of ['shop', 'press']) {
    w(root, `${p}/src/package.json`, JSON.stringify({ name: `${p}-src`, main: './_entry.generated.js' }))
    w(root, `${p}/src/main.js`, 'export default {}\n')
    w(root, `${p}/site/package.json`, JSON.stringify({ name: `${p}-site`, dependencies: { [`${p}-src`]: 'file:../src' } }))
  }
  w(root, 'shop/site/site.yml', 'foundation: shop-src\nextensions: [effects]\n')
  w(root, 'press/site/site.yml', 'foundation: press-src\n')
  w(root, 'effects/package.json', JSON.stringify({ name: 'effects', main: './_entry.generated.js' }))
  w(root, 'effects/main.js', 'export default { extension: true }\n')
  w(root, 'foundations/ui/package.json', JSON.stringify({ name: 'ui', main: './_entry.generated.js' }))
  w(root, 'foundations/ui/main.js', 'export default {}\n')
  w(root, 'pnpm-workspace.yaml', "packages:\n  - '*/src'\n  - '*/site'\n  - effects\n  - 'foundations/*'\n")
  const pkg = (path, name) => ({ path: join(root, path), name, folderName: path })
  return {
    root,
    allSites: [{ path: join(root, 'shop/site'), name: 'shop-site' }, { path: join(root, 'press/site'), name: 'press-site' }],
    foundations: [pkg('shop/src', 'shop-src'), pkg('press/src', 'press-src'), pkg('foundations/ui', 'ui')],
    extensions: [pkg('effects', 'effects')],
  }
}

const focusAt = (ws, rel) => doctorFocus({ workspaceDir: ws.root, projectDir: join(ws.root, rel), ...ws })
const names = (list) => list.map((x) => x.name)

test('⭐ in a site: that site, its foundation and its extensions — no other foundation', () => {
  const ws = workspace()
  const focus = focusAt(ws, 'shop/site')
  assert.equal(focus.site.name, 'shop-site')
  assert.deepEqual(names(focus.sites), ['shop-site'])
  assert.deepEqual(names(focus.foundations), ['shop-src'])
  assert.deepEqual(names(focus.extensions), ['effects'])
})

test('in a project\'s foundation: the project\'s site, as `dev` and `status` read it', () => {
  const ws = workspace()
  const focus = focusAt(ws, 'press/src')
  assert.deepEqual(names(focus.sites), ['press-site'])
  assert.deepEqual(names(focus.foundations), ['press-src'])
  assert.deepEqual(names(focus.extensions), [])
})

test('in a foundation no site stands beside: that foundation, and no site', () => {
  const ws = workspace()
  const focus = focusAt(ws, 'foundations/ui')
  assert.equal(focus.foundation.name, 'ui')
  assert.deepEqual(names(focus.foundations), ['ui'])
  assert.deepEqual(focus.sites, [])
})

test('CONTROL — at the workspace root, the whole workspace', () => {
  const ws = workspace()
  assert.equal(focusAt(ws, ''), null)
})
