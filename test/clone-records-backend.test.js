import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import yaml from 'js-yaml'
import { recordSiteBackend } from '../src/utils/site-identity.js'

// `clone` records the backend BEFORE `pnpm install`, so the site has no
// node_modules and `import('@uniweb/build/uwx')` fails. That branch returned null
// and wrote nothing, leaving a clone whose $uuid was minted by the --backend
// origin with nothing recording that origin — so the scope guard inferred the
// DEFAULT backend and stopped the next command dead. The origin was on the
// command line the whole time. Reported by the backend lane 2026-09-18: 0.48.5
// recorded it, 0.57.0 did not.

const failingLoad = () => Promise.reject(new Error('Cannot find package'))

function siteWith(text) {
  const dir = mkdtempSync(join(tmpdir(), 'rec-'))
  writeFileSync(join(dir, 'site.yml'), text)
  return dir
}

test('records $backend even when @uniweb/build cannot be imported', async () => {
  const dir = siteWith('name: s\n$uuid: SITE-1\n')
  const got = await recordSiteBackend(dir, 'http://localhost:8081', { loadUwx: failingLoad })
  assert.equal(got, 'http://localhost:8081')
  const parsed = yaml.load(readFileSync(join(dir, 'site.yml'), 'utf8'))
  assert.equal(parsed.$backend, 'http://localhost:8081')
  // The rest of the file must survive.
  assert.equal(parsed.$uuid, 'SITE-1')
})

test('the fallback leaves a parseable file — the whole point', async () => {
  const dir = siteWith("# comment\nname: s\nfoundation: '@acme/base@1.0.0'\n")
  await recordSiteBackend(dir, 'http://localhost:8081', { loadUwx: failingLoad })
  const text = readFileSync(join(dir, 'site.yml'), 'utf8')
  assert.doesNotThrow(() => yaml.load(text))
  assert.equal(yaml.load(text).foundation, '@acme/base@1.0.0')
  assert.match(text, /# comment/)
})

test('an existing $backend is replaced, not duplicated', async () => {
  const dir = siteWith('$backend: https://old.example\nname: s\n')
  await recordSiteBackend(dir, 'http://localhost:8081', { loadUwx: failingLoad })
  const text = readFileSync(join(dir, 'site.yml'), 'utf8')
  assert.equal((text.match(/^\$backend:/gm) || []).length, 1)
  assert.equal(yaml.load(text).$backend, 'http://localhost:8081')
})

test('CONTROL — the default backend is still deliberately NOT recorded', async () => {
  const dir = siteWith('name: s\n')
  const got = await recordSiteBackend(dir, 'https://uniweb.app', { loadUwx: failingLoad })
  assert.equal(got, null)
  assert.equal(yaml.load(readFileSync(join(dir, 'site.yml'), 'utf8')).$backend, undefined)
})

test('CONTROL — no site.yml means nothing is written and none is created', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'rec-'))
  const got = await recordSiteBackend(dir, 'http://localhost:8081', { loadUwx: failingLoad })
  assert.equal(got, null)
})
