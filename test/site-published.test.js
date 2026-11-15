/**
 * What `uniweb dev --published` reads before serving a working copy against the site as published.
 *
 * It asks the backend you are logged in to where the site is published, reads that page, and takes
 * the host's services block from the data the page boots from — addresses read, never composed.
 * A site that is not there, not published, or offering nothing is said plainly, and nothing starts.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { readSitePublished, readDataScript, isOnThisMachine } from '../src/backend/site-published.js'
import { readDevArgs } from '../src/commands/dev.js'

const ORIGIN = 'http://localhost:8080'
// A workspace named on the command line: no session is read, nothing asks.
const ARGS = ['--org', '@acme']
const SERVICES = { backend: '/_api', records: { endpoint: '/_query/{locale}' } }

function site({ backends = { [ORIGIN]: { site: { uuid: 'SITE' } } } } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'site-published-'))
  writeFileSync(join(dir, 'site.yml'), 'name: T\nfoundation: src\n')
  if (backends) writeFileSync(join(dir, 'sync.json'), JSON.stringify({ version: 1, backends }, null, 2) + '\n')
  return dir
}

function clientAnswering(status) {
  const client = { origin: ORIGIN, asked: [], workspace: undefined }
  client.siteStatus = async (uuid) => {
    client.asked.push([uuid, client.workspace])
    return status
  }
  client.setWorkspace = (value) => {
    client.workspace = value
    return client
  }
  return client
}

const page = (data, type = 'application/json') =>
  `<!doctype html><html><head><script src="/x.js"></script></head><body><div id="root"></div>` +
  `<script id="__DATA__" type="${type}">${type === 'application/json' ? JSON.stringify(data).replace(/</g, '\\u003c') : gzipSync(JSON.stringify(data)).toString('base64')}</script></body></html>`

/** A page server: answers the address with `html`, as having been reached at `finalUrl`. */
function pageAt(html, { finalUrl, status = 200 } = {}) {
  const asked = []
  const fetchPage = async (url) => {
    asked.push(url)
    return { ok: status < 400, status, url: finalUrl ?? url, text: async () => html }
  }
  return { fetchPage, asked }
}

const files = (dir) => readdirSync(dir, { recursive: true }).sort()

test('⭐ hands the dev server the services the published page carries, read against its address', async () => {
  const dir = site()
  try {
    const before = files(dir)
    const client = clientAnswering({ published: true, visitor_url: 'http://acme.localhost:8080/', last_published_url: 'http://other/' })
    const { fetchPage, asked } = pageAt(page({ foundation: {}, content: { config: { services: SERVICES, base: '/' } } }), {
      finalUrl: 'http://acme.localhost:8080/home'
    })
    const got = await readSitePublished({ siteDir: dir, args: ARGS, client, fetchPage })
    assert.deepEqual(got, {
      published: { site: 'http://acme.localhost:8080/home', backend: ORIGIN, base: '/', services: SERVICES }
    })
    // Asked through the site, in the command's workspace; the visitors' address, not the delivered one.
    assert.deepEqual(client.asked, [['SITE', '@acme']])
    assert.deepEqual(asked, ['http://acme.localhost:8080/'])
    assert.deepEqual(files(dir), before)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('reads a page whose data is gzipped, as the runtime does', () => {
  const data = { foundation: {}, content: { config: { services: SERVICES } } }
  assert.deepEqual(readDataScript(page(data, 'application/gzip')), data)
  assert.equal(readDataScript('<html><body>no data</body></html>'), null)
})

test('a site on another backend, or on none, starts nothing and says which', async () => {
  const elsewhere = site({ backends: { 'https://other.example': { site: { uuid: 'X' } } } })
  const nowhere = site({ backends: null })
  try {
    const a = await readSitePublished({ siteDir: elsewhere, args: ARGS, client: clientAnswering(null), fetchPage: pageAt('').fetchPage })
    assert.match(a.refused[1], /https:\/\/other\.example, not on http:\/\/localhost:8080/)
    const b = await readSitePublished({ siteDir: nowhere, args: ARGS, client: clientAnswering(null), fetchPage: pageAt('').fetchPage })
    assert.match(b.refused[1], /uniweb publish/)
  } finally {
    rmSync(elsewhere, { recursive: true, force: true })
    rmSync(nowhere, { recursive: true, force: true })
  }
})

test('a site that is not published, or offers no services, starts nothing and says so', async () => {
  const dir = site()
  try {
    const unpublished = clientAnswering({ published: false, last_published_url: 'http://acme.localhost:8080/' })
    const a = await readSitePublished({ siteDir: dir, args: ARGS, client: unpublished, fetchPage: pageAt('').fetchPage })
    assert.match(a.refused[0], /not published/)

    const bare = pageAt(page({ foundation: {}, content: { config: {} } }))
    const b = await readSitePublished({ siteDir: dir, args: ARGS, client: clientAnswering({ published: true, visitor_url: 'http://acme.localhost:8080/' }), fetchPage: bare.fetchPage })
    assert.match(b.refused[0], /offers no services/)

    const down = pageAt('', { status: 502 })
    const c = await readSitePublished({ siteDir: dir, args: ARGS, client: clientAnswering({ published: true, visitor_url: 'http://acme.localhost:8080/' }), fetchPage: down.fetchPage })
    assert.match(c.refused[0], /HTTP 502/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('an address on this machine is told from one that is not', () => {
  for (const local of ['http://localhost:8080/', 'http://acme.portal.localhost:8080/', 'http://127.0.0.1:3000/']) {
    assert.equal(isOnThisMachine(local), true, local)
  }
  assert.equal(isOnThisMachine('https://acme.uniweb.pro/'), false)
})

test('`--published` starts a server, so it does not go with `--status` or `--stop`', () => {
  assert.equal(readDevArgs(['--published']).published, true)
  assert.equal(readDevArgs([]).published, false)
  assert.match(readDevArgs(['--published', '--stop']).error, /--published/)
})
