/**
 * site-sync — pushSyncPackages (the two-lane submission core, extracted from the push
 * command) + the response helpers. The push command flow has no DI seam, but
 * pushSyncPackages takes the client + report as parameters, so the lane orchestration
 * (CREATE vs UPDATE, the minted-uuid write-back, the failure exit codes, the
 * send-only-changed cache) is unit-driven here with a mock client + a temp site dir.
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
import { join } from 'node:path'
import yaml from 'js-yaml'
import {
  extractFinalized,
  templateOutcome,
  pushSyncPackages,
  ensureSiteExists,
  clearRemoteSyncStateIfUnbound,
  readBaseVersions,
  readSyncCache,
  readAppliedInjections,
  readSiteWorkspace,
  readItemBaseVersions,
  mergeItemBaseVersions,
  resolveSiteOrgForCreate,
  writeUnitBases,
  readItemUuids,
  probeUnpushed,
  rebankSyncHashes,
  EXPLICIT_OWNER
} from '../src/backend/site-sync.js'
import { createZip, computeUnitHashes } from '@uniweb/build/uwx'
import { readSiteIdentity } from '../src/utils/site-identity.js'

const ORIGIN = 'http://x'

const ok = (body) => ({
  ok: true,
  status: 200,
  statusText: 'OK',
  json: async () => body,
  text: async () => JSON.stringify(body)
})
const fail = (status, body = 'boom') => ({
  ok: false,
  status,
  statusText: 'Error',
  json: async () => ({}),
  text: async () => body
})
const finalized = (entries) => ({ report: { finalized: entries } })

function tmpSite() {
  const dir = mkdtempSync(join(tmpdir(), 'site-sync-'))
  writeFileSync(join(dir, 'site.yml'), "name: Acme\nfoundation: '@a/base'\n")
  return dir
}


/** Bind this site dir to ORIGIN in `sync.json` — where identity lives since 2026-09-20. */
function bind(dir, uuid, org) {
  const file = join(dir, 'sync.json')
  let doc = { version: 1, backends: {} }
  if (existsSync(file)) {
    try { doc = JSON.parse(readFileSync(file, 'utf8')) } catch { /* fresh */ }
  }
  doc.backends[ORIGIN] = {
    ...(doc.backends[ORIGIN] || {}),
    site: { ...(uuid ? { uuid } : {}), ...(org ? { org } : {}) }
  }
  writeFileSync(file, JSON.stringify(doc, null, 2) + '\n')
}

function makeReport() {
  const calls = { info: [], note: [], error: [] }
  const report = {
    info: (m) => calls.info.push(m),
    note: (m) => calls.note.push(m),
    error: (m) => calls.error.push(m),
    dim: (s) => s
  }
  return { report, calls }
}

const siteOnlyPkg = (extra) => ({
  siteContent: {
    buffer: Buffer.from('site'),
    entityCount: 1,
    models: ['@uniweb/site-content'],
    index: [{ kind: 'site' }]
  },
  records: null,
  hashes: {},
  ...extra
})

test('extractFinalized tolerates the report.finalized / bare-array shapes and drops invalid entries', () => {
  assert.deepEqual(
    extractFinalized({
      report: { finalized: [{ index: 0, uuid: 'A', changed: true }] }
    }),
    [
      {
        index: 0,
        uuid: 'A',
        changed: true,
        version: null,
        itemVersions: null,
        document: null
      }
    ]
  )
  assert.deepEqual(extractFinalized([{ index: 1, uuid: 'B' }]), [
    {
      index: 1,
      uuid: 'B',
      changed: undefined,
      version: null,
      itemVersions: null,
      document: null
    }
  ])
  // entries without a valid index + uuid are dropped; a non-list payload → null
  assert.deepEqual(
    extractFinalized({ finalized: [{ uuid: 'no-index' }, { index: 2 }] }),
    []
  )
  assert.equal(extractFinalized({}), null)
})

test('extractFinalized carries the post-write version (the push-gate re-arm token)', () => {
  // The whole point of the field: without it, caching a base only on pull makes
  // the gate self-defeating — the second consecutive push is stale by construction.
  assert.deepEqual(
    extractFinalized([
      {
        index: 0,
        uuid: 'A',
        changed: true,
        version: '2026-07-25T21:09:44.120388Z'
      }
    ]),
    [
      {
        index: 0,
        uuid: 'A',
        changed: true,
        version: '2026-07-25T21:09:44.120388Z',
        itemVersions: null,
        document: null
      }
    ]
  )
  // A non-string version is ignored rather than cached as junk.
  assert.equal(
    extractFinalized([{ index: 0, uuid: 'A', version: 42 }])[0].version,
    null
  )
})

test('a successful push banks the returned versions; a refused lane still banks what landed', async () => {
  const dir = tmpSite()
  const client = {
    origin: 'http://x',
    createSiteContent: async () =>
      ok(finalized([{ index: 0, uuid: 'S1', changed: true, version: 'V1' }]))
  }
  const { report } = makeReport()
  const pkg = siteOnlyPkg({
    siteContentUuid: undefined,
    hashes: { '@uniweb/site-content site': 'h1' }
  })

  const res = await pushSyncPackages({
    client,
    siteDir: dir,
    pkg,
    report
  })
  assert.equal(res.exitCode, 0)
  assert.deepEqual(readBaseVersions(dir, ORIGIN), { S1: 'V1' })

  // The hash cache and the version map share one file and must not clobber each other.
  assert.deepEqual(readSyncCache(dir, ORIGIN), { '@uniweb/site-content site': 'h1' })
})

// ─── the banked hash and the document it describes ───────────────────────────
// A push hashes the DELIVERED document — local `/images/x.svg` rewritten to the
// serve URL it just uploaded to, `info.foundation` replaced by the pinned ref — and
// banks those hashes. A hash says nothing about WHICH document it is of, so a cache
// that records the hashes and not the delivery cannot be re-checked offline: the
// reader rebuilds the AUTHORED document and matches nothing, forever.
//
// That is the defect backend reported in backend↔framework (2026-08-19):
// `uniweb push` said "1 entity unchanged since the last push" and `uniweb status
// --json` said `changed: 1`, from one cache, seconds apart.

test('a push banks the injections its emit applied, beside the hashes — except the one with a committed home', async () => {
  const dir = tmpSite()
  const applied = {
    assetRewrite: { '/images/a.svg': 'https://cdn.example/assets/a/base.svg' },
    injectInfo: { foundation: '@acme/base@1.2.3' },
    // ⛔ Must NOT be banked: `assets.json` is committed project state holding this
    // exact map, and the reader re-derives it there. A gitignored second copy is a
    // second thing to disagree, and it is wiped by clearRemoteSyncState while the
    // committed map correctly survives.
    assetIds: { '/images/a.svg': { id: 'aaa', ext: 'svg' } }
  }
  const client = {
    origin: 'http://x',
    createSiteContent: async () =>
      ok(finalized([{ index: 0, uuid: 'S1', changed: true }]))
  }
  const { report } = makeReport()
  const res = await pushSyncPackages({
    client,
    siteDir: dir,
    report,
    pkg: siteOnlyPkg({ hashes: { '@uniweb/site-content site': 'h1' }, applied })
  })
  assert.equal(res.exitCode, 0)
  const banked = readAppliedInjections(dir, ORIGIN)
  assert.deepEqual(banked, {
    assetRewrite: applied.assetRewrite,
    injectInfo: applied.injectInfo
  })
  assert.equal(banked.assetIds, undefined)
  // Still one file, still not clobbering the map beside it.
  assert.deepEqual(readSyncCache(dir, ORIGIN), { '@uniweb/site-content site': 'h1' })
})

test('a push that applied NOTHING clears the injections an earlier one banked', async () => {
  // The two maps are written as a pair or the cache lies. A leftover rewrite outliving
  // the hashes it belongs to would be replayed against a document it does not
  // describe — and nothing errors on either side, which is how it would go unseen.
  const dir = tmpSite()
  const client = {
    origin: 'http://x',
    createSiteContent: async () =>
      ok(finalized([{ index: 0, uuid: 'S1', changed: true }])),
    updateSiteContent: async () =>
      ok(finalized([{ index: 0, uuid: 'S1', changed: true }]))
  }
  const { report } = makeReport()
  await pushSyncPackages({
    client,
    siteDir: dir,
    report,
    pkg: siteOnlyPkg({
      hashes: { k: 'h1' },
      applied: { assetRewrite: { '/images/a.svg': 'https://cdn.example/a' } }
    })
  })
  assert.notDeepEqual(readAppliedInjections(dir, ORIGIN), {}) // control: it was banked

  await pushSyncPackages({
    client,
    siteDir: dir,
    report,
    pkg: siteOnlyPkg({ hashes: { k: 'h2' }, applied: {} })
  })
  assert.deepEqual(readAppliedInjections(dir, ORIGIN), {})
})

