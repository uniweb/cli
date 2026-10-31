/**
 * A push reads the text a row's translation was made from in the document it is about to change, when it
 * has a reason to, and keeps that translation in the site's files (`keepTranslationsOfEdits`). Most pushes
 * have no reason, and read nothing.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { computeUnitHashes, createZip } from '@uniweb/build/uwx'
import { computeHash } from '@uniweb/build/i18n'
import { keepTranslationsOfEdits, writeUnitBases } from '../src/backend/site-sync.js'

const ORIGIN = 'http://x'

const doc = (...lines) => ({ type: 'doc', content: lines.map((line) => ({ type: 'paragraph', content: [{ type: 'text', text: line }] })) })

const site = (content) => ({
  info: { name: { en: 'S' } },
  settings: { default_language: 'en', languages: ['en', 'es'] },
  pages: [{ $id: 'about', slug: { en: 'about' }, mode: 'page', stable_id: 'about', page_sections: [{ $id: 'hero', stable_id: 'hero', type: 'Hero', content }] }],
})

const zip = (document) =>
  createZip([
    { name: 'manifest.json', data: Buffer.from(JSON.stringify({ format: 'uwx/1', entries: [] })) },
    { name: 'entities/site-content.json', data: Buffer.from(JSON.stringify(document)) },
  ])

const pkgOf = (document) => ({ siteContent: { buffer: zip(document) } })

function project({ bound = true, es = { [computeHash('Old words here')]: 'Palabras viejas' } } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'keep-edits-'))
  writeFileSync(join(dir, 'site.yml'), "name: S\nfoundation: '@a/base'\n")
  if (bound) writeFileSync(join(dir, 'sync.json'), JSON.stringify({ version: 1, backends: { [ORIGIN]: { site: { uuid: 'SITE' } } } }))
  if (es) {
    mkdirSync(join(dir, 'locales'))
    writeFileSync(join(dir, 'locales/es.json'), JSON.stringify(es, null, 2))
  }
  return dir
}

function clientHolding(document) {
  const client = {
    origin: ORIGIN,
    reads: 0,
    pullSiteContent: async (uuid) => {
      client.reads++
      assert.equal(uuid, 'SITE')
      const buffer = zip(document)
      return { ok: true, arrayBuffer: async () => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) }
    },
  }
  return client
}

const STORED = site({ en: doc('Old words here'), es: doc('Palabras viejas') })
const EDITED = site({ en: doc('Old words here today') })

test('⭐ an edited row keeps its translation, flagged in the file, and the package goes again', async () => {
  const dir = project()
  const client = clientHolding(STORED)
  const said = []
  assert.equal(await keepTranslationsOfEdits({ client, siteDir: dir, pkg: pkgOf(EDITED), note: (m) => said.push(m) }), true)
  assert.equal(client.reads, 1)
  const es = JSON.parse(readFileSync(join(dir, 'locales/es.json'), 'utf8'))
  assert.deepEqual(es[computeHash('Old words here today')], { default: 'Palabras viejas', outdated: { '/about:hero': 'Old words here' } })
  assert.equal(es[computeHash('Old words here')], 'Palabras viejas', 'the old entry stays: the same text coming back finds it')
  assert.match(said[0], /1 edited string keeps its old translation until someone reviews it \(es\)/)
  assert.match(said[1], /"Old words here" → "Old words here today"/)
})

test('a rewrite has nothing to keep: one read, nothing written, no package again', async () => {
  const dir = project()
  const before = readFileSync(join(dir, 'locales/es.json'), 'utf8')
  const client = clientHolding(STORED)
  const said = []
  assert.equal(await keepTranslationsOfEdits({ client, siteDir: dir, pkg: pkgOf(site({ en: doc('Something else entirely') })), note: (m) => said.push(m) }), false)
  assert.equal(client.reads, 1)
  assert.equal(readFileSync(join(dir, 'locales/es.json'), 'utf8'), before)
  assert.deepEqual(said, [])
})

test('every row has its words: no reason to read', async () => {
  const dir = project({ es: { [computeHash('Old words here today')]: 'Hoy' } })
  const client = clientHolding(STORED)
  assert.equal(await keepTranslationsOfEdits({ client, siteDir: dir, pkg: pkgOf(EDITED), note: () => {} }), false)
  assert.equal(client.reads, 0)
})

test('a row wanting words in a section this copy did not change: no reason to read', async () => {
  const dir = project()
  writeUnitBases(dir, ORIGIN, { local: computeUnitHashes(EDITED) })
  const client = clientHolding(STORED)
  assert.equal(await keepTranslationsOfEdits({ client, siteDir: dir, pkg: pkgOf(EDITED), note: () => {} }), false)
  assert.equal(client.reads, 0)
})

test('CONTROL — a base naming another state of the section: it changed, and it reads', async () => {
  const dir = project()
  writeUnitBases(dir, ORIGIN, { local: computeUnitHashes(STORED) })
  const client = clientHolding(STORED)
  assert.equal(await keepTranslationsOfEdits({ client, siteDir: dir, pkg: pkgOf(EDITED), note: () => {} }), true)
  assert.equal(client.reads, 1)
})

test('a site with no translation files has nothing to keep', async () => {
  const dir = project({ es: null })
  const client = clientHolding(STORED)
  assert.equal(await keepTranslationsOfEdits({ client, siteDir: dir, pkg: pkgOf(EDITED), note: () => {} }), false)
  assert.equal(client.reads, 0)
})

test('a site never pushed has no store to read', async () => {
  const dir = project({ bound: false })
  const client = clientHolding(STORED)
  assert.equal(await keepTranslationsOfEdits({ client, siteDir: dir, pkg: pkgOf(EDITED), note: () => {} }), false)
  assert.equal(client.reads, 0)
})

test('nothing to send: nothing to look for', async () => {
  const dir = project()
  const client = clientHolding(STORED)
  assert.equal(await keepTranslationsOfEdits({ client, siteDir: dir, pkg: { siteContent: null }, note: () => {} }), false)
  assert.equal(client.reads, 0)
})

test('a read that fails leaves the row to fall back: no refusal, and nothing written', async () => {
  const dir = project()
  const before = readFileSync(join(dir, 'locales/es.json'), 'utf8')
  const refused = { origin: ORIGIN, pullSiteContent: async () => ({ ok: false, status: 500 }) }
  assert.equal(await keepTranslationsOfEdits({ client: refused, siteDir: dir, pkg: pkgOf(EDITED), note: () => {} }), false)
  const broken = {
    origin: ORIGIN,
    pullSiteContent: async () => {
      throw new Error('offline')
    },
  }
  assert.equal(await keepTranslationsOfEdits({ client: broken, siteDir: dir, pkg: pkgOf(EDITED), note: () => {} }), false)
  assert.equal(readFileSync(join(dir, 'locales/es.json'), 'utf8'), before)
})
