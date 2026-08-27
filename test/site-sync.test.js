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
  pushSyncPackages,
  ensureSiteExists,
  clearRemoteSyncStateIfUnbound,
  readBaseVersions,
  readSyncCache,
  readAppliedInjections,
  readSiteOrg,
  readItemBaseVersions,
  mergeItemBaseVersions,
  resolveSiteOrgForCreate,
  writeUnitBases,
  readItemUuids
} from '../src/backend/site-sync.js'
import { createZip, computeUnitHashes } from '@uniweb/build/uwx'

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
  collections: null,
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
    asOrg: null,
    report
  })
  assert.equal(res.exitCode, 0)
  assert.deepEqual(readBaseVersions(dir), { S1: 'V1' })

  // The hash cache and the version map share one file and must not clobber each other.
  assert.deepEqual(readSyncCache(dir), { '@uniweb/site-content site': 'h1' })
})

// ─── the banked hash and the document it describes ───────────────────────────
// A push hashes the DELIVERED document — local `/images/x.svg` rewritten to the
// serve URL it just uploaded to, `info.foundation` replaced by the pinned ref — and
// banks those hashes. A hash says nothing about WHICH document it is of, so a cache
// that records the hashes and not the delivery cannot be re-checked offline: the
// reader rebuilds the AUTHORED document and matches nothing, forever.
//
// That is the defect backend reported in `backend-framework-787e` (2026-08-19):
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
    asOrg: null,
    report,
    pkg: siteOnlyPkg({ hashes: { '@uniweb/site-content site': 'h1' }, applied })
  })
  assert.equal(res.exitCode, 0)
  const banked = readAppliedInjections(dir)
  assert.deepEqual(banked, {
    assetRewrite: applied.assetRewrite,
    injectInfo: applied.injectInfo
  })
  assert.equal(banked.assetIds, undefined)
  // Still one file, still not clobbering the map beside it.
  assert.deepEqual(readSyncCache(dir), { '@uniweb/site-content site': 'h1' })
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
    asOrg: null,
    report,
    pkg: siteOnlyPkg({
      hashes: { k: 'h1' },
      applied: { assetRewrite: { '/images/a.svg': 'https://cdn.example/a' } }
    })
  })
  assert.notDeepEqual(readAppliedInjections(dir), {}) // control: it was banked

  await pushSyncPackages({
    client,
    siteDir: dir,
    asOrg: null,
    report,
    pkg: siteOnlyPkg({ hashes: { k: 'h2' }, applied: {} })
  })
  assert.deepEqual(readAppliedInjections(dir), {})
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
    seen.push(readItemBaseVersions(dir).REC ?? null)
    return pushSyncPackages({
      client,
      siteDir: dir,
      pkg: siteOnlyPkg({ siteContentUuid: 'S1', hashes: {} }),
      asOrg: null,
      report
    })
  }

  assert.equal((await push()).exitCode, 0)
  assert.equal((await push()).exitCode, 0)

  // Push 1 had nothing cached; push 2 carried push 1's token — NOT a stale one, and
  // with no pull in between. Reading on pull alone is what made this `[null, null]`,
  // and the backend would then refuse push 2 naming records nobody touched.
  assert.deepEqual(seen, [null, 't1'])
  assert.deepEqual(readItemBaseVersions(dir), { REC: 't2' })
  // The entity grain keeps working alongside it, in the same file.
  assert.deepEqual(readBaseVersions(dir), { S1: 'V2' })
})

test('an older backend omitting item_versions leaves the cached tokens alone', async () => {
  const dir = tmpSite()
  mergeItemBaseVersions(dir, { REC: 'from-a-pull' })
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
    asOrg: null,
    report
  })
  assert.equal(res.exitCode, 0)
  // Absent ≠ empty. Clearing here would silently drop to the entity grain AND throw
  // away a token a pull had legitimately banked.
  assert.deepEqual(readItemBaseVersions(dir), { REC: 'from-a-pull' })
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
      collections: { buffer: Buffer.from('PK'), index: [] }
    },
    asOrg: null,
    report
  })
  assert.equal(res.exitCode, 1)
  assert.deepEqual(readItemBaseVersions(dir), { REC: 't1' })
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
  writeUnitBases(dir, {
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
    asOrg: null,
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
    asOrg: null,
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
    asOrg: null,
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
    asOrg: null,
    report
  })

  assert.equal(created, 1)
  assert.equal(res.exitCode, 0)
  assert.equal(res.boundSiteUuid, 'NEW-UUID')
  assert.match(
    readFileSync(join(dir, 'site.yml'), 'utf8'),
    /^\$uuid: NEW-UUID$/m
  )
  assert.ok(res.wrote.includes('recorded site $uuid in site.yml'))
  // the send-only-changed cache is persisted on success
  const cache = JSON.parse(
    readFileSync(join(dir, '.uniweb/sync-cache.json'), 'utf8')
  )
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
    asOrg: null,
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
    asOrg: null,
    report
  })

  assert.equal(res.exitCode, 1)
  assert.ok(calls.error.some((m) => /rejected: HTTP 500/.test(m)))
  assert.equal(
    existsSync(join(dir, '.uniweb/sync-cache.json')),
    false,
    'a failed push must not persist the cache'
  )
  rmSync(dir, { recursive: true, force: true })
})

