/**
 * ⭐ A PAGE A PULL HELD IS LEFT OUT OF THE NEXT PUSH, IN ANY COPY.
 *
 * The app changed a page in a way its files cannot say — here a description on a folder-mode `.md`
 * page, which the file has no place for — so the pull wrote nothing for it, and the site keeps the
 * app's version. A push then sends no version and no record for it while its files still say what they
 * said at the pull, so the backend keeps the app's; it stops when the file changed since; and `--force`
 * sends the file over the app's, as it sends everything.
 *
 * ⛔ Until 2026-11-04 a held page kept the version the copy last agreed on, for the backend's gate to
 * keep the app's. A copy with no such version — a fresh clone, CI, one that lost its `.uniweb/` — banked
 * the backend's on its first pull, and its next push sent the file over the app's edit. A section the
 * app added to a folder of single-section pages was held, and banked, so that push deleted it.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { siteProjectToDocument, createZip, readZip } from '@uniweb/build/uwx'
import { tmp, runVerb } from './helpers/run-verb.js'

const A = 'http://dev.test'
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
const w = (root, rel, body) => {
  mkdirSync(dirname(join(root, rel)), { recursive: true })
  writeFileSync(join(root, rel), body)
}
const commitAll = (cwd, msg) => {
  git(cwd, 'add', '-A')
  if (git(cwd, 'status', '--porcelain').trim()) git(cwd, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', msg)
}

// A fresh clone of a synced site: its files and `sync.json`, and no `.uniweb/`.
function freshClone() {
  const repo = tmp('uw-held-')
  git(repo, 'init', '-q')
  w(repo, '.gitignore', '.uniweb\nnode_modules\n')
  w(repo, 'site/site.yml', "name: S\nfoundation: '@a/base@1.0.0'\nindex: home\n")
  w(repo, 'site/package.json', JSON.stringify({ name: 's', dependencies: { uniweb: '*' } }))
  w(repo, 'site/sync.json', JSON.stringify({ version: 1, backends: { [A]: { site: { uuid: 'SITE' } } } }, null, 2) + '\n')
  w(repo, 'site/pages/home/page.yml', 'title: Home\n')
  w(repo, 'site/pages/home/hero.md', '# Welcome\n')
  w(repo, 'site/pages/guide/folder.yml', 'title: Guide\n')
  w(repo, 'site/pages/guide/install.md', '# Install\n\nRun the installer.\n')
  w(repo, 'site/pages/guide/start.md', '# Start\n\nBegin here.\n')
  commitAll(repo, 'clone')
  return repo
}

const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16)
// Each item's version as a backend tokens one: its own content.
function itemVersions(doc) {
  const out = {}
  const walk = (r) => {
    const { $children, page_sections, ...own } = r
    out[r.$uuid] = hash(own)
    for (const x of page_sections || []) walk(x)
    for (const x of $children || []) walk(x)
  }
  for (const p of doc.pages) walk(p)
  return out
}
const slugOf = (r) => r.slug?.en ?? r.slug
const at = (doc, ...slugs) => slugs.reduce((list, s, i) => {
  const r = list.find((p) => slugOf(p) === s)
  return i === slugs.length - 1 ? r : r.$children
}, doc.pages)

// The site as the backend holds it — what the files push, each item with its uuid — and what a pull
// and a push each ask of it. A push's site document and manifest are kept in `sent`.
async function backendOf(siteDir) {
  const doc = await siteProjectToDocument(siteDir)
  doc.$uuid = 'SITE'
  const stamp = (r, key) => {
    r.$uuid = `u-${key}`
    ;(r.page_sections || []).forEach((s, i) => (s.$uuid = `u-${key}#${i}`))
    for (const c of r.$children || []) stamp(c, `${key}/${slugOf(c)}`)
  }
  for (const p of doc.pages) stamp(p, slugOf(p))
  const sent = []
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  const respond = (url, init) => {
    if (url.endsWith('/dev/config')) return json({})
    if (url.includes('/dev/site/content/pull/SITE')) {
      const zip = createZip([
        { name: 'manifest.json', data: Buffer.from(JSON.stringify({ format: 'uwx/1', entries: [{ kind: 'entity', uuid: 'SITE', file: 'entities/SITE.json', version: hash(doc), item_versions: itemVersions(doc) }] })) },
        { name: 'entities/SITE.json', data: Buffer.from(JSON.stringify(doc)) }
      ])
      return new Response(zip, { status: 200 })
    }
    if (url.includes('/dev/site/content')) {
      const zip = readZip(Buffer.from(init.body))
      const manifest = JSON.parse(zip.get('manifest.json').toString('utf8'))
      const site = JSON.parse(zip.get('entities/site-content.json').toString('utf8'))
      sent.push({ site, entry: manifest.entries.find((e) => e.file === 'entities/site-content.json') })
      // What it stores, as a backend returns it: what was sent, and each item it kept that the push left
      // out, in its place.
      const written = structuredClone(site)
      const keep = (mine, theirs) => {
        theirs.forEach((r, i) => {
          if (!mine.some((m) => m.$uuid === r.$uuid)) mine.splice(Math.min(i, mine.length), 0, structuredClone(r))
        })
        for (const m of mine) {
          const t = theirs.find((r) => r.$uuid === m.$uuid)
          if (t?.$children) keep((m.$children ||= []), t.$children)
        }
      }
      keep(written.pages, doc.pages)
      return json({ siteContentUuid: 'SITE', report: { finalized: [{ index: 0, uuid: 'SITE', changed: true, version: 'V2', item_versions: itemVersions(written), document: written }] } })
    }
    return json(null, 404)
  }
  const opts = { session: { version: 2, current: A, sessions: { [A]: { token: 't' } } }, env: { UNIWEB_WORKSPACE: 'personal' }, respond }
  return { doc, sent, opts }
}

// The app's edit: a description on /guide/install, which an `.md` page's file has no place for.
const describe = (doc) => {
  at(doc, 'guide', 'install').description = { en: 'Set it up.' }
}

test('⭐ a fresh copy pulls a held page and leaves it out of its push: the app keeps its edit', { timeout: 60_000 }, async () => {
  const { pull } = await import('../src/commands/pull.js')
  const { push } = await import('../src/commands/push.js')
  const { readItemBaseVersions, readHeldUnits } = await import('../src/backend/site-sync.js')
  const repo = freshClone()
  const siteDir = join(repo, 'site')
  const be = await backendOf(siteDir)
  describe(be.doc)

  const pulled = await runVerb(siteDir, pull, [], be.opts)
  assert.equal(pulled.exitCode, 0, pulled.output)
  assert.match(pulled.output, /\/guide\/install: description/)
  const versions = readItemBaseVersions(siteDir, A)
  assert.equal(versions['u-guide/install'], undefined, 'no version for the held page: a push holding none leaves it')
  assert.ok(versions['u-guide/start'], 'CONTROL — its sibling, taken, has one')
  assert.deepEqual(Object.keys(readHeldUnits(siteDir, A)).sort(), ['pages/guide/install/install.md', 'pages/guide/install/page.yml'])

  w(repo, 'site/pages/guide/start.md', '# Start\n\nBegin here, slowly.\n')
  commitAll(repo, 'an edit of its own')
  const pushed = await runVerb(siteDir, push, [], be.opts)
  assert.equal(pushed.exitCode, 0, pushed.output)
  const { site, entry } = be.sent.at(-1)
  assert.deepEqual(at(site, 'guide').$children.map(slugOf), ['start'], 'the held page is not sent')
  assert.equal(entry.item_base_versions?.['u-guide/install'], undefined, 'nor a version for it')
  assert.match(pushed.output, /Left out: 1 page\(s\) a pull held/)
  // …and it is not named as someone else's change for a pull to take, which a pull cannot.
  assert.doesNotMatch(pushed.output, /Changed on the backend by someone else/)
})

test('⭐ a held page whose file changed since the pull stops the push, and `--force` sends the file', { timeout: 60_000 }, async () => {
  const { pull } = await import('../src/commands/pull.js')
  const { push } = await import('../src/commands/push.js')
  const repo = freshClone()
  const siteDir = join(repo, 'site')
  const be = await backendOf(siteDir)
  describe(be.doc)
  assert.equal((await runVerb(siteDir, pull, [], be.opts)).exitCode, 0)

  w(repo, 'site/pages/guide/install.md', '# Install\n\nRun the installer, then restart.\n')
  commitAll(repo, 'the held page edited')
  const stopped = await runVerb(siteDir, push, [], be.opts)
  assert.equal(stopped.exitCode, 1, stopped.output)
  assert.match(stopped.output, /changed in the app in a way their files cannot say, and changed in their files since the pull/)
  assert.match(stopped.output, /\/guide\/install/)
  assert.equal(be.sent.length, 0, 'nothing sent')

  const forced = await runVerb(siteDir, push, ['--force'], be.opts)
  assert.equal(forced.exitCode, 0, forced.output)
  assert.deepEqual(at(be.sent.at(-1).site, 'guide').$children.map(slugOf), ['install', 'start'])
})

// ⛔ Until 2026-11-05 a forced push left the hold as the pull wrote it while banking the page's version,
// and the next plain push left the page out and sent that version: the backend deletes such a page.
test('⭐ a forced push ends the hold: the next push sends the page as its files have it', { timeout: 60_000 }, async () => {
  const { pull } = await import('../src/commands/pull.js')
  const { push } = await import('../src/commands/push.js')
  const { readHeldUnits } = await import('../src/backend/site-sync.js')
  const repo = freshClone()
  const siteDir = join(repo, 'site')
  const be = await backendOf(siteDir)
  describe(be.doc)
  assert.equal((await runVerb(siteDir, pull, [], be.opts)).exitCode, 0)

  const forced = await runVerb(siteDir, push, ['--force'], be.opts)
  assert.equal(forced.exitCode, 0, forced.output)
  assert.deepEqual(readHeldUnits(siteDir, A), {}, 'nothing is held once the files\' version is sent')

  w(repo, 'site/pages/guide/start.md', '# Start\n\nBegin here, slowly.\n')
  commitAll(repo, 'an edit of its own')
  const pushed = await runVerb(siteDir, push, [], be.opts)
  assert.equal(pushed.exitCode, 0, pushed.output)
  assert.deepEqual(at(be.sent.at(-1).site, 'guide').$children.map(slugOf), ['install', 'start'], 'the page is sent')
  assert.doesNotMatch(pushed.output, /Left out/)
})

test('⭐ a version this copy holds for a page the push leaves out is not sent: leaving it out keeps it', { timeout: 60_000 }, async () => {
  const { pull } = await import('../src/commands/pull.js')
  const { push } = await import('../src/commands/push.js')
  const { readItemBaseVersions, writeItemBaseVersions, readHeldUnits } = await import('../src/backend/site-sync.js')
  const repo = freshClone()
  const siteDir = join(repo, 'site')
  const be = await backendOf(siteDir)
  describe(be.doc)
  assert.equal((await runVerb(siteDir, pull, [], be.opts)).exitCode, 0)
  // A version for the held page, however this copy came to hold one.
  writeItemBaseVersions(siteDir, A, { ...readItemBaseVersions(siteDir, A), 'u-guide/install': 'v-held' })
  assert.ok(Object.keys(readHeldUnits(siteDir, A)).length, 'CONTROL — still held')

  w(repo, 'site/pages/guide/start.md', '# Start\n\nBegin here, slowly.\n')
  commitAll(repo, 'an edit of its own')
  const pushed = await runVerb(siteDir, push, [], be.opts)
  assert.equal(pushed.exitCode, 0, pushed.output)
  const { site, entry } = be.sent.at(-1)
  assert.deepEqual(at(site, 'guide').$children.map(slugOf), ['start'], 'the held page is left out')
  assert.equal(entry.item_base_versions?.['u-guide/install'], undefined, 'and sent no version')
  assert.ok(entry.item_base_versions?.['u-guide/start'], 'CONTROL — the page sent has its version')
})

test('a section the app added to a folder of single-section pages is held, and no push deletes it', { timeout: 60_000 }, async () => {
  const { pull } = await import('../src/commands/pull.js')
  const { push } = await import('../src/commands/push.js')
  const { readItemBaseVersions } = await import('../src/backend/site-sync.js')
  const repo = freshClone()
  const siteDir = join(repo, 'site')
  const be = await backendOf(siteDir)
  const section = structuredClone(at(be.doc, 'guide', 'start').page_sections[0])
  at(be.doc, 'guide').page_sections = [{ ...section, $uuid: 'u-welcome', stable_id: 'welcome' }]

  const pulled = await runVerb(siteDir, pull, [], be.opts)
  assert.equal(pulled.exitCode, 0, pulled.output)
  assert.match(pulled.output, /\/guide: a section, which a route of single-section pages holds none of/)
  assert.equal(readItemBaseVersions(siteDir, A)['u-welcome'], undefined)

  w(repo, 'site/pages/guide/start.md', '# Start\n\nBegin here, slowly.\n')
  commitAll(repo, 'an edit of its own')
  const pushed = await runVerb(siteDir, push, [], be.opts)
  assert.equal(pushed.exitCode, 0, pushed.output)
  assert.equal(be.sent.at(-1).entry.item_base_versions?.['u-welcome'], undefined, 'no version, so the backend keeps it')
})
