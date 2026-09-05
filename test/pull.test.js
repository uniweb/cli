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
  readPullVersions
} from '../src/commands/pull.js'
import { createZip } from '@uniweb/build/uwx'

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
// input nobody injected. Without this, `resolveBackendOrigin()` falls through
// to tier 4, the DEVELOPER'S logged-in session (`~/.uniweb/registry-auth.json`),
// so a fixture carrying `$uuid` and no `$backend` trips the sync-scope guard and
// `pull` refuses.
//
// ⚠️ The failure is machine-local and reads as a product bug. Anyone who runs
// `uniweb login --backend http://localhost:8080` — the documented local-dev
// flow — breaks 14 tests here with "This project's stored identity belongs to
// https://uniweb.app, but this command targets http://localhost:8080", while CI,
// which has no session, stays green. Measured 2026-08-26.
//
// The value must match what the guard reads as the fixture's stored origin, and
// with no `$backend` in `site.yml` that is the built-in default. `fetch` is
// mocked in every test, so nothing leaves the machine.
const TEST_BACKEND = ['--backend', 'https://uniweb.app']

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
  const folder = { $model: '@uniweb/folder', contents: [] }
  const rec = { $model: '@acme/article', article: {} }
  const { folderDoc, recordDocs } = splitRecordsPull({
    entities: [folder, rec]
  })
  assert.equal(folderDoc, folder)
  assert.deepEqual(recordDocs, [rec])
})

