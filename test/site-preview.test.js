/**
 * What `uniweb dev` asks the backend before previewing a site whose foundation is a catalog ref.
 *
 * The backend says where a version is served — or does not, which is its to decide: an answer
 * without a location is an ordinary outcome, said plainly. Whatever it says is for one dev server and
 * is written nowhere.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readSitePreview } from '../src/backend/site-preview.js'

const ORIGIN = 'http://backend.test'
const REF = '@acme/fnd@1.0.0'
const REPLY = {
  schema: { _self: {} },
  module_url: 'http://backend.test/served/fnd/entry.js',
  css_url: 'http://backend.test/served/fnd/style.css'
}
// A workspace named on the command line: no session is read, nothing asks.
const ARGS = ['--org', '@acme']

function site({ foundation = REF, backends = { [ORIGIN]: { site: { uuid: 'SITE' } } } } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'site-preview-'))
  writeFileSync(join(dir, 'site.yml'), `name: T\nfoundation: '${foundation}'\n`)
  if (backends) writeFileSync(join(dir, 'sync.json'), JSON.stringify({ version: 1, backends }, null, 2) + '\n')
  return dir
}

function clientAnswering(reply, origin = ORIGIN) {
  const client = { origin, asked: [], workspace: undefined }
  client.readRegisteredFoundation = async (siteUuid, ref) => {
    client.asked.push([siteUuid, ref, client.workspace])
    return reply
  }
  client.setWorkspace = (value) => {
    client.workspace = value
    return client
  }
  return client
}

const files = (dir) => readdirSync(dir, { recursive: true }).sort()

test('⭐ hands the dev server where the backend serves the version, and writes nothing', async () => {
  const dir = site()
  try {
    const before = files(dir)
    const client = clientAnswering(REPLY)
    const asked = await readSitePreview({ siteDir: dir, args: ARGS, client })
    assert.deepEqual(asked, {
      preview: { backend: ORIGIN, foundation: { ref: REF, url: REPLY.module_url, cssUrl: REPLY.css_url } }
    })
    // Read through the site, in the command's workspace.
    assert.deepEqual(client.asked, [['SITE', REF, '@acme']])
    assert.deepEqual(files(dir), before)
    assert.match(readFileSync(join(dir, 'site.yml'), 'utf8'), /foundation: '@acme\/fnd@1\.0\.0'/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('⭐ a backend that does not say where it is served — said, and nothing starts', async () => {
  const dir = site()
  try {
    const { module_url, css_url, ...schemaOnly } = REPLY
    const asked = await readSitePreview({ siteDir: dir, args: ARGS, client: clientAnswering(schemaOnly) })
    assert.match(asked.refused[0], /did not say where @acme\/fnd@1\.0\.0 is served/)
    assert.match(asked.refused.join('\n'), /Push, pull and publish do not need it/)

    const failed = await readSitePreview({ siteDir: dir, args: ARGS, client: clientAnswering(null) })
    assert.match(failed.refused[0], /Could not read @acme\/fnd@1\.0\.0 through this site/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a site that is not on the backend the user is logged in to names where it is', async () => {
  const dir = site({ backends: { 'http://elsewhere.test': { site: { uuid: 'SITE' } } } })
  try {
    const client = clientAnswering(REPLY)
    const asked = await readSitePreview({ siteDir: dir, args: ARGS, client })
    assert.match(asked.refused.join('\n'), /on http:\/\/elsewhere\.test — not on http:\/\/backend\.test/)
    assert.match(asked.refused.join('\n'), /uniweb login --server/)
    assert.deepEqual(client.asked, [])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('CONTROL — a foundation that is not a catalog ref asks nothing', async () => {
  const dir = site({ foundation: 'src', backends: null })
  mkdirSync(join(dir, 'pages'))
  try {
    const client = clientAnswering(REPLY)
    assert.equal(await readSitePreview({ siteDir: dir, args: ARGS, client }), null)
    assert.deepEqual(client.asked, [])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
