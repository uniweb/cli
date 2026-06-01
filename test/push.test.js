/**
 * uniweb push — CREATE-response minted-uuid extraction.
 *
 * push() itself has no dependency-injection seam (it resolves the site dir, builds via
 * the real producer, and uses the global fetch), so it isn't unit-driven here. What IS
 * pinned is the one piece of NEW, backend-shape-dependent logic the migration added:
 * extractMintedSiteUuid, which reads the site-content uuid the backend mints on
 * `POST /dev/site/content` (CREATE). Its exact response shape is an open backend item,
 * so the extractor is deliberately tolerant — this is the single adjust-point at the
 * first live CREATE, and these cases document the shapes it accepts.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { extractMintedSiteUuid } from '../src/commands/push.js'

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
