/**
 * Conformance on the shipping paths — `publish` / `push` / `deploy`.
 *
 * Until this existed, `uniweb validate` was the ONLY caller of the conformance
 * checker, so a malformed data block built clean, deployed clean, and synced to
 * a backend with nothing having checked it anywhere. The first symptom was a
 * section rendering nothing on a live site.
 *
 * What these tests pin is not the checking — `@uniweb/build` owns that and
 * tests it — but the three properties that make an advisory check safe to run
 * inside a command whose actual job is to ship:
 *
 *   1. on a STATIC host it NEVER blocks, and never throws into its caller, even
 *      when the checker itself explodes. A warning that can abort a deploy is a
 *      regression with no upside. ⭐ On a BACKEND (`push`, `publish`) a violation
 *      stops the ship before anything is sent — the backend enforces the schemas
 *      the push registers (2026-09-24); see the tests at the end.
 *   2. it is SILENT unless it has something to say — including when it cannot
 *      check at all, which is the common case for the registry-ref sites
 *      `publish` is normally used on. A line on every deploy saying what was
 *      not done teaches people to skim the block, including the times it fires.
 *   3. `--no-validate` suppresses it, so a user who knows can ship quietly.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  warnIfContentDoesNotConform,
  refuseIfContentDoesNotConform,
  formatConformanceWarning
} from '../src/utils/conformance.js'

/** Strip ANSI so assertions read as prose rather than escape codes. */
const plain = (s) => s.replace(/\x1b\[[0-9;]*m/g, '')

/** Collect what the check would print instead of writing it to a terminal. */
function collector() {
  const lines = []
  return {
    lines,
    warn: (m) => lines.push(`warn: ${m}`),
    dim: (m) => lines.push(`dim: ${m}`)
  }
}

function makeSite(files = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'conformance-'))
  for (const [rel, body] of Object.entries(files)) {
    const p = join(dir, rel)
    mkdirSync(join(p, '..'), { recursive: true })
    writeFileSync(p, body)
  }
  return dir
}

test('says nothing when there is no workspace to check in', async () => {
  const dir = makeSite({ 'site.yml': 'foundation: src\n' })
  const out = collector()
  const n = await warnIfContentDoesNotConform(dir, out)
  assert.equal(n, 0)
  assert.deepEqual(out.lines, [])
  rmSync(dir, { recursive: true, force: true })
})

test('says nothing when the site declares no foundation', async () => {
  const dir = makeSite({ 'site.yml': 'title: A site\n' })
  const out = collector()
  const n = await warnIfContentDoesNotConform(dir, out)
  assert.equal(n, 0)
  assert.deepEqual(out.lines, [])
  rmSync(dir, { recursive: true, force: true })
})

test('`--no-validate` suppresses it without running anything', async () => {
  const dir = makeSite({ 'site.yml': 'foundation: src\n' })
  const out = collector()
  const n = await warnIfContentDoesNotConform(dir, { ...out, args: ['--no-validate'] })
  assert.equal(n, 0)
  assert.deepEqual(out.lines, [])
  rmSync(dir, { recursive: true, force: true })
})

/**
 * The property that matters most, and the one a shipping path cannot get
 * wrong: whatever goes wrong inside the check, the caller continues. A
 * non-existent directory is the cheapest way to make the resolution fail for
 * real rather than by mocking it.
 */
test('never throws into its caller when the check itself fails', async () => {
  const out = collector()
  const n = await warnIfContentDoesNotConform(
    join(tmpdir(), 'conformance-does-not-exist-' + Date.now()),
    out
  )
  assert.equal(n, 0)
  assert.deepEqual(out.lines, [])
})

test('a null site dir does not throw either', async () => {
  const out = collector()
  assert.equal(await warnIfContentDoesNotConform(null, out), 0)
  assert.equal(await warnIfContentDoesNotConform(undefined, out), 0)
  assert.deepEqual(out.lines, [])
})

