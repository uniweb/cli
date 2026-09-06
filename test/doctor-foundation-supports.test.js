/**
 * `uniweb doctor` — is `package.json` behind what the build derived?
 *
 * ## ⛔ WHAT THIS FILE USED TO TEST, AND WHY IT PROVED NOTHING
 *
 * The old check regexed `sections/`, `layouts/` and `components/` for four
 * spellings of a service call. This suite fed it a source string containing
 * `resolveService(block.website, 'search')` — written to match that regex — and
 * was green while the check was silent on `templates/services`, the template
 * written to demonstrate the feature, because `useFormSubmit()` was not one of
 * the four. **A fixture authored to match the matcher can only confirm that the
 * matcher matches itself.**
 *
 * The derivation now happens in `@uniweb/build` off the module graph, and is
 * tested there against real parsed framework source
 * (`build/tests/derive-supports.test.js`). What is left for `doctor` is
 * narrower and is what this file tests: **does it faithfully report the gap
 * between the built artifact and `package.json`, and does `--fix` close it?**
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkFoundationSupports } from '../src/commands/doctor.js'

/** A foundation directory with an optional built schema and package.json. */
function foundation({ supports, derived }) {
  const dir = mkdtempSync(join(tmpdir(), 'uniweb-supports-'))
  const pkg = { name: 'acme-foundation', version: '1.0.0' }
  if (supports !== undefined) pkg.uniweb = { supports }
  writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg, null, 2) + '\n')

  if (derived !== undefined) {
    mkdirSync(join(dir, 'dist', 'meta'), { recursive: true })
    const schema = { _self: { name: 'acme', version: '1.0.0' } }
    if (derived !== null) schema._self.supports = derived
    writeFileSync(join(dir, 'dist', 'meta', 'schema.json'), JSON.stringify(schema, null, 2))
  }
  return { dir, pkg }
}

async function run({ supports, derived, fix = false }) {
  const { dir } = foundation({ supports, derived })
  const issues = []
  const fixes = []
  try {
    await checkFoundationSupports({
      foundationName: 'acme',
      folderName: 'foundation',
      foundationDir: dir,
      pkg: JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')),
      issues,
      shouldFix: () => fix,
      fixed: (m) => fixes.push(m),
    })
    const after = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
    return { ids: issues.map((i) => i.id), issues, fixes, after }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('says nothing when the foundation has never been built', async () => {
  // Nothing has been measured, so there is no gap to name and a guess would be
  // worse than silence.
  const { ids } = await run({ supports: undefined, derived: undefined })
  assert.deepEqual(ids, [])
})

test('says nothing when the build derived nothing', async () => {
  assert.deepEqual((await run({ supports: undefined, derived: [] })).ids, [])
})

test('says nothing when the build reported UNKNOWN (a computed name)', async () => {
  // `_self.supports` absent means the derivation was blind. Absent is not `[]`,
  // and neither is a gap in the file.
  assert.deepEqual((await run({ supports: undefined, derived: null })).ids, [])
})

test('says nothing when the file already lists what the build derived', async () => {
  assert.deepEqual((await run({ supports: ['submit'], derived: ['submit'] })).ids, [])
})

test('says nothing when the file lists MORE than the build could see', async () => {
  // The computed-name case: `booking` is invisible to the graph and only the
  // author knows it. Reporting a gap here would invite deleting a true
  // declaration — the one outcome this whole mechanism exists to prevent.
  assert.deepEqual((await run({ supports: ['booking', 'submit'], derived: ['submit'] })).ids, [])
})

test('flags a derived service the file does not declare', async () => {
  const { ids, issues } = await run({ supports: undefined, derived: ['submit'] })
  assert.deepEqual(ids, ['foundation-supports-incomplete'])
  assert.deepEqual(issues[0].details.derived, ['submit'])
  assert.equal(issues[0].details.declared, null)
})

test('flags the gap when the file declares only some of it', async () => {
  const { ids, issues } = await run({ supports: ['search'], derived: ['search', 'submit'] })
  assert.deepEqual(ids, ['foundation-supports-incomplete'])
  assert.deepEqual(issues[0].details.declared, ['search'])
})

test('--fix writes the union into package.json and reports no issue', async () => {
  const { ids, fixes, after } = await run({
    supports: ['booking'],
    derived: ['submit'],
    fix: true,
  })
  assert.deepEqual(ids, [])
  assert.equal(fixes.length, 1)
  // The union, so what the author knew and the graph could not see survives.
  assert.deepEqual(after.uniweb.supports, ['booking', 'submit'])
})

test('--fix creates the uniweb block when there is none', async () => {
  const { after } = await run({ supports: undefined, derived: ['search', 'submit'], fix: true })
  assert.deepEqual(after.uniweb.supports, ['search', 'submit'])
})

test('--fix keeps the rest of package.json intact', async () => {
  const { after } = await run({ supports: undefined, derived: ['submit'], fix: true })
  assert.equal(after.name, 'acme-foundation')
  assert.equal(after.version, '1.0.0')
})
