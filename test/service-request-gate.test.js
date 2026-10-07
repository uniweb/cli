/**
 * The requests a push or publish carries — the services `site.yml` asks for, and the
 * language selection.
 *
 * ⭐ The services cases that matter most are the two silent failures: a stale ask
 * re-sent over a decision the owner made in the app, and a partial list that drops
 * the site's other rows. Each `settleServices` case below is one row of
 * kb/framework/reference/site-services-request.md §4, run through the step push and
 * publish share — a site directory, `sync.json`, and a backend that answers the
 * status read.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import yaml from 'js-yaml'

import {
  fingerprintDeclaration,
  reconcile,
  bankLanguages,
  settleServices
} from '../src/backend/service-request.js'

// ── fingerprints and the language selection ────────────────────────────────

test('absent and empty are different fingerprints', () => {
  assert.equal(fingerprintDeclaration(undefined), null)
  assert.equal(fingerprintDeclaration(null), null)
  assert.notEqual(fingerprintDeclaration([]), null)
  assert.notEqual(fingerprintDeclaration([]), fingerprintDeclaration(['en']))
})

test('reordering entries or keys is not a change', () => {
  assert.equal(fingerprintDeclaration(['en', 'fr']), fingerprintDeclaration(['fr', 'en']))
  assert.equal(
    fingerprintDeclaration([{ a: 1, b: { c: 2, d: 3 } }]),
    fingerprintDeclaration([{ b: { d: 3, c: 2 }, a: 1 }])
  )
})

test('⛔ the fingerprint leaks no value — it is a hash, and deploy.yml is committed', () => {
  const fp = fingerprintDeclaration(['super-secret-token'])
  assert.match(fp, /^[0-9a-f]{16}$/)
  assert.ok(!fp.includes('secret'))
})

test('publishLanguages is banked, so a later edit reads as intentional', () => {
  const banked = bankLanguages({ publishLanguages: ['en', 'fr'] })
  assert.ok(banked.publishLanguagesRequest, 'the selection must be banked at all')
  assert.equal(reconcile(['en', 'fr'], ['en', 'fr'], banked.publishLanguagesRequest).action, 'none')
  // The owner adds one → a real ask, and this one moves the price.
  assert.equal(reconcile(['en', 'fr', 'es'], ['en', 'fr'], banked.publishLanguagesRequest).action, 'send')
  // CONTROL — with no base the same edit cannot be told from the status quo.
  assert.equal(reconcile(['en', 'fr', 'es'], ['en', 'fr'], undefined).action, 'conflict')
})

test('the site moved and the file did not → adopt, not send', () => {
  const banked = bankLanguages({ publishLanguages: ['en', 'fr'] })
  assert.equal(reconcile(['en', 'fr'], ['en'], banked.publishLanguagesRequest).action, 'adopt')
})

test('a file that declares no selection asks nothing — never a conflict', () => {
  assert.equal(reconcile(undefined, [], null).action, 'none')
  assert.equal(reconcile(undefined, ['en'], null).action, 'adopt')
  assert.deepEqual(bankLanguages({}), {})
})

// ── the services ────────────────────────────────────────────────────────────

const ORIGIN = 'http://backend.test'
const made = []
process.on('exit', () => {
  for (const d of made) rmSync(d, { recursive: true, force: true })
})

/**
 * A site directory: `site.yml` with `services`, and this backend's entry in sync.json.
 * `site` defaults to an existing site; pass `site: null` for one not created yet.
 */
function siteDir({ services, record, named, site = { uuid: 'SITE-1' } } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'settle-services-'))
  made.push(dir)
  const siteYml = { name: 'Acme', foundation: '@a/base', ...(services ? { services } : {}) }
  writeFileSync(join(dir, 'site.yml'), yaml.dump(siteYml))
  const entry = {
    ...(site ? { site } : {}),
    ...(record ? { services: record } : {}),
    ...(named ? { servicesNamed: named } : {})
  }
  if (Object.keys(entry).length) {
    writeFileSync(join(dir, 'sync.json'), JSON.stringify({ version: 1, backends: { [ORIGIN]: entry } }))
  }
  return dir
}

