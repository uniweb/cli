/**
 * uniweb pull — verb structure, mock-backed.
 *
 * Drives the pull orchestration with an injected fetch (synthetic pull payloads)
 * and getToken (no auth), against a temp site dir, and asserts the projection
 * layer wrote canonical files.
 *
 * These pass `--force` because a temp dir is not a git repository, and pull now
 * refuses to overwrite a working tree with nothing standing behind it. That guard
 * has its own tests below; these are about the projection. The live backend routes are unexercised; this
 * pins the wiring (uuid read → GET → extract → project) end to end.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import yaml from 'js-yaml'
import {
  pull,
  extractDocument,
  splitRecordsPull,
  readPullDocuments,
  readPullVersions,
  describeUnplacedRecords
} from '../src/commands/pull.js'
import { createZip } from '@uniweb/build/uwx'
import { readWritten, isPullOutput } from '../src/utils/pull-written.js'
import { readBaseVersions, readItemBaseVersions, readFolderItemUuids, readSyncCache } from '../src/backend/site-sync.js'

// ⭐ These exercise the pull lanes, not the workspace: a command works in the one chosen
// with the login (backend/workspace.js), and a test has no login to choose one. Named
// here for the whole file, as a token-logged process would name it.
process.env.UNIWEB_WORKSPACE = 'personal'

// The push staleness gate's read half: pull banks each entity's opaque `version`
// from the manifest so the next push can echo it as `base_version`. This is the
// manifest readPullDocuments deliberately skips — we used to drop these on the floor.
//
// The token is TOP-LEVEL on the entry. Reading it from `extra.version` (the
// backend's Rust field name, which is #[serde(flatten)] and never on the wire)
// finds nothing and leaves the gate silently disarmed — that shipped once.
test('readPullVersions harvests the top-level version per entity from the pull manifest', () => {
  const manifest = {
    format: 'uwx/1',
    entries: [
      {
        kind: 'entity',
        uuid: 'U-SITE',
        file: 'entities/U-SITE.json',
        sha256: 'x',
        version: 'V-SITE'
      },
      {
        kind: 'entity',
        uuid: 'U-REC',
        file: 'entities/U-REC.json',
        sha256: 'y',
        version: 'V-REC'
      },
      // no version → contributes nothing rather than a null the push would send
      {
        kind: 'entity',
        uuid: 'U-NONE',
        file: 'entities/U-NONE.json',
        sha256: 'z'
      },
      // the wrapper shape must NOT be honored — it would resurrect the silent bug
      {
        kind: 'entity',
        uuid: 'U-WRAP',
        file: 'entities/U-WRAP.json',
        sha256: 'w',
        extra: { version: 'V-WRAP' }
      }
    ]
  }
  const zip = createZip([
    { name: 'manifest.json', data: Buffer.from(JSON.stringify(manifest)) },
    { name: 'entities/U-SITE.json', data: Buffer.from('{}') }
  ])
  assert.deepEqual(readPullVersions(zip), {
    'U-SITE': 'V-SITE',
    'U-REC': 'V-REC'
  })
})

test('readPullVersions is empty for a non-ZIP body — that lane just stays unconditional', () => {
  assert.deepEqual(readPullVersions(Buffer.from('{"a":1}')), {})
  assert.deepEqual(readPullVersions(Buffer.from('')), {})
})

const docOf = (text) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }]
})

// A minimal Response-like object for the mocked fetch. The live backend serves a
// `.uwx` (zip) and pull reads `arrayBuffer()`; the mock hands the JSON body as bytes,
// which readPullDocuments parses via its JSON fallback.
const jsonRes = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  statusText: '',
  json: async () => body,
  arrayBuffer: async () => Buffer.from(JSON.stringify(body ?? null))
})

// ⛔ PIN THE TARGET ORIGIN. Every test here injects `resolveSiteDir`, `getToken`
// and `fetch` to stay hermetic — and origin resolution was the one ambient
// input nobody injected. Without this, `resolveBackendOrigin()` answers with the
// DEVELOPER'S logged-in backend (`~/.uniweb/registry-auth.json`), and a fixture
// bound on one backend reads as unsynced on another — `pull` then finds no uuid
// for that origin and stops.
//
// ⚠️ The failure is machine-local and reads as a product bug. Anyone who runs
// `uniweb login --backend http://localhost:8080` — the documented local-dev
// flow — breaks the tests here, while CI, which has no session, stays green.
// Measured 2026-08-26 (then against the since-deleted scope guard).
//
// The value is the backend the fixtures are bound on in sync.json (`bindSite`).
// `fetch` is mocked in every test, so nothing leaves the machine.
const TEST_ORIGIN = 'https://uniweb.app'
// Aimed the way automation aims: UNIWEB_REGISTER_URL, which outranks the login. This
// file runs in its own process, so setting it once is contained. (It passed
// `--backend` on every call until that flag left the backend verbs, 2026-09-21.)
process.env.UNIWEB_REGISTER_URL = TEST_ORIGIN

/** Bind a test site on the pinned backend — identity lives in sync.json since 2026-09-20. */
function bindSite(dir, uuid) {
  writeFileSync(
    join(dir, 'sync.json'),
    JSON.stringify({ version: 1, backends: { [TEST_ORIGIN]: { site: { uuid } } } })
  )
}


function makeFetch(routes) {
  return async (url) => {
    for (const [needle, body] of routes) {
      if (url.includes(needle))
        return body === 404 ? jsonRes(null, 404) : jsonRes(body)
    }
    return jsonRes(null, 404)
  }
}

function tempSite() {
  const dir = mkdtempSync(join(tmpdir(), 'uniweb-pull-'))
  return dir
}

test('extractDocument tolerates raw, {document}, and {entity} envelopes', () => {
  const raw = { $model: '@uniweb/site-content', info: {} }
  assert.equal(extractDocument(raw), raw)
  assert.equal(extractDocument({ document: raw }), raw)
  assert.equal(extractDocument({ entity: raw }), raw)
  assert.equal(extractDocument(null), null)
  // The agreed key (2026-09-24) — a document naming its data schema by `$schema`.
  const named = { $schema: '@uniweb/site-content' }
  assert.equal(extractDocument(named), named)
})