/**
 * The positive path.
 *
 * Every test above passes equally well against a function that can never warn,
 * so on its own that suite asserts its own inertness. These assert the shape of
 * the thing it is supposed to produce.
 */
test('formats a finding, and says the ship is proceeding', () => {
  const out = formatConformanceWarning(
    {
      foundation: 'src',
      report: {
        violations: [
          {
            file: '/site/pages/home/3-quote.md',
            item: 'data.form',
            field: '',
            message: 'expected a list of records, got object'
          }
        ],
        setupErrors: []
      }
    },
    '/site'
  )

  assert.equal(out.total, 1)
  assert.equal(
    plain(out.headline),
    'Found 1 content record that does not match the schemas src declares.'
  )
  // The path is relative to the site, and an absent `field` leaves no dangling
  // separator behind it.
  assert.equal(
    out.details[0],
    '• pages/home/3-quote.md — item "data.form": expected a list of records, got object'
  )
  // A warning during a ship reads as a refusal unless it says otherwise.
  assert.match(out.details.at(-1), /Shipping anyway.*uniweb validate/)
})

test('names a field when the finding has one, and pluralizes', () => {
  const v = (item, field) => ({ file: 'a.md', item, field, message: 'nope' })
  const out = formatConformanceWarning(
    { foundation: 'f', report: { violations: [v('x', 'title'), v('y', 'date')], setupErrors: [] } },
    ''
  )
  assert.equal(out.total, 2)
  assert.match(plain(out.headline), /^Found 2 content records that do not match/)
  assert.equal(out.details[0], '• a.md — item "x" › title: nope')
})

test('summarizes the tail rather than printing every finding into a deploy log', () => {
  const violations = Array.from({ length: 9 }, (_, i) => ({
    file: 'a.md',
    item: `i${i}`,
    field: 'f',
    message: 'nope'
  }))
  const out = formatConformanceWarning({ foundation: 'f', report: { violations, setupErrors: [] } }, '')

  assert.equal(out.total, 9)
  // Three findings, the tail summary, and the closing line.
  assert.equal(out.details.length, 5)
  assert.equal(out.details[3], '…and 6 more')
})

test('setup errors count too — a schema that could not be read is not "clean"', () => {
  const out = formatConformanceWarning(
    {
      foundation: 'f',
      report: { violations: [], setupErrors: [{ file: 'x.yml', message: 'unreadable' }] }
    },
    ''
  )
  assert.equal(out.total, 1)
  assert.equal(out.details[0], '• x.yml — unreadable')
})

test('returns null when everything conforms', () => {
  assert.equal(
    formatConformanceWarning({ foundation: 'f', report: { violations: [], setupErrors: [] } }, ''),
    null
  )
})

/**
 * ⛔ A setup error is not a record that failed a schema, and the headline must
 * not say it is.
 *
 * `validateDataInputs` reports two kinds into one block. A **violation** is a
 * record whose value disagrees with a schema — the reader should go look at
 * their data. A **setup error** is data that could not be read, or that never
 * reached the section meant to read it — the reader should go look at their
 * `page.yml` and `meta.js`, and there is no offending record to find.
 *
 * One sentence covering both sent people on the wrong search, and the wrong
 * search here is the one that ends in "the framework is broken".
 */
test('a wiring problem is not reported as a bad record', () => {
  const out = formatConformanceWarning(
    {
      foundation: 'src',
      report: {
        violations: [],
        setupErrors: [{ file: '/team · Team', message: 'section reads content.data.team', users: [] }]
      }
    },
    '/site'
  )
  assert.equal(plain(out.headline), 'Found 1 problem with how data reaches your sections.')
  assert.doesNotMatch(plain(out.headline), /content record/)
})