// ─── per-item tokens must be re-armed from the PUSH response ──────────────────
// The entity token was returned on push precisely so consecutive pushes stop being
// stale by construction. The per-item token had the same hole until backend
// `d7e46335` began echoing `item_versions`, and the CLI read it on pull only — so a
// push wrote, every token for a record it just changed went stale, and push 2
// conflicted on records nobody else had touched. Unrecoverable locally: the tokens
// are opaque, so only a pull could refresh them, and a pull rewrites the tree.

test('TWO CONSECUTIVE PUSHES: item tokens come from the push response, not a pull', async () => {
  const dir = tmpSite()
  const seen = []
  let round = 0
  const client = {
    origin: 'http://x',
    updateSiteContent: async () => {
      round += 1
      return ok(
        finalized([
          {
            index: 0,
            uuid: 'S1',
            changed: true,
            version: `V${round}`,
            item_versions: { REC: `t${round}` }
          }
        ])
      )
    }
  }
  const { report } = makeReport()
  const push = async () => {
    // What THIS push would send is what the cache holds when it starts — the same
    // read `push.js` does via readItemBaseVersions.
    seen.push(readItemBaseVersions(dir, ORIGIN).REC ?? null)
    return pushSyncPackages({
      client,
      siteDir: dir,
      pkg: siteOnlyPkg({ siteContentUuid: 'S1', hashes: {} }),
      report
    })
  }

  assert.equal((await push()).exitCode, 0)
  assert.equal((await push()).exitCode, 0)

  // Push 1 had nothing cached; push 2 carried push 1's token — NOT a stale one, and
  // with no pull in between. Reading on pull alone is what made this `[null, null]`,
  // and the backend would then refuse push 2 naming records nobody touched.
  assert.deepEqual(seen, [null, 't1'])
  assert.deepEqual(readItemBaseVersions(dir, ORIGIN), { REC: 't2' })
  // The entity grain keeps working alongside it, in the same file.
  assert.deepEqual(readBaseVersions(dir, ORIGIN), { S1: 'V2' })
})

test('an older backend omitting item_versions leaves the cached tokens alone', async () => {
  const dir = tmpSite()
  mergeItemBaseVersions(dir, ORIGIN, { REC: 'from-a-pull' })
  const client = {
    origin: 'http://x',
    // No `item_versions` — the pre-d7e46335 shape.
    updateSiteContent: async () =>
      ok(finalized([{ index: 0, uuid: 'S1', changed: true, version: 'V1' }]))
  }
  const { report } = makeReport()
  const res = await pushSyncPackages({
    client,
    siteDir: dir,
    pkg: siteOnlyPkg({ siteContentUuid: 'S1', hashes: {} }),
    report
  })
  assert.equal(res.exitCode, 0)
  // Absent ≠ empty. Clearing here would silently drop to the entity grain AND throw
  // away a token a pull had legitimately banked.
  assert.deepEqual(readItemBaseVersions(dir, ORIGIN), { REC: 'from-a-pull' })
})

test('item tokens are banked even when the push is not the last lane to succeed', async () => {
  const dir = tmpSite()
  const client = {
    origin: 'http://x',
    updateSiteContent: async () =>
      ok(
        finalized([
          {
            index: 0,
            uuid: 'S1',
            changed: true,
            version: 'V1',
            item_versions: { REC: 't1' }
          }
        ])
      ),
    // The folder lane then fails: what lane 1 banked must survive, or the retry
    // re-sends a base the backend has already moved past.
    pushFolder: async () => ({
      ok: false,
      status: 500,
      statusText: 'Server Error',
      text: async () => 'boom'
    })
  }
  const { report } = makeReport()
  const res = await pushSyncPackages({
    client,
    siteDir: dir,
    pkg: {
      ...siteOnlyPkg({ siteContentUuid: 'S1', hashes: {} }),
      records: { buffer: Buffer.from('PK'), index: [] }
    },
    report
  })
  assert.equal(res.exitCode, 1)
  assert.deepEqual(readItemBaseVersions(dir, ORIGIN), { REC: 't1' })
})

test('a stale refusal explains WHICH pages diverged, and attributes them', async () => {
  const dir = tmpSite()
  const page = (id, slug, body) => ({
    stable_id: id,
    slug: { en: slug },
    title: { en: slug },
    page_sections: [
      {
        type: 'Section',
        stable_id: slug,
        content: {
          type: 'doc',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: body }] }
          ]
        }
      }
    ]
  })
  const uwx = (doc) =>
    createZip([
      {
        name: 'manifest.json',
        data: Buffer.from(
          JSON.stringify({
            format: 'uwx/1',
            entries: [{ kind: 'entity', uuid: 'S1', file: 'entities/S1.json' }]
          })
        )
      },
      { name: 'entities/S1.json', data: Buffer.from(JSON.stringify(doc)) }
    ])
  // Base = what both sides last agreed on. We edited /home; they added /news and
  // edited /about. Forcing would DELETE their new page — the headline.
  const base = {
    $model: '@uniweb/site-content',
    pages: [page('h', 'home', 'H0'), page('a', 'about', 'A0')]
  }
  writeUnitBases(dir, ORIGIN, {
    local: computeUnitHashes(base),
    remote: computeUnitHashes(base)
  })
  const localDoc = {
    $model: '@uniweb/site-content',
    pages: [page('h', 'home', 'H-mine'), page('a', 'about', 'A0')]
  }
  const remoteDoc = {
    $model: '@uniweb/site-content',
    pages: [
      page('h', 'home', 'H0'),
      page('a', 'about', 'A-theirs'),
      page('n', 'news', 'new upstream')
    ]
  }

  const problem = {
    status: 409,
    title: 'Conflict',
    detail: 'x',
    reason: 'stale_base',
    stale_entities: ['S1']
  }
  const client = {
    origin: 'http://x',
    updateSiteContent: async () => ({
      ok: false,
      status: 409,
      statusText: 'Conflict',
      text: async () => JSON.stringify(problem),
      json: async () => problem
    }),
    pullSiteContent: async () => ({
      ok: true,
      arrayBuffer: async () => uwx(remoteDoc)
    })
  }
  const { report, calls } = makeReport()
  const pkg = siteOnlyPkg({ siteContentUuid: 'S1', hashes: {} })
  pkg.siteContent.buffer = uwx(localDoc)

  const res = await pushSyncPackages({
    client,
    siteDir: dir,
    pkg,
    report
  })
  assert.equal(res.exitCode, 1)
  const out = [...calls.error, ...calls.note].join('\n')
  assert.match(out, /forcing DELETES these.*news/)
  assert.match(out, /Changed upstream — forcing discards these.*about/)
  assert.match(out, /Changed by you — pulling discards these.*home/)
})

test('the stale explainer degrades to the plain refusal when the remote read fails', async () => {
  // It runs on an already-failed path: a second failure must not replace a clear
  // error with a confusing one.
  const dir = tmpSite()
  const problem = {
    status: 409,
    reason: 'stale_base',
    stale_entities: ['S1'],
    title: 'Conflict',
    detail: 'x'
  }
  const client = {
    origin: 'http://x',
    updateSiteContent: async () => ({
      ok: false,
      status: 409,
      statusText: 'Conflict',
      text: async () => JSON.stringify(problem),
      json: async () => problem
    }),
    pullSiteContent: async () => {
      throw new Error('network down')
    }
  }
  const { report, calls } = makeReport()
  const res = await pushSyncPackages({
    client,
    siteDir: dir,
    pkg: siteOnlyPkg({ siteContentUuid: 'S1', hashes: {} }),
    report
  })
  assert.equal(res.exitCode, 1)
  const out = [...calls.error, ...calls.note].join('\n')
  assert.match(out, /newer content than your last pull/)
  assert.match(out, /Changed upstream: 1 entity \(S1\)/) // the fallback line
  assert.match(out, /--force/)
})

test('a stale_base 409 is reported as a staleness refusal, not the structure conflict', async () => {
  const dir = tmpSite()
  const problem = {
    status: 409,
    title: 'Conflict',
    detail: 'content changed upstream since your last pull — pull first (…)',
    reason: 'stale_base',
    stale_entities: ['0198f2']
  }
  const client = {
    origin: 'http://x',
    updateSiteContent: async () => ({
      ok: false,
      status: 409,
      statusText: 'Conflict',
      text: async () => JSON.stringify(problem),
      json: async () => problem
    })
  }
  const { report, calls } = makeReport()
  const pkg = siteOnlyPkg({ siteContentUuid: 'S1', hashes: {} })

  const res = await pushSyncPackages({
    client,
    siteDir: dir,
    pkg,
    report
  })
  assert.equal(res.exitCode, 1)
  const out = [...calls.error, ...calls.note].join('\n')
  assert.match(out, /newer content than your last pull/)
  assert.match(out, /0198f2/)
  assert.match(out, /--force/)
  // Must NOT misreport it as the genesis-owned collection-structure conflict.
  assert.ok(!/collection structure is already established/.test(out))
})

