/**
 * `uniweb i18n status --records-only` and `uniweb i18n audit --records-only` read the
 * RECORD translations — `locales/records/manifest.json` and `locales/records/<locale>.json` —
 * as the help says they do.
 *
 * ⛔ Both ignored the flag: they read the page manifest and reported page strings only,
 * so the flag an author typed to check their records' coverage answered a different
 * question with nothing saying so.
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

const unit = (source, context) => ({ source, field: 'title', contexts: [context] })

/** A site with two page strings (one translated) and three record strings (all three translated). */
function site() {
  const root = mkdtempSync(join(tmpdir(), 'i18n-records-only-'))
  const w = (rel, body) => {
    mkdirSync(join(root, rel, '..'), { recursive: true })
    writeFileSync(join(root, rel), typeof body === 'string' ? body : JSON.stringify(body, null, 2))
  }
  w('site.yml', 'name: t\nlanguages: [en, es]\n')
  w('locales/manifest.json', {
    version: '1.0',
    units: { aaaa0001: unit('Home', { page: '/', section: 'hero' }), aaaa0002: unit('About', { page: '/about', section: 'hero' }) },
  })
  w('locales/es.json', { aaaa0001: 'Inicio' })
  w('locales/records/manifest.json', {
    version: '1.0',
    units: {
      bbbb0001: unit('Hello', { record: 'article/hello' }),
      bbbb0002: unit('World', { record: 'article/world' }),
      bbbb0003: unit('Again', { record: 'article/again' }),
    },
  })
  w('locales/records/es.json', { bbbb0001: 'Hola', bbbb0002: 'Mundo', bbbb0003: 'Otra vez' })
  return root
}

test('status --records-only reports the record strings, not the page strings', () => {
  const root = site()
  try {
    const records = run(['i18n', 'status', 'es', '--records-only', '--json', '--target', root])
    assert.equal(records.code, 0, records.err)
    const status = JSON.parse(records.out)
    assert.equal(status.totalUnits, 3)
    assert.deepEqual(status.locales.es, { exists: true, translated: 3, missing: 0, coverage: 100 })

    // CONTROL — without the flag, the page strings, as before
    const pages = JSON.parse(run(['i18n', 'status', 'es', '--json', '--target', root]).out)
    assert.equal(pages.totalUnits, 2)
    assert.equal(pages.locales.es.coverage, 50)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('status --records-only --missing lists the missing record strings, by record', () => {
  const root = site()
  try {
    writeFileSync(join(root, 'locales/records/es.json'), JSON.stringify({ bbbb0001: 'Hola' }))
    const { code, out, err } = run(['i18n', 'status', 'es', '--records-only', '--missing', '--json', '--target', root])
    assert.equal(code, 0, err)
    const report = JSON.parse(out)
    assert.equal(report.locales.es.missing, 2)
    assert.deepEqual(report.missing.map((m) => m.source).sort(), ['Again', 'World'])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('status --records-only says which manifest is missing', () => {
  const root = site()
  try {
    rmSync(join(root, 'locales/records'), { recursive: true, force: true })
    const { code, out, err } = run(['i18n', 'status', '--records-only', '--target', root])
    assert.notEqual(code, 0)
    assert.match(`${out}${err}`, /No record manifest found\. Run "uniweb i18n extract --records-only" first\./)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('audit --records-only audits the record translations', () => {
  const root = site()
  try {
    // a stale record translation — its hash is in no record manifest unit
    writeFileSync(join(root, 'locales/records/es.json'), JSON.stringify({ bbbb0001: 'Hola', bbbb0002: 'Mundo', bbbb0003: 'Otra vez', cccc9999: 'Viejo' }))
    const records = run(['i18n', 'audit', 'es', '--records-only', '--verbose', '--target', root])
    assert.equal(records.code, 0, records.err)
    assert.match(records.out, /Valid:\s+3 \(100%\)/)
    assert.match(records.out, /Stale:\s+1/)
    assert.match(records.out, /cccc9999: "Viejo"/)

    // CONTROL — the page audit knows nothing of that record hash
    const pages = run(['i18n', 'audit', 'es', '--verbose', '--target', root])
    assert.match(pages.out, /Valid:\s+1 \(50%\)/)
    assert.doesNotMatch(pages.out, /cccc9999/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