const readSiteYml = (dir) => yaml.load(readFileSync(join(dir, 'site.yml'), 'utf8'))
const readEntry = (dir) => {
  try {
    return JSON.parse(readFileSync(join(dir, 'sync.json'), 'utf8')).backends[ORIGIN] || {}
  } catch {
    return {}
  }
}
const readRecord = (dir) => readEntry(dir).services
const readNamed = (dir) => readEntry(dir).servicesNamed

/** Run the step as push does: the site's rows come from a status read. */
async function settle(dir, { stored, answer = false, interactive = true, offline = false } = {}) {
  const said = []
  const asked = []
  const say = Object.fromEntries(
    ['info', 'warn', 'dim', 'ok'].map((level) => [level, (m) => said.push(`${level}: ${m}`)])
  )
  const client = {
    origin: ORIGIN,
    siteStatus: async () => (stored === undefined ? null : { services: stored })
  }
  const result = await settleServices({
    client,
    siteDir: dir,
    siteYml: readSiteYml(dir),
    offline,
    interactive,
    confirm: async (question) => {
      asked.push(question)
      return answer
    },
    say
  })
  return { ...result, said: said.join('\n'), asked }
}

const API_STARTER = { name: 'api', config: { grade: 'starter', auth: { providers: ['google'] } } }

test('a file that asks nothing sends nothing and records nothing', async () => {
  const dir = siteDir({ record: [API_STARTER] })
  const { emit, after } = await settle(dir, { stored: [API_STARTER] })
  assert.deepEqual(emit, {})
  after()
  assert.deepEqual(readRecord(dir), [API_STARTER])
})

test("⭐ what the owner changed is sent — over the site's own list, nothing dropped", async () => {
  const dir = siteDir({ services: { search: true }, record: [API_STARTER] })
  const { emit, after, said } = await settle(dir, { stored: [API_STARTER] })
  assert.deepEqual(emit.serviceRows, [API_STARTER, { name: 'search' }])
  assert.match(said, /Asking for: search on/)
  after()
  // The full list is the record; only what the file names counts as named.
  assert.deepEqual(readRecord(dir), [API_STARTER, { name: 'search' }])
  assert.deepEqual(readNamed(dir), ['search'])
})

test('⭐ a service the file named before is sent as written — a setting removed from it is removed', async () => {
  const dir = siteDir({ services: { api: { grade: 'pro' } }, record: [API_STARTER], named: ['api'] })
  const { emit } = await settle(dir, { stored: [API_STARTER] })
  assert.deepEqual(emit.serviceRows, [{ name: 'api', config: { grade: 'pro' } }])
})

test('⭐ deleting an option in site.yml deletes it on the site', async () => {
  const excluded = { name: 'search', config: { exclude: { routes: ['/legal'] } } }
  const dir = siteDir({ services: { search: true }, record: [excluded], named: ['search'] })
  const { emit, after, said } = await settle(dir, { stored: [excluded] })
  assert.deepEqual(emit.serviceRows, [{ name: 'search' }])
  assert.match(said, /Asking for: search on/)
  after()
  assert.deepEqual(readRecord(dir), [{ name: 'search' }])
})

test("⭐ a service the file names for the first time is asked about — never sent over the app's settings", async () => {
  // The app set App Services' grade; a push sent the api row as stored, so the record
  // holds it — but the file never named api, so it never had the grade.
  const graded = { name: 'api', config: { grade: 'pro' } }
  const dir = siteDir({
    services: { search: true, api: true },
    record: [{ name: 'search' }, graded],
    named: ['search']
  })
  const run = await settle(dir, { stored: [{ name: 'search' }, graded], interactive: false })
  assert.match(run.said, /asks for services your site has set differently/)
  assert.match(run.said, /api: site\.yml asks on — your site has on \(grade: pro\)/)
  assert.deepEqual(run.emit.serviceRows, [{ name: 'search' }, graded], 'the grade stays')
  run.after()
  // Still undecided, so still not one the file named: the next run asks again.
  assert.deepEqual(readNamed(dir), ['search'])
})