test('readPullDocuments reads entity docs out of a .uwx zip, and tolerates JSON envelopes', () => {
  const doc = { $model: '@uniweb/site-content', info: { name: 'Z' } }
  // Zip path — the real backend wire (manifest.json + entities/<uuid>.json).
  const uwx = createZip([
    { name: 'manifest.json', data: Buffer.from('{}') },
    { name: 'entities/e1.json', data: Buffer.from(JSON.stringify(doc)) }
  ])
  assert.deepEqual(readPullDocuments(uwx), [doc])
  // JSON fallbacks.
  assert.deepEqual(readPullDocuments(Buffer.from(JSON.stringify(doc))), [doc])
  assert.deepEqual(
    readPullDocuments(Buffer.from(JSON.stringify({ entities: [doc] }))),
    [doc]
  )
  assert.deepEqual(readPullDocuments(Buffer.from('not json')), [])
})

test('splitRecordsPull partitions the folder from the records', () => {
  const folder = { $schema: '@uniweb/folder', contents: [] }
  const rec = { $schema: '@acme/article', article: {} }
  const { folderDoc, recordDocs } = splitRecordsPull({
    entities: [folder, rec]
  })
  assert.equal(folderDoc, folder)
  assert.deepEqual(recordDocs, [rec])
})

test('splitRecordsPull does not read the old key: a `$model` document names no data schema', () => {
  // No fallback [Diego, 2026-09-24] — and no silent drop either: a stored entity is
  // still a document (its `$uuid`), so the pull reaches it and says what is wrong.
  const folder = { $uuid: 'F1', $model: '@uniweb/folder', contents: [] }
  const rec = { $uuid: 'R1', $model: '@acme/article', article: {} }
  const { folderDoc, recordDocs } = splitRecordsPull({ entities: [folder, rec] })
  assert.equal(folderDoc, null)
  assert.deepEqual(recordDocs, [folder, rec])
})