test('pushSyncPackages: a 409 explains the facet-genesis fix (delete + redeploy) instead of a bare error', async () => {
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
    asOrg: null,
    report
  })

  assert.equal(res.exitCode, 1)
  assert.ok(calls.error.some((m) => /rejected: HTTP 409/.test(m)))
  // the friendlier guidance — the v1 folder is genesis-owned; delete + redeploy (or clear $uuid)
  assert.ok(
    calls.note.some(
      (m) =>
        /delete the deployed site and redeploy/.test(m) &&
        /clear `\$uuid`/.test(m)
    ),
    'explains the delete+redeploy / clear-$uuid fix'
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
    collections: {
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
    asOrg: null,
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
    asOrg: null,
    report
  })
  assert.equal(res.exitCode, 1)
  const out = [...calls.error, ...calls.note].join('\n')
  assert.match(out, /no record of the site's item identity/)
  assert.match(out, /Nothing was written/)
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
  //   · the site was deleted in the Uniweb app  → clear `$uuid`, re-publish as new
  //   · you are pointed at the wrong backend    → log in elsewhere; NOTHING is lost
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
    asOrg: null,
    report
  })
  assert.equal(res.exitCode, 1)
  const notes = calls.note.join('\n')
  assert.match(notes, /no site with uuid GONE-1/)
  assert.match(notes, /http:\/\/x/) // names WHICH backend answered 404
  assert.match(notes, /wrong backend/)
  assert.match(notes, /deleted in the app/)
  assert.match(notes, /clearing `\$uuid` from site\.yml/)
  // The ordering is the point, not decoration: the destructive remedy must not be the
  // first thing a reader acts on. Assert it structurally so a later reword cannot
  // silently put them back the other way round.
  assert.ok(
    notes.indexOf('wrong backend') < notes.indexOf('deleted in the app'),
    `the recoverable cause must be offered first:\n${notes}`
  )
})

test('a 404 on the CREATE lane does NOT claim a site was deleted', async () => {
  // The create carries no uuid, so a 404 there means the route is missing, not that
  // a site is gone — advising the user to clear a `$uuid` they do not have would be
  // a confident wrong answer.
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
    asOrg: null,
    report
  })
  assert.equal(res.exitCode, 1)
  const notes = calls.note.join('\n')
  assert.ok(!/deleted in the Uniweb app/.test(notes))
  assert.ok(!/clearing `\$uuid`/.test(notes))
})

// ─── ensureSiteExists ─────────────────────────────────────────────────────────
// The site must exist before any byte is uploaded: bytes are metered against an
// owning entity and freed by deleting it, so an upload made before the site
// exists is charged with nothing to delete. These pin the contract that makes the
// ordering safe to rely on.

const okJson = (body) => ({ ok: true, status: 200, json: async () => body })

test('ensureSiteExists is a no-op when the site is already bound', async () => {
  const dir = tmpSite()
  writeFileSync(join(dir, 'site.yml'), 'name: Acme\n$uuid: EXISTING-1\n')
  let called = false
  const client = {
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
    asOrg: '@acme',
    note: (m) => notes.push(m)
  })
  assert.deepEqual(res, { uuid: 'MINTED-9', created: true, org: '@acme' })
  assert.deepEqual(sent, {
    name: 'Acme',
    foundation: '@a/base@1.2.3',
    asOrg: '@acme'
  })
  // Written back immediately — the window where a crash strands a site is one write.
  assert.match(readFileSync(join(dir, 'site.yml'), 'utf8'), /MINTED-9/)
  assert.ok(notes.some((m) => /Created the site/.test(m)))
})

// ─── the site's org record (site.yml::$org) ───────────────────────────────────
// Ownership is decided by the `as_org` on the create that mints `$uuid`, and by
// nothing afterwards. `$org` records that decision so it is readable from the repo
// and replayable, closing the asymmetry with the foundation lane's committed
// `package.json::uniweb.scope`.

