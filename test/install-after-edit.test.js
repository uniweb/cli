/**
 * The install a command runs right after it edited package.json files is never frozen
 * (`installAfterEditCmd`, `src/utils/pm.js`), which `uniweb update` runs and prints.
 *
 * ⛔ Until 2026-11-10 `update` ran a plain `pnpm install`. Wherever `CI` is set, pnpm makes that
 * frozen, and a frozen install refuses the package.json the command just wrote: with `CI=1`,
 * `uniweb update --yes` failed at its install every time, and so did the retry it printed.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { installAfterEditCmd, installCmd } from '../src/utils/pm.js'

test('after an edit, pnpm installs unfrozen; npm and yarn as ever', () => {
  assert.equal(installAfterEditCmd('pnpm'), 'pnpm install --no-frozen-lockfile')
  assert.equal(installAfterEditCmd('npm'), installCmd('npm'))
  assert.equal(installAfterEditCmd('yarn'), installCmd('yarn'))
})

const hasPnpm = spawnSync('pnpm', ['--version'], { encoding: 'utf8' }).status === 0

test('⭐ with CI set, pnpm refuses an edited package.json on a plain install and takes it on this one', { skip: !hasPnpm && 'pnpm is not installed' }, () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'uniweb-install-edit-')))
  // Offline: the dependencies are folders beside it. ⚠️ The lockfile must hold one already, as a
  // project's does: pnpm doesn't freeze an install over a lockfile with none.
  // A shell's own environment, not a parent pnpm's: `pnpm -s test` hands down a silent log level,
  // under which pnpm refuses without saying why.
  const shell = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^npm_/i.test(key)))
  const pnpm = (cmd) => spawnSync('sh', ['-c', cmd], { cwd: dir, encoding: 'utf8', env: { ...shell, CI: '1' } })
  const manifest = (dependencies) => writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'edited', private: true, dependencies }))
  try {
    for (const name of ['lib', 'lib2']) {
      mkdirSync(join(dir, name))
      writeFileSync(join(dir, name, 'package.json'), JSON.stringify({ name, version: '1.0.0' }))
    }
    manifest({ lib: 'file:./lib' })
    assert.equal(pnpm('pnpm install --no-frozen-lockfile').status, 0, 'the first install writes a lockfile')
    // What `update` does before its install: it edits a package.json.
    manifest({ lib: 'file:./lib', lib2: 'file:./lib2' })
    const plain = pnpm(installCmd('pnpm'))
    assert.notEqual(plain.status, 0, 'CONTROL: a plain install under CI is frozen and refuses the edit')
    assert.match(plain.stdout + plain.stderr, /frozen-lockfile|OUTDATED_LOCKFILE/)
    assert.equal(pnpm(installAfterEditCmd('pnpm')).status, 0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
