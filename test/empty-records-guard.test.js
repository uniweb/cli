// ⛔ THE ONE PATH WHERE AN ORDINARY ACT IS DESTRUCTIVE.
//
// A push sends the site's records folder whole. No records directory sends none —
// the backend's folder is left alone; a records directory holding no records sends
// an EMPTY folder, and the backend removes what is there. That asymmetry is right:
// the safe state is the ABSENCE of the directory.
//
// What it leaves is a directory emptied by accident, or kept with only a
// placeholder. The CLI asks — with a count, so the answer is informed rather than
// reflexive. (Until 2026-09-21 the two states were `records.yml`'s, when that file
// listed the records.)
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { guardEmptyRecords, countPlacedRecords } from '../src/utils/records-guard.js'

const ORIGIN = 'http://x'

// `records`: null → no records directory; [] → an empty one (a placeholder only);
// a list → those record files.
const site = (records, folderItemUuids) => {
  const dir = mkdtempSync(join(tmpdir(), 'empty-records-'))
  writeFileSync(join(dir, 'site.yml'), 'name: T\n')
  if (records !== null) {
    mkdirSync(join(dir, 'records'), { recursive: true })
    writeFileSync(join(dir, 'records', '.gitkeep'), '')
    for (const rel of records) {
      mkdirSync(dirname(join(dir, 'records', rel)), { recursive: true })
      writeFileSync(join(dir, 'records', rel), '---\ntitle: X\n---\n')
    }
  }
  if (folderItemUuids) {
    writeFileSync(
      join(dir, 'sync.json'),
      JSON.stringify({ version: 1, backends: { [ORIGIN]: { folders: folderItemUuids } } })
    )
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

test('an empty records directory over a pushed folder is refused without confirmation', async () => {
  const dir = site([], { alice: 'I1', bob: 'I2' })
  try {
    const messages = []
    const res = await guardEmptyRecords({
      siteDir: dir,
      backend: ORIGIN,
      args: NON_INTERACTIVE,
      warn: (m) => messages.push(m),
      note: (m) => messages.push(m),
    })
    assert.equal(res.ok, false)
    assert.equal(res.count, 2)
    // ⚠️ The count is the point — "this will remove things" is not actionable
    // without knowing how many, and reflexive confirmation is the failure mode.
    assert.ok(messages.some((m) => m.includes('REMOVE 2 records')), messages.join('\n'))
    assert.ok(messages.some((m) => m.includes('records/ holds no records')), messages.join('\n'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('--yes carries it through, for a deliberate non-interactive run', async () => {
  const dir = site([], { alice: 'I1' })
  try {
    const res = await guardEmptyRecords({ siteDir: dir, backend: ORIGIN, args: ['--yes'], warn: silent, note: silent })
    assert.equal(res.ok, true)
    assert.equal(res.count, 1)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('NO records directory is never asked about — it removes nothing', async () => {
  // ⭐ The whole reason the two states differ: a site whose records live only on the
  // backend is not emptied by a push of its pages.
  const dir = site(null, { alice: 'I1', bob: 'I2' })
  try {
    const res = await guardEmptyRecords({ siteDir: dir, backend: ORIGIN, args: NON_INTERACTIVE, warn: silent, note: silent })
    assert.equal(res.ok, true)
    assert.equal(res.count, 0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('an empty records directory on a never-pushed site is never asked about', async () => {
  // Nothing banked ⇒ nothing to lose. Asking here would train people to type y,
  // which is exactly how the real prompt stops working.
  const dir = site([], null)
  try {
    const res = await guardEmptyRecords({ siteDir: dir, backend: ORIGIN, args: NON_INTERACTIVE, warn: silent, note: silent })
    assert.equal(res.ok, true)
    assert.equal(res.count, 0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// ⛔ CONTROL. Every case above is a guard NOT firing, or firing on an empty
// directory; without this one, a guard that always returned ok would pass four of
// five and a guard that never read the directory would pass three.
test('CONTROL — a directory holding records is never asked about', async () => {
  const dir = site(['article/hello.md'], { alice: 'I1', bob: 'I2' })
  try {
    const res = await guardEmptyRecords({ siteDir: dir, backend: ORIGIN, args: NON_INTERACTIVE, warn: silent, note: silent })
    assert.equal(res.ok, true)
    assert.equal(res.count, 0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// ⛔ The count is read under a BACKEND — placements are banked per backend — so a
// caller that passes none counts zero and never asks. `publish` did exactly that
// until 2026-09-21: it sent an empty folder without a word while `push` stopped.
test('both verbs name the backend the count is read under', () => {
  const here = dirname(fileURLToPath(import.meta.url))
  for (const verb of ['push', 'publish']) {
    const src = readFileSync(join(here, '..', 'src', 'commands', `${verb}.js`), 'utf8')
    const call = src.slice(src.indexOf('guardEmptyRecords({'), src.indexOf('guardEmptyRecords({') + 200)
    assert.match(call, /backend: client\.origin/, `${verb}.js calls guardEmptyRecords without backend`)
  }
})