test('the created site records its org BARE, and reads back with the @', async () => {
  const dir = tmpSite()
  const client = {
    createSite: async () => okJson({ site_content_uuid: 'MINTED-ORG' })
  }
  const notes = []
  const res = await ensureSiteExists({
    client,
    siteDir: dir,
    name: 'Acme',
    foundation: '@a/base@1.2.3',
    asOrg: '@acme',
    note: (m) => notes.push(m)
  })

  const text = readFileSync(join(dir, 'site.yml'), 'utf8')
  // BARE on disk. `@` is a reserved YAML indicator, so a plain scalar may not
  // start with one — `$org: @acme` would not parse. This assertion is the guard.
  assert.match(text, /^\$org: acme$/m)
  assert.doesNotMatch(text, /\$org: @/, '`@` would make site.yml unparseable')
  assert.doesNotThrow(() => yaml.load(text), 'site.yml must still parse')

  // …and the reader re-dresses it, so callers get the wire/display form.
  assert.equal(readSiteOrg(dir), '@acme')
  assert.equal(res.org, '@acme')
  // "Show what was resolved" — the org is named, not silently recorded.
  assert.ok(notes.some((m) => m.includes('@acme')))
})

test('a bare --as-org value is accepted and normalized on the way in', async () => {
  const dir = tmpSite()
  await ensureSiteExists({
    client: { createSite: async () => okJson({ site_content_uuid: 'M' }) },
    siteDir: dir,
    name: 'Acme',
    foundation: '@a/base@1.0.0',
    asOrg: 'acme' // no leading @
  })
  assert.match(readFileSync(join(dir, 'site.yml'), 'utf8'), /^\$org: acme$/m)
  assert.equal(readSiteOrg(dir), '@acme')
})

test('no --as-org records NO org — the backend chose, and we do not guess one', async () => {
  const dir = tmpSite()
  const res = await ensureSiteExists({
    client: { createSite: async () => okJson({ site_content_uuid: 'M2' }) },
    siteDir: dir,
    name: 'Acme',
    foundation: '@a/base@1.0.0'
  })
  // The create response carries no org, so there is nothing true to record.
  // Inventing one would be worse than the gap it fills.
  assert.doesNotMatch(readFileSync(join(dir, 'site.yml'), 'utf8'), /\$org/)
  assert.equal(readSiteOrg(dir), null)
  assert.equal(res.org, null)
})

// ─── resolveSiteOrgForCreate — the one-shot ownership decision ────────────────
// The create that mints $uuid is the only call that reads as_org, and there is no
// CLI path to change ownership afterwards. These pin that the CLI never makes that
// choice silently, and — just as important — that it never ASKS when there is no
// choice left to make.

const NEVER_CALLED = {
  origin: 'http://b',
  token: async () => {
    throw new Error('must not authenticate')
  }
}

test('an explicit --as-org rides verbatim and asks nothing', async () => {
  const dir = tmpSite()
  const r = await resolveSiteOrgForCreate({
    client: NEVER_CALLED,
    siteDir: dir,
    args: ['--non-interactive'],
    flag: '@acme'
  })
  assert.deepEqual(r, { asOrg: '@acme' })
})

test('--personal sends NO as_org — the pre-prompt wire, byte for byte', async () => {
  const dir = tmpSite()
  const r = await resolveSiteOrgForCreate({
    client: NEVER_CALLED,
    siteDir: dir,
    args: ['--non-interactive'],
    personal: true
  })
  // Deliberately null, NOT '@<handle>': the personal ORG is an org like any other,
  // and whether the backend resolves it to the same owning unit as the session's
  // personal context is unverified here.
  assert.deepEqual(r, { asOrg: null })
  assert.equal(r.refused, undefined)
})

test('AN ALREADY-CREATED SITE IS NEVER ASKED — this is the compat property', async () => {
  const dir = tmpSite()
  // Every site that predates this feature is exactly this shape: $uuid, no $org.
  writeFileSync(join(dir, 'site.yml'), 'name: Acme\n$uuid: EXISTING-1\n')
  const r = await resolveSiteOrgForCreate({
    client: NEVER_CALLED,
    siteDir: dir,
    args: ['--non-interactive'] // would REFUSE if it thought a create were coming
  })
  assert.deepEqual(r, { asOrg: null }, 'settled ownership must not be re-litigated')
})

