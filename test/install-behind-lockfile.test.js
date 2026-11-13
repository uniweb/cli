/**
 * `installBehindLockfile` (`src/utils/lockfile-uniweb.js`): which of the framework's packages the
 * last install did not put in node_modules as the lockfile holds them.
 *
 * ⛔ The case it exists for: a `git pull` brought a teammate's `uniweb update`, so package.json and
 * the lockfile name the new versions and node_modules still holds the old ones. `update` found the
 * declared versions aligned and installed nothing, so the copy went on running the old CLI
 * (measured 2026-11-13, on a project a teammate's update had moved to 1.34.10).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { installBehindLockfile, lockedUniwebPackages } from '../src/utils/lockfile-uniweb.js'

const write = (dir, rel, text) => {
  mkdirSync(dirname(join(dir, rel)), { recursive: true })
  writeFileSync(join(dir, rel), text)
}

// A pnpm v9 lockfile's `packages:`, by `name@version`.
const pnpmLock = (pkgs) =>
  "lockfileVersion: '9.0'\npackages:\n" +
  pkgs.map((id) => `  '${id}':\n    resolution: {integrity: sha512-x}\n`).join('')

// An npm lockfile's `packages:`, by `node_modules/<name>`.
const npmLock = (pkgs) =>
  JSON.stringify({
    lockfileVersion: 3,
    packages: { '': { name: 'p' }, ...Object.fromEntries(Object.entries(pkgs).map(([n, v]) => [`node_modules/${n}`, { version: v }])) }
  })

test('⭐ pnpm: a pull moved the lockfile to a new CLI and node_modules kept the old one', () => {
  const dir = mkdtempSync(join(tmpdir(), 'behind-'))
  try {
    write(dir, 'pnpm-lock.yaml', pnpmLock(['uniweb@1.34.10', '@uniweb/build@1.23.8', 'react@19.3.0']))
    write(dir, 'node_modules/.pnpm/lock.yaml', pnpmLock(['uniweb@1.34.9', '@uniweb/build@1.23.8', 'react@19.2.0']))
    assert.deepEqual(installBehindLockfile(dir, 'pnpm'), [{ name: 'uniweb', locked: ['1.34.10'], installed: ['1.34.9'] }])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('CONTROL — the same versions on both sides is nothing to install', () => {
  const dir = mkdtempSync(join(tmpdir(), 'behind-'))
  try {
    const lock = pnpmLock(['uniweb@1.34.10', '@uniweb/build@1.23.8'])
    write(dir, 'pnpm-lock.yaml', lock)
    write(dir, 'node_modules/.pnpm/lock.yaml', lock)
    assert.deepEqual(installBehindLockfile(dir, 'pnpm'), [])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('npm: its hidden lockfile is read as the lockfile is', () => {
  const dir = mkdtempSync(join(tmpdir(), 'behind-'))
  try {
    write(dir, 'package-lock.json', npmLock({ uniweb: '1.34.10', '@uniweb/core': '1.7.0' }))
    write(dir, 'node_modules/.package-lock.json', npmLock({ uniweb: '1.34.9', '@uniweb/core': '1.7.0' }))
    assert.deepEqual(installBehindLockfile(dir, 'npm'), [{ name: 'uniweb', locked: ['1.34.10'], installed: ['1.34.9'] }])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('what it cannot read it does not guess: no install yet, or yarn', () => {
  const dir = mkdtempSync(join(tmpdir(), 'behind-'))
  try {
    write(dir, 'pnpm-lock.yaml', pnpmLock(['uniweb@1.34.10']))
    assert.equal(installBehindLockfile(dir, 'pnpm'), null)
    assert.equal(installBehindLockfile(dir, 'yarn'), null)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('CONTROL — the lift still reads only the @uniweb packages, never the CLI itself', () => {
  const dir = mkdtempSync(join(tmpdir(), 'behind-'))
  try {
    write(dir, 'pnpm-lock.yaml', pnpmLock(['uniweb@1.34.10', '@uniweb/build@1.23.8']))
    assert.deepEqual([...lockedUniwebPackages(dir, 'pnpm').keys()], ['@uniweb/build'])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
