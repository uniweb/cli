// ⭐ PUBLISH SENDS THE LANGUAGES THE BUILD PRODUCED. A site that declares no `languages:` has the
// languages its translation files make, and the build produces each (`dist/<locale>/`); publish sent
// `['en']` for it, since the built `config.languages` is absent.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { languagesFromContent } from '../src/commands/publish.js'

function dist(locales) {
  const dir = mkdtempSync(join(tmpdir(), 'uniweb-publish-langs-'))
  writeFileSync(join(dir, 'site-content.json'), '{}')
  for (const l of locales) {
    mkdirSync(join(dir, l), { recursive: true })
    writeFileSync(join(dir, l, 'site-content.json'), '{}')
  }
  mkdirSync(join(dir, 'data'), { recursive: true }) // not a language: no site-content.json
  return dir
}

test('⭐ a site that declares no languages: its default and each language the build produced', () => {
  const dir = dist(['fr', 'es'])
  try {
    assert.deepEqual(languagesFromContent({ config: { defaultLanguage: 'en' } }, dir), ['en', 'es', 'fr'])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('CONTROL — declared languages are sent as declared', () => {
  const dir = dist(['es', 'fr'])
  try {
    assert.deepEqual(languagesFromContent({ config: { languages: ['en', { value: 'es' }] } }, dir), ['en', 'es'])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a site with one language, and none declared: its default', () => {
  const dir = dist([])
  try {
    assert.deepEqual(languagesFromContent({ config: { defaultLanguage: 'fr' } }, dir), ['fr'])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
