/**
 * `uniweb doctor` — the foundation's default section type: what renders a section that names none.
 *
 * Said in every case, from the built schema.json: declared, the fallback, or none. "None" is a fact,
 * never a warning — many vocabularies have no natural default — and only a declared `defaultSection`
 * naming no type is warned. Where one type stands out, it is suggested.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkDefaultSection } from '../src/commands/doctor.js'

/** A foundation with a built schema.json holding these section types and this `_self`. */
function foundation(sections, self = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'uniweb-default-section-'))
  const schema = { _self: { name: 'acme', version: '1.0.0', ...self } }
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
    const result = checkDefaultSection({ foundationName: 'acme', folderName: 'src', foundationDir: dir, issues })
    return { result, issues }
  } finally {
    console.log = log
  }
}

test('a declared default that is one of its types: said, and nothing to fix', () => {
  const { result, issues } = check(foundation({ Article: {}, Hero: {} }, { defaultSection: 'Article' }))
  assert.deepEqual(result, { type: 'Article', declared: true, exists: true })
  assert.deepEqual(issues, [])
})

test('no declared default, and a type named Section: the fallback, said as that', () => {
  const { result, issues } = check(foundation({ Section: {}, Hero: {} }))
  assert.deepEqual(result, { type: 'Section', declared: false, exists: true })
  assert.deepEqual(issues, [])
})

test('⭐ no declared default and no type named Section: none, said as a fact — not a warning — with the one prose type suggested', () => {
  const { result, issues } = check(foundation({ Hero: {}, Story: { family: 'article' }, Header: {} }))
  assert.deepEqual(result, { type: null, declared: false, exists: false })
  assert.equal(issues.length, 1)
  assert.equal(issues[0].id, 'default-section-none')
  assert.equal(issues[0].type, 'info')
  assert.equal(issues[0].suggested, 'Story')
})

test('a declared default naming no type: a warning, with the type it was likely meant to name', () => {
  const { issues } = check(foundation({ Article: {}, Hero: {} }, { defaultSection: 'article' }))
  assert.equal(issues[0].id, 'default-section-missing')
  assert.equal(issues[0].type, 'warn')
  assert.equal(issues[0].suggested, 'Article')
})

test('no single type stands out: nothing suggested', () => {
  const { issues } = check(foundation({ Story: { family: 'article' }, Notes: { family: 'rich-text' } }))
  assert.equal(issues[0].id, 'default-section-none')
  assert.equal(issues[0].suggested, undefined)
})

test('CONTROL — nothing built: nothing said', () => {
  const dir = mkdtempSync(join(tmpdir(), 'uniweb-default-section-'))
  assert.equal(check(dir).result, null)
})