test('pushSyncPackages CREATE: mints + records the site $uuid, persists the cache, exit 0', async () => {
  const dir = tmpSite()
  let created = 0
  const client = {
    origin: 'http://x',
    createSiteContent: async () => {
      created++
      return ok(finalized([{ index: 0, uuid: 'NEW-UUID', changed: true }]))
    }
  }
  const { report } = makeReport()
  const pkg = siteOnlyPkg({
    siteContentUuid: undefined,
    hashes: { '@uniweb/site-content site': 'h1' }
  })

  const res = await pushSyncPackages({
    client,
    siteDir: dir,
    pkg,
    report
  })

  assert.equal(created, 1)
  assert.equal(res.exitCode, 0)
  assert.equal(res.boundSiteUuid, 'NEW-UUID')
  assert.equal(readSiteIdentity(dir, ORIGIN).uuid, 'NEW-UUID')
  // Where it was recorded, named truthfully: this said "in site.yml" for a day after
  // identity moved to sync.json, while the create notice beside it said sync.json.
  assert.ok(res.wrote.includes('recorded the site in sync.json'), JSON.stringify(res.wrote))
  // the send-only-changed cache is persisted on success
  const cache = JSON.parse(
    readFileSync(join(dir, '.uniweb/backend-cache.json'), 'utf8')
  ).backends[ORIGIN]
  assert.equal(cache.hashes['@uniweb/site-content site'], 'h1')
  rmSync(dir, { recursive: true, force: true })
})

test('pushSyncPackages UPDATE: a known $uuid updates by uuid (never CREATE)', async () => {
  const dir = tmpSite()
  let updatedWith = null
  let created = 0
  const client = {
    origin: 'http://x',
    createSiteContent: async () => {
      created++
      return ok(finalized([]))
    },
    updateSiteContent: async (uuid) => {
      updatedWith = uuid
      return ok(finalized([{ index: 0, uuid: 'EXIST', changed: false }]))
    }
  }
  const { report } = makeReport()
  const res = await pushSyncPackages({
    client,
    siteDir: dir,
    pkg: siteOnlyPkg({ siteContentUuid: 'EXIST' }),
    report
  })

  assert.equal(created, 0, 'a known uuid must UPDATE, never CREATE')
  assert.equal(updatedWith, 'EXIST')
  assert.equal(res.exitCode, 0)
  assert.equal(res.boundSiteUuid, 'EXIST')
  rmSync(dir, { recursive: true, force: true })
})

test('pushSyncPackages: a rejected lane returns exit 1, reports the error, and does NOT persist the cache', async () => {
  const dir = tmpSite()
  const client = {
    origin: 'http://x',
    createSiteContent: async () => fail(500, 'server boom')
  }
  const { report, calls } = makeReport()
  const res = await pushSyncPackages({
    client,
    siteDir: dir,
    pkg: siteOnlyPkg({ siteContentUuid: undefined, hashes: { x: 'y' } }),
    report
  })

  assert.equal(res.exitCode, 1)
  assert.ok(calls.error.some((m) => /rejected: HTTP 500/.test(m)))
  assert.equal(
    existsSync(join(dir, '.uniweb/backend-cache.json')),
    false,
    'a failed push must not persist the cache'
  )
  rmSync(dir, { recursive: true, force: true })
})

test('pushSyncPackages: a 409 explains the facet-genesis fix (push as a new site) instead of a bare error', async () => {
  const dir = tmpSite()
  const client = {
    origin: 'http://x',
    createSiteContent: async () => fail(409, 'folder facet already established')
  }
  const { report, calls } = makeReport()
  const res = await pushSyncPackages({
    client,
    siteDir: dir,
    pkg: siteOnlyPkg({ siteContentUuid: undefined, hashes: { x: 'y' } }),
    report
  })

  assert.equal(res.exitCode, 1)
  assert.ok(calls.error.some((m) => /rejected: HTTP 409/.test(m)))
  // the friendlier guidance — the v1 folder is genesis-owned, so the change lands as a
  // new site. It said "clear `$uuid` in site.yml" until 2026-09-21, a key that had left
  // site.yml the day before; forgetting this backend is what drops the binding now.
  assert.ok(
    calls.note.some(
      (m) =>
        /push it as a new site/.test(m) &&
        /uniweb forget --backend http:\/\/x, then push again/.test(m) &&
        !/\$uuid/.test(m)
    ),
    `explains the forget-and-push fix:\n${calls.note.join('\n')}`
  )
  rmSync(dir, { recursive: true, force: true })
})

test('pushSyncPackages: the folder lane is keyed by the bound site uuid', async () => {
  const dir = tmpSite()
  let folderKey = null
  const client = {
    origin: 'http://x',
    updateSiteContent: async () =>
      ok(finalized([{ index: 0, uuid: 'SITE', changed: true }])),
    pushFolder: async (uuid) => {
      folderKey = uuid
      return ok(finalized([{ index: 0, uuid: 'FOLDER', changed: true }]))
    }
  }
  const { report } = makeReport()
  const pkg = siteOnlyPkg({
    siteContentUuid: 'SITE',
    records: {
      buffer: Buffer.from('c'),
      entityCount: 1,
      models: ['@uniweb/folder'],
      index: [{ kind: 'folder' }]
    }
  })

  const res = await pushSyncPackages({
    client,
    siteDir: dir,
    pkg,
    report
  })

  assert.equal(res.exitCode, 0)
  assert.equal(
    folderKey,
    'SITE',
    'the folder push is keyed by the site-content uuid'
  )
  rmSync(dir, { recursive: true, force: true })
})

// ⛔ A backend must echo `$disabled: true` on a record it stored disabled. One that
// predates the key stores the draft ENABLED, and it would be delivered once the site is
// published. The push fails, after banking its state, so a publish (which stops on
// anything but 0) never goes live on top of it, and the file keeps its `draft: true`.
const draftPush = (echo) => {
  const dir = tmpSite()
  mkdirSync(join(dir, 'records', 'article'), { recursive: true })
  const file = join(dir, 'records', 'article', 'soon.yml')
  writeFileSync(file, 'title: Soon\ndraft: true\n')
  const declaration = {
    name: '@a/article',
    sections: { article: { brief: true, fields: { title: { type: 'string' } } } }
  }
  const client = {
    origin: ORIGIN,
    updateSiteContent: async () => ok(finalized([{ index: 0, uuid: 'SITE', changed: true }])),
    pushFolder: async () =>
      ok(
        finalized([
          { index: 0, uuid: 'FOLDER', changed: true },
          {
            index: 1,
            uuid: 'R1',
            changed: true,
            document: {
              $uuid: 'R1',
              $model: '@a/article',
              ...(echo ? { $disabled: true } : {}),
              article: { title: 'Soon' }
            }
          }
        ])
      )
  }
  const pkg = siteOnlyPkg({
    siteContentUuid: 'SITE',
    records: {
      buffer: Buffer.from('c'),
      entityCount: 2,
      models: ['@uniweb/folder', '@a/article'],
      index: [
        { kind: 'folder' },
        { id: 'article/soon', slug: 'soon', model: '@a/article', sourceFile: file, format: 'yaml', declaration, draft: true }
      ]
    }
  })
  return { dir, file, client, pkg }
}

test('a draft the backend stored enabled fails the push, naming it, and the file stays a draft', async () => {
  const { dir, file, client, pkg } = draftPush(false)
  const { report, calls } = makeReport()
  const res = await pushSyncPackages({ client, siteDir: dir, pkg, report })
  assert.equal(res.exitCode, 1)
  const said = calls.error.join('\n')
  assert.match(said, /did not keep a record as a draft/)
  assert.match(said, /records\/article\/soon\.yml/)
  const out = yaml.load(readFileSync(file, 'utf8'))
  assert.equal(out.draft, true, 'the draft flag survives')
  assert.equal(out.$uuid, 'R1', 'identity is still written back')
  rmSync(dir, { recursive: true, force: true })
})

