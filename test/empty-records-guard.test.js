// ⛔ THE ONE PATH WHERE AN ORDINARY ACT IS DESTRUCTIVE.
//
// `missing` and `empty` records.yml deliberately mean different things — missing
// leaves the live folder alone, empty says it holds nothing and the backend
// removes what is there. That asymmetry is right: the safe state is the ABSENCE
// of a file, so nobody wipes a folder by deleting something.
//
// What it leaves is a PLACEHOLDER: an empty file created meaning to fill it in.
// The format stays honest and the CLI asks — with a count, so the answer is
// informed rather than reflexive.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { guardEmptyRecords, countPlacedRecords } from '../src/utils/records-guard.js'

const site = (recordsYml, folderItemUuids) => {
  const dir = mkdtempSync(join(tmpdir(), 'empty-records-'))
  writeFileSync(join(dir, 'site.yml'), 'name: T\n')
  if (recordsYml !== null) writeFileSync(join(dir, 'records.yml'), recordsYml)
  if (folderItemUuids) {
    mkdirSync(join(dir, '.uniweb'), { recursive: true })
    writeFileSync(join(dir, '.uniweb', 'sync-cache.json'), JSON.stringify({ folderItemUuids }))
  }
  return dir
}
const silent = () => {}
const NON_INTERACTIVE = ['--non-interactive']

test('countPlacedRecords counts leaves, not branches', () => {
  // A branch's path is a prefix of everything beneath it. Counting raw keys would
  // report a two-record site inside one folder as three things to lose.
  assert.equal(
    countPlacedRecords({ members: 'B1', 'members/alice': 'I1', 'members/bob': 'I2' }),
    2
  )
  assert.equal(countPlacedRecords({ alice: 'I1', bob: 'I2' }), 2)
  assert.equal(countPlacedRecords({}), 0)
  assert.equal(countPlacedRecords(null), 0)
})

test('an empty records.yml over a live folder is refused without confirmation', async () => {
  const dir = site('', { alice: 'I1', bob: 'I2' })
  try {
    const messages = []
    const res = await guardEmptyRecords({
      siteDir: dir,
      args: NON_INTERACTIVE,
      warn: (m) => messages.push(m),
      note: (m) => messages.push(m),
    })
    assert.equal(res.ok, false)
    assert.equal(res.count, 2)
    // ⚠️ The count is the point — "this will remove things" is not actionable
    // without knowing how many, and reflexive confirmation is the failure mode.
    assert.ok(messages.some((m) => m.includes('REMOVE 2 records')), messages.join('\n'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('--yes carries it through, for a deliberate non-interactive run', async () => {
  const dir = site('', { alice: 'I1' })
  try {
    const res = await guardEmptyRecords({ siteDir: dir, args: ['--yes'], warn: silent, note: silent })
    assert.equal(res.ok, true)
    assert.equal(res.count, 1)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a MISSING records.yml is never asked about — it removes nothing', async () => {
  // ⭐ The whole reason the two states differ. Deleting the file is the safe act.
  const dir = site(null, { alice: 'I1', bob: 'I2' })
  try {
    const res = await guardEmptyRecords({ siteDir: dir, args: NON_INTERACTIVE, warn: silent, note: silent })
    assert.equal(res.ok, true)
    assert.equal(res.count, 0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('an empty records.yml on a never-pushed site is never asked about', async () => {
  // Nothing banked ⇒ nothing to lose. Asking here would train people to type y,
  // which is exactly how the real prompt stops working.
  const dir = site('', null)
  try {
    const res = await guardEmptyRecords({ siteDir: dir, args: NON_INTERACTIVE, warn: silent, note: silent })
    assert.equal(res.ok, true)
    assert.equal(res.count, 0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// ⛔ CONTROL. Every case above is a guard NOT firing, or firing on an empty file;
// without this one, a guard that always returned ok would pass four of five and a
// guard that never read the file would pass three.
test('CONTROL — a populated records.yml is never asked about', async () => {
  const dir = site('- article/*.md\n', { alice: 'I1', bob: 'I2' })
  try {
    const res = await guardEmptyRecords({ siteDir: dir, args: NON_INTERACTIVE, warn: silent, note: silent })
    assert.equal(res.ok, true)
    assert.equal(res.count, 0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