test('a recorded $org is replayed without asking', async () => {
  const dir = tmpSite()
  writeFileSync(join(dir, 'site.yml'), '$org: acme\nname: Acme\n')
  const r = await resolveSiteOrgForCreate({
    client: NEVER_CALLED,
    siteDir: dir,
    args: ['--non-interactive']
  })
  assert.deepEqual(r, { asOrg: '@acme' })
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
  assert.equal(r.asOrg, null)
  // The refusal has to be actionable, and BOTH exits must appear — naming only
  // --as-org would read as "you must have an org", which is not true.
  assert.match(r.reason, /--as-org @org/)
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
  assert.deepEqual(r, { asOrg: null })
})

// ─── the create echo — recording what the site IS, not what we asked for ──────

test('the backend echo wins over what we asked for, and null means personal', async () => {
  const dir = tmpSite()
  await ensureSiteExists({
    client: {
      createSite: async () => okJson({ site_content_uuid: 'M', org: null }),
      discover: async () => ({})
    },
    siteDir: dir,
    name: 'Acme',
    foundation: '@a/base@1.0.0',
    asOrg: '@acme' // we asked for an org…
  })
  // …the backend says the site is personal. `org: null` is an ANSWER, not an
  // absent key, so it must not fall back to the request.
  assert.doesNotMatch(readFileSync(join(dir, 'site.yml'), 'utf8'), /\$org/)
  assert.equal(readSiteOrg(dir), null)
})

test('an older backend omitting `org` falls back to what we asked for', async () => {
  const dir = tmpSite()
  await ensureSiteExists({
    client: {
      createSite: async () => okJson({ site_content_uuid: 'M' }), // no `org` key
      discover: async () => ({})
    },
    siteDir: dir,
    name: 'Acme',
    foundation: '@a/base@1.0.0',
    asOrg: '@acme'
  })
  assert.equal(readSiteOrg(dir), '@acme')
})

test('the billing line needs BOTH facts — neither alone may speak', async () => {
  const run = async (org, hostsFree, enforces) => {
    const dir = tmpSite()
    const notes = []
    await ensureSiteExists({
      client: {
        createSite: async () =>
          okJson({ site_content_uuid: 'M', org, hosts_free: hostsFree }),
        discover: async () => ({
          delivery: { siteSubscriptionRequired: enforces }
        })
      },
      siteDir: dir,
      name: 'A',
      foundation: '@a/b@1.0.0',
      note: (m) => notes.push(m)
    })
    return notes.join('\n')
  }

  // Personal on an enforcing deployment — the one case that should warn.
  assert.match(await run(null, false, true), /require a hosting subscription/)
  // Same site, non-enforcing deployment: keying on the scope alone would fire
  // here, on every local publish, until the warning was trained away.
  assert.doesNotMatch(await run(null, false, false), /require a hosting/)
  // Exempt owner: keying on the deployment alone would fire here.
  assert.doesNotMatch(await run('proximify', true, true), /require a hosting/)
  assert.match(await run('proximify', true, true), /hosted free/)
  // An older backend supplies neither fact — silence beats an unjustifiable claim.
  assert.doesNotMatch(await run(undefined, undefined, undefined), /subscription|hosted free/)
})

test('readSiteOrg returns null for every site that predates the record', () => {
  const dir = tmpSite()
  // This is the backward-compatibility property: no existing site.yml carries
  // `$org`, so every existing site keeps sending no `as_org`, exactly as before.
  writeFileSync(join(dir, 'site.yml'), 'name: Acme\n$uuid: OLD-1\n')
  assert.equal(readSiteOrg(dir), null)

  writeFileSync(join(dir, 'site.yml'), 'name: Acme\n$org: "   "\n')
  assert.equal(readSiteOrg(dir), null, 'a blank handle is not an org')
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
  assert.ok(!/\$uuid/.test(readFileSync(join(dir, 'site.yml'), 'utf8')))
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
// `.uniweb/sync-cache.json` keys every map by UNIT PATH (`site.yml`,
// `pages/about/about.md`) — the same string for every site — so it does not
// self-invalidate when the clone stops being bound to the site it describes.
// That is a state we actively tell people to enter: the 404 guidance says to
// clear `$uuid` to re-publish as a new site.

const cachePath = (dir) => join(dir, '.uniweb', 'sync-cache.json')
const writeCache = (dir, obj) => {
  mkdirSync(join(dir, '.uniweb'), { recursive: true })
  writeFileSync(cachePath(dir), JSON.stringify({ version: 1, ...obj }))
}
const readCache = (dir) => JSON.parse(readFileSync(cachePath(dir), 'utf8'))

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
  const dropped = clearRemoteSyncStateIfUnbound(dir)
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
  // entity N; cross-entity move is not supported".
  assert.deepEqual(c.itemUuids, {})
  // hashes is the SILENT one: send-only-changed would skip every entity that had
  // not changed since the old site's last push, so the new site would come up
  // missing exactly the content that did not change — and publish successfully.
  assert.deepEqual(c.hashes, {})
  assert.deepEqual(c.baseVersions, {})
  assert.deepEqual(c.unitBases, {})
})