// CONTROL — a backend that kept it: exit 0, nothing reported, the file rendered as a draft.
test('CONTROL — a draft the backend kept pushes cleanly and stays a draft', async () => {
  const { dir, file, client, pkg } = draftPush(true)
  const { report, calls } = makeReport()
  const res = await pushSyncPackages({ client, siteDir: dir, pkg, report })
  assert.equal(res.exitCode, 0)
  assert.deepEqual(calls.error, [])
  assert.deepEqual(yaml.load(readFileSync(file, 'utf8')), { $uuid: 'R1', title: 'Soon', draft: true })
  rmSync(dir, { recursive: true, force: true })
})

test('an identity_required 400 is explained, not surfaced as a raw error', async () => {
  const dir = tmpSite()
  const problem = {
    status: 400,
    title: 'Identity Required',
    reason: 'identity_required',
    detail: 'identity required: entity 77, section 18: …',
    entity_id: 77,
    section_id: 18,
    records_without_uuid: 2,
    stored_items: 2
  }
  const client = {
    origin: 'http://x',
    updateSiteContent: async () => ({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      text: async () => JSON.stringify(problem),
      json: async () => problem
    }),
    pullSiteContent: async () => ({ ok: false, status: 500 })
  }
  const { report, calls } = makeReport()
  const res = await pushSyncPackages({
    client,
    siteDir: dir,
    pkg: siteOnlyPkg({ siteContentUuid: 'S1', hashes: {} }),
    report
  })
  assert.equal(res.exitCode, 1)
  const out = [...calls.error, ...calls.note].join('\n')

  // ⭐ THE BACKEND SENDS WHAT LOCATES THE PROBLEM, AND WE USED TO DISCARD IT.
  // Note this fixture already carried `section_id` / `records_without_uuid` /
  // `stored_items` before 2026-08-28 — the fields were always in the response; the
  // handler rendered them as one sentence that named none of them, so every refusal
  // anyone collected in the field was missing the only detail that says WHERE.
  assert.match(out, /section 18/, 'must name the offending section')
  assert.match(out, /2 record\(s\), none carrying a `\$uuid`/, 'must give the count that was blank')
  assert.match(out, /2 item\(s\) are already stored/, 'must give what would have been replaced')
  assert.match(out, /Nothing was written/)

  // ⛔ The refusal is PER-SECTION, so the old wording was wrong three ways in the
  // ordinary case: the copy does have identity, no recovery was attempted, and a
  // pull re-fetches a map that is already intact. Suggesting one sends the user to
  // fix something that is not broken.
  assert.ok(!/no record of the site's item identity/.test(out), 'must not claim the copy has no identity')
  assert.ok(!/uniweb pull/.test(out), 'must not prescribe a pull for a cache that is intact')

  // Must not be mistaken for the staleness refusal — different cause, different fix.
  assert.ok(!/newer content than your last pull/.test(out))
})

test('headProvenance reports the commit and whether the tree was clean', async () => {
  // A version number cannot answer "what is actually live" — two publishes of the
  // same version are not the same content. `dirty` carries as much weight as the
  // sha: it says the deploy matched no commit, so the sha alone would mislead.
  const { execFileSync } = await import('node:child_process')
  const { headProvenance } = await import('../src/utils/git.js')
  const dir = tmpSite()
  assert.equal(headProvenance(dir), null) // not a repo

  const g = (a) => execFileSync('git', a, { cwd: dir, stdio: 'ignore' })
  try {
    g(['init', '-q'])
  } catch {
    return
  } // no git available — nothing to assert
  g(['add', '-A'])
  execFileSync(
    'git',
    ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'x'],
    { cwd: dir, stdio: 'ignore' }
  )

  const clean = headProvenance(dir)
  assert.match(clean.sha, /^[0-9a-f]{40}$/)
  assert.equal(clean.dirty, false)

  writeFileSync(join(dir, 'site.yml'), 'name: changed\n')
  assert.equal(headProvenance(dir).dirty, true)
})

test('a 404 on a uuid-bound lane names BOTH causes, recoverable one first', async () => {
  // A bare 404 leaves the user with no idea that the remedy is local. But there are two
  // local causes, and they call for opposite actions:
  //
  //   · the site was deleted there              → forget that backend, push as new
  //   · you are pointed at the wrong backend    → log in elsewhere; NOTHING is lost
  //
  // (The first read "clear `$uuid` from site.yml" until 2026-09-21: a key that left
  // site.yml the day before, so the advice named nothing that existed.)
  //
  // Naming only the first (which this branch did until 2026-08-24) hands destructive
  // advice to anyone hitting the second: the site is fine, and clearing its uuid orphans
  // a live binding. `assertSiteBackendScope` now catches most wrong-backend cases before
  // the request goes out, but not a project that predates `$backend` and records no
  // scope — so ORDER matters here, and the cheap, reversible cause must come first.
  const dir = tmpSite()
  const client = {
    origin: 'http://x',
    updateSiteContent: async () => ({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      text: async () => ''
    })
  }
  const { report, calls } = makeReport()
  const pkg = siteOnlyPkg({ siteContentUuid: 'GONE-1' })

  const res = await pushSyncPackages({
    client,
    siteDir: dir,
    pkg,
    report
  })
  assert.equal(res.exitCode, 1)
  const notes = calls.note.join('\n')
  assert.match(notes, /no site with uuid GONE-1/)
  assert.match(notes, /http:\/\/x/) // names WHICH backend answered 404
  assert.match(notes, /wrong backend/)
  assert.match(notes, /deleted there/)
  assert.match(notes, /uniweb forget --backend http:\/\/x, then push again/)
  assert.doesNotMatch(notes, /\$uuid/, 'site.yml holds no identity to clear')
  // The ordering is the point, not decoration: the destructive remedy must not be the
  // first thing a reader acts on. Assert it structurally so a later reword cannot
  // silently put them back the other way round.
  assert.ok(
    notes.indexOf('wrong backend') < notes.indexOf('deleted there'),
    `the recoverable cause must be offered first:\n${notes}`
  )
})

test('a 404 on the CREATE lane does NOT claim a site was deleted', async () => {
  // The create carries no uuid, so a 404 there means the route is missing, not that
  // a site is gone — advising the user to forget a site they do not have would be a
  // confident wrong answer.
  const dir = tmpSite()
  const client = {
    origin: 'http://x',
    createSiteContent: async () => ({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      text: async () => ''
    })
  }
  const { report, calls } = makeReport()
  const pkg = siteOnlyPkg({ siteContentUuid: undefined })

  const res = await pushSyncPackages({
    client,
    siteDir: dir,
    pkg,
    report
  })
  assert.equal(res.exitCode, 1)
  const notes = calls.note.join('\n')
  // The bound-site remedy, in its current words — a check on the old wording would pass
  // here whatever the branch said, once that wording no longer existed anywhere.
  assert.ok(!/deleted there/.test(notes), notes)
  assert.ok(!/uniweb forget/.test(notes), notes)
})

// ─── ensureSiteExists ─────────────────────────────────────────────────────────
// The site must exist before any byte is uploaded: bytes are metered against an
// owning entity and freed by deleting it, so an upload made before the site
// exists is charged with nothing to delete. These pin the contract that makes the
// ordering safe to rely on.

const okJson = (body) => ({ ok: true, status: 200, json: async () => body })

test('ensureSiteExists is a no-op when the site is already bound', async () => {
  const dir = tmpSite()
  bind(dir, 'EXISTING-1')
  let called = false
  const client = {
    origin: ORIGIN,
    createSite: async () => {
      called = true
      return okJson({ site_content_uuid: 'NEW' })
    }
  }
  const res = await ensureSiteExists({ client, siteDir: dir })
  assert.deepEqual(res, { uuid: 'EXISTING-1', created: false, org: null })
  assert.equal(called, false, 'must not mint a second site for a bound clone')
})

test('ensureSiteExists creates, reads the snake_case uuid, and writes it back at once', async () => {
  const dir = tmpSite()
  let sent = null
  const client = {
    origin: ORIGIN,
    workspace: '@acme', // the create names it; the owner rides the client, not the call
    createSite: async (opts) => {
      sent = opts
      return okJson({ site_content_uuid: 'MINTED-9' })
    }
  }
  const notes = []
  const res = await ensureSiteExists({
    client,
    siteDir: dir,
    name: 'Acme',
    foundation: '@a/base@1.2.3',
    note: (m) => notes.push(m)
  })
  assert.deepEqual(res, { uuid: 'MINTED-9', created: true, org: '@acme' })
  assert.deepEqual(sent, {
    name: 'Acme',
    foundation: '@a/base@1.2.3'
  })
  // Written back immediately — the window where a crash strands a site is one write.
  assert.equal(readSiteIdentity(dir, ORIGIN).uuid, 'MINTED-9')
  assert.ok(notes.some((m) => /Created the site/.test(m)))
})

