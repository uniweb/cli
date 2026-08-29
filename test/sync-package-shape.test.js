// ⛔ THE PRODUCER'S OUTPUT SHAPE AND THE PUSHER'S INPUT SHAPE ARE A CONTRACT, and
// nothing tested it — so renaming one half broke a lane while every suite stayed
// green.
//
// `emitSyncPackages` returns `{ siteContent, records, … }`; `pushSyncPackages`
// and `push` DESTRUCTURE those names. Every existing test constructs its own
// `pkg` literal, so it can only ever agree with itself: when the producer's key
// was renamed and the consumers were not, the fixtures still matched the
// consumers and the tests passed while a real push sent no records at all.
//
// ⚠️ A DESTRUCTURE ALSO HIDES THE NAME FROM A GREP. Searching `pkg.records` finds
// nothing in a file that says `const { records } = pkg`, which is exactly how the
// miss survived a sweep.
//
// ⇒ This asserts the REAL producer's keys, so a rename on either side fails here
// rather than in production.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { emitSyncPackages } from '@uniweb/build/uwx'

const SCHEMA = {
  name: 'article',
  brief: true,
  fields: { title: { type: 'string' }, body: { type: 'text', format: 'markdown' } }
}

function site() {
  const root = mkdtempSync(join(tmpdir(), 'pkg-shape-'))
  const w = (rel, body) => {
    const p = join(root, rel)
    mkdirSync(join(p, '..'), { recursive: true })
    writeFileSync(p, typeof body === 'string' ? body : JSON.stringify(body))
  }
  w('site/site.yml', 'name: T\nfoundation: "@acme/base"\nqueries:\n  articles:\n    schema: "@/article"\n')
  w('site/package.json', { name: 'site', dependencies: { '@acme/base': 'file:../fdn' } })
  w('site/pages/home/index.md', '---\ntype: Hero\n---\n\n# Home\n')
  w('site/entities/article/hello.md', '---\ntitle: Hello\n---\nBody.\n')
  w('site/records.yml', '- article/*.md\n')
  w('fdn/dist/meta/schema.json', { dataSchemas: { '@/article': SCHEMA } })
  return { root, siteDir: join(root, 'site') }
}

// The exact names `pushSyncPackages` (backend/site-sync.js) and `push` destructure.
const DESTRUCTURED_BY_CONSUMERS = ['siteContent', 'records', 'siteContentUuid', 'hashes', 'applied', 'warnings', 'skipped']

test('emitSyncPackages returns every key its consumers destructure', async () => {
  const { root, siteDir } = site()
  try {
    const pkg = await emitSyncPackages(siteDir)
    for (const key of DESTRUCTURED_BY_CONSUMERS) {
      assert.ok(key in pkg, `emitSyncPackages must return \`${key}\` — a consumer destructures it`)
    }
    // ⛔ and NOT under the retired name, which is what a half-done rename leaves
    assert.equal('collections' in pkg, false, 'the records lane must not be named `collections`')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('the records lane is populated for a site with records — the control', async () => {
  // Without this, a producer returning `records: null` forever would satisfy the
  // key check above and still push nothing.
  const { root, siteDir } = site()
  try {
    const pkg = await emitSyncPackages(siteDir)
    assert.ok(pkg.records, 'a site with records must produce a records lane')
    assert.ok(pkg.records.buffer?.length > 0, 'the lane must carry bytes')
    assert.ok(Array.isArray(pkg.records.index), 'the lane must carry an index for back-fill')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