test('pull is a no-op with no $uuid in files', async () => {
  const dir = tempSite()
  try {
    writeFileSync(join(dir, 'site.yml'), "name: S\nfoundation: '@a/base'\n")
    const res = await pull(['--force', ...TEST_BACKEND], {
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
    writeFileSync(
      join(dir, 'site.yml'),
      "$uuid: SITE\nname: Old\nfoundation: '@a/base'\n"
    )

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

    const res = await pull(['--force', ...TEST_BACKEND], {
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
    writeFileSync(
      join(dir, 'site.yml'),
      "$uuid: SITE9\nname: Old\nfoundation: '@a/base'\n"
    )

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
      $model: '@uniweb/folder',
      contents: [
        {
          kind: 'branch',
          name: 'articles',
          $children: [
            {
              kind: 'ref',
              name: 'hello',
              entry: { model: '@acme/article', entity: 'R9' }
            }
          ]
        }
      ]
    }
    const recordDoc = {
      $uuid: 'R9',
      $model: '@acme/article',
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

    const res = await pull(['--force', ...TEST_BACKEND], {
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
    // `entities/acme/article/`. Not a query's directory: a query has none.
    assert.ok(
      existsSync(join(dir, 'entities/acme/article/hello.md')),
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
    writeFileSync(
      join(dir, 'site.yml'),
      "$uuid: SITE1\nname: S\nfoundation: '@a/base'\n"
    )

    const folderDoc = {
      $id: '@folder',
      $model: '@uniweb/folder',
      contents: [
        {
          kind: 'branch',
          name: 'articles',
          $children: [
            {
              kind: 'ref',
              name: 'hello',
              entry: { model: '@acme/article', entity: 'R1' }
            }
          ]
        }
      ]
    }
    const recordDoc = {
      $uuid: 'R1',
      $model: '@acme/article',
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

    const res = await pull(['--force', ...TEST_BACKEND], {
      resolveSiteDir: async () => dir,
      getToken: async () => 'tok',
      fetch: makeFetch([
        // content lane 404s here (focus on the folder lane); the site $uuid drives both
        ['/dev/site/folder/pull/SITE1', { entities: [folderDoc, recordDoc] }],
        ['/dev/registry/data-schemas/', declaration]
      ])
    })

    assert.equal(res.exitCode, 0)
    const recordFile = join(dir, 'entities/acme/article/hello.md')
    assert.ok(existsSync(recordFile), 'record file projected')
    assert.match(readFileSync(recordFile, 'utf8'), /title: Hello/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('pull --no-records skips the folder lane', async () => {
  const dir = tempSite()
  const pulledUrls = []
  try {
    writeFileSync(
      join(dir, 'site.yml'),
      "$uuid: SITE2\nname: S\nfoundation: '@a/base'\n"
    )
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

    const res = await pull(['--no-records', '--force', ...TEST_BACKEND], {
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
    writeFileSync(
      join(dir, 'site.yml'),
      "$uuid: SITE304\nname: Keep\nfoundation: '@a/base'\n"
    )
    mkdirSync(join(dir, '.uniweb'), { recursive: true })
    writeFileSync(
      join(dir, '.uniweb/pull-cache.json'),
      JSON.stringify({ version: 1, content: '"abc123"' })
    )
    let sentINM
    const res = await pull(['--no-records', '--force', ...TEST_BACKEND], {
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
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('pull caches the ETag from a 200 for the next conditional pull', async () => {
  const dir = tempSite()
  try {
    writeFileSync(
      join(dir, 'site.yml'),
      "$uuid: SITEET\nname: S\nfoundation: '@a/base'\n"
    )
    const document = {
      $model: '@uniweb/site-content',
      info: { name: { en: 'S' }, foundation: '@a/base' },
      pages: [],
      layout_sections: [],
      extensions: [],
      collections: []
    }
    await pull(['--no-records', '--force', ...TEST_BACKEND], {
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
  writeFileSync(join(dir, 'site.yml'), '$uuid: SITE\nname: S\n')
  let fetched = false
  const res = await pull(['--non-interactive', ...TEST_BACKEND], {
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
  writeFileSync(join(dir, 'site.yml'), '$uuid: SITE\nname: S\n')
  const res = await pull(['--force', '--non-interactive', ...TEST_BACKEND], {
    resolveSiteDir: async () => dir,
    getToken: async () => 'tok',
    fetch: async () => jsonRes(null, 404)
  })
  // 404 on the lane, not a refusal — the guard let it through.
  assert.notEqual(res.exitCode, 1)
})

test('pull --dry-run is never blocked by the guard — it writes nothing', async () => {
  const dir = tempSite()
  writeFileSync(join(dir, 'site.yml'), '$uuid: SITE\nname: S\n')
  const res = await pull(['--dry-run', '--non-interactive', ...TEST_BACKEND], {
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
  writeFileSync(join(dir, 'site.yml'), '$uuid: SITE\nname: S\n')
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
    const res = await pull(['--non-interactive', ...TEST_BACKEND], {
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
      const res = await pull(['--non-interactive', ...TEST_BACKEND], {
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
      const res = await pull(['--non-interactive', ...TEST_BACKEND], {
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
      const res = await pull(['--non-interactive', ...TEST_BACKEND], {
        resolveSiteDir: async () => dir,
        getToken: async () => 'tok',
        fetch: async () => jsonRes(null, 404)
      })
      assert.notEqual(res.exitCode, 1)

      // …but an edit ON TOP of pull's output is the user's work again.
      writeFileSync(join(dir, 'pages/home/hero.md'), body + '\nmine\n')
      const res2 = await pull(['--non-interactive', ...TEST_BACKEND], {
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
      const res = await pull(['--non-interactive', ...TEST_BACKEND], {
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
  writeFileSync(
    join(dir, 'site.yml'),
    "$uuid: SITE\nname: S\nfoundation: '@a/base'\n"
  )
  const g = (a) => execFileSync('git', a, { cwd: dir, stdio: 'ignore' })
  g(['init', '-q'])
  writeFileSync(join(dir, '.gitignore'), '.uniweb\n')
  // Establish the file the way it really gets established: by pulling it.
  await pull(['--force', ...TEST_BACKEND], {
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

      const res = await pull(['--merge', ...TEST_BACKEND], {
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

      await pull(['--merge', ...TEST_BACKEND], {
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
      await pull(['--merge', ...TEST_BACKEND], {
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
    writeFileSync(join(dir, 'site.yml'), '$uuid: SITE\nname: S\n')
    try {
      const res = await pull(['--merge', '--non-interactive', ...TEST_BACKEND], {
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
    writeFileSync(
      join(dir, 'site.yml'),
      "$uuid: SITE\nname: Old\nfoundation: '@a/base'\n"
    )
    const document = {
      $uuid: 'SITE',
      $id: 'site-content',
      $model: '@uniweb/site-content',
      info: { name: { en: 'Pulled' }, foundation: '@a/base' },
      pages: []
    }

    const res = await pull(['--force', ...TEST_BACKEND], {
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