test("⭐ the site moved and the file did not → the site's is kept, offered, and still offered next time", async () => {
  const dir = siteDir({ services: { search: true }, record: [{ name: 'search' }], named: ['search'] })
  const off = [{ name: 'search', enabled: false }]

  const first = await settle(dir, { stored: off, answer: false })
  assert.deepEqual(first.asked, ['Update site.yml to match?'])
  // Nothing of the file's is applied: the site's decision is what goes back.
  assert.deepEqual(first.emit.serviceRows, off)
  first.after()
  // Declined: site.yml as the owner wrote it, and the record keeps the earlier agreement…
  assert.deepEqual(readSiteYml(dir).services, { search: true })
  assert.deepEqual(readRecord(dir), [{ name: 'search' }])

  // …so the next run still sees the SITE as the one that moved — never the file.
  const second = await settle(dir, { stored: off, answer: false })
  assert.deepEqual(second.emit.serviceRows, off)
  assert.deepEqual(second.asked, ['Update site.yml to match?'])
})

test("⭐ taking the site's writes site.yml — and the site's next change is the site's again", async () => {
  const dir = siteDir({
    services: { search: true, submit: true },
    record: [{ name: 'search' }, { name: 'submit' }],
    named: ['search', 'submit']
  })
  const off = [{ name: 'search', enabled: false }, { name: 'submit' }]

  const first = await settle(dir, { stored: off, answer: true })
  assert.deepEqual(readSiteYml(dir).services, { search: false, submit: true })
  first.after()
  assert.deepEqual(readRecord(dir), off)

  // Nothing changed anywhere: nothing to ask.
  const second = await settle(dir, { stored: off })
  assert.deepEqual(second.asked, [])
  assert.doesNotMatch(second.said, /Asking for/)

  // The app turns search back on: the site moved, the file did not.
  const third = await settle(dir, { stored: [{ name: 'search' }, { name: 'submit' }] })
  assert.deepEqual(third.asked, ['Update site.yml to match?'])
  assert.doesNotMatch(third.said, /both changed/)
})

test('⛔ both moved → asked; without a terminal nothing of it is sent, and it stays open', async () => {
  const dir = siteDir({
    services: { api: { grade: 'pro' } },
    record: [{ name: 'api', config: { grade: 'starter' } }],
    named: ['api']
  })
  const team = [{ name: 'api', config: { grade: 'team' } }]

  const run = await settle(dir, { stored: team, interactive: false })
  assert.match(run.said, /both changed since your last sync/)
  assert.match(run.said, /api: site\.yml asks on \(grade: pro\) — your site has on \(grade: team\)/)
  assert.deepEqual(run.emit.serviceRows, team, "the site's decision is what goes back")
  run.after()
  assert.deepEqual(readRecord(dir), [{ name: 'api', config: { grade: 'starter' } }])
})

test('both moved, and the owner chooses the file → sent', async () => {
  const dir = siteDir({
    services: { api: { grade: 'pro' } },
    record: [{ name: 'api', config: { grade: 'starter' } }],
    named: ['api']
  })
  const run = await settle(dir, { stored: [{ name: 'api', config: { grade: 'team' } }], answer: true })
  assert.equal(run.asked[0], 'Use the services in site.yml?')
  assert.deepEqual(run.emit.serviceRows, [{ name: 'api', config: { grade: 'pro' } }])
})

test('no record (a project that never pulled): a service the site holds differently is asked', async () => {
  const dir = siteDir({ services: { search: true } })
  const run = await settle(dir, { stored: [{ name: 'search', enabled: false }], interactive: false })
  assert.match(run.said, /asks for services your site has set differently/)
  assert.deepEqual(run.emit.serviceRows, [{ name: 'search', enabled: false }])
})

