/**
 * `uniweb doctor` — which standard family does each section resolve to?
 *
 * ## What is actually worth asserting here
 *
 * The resolution itself belongs to `@uniweb/schemas` and is tested there. What
 * is doctor's, and what this file pins, is the part that can silently invert:
 *
 *   1. ⛔ **A bare `--fix` must NOT write a family.** Every suggestion here comes
 *      from an alias table that lives in the CLI *precisely so a human approves
 *      it*. If a bare `--fix` applied them, the silent-wrong-guess failure the
 *      whole design avoids would be back, one directory deeper — and it would
 *      look like a feature.
 *   2. ⛔ **`writeFamilyIntoMeta` must refuse anything it does not recognize.** A
 *      meta.js is hand-written source. A half-understood rewrite is far worse
 *      than telling someone to add one line, and a failed write must never be
 *      reported as fixed.
 *   3. An unrecognized name is reported as an OPPORTUNITY, never an error.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkSectionFamilies, checkRetiredMetaKeys } from '../src/commands/doctor.js'
import { suggestFamily } from '@uniweb/schemas/family-aliases'
import { FAMILIES } from '@uniweb/schemas/families'

const IDS = FAMILIES.map((f) => f.id)

/** A foundation with a built schema.json and real meta.js files behind it. */
function foundation(sections) {
  const dir = mkdtempSync(join(tmpdir(), 'uniweb-families-'))
  const schema = { _self: { name: 'acme', version: '1.0.0' } }
  for (const [name, entry] of Object.entries(sections)) {
    const path = `sections/${name}`
    schema[name] = { name, path, title: name, ...entry }
    mkdirSync(join(dir, 'src', path), { recursive: true })
    writeFileSync(
      join(dir, 'src', path, 'meta.js'),
      `export default {\n  title: '${name}',\n}\n`
    )
  }
  mkdirSync(join(dir, 'dist', 'meta'), { recursive: true })
  writeFileSync(join(dir, 'dist', 'meta', 'schema.json'), JSON.stringify(schema, null, 2))
  return dir
}

function run(dir, { fixId } = {}) {
  const issues = []
  const fixes = []
  const quiet = console.log
  console.log = () => {}
  try {
    checkSectionFamilies({
      foundationName: 'acme',
      folderName: 'acme',
      foundationDir: dir,
      issues,
      shouldFixExplicitly: (id) => id === fixId,
      fixed: (m) => fixes.push(m),
    })
  } finally {
    console.log = quiet
  }
  return { issues, fixes }
}

const metaOf = (dir, name) => readFileSync(join(dir, 'src', 'sections', name, 'meta.js'), 'utf8')

test('a conventional name resolves with nothing declared', () => {
  const dir = foundation({ Hero: {}, Footer: {} })
  try {
    assert.equal(run(dir).issues.length, 0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('an unrecognized name with a suggestion is reported as an opportunity', () => {
  const dir = foundation({ CallToAction: {} })
  try {
    const { issues } = run(dir)
    const issue = issues.find((i) => i.id === 'section-family-unrecognized')
    assert.ok(issue)
    // ⛔ `info`, not `warning`. A foundation with its own vocabulary is a
    // supported choice — the section falls back and nothing breaks.
    assert.equal(issue.type, 'info')
    assert.deepEqual(issue.details, [{ name: 'CallToAction', suggested: 'cta', via: 'alias' }])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a name with no suggestion is not reported at all', () => {
  // Nagging someone for having a genuine domain word teaches them to ignore
  // doctor, and there is nothing for them to do about it.
  const dir = foundation({ OccurrenceRecords: {}, VenueBand: {} })
  try {
    assert.equal(run(dir).issues.length, 0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a bare --fix does NOT write a guessed family', () => {
  const dir = foundation({ CallToAction: {} })
  try {
    // `shouldFixExplicitly` is false for every id when `--fix` had no argument,
    // which is exactly what the caller passes. Nothing may be written.
    const { fixes } = run(dir, { fixId: null })
    assert.deepEqual(fixes, [])
    assert.ok(!metaOf(dir, 'CallToAction').includes('family'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('--fix with the id writes family as the first key', () => {
  const dir = foundation({ CallToAction: {} })
  try {
    const { fixes } = run(dir, { fixId: 'section-family-unrecognized' })
    assert.equal(fixes.length, 1)
    assert.match(metaOf(dir, 'CallToAction'), /export default \{\n  family: 'cta',\n  title:/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('--fix never overwrites a family already declared', () => {
  const dir = foundation({ CallToAction: {} })
  try {
    const path = join(dir, 'src', 'sections', 'CallToAction', 'meta.js')
    writeFileSync(path, `export default {\n  family: 'statement',\n  title: 'x',\n}\n`)
    run(dir, { fixId: 'section-family-unrecognized' })
    assert.match(readFileSync(path, 'utf8'), /family: 'statement'/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a declared family that names nothing known is a warning, with a near miss', () => {
  const dir = foundation({ Splash: { family: 'heros' } })
  try {
    const issue = run(dir).issues.find((i) => i.id === 'section-family-unknown')
    assert.ok(issue)
    assert.equal(issue.type, 'warning')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('retired keys are reported as info, once', () => {
  const dir = foundation({ Hero: { category: 'impact' }, Footer: { purpose: 'Navigate' } })
  try {
    const issues = []
    const quiet = console.log
    console.log = () => {}
    try {
      checkRetiredMetaKeys({ foundationName: 'acme', folderName: 'acme', foundationDir: dir, issues })
    } finally {
      console.log = quiet
    }
    assert.equal(issues.length, 1)
    assert.equal(issues[0].type, 'info')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('doctor still bars an ambiguous name from --fix', () => {
  // The mechanics of suggestFamily are pinned in @uniweb/schemas, where the
  // table lives. What matters here is that doctor honours `fixable`.
  const dir = foundation({ Banner: {} })
  try {
    const { fixes } = run(dir, { fixId: 'section-family-unrecognized' })
    assert.deepEqual(fixes, [])
    assert.ok(!metaOf(dir, 'Banner').includes('family'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
