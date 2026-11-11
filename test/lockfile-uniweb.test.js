/**
 * `uniweb update`'s lift: the @uniweb packages a lockfile holds, and the command that moves each to
 * the newest version its range allows.
 *
 * Why it exists: `update` aligned what a workspace declares, and its install kept every other locked
 * version that still met its range. So a patch to a package a project reaches only through another
 * reached new projects at once and existing ones never. Measured 2026-11-10: semantic-parser 1.13.3
 * stayed 1.13.2 under core 1.6.12's `~1.13.2`, so an updated project gave a `#>` label to the wrong
 * block while a new one didn't. These hold the readings the lift is built on.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { lockedUniwebPackages, liftCommand, liftMoves } from '../src/utils/lockfile-uniweb.js'

const workspace = (files) => {
  const dir = mkdtempSync(join(tmpdir(), 'uniweb-lift-'))
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text)
  return dir
}

test('a pnpm lockfile gives each @uniweb package with every version it holds, and nothing else', () => {
  const dir = workspace({
    'pnpm-lock.yaml': [
      "lockfileVersion: '9.0'",
      'packages:',
      "  '@uniweb/core@1.6.12':",
      '    resolution: {integrity: sha512-a}',
      "  '@uniweb/semantic-parser@1.13.3':",
      '    resolution: {integrity: sha512-b}',
      "  '@uniweb/semantic-parser@1.13.2':",
      '    resolution: {integrity: sha512-c}',
      '  uniweb@1.31.13:',
      '    resolution: {integrity: sha512-d}',
      '  react@19.3.0:',
      '    resolution: {integrity: sha512-e}',
      '',
    ].join('\n'),
  })
  const held = lockedUniwebPackages(dir, 'pnpm')
  assert.deepEqual([...held.entries()], [
    ['@uniweb/core', ['1.6.12']],
    ['@uniweb/semantic-parser', ['1.13.2', '1.13.3']],
  ])
})

test('an older pnpm lockfile, with a slash and a peer suffix on its keys, reads the same', () => {
  const dir = workspace({
    'pnpm-lock.yaml': [
      "lockfileVersion: '6.0'",
      'packages:',
      '  /@uniweb/kit@1.7.18(react@19.3.0):',
      '    resolution: {integrity: sha512-a}',
      '  /react@19.3.0:',
      '    resolution: {integrity: sha512-b}',
      '',
    ].join('\n'),
  })
  assert.deepEqual([...lockedUniwebPackages(dir, 'pnpm').entries()], [['@uniweb/kit', ['1.7.18']]])
})

test('an npm lockfile gives nested copies too, and never a workspace link', () => {
  const dir = workspace({
    'package-lock.json': JSON.stringify({
      lockfileVersion: 3,
      packages: {
        '': { name: 'site-project' },
        site: { name: 'site', version: '0.0.0' },
        'node_modules/site': { resolved: 'site', link: true },
        'node_modules/@uniweb/core': { version: '1.6.12' },
        'node_modules/@uniweb/semantic-parser': { version: '1.13.2' },
        'node_modules/@uniweb/build/node_modules/@uniweb/semantic-parser': { version: '1.13.3' },
        'node_modules/uniweb': { version: '1.31.13' },
      },
    }),
  })
  assert.deepEqual([...lockedUniwebPackages(dir, 'npm').entries()], [
    ['@uniweb/core', ['1.6.12']],
    ['@uniweb/semantic-parser', ['1.13.2', '1.13.3']],
  ])
})

test('no lockfile, one that does not parse, or yarn: nothing to lift with', () => {
  assert.equal(lockedUniwebPackages(workspace({}), 'pnpm'), null)
  assert.equal(lockedUniwebPackages(workspace({ 'package-lock.json': '{ not json' }), 'npm'), null)
  assert.equal(lockedUniwebPackages(workspace({ 'yarn.lock': '# yarn lockfile v1\n' }), 'yarn'), null)
})

// ⛔ pnpm's is `dedupe`, not `update <names> -r`: that resolves every dependency again, and a local
// `file:` foundation declaring a peer its site lacks came back as a copy `uniweb dev` never refreshed.
test('the lift keeps to the ranges, everywhere the workspace holds a package, and re-resolves nothing else', () => {
  const names = ['@uniweb/core', '@uniweb/semantic-parser']
  assert.equal(liftCommand('pnpm', names), 'pnpm dedupe')
  assert.equal(liftCommand('npm', names), 'npm update @uniweb/core @uniweb/semantic-parser')
  for (const pm of ['pnpm', 'npm']) assert.doesNotMatch(liftCommand(pm, names), /--latest|-L\b/)
  assert.equal(liftCommand('yarn', names), null)
  assert.equal(liftCommand('pnpm', []), null)
})

test('what moved: each package whose versions changed, and none that stayed', () => {
  const before = new Map([
    ['@uniweb/core', ['1.6.11', '1.6.12']],
    ['@uniweb/kit', ['1.7.18']],
    ['@uniweb/semantic-parser', ['1.13.2']],
  ])
  const after = new Map([
    ['@uniweb/core', ['1.6.12']],
    ['@uniweb/kit', ['1.7.18']],
    ['@uniweb/semantic-parser', ['1.13.3']],
  ])
  assert.deepEqual(liftMoves(before, after), [
    { name: '@uniweb/core', from: ['1.6.11', '1.6.12'], to: ['1.6.12'] },
    { name: '@uniweb/semantic-parser', from: ['1.13.2'], to: ['1.13.3'] },
  ])
  assert.deepEqual(liftMoves(after, after), [])
})