test('no record: a service the site holds nothing for is sent', async () => {
  const dir = siteDir({ services: { search: true } })
  const run = await settle(dir, { stored: [API_STARTER] })
  assert.deepEqual(run.emit.serviceRows, [API_STARTER, { name: 'search' }])
})

test("⛔ an existing site whose services cannot be read gets none — the list goes whole", async () => {
  const dir = siteDir({ services: { search: true } })
  const run = await settle(dir, { stored: undefined })
  assert.deepEqual(run.emit, { declareServices: false })
  assert.match(run.said, /could not be read, so none were sent/)
})

test('a site not created yet has nothing stored — the file is the list', async () => {
  const dir = siteDir({ services: { search: true, submit: false }, site: null })
  const run = await settle(dir, {})
  assert.deepEqual(run.emit.serviceRows, [{ name: 'search' }, { name: 'submit', enabled: false }])
})

test('⛔ the site unreadable: a change is not sent over the record — the site may hold more since', async () => {
  const dir = siteDir({ services: { search: false }, record: [API_STARTER, { name: 'search' }], named: ['search'] })
  const run = await settle(dir, { stored: undefined })
  assert.deepEqual(run.emit, { declareServices: false })
})

test('…nor, with nothing changed, is the record re-sent', async () => {
  const dir = siteDir({ services: { search: true }, record: [{ name: 'search' }] })
  const run = await settle(dir, { stored: undefined })
  assert.deepEqual(run.emit, { declareServices: false })
})

test('offline (`--dry-run`, `-o`) reads nothing from the backend', async () => {
  const dir = siteDir({ services: { search: false }, record: [{ name: 'search' }] })
  let reads = 0
  const result = await settleServices({
    client: {
      origin: ORIGIN,
      siteStatus: async () => {
        reads++
        return { services: [] }
      }
    },
    siteDir: dir,
    siteYml: readSiteYml(dir),
    offline: true,
    interactive: false,
    confirm: async () => false,
    say: { info: () => {}, warn: () => {}, dim: () => {}, ok: () => {} }
  })
  assert.equal(reads, 0)
  // Without the site's services the full list cannot be built, so none go.
  assert.deepEqual(result.emit, { declareServices: false })
})

test('publish hands in the status it already read — no second read', async () => {
  const dir = siteDir({ services: { search: true }, record: [] })
  let reads = 0
  const result = await settleServices({
    client: { origin: ORIGIN, siteStatus: async () => (reads++, null) },
    siteDir: dir,
    siteYml: readSiteYml(dir),
    status: { services: [] },
    interactive: false,
    confirm: async () => false,
    say: { info: () => {}, warn: () => {}, dim: () => {}, ok: () => {} }
  })
  assert.equal(reads, 0)
  assert.deepEqual(result.emit.serviceRows, [{ name: 'search' }])
})

test('a value it cannot read is said', async () => {
  const dir = siteDir({ services: { submit: 3, search: true }, record: [] })
  const run = await settle(dir, { stored: [] })
  assert.match(run.said, /services\.submit` is true, false, an address, or a map/)
  assert.deepEqual(run.emit.serviceRows, [{ name: 'search' }])
})

test('⭐ an address is the site\'s own provider: the host is asked to leave its own off, and told why', async () => {
  const dir = siteDir({ services: { submit: 'https://forms.example.com/f/abc' }, record: [{ name: 'submit' }], named: ['submit'] })
  const run = await settle(dir, { stored: [{ name: 'submit' }] })
  // The address rides in the row's `config`, the one place for the whole entry.
  assert.deepEqual(run.emit.serviceRows, [
    { name: 'submit', enabled: false, config: { endpoint: 'https://forms.example.com/f/abc' } }
  ])
  assert.match(run.said, /Asking for: submit off — your own at https:\/\/forms\.example\.com\/f\/abc/)
})
