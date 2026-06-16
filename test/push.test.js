/**
 * uniweb push — CREATE-response minted-uuid extraction.
 *
 * push() itself has no dependency-injection seam (it resolves the site dir, builds via
 * the real producer, and uses the global fetch), so the command flow isn't unit-driven
 * here — but its exported helpers are. Two are pinned:
 *
 *   1. extractMintedSiteUuid — reads the site-content uuid the backend mints on
 *      `POST /dev/site/content` (CREATE). Its exact response shape is an open backend
 *      item, so the extractor is deliberately tolerant; these cases document the shapes
 *      it accepts.
 *   2. makeModelResolver — the non-local Model resolver. Its `offline` contract is the
 *      load-bearing bit: an offline emit (`-o` / `--dry-run`) must NEVER read from the
 *      backend (no fetch ⇒ no auth prompt), resolving any non-local Model to null so the
 *      collections emitter soft-skips it and the site-content lane still emits.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { extractMintedSiteUuid, makeModelResolver } from '../src/commands/push.js'

test('extractMintedSiteUuid reads a bare { siteContentUuid }', () => {
  assert.equal(extractMintedSiteUuid({ siteContentUuid: 'SITE-1' }), 'SITE-1')
})

test('extractMintedSiteUuid reads a bare { $uuid } or { uuid }', () => {
  assert.equal(extractMintedSiteUuid({ $uuid: 'SITE-2' }), 'SITE-2')
  assert.equal(extractMintedSiteUuid({ uuid: 'SITE-3' }), 'SITE-3')
})

test('extractMintedSiteUuid reads the report.finalized[] envelope (the site entity, index 0)', () => {
  const payload = { report: { finalized: [{ index: 0, uuid: 'SITE-4', changed: true }] } }
  assert.equal(extractMintedSiteUuid(payload), 'SITE-4')
})

test('extractMintedSiteUuid falls back to document.$uuid inside finalized', () => {
  const payload = { report: { finalized: [{ index: 0, document: { $uuid: 'SITE-5' } }] } }
  assert.equal(extractMintedSiteUuid(payload), 'SITE-5')
})

test('extractMintedSiteUuid returns null when no uuid is present', () => {
  assert.equal(extractMintedSiteUuid({}), null)
  assert.equal(extractMintedSiteUuid({ report: { finalized: [] } }), null)
  assert.equal(extractMintedSiteUuid(null), null)
})

test('makeModelResolver offline mode resolves a non-local Model to null without reading the backend', async () => {
  let reads = 0
  const client = { readDataSchema: async () => { reads++; return { name: 'should-not-be-reached' } } }
  const resolve = makeModelResolver({ client, offline: true })
  assert.equal(await resolve('@/product'), null)
  assert.equal(reads, 0, 'an offline resolver must never call client.readDataSchema (no fetch ⇒ no auth)')
})

test('makeModelResolver online mode reads the declaration from the backend', async () => {
  let reads = 0
  const decl = { name: '@std/article', fields: {} }
  const client = { readDataSchema: async (n) => { reads++; return n === '@std/article' ? decl : null } }
  const resolve = makeModelResolver({ client }) // offline defaults to false
  assert.equal(await resolve('@std/article'), decl)
  assert.equal(reads, 1)
})

test('makeModelResolver caches per run — one backend read per Model name', async () => {
  let reads = 0
  const client = { readDataSchema: async () => { reads++; return { name: 'x' } } }
  const resolve = makeModelResolver({ client })
  await resolve('@std/x')
  await resolve('@std/x')
  assert.equal(reads, 1, 'the second resolve of the same Model is served from cache')
})
