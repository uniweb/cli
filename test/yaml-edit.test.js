/**
 * In-place YAML edits keep everything but the one value
 *
 * `uniweb rename` changes one key in a `site.yml` a person wrote. It used to
 * load the file and dump it back, which dropped every comment and re-flowed
 * lists and long strings. These pin the replacement: the rest of the file is
 * byte-for-byte what it was, and a value the edit cannot reach is refused
 * (null) rather than guessed at.
 *
 * Run: `pnpm test` or `node --test test/`
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { replaceInTopLevelList, setTopLevelScalar } from '../src/utils/yaml-edit.js'

const SITE = `# The sample site
name: Research Profile
description: A researcher's site with a profile, research projects, a full publication list and the team.
tags: [academic, personal]

# Foundation to use for this site
foundation: src

# Homepage
index: home
`

test('setTopLevelScalar changes one line and nothing else', () => {
  const after = setTopLevelScalar(SITE, 'foundation', 'research-profile')
  assert.equal(after, SITE.replace('foundation: src', 'foundation: research-profile'))
})

test('setTopLevelScalar keeps the inline comment on the line it edits', () => {
  const text = 'name: x\nfoundation: src   # the local one\n'
  assert.equal(
    setTopLevelScalar(text, 'foundation', 'product-launch'),
    'name: x\nfoundation: product-launch   # the local one\n'
  )
})

test('setTopLevelScalar quotes a value YAML cannot leave plain', () => {
  const after = setTopLevelScalar(SITE, 'foundation', '@acme/site')
  assert.match(after, /^foundation: '@acme\/site'$/m)
})

test('setTopLevelScalar refuses a value it cannot edit in place', () => {
  // A block scalar spans lines: replacing the key line would leave `src` behind.
  assert.equal(setTopLevelScalar('name: x\nfoundation: >-\n  src\n', 'foundation', 'y'), null)
  assert.equal(setTopLevelScalar('name: x\n', 'foundation', 'y'), null)
  assert.equal(setTopLevelScalar('not: [valid', 'foundation', 'y'), null)
})

const EXT = '/extensions/effects/dist/entry.js'
const NEW = '/extensions/visual-effects/dist/entry.js'

test('replaceInTopLevelList edits block entries and leaves comments alone', () => {
  const text = `name: x
# ${EXT} is the effects extension
extensions:
  - ${EXT}   # particle hero
  - https://cdn.example.com/other.js
`
  const after = replaceInTopLevelList(text, 'extensions', new Map([[EXT, NEW]]))
  assert.equal(
    after,
    `name: x
# ${EXT} is the effects extension
extensions:
  - ${NEW}   # particle hero
  - https://cdn.example.com/other.js
`
  )
})

test('replaceInTopLevelList edits a one-line flow list and quoted entries', () => {
  assert.equal(
    replaceInTopLevelList(`extensions: [${EXT}, '/x.js']\n`, 'extensions', new Map([[EXT, NEW]])),
    `extensions: [${NEW}, '/x.js']\n`
  )
  assert.equal(
    replaceInTopLevelList(`extensions:\n  - "${EXT}"\n`, 'extensions', new Map([[EXT, NEW]])),
    `extensions:\n  - "${NEW}"\n`
  )
})

test('replaceInTopLevelList does not touch a value that only contains the old one', () => {
  const other = `/nested${EXT}`
  const text = `extensions:\n  - ${EXT}\n  - ${other}\n`
  assert.equal(
    replaceInTopLevelList(text, 'extensions', new Map([[EXT, NEW]])),
    `extensions:\n  - ${NEW}\n  - ${other}\n`
  )
})

test('replaceInTopLevelList refuses when the key is not a list', () => {
  assert.equal(replaceInTopLevelList('extensions: nope\n', 'extensions', new Map([[EXT, NEW]])), null)
  assert.equal(replaceInTopLevelList('name: x\n', 'extensions', new Map([[EXT, NEW]])), null)
})
