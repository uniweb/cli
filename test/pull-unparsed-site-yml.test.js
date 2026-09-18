import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import yaml from 'js-yaml'

// A site.yml that EXISTS and carries `$uuid:` but does not PARSE was reported as
// "this project has no $uuid yet. Run `uniweb push` first." — wrong, and harmful
// on a cloned site: push would send an empty tree at the uuid the file holds.
// The user greps the file, sees the uuid, and disbelieves the CLI.
//
// This asserts the DISCRIMINATION, at the same seam pull reads: text present and
// unparseable must not look like absence. Reported by the backend lane 2026-09-18.

function readYamlUuid(text) {
  let obj
  try {
    obj = yaml.load(text)
  } catch (err) {
    return { uuid: null, unparsed: err.message.split('\n')[0] }
  }
  return { uuid: typeof obj?.$uuid === 'string' ? obj.$uuid : null }
}

test('an unparseable site.yml is an ERROR, not "no $uuid yet"', () => {
  // The documented prior cause: a plain `@…` scalar, which YAML reserves.
  const bad = 'name: site\n$uuid: SITE-1\nfoundation: @acme/base@1.0.0\n'
  const r = readYamlUuid(bad)
  assert.ok(r.unparsed, 'a parse failure must be reported as such')
  assert.equal(r.uuid, null)
})

test('a duplicate key is caught the same way', () => {
  const dup = 'name: site\n$uuid: SITE-1\n$uuid: SITE-2\n'
  const r = readYamlUuid(dup)
  assert.ok(r.unparsed, 'duplicate keys must not read as absence')
})

test('CONTROL — a parseable file with $uuid returns it and flags nothing', () => {
  const ok = "name: site\n$uuid: SITE-1\nfoundation: '@acme/base@1.0.0'\n"
  const r = readYamlUuid(ok)
  assert.equal(r.uuid, 'SITE-1')
  assert.equal(r.unparsed, undefined)
})

test('CONTROL — a parseable file with no $uuid is a genuine absence', () => {
  const r = readYamlUuid('name: site\n')
  assert.equal(r.uuid, null)
  assert.equal(r.unparsed, undefined)
})
