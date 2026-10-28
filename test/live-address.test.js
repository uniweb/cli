/**
 * Where a site's visitors go: a backend's `visitor_url` — the site's custom domain while one is
 * active — else the address its last publish delivered to (`liveAddress`).
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { liveAddress } from '../src/backend/live-address.js'

test('⭐ the visitor address, when the backend names one', () => {
  assert.equal(liveAddress('https://own.example/', 'https://site.example.test/'), 'https://own.example/')
})

test('the delivered address, when the visitor address is absent, null or empty', () => {
  for (const visitor of [undefined, null, ''])
    assert.equal(liveAddress(visitor, 'https://site.example.test/'), 'https://site.example.test/')
})

test('nothing, when the backend names neither', () => {
  assert.equal(liveAddress(undefined, null), null)
  assert.equal(liveAddress({ url: 'https://own.example/' }, 42), null)
})

// `publish` cannot be driven to its report in-process: it builds the site by running the CLI's
// own entry, which `runVerb` stubs. So its half is read off the source: it shows the visitor
// address of its answer, and records the delivered one.
test('publish shows where visitors go, and keeps the delivered address for deploy.yml', () => {
  const src = readFileSync(new URL('../src/commands/publish.js', import.meta.url), 'utf8')
  assert.match(src, /const shownUrl = liveAddress\(result\.visitor_url, serveUrl\)/)
  assert.match(src, /if \(shownUrl\) console\.log\(/)
  assert.match(src, /\n\s+url: serveUrl,\n/)
})