// ─── the site's org record (sync.json → backends.<origin>.site.org) ──────────
// Ownership is decided by the workspace the create that mints the uuid names, and by
// nothing afterwards. The record makes that decision readable from the repo, and it
// is the workspace every later request from the project names.

test('the created site records its org BARE, and reads back with the @', async () => {
  const dir = tmpSite()
  const client = {
    origin: ORIGIN,
    workspace: '@acme',
    createSite: async () => okJson({ site_content_uuid: 'MINTED-ORG' })
  }
  const notes = []
  const res = await ensureSiteExists({
    client,
    siteDir: dir,
    name: 'Acme',
    foundation: '@a/base@1.2.3',
    note: (m) => notes.push(m)
  })

  // BARE at rest, re-dressed with the `@` on the way out. The old reason was YAML —
  // `@` is a reserved indicator, so `$org: @acme` would not parse — and that hazard
  // is gone with JSON. The convention stays because the WIRE and the CLI both use
  // the bare handle, and one representation at rest beats two.
  const stored = JSON.parse(readFileSync(join(dir, 'sync.json'), 'utf8'))
  assert.equal(stored.backends[ORIGIN].site.org, 'acme')
  assert.equal(readSiteWorkspace(dir, ORIGIN), '@acme')
  assert.equal(res.org, '@acme')
  // "Show what was resolved" — the org is named, not silently recorded.
  assert.ok(notes.some((m) => m.includes('@acme')))
})

test('a bare workspace value is accepted and normalized on the way in', async () => {
  const dir = tmpSite()
  await ensureSiteExists({
    client: {
      origin: ORIGIN,
      workspace: 'acme', // no leading @
      createSite: async () => okJson({ site_content_uuid: 'M' })
    },
    siteDir: dir,
    name: 'Acme',
    foundation: '@a/base@1.0.0'
  })
  assert.equal(readSiteIdentity(dir, ORIGIN).org, 'acme')
  assert.equal(readSiteWorkspace(dir, ORIGIN), '@acme')
})

test('a create naming no workspace records NO org when the echo carries none', async () => {
  const dir = tmpSite()
  const res = await ensureSiteExists({
    client: { createSite: async () => okJson({ site_content_uuid: 'M2' }) },
    siteDir: dir,
    name: 'Acme',
    foundation: '@a/base@1.0.0'
  })
  // The create response carries no org, so there is nothing true to record.
  // Inventing one would be worse than the gap it fills.
  assert.equal(readSiteIdentity(dir, ORIGIN).org, null)
  assert.equal(readSiteWorkspace(dir), null)
  assert.equal(res.org, null)
})

// ─── resolveSiteOrgForCreate — the one-shot ownership decision ────────────────
// The create that mints the uuid takes its owner from the workspace it names, and there
// is no CLI path to change ownership afterwards. These pin that the CLI never makes that
// choice silently, and — just as important — that it never ASKS when there is no
// choice left to make.

const NEVER_CALLED = {
  origin: ORIGIN,
  token: async () => {
    throw new Error('must not authenticate')
  }
}

test('an explicit --org rides verbatim, asks nothing, and is EXPLICIT', async () => {
  const dir = tmpSite()
  const r = await resolveSiteOrgForCreate({
    client: NEVER_CALLED,
    siteDir: dir,
    args: ['--non-interactive'],
    flag: '@acme'
  })
  assert.deepEqual(r, { workspace: '@acme', source: 'flag' })
  assert.ok(EXPLICIT_OWNER.has(r.source), 'a mismatch for it stops the command')
})

test('--personal names NO workspace, and is explicit too', async () => {
  const dir = tmpSite()
  const r = await resolveSiteOrgForCreate({
    client: NEVER_CALLED,
    siteDir: dir,
    args: ['--non-interactive'],
    personal: true
  })
  // Deliberately null, NOT '@<handle>': the personal ORG is an org like any other,
  // and whether the backend resolves it to the same owning unit as the session's
  // personal workspace is unverified here.
  assert.deepEqual(r, { workspace: null, source: 'personal' })
  assert.ok(EXPLICIT_OWNER.has(r.source))
  assert.equal(r.refused, undefined)
})

test('AN ALREADY-CREATED SITE IS NEVER ASKED — this is the compat property', async () => {
  const dir = tmpSite()
  // Every site that predates this feature is exactly this shape: $uuid, no $org.
  bind(dir, 'EXISTING-1')
  const r = await resolveSiteOrgForCreate({
    client: NEVER_CALLED,
    siteDir: dir,
    args: ['--non-interactive'] // would REFUSE if it thought a create were coming
  })
  assert.deepEqual(r, { workspace: null, source: 'existing' }, 'settled ownership must not be re-litigated')
  assert.ok(!EXPLICIT_OWNER.has(r.source), 'the backend names its workspace; the client adopts it')
})

test('a recorded org is replayed without asking — and is NOT explicit', async () => {
  const dir = tmpSite()
  bind(dir, null, 'acme')
  const r = await resolveSiteOrgForCreate({
    client: NEVER_CALLED,
    siteDir: dir,
    args: ['--non-interactive']
  })
  assert.deepEqual(r, { workspace: '@acme', source: 'recorded' })
  // A record can go stale (a parent workspace, a moved site); the backend's answer wins.
  assert.ok(!EXPLICIT_OWNER.has(r.source))
})

test('non-interactive + a REAL create + no owner named ⇒ refuse, naming both exits', async () => {
  const dir = tmpSite()
  writeFileSync(join(dir, 'site.yml'), 'name: Acme\n') // no $uuid → a create is coming
  const r = await resolveSiteOrgForCreate({
    client: NEVER_CALLED,
    siteDir: dir,
    args: ['--non-interactive']
  })
  assert.equal(r.refused, true)
  assert.equal(r.workspace, null)
  // The refusal has to be actionable, and BOTH exits must appear — naming only
  // --org would read as "you must have an org", which is not true.
  assert.match(r.reason, /--org @org/)
  assert.match(r.reason, /--personal/)
})

test('an offline preview never authenticates and never prompts', async () => {
  const dir = tmpSite()
  writeFileSync(join(dir, 'site.yml'), 'name: Acme\n')
  // `-o` / --dry-run create nothing, so there is no decision to force — and the
  // client here throws if anything reaches for a token.
  const r = await resolveSiteOrgForCreate({
    client: NEVER_CALLED,
    siteDir: dir,
    args: [],
    offline: true
  })
  assert.deepEqual(r, { workspace: null, source: 'offline' })
})

// ─── the create echo — recording what the site IS, not what we asked for ──────

test('the backend echo wins over what we asked for, and null means personal', async () => {
  const dir = tmpSite()
  await ensureSiteExists({
    client: {
      workspace: '@acme', // we asked for an org…
      createSite: async () => okJson({ site_content_uuid: 'M', org: null }),
      discover: async () => ({})
    },
    siteDir: dir,
    name: 'Acme',
    foundation: '@a/base@1.0.0'
  })
  // …the backend says the site is personal. `org: null` is an ANSWER, not an
  // absent key, so it must not fall back to the request.
  assert.equal(readSiteIdentity(dir, ORIGIN).org, null)
  assert.equal(readSiteWorkspace(dir), null)
})

test('an older backend omitting `org` falls back to what we asked for', async () => {
  const dir = tmpSite()
  await ensureSiteExists({
    client: {
      origin: ORIGIN,
      workspace: '@acme',
      createSite: async () => okJson({ site_content_uuid: 'M' }), // no `org` key
      discover: async () => ({})
    },
    siteDir: dir,
    name: 'Acme',
    foundation: '@a/base@1.0.0'
  })
  assert.equal(readSiteWorkspace(dir, ORIGIN), '@acme')
})