test('both kinds at once are counted and named separately', () => {
  const out = formatConformanceWarning(
    {
      foundation: 'src',
      report: {
        violations: [{ file: 'a.md', item: 'x', field: 'title', message: 'nope' }],
        setupErrors: [
          { file: '/team · Team', message: 'reads content.data.team', users: [] },
          { file: '/blog · List', message: 'reads content.data.posts', users: [] }
        ]
      }
    },
    '/site'
  )
  assert.equal(out.total, 3)
  assert.equal(
    plain(out.headline),
    'Found 1 content record that does not match the schemas src declares ' +
      'and 2 problems with how data reaches your sections.'
  )
})


// ── on a backend, a gate ─────────────────────────────────────────────────────
// `push` and `publish` register the foundation first, so the backend checks the
// records against the very schemas checked here: a violation is a refusal on
// arrival, or a value lost on the way. [Diego, 2026-09-24] — the warn-and-ship rule
// "was in the context of static sites. It was never meant for pushed sites."

/** A workspace with a local foundation whose `@/member` a section binds. */
function makeWorkspace(member) {
  return makeSite({
    'pnpm-workspace.yaml': 'packages:\n  - foundation\n  - site\n',
    'package.json': JSON.stringify({ name: 'ws', private: true }),
    'foundation/package.json': JSON.stringify({ name: 'foundation', type: 'module', main: './_entry.generated.js' }),
    'foundation/main.js': 'export default {}\n',
    'foundation/schemas/member.yml': 'name: member\nfields:\n  name: { type: string, required: true }\n  joined: { type: date }\n',
    'foundation/sections/Team/meta.js': "export default { title: 'Team', data: { members: '@/member' } }\n",
    'site/site.yml': 'name: s\nfoundation: foundation\nqueries:\n  members:\n    schema: "@/member"\n',
    'site/theme.yml': '',
    'site/pages/team/page.yml': 'title: Team\n',
    'site/pages/team/team.md': '---\ntype: Team\nquery: members\n---\n\n# Team\n',
    'site/records/member/ada.yml': member
  })
}

function refusalCollector() {
  const lines = []
  return {
    lines,
    error: (m) => lines.push(`error: ${plain(m)}`),
    warn: (m) => lines.push(`warn: ${plain(m)}`),
    dim: (m) => lines.push(`dim: ${plain(m)}`)
  }
}

test('push/publish: a record that does not conform stops the ship, saying nothing was sent', async () => {
  const ws = makeWorkspace('name: Ada\njoined: March 2021\n')
  try {
    const out = refusalCollector()
    const stopped = await refuseIfContentDoesNotConform(join(ws, 'site'), out)
    assert.equal(stopped, 1)
    assert.match(out.lines[0], /^error: Found 1 content record that does not match/)
    assert.ok(out.lines.some((l) => /joined: "March 2021" is not a date/.test(l)), out.lines.join('\n'))
    assert.match(out.lines.at(-1), /Nothing was sent.*--no-validate/)
  } finally {
    rmSync(ws, { recursive: true, force: true })
  }
})

test('CONTROL — a record that conforms lets the ship go on, silently', async () => {
  const ws = makeWorkspace('name: Ada\njoined: 2021-03-15\n')
  try {
    const out = refusalCollector()
    assert.equal(await refuseIfContentDoesNotConform(join(ws, 'site'), out), 0)
    assert.deepEqual(out.lines, [])
  } finally {
    rmSync(ws, { recursive: true, force: true })
  }
})

test('`--no-validate` leaves the records to the backend — nothing is checked', async () => {
  const ws = makeWorkspace('joined: March 2021\n')
  try {
    const out = refusalCollector()
    assert.equal(await refuseIfContentDoesNotConform(join(ws, 'site'), { ...out, args: ['--no-validate'] }), 0)
    assert.deepEqual(out.lines, [])
  } finally {
    rmSync(ws, { recursive: true, force: true })
  }
})

test('the refusal wording says what did not happen', () => {
  const out = formatConformanceWarning(
    { foundation: 'src', report: { violations: [{ file: '/s/x.yml', item: 'a', field: 'name', message: 'missing' }], setupErrors: [] } },
    '/s',
    { stops: true }
  )
  assert.match(out.details.at(-1), /^Nothing was sent\./)
})
