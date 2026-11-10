/**
 * The records a push took out of the site's folder — moved to another schema, or their files
 * deleted — which the backend keeps until they are deleted.
 *
 * ⭐ Ruled 2026-11-04 [Diego]: the CLI deletes them, asking first with a count, rather than leaving
 * that to the app. The backend's half is its own: `POST /dev/entities/delete` takes
 * `{ uuids, placed: 'keep' }` and answers `{ deleted, kept }`, keeping a record a folder outside the
 * call still places. These tests check what the CLI banks, asks, sends and says.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeHeldTypes, retireUnplaced } from '../src/backend/site-sync.js'
import { settleRetiredRecords } from '../src/utils/retired-records.js'

const ORIGIN = 'http://backend.test'
const folder = (entries) => ({
  $schema: '@uniweb/folder',
  contents: entries.map(([entity, schema]) => ({ kind: 'ref', name: entity, entry: { schema, entity }, $uuid: `E-${entity}` }))
})
function site(state = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'uw-retired-'))
  writeFileSync(join(dir, 'sync.json'), JSON.stringify({ version: 1, backends: { [ORIGIN]: { site: { uuid: 'SITE' }, ...state } } }))
  return dir
}
const stateOf = (dir) => JSON.parse(readFileSync(join(dir, 'sync.json'), 'utf8')).backends[ORIGIN]
const reporter = () => {
  const lines = []
  return { lines, say: { ok: (m) => lines.push(`ok ${m}`), dim: (m) => lines.push(`dim ${m}`), warn: (m) => lines.push(`warn ${m}`) } }
}
const deleting = (answer) => {
  const sent = []
  return {
    sent,
    client: {
      origin: ORIGIN,
      deleteEntities: async (body) => {
        sent.push(body)
        return typeof answer === 'function' ? answer(body) : Response.json(answer ?? { deleted: body.uuids, kept: [] })
      }
    }
  }
}
// The interactive path, which a test runner's stdin is not.
async function atATerminal(fn) {
  const ci = process.env.CI
  const tty = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY')
  delete process.env.CI
  Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true })
  try {
    return await fn()
  } finally {
    if (ci !== undefined) process.env.CI = ci
    if (tty) Object.defineProperty(process.stdin, 'isTTY', tty)
    else delete process.stdin.isTTY
  }
}

test('⭐ the held types are a snapshot of the folder, and a push retires what it stopped placing', () => {
  // Every push and pull maps the records it carries, by the record's own id.
  const dir = site({
    records: { 'own-old': 'OLD', 'own-keep': 'KEEP', 'own-new': 'NEW' },
    types: { OLD: '@std/project', KEEP: '@std/article', GONE_LONG_AGO: '@std/x' }
  })
  // GONE_LONG_AGO is not in the folder before this push either: the snapshot above is stale on
  // purpose, as a copy banked by an older CLI is (types merged).
  const before = writeHeldTypes(dir, ORIGIN, folder([['OLD', '@std/project'], ['KEEP', '@std/article']]))
  assert.deepEqual(stateOf(dir).types, { OLD: '@std/project', KEEP: '@std/article' }, 'written whole')
  // The push moved OLD to another schema: the folder now places NEW in its place.
  const after = writeHeldTypes(dir, ORIGIN, folder([['NEW', '@acme/project'], ['KEEP', '@std/article']]))
  assert.deepEqual(retireUnplaced(dir, ORIGIN, after), ['OLD'])
  assert.deepEqual(stateOf(dir).types, { NEW: '@acme/project', KEEP: '@std/article' })
  assert.deepEqual(stateOf(dir).retired, { OLD: '@std/project' })
  assert.ok(before.before.GONE_LONG_AGO, 'the first snapshot replaced the stale map')
})

test('a retired record placed again is no longer retired', () => {
  const dir = site({ types: { NEW: '@acme/project' }, retired: { OLD: '@std/project' } })
  retireUnplaced(dir, ORIGIN, writeHeldTypes(dir, ORIGIN, folder([['OLD', '@std/project'], ['NEW', '@acme/project']])))
  assert.equal(stateOf(dir).retired, undefined)
})

test('⭐ a mounted record leaving the folder is its owner\'s to retire, never this copy\'s', () => {
  // MINE is this site's own record. THEIRS is another site's, placed here by reference through a
  // mounted records directory (`site.yml::paths`): never sent by this copy, never in its map.
  const dir = site({ records: { 'own-mine': 'MINE' }, types: { MINE: '@acme/member', THEIRS: '@acme/member' } })
  // The site stopped mounting the directory, and deleted its own record's file.
  const after = writeHeldTypes(dir, ORIGIN, folder([]))
  assert.deepEqual(retireUnplaced(dir, ORIGIN, after), ['MINE'])
  assert.deepEqual(stateOf(dir).retired, { MINE: '@acme/member' })
})

test('a copy that never banked types retires nothing on its first push', () => {
  const dir = site()
  assert.deepEqual(retireUnplaced(dir, ORIGIN, writeHeldTypes(dir, ORIGIN, folder([['A', '@std/x']]))), [])
  assert.equal(stateOf(dir).retired, undefined)
})

test('⭐ with --yes, a push deletes them by uuid, keeping what another folder places, and settles the list', async () => {
  const dir = site({ retired: { A: '@std/project', B: '@std/project', C: '@acme/x' } })
  const { client, sent } = deleting({ deleted: ['A', 'C'], kept: ['B'] })
  const { say, lines } = reporter()
  const res = await settleRetiredRecords({ client, siteDir: dir, args: ['--yes'], say })
  assert.deepEqual(sent, [{ uuids: ['A', 'B', 'C'], placed: 'keep' }])
  assert.deepEqual(res, { deleted: 2, kept: 1, asked: true })
  assert.ok(lines.includes('ok Deleted 2 records from the backend.'))
  assert.ok(lines.includes("dim Kept 1 record: another site's folder still places it. A later push deletes it once none does."))
  assert.equal(stateOf(dir).retired, undefined, 'every uuid settled')
  assert.deepEqual(stateOf(dir).deleting, { B: '@std/project' }, 'the kept one is held to delete')
})

// ⛔ Until 2026-11-10 the kept one was dropped. Once the other site's push stopped placing it (its
// mount read the owner's files, and the file was gone), it stayed on the backend in no folder, and
// nothing offered to delete it (measured on the playground).
test('⭐ a record kept for another site\'s folder is deleted at a later push, once none places it, with no question', async () => {
  const dir = site({ deleting: { B: '@acme/member' } })
  const stillPlaced = deleting({ deleted: [], kept: ['B'] })
  const { say, lines } = reporter()
  await settleRetiredRecords({ client: stillPlaced.client, siteDir: dir, args: [], say })
  assert.deepEqual(stillPlaced.sent, [{ uuids: ['B'], placed: 'keep' }], 'asked without a terminal or --yes: the choice was made')
  assert.deepEqual(stateOf(dir).deleting, { B: '@acme/member' }, 'still placed, so still held')
  assert.equal(lines.length, 0, 'nothing to say while it waits')

  const placedNoMore = deleting()
  await settleRetiredRecords({ client: placedNoMore.client, siteDir: dir, args: [], say })
  assert.deepEqual(placedNoMore.sent, [{ uuids: ['B'], placed: 'keep' }])
  assert.equal(stateOf(dir).deleting, undefined)
  assert.ok(lines.includes("ok Deleted 1 record that another site's folder no longer places."))
})

test('what it says never claims no site serves them: another site\'s folder may still place one', async () => {
  const dir = site({ retired: { A: '@acme/member' } })
  const { say, lines } = reporter()
  await settleRetiredRecords({ client: deleting().client, siteDir: dir, args: [], say })
  assert.doesNotMatch(lines.join('\n'), /no site serves/)
  assert.match(lines[0], /1 record \(of @acme\/member\) that pushes took out of the site's folder stays on the backend/)
})

test('with no terminal and no --yes, nothing is deleted, the list is kept, and it says how to finish', async () => {
  const dir = site({ retired: { A: '@std/project' } })
  const { client, sent } = deleting()
  const { say, lines } = reporter()
  const res = await settleRetiredRecords({ client, siteDir: dir, args: [], say })
  assert.equal(sent.length, 0)
  assert.equal(res.asked, false)
  assert.deepEqual(stateOf(dir).retired, { A: '@std/project' })
  assert.match(lines[0], /push again with --yes, or from a terminal and answer/)
})

test('at a terminal, it asks with the count; a yes deletes, a no keeps them and does not ask again', async () => {
  for (const answer of [true, false]) {
    const dir = site({ retired: { A: '@std/project', B: '@std/project' } })
    const { client, sent } = deleting()
    const { say, lines } = reporter()
    const asked = []
    await atATerminal(() =>
      settleRetiredRecords({ client, siteDir: dir, args: [], say, ask: async (q) => (asked.push(q), answer) })
    )
    assert.match(asked[0], /Delete 2 records \(of @std\/project\) that pushes took out of the site's folder from http:\/\/backend\.test\?/)
    assert.equal(sent.length, answer ? 1 : 0)
    assert.equal(stateOf(dir).retired, undefined, answer ? 'deleted' : 'declined, so not asked again')
    if (!answer) assert.match(lines.join('\n'), /not asked about again/)
  }
})

test('a backend without the delete route keeps them for later; a refusal is said and settles them', async () => {
  const dir = site({ retired: { A: '@std/project' } })
  const { say, lines } = reporter()
  await settleRetiredRecords({ client: deleting(() => new Response(null, { status: 404 })).client, siteDir: dir, args: ['--yes'], say })
  assert.deepEqual(stateOf(dir).retired, { A: '@std/project' }, 'kept for a backend that has the route')
  assert.match(lines.join('\n'), /cannot delete records from the CLI yet/)

  const refused = deleting(() => Response.json({ detail: 'you may not administer A' }, { status: 403 }))
  await settleRetiredRecords({ client: refused.client, siteDir: dir, args: ['--yes'], say })
  assert.equal(stateOf(dir).retired, undefined)
  assert.match(lines.join('\n'), /did not delete them: HTTP 403 — you may not administer A/)
})
