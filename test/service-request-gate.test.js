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
function siteDir({ services, record, site = { uuid: 'SITE-1' } } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'settle-services-'))
  made.push(dir)
  const siteYml = { name: 'Acme', foundation: '@a/base', ...(services ? { services } : {}) }
  writeFileSync(join(dir, 'site.yml'), yaml.dump(siteYml))
  const entry = { ...(site ? { site } : {}), ...(record ? { services: record } : {}) }
  if (Object.keys(entry).length) {
    writeFileSync(join(dir, 'sync.json'), JSON.stringify({ version: 1, backends: { [ORIGIN]: entry } }))
  }
  return dir
}

const readSiteYml = (dir) => yaml.load(readFileSync(join(dir, 'site.yml'), 'utf8'))
const readRecord = (dir) => {
  try {
    return JSON.parse(readFileSync(join(dir, 'sync.json'), 'utf8')).backends[ORIGIN]?.services
  } catch {
    return undefined
  }
}

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
  assert.deepEqual(readRecord(dir), [API_STARTER, { name: 'search' }])
})

test('a setting the owner changes goes over the stored ones, key by key', async () => {
  const dir = siteDir({ services: { api: { grade: 'pro' } }, record: [API_STARTER] })
  const { emit } = await settle(dir, { stored: [API_STARTER] })
  assert.deepEqual(emit.serviceRows, [
    { name: 'api', config: { grade: 'pro', auth: { providers: ['google'] } } }
  ])
})

test("⭐ the site moved and the file did not → the site's is kept, offered, and still offered next time", async () => {
  const dir = siteDir({ services: { search: true }, record: [{ name: 'search' }] })
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
    record: [{ name: 'search' }, { name: 'submit' }]
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
    record: [{ name: 'api', config: { grade: 'starter' } }]
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
    record: [{ name: 'api', config: { grade: 'starter' } }]
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

test('⛔ an existing site this project cannot read and holds no record of gets nothing', async () => {
  const dir = siteDir({ services: { search: true } })
  const run = await settle(dir, { stored: undefined })
  assert.deepEqual(run.emit, {})
  assert.match(run.said, /could not read them, so none were sent/)
  assert.match(run.said, /uniweb pull/)
})

test('a site not created yet has nothing stored — the file is the list', async () => {
  const dir = siteDir({ services: { search: true, submit: false }, site: null })
  const run = await settle(dir, {})
  assert.deepEqual(run.emit.serviceRows, [{ name: 'search' }, { name: 'submit', enabled: false }])
})

test('the site unreadable: what changed against the record is sent over it…', async () => {
  const dir = siteDir({ services: { search: false }, record: [API_STARTER, { name: 'search' }] })
  const run = await settle(dir, { stored: undefined })
  assert.deepEqual(run.emit.serviceRows, [API_STARTER, { name: 'search', enabled: false }])
})

test('…and with nothing changed, nothing is sent — the record may be stale', async () => {
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
  assert.deepEqual(result.emit.serviceRows, [{ name: 'search', enabled: false }])
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

test('a value it cannot read is said, with where it belongs', async () => {
  const dir = siteDir({ services: { submit: '/forms', search: true }, record: [] })
  const run = await settle(dir, { stored: [] })
  assert.match(run.said, /services\.submit` is true, false, or a map/)
  assert.match(run.said, /top-level `submit:` key/)
  assert.deepEqual(run.emit.serviceRows, [{ name: 'search' }])
})