test('the billing line speaks ONLY the reassuring fact, and never predicts a charge', async () => {
  // SUPERSEDES 'the billing line needs BOTH facts'. That test pinned a JOIN of
  // `hosts_free` (scope) with `siteSubscriptionRequired` (deployment). The second fact
  // has left the wire: every deployment charges, so it read true everywhere and the join
  // was testing a constant.
  //
  // ⛔ The response was NOT to fall back to the scope alone — that is precisely what the
  // join existed to prevent, and the old test's second case names why: it would fire on
  // every local publish against a box that does not enforce. Whether a publish is charged
  // is derived per-site at publish time on a side the CLI cannot see, so the prediction
  // was dropped entirely. The backend's typed 402 is the exact, per-site, timely answer.
  const run = async (org, hostsFree) => {
    const dir = tmpSite()
    const notes = []
    let discovered = false
    await ensureSiteExists({
      client: {
        createSite: async () =>
          okJson({ site_content_uuid: 'M', org, hosts_free: hostsFree }),
        discover: async () => {
          discovered = true
          return {}
        }
      },
      siteDir: dir,
      name: 'A',
      foundation: '@a/b@1.0.0',
      note: (m) => notes.push(m)
    })
    return { out: notes.join('\n'), discovered }
  }

  // Exempt owner: the one thing the create actually told us, said plainly.
  const exempt = await run('proximify', true)
  assert.match(exempt.out, /hosted free/)

  // Not exempt: SILENT. This is the assertion that carries the ruling — the CLI does
  // not tell you a publish will cost money, because it cannot know that it will.
  const paying = await run(null, false)
  assert.doesNotMatch(paying.out, /require a hosting|subscription/)

  // An older backend echoes no scope at all — missing is not an answer.
  const unknown = await run(undefined, undefined)
  assert.doesNotMatch(unknown.out, /subscription|hosted free/)

  // ⭐ And none of it consults discovery. This was the LAST /dev/config reader in the
  // CLI; with it gone the endpoint has no reader at all, which is what let the backend
  // decide whether it belongs on the CLI's route.
  for (const r of [exempt, paying, unknown]) {
    assert.equal(r.discovered, false, 'the billing line must not call discover()')
  }
})

test('readSiteWorkspace returns null for every site that predates the record', () => {
  const dir = tmpSite()
  // No record ⇒ the project names no workspace, and the client adopts the one the
  // backend works on the site from (its `409 wrong_workspace`).
  bind(dir, 'OLD-1')
  assert.equal(readSiteWorkspace(dir), null)

  bind(dir, null, '   ')
  assert.equal(readSiteWorkspace(dir), null, 'a blank handle is not an org')
})

test('ensureSiteExists distinguishes a backend without the route from a refusal', async () => {
  const dir = tmpSite()
  const missing = await ensureSiteExists({
    client: {
      createSite: async () => ({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        text: async () => ''
      })
    },
    siteDir: dir
  })
  assert.equal(missing.uuid, null)
  assert.match(missing.reason, /no \/dev\/site route/)

  const refused = await ensureSiteExists({
    client: {
      createSite: async () => ({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        text: async () => 'not a member'
      })
    },
    siteDir: dir
  })
  assert.equal(refused.uuid, null)
  assert.match(refused.reason, /HTTP 403/)
  // A failed create must not leave a half-bound site.yml behind.
  assert.equal(readSiteIdentity(dir, ORIGIN).uuid, null)
})

test('ensureSiteExists reports a create that returns no uuid rather than binding null', async () => {
  const dir = tmpSite()
  const res = await ensureSiteExists({
    client: { createSite: async () => okJson({ ok: true }) },
    siteDir: dir
  })
  assert.equal(res.uuid, null)
  assert.match(res.reason, /no site uuid/)
})

test('ensureSiteExists falls back to site.yml for name and foundation', async () => {
  // push has no reason to hold site.yml; one read serves both the binding check
  // and the create's defaults. An explicit argument still wins — publish passes
  // the PINNED foundation ref, which site.yml may not carry.
  const dir = tmpSite() // name: Acme, foundation: '@a/base'
  let sent = null
  const client = {
    origin: ORIGIN,
    createSite: async (o) => {
      sent = o
      return okJson({ site_content_uuid: 'M1' })
    }
  }
  await ensureSiteExists({ client, siteDir: dir })
  assert.equal(sent.name, 'Acme')
  assert.equal(sent.foundation, '@a/base')

  const dir2 = tmpSite()
  await ensureSiteExists({
    client,
    siteDir: dir2,
    foundation: '@a/base@2.0.0'
  })
  assert.equal(sent.foundation, '@a/base@2.0.0', 'explicit ref wins')
})

test('ensureSiteExists names the missing site.yml key instead of letting the create 400', async () => {
  // `name` and `foundation` are both required by POST /dev/site. Catching it here
  // is the difference between "fix this line of site.yml" and a status code.
  const dir = mkdtempSync(join(tmpdir(), 'site-sync-bare-'))
  writeFileSync(join(dir, 'site.yml'), 'foundation: "@a/base@1.0.0"\n')
  let called = false
  const client = {
    origin: ORIGIN,
    createSite: async () => {
      called = true
      return okJson({ site_content_uuid: 'X' })
    }
  }
  const res = await ensureSiteExists({ client, siteDir: dir })
  assert.equal(res.uuid, null)
  assert.match(res.reason, /missing name/)
  assert.equal(called, false, 'must not make a call it knows will be refused')

  const dir2 = mkdtempSync(join(tmpdir(), 'site-sync-bare2-'))
  writeFileSync(join(dir2, 'site.yml'), 'name: Acme\n')
  const res2 = await ensureSiteExists({ client, siteDir: dir2 })
  assert.match(res2.reason, /missing foundation/)
})

// ─── clearRemoteSyncStateIfUnbound ───────────────────────────────────────────
// `.uniweb/backend-cache.json` keys every map by UNIT PATH (`site.yml`,
// `pages/about/about.md`) — the same string for every site — so it does not
// self-invalidate when the clone stops being bound to the site it describes.
// That is a state we actively tell people to enter: the 404 guidance says to
// clear `$uuid` to re-publish as a new site.

const cachePath = (dir) => join(dir, '.uniweb', 'backend-cache.json')
const writeCache = (dir, obj) => {
  mkdirSync(join(dir, '.uniweb'), { recursive: true })
  // ⭐ The identity maps go to `sync.json`, the rest to the cache — the split under
  // test. `clearRemoteSyncState` must invalidate BOTH, because they describe one
  // dead site between them.
  const { itemUuids, queryUuids, folderItemUuids, ...cache } = obj
  writeFileSync(
    cachePath(dir),
    JSON.stringify({ version: 1, backends: { [ORIGIN]: cache } })
  )
  if (itemUuids || queryUuids || folderItemUuids) {
    // ⛔ MERGE — `bind()` may already have written the `site` section here, and
    // replacing the file would silently unbind the very site under test.
    const file = join(dir, 'sync.json')
    let doc = { version: 1, backends: {} }
    if (existsSync(file)) {
      try { doc = JSON.parse(readFileSync(file, 'utf8')) } catch { /* fresh */ }
    }
    doc.backends[ORIGIN] = {
      ...(doc.backends[ORIGIN] || {}),
      ...(itemUuids ? { items: itemUuids } : {}),
      ...(queryUuids ? { queries: queryUuids } : {}),
      ...(folderItemUuids ? { folders: folderItemUuids } : {})
    }
    writeFileSync(file, JSON.stringify(doc, null, 2) + '\n')
  }
}
// ⚠️ The uuid maps are NOT here any more — they are identity and live in
// `sync.json` (items / queries / folders). A test that seeds `itemUuids` into the
// cache is seeding a key nothing reads.
const readCache = (dir) =>
  JSON.parse(readFileSync(cachePath(dir), 'utf8')).backends[ORIGIN]

test('an UNBOUND clone drops every map that describes a backend site', () => {
  const dir = tmpSite() // no $uuid
  writeCache(dir, {
    itemUuids: { 'site.yml': 'OLD-1' },
    hashes: { 'x y': 'h' },
    baseVersions: { OLD: 'v' },
    unitBases: { 'a.md': 'h' },
    applied: {
      assetRewrite: { '/images/a.svg': 'https://cdn.example/OLD/base.svg' }
    }
  })
  const dropped = clearRemoteSyncStateIfUnbound(dir, ORIGIN)
  assert.deepEqual(dropped.sort(), [
    'applied',
    'baseVersions',
    'hashes',
    'itemUuids',
    'unitBases'
  ])
  const c = readCache(dir)
  // applied: it holds the OLD site's asset serve URLs. Surviving the drop, it would
  // rewrite the NEW site's media to bytes owned by the site this folder used to be.
  assert.deepEqual(c.applied, {})
  // itemUuids: the backend refuses outright — "item uuid … is already stored on
  // entity N; cross-entity move is not supported". It lives in `sync.json` now and
  // is cleared by the same call, which is the point.
  assert.deepEqual(readItemUuids(dir, ORIGIN), {})
  // hashes is the SILENT one: send-only-changed would skip every entity that had
  // not changed since the old site's last push, so the new site would come up
  // missing exactly the content that did not change — and publish successfully.
  assert.deepEqual(c.hashes, {})
  assert.deepEqual(c.baseVersions, {})
  assert.deepEqual(c.unitBases, {})
})

