/**
 * uniweb clone — verb structure, mock-backed.
 *
 * Drives clone with an injected fetch (a synthetic site-content document),
 * getToken (no auth), and skipInstall/skipPull (no spawn), into a temp cwd, and
 * asserts the harness scaffold + uuid seeding. The projection itself is delegated
 * to `uniweb pull` (covered by pull.test.js); here we pin clone's own job:
 * read seeds → scaffold a ref-only site → seed $uuid.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import yaml from 'js-yaml'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { repoOf, historySyncPoint, readSyncPoint } from '../src/utils/sync-point.js'
import {
  clone,
  extractCloneSeeds,
  extractDocument
} from '../src/commands/clone.js'
import { makeUwx } from './helpers/uwx-fixture.js'

// ⭐ These exercise the pull lanes, not the workspace: a command works in the one chosen
// with the login (backend/workspace.js), and a test has no login to choose one. Named
// here for the whole file, as a token-logged process would name it.
process.env.UNIWEB_WORKSPACE = 'personal'

// ⛔ The pull lane answers with `application/vnd.uniweb.exchange.entity+zip`, NOT
// JSON. This stub used to expose only `json()`, and clone read it with
// `res.json()` — so the suite was green while the real command died on the ZIP
// magic with *"Could not reach the backend: Unexpected token 'P'"*. A fixture is
// a claim about the contract, and that one was false.
//
// Deliberately NO `json()` here: if a future change reads the body as JSON again,
// it must fail loudly rather than pass against an obliging double.
const uwxRes = (doc, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  statusText: '',
  arrayBuffer: async () => {
    const buf = doc ? makeUwx(doc) : Buffer.alloc(0)
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  }
})

// A site-content $-document as the backend would return it on the pull lane.
const siteDoc = () => ({
  $model: '@uniweb/site-content',
  $uuid: 'SITE-1',
  info: { name: 'My Site', foundation: '@acme/base@1.0.0' }
})

const tmpCwd = () => mkdtempSync(join(tmpdir(), 'uniweb-clone-'))
const noSpawn = {
  getToken: async () => 'tok',
  skipInstall: true,
  skipPull: true
}

test('extractCloneSeeds reads the foundation ref and name (no folder uuid)', () => {
  assert.deepEqual(extractCloneSeeds(siteDoc()), {
    foundationRef: '@acme/base@1.0.0',
    name: 'My Site'
  })
})

test('extractCloneSeeds tolerates a localized name', () => {
  const seeds = extractCloneSeeds({ info: { name: { en: 'Hi', fr: 'Salut' } } })
  assert.equal(seeds.name, 'Hi')
  assert.equal(seeds.foundationRef, null)
  assert.equal(seeds.folderUuid, undefined) // no folder uuid is read anymore
})

test('extractDocument tolerates raw and {document}/{entity} envelopes', () => {
  const raw = siteDoc()
  assert.equal(extractDocument(raw), raw)
  assert.equal(extractDocument({ document: raw }), raw)
  assert.equal(extractDocument(null), null)
})

test('clone errors without a site uuid', async () => {
  const res = await clone([], noSpawn)
  assert.equal(res.exitCode, 2)
})

test('clone reports a 404 cleanly', async () => {
  const dir = tmpCwd()
  try {
    const res = await clone(['MISSING', 'x'], {
      ...noSpawn,
      cwd: dir,
      fetch: async () => uwxRes(null, 404)
    })
    assert.equal(res.exitCode, 1)
    assert.equal(existsSync(join(dir, 'x')), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// What a verb printed through `console.error` — its errors. Its notes go through the
// `console.log` it bound when it loaded, which this does not see.
async function said(fn) {
  const out = []
  const { log, error } = console
  console.log = (...a) => out.push(a.join(' '))
  console.error = (...a) => out.push(a.join(' '))
  try {
    const r = await fn()
    return { ...r, out: out.join('\n') }
  } finally {
    console.log = log
    console.error = error
  }
}

test("⛔ an id that names another entity is not a site — clone says so, and makes nothing", async () => {
  const dir = tmpCwd()
  try {
    // A record's id, given by mistake: the lane answers with that record.
    const record = { $schema: '@std/person', $uuid: 'R-1', $id: 'bob', person: { name: { en: 'Bob' } } }
    const res = await said(() =>
      clone(['R-1'], {
        ...noSpawn,
        cwd: dir,
        fetch: async (url) => (url.includes('/dev/site/content/pull/R-1') ? uwxRes(record) : uwxRes(null, 404))
      })
    )
    assert.equal(res.exitCode, 1, res.out)
    assert.match(res.out, /R-1 is not a site on .* — it is a @std\/person entity/)
    // (Errors only: clone binds `console.log` when it loads, so its notes are not captured here.)
    assert.doesNotMatch(res.out, /Could not derive a project name/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('CONTROL — a site whose document names its data schema is cloned', async () => {
  const dir = tmpCwd()
  try {
    const res = await clone(['SITE-1', 'named'], {
      ...noSpawn,
      cwd: dir,
      fetch: async (url) =>
        url.includes('/dev/site/content/pull/SITE-1') ? uwxRes({ ...siteDoc(), $schema: '@uniweb/site-content' }) : uwxRes(null, 404)
    })
    assert.equal(res.exitCode, 0)
    assert.ok(existsSync(join(dir, 'named', 'site', 'sync.json')))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('clone scaffolds a ref-only harness and seeds the uuids (new workspace)', async () => {
  const dir = tmpCwd()
  try {
    const res = await clone(['SITE-1', 'my-site'], {
      ...noSpawn,
      cwd: dir,
      fetch: async (url) =>
        url.includes('/dev/site/content/pull/SITE-1')
          ? uwxRes(siteDoc())
          : uwxRes(null, 404)
    })
    assert.equal(res.exitCode, 0)

    const root = join(dir, 'my-site')
    const siteDir = join(root, 'site')

    // Harness present (workspace AGENTS.md + the site's Vite entry).
    assert.ok(existsSync(join(root, 'AGENTS.md')), 'AGENTS.md scaffolded')
    assert.ok(existsSync(join(siteDir, 'entry.js')), 'site entry.js scaffolded')

    // ⭐ The seeded uuid is in `sync.json`, under the backend that minted it — NOT
    // in site.yml, which now carries only what an author wrote.
    const sync = JSON.parse(readFileSync(join(siteDir, 'sync.json'), 'utf8'))
    const origins = Object.keys(sync.backends)
    assert.equal(origins.length, 1, 'one backend, the one we cloned from')
    assert.equal(sync.backends[origins[0]].site.uuid, 'SITE-1')

    // site.yml carries the carried foundation ref and nothing minted.
    const parsed = yaml.load(readFileSync(join(siteDir, 'site.yml'), 'utf8'))
    assert.equal(parsed.foundation, '@acme/base@1.0.0')
    assert.equal(parsed.$uuid, undefined, 'site.yml must hold no minted identity')
    assert.equal(parsed.$backend, undefined)

    // Ref-only: package.json has @uniweb/runtime and NO local foundation dep.
    const pkg = JSON.parse(readFileSync(join(siteDir, 'package.json'), 'utf8'))
    assert.deepEqual(Object.keys(pkg.dependencies), ['@uniweb/runtime'])

    // No folder uuid is seeded — the folder is pulled by the site-content uuid.
    assert.equal(
      existsSync(join(siteDir, 'collections', 'collections.yml')),
      false
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('clone forwards --no-records to the delegated pull', async () => {
  const dir = tmpCwd()
  let pulledArgs = null
  try {
    const res = await clone(['SITE-1', 'solo', '--no-records'], {
      getToken: async () => 'tok',
      skipInstall: true,
      runPull: async (_siteDir, _pm, extra) => {
        pulledArgs = extra
      },
      cwd: dir,
      fetch: async () => uwxRes(siteDoc())
    })
    assert.equal(res.exitCode, 0)
    assert.ok(
      pulledArgs && pulledArgs.includes('--no-records'),
      'forwarded --no-records to pull'
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('clone forwards the workspace it was told to work in to the delegated pull', async () => {
  const dir = tmpCwd()
  let pulledArgs = null
  try {
    const res = await clone(['SITE-1', 'solo', '--org', '@acme'], {
      getToken: async () => 'tok',
      skipInstall: true,
      runPull: async (_siteDir, _pm, extra) => {
        pulledArgs = extra
      },
      cwd: dir,
      fetch: async () => uwxRes(siteDoc())
    })
    assert.equal(res.exitCode, 0)
    // `--force` first: the delegated pull takes the backend's version over a scaffold this
    // clone wrote seconds ago — there is nothing of the author's under it.
    assert.deepEqual(pulledArgs, ['--force', '--org', '@acme'])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('⭐ a clone outside git starts its history at a sync point — the site as the backend has it', async () => {
  const dir = tmpCwd()
  const prior = { global: process.env.GIT_CONFIG_GLOBAL, nosys: process.env.GIT_CONFIG_NOSYSTEM }
  process.env.GIT_CONFIG_GLOBAL = join(dir, 'gitconfig')
  writeFileSync(process.env.GIT_CONFIG_GLOBAL, '[user]\n\tname = t\n\temail = t@t\n')
  process.env.GIT_CONFIG_NOSYSTEM = '1'
  try {
    const res = await clone(['SITE-1', 'solo'], {
      getToken: async () => 'tok',
      skipInstall: true,
      // What the delegated pull leaves: the site's content, written.
      runPull: async (siteDir) => {
        mkdirSync(join(siteDir, 'pages', 'home'), { recursive: true })
        writeFileSync(join(siteDir, 'pages', 'home', 'hello.md'), '# Hello\n')
      },
      cwd: dir,
      fetch: async () => uwxRes(siteDoc())
    })
    assert.equal(res.exitCode, 0)
    const project = join(dir, 'solo')
    const repo = repoOf(join(project, 'site'))
    assert.ok(repo?.head, 'the clone is a repository with a first commit')
    const origin = 'https://uniweb.app'
    assert.equal(historySyncPoint(repo, { origin, siteUuid: 'SITE-1' }), repo.head, 'its first commit is a sync point')
    assert.equal(readSyncPoint(join(project, 'site'), origin), repo.head, 'and this copy keeps it as its own')
    assert.match(execFileSync('git', ['show', '--stat', '--format=', 'HEAD'], { cwd: project, encoding: 'utf8' }), /site\/pages\/home\/hello\.md/)
  } finally {
    if (prior.global === undefined) delete process.env.GIT_CONFIG_GLOBAL
    else process.env.GIT_CONFIG_GLOBAL = prior.global
    if (prior.nosys === undefined) delete process.env.GIT_CONFIG_NOSYSTEM
    else process.env.GIT_CONFIG_NOSYSTEM = prior.nosys
    rmSync(dir, { recursive: true, force: true })
  }
})

test('CONTROL — `--no-git` leaves the clone outside git', async () => {
  const dir = tmpCwd()
  try {
    const res = await clone(['SITE-1', 'solo', '--no-git'], { ...noSpawn, cwd: dir, fetch: async () => uwxRes(siteDoc()) })
    assert.equal(res.exitCode, 0)
    assert.equal(existsSync(join(dir, 'solo', '.git')), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
