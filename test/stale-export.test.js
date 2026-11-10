/**
 * A @uniweb/* package older than the CLI, read off the error Node throws (`src/utils/stale-export.js`).
 * The failure is made for real here, so a change in Node's wording fails this test rather than
 * leaving the CLI with its raw message.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { staleFrameworkExport } from '../src/utils/stale-export.js'

/** A module importing `name` from a package that does not export it; what importing it throws. */
async function importFailure(pkg, name) {
  const dir = mkdtempSync(join(tmpdir(), 'uniweb-stale-'))
  try {
    const at = join(dir, 'node_modules', ...pkg.split('/'))
    mkdirSync(at, { recursive: true })
    writeFileSync(join(at, 'package.json'), JSON.stringify({ name: pkg, type: 'module', exports: { '.': './index.js', './site': './site.js' } }))
    writeFileSync(join(at, 'index.js'), 'export const present = 1\n')
    writeFileSync(join(at, 'site.js'), 'export const present = 1\n')
    writeFileSync(join(dir, 'command.js'), `import { ${name} } from '${pkg}'\nimport { ${name} as b } from '${pkg}/site'\nexport { ${name}, b }\n`)
    return await import(pathToFileURL(join(dir, 'command.js'))).then(() => null, (e) => e)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('⭐ a missing export of a framework package names the package and the export', async () => {
  const err = await importFailure('@uniweb/build', 'librariesOf')
  assert.ok(err, 'the import succeeded')
  assert.deepEqual(staleFrameworkExport(err), { pkg: '@uniweb/build', name: 'librariesOf' })
})

test('CONTROL: another package, or another kind of failure, is not this one', async () => {
  const other = await importFailure('left-pad', 'pad')
  assert.equal(staleFrameworkExport(other), null)
  assert.equal(staleFrameworkExport(new Error("module '@uniweb/build' does not provide an export named 'x'")), null)
  assert.equal(staleFrameworkExport(Object.assign(new Error('Cannot find package'), { code: 'ERR_MODULE_NOT_FOUND' })), null)
})
