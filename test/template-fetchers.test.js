/**
 * Template downloads go to GitHub's file hosts, not to its REST API.
 *
 * The API allows 60 anonymous requests an hour per address, which a shared network
 * or a CI runner can spend — and `create` then failed with "rate limit exceeded".
 * An official template now downloads in ONE request, from the pinned release's
 * file URL; a `github:` template downloads from codeload unless GITHUB_TOKEN is set
 * (which a private repository needs, and which has its own, higher limit).
 *
 * fetch is stubbed: each test serves a real gzipped tarball and records every URL
 * requested, so "no API request" is asserted, not assumed.
 */

import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as tar from 'tar'
import { fetchOfficialTemplate, officialTemplateUrl } from '../src/templates/fetchers/release.js'
import { fetchGitHubTemplate, githubTarballRequest } from '../src/templates/fetchers/github.js'

const realFetch = globalThis.fetch
let requested
let cleanup

beforeEach(() => {
  requested = []
  cleanup = []
})

afterEach(() => {
  globalThis.fetch = realFetch
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true })
})

/** A .tar.gz holding `top/template.json`, as bytes. */
function tarball(top) {
  const dir = mkdtempSync(join(tmpdir(), 'uniweb-tgz-'))
  cleanup.push(dir)
  mkdirSync(join(dir, top))
  writeFileSync(join(dir, top, 'template.json'), JSON.stringify({ name: 'Probe', format: 2 }))
  const file = join(dir, 'out.tgz')
  tar.c({ gzip: true, cwd: dir, file, sync: true }, [top])
  return readFileSync(file)
}

/** Answer every request with `status` (and the bytes, when 200), recording its URL. */
function serve(status, bytes = null) {
  globalThis.fetch = async (url) => {
    requested.push(String(url))
    return new Response(status === 200 ? bytes : null, { status })
  }
}

test('an official template is one request, to its release file — never the API', async () => {
  serve(200, tarball('paste'))
  const got = await fetchOfficialTemplate('paste', { version: 'v0.18.6' })
  cleanup.push(got.baseTempDir)
  assert.deepEqual(requested, [
    'https://github.com/uniweb/templates/releases/download/v0.18.6/paste.tar.gz'
  ])
  assert.equal(officialTemplateUrl('paste', 'v0.18.6'), requested[0])
  assert.ok(existsSync(join(got.tempDir, 'template.json')))
  assert.equal(got.version, 'v0.18.6')
})

test('a template the release lacks is a 404, said plainly', async () => {
  serve(404)
  await assert.rejects(
    fetchOfficialTemplate('nope', { version: 'v0.18.6' }),
    /Release v0\.18\.6 of uniweb\/templates has no template "nope"/
  )
  assert.equal(requested.length, 1)
})

test('github: without a token downloads from codeload, with no Authorization', () => {
  const { url, headers } = githubTarballRequest('acme', 'starter', 'HEAD', null)
  assert.equal(url, 'https://codeload.github.com/acme/starter/tar.gz/HEAD')
  assert.equal(headers.Authorization, undefined)
})

test('github: with GITHUB_TOKEN uses the API, which a private repository needs', () => {
  const { url, headers } = githubTarballRequest('acme', 'starter', 'v1.0.0', 'tok')
  assert.equal(url, 'https://api.github.com/repos/acme/starter/tarball/v1.0.0')
  assert.equal(headers.Authorization, 'Bearer tok')
})

test('github: a codeload archive extracts past its one top folder', async () => {
  const saved = process.env.GITHUB_TOKEN
  delete process.env.GITHUB_TOKEN
  try {
    serve(200, tarball('starter-main'))
    const got = await fetchGitHubTemplate('acme', 'starter', { ref: 'main' })
    cleanup.push(got.tempDir)
    assert.deepEqual(requested, ['https://codeload.github.com/acme/starter/tar.gz/main'])
    assert.ok(existsSync(join(got.tempDir, 'template.json')))
  } finally {
    if (saved !== undefined) process.env.GITHUB_TOKEN = saved
  }
})

test('github: a 404 without a token names the token a private repository needs', async () => {
  const saved = process.env.GITHUB_TOKEN
  delete process.env.GITHUB_TOKEN
  try {
    serve(404)
    await assert.rejects(
      fetchGitHubTemplate('acme', 'secret'),
      /Repository not found: acme\/secret — a private repository needs GITHUB_TOKEN/
    )
  } finally {
    if (saved !== undefined) process.env.GITHUB_TOKEN = saved
  }
})
