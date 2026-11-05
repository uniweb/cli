/**
 * `uniweb doctor` — a `header` or `footer` type that could name its area (`area: 'header'`),
 * suggested and never applied.
 *
 * A family claims a type's shape, not where it goes, so it never places a type; it is only why doctor
 * asks. A type that already says `area` or `section`, either way, has decided. The area suggested is
 * the one the family is named for, unless the foundation's layouts all declare their areas and none
 * is called that: then `true`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkAreaTypes } from '../src/commands/doctor.js'

function foundation(sections, layouts) {
  const dir = mkdtempSync(join(tmpdir(), 'uniweb-area-'))
  const schema = { _self: { name: 'acme', version: '1.0.0' }, ...(layouts && { _layouts: layouts }) }
  for (const [name, entry] of Object.entries(sections)) schema[name] = { name, path: `sections/${name}`, ...entry }
  mkdirSync(join(dir, 'dist', 'meta'), { recursive: true })
  writeFileSync(join(dir, 'dist', 'meta', 'schema.json'), JSON.stringify(schema))
  return dir
}
function check(dir) {
  const issues = []
  const lines = []
  const log = console.log
  console.log = (...args) => lines.push(args.join(' '))
  try {
    return { suggested: checkAreaTypes({ foundationName: 'acme', folderName: 'src', foundationDir: dir, issues }), issues, lines }
  } finally {
    console.log = log
  }
}

test('⭐ a header and a footer, by name or declared family, are suggested the area they are named for', () => {
  const { suggested, issues } = check(foundation({ Header: {}, SiteBottom: { family: 'footer' }, Hero: {}, Article: {} }))
  assert.deepEqual(suggested, [{ type: 'Header', area: 'header' }, { type: 'SiteBottom', area: 'footer' }])
  assert.equal(issues[0].type, 'info')
  assert.equal(issues[0].message, "Header could say area: 'header', SiteBottom area: 'footer'")
})

test("where every layout declares its areas and none is the family's, the suggestion is any area", () => {
  const layouts = { Docs: { name: 'Docs', areas: ['top', 'footer'] } }
  assert.deepEqual(check(foundation({ Header: {}, Footer: {} }, layouts)).suggested, [
    { type: 'Header', area: true },
    { type: 'Footer', area: 'footer' },
  ])
  // A layout that declares no areas could draw any, so the family's name stands.
  assert.deepEqual(check(foundation({ Header: {} }, { ...layouts, Plain: { name: 'Plain' } })).suggested, [{ type: 'Header', area: 'header' }])
})

test('a type that says area or section, either way, has decided', () => {
  assert.deepEqual(check(foundation({ Header: { area: 'header' }, Footer: { section: true }, Top: { family: 'header', area: true } })).suggested, [])
  assert.deepEqual(check(foundation({ Header: { area: false } })).suggested, [])
})

test("a toc or pathways type is not suggested: it is as often a page's own section", () => {
  assert.deepEqual(check(foundation({ Toc: {}, Pathways: {} })).suggested, [])
})

test('an inset is not suggested', () => {
  assert.deepEqual(check(foundation({ Header: { inset: true } })).suggested, [])
})