test('a clone bound to the SAME site keeps its cache and gets stamped', () => {
  const dir = tmpSite()
  bind(dir, 'SITE-A')
  writeCache(dir, { siteUuid: 'SITE-A', itemUuids: { 'site.yml': 'I1' } })
  assert.deepEqual(clearRemoteSyncStateIfUnbound(dir, ORIGIN), [])
  assert.deepEqual(readItemUuids(dir, ORIGIN), { 'site.yml': 'I1' })
})

test('a clone bound to a DIFFERENT site than the cache describes is cleared', () => {
  // Reachable in one step before the stamp existed: the create mints a uuid and
  // writes it BEFORE the push, so a push that then fails leaves exactly this.
  const dir = tmpSite()
  bind(dir, 'SITE-NEW')
  writeCache(dir, { siteUuid: 'SITE-OLD', itemUuids: { 'site.yml': 'I1' } })
  assert.deepEqual(clearRemoteSyncStateIfUnbound(dir, ORIGIN), ['itemUuids'])
  const c = readCache(dir)
  assert.deepEqual(readItemUuids(dir, ORIGIN), {})
  assert.equal(c.siteUuid, 'SITE-NEW')
})

test('a legacy cache with no siteUuid on a bound clone is LEFT ALONE', () => {
  // Deliberate: that is every pre-existing clone, and assuming it matches is
  // right far more often than wiping it would be. The cost is that a clone
  // already broken before the stamp existed stays broken until `.uniweb/` is
  // removed — an accepted trade, recorded so it is not read as an oversight.
  const dir = tmpSite()
  bind(dir, 'SITE-A')
  writeCache(dir, { itemUuids: { 'site.yml': 'I1' } })
  assert.deepEqual(clearRemoteSyncStateIfUnbound(dir, ORIGIN), [])
  assert.deepEqual(readItemUuids(dir, ORIGIN), { 'site.yml': 'I1' })
  // ...but it IS stamped now, so a later divergence becomes detectable.
  assert.equal(readCache(dir).siteUuid, 'SITE-A')
})

test('an empty cache is a no-op, and still records identity', () => {
  const dir = tmpSite()
  bind(dir, 'SITE-A')
  writeCache(dir, {})
  assert.deepEqual(clearRemoteSyncStateIfUnbound(dir, ORIGIN), [])
  assert.equal(readCache(dir).siteUuid, 'SITE-A')
})

test('an item_uuid_conflict clears the stale cache and says re-run', async () => {
  // The exit for a clone broken BEFORE the pre-flight guard existed: an unstamped
  // legacy cache on a bound site, which the guard deliberately leaves alone rather
  // than wiping every existing clone. Branches on `reason` — the backend types this
  // as 409 alongside `stale_base`; `detail` is prose and must not be matched.
  const dir = tmpSite()
  bind(dir, 'SITE-NEW')
  writeCache(dir, { itemUuids: { 'site.yml': 'OLD-ITEM' }, hashes: { a: 'h' } })

  const client = {
    origin: 'http://x',
    updateSiteContent: async () => ({
      ok: false,
      status: 409,
      statusText: 'Conflict',
      text: async () =>
        JSON.stringify({
          title: 'Item UUID Conflict',
          reason: 'item_uuid_conflict',
          item_uuid: 'OLD-ITEM',
          document_entity_id: 161,
          stored_entity_id: 156,
          detail: 'prose that may be reworded at any time'
        })
    })
  }
  const { report, calls } = makeReport()
  const res = await pushSyncPackages({
    client,
    siteDir: dir,
    pkg: siteOnlyPkg({ siteContentUuid: 'SITE-NEW' }),
    report
  })

  assert.equal(res.exitCode, 1)
  const said = [...calls.error, ...calls.note].join('\n')
  assert.match(said, /describing a different site/)
  assert.match(said, /entity 156/) // the entity that actually holds it
  assert.match(said, /entity 161/) // the one being pushed to
  assert.match(said, /re-run the same command/)
  // The prose must not be echoed as if it were the contract.
  assert.ok(!/may be reworded/.test(said))

  // And the recovery actually happened, so the re-run it promises will work.
  const c = readCache(dir)
  assert.deepEqual(readItemUuids(dir, ORIGIN), {})
  assert.deepEqual(c.hashes, {})
  assert.equal(c.siteUuid, 'SITE-NEW')
})

// ─── identity banking, and the silence that used to follow its failure ───────
//
// A push banks per-item `$uuid` from `finalized[0].document`, so the NEXT push or
// publish can address stored rows instead of re-minting them. That step is
// best-effort — the document may not be there — and its failure was SILENT.
//
// ⛔ The cost lands two commands away and names something else: the next publish
// emits with no per-item `$uuid`, the backend refuses (correctly — silently
// re-identifying every stored row is far worse), and the refusal reads as a stale
// token or a producer bug, with nothing pointing back at the push that did not bank.
//
// Reported by the backend lane, 2026-08-27, channel backend↔framework↔hosting:
// "push stores the items and we hand their $uuids back in finalized; publish
// re-pushes the same package still without them, and the guard refuses."

test('a push that banks identity leaves it readable for the next one', async () => {
  const dir = tmpSite()
  // The backend's post-write document: `$uuid` filled in at every nesting level.
  // The real shape `collectUnitUuids` walks: pages keyed by `slug`, their sections
  // at `page_sections`. Getting this wrong is how the first version of this test
  // failed — which is the test doing its job.
  const document = {
    $uuid: 'S1',
    pages: [
      {
        $uuid: 'P1',
        slug: 'home',
        page_sections: [{ $uuid: 'X1', $id: 'hero' }]
      }
    ]
  }
  const client = {
    origin: 'http://x',
    createSiteContent: async () =>
      ok(finalized([{ index: 0, uuid: 'S1', changed: true, document }]))
  }
  const { report, calls } = makeReport()
  const res = await pushSyncPackages({
    client,
    siteDir: dir,
    report,
    pkg: siteOnlyPkg({ hashes: { '@uniweb/site-content site': 'h1' } })
  })
  assert.equal(res.exitCode, 0)
  // Identity is banked, so the next emit can address rows rather than re-mint them.
  assert.ok(Object.keys(readItemUuids(dir, ORIGIN)).length > 0, 'no per-item identity banked')
  // ...and nothing is reported, because nothing went wrong.
  assert.ok(
    !calls.note.join('\n').includes('identity not banked'),
    'warned about banking on a push that banked'
  )
})

test('⛔ a push that banks NO identity SAYS SO — it used to be silent', async () => {
  const dir = tmpSite()
  const client = {
    origin: 'http://x',
    // No `document` — the shape the banking step needs is simply absent.
    createSiteContent: async () => ok(finalized([{ index: 0, uuid: 'S1', changed: true }]))
  }
  const { report, calls } = makeReport()
  const res = await pushSyncPackages({
    client,
    siteDir: dir,
    report,
    pkg: siteOnlyPkg({ hashes: { '@uniweb/site-content site': 'h1' } })
  })
  // ⭐ The push still SUCCEEDS — the content landed. That is exactly why the
  // silence was expensive: nothing here is an error, and the next command pays.
  assert.equal(res.exitCode, 0)
  assert.deepEqual(readItemUuids(dir, ORIGIN), {}, 'banked identity from a document-less response')
  assert.ok(
    calls.note.join('\n').includes('identity not banked'),
    'a push that banked no identity said nothing about it'
  )
})

/**
 * ⛔ probeUnpushed must resolve `@/x` the way the push did — into the FOUNDATION's scope.
 *
 * The scope is what resolves a foundation-relative `@/member` into the `@acme/member`
 * a push shipped and keyed its hashes by. Missing it does not fail: the emit WARNS
 * and ships the model unresolved (deliberate — an unscoped export still works), so
 * every record of a `@/`-scoped collection is emitted under a key that can never
 * match its banked one, and `uniweb status` reports it changed forever.
 *
 * ⭐ Since 2026-09-22 the scope is the one in the foundation's NAME (`@acme/base` in its
 * main.js) — the scope `register` stored its Models under — and never the org that owns
 * the SITE, which this read from sync.json until then. The emit reads it itself, the
 * same read a push makes, so the two agree by construction.
 *
 * ⚠️ It hid because `@std/…` collections are unaffected — their scope is already
 * absolute. A site mixing both shows some records settling and others never
 * settling, which reads like a content problem rather than a resolution one.
 *
 * Measured on the `matinee` manor, 2026-08-29: immediately after a successful push,
 * `status` reported 4 changed entities of 8. Passing the org took it to 1 (the
 * remaining one is the folder — a separate defect: its hash is banked before the
 * push's uuid back-fill and is unreproducible afterwards).
 *
 * The assertion is the WARNING rather than a hash, because a hash test needs a real
 * banked cache from a real round trip. The warning is emitted on exactly the path
 * the defect travels, and the control below is what makes its absence mean something.
 */
