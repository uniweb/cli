/**
 * The schema-less data SET's shape is @uniweb/build's; the reader is here. Nothing in either
 * repo's own tests can see the seam between them.
 *
 * ⛔ It broke. `@uniweb/build` removed the set's `search` key on 2026-08-01
 * ("stop producing a search index on the synced lane"); `publish.js` went on
 * reading `Object.keys(ball.search).length`, which is a TypeError, on a line
 * outside the try that wraps the upload. So `uniweb publish` crashed on any
 * site with a schema-less collection — after uploading the bytes — for 17 days,
 * and neither suite could fail.
 *
 * ⭐ This reads the REAL set from the real builder. A hand-written fixture
 * would have been written from the same assumption as the bug, and would have
 * agreed with it.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { collectSchemalessData } from '@uniweb/build/site'

function distWithCollection() {
  const dir = mkdtempSync(join(tmpdir(), 'ball-shape-'))
  mkdirSync(join(dir, 'data', 'notes'), { recursive: true })
  writeFileSync(join(dir, 'data', 'notes.json'), JSON.stringify([{ slug: 'a' }]))
  writeFileSync(join(dir, 'data', 'notes', 'a.json'), JSON.stringify({ slug: 'a', body: 'x' }))
  return dir
}

test('the set a real build produces has exactly the keys the publish reader uses', async () => {
  const dist = distWithCollection()
  try {
    const ball = await collectSchemalessData(dist, ['notes'])
    assert.ok(ball, 'a schema-less collection must produce a set')

    // The exact assertion the crash needed: publish.js reports on these keys, so
    // a key it reads must exist and a key it does not must not appear unnoticed.
    assert.deepEqual(Object.keys(ball).sort(), ['data'])

    // And the reporting line must not throw on the real shape. This is the
    // literal expression that crashed, in the form it now takes.
    assert.doesNotThrow(() => Object.keys(ball.data).length)
    assert.equal(Object.keys(ball.data).length, 2)
  } finally {
    rmSync(dist, { recursive: true, force: true })
  }
})

test('the set is null when no collection is schema-less, so the reader is skipped', async () => {
  const dist = distWithCollection()
  try {
    // `notes` resolves a schema ⇒ it syncs as entities and contributes nothing.
    assert.equal(await collectSchemalessData(dist, []), null)
  } finally {
    rmSync(dist, { recursive: true, force: true })
  }
})
