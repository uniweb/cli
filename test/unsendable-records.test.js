// ⛔ A RECORD THE BACKEND WOULD REFUSE STOPS THE PUSH BEFORE ANYTHING IS SENT.
//
// Measured 2026-09-23: a record written by section went up with an empty brief, the
// backend refused the records lane over its required field — and, before the
// backend's push became one transaction (2026-09-24), the lane had already written
// the folder's entries and entities with no data, so every later push of the site's
// records was refused.
//
// The emit names such records (`refusals`, `@uniweb/build`'s `recordsToEntities`);
// these pin that push and publish stop on them — and stop EARLY, before the site is
// created or a byte uploaded, since those are writes a refused records lane does not
// undo.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { refuseUnsendableRecords } from '../src/backend/site-sync.js'

const collect = () => {
  const said = { error: [], note: [] }
  return { said, report: { error: (m) => said.error.push(m), note: (m) => said.note.push(m) } }
}

test('refuseUnsendableRecords stops the caller and names every record', () => {
  const { said, report } = collect()
  const stop = refuseUnsendableRecords(
    ['event/launch: "details" is a section of @acme/event, …', 'member/dave: @acme/member requires "name", …'],
    report
  )
  assert.equal(stop, true)
  assert.deepEqual(said.error, ['2 records cannot be pushed as written — no content was sent.'])
  assert.equal(said.note.length, 2)
  assert.match(said.note[0], /event\/launch/)
})

test('CONTROL — with nothing refused it says nothing and lets the caller go on', () => {
  const { said, report } = collect()
  assert.equal(refuseUnsendableRecords([], report), false)
  assert.equal(refuseUnsendableRecords(undefined, report), false)
  assert.deepEqual(said, { error: [], note: [] })
})

// ⭐ Structural on purpose, like `every media upload names the owner it is charged
// to, after the create` (asset-upload.test.js): the helper is right on its own, and
// the defect would be a command that calls it too late or not at all.
test('every command that creates a site refuses unsendable records before creating it, and again before sending', () => {
  const cmds = join(dirname(fileURLToPath(import.meta.url)), '../src/commands')
  const late = []
  const unguarded = []
  let commands = 0
  for (const f of readdirSync(cmds).filter((n) => n.endsWith('.js'))) {
    // Line comments stripped: a comment naming the helper must not count as a call.
    const text = readFileSync(join(cmds, f), 'utf8').replace(/\/\/[^\n]*/g, '')
    const create = text.indexOf('ensureSiteExists(')
    if (create === -1) continue
    commands++
    const first = text.indexOf('refuseUnsendableRecords(')
    if (first === -1 || first > create) late.push(f)
    // The send — `-o` and `--dry-run` never reach the probe, so the check after the
    // main emit is theirs.
    const send = text.indexOf('pushSyncPackages(')
    const last = text.lastIndexOf('refuseUnsendableRecords(', send)
    if (send === -1 || last === -1 || last <= create) unguarded.push(f)
  }
  // CONTROL: a scan that finds no command passes over nothing.
  assert.ok(commands >= 2, `expected push and publish, found ${commands}`)
  assert.deepEqual(late, [], 'the site is created before an unsendable record is refused')
  assert.deepEqual(unguarded, [], 'no refusal between the main emit and the send')
})
