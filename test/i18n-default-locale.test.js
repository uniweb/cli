/**
 * The default language is the source, never a translation: `uniweb i18n status` and
 * `uniweb i18n audit` report on the other languages only, however `site.yml` lists them.
 *
 * ⛔ A declared `languages: [en, es]` lists the default, and both reported it as a language
 * with no translation file — "75 strings need translation" — on every site that spelled its
 * languages out.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const CLI = join(dirname(dirname(fileURLToPath(import.meta.url))), 'src/index.js')

function run(args) {
  try {
    return { code: 0, out: execFileSync('node', [CLI, ...args], { encoding: 'utf8', stdio: 'pipe' }) }
  } catch (err) {
    return { code: err.status ?? 1, out: err.stdout || '', err: err.stderr || '' }
  }
}

/** A site in English and Spanish, its one page string translated. */
function site(languages) {
  const root = mkdtempSync(join(tmpdir(), 'i18n-default-locale-'))
  const w = (rel, body) => {
    mkdirSync(join(root, rel, '..'), { recursive: true })
    writeFileSync(join(root, rel), typeof body === 'string' ? body : JSON.stringify(body, null, 2))
  }
  w('site.yml', `name: t\n${languages}\n`)
  w('locales/manifest.json', {
    version: '1.0',
    units: { aaaa0001: { source: 'Home', field: 'title', contexts: [{ page: '/', section: 'hero' }] } },
  })
  w('locales/es.json', { aaaa0001: 'Inicio' })
  return root
}

const FORMS = [
  ['languages listed, the default first', 'languages: [en, es]'],
  ['the default named, and listed after', 'defaultLanguage: en\nlanguages: [es, en]'],
]

for (const [form, languages] of FORMS) {
  test(`status reports the translations, not the default — ${form}`, () => {
    const root = site(languages)
    try {
      const { code, out, err } = run(['i18n', 'status', '--json', '--target', root])
      assert.equal(code, 0, err)
      const status = JSON.parse(out)
      assert.deepEqual(Object.keys(status.locales), ['es'])
      assert.deepEqual(status.locales.es, { exists: true, translated: 1, missing: 0, coverage: 100 })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
}

test('audit reports the translations, not the default', () => {
  const root = site('languages: [en, es]')
  try {
    const { code, out, err } = run(['i18n', 'audit', '--target', root])
    assert.equal(code, 0, err)
    assert.match(out, /^es:/m)
    assert.doesNotMatch(out, /^en:/m)
    assert.doesNotMatch(out, /need translation/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a site in one language has nothing to translate', () => {
  const root = site('languages: [en]')
  try {
    const { code, out, err } = run(['i18n', 'status', '--target', root])
    assert.equal(code, 0, err)
    assert.match(out, /No translation files found/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