test('pull is a no-op with no $uuid in files', async () => {
  const dir = tempSite()
  try {
    writeFileSync(join(dir, 'site.yml'), "name: S\nfoundation: '@a/base'\n")
    const res = await pull(['--force'], {
      resolveSiteDir: async () => dir,
      getToken: async () => 'tok',
      fetch: async () => jsonRes(null, 404)
    })
    assert.equal(res.exitCode, 0)
    assert.equal(existsSync(join(dir, 'pages')), false) // nothing projected
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('pull projects the site-content lane (pages + sections + config) from a mock GET', async () => {
  const dir = tempSite()
  try {
    writeFileSync(join(dir, 'site.yml'), "name: Old\nfoundation: '@a/base'\n")
    bindSite(dir, 'SITE')

    const document = {
      $uuid: 'SITE',
      $id: 'site-content',
      $model: '@uniweb/site-content',
      info: { name: { en: 'Pulled' }, foundation: '@a/base' },
      pages: [
        {
          $id: 'home',
          $uuid: 'P1',
          slug: 'home',
          mode: 'page',
          stable_id: 'home',
          is_index: true,
          page_sections: [
            {
              $id: 'hero',
              $uuid: 'S1',
              stable_id: 'hero',
              type: 'Hero',
              content: docOf('Welcome')
            }
          ]
        }
      ],
      layout_sections: [],
      extensions: [],
      collections: []
    }

    const res = await pull(['--force'], {
      resolveSiteDir: async () => dir,
      getToken: async () => 'tok',
      fetch: makeFetch([['/dev/site/content/pull/SITE', document]])
    })

    assert.equal(res.exitCode, 0)
    // config written from info
    assert.equal(
      yaml.load(readFileSync(join(dir, 'site.yml'), 'utf8')).name,
      'Pulled'
    )
    // page + section projected; page.yml stays clean (identity → .uniweb/ index)
    const pageYml = yaml.load(
      readFileSync(join(dir, 'pages/home/page.yml'), 'utf8')
    )
    assert.deepEqual(pageYml.sections, ['hero', '...']) // rest marker keeps the page open to new sections
    assert.equal(pageYml.uuid, undefined)
    assert.equal(pageYml.ids, undefined)
    assert.ok(existsSync(join(dir, 'pages/home/hero.md')))
    // uuids recorded in the gitignored index instead
    const index = JSON.parse(
      readFileSync(join(dir, '.uniweb/pull-index.json'), 'utf8')
    )
    assert.equal(index.items.P1, join('pages', 'home'))
    assert.equal(index.items.S1, join('pages', 'home', 'hero.md'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('pull fetches the folder lane by the site-content uuid (no query config needed)', async () => {
  const dir = tempSite()
  try {
    // The site holds one identity (site.yml::$uuid); the folder is keyed by it.
    writeFileSync(join(dir, 'site.yml'), "name: Old\nfoundation: '@a/base'\n")
    bindSite(dir, 'SITE9')

    const siteContent = {
      $uuid: 'SITE9',
      $id: 'site-content',
      $model: '@uniweb/site-content',
      info: { name: { en: 'S' }, foundation: '@a/base' },
      pages: [],
      layout_sections: [],
      extensions: [],
      collections: []
    }
    // The folder document carries no $uuid of its own (the backend owns it).
    const folderDoc = {
      $id: '@folder',
      $schema: '@uniweb/folder',
      contents: [
        {
          kind: 'branch',
          name: 'articles',
          $children: [
            {
              kind: 'ref',
              name: 'hello',
              entry: { schema: '@acme/article', entity: 'R9' }
            }
          ]
        }
      ]
    }
    const recordDoc = {
      $uuid: 'R9',
      $schema: '@acme/article',
      article: { title: { en: 'Hello' }, body: { en: '\n# Hi\n' } }
    }
    const declaration = {
      name: '@acme/article',
      sections: {
        article: {
          brief: true,
          fields: {
            title: { type: 'string', localized: true },
            body: { type: 'text', format: 'markdown', localized: true }
          }
        }
      }
    }

    const res = await pull(['--force'], {
      resolveSiteDir: async () => dir,
      getToken: async () => 'tok',
      fetch: makeFetch([
        ['/dev/site/content/pull/SITE9', siteContent],
        ['/dev/site/folder/pull/SITE9', { entities: [folderDoc, recordDoc] }],
        ['/dev/registry/data-schemas/', declaration]
      ])
    })

    assert.equal(res.exitCode, 0)
    // the folder lane ran, keyed by the site-content uuid
    // ⭐ A record's home is its MODEL's pool folder — `@acme/article` →
    // `records/acme/article/`. Not a query's directory: a query has none.
    assert.ok(
      existsSync(join(dir, 'records/acme/article/hello.md')),
      'record projected via the folder lane'
    )
    // and no folder uuid is persisted (the framework holds none)
    assert.equal(existsSync(join(dir, 'queries.yml')), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('pull projects the collections lane, resolving the model via a mock model-read', async () => {
  const dir = tempSite()
  try {
    writeFileSync(join(dir, 'site.yml'), "name: S\nfoundation: '@a/base'\n")
    bindSite(dir, 'SITE1')

    const folderDoc = {
      $id: '@folder',
      $schema: '@uniweb/folder',
      contents: [
        {
          kind: 'branch',
          name: 'articles',
          $children: [
            {
              kind: 'ref',
              name: 'hello',
              entry: { schema: '@acme/article', entity: 'R1' }
            }
          ]
        }
      ]
    }
    const recordDoc = {
      $uuid: 'R1',
      $schema: '@acme/article',
      article: { title: { en: 'Hello' }, body: { en: '\n# Hi\n' } }
    }
    const declaration = {
      name: '@acme/article',
      sections: {
        article: {
          brief: true,
          fields: {
            title: { type: 'string', localized: true },
            body: { type: 'text', format: 'markdown', localized: true }
          }
        }
      }
    }

    const res = await pull(['--force'], {
      resolveSiteDir: async () => dir,
      getToken: async () => 'tok',
      fetch: makeFetch([
        // content lane 404s here (focus on the folder lane); the site $uuid drives both
        ['/dev/site/folder/pull/SITE1', { entities: [folderDoc, recordDoc] }],
        ['/dev/registry/data-schemas/', declaration]
      ])
    })

    assert.equal(res.exitCode, 0)
    const recordFile = join(dir, 'records/acme/article/hello.md')
    assert.ok(existsSync(recordFile), 'record file projected')
    assert.match(readFileSync(recordFile, 'utf8'), /title: Hello/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// ── records a pull could not place ─────────────────────────────────────────
// ⛔ Measured 2026-09-23: a backend answered the folder lane naming the folder's Model
// and every record's by id. Nothing could be placed, and the pull said "✓ Pulled … 0
// record(s)", exited 0 and banked the lane's ETag and tokens — so the next pull would
// hear 304 and never try again, and a `refresh && push` would go on to push.

// The folder lane as a backend serves it: a `.uwx` whose manifest carries each
// entity's version token, and an ETag.
function folderLane(docs) {
  const zip = createZip([
    {
      name: 'manifest.json',
      data: Buffer.from(
        JSON.stringify({
          format: 'uwx/1',
          entries: docs.map((d) => ({
            kind: 'entity',
            uuid: d.$uuid,
            file: `entities/${d.$uuid}.json`,
            version: `V-${d.$uuid}`,
            item_versions: { [`I-${d.$uuid}`]: `iv-${d.$uuid}` }
          }))
        })
      )
    },
    ...docs.map((d) => ({ name: `entities/${d.$uuid}.json`, data: Buffer.from(JSON.stringify(d)) }))
  ])
  return {
    ok: true,
    status: 200,
    statusText: '',
    headers: { get: (k) => (String(k).toLowerCase() === 'etag' ? '"F-ETAG"' : null) },
    arrayBuffer: async () => zip
  }
}

const memberDecl = {
  name: '@acme/member',
  sections: { member: { brief: true, fields: { name: { type: 'string' } } } }
}

// A folder placing one member, its data schemas named as given. `$schema` (with
// `schema` in each entry) is the agreed shape; `$model` holding an id is what a
// backend without the fix sends.
async function pullFolderNamed(dir, { folderModel, memberModel, key = '$schema' }) {
  const ref = key === '$schema' ? 'schema' : 'model'
  const docs = [
    {
      $uuid: 'F1',
      [key]: folderModel,
      contents: [{ kind: 'ref', name: 'alice', $uuid: 'P1', entry: { [ref]: memberModel, entity: 'R1' } }]
    },
    { $uuid: 'R1', [key]: memberModel, member: { name: 'Alice' } }
  ]
  return pull(['--force'], {
    resolveSiteDir: async () => dir,
    getToken: async () => 'tok',
    fetch: async (url) =>
      url.includes('/dev/site/folder/pull/SITE1')
        ? folderLane(docs)
        : url.includes('/dev/registry/data-schemas/acme/member')
          ? jsonRes(memberDecl)
          : jsonRes(null, 404)
  })
}

const pulledCache = (dir) => JSON.parse(readFileSync(join(dir, '.uniweb/pull-cache.json'), 'utf8'))

test('⛔ a pull that places none of the records it was sent fails, and does not record the lane as taken', async () => {
  const dir = tempSite()
  try {
    writeFileSync(join(dir, 'site.yml'), "name: S\nfoundation: '@a/base'\n")
    bindSite(dir, 'SITE1')
    const res = await pullFolderNamed(dir, {
      folderModel: '11111111-1111-7111-8111-111111111111',
      memberModel: '22222222-2222-7222-8222-222222222222'
    })
    assert.equal(res.exitCode, 1)
    assert.equal(existsSync(join(dir, 'records')), false, 'nothing was placed')
    assert.equal(pulledCache(dir).folder, null, 'the next pull must fetch the records again')
    assert.equal(readBaseVersions(dir, TEST_ORIGIN).R1, undefined)
    assert.equal(readItemBaseVersions(dir, TEST_ORIGIN)['I-R1'], undefined)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a lane whose documents name no data schema fails too — they are not dropped in silence', async () => {
  const dir = tempSite()
  try {
    writeFileSync(join(dir, 'site.yml'), "name: S\nfoundation: '@a/base'\n")
    bindSite(dir, 'SITE1')
    const res = await pullFolderNamed(dir, {
      folderModel: '@uniweb/folder',
      memberModel: '@acme/member',
      key: '$model'
    })
    assert.equal(res.exitCode, 1)
    assert.equal(existsSync(join(dir, 'records')), false)
    assert.equal(pulledCache(dir).folder, null)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('CONTROL — the same lane in the agreed shape (`$schema`, scoped names) is placed, and recorded as taken', async () => {
  const dir = tempSite()
  try {
    writeFileSync(join(dir, 'site.yml'), "name: S\nfoundation: '@a/base'\n")
    bindSite(dir, 'SITE1')
    const res = await pullFolderNamed(dir, { folderModel: '@uniweb/folder', memberModel: '@acme/member' })
    assert.equal(res.exitCode, 0)
    assert.ok(existsSync(join(dir, 'records/acme/member/alice.yml')))
    // ⭐ The folder's placement identity is banked from the folder the pull took — a copy that
    // never pushed (a clone) sends its first folder with it, rather than being refused.
    assert.deepEqual(readFolderItemUuids(dir, TEST_ORIGIN), { '@R1': 'P1', alice: 'P1' })
    assert.equal(pulledCache(dir).folder, '"F-ETAG"')
    assert.equal(readBaseVersions(dir, TEST_ORIGIN).R1, 'V-R1')
    assert.equal(readItemBaseVersions(dir, TEST_ORIGIN)['I-R1'], 'iv-R1')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('describeUnplacedRecords says a data schema named by id first, instead of every record "not in the folder"', () => {
  const said = describeUnplacedRecords({
    docs: [
      { $uuid: 'F1', $schema: '11111111-1111-7111-8111-111111111111' },
      { $uuid: 'R1', $schema: '22222222-2222-7222-8222-222222222222' }
    ],
    taken: 0,
    skipped: [
      { uuid: 'F1', reason: 'no slug (not in the folder, no $id)' },
      { uuid: 'R1', reason: 'no slug (not in the folder, no $id)' }
    ]
  })
  assert.equal(said.headline, 'No record could be placed — the backend named their data schemas by id, not by scoped name.')
  assert.match(said.lines[0], /11111111-1111-7111-8111-111111111111/)
  assert.ok(!said.lines.some((l) => /not in the folder/.test(l)))
})

test('describeUnplacedRecords says when documents name no data schema at all', () => {
  const said = describeUnplacedRecords({
    docs: [{ $uuid: 'F1', $model: '@uniweb/folder' }, { $uuid: 'R1', $model: '@acme/member' }],
    taken: 0,
    skipped: [{ uuid: 'F1', reason: 'no slug (not in the folder, no $id)' }]
  })
  assert.equal(said.headline, "No record could be placed — 2 of the backend's documents name no data schema (`$schema`).")
})

test('describeUnplacedRecords, with data schemas named, gives each record its reason', () => {
  const said = describeUnplacedRecords({
    docs: [{ $uuid: 'R1', $schema: '@acme/unknown' }],
    taken: 2,
    skipped: [{ slug: 'x', reason: 'unresolved model @acme/unknown' }]
  })
  assert.equal(said.headline, '1 record could not be placed — its file is unchanged.')
  assert.deepEqual(said.lines, ['↷ x: unresolved model @acme/unknown'])
})

test('pull --no-records skips the folder lane', async () => {
  const dir = tempSite()
  const pulledUrls = []
  try {
    writeFileSync(join(dir, 'site.yml'), "name: S\nfoundation: '@a/base'\n")
    bindSite(dir, 'SITE2')
    const siteContent = {
      $uuid: 'SITE2',
      $id: 'site-content',
      $model: '@uniweb/site-content',
      info: { name: { en: 'S' }, foundation: '@a/base' },
      pages: [],
      layout_sections: [],
      extensions: [],
      collections: []
    }

    const res = await pull(['--no-records', '--force'], {
      resolveSiteDir: async () => dir,
      getToken: async () => 'tok',
      fetch: async (url) => {
        pulledUrls.push(url)
        return url.includes('/dev/site/content/pull/SITE2')
          ? jsonRes(siteContent)
          : jsonRes(null, 404)
      }
    })

    assert.equal(res.exitCode, 0)
    assert.ok(
      pulledUrls.some((u) => u.includes('/dev/site/content/pull/SITE2')),
      'content lane ran'
    )
    assert.ok(
      !pulledUrls.some((u) => u.includes('/dev/site/folder/pull/')),
      'folder lane skipped'
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('pull echoes the cached ETag in If-None-Match and treats 304 as unchanged (no overwrite)', async () => {
  const dir = tempSite()
  try {
    writeFileSync(join(dir, 'site.yml'), "name: Keep\nfoundation: '@a/base'\n")
    bindSite(dir, 'SITE304')
    // A clean repo, so the pull needs no `--force` — which is unconditional (below).
    writeFileSync(join(dir, '.gitignore'), '.uniweb\n')
    execFileSync('git', ['init', '-q'], { cwd: dir, stdio: 'ignore' })
    execFileSync('git', ['add', '-A'], { cwd: dir, stdio: 'ignore' })
    execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'base'], {
      cwd: dir,
      stdio: 'ignore'
    })
    mkdirSync(join(dir, '.uniweb'), { recursive: true })
    writeFileSync(
      join(dir, '.uniweb/pull-cache.json'),
      JSON.stringify({ version: 2, content: '"abc123"' })
    )
    // A banked hash that a re-bank would replace: nothing was projected, so nothing is re-banked.
    writeFileSync(
      join(dir, '.uniweb/backend-cache.json'),
      JSON.stringify({ backends: { [TEST_ORIGIN]: { hashes: { 'x y': 'BANKED' } } } })
    )
    let sentINM
    const res = await pull(['--no-records', '--non-interactive'], {
      resolveSiteDir: async () => dir,
      getToken: async () => 'tok',
      fetch: async (url, opts) => {
        sentINM = opts?.headers?.['If-None-Match']
        return {
          ok: false,
          status: 304,
          statusText: 'Not Modified',
          headers: { get: () => '"abc123"' }
        }
      }
    })
    assert.equal(res.exitCode, 0)
    assert.equal(sentINM, '"abc123"', 'cached ETag echoed verbatim')
    // 304 → no projection, local file untouched
    assert.equal(
      yaml.load(readFileSync(join(dir, 'site.yml'), 'utf8')).name,
      'Keep'
    )
    // …and the bank left as it was
    assert.deepEqual(readSyncCache(dir, TEST_ORIGIN), { 'x y': 'BANKED' })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('pull --force is unconditional — it takes the backend version whatever the ETag says', async () => {
  // An ETag says whether the BACKEND moved, never whether the files still hold what it
  // sent: after a `git checkout`, an echoed ETag got a 304 and the checked-out files
  // stayed — so "take the backend's version" did nothing.
  const dir = tempSite()
  try {
    writeFileSync(join(dir, 'site.yml'), "name: Keep\nfoundation: '@a/base'\n")
    bindSite(dir, 'SITE-FORCE')
    mkdirSync(join(dir, '.uniweb'), { recursive: true })
    writeFileSync(join(dir, '.uniweb/pull-cache.json'), JSON.stringify({ version: 2, content: '"abc123"' }))
    let sentINM = 'unset'
    await pull(['--no-records', '--force'], {
      resolveSiteDir: async () => dir,
      getToken: async () => 'tok',
      fetch: async (url, opts) => {
        sentINM = opts?.headers?.['If-None-Match']
        return jsonRes(null, 404)
      }
    })
    assert.equal(sentINM, undefined)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('pull caches the ETag from a 200 for the next conditional pull', async () => {
  const dir = tempSite()
  try {
    writeFileSync(join(dir, 'site.yml'), "name: S\nfoundation: '@a/base'\n")
    bindSite(dir, 'SITEET')
    const document = {
      $model: '@uniweb/site-content',
      info: { name: { en: 'S' }, foundation: '@a/base' },
      pages: [],
      layout_sections: [],
      extensions: [],
      collections: []
    }
    await pull(['--no-records', '--force'], {
      resolveSiteDir: async () => dir,
      getToken: async () => 'tok',
      fetch: async () => ({
        ok: true,
        status: 200,
        statusText: '',
        headers: {
          get: (k) => (String(k).toLowerCase() === 'etag' ? '"deadbeef"' : null)
        },
        arrayBuffer: async () => Buffer.from(JSON.stringify(document))
      })
    })
    const cache = JSON.parse(
      readFileSync(join(dir, '.uniweb/pull-cache.json'), 'utf8')
    )
    assert.equal(cache.content, '"deadbeef"')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// ── the working-tree guard ──────────────────────────────────────────────────
// Pull is a checkout: it rewrites section bodies and prunes what the backend
// doesn't have. It was the last place the CLI could destroy a user's work without
// them agreeing to it.

test('pull refuses in a non-git dir when it cannot ask', async () => {
  const dir = tempSite() // a temp dir — not a git work tree
  writeFileSync(join(dir, 'site.yml'), 'name: S\n')
  bindSite(dir, 'SITE')
  let fetched = false
  const res = await pull(['--non-interactive'], {
    resolveSiteDir: async () => dir,
    getToken: async () => 'tok',
    fetch: async () => {
      fetched = true
      return jsonRes({})
    }
  })
  assert.equal(res.exitCode, 1)
  // It must refuse BEFORE touching the backend — the guard is about the local
  // tree, so there is no reason to have fetched anything.
  assert.equal(fetched, false)
})

test('pull --force proceeds in a non-git dir', async () => {
  const dir = tempSite()
  writeFileSync(join(dir, 'site.yml'), 'name: S\n')
  bindSite(dir, 'SITE')
  const res = await pull(['--force', '--non-interactive'], {
    resolveSiteDir: async () => dir,
    getToken: async () => 'tok',
    fetch: async () => jsonRes(null, 404)
  })
  // 404 on the lane, not a refusal — the guard let it through.
  assert.notEqual(res.exitCode, 1)
})

test('pull --dry-run is never blocked by the guard — it writes nothing', async () => {
  const dir = tempSite()
  writeFileSync(join(dir, 'site.yml'), 'name: S\n')
  bindSite(dir, 'SITE')
  const res = await pull(['--dry-run', '--non-interactive'], {
    resolveSiteDir: async () => dir,
    getToken: async () => 'tok',
    fetch: async () => jsonRes(null, 404)
  })
  assert.notEqual(res.exitCode, 1)
})

// Real git, because the parsing of `git status --porcelain` and the
// pull-output filtering are exactly the parts a mock would paper over.
const hasGit = (() => {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()

function gitSite() {
  const dir = tempSite()
  writeFileSync(join(dir, 'site.yml'), 'name: S\n')
  bindSite(dir, 'SITE')
  mkdirSync(join(dir, 'pages/home'), { recursive: true })
  writeFileSync(
    join(dir, 'pages/home/hero.md'),
    '---\ntype: Hero\n---\n# committed\n'
  )
  const g = (a) => execFileSync('git', a, { cwd: dir, stdio: 'ignore' })
  g(['init', '-q'])
  g(['add', '-A'])
  execFileSync(
    'git',
    ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'base'],
    { cwd: dir, stdio: 'ignore' }
  )
  return dir
}

test('pull proceeds when the tree is clean', { skip: !hasGit }, async () => {
  const dir = gitSite()
  try {
    const res = await pull(['--non-interactive'], {
      resolveSiteDir: async () => dir,
      getToken: async () => 'tok',
      fetch: async () => jsonRes(null, 404)
    })
    assert.notEqual(res.exitCode, 1)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test(
  'pull refuses on an uncommitted edit, and names it',
  { skip: !hasGit },
  async () => {
    const dir = gitSite()
    try {
      writeFileSync(
        join(dir, 'pages/home/hero.md'),
        '---\ntype: Hero\n---\n# UNSAVED\n'
      )
      let fetched = false
      const res = await pull(['--non-interactive'], {
        resolveSiteDir: async () => dir,
        getToken: async () => 'tok',
        fetch: async () => {
          fetched = true
          return jsonRes(null, 404)
        }
      })
      assert.equal(res.exitCode, 1)
      assert.equal(fetched, false) // refuses before touching the backend
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
)

test(
  'pull refuses on an UNTRACKED file — pruning would delete work committed nowhere',
  { skip: !hasGit },
  async () => {
    const dir = gitSite()
    try {
      writeFileSync(
        join(dir, 'pages/home/brand-new.md'),
        '---\ntype: Section\n---\n# new\n'
      )
      const res = await pull(['--non-interactive'], {
        resolveSiteDir: async () => dir,
        getToken: async () => 'tok',
        fetch: async () => jsonRes(null, 404)
      })
      assert.equal(res.exitCode, 1)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
)

test(
  'pull does not cry wolf over its OWN output',
  { skip: !hasGit },
  async () => {
    // The false alarm that makes a guard useless: pull rewrites the tree, so without
    // remembering what it wrote the next pull refuses on files the user never touched
    // — and teaches them to reach for --force, the destructive option.
    const dir = gitSite()
    try {
      mkdirSync(join(dir, '.uniweb'), { recursive: true })
      const body = '---\ntype: Hero\n---\n# rewritten by pull\n'
      writeFileSync(join(dir, 'pages/home/hero.md'), body)
      writeFileSync(
        join(dir, '.uniweb/pull-written.json'),
        JSON.stringify({
          version: 1,
          files: {
            'pages/home/hero.md': createHash('sha256')
              .update(body)
              .digest('hex')
          },
          deleted: []
        })
      )
      const res = await pull(['--non-interactive'], {
        resolveSiteDir: async () => dir,
        getToken: async () => 'tok',
        fetch: async () => jsonRes(null, 404)
      })
      assert.notEqual(res.exitCode, 1)

      // …but an edit ON TOP of pull's output is the user's work again.
      writeFileSync(join(dir, 'pages/home/hero.md'), body + '\nmine\n')
      const res2 = await pull(['--non-interactive'], {
        resolveSiteDir: async () => dir,
        getToken: async () => 'tok',
        fetch: async () => jsonRes(null, 404)
      })
      assert.equal(res2.exitCode, 1)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
)

test(
  'a file pull PRUNED is not mistaken for a user deletion',
  { skip: !hasGit },
  async () => {
    const dir = gitSite()
    try {
      mkdirSync(join(dir, '.uniweb'), { recursive: true })
      rmSync(join(dir, 'pages/home/hero.md'))
      writeFileSync(
        join(dir, '.uniweb/pull-written.json'),
        JSON.stringify({
          version: 1,
          files: {},
          deleted: ['pages/home/hero.md']
        })
      )
      const res = await pull(['--non-interactive'], {
        resolveSiteDir: async () => dir,
        getToken: async () => 'tok',
        fetch: async () => jsonRes(null, 404)
      })
      assert.notEqual(res.exitCode, 1)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
)

// ── pull --merge ────────────────────────────────────────────────────────────
// The merge is entirely client-side: the backend supplies "theirs" via the
// ordinary pull lane and contributes nothing else. The ancestor is the COMMITTED
// version of the file, which is why this needs a real repo rather than a mock.

const twoPara = (a, b) => ({
  type: 'doc',
  content: [
    { type: 'paragraph', content: [{ type: 'text', text: a }] },
    { type: 'paragraph', content: [{ type: 'text', text: b }] }
  ]
})
const siteDocWith = (content) => ({
  $uuid: 'SITE',
  $id: 'site-content',
  $model: '@uniweb/site-content',
  info: { name: { en: 'S' }, foundation: '@a/base' },
  pages: [
    {
      $id: 'home',
      $uuid: 'P1',
      slug: 'home',
      mode: 'page',
      stable_id: 'home',
      page_sections: [
        {
          $id: 'welcome',
          $uuid: 'S1',
          stable_id: 'welcome',
          type: 'Section',
          content
        }
      ]
    }
  ],
  layout_sections: [],
  extensions: [],
  collections: []
})

async function pulledGitSite(baseContent) {
  const dir = tempSite()
  writeFileSync(join(dir, 'site.yml'), "name: S\nfoundation: '@a/base'\n")
    bindSite(dir, 'SITE')
  const g = (a) => execFileSync('git', a, { cwd: dir, stdio: 'ignore' })
  g(['init', '-q'])
  writeFileSync(join(dir, '.gitignore'), '.uniweb\n')
  // Establish the file the way it really gets established: by pulling it.
  await pull(['--force'], {
    resolveSiteDir: async () => dir,
    getToken: async () => 'tok',
    fetch: makeFetch([
      ['/dev/site/content/pull/SITE', siteDocWith(baseContent)]
    ])
  })
  g(['add', '-A'])
  execFileSync(
    'git',
    ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'base'],
    { cwd: dir, stdio: 'ignore' }
  )
  return dir
}

test(
  'pull --merge keeps both sides when they touched different parts of one section',
  { skip: !hasGit },
  async () => {
    // The case that otherwise forces commit → pull → re-apply by hand. Two people
    // edited one section, but not the same words, so there is no real conflict.
    const dir = await pulledGitSite(
      twoPara(
        'First paragraph about pricing.',
        'Second paragraph about support.'
      )
    )
    try {
      const file = join(dir, 'pages/home/welcome.md')
      writeFileSync(
        file,
        readFileSync(file, 'utf8').replace(
          'about pricing.',
          'about pricing, now with tiers.'
        )
      )

      const res = await pull(['--merge'], {
        resolveSiteDir: async () => dir,
        getToken: async () => 'tok',
        fetch: makeFetch([
          [
            '/dev/site/content/pull/SITE',
            siteDocWith(
              twoPara(
                'First paragraph about pricing.',
                'Second paragraph about support, now 24/7.'
              )
            )
          ]
        ])
      })
      assert.equal(res.exitCode, 0)

      const merged = readFileSync(file, 'utf8')
      assert.match(merged, /now with tiers/) // mine survived
      assert.match(merged, /now 24\/7/) // theirs arrived
      assert.ok(!merged.includes('<<<<<<<')) // and it was not a conflict
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
)

test(
  'pull --merge marks a genuine overlap instead of silently picking a side',
  { skip: !hasGit },
  async () => {
    const dir = await pulledGitSite(twoPara('Shared line.', 'Untouched.'))
    try {
      const file = join(dir, 'pages/home/welcome.md')
      writeFileSync(
        file,
        readFileSync(file, 'utf8').replace(
          'Shared line.',
          'MY version of the line.'
        )
      )

      await pull(['--merge'], {
        resolveSiteDir: async () => dir,
        getToken: async () => 'tok',
        fetch: makeFetch([
          [
            '/dev/site/content/pull/SITE',
            siteDocWith(twoPara('THEIR version of the line.', 'Untouched.'))
          ]
        ])
      })

      const merged = readFileSync(file, 'utf8')
      assert.match(merged, /<<<<<<</)
      assert.match(merged, /MY version of the line\./)
      assert.match(merged, /THEIR version of the line\./)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
)

test(
  'pull --merge keeps a locally-added file the backend does not have',
  { skip: !hasGit },
  async () => {
    // No committed ancestor, so no three-way merge is defined. Keeping it is the
    // non-destructive reading; discarding it would lose work to honour a deletion
    // the user never saw.
    const dir = await pulledGitSite(twoPara('A.', 'B.'))
    try {
      const mine = join(dir, 'pages/home/only-mine.md')
      writeFileSync(mine, '---\ntype: Section\n---\n# only mine\n')
      await pull(['--merge'], {
        resolveSiteDir: async () => dir,
        getToken: async () => 'tok',
        fetch: makeFetch([
          ['/dev/site/content/pull/SITE', siteDocWith(twoPara('A.', 'B.'))]
        ])
      })
      assert.equal(readFileSync(mine, 'utf8').includes('only mine'), true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
)

test(
  'pull --merge refuses outside a repo rather than pretending',
  { skip: !hasGit },
  async () => {
    const dir = tempSite()
    writeFileSync(join(dir, 'site.yml'), 'name: S\n')
  bindSite(dir, 'SITE')
    try {
      const res = await pull(['--merge', '--non-interactive'], {
        resolveSiteDir: async () => dir,
        getToken: async () => 'tok',
        fetch: async () => jsonRes(null, 404)
      })
      assert.equal(res.exitCode, 1)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
)

// ── pull --merge in the DEFAULT layout — the repo is the project, the site is `site/`
// Every merge test above runs with the repo AT the site directory, the one layout in
// which `git show HEAD:<path>` finds a site-relative path. In the default one the
// lookup named nothing, every file "kept yours", and the pull then recorded the
// backend's version as taken — so the next push overwrote it (measured 2026-09-23).

const commitAll = (cwd, msg) => {
  execFileSync('git', ['add', '-A'], { cwd, stdio: 'ignore' })
  execFileSync(
    'git',
    ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', msg],
    { cwd, stdio: 'ignore' }
  )
}

// A project whose repo is its root, with the site pulled into `site/` — committed, or
// (`commit: false`) left as the pull wrote it.
async function pulledProject(baseContent, { commit = true } = {}) {
  const root = tempSite()
  const dir = join(root, 'site')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'site.yml'), "name: S\nfoundation: '@a/base'\n")
  bindSite(dir, 'SITE')
  execFileSync('git', ['init', '-q'], { cwd: root, stdio: 'ignore' })
  writeFileSync(join(root, '.gitignore'), '.uniweb\n')
  writeFileSync(join(root, 'README.md'), 'project\n')
  if (!commit) commitAll(root, 'init') // a HEAD that does not hold the site
  await pull(['--force'], {
    resolveSiteDir: async () => dir,
    getToken: async () => 'tok',
    fetch: makeFetch([['/dev/site/content/pull/SITE', siteDocWith(baseContent)]])
  })
  if (commit) commitAll(root, 'base')
  return { root, dir }
}

const mergeAgainst = (dir, content) =>
  pull(['--merge'], {
    resolveSiteDir: async () => dir,
    getToken: async () => 'tok',
    fetch: makeFetch([['/dev/site/content/pull/SITE', siteDocWith(content)]])
  })

test(
  'pull --merge merges in the default layout — the repo is the project, the site is in site/',
  { skip: !hasGit },
  async () => {
    const { root, dir } = await pulledProject(
      twoPara('First paragraph about pricing.', 'Second paragraph about support.')
    )
    try {
      const file = join(dir, 'pages/home/welcome.md')
      writeFileSync(file, readFileSync(file, 'utf8').replace('about pricing.', 'about pricing, now with tiers.'))
      const res = await mergeAgainst(
        dir,
        twoPara('First paragraph about pricing.', 'Second paragraph about support, now 24/7.')
      )
      assert.equal(res.exitCode, 0)
      const merged = readFileSync(file, 'utf8')
      assert.match(merged, /now with tiers/) // mine survived
      assert.match(merged, /now 24\/7/) // theirs arrived — it never did in this layout
      assert.ok(!merged.includes('<<<<<<<'))
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }
)

test(
  'pull --merge keeps a COMMITTED edit that was never pushed — the ancestor is what the pull wrote, not HEAD',
  { skip: !hasGit },
  async () => {
    // Commit, push refused, `uniweb refresh`: with HEAD as the ancestor the commit
    // read as the starting point, the backend's version won whole, and the edit was
    // reverted in the working tree. A clean tree also hid it from the dirty scan.
    const { root, dir } = await pulledProject(
      twoPara('First paragraph about pricing.', 'Second paragraph about support.')
    )
    try {
      const file = join(dir, 'pages/home/welcome.md')
      writeFileSync(file, readFileSync(file, 'utf8').replace('about pricing.', 'about pricing, now with tiers.'))
      commitAll(root, 'my edit')
      const res = await mergeAgainst(
        dir,
        twoPara('First paragraph about pricing.', 'Second paragraph about support, now 24/7.')
      )
      assert.equal(res.exitCode, 0)
      const merged = readFileSync(file, 'utf8')
      assert.match(merged, /now with tiers/)
      assert.match(merged, /now 24\/7/)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }
)

test(
  'pull --merge with no common version shows BOTH, never ours alone',
  { skip: !hasGit },
  async () => {
    // The pull's version was never committed, so there is no ancestor. Keeping ours
    // hid the backend's change entirely — and recorded it as taken.
    const { root, dir } = await pulledProject(twoPara('A.', 'B.'), { commit: false })
    try {
      const file = join(dir, 'pages/home/welcome.md')
      writeFileSync(file, readFileSync(file, 'utf8').replace('A.', 'A, mine.'))
      const res = await mergeAgainst(dir, twoPara('A.', 'B, theirs.'))
      assert.equal(res.exitCode, 1) // a conflict is work left for a person
      const merged = readFileSync(file, 'utf8')
      assert.match(merged, /<<<<<<</)
      assert.match(merged, /A, mine\./)
      assert.match(merged, /B, theirs\./)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }
)

test(
  'after a merge, the merged-in edit is still local work — not recorded as the pull\'s output',
  { skip: !hasGit },
  async () => {
    // Recorded after the merge, the edit read as pull output: a later plain pull
    // would overwrite it without refusing, and a push saw nothing to send.
    const { root, dir } = await pulledProject(
      twoPara('First paragraph about pricing.', 'Second paragraph about support.')
    )
    try {
      const rel = 'pages/home/welcome.md'
      const file = join(dir, rel)
      writeFileSync(file, readFileSync(file, 'utf8').replace('about pricing.', 'about pricing, now with tiers.'))
      await mergeAgainst(
        dir,
        twoPara('First paragraph about pricing.', 'Second paragraph about support, now 24/7.')
      )
      assert.equal(isPullOutput(dir, rel, readWritten(dir)), false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }
)

test('the version tokens a pull carries are banked once its merge is done', async () => {
  // Control for the rule that withholds them when a merge cannot run: the ordinary
  // pull must still re-arm the gate from what it took.
  const dir = tempSite()
  try {
    writeFileSync(join(dir, 'site.yml'), "name: S\nfoundation: '@a/base'\n")
    bindSite(dir, 'SITE')
    const zip = createZip([
      {
        name: 'manifest.json',
        data: Buffer.from(
          JSON.stringify({
            format: 'uwx/1',
            entries: [
              {
                kind: 'entity',
                uuid: 'SITE',
                file: 'entities/SITE.json',
                version: 'V1',
                item_versions: { P1: 'p1', S1: 's1' }
              }
            ]
          })
        )
      },
      { name: 'entities/SITE.json', data: Buffer.from(JSON.stringify(siteDocWith(twoPara('A.', 'B.')))) }
    ])
    await pull(['--force', '--no-records'], {
      resolveSiteDir: async () => dir,
      getToken: async () => 'tok',
      fetch: async () => ({
        ok: true,
        status: 200,
        statusText: '',
        headers: { get: () => null },
        arrayBuffer: async () => zip
      })
    })
    assert.deepEqual(readBaseVersions(dir, TEST_ORIGIN), { SITE: 'V1' })
    assert.deepEqual(readItemBaseVersions(dir, TEST_ORIGIN), { P1: 'p1', S1: 's1' })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('an ETag cached by an older pull is not echoed — it may describe content never taken', async () => {
  const dir = tempSite()
  try {
    writeFileSync(join(dir, 'site.yml'), "name: Keep\nfoundation: '@a/base'\n")
    bindSite(dir, 'SITE-V1')
    mkdirSync(join(dir, '.uniweb'), { recursive: true })
    writeFileSync(join(dir, '.uniweb/pull-cache.json'), JSON.stringify({ version: 1, content: '"stale"' }))
    let sentINM = 'unset'
    await pull(['--no-records', '--force'], {
      resolveSiteDir: async () => dir,
      getToken: async () => 'tok',
      fetch: async (url, opts) => {
        sentINM = opts?.headers?.['If-None-Match']
        return jsonRes(null, 404)
      }
    })
    assert.equal(sentINM, undefined)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// ⭐ Pins HERMETICITY itself, not the mechanism that currently provides it.
//
// The defect this guards against is invisible on the machine most likely to run
// the suite: it appears only when the developer has a logged-in session or a
// `UNIWEB_REGISTER_URL`, and CI has neither. So a regression would pass review,
// pass CI, and break on the laptops of exactly the people doing local-backend
// work.
//
// A hostile ambient origin makes the failure reproducible ANYWHERE. Remove the
// `--backend` pins above as redundant and this goes red on a clean checkout,
// rather than months later on one developer's machine.
test('pull is hermetic — a hostile ambient origin cannot reach it', async () => {
  const prior = process.env.UNIWEB_REGISTER_URL
  process.env.UNIWEB_REGISTER_URL = 'http://hostile.invalid'
  try {
    const dir = tempSite()
    writeFileSync(join(dir, 'site.yml'), "name: Old\nfoundation: '@a/base'\n")
    bindSite(dir, 'SITE')
    const document = {
      $uuid: 'SITE',
      $id: 'site-content',
      $model: '@uniweb/site-content',
      info: { name: { en: 'Pulled' }, foundation: '@a/base' },
      pages: []
    }

    const res = await pull(['--force'], {
      resolveSiteDir: async () => dir,
      getToken: async () => 'tok',
      fetch: makeFetch([['/dev/site/content/pull/SITE', document]])
    })

    // ⛔ Without the pin this is 1, and the message is about site identity —
    // which reads as product behaviour rather than an un-injected dependency.
    // Verified 2026-08-26 by removing it: this case, and only this case, fails.
    assert.equal(res.exitCode, 0)
  } finally {
    if (prior === undefined) delete process.env.UNIWEB_REGISTER_URL
    else process.env.UNIWEB_REGISTER_URL = prior
  }
})
