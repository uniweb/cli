/**
 * uniweb pull — verb structure, mock-backed.
 *
 * Drives the pull orchestration with an injected fetch (synthetic pull payloads)
 * and getToken (no auth), against a temp site dir, and asserts the projection
 * layer wrote canonical files. The live backend routes are unexercised; this
 * pins the wiring (uuid read → GET → extract → project) end to end.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import yaml from 'js-yaml'
import { pull, extractDocument, splitCollectionsPull } from '../src/commands/pull.js'

const docOf = (text) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })

// A minimal Response-like object for the mocked fetch.
const jsonRes = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, statusText: '', json: async () => body })

function makeFetch(routes) {
  return async (url) => {
    for (const [needle, body] of routes) {
      if (url.includes(needle)) return body === 404 ? jsonRes(null, 404) : jsonRes(body)
    }
    return jsonRes(null, 404)
  }
}

function tempSite() {
  const dir = mkdtempSync(join(tmpdir(), 'uniweb-pull-'))
  return dir
}

test('extractDocument tolerates raw, {document}, and {entity} envelopes', () => {
  const raw = { $model: '@uniweb/site-content', info: {} }
  assert.equal(extractDocument(raw), raw)
  assert.equal(extractDocument({ document: raw }), raw)
  assert.equal(extractDocument({ entity: raw }), raw)
  assert.equal(extractDocument(null), null)
})

test('splitCollectionsPull partitions the folder from the records', () => {
  const folder = { $model: '@uniweb/folder', entries: [] }
  const rec = { $model: '@acme/article', article: {} }
  const { folderDoc, recordDocs } = splitCollectionsPull({ entities: [folder, rec] })
  assert.equal(folderDoc, folder)
  assert.deepEqual(recordDocs, [rec])
})

test('pull is a no-op with no $uuid in files', async () => {
  const dir = tempSite()
  try {
    writeFileSync(join(dir, 'site.yml'), "name: S\nfoundation: '@a/base'\n")
    const res = await pull([], { resolveSiteDir: async () => dir, getToken: async () => 'tok', fetch: async () => jsonRes(null, 404) })
    assert.equal(res.exitCode, 0)
    assert.equal(existsSync(join(dir, 'pages')), false) // nothing projected
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('pull projects the site-content lane (pages + sections + config) from a mock GET', async () => {
  const dir = tempSite()
  try {
    writeFileSync(join(dir, 'site.yml'), "$uuid: SITE\nname: Old\nfoundation: '@a/base'\n")

    const document = {
      $uuid: 'SITE',
      $id: 'site-content',
      $model: '@uniweb/site-content',
      info: { name: { en: 'Pulled' }, foundation: '@a/base' },
      pages: [
        {
          $id: 'home',
          $uuid: 'P1',
          slug: 'home',
          mode: 'page',
          stable_id: 'home',
          is_index: true,
          page_sections: [{ $id: 'hero', $uuid: 'S1', stable_id: 'hero', type: 'Hero', content: docOf('Welcome') }],
        },
      ],
      layout_sections: [],
      extensions: [],
      collections: [],
    }

    const res = await pull([], {
      resolveSiteDir: async () => dir,
      getToken: async () => 'tok',
      fetch: makeFetch([['/dev/sync/site-content/pull/SITE', document]]),
    })

    assert.equal(res.exitCode, 0)
    // config written from info
    assert.equal(yaml.load(readFileSync(join(dir, 'site.yml'), 'utf8')).name, 'Pulled')
    // page + section projected; page.yml stays clean (identity → .uniweb/ index)
    const pageYml = yaml.load(readFileSync(join(dir, 'pages/home/page.yml'), 'utf8'))
    assert.deepEqual(pageYml.sections, ['hero'])
    assert.equal(pageYml.uuid, undefined)
    assert.equal(pageYml.ids, undefined)
    assert.ok(existsSync(join(dir, 'pages/home/hero.md')))
    // uuids recorded in the gitignored index instead
    const index = JSON.parse(readFileSync(join(dir, '.uniweb/pull-index.json'), 'utf8'))
    assert.equal(index.items.P1, join('pages', 'home'))
    assert.equal(index.items.S1, join('pages', 'home', 'hero.md'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('pull bootstraps the collections folder from the site-content `folder` ref', async () => {
  const dir = tempSite()
  try {
    // site-content uuid present, but NO local collections.yml (e.g. a pages-only clone).
    writeFileSync(join(dir, 'site.yml'), "$uuid: SITE9\nname: Old\nfoundation: '@a/base'\n")

    const siteContent = {
      $uuid: 'SITE9', $id: 'site-content', $model: '@uniweb/site-content',
      info: { name: { en: 'S' }, foundation: '@a/base', gateway: 'F9' }, // the site's gateway ref
      pages: [], layout_sections: [], extensions: [], collections: [],
    }
    const folderDoc = {
      $uuid: 'F9', $id: '@folder', $model: '@uniweb/folder',
      entries: [{ kind: 'branch', path_segment: 'articles', entries: [{ kind: 'ref', path_segment: 'hello', entry: 'R9' }] }],
    }
    const recordDoc = { $uuid: 'R9', $model: '@acme/article', article: { title: { en: 'Hello' }, body: { en: '\n# Hi\n' } } }
    const declaration = {
      name: '@acme/article',
      sections: { article: { brief: true, fields: { title: { type: 'string', localized: true }, body: { type: 'richtext', localized: true } } } },
    }

    const res = await pull([], {
      resolveSiteDir: async () => dir,
      getToken: async () => 'tok',
      fetch: makeFetch([
        ['/dev/sync/site-content/pull/SITE9', siteContent],
        ['/dev/sync/collections/pull/F9', { entities: [folderDoc, recordDoc] }],
        ['/dev/registry/data-schemas/', declaration],
      ]),
    })

    assert.equal(res.exitCode, 0)
    // folder uuid discovered from site-content and seeded into collections.yml
    assert.match(readFileSync(join(dir, 'collections/collections.yml'), 'utf8'), /\$uuid: F9/)
    // and the collections lane actually ran via the discovered folder
    assert.ok(existsSync(join(dir, 'collections/articles/hello.md')), 'record projected via discovered folder')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('pull projects the collections lane, resolving the model via a mock model-read', async () => {
  const dir = tempSite()
  try {
    writeFileSync(join(dir, 'site.yml'), "name: S\nfoundation: '@a/base'\n") // no $uuid → site-content lane skipped
    mkdirSync(join(dir, 'collections'), { recursive: true })
    writeFileSync(join(dir, 'collections/collections.yml'), '$uuid: F1\n')

    const folderDoc = {
      $uuid: 'F1',
      $id: '@folder',
      $model: '@uniweb/folder',
      entries: [{ kind: 'branch', path_segment: 'articles', entries: [{ kind: 'ref', path_segment: 'hello', entry: 'R1' }] }],
    }
    const recordDoc = { $uuid: 'R1', $model: '@acme/article', article: { title: { en: 'Hello' }, body: { en: '\n# Hi\n' } } }
    const declaration = {
      name: '@acme/article',
      sections: { article: { brief: true, fields: { title: { type: 'string', localized: true }, body: { type: 'richtext', localized: true } } } },
    }

    const res = await pull([], {
      resolveSiteDir: async () => dir,
      getToken: async () => 'tok',
      fetch: makeFetch([
        ['/dev/sync/collections/pull/F1', { entities: [folderDoc, recordDoc] }],
        ['/dev/registry/data-schemas/', declaration],
      ]),
    })

    assert.equal(res.exitCode, 0)
    const recordFile = join(dir, 'collections/articles/hello.md')
    assert.ok(existsSync(recordFile), 'record file projected')
    assert.match(readFileSync(recordFile, 'utf8'), /title: Hello/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