test('probeUnpushed resolves a foundation-relative schema into the foundation’s scope', async () => {
  // A site beside its foundation `base`, whose main.js names it `foundationName`. The
  // site is owned by ANOTHER org — `client` — which must not be the scope. The
  // foundation declares no `member`, so the emit's lookup fails and its error names the
  // qualified model it asked for.
  const make = (foundationName) => {
    const dir = mkdtempSync(join(tmpdir(), 'probe-scope-'))
    const site = join(dir, 'site')
    const fnd = join(dir, 'base')
    mkdirSync(join(fnd, 'dist', 'meta'), { recursive: true })
    writeFileSync(join(fnd, 'package.json'), JSON.stringify({ name: 'base', main: './_entry.generated.js' }))
    writeFileSync(join(fnd, 'main.js'), `export default { name: '${foundationName}' }\n`)
    writeFileSync(join(fnd, 'dist', 'meta', 'schema.json'), JSON.stringify({ dataSchemas: {} }))
    mkdirSync(site)
    writeFileSync(join(site, 'site.yml'), 'name: Acme\nfoundation: base\n')
    writeFileSync(
      join(site, 'sync.json'),
      JSON.stringify({ version: 1, backends: { [ORIGIN]: { site: { org: 'client' } } } })
    )
    writeFileSync(join(site, 'queries.yml'), 'members:\n  schema: "@/member"\n')
    return { dir, site }
  }

  // The model name the emit ends up asking for is the observable: it is exactly what
  // keys the banked hashes, so it is the thing the defect got wrong.
  const askedFor = async (dir) => {
    try {
      await probeUnpushed(dir, { backend: ORIGIN })
      return null // resolved outright — no name to read
    } catch (err) {
      return /Model "([^"]+)"/.exec(err.message)?.[1] ?? null
    }
  }

  const scoped = make('@acme/base')
  const bare = make('base')
  try {
    // CONTROL. A foundation whose name carries no scope yet has nothing to resolve
    // WITH, so the emit must still ask for the bare `@/member` — whoever owns the site.
    // Without this the assertion below would pass just as well if the message shape
    // changed or the query stopped being read.
    assert.equal(
      await askedFor(bare.site),
      '@/member',
      'control: a foundation with no scope in its name leaves `@/member` unresolved'
    )

    assert.equal(
      await askedFor(scoped.site),
      '@acme/member',
      'the foundation’s scope must be applied offline, so `status` asks for the same ' +
        'qualified model the push banked its hashes under — not the site owner’s `@client/member`'
    )
  } finally {
    rmSync(scoped.dir, { recursive: true, force: true })
    rmSync(bare.dir, { recursive: true, force: true })
  }
})

/**
 * ⛔ A WRITER THAT REWRITES THE WORKING TREE MUST RE-BANK THE HASHES.
 *
 * `uniweb pull` projects the backend's document into source files, and that
 * projection is CANONICAL rather than byte-identical to what was there: section
 * ordering moves out of filename prefixes (`1-hero.md` → `hero.md` plus an explicit
 * `sections:` list) and each section gains an `id`. Lossless, and a different
 * document.
 *
 * ⚠️ The pull already knew this for the OTHER map — it clears the `local` unit base
 * because "what we would emit from them is not byte-identical to it". That reasoning
 * was never carried to the send-only-changed hashes, which were left STALE rather
 * than unknown: `uniweb status` reported unpushed content immediately after a pull,
 * permanently. Measured on matinee 2026-08-29 — push → pull reported 1 changed of 8
 * with nothing edited in between, and re-banking took it to 0.
 *
 * ⭐ The property under test is a FIXED POINT: bank over the current tree, and a
 * probe of that same tree must report nothing to send. It is the same invariant the
 * whole sync cache rests on — a hash banked by the writer must be recomputable by
 * the reader — stated once, offline, with no backend.
 */
test('rebankSyncHashes makes the tree a fixed point for probeUnpushed', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'rebank-'))
  try {
    writeFileSync(join(dir, 'site.yml'), 'name: Acme\nfoundation: base\n')
    mkdirSync(join(dir, 'pages', 'home'), { recursive: true })
    writeFileSync(join(dir, 'pages', 'home', 'page.yml'), 'title: Home\n')
    writeFileSync(join(dir, 'pages', 'home', 'hero.md'), '---\ntype: Hero\n---\n\n# Hi\n')

    // CONTROL. With nothing banked, the probe must report something to send —
    // otherwise the assertion below passes on a site that emits nothing at all,
    // and would keep passing if the emit silently stopped working.
    const cold = await probeUnpushed(dir, { backend: ORIGIN })
    assert.ok(
      cold.changed > 0,
      `control: an unbanked site must have something to send — got ${JSON.stringify(cold)}`
    )

    const banked = await rebankSyncHashes(dir, ORIGIN)
    assert.ok(banked > 0, `re-bank wrote no hashes (${banked})`)

    const warm = await probeUnpushed(dir, { backend: ORIGIN })
    assert.equal(
      warm.changed,
      0,
      'after re-banking over the current tree, a probe of that same tree must report ' +
        `nothing to send — got ${JSON.stringify(warm)}`
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// ─── the designation outcome (E6) ────────────────────────────────────────────
// A push carries the author's `template:` intent in `info`; what the backend DID
// with it comes back as `template` — `designated` · `undesignated`, absent when it
// did not move (backend, 2026-09-23). ⛔ Absent is "unchanged", never "failed": a
// designation the backend will not make refuses the whole push, with its own message
// (kb/framework/reference/template-designation-on-push.md §6).

test('templateOutcome reads the state the backend reported, wherever it rides', () => {
  assert.equal(templateOutcome({ template: 'designated' }), 'designated')
  assert.equal(templateOutcome({ report: { template: 'undesignated' } }), 'undesignated')
  // CONTROL — nothing to say, and nothing that could be mistaken for a state
  assert.equal(templateOutcome({ report: { finalized: [] } }), null)
  assert.equal(templateOutcome({ template: '' }), null)
  assert.equal(templateOutcome({ template: true }), null)
  assert.equal(templateOutcome(null), null)
})

test('an UPDATE push says what the backend did with the designation — and says nothing when it did not move', async () => {
  const push = async (body) => {
    const dir = tmpSite()
    bind(dir, 'S1')
    const client = {
      origin: ORIGIN,
      updateSiteContent: async () => ok(body)
    }
    const { report, calls } = makeReport()
    const res = await pushSyncPackages({
      client,
      siteDir: dir,
      report,
      pkg: siteOnlyPkg({ siteContentUuid: 'S1', hashes: {} })
    })
    rmSync(dir, { recursive: true, force: true })
    return { res, said: calls.note.join('\n') }
  }
  const one = finalized([{ index: 0, uuid: 'S1', changed: true }])

  const designated = await push({ ...one, template: 'designated' })
  assert.equal(designated.res.exitCode, 0)
  assert.match(designated.said, /designated this site as a template/)

  const undesignated = await push({ ...one, template: 'undesignated' })
  assert.match(undesignated.said, /no longer a template/)

  // CONTROL — the same push with no state reported prints neither line
  const quiet = await push(one)
  assert.equal(quiet.res.exitCode, 0)
  assert.doesNotMatch(quiet.said, /template/i)
})

test('a CREATE push reports it too — the site is born designated or not', async () => {
  const dir = tmpSite()
  const client = {
    origin: ORIGIN,
    createSiteContent: async () =>
      ok({
        ...finalized([{ index: 0, uuid: 'S1', changed: true }]),
        template: 'designated'
      })
  }
  const { report, calls } = makeReport()
  const res = await pushSyncPackages({
    client,
    siteDir: dir,
    report,
    pkg: siteOnlyPkg({ hashes: {} })
  })
  rmSync(dir, { recursive: true, force: true })
  assert.equal(res.exitCode, 0)
  assert.match(calls.note.join('\n'), /designated this site as a template/)
})

test('⛔ a state we do not know about is printed, not swallowed', async () => {
  const dir = tmpSite()
  bind(dir, 'S1')
  const client = {
    origin: ORIGIN,
    updateSiteContent: async () =>
      ok({
        ...finalized([{ index: 0, uuid: 'S1', changed: true }]),
        template: 'queued-for-review'
      })
  }
  const { report, calls } = makeReport()
  await pushSyncPackages({
    client,
    siteDir: dir,
    report,
    pkg: siteOnlyPkg({ siteContentUuid: 'S1', hashes: {} })
  })
  rmSync(dir, { recursive: true, force: true })
  assert.match(calls.note.join('\n'), /template state as "queued-for-review"/)
})