test('a clone bound to the SAME site keeps its cache and gets stamped', () => {
  const dir = tmpSite()
  writeFileSync(join(dir, 'site.yml'), 'name: Acme\n$uuid: SITE-A\n')
  writeCache(dir, { siteUuid: 'SITE-A', itemUuids: { 'site.yml': 'I1' } })
  assert.deepEqual(clearRemoteSyncStateIfUnbound(dir), [])
  assert.deepEqual(readCache(dir).itemUuids, { 'site.yml': 'I1' })
})

test('a clone bound to a DIFFERENT site than the cache describes is cleared', () => {
  // Reachable in one step before the stamp existed: the create mints a uuid and
  // writes it BEFORE the push, so a push that then fails leaves exactly this.
  const dir = tmpSite()
  writeFileSync(join(dir, 'site.yml'), 'name: Acme\n$uuid: SITE-NEW\n')
  writeCache(dir, { siteUuid: 'SITE-OLD', itemUuids: { 'site.yml': 'I1' } })
  assert.deepEqual(clearRemoteSyncStateIfUnbound(dir), ['itemUuids'])
  const c = readCache(dir)
  assert.deepEqual(c.itemUuids, {})
  assert.equal(c.siteUuid, 'SITE-NEW')
})

test('a legacy cache with no siteUuid on a bound clone is LEFT ALONE', () => {
  // Deliberate: that is every pre-existing clone, and assuming it matches is
  // right far more often than wiping it would be. The cost is that a clone
  // already broken before the stamp existed stays broken until `.uniweb/` is
  // removed — an accepted trade, recorded so it is not read as an oversight.
  const dir = tmpSite()
  writeFileSync(join(dir, 'site.yml'), 'name: Acme\n$uuid: SITE-A\n')
  writeCache(dir, { itemUuids: { 'site.yml': 'I1' } })
  assert.deepEqual(clearRemoteSyncStateIfUnbound(dir), [])
  assert.deepEqual(readCache(dir).itemUuids, { 'site.yml': 'I1' })
  // ...but it IS stamped now, so a later divergence becomes detectable.
  assert.equal(readCache(dir).siteUuid, 'SITE-A')
})

test('an empty cache is a no-op, and still records identity', () => {
  const dir = tmpSite()
  writeFileSync(join(dir, 'site.yml'), 'name: Acme\n$uuid: SITE-A\n')
  writeCache(dir, {})
  assert.deepEqual(clearRemoteSyncStateIfUnbound(dir), [])
  assert.equal(readCache(dir).siteUuid, 'SITE-A')
})

test('an item_uuid_conflict clears the stale cache and says re-run', async () => {
  // The exit for a clone broken BEFORE the pre-flight guard existed: an unstamped
  // legacy cache on a bound site, which the guard deliberately leaves alone rather
  // than wiping every existing clone. Branches on `reason` — the backend types this
  // as 409 alongside `stale_base`; `detail` is prose and must not be matched.
  const dir = tmpSite()
  writeFileSync(join(dir, 'site.yml'), 'name: Acme\n$uuid: SITE-NEW\n')
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
    asOrg: null,
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
  assert.deepEqual(c.itemUuids, {})
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
// Reported by the backend lane, 2026-08-27, channel `backend-framework-hosting-7bdb`:
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
    asOrg: null,
    report,
    pkg: siteOnlyPkg({ hashes: { '@uniweb/site-content site': 'h1' } })
  })
  assert.equal(res.exitCode, 0)
  // Identity is banked, so the next emit can address rows rather than re-mint them.
  assert.ok(Object.keys(readItemUuids(dir)).length > 0, 'no per-item identity banked')
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
    asOrg: null,
    report,
    pkg: siteOnlyPkg({ hashes: { '@uniweb/site-content site': 'h1' } })
  })
  // ⭐ The push still SUCCEEDS — the content landed. That is exactly why the
  // silence was expensive: nothing here is an error, and the next command pays.
  assert.equal(res.exitCode, 0)
  assert.deepEqual(readItemUuids(dir), {}, 'banked identity from a document-less response')
  assert.ok(
    calls.note.join('\n').includes('identity not banked'),
    'a push that banked no identity said nothing about it'
  )
})
