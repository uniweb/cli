/**
 * `uniweb doctor` — a `header` or `footer` type that could say `area: true`, suggested and never applied.
 *
 * A family claims a type's shape, not where it goes, so it never places a type; it is only why doctor
 * asks. A type that already says `area` or `section`, either way, has decided.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkAreaTypes } from '../src/commands/doctor.js'

function foundation(sections) {
  const dir = mkdtempSync(join(tmpdir(), 'uniweb-area-'))
  const schema = { _self: { name: 'acme', version: '1.0.0' } }
  for (const [name, entry] of Object.entries(sections)) schema[name] = { name, path: `sections/${name}`, ...entry }
  mkdirSync(join(dir, 'dist', 'meta'), { recursive: true })
  writeFileSync(join(dir, 'dist', 'meta', 'schema.json'), JSON.stringify(schema))
  return dir
}
function check(dir) {
  const issues = []
  const log = console.log
  console.log = () => {}
  try {
    return { suggested: checkAreaTypes({ foundationName: 'acme', folderName: 'src', foundationDir: dir, issues }), issues }
  } finally {
    console.log = log
  }
}

test('⭐ a header and a footer, by name or declared family, are suggested area: true', () => {
  const { suggested, issues } = check(foundation({ Header: {}, SiteBottom: { family: 'footer' }, Hero: {}, Article: {} }))
  assert.deepEqual(suggested, ['Header', 'SiteBottom'])
  assert.equal(issues[0].type, 'info')
})

test('a type that says area or section, either way, has decided', () => {
  assert.deepEqual(check(foundation({ Header: { area: true }, Footer: { section: true } })).suggested, [])
  assert.deepEqual(check(foundation({ Header: { area: false } })).suggested, [])
})

test('a toc or pathways type is not suggested: it is as often a page\'s own section', () => {
  assert.deepEqual(check(foundation({ Toc: {}, Pathways: {} })).suggested, [])
})

test('an inset is not suggested', () => {
  assert.deepEqual(check(foundation({ Header: { inset: true } })).suggested, [])
})
