/**
 * The roots a push sends from and a pull merges into (`src/utils/site-roots.js`) — the build's one
 * answer, and the mounts the site's repository holds among them.
 *
 * ⛔ Until 2026-11-04 the CLI's own list named no mount. Measured that day: a push refused an
 * uncommitted edit in the site's pages and let one in a mounted folder of the same repository through,
 * naming HEAD as what it sent.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { sentRoots, laneRoots, siteRoots, submoduleMountRoots, writableMounts, refusedMountLines } from '../src/utils/site-roots.js'
import { uncommittedContent } from '../src/backend/site-sync.js'

const scratch = mkdtempSync(join(tmpdir(), 'uw-site-roots-'))
process.env.GIT_CONFIG_GLOBAL = join(scratch, 'gitconfig')
writeFileSync(process.env.GIT_CONFIG_GLOBAL, '[user]\n\tname = t\n\temail = t@t\n[protocol "file"]\n\tallow = always\n')
process.env.GIT_CONFIG_NOSYSTEM = '1'

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
const w = (root, rel, body) => {
  mkdirSync(join(root, rel, '..'), { recursive: true })
  writeFileSync(join(root, rel), body)
}

// A repository holding `site/`, which mounts `docs/` from the same repository at /docs.
function project(siteYmlExtra = '') {
  const dir = mkdtempSync(join(scratch, 'p-'))
  git(dir, 'init', '-q')
  w(dir, 'site/site.yml', `name: S\nfoundation: "@acme/base@1.0.0"\npaths:\n  pages/docs: ../docs\n${siteYmlExtra}`)
  w(dir, 'site/pages/home/page.yml', 'title: Home\n')
  w(dir, 'docs/intro.md', '# Intro\n')
  git(dir, 'add', '-A')
  git(dir, 'commit', '-qm', 'base')
  return { dir, site: join(dir, 'site') }
}

test('⭐ a mounted folder the site\'s repository holds is one of its roots', () => {
  const { site } = project()
  assert.ok(sentRoots(site).includes('../docs'))
  assert.ok(laneRoots(site).content.includes('../docs'))
  assert.ok(sentRoots(site).includes('public'))
  assert.ok(!siteRoots(site, { media: false }).includes('public'))
})

test('⭐ an uncommitted edit in it stops a push, as one in the site\'s pages does', () => {
  const { dir, site } = project()
  appendFileSync(join(dir, 'docs', 'intro.md'), '\nAn edit not committed.\n')
  const refused = uncommittedContent(site)
  assert.ok(refused, 'the push was let through')
  assert.deepEqual(refused.paths, ['../docs/intro.md'])
})

test('CONTROL — with everything committed, nothing stops it', () => {
  const { site } = project()
  assert.equal(uncommittedContent(site), null)
})

test('a mount that is a repository of its own is not among the site\'s roots — a submodule is its pin, a clone beside the site nothing', () => {
  const { dir, site } = project()
  // The docs as a repository of their own, then as a submodule of the site's repository.
  const docs = mkdtempSync(join(scratch, 'docs-'))
  git(docs, 'init', '-q')
  w(docs, 'guide/setup.md', '# Setup\n')
  git(docs, 'add', '-A')
  git(docs, 'commit', '-qm', 'docs')
  git(dir, 'submodule', '-q', 'add', docs, 'external/docs')
  git(dir, 'commit', '-qm', 'submodule')
  w(dir, 'site/site.yml', 'name: S\nfoundation: "@acme/base@1.0.0"\npaths:\n  pages/docs: ../docs\n  pages/guide: ../external/docs/guide\n  pages/beside: ../../beside\n')
  const beside = join(dir, '..', 'beside')
  mkdirSync(beside, { recursive: true })
  git(beside, 'init', '-q')

  const roots = sentRoots(site)
  assert.ok(roots.includes('../docs'))
  assert.ok(!roots.includes('../external/docs/guide'), 'a folder in a submodule is no path of the site\'s repository')
  assert.ok(!roots.includes('../../beside'))
  // The submodule's own path, whose pin a push commits and `status` reads.
  assert.deepEqual(submoduleMountRoots(site), ['../external/docs'])
})

test('⭐ a pull writes every mount this copy can merge — a submodule\'s in its own history — and holds the app\'s edits to any other', () => {
  const { dir, site } = project()
  const docs = mkdtempSync(join(scratch, 'docs-'))
  git(docs, 'init', '-q')
  w(docs, 'guide/setup.md', '# Setup\n')
  git(docs, 'add', '-A')
  git(docs, 'commit', '-qm', 'docs')
  git(dir, 'submodule', '-q', 'add', docs, 'external/docs')
  git(dir, 'commit', '-qm', 'submodule')
  const beside = join(dir, '..', `beside-${Date.now()}`)
  mkdirSync(beside, { recursive: true })
  git(beside, 'init', '-q')
  const nowhere = mkdtempSync(join(scratch, 'nowhere-'))
  w(dir, 'site/site.yml', [
    'name: S',
    'foundation: "@acme/base@1.0.0"',
    'paths:',
    '  pages/docs: ../docs',
    '  pages/guide: ../external/docs/guide',
    `  pages/beside: ../../${beside.split('/').pop()}`,
    `  pages/nowhere: ${nowhere}`,
    '',
  ].join('\n'))

  const { writable, held, refused, submodules } = writableMounts(site)
  assert.deepEqual(writable, ['docs', 'guide'])
  assert.deepEqual(held.map((m) => [m.segment, m.why]), [['beside', 'own'], ['nowhere', 'none']])
  assert.deepEqual(refused, [])
  // The submodule's path in the site's repository, and the mounted folder's in the submodule.
  assert.deepEqual(submodules.map(({ segment, at, root }) => ({ segment, at, root })), [{ segment: 'guide', at: 'external/docs', root: 'guide' }])
})

test('a site in no repository: a mount inside its folder is written as its own files are, one outside held', () => {
  const dir = mkdtempSync(join(scratch, 'no-repo-'))
  w(dir, 'site/site.yml', 'name: S\npaths:\n  pages/docs: ./docs\n  pages/out: ../out\n')
  w(dir, 'site/docs/intro.md', '# Intro\n')
  w(dir, 'out/intro.md', '# Intro\n')
  const { writable, held } = writableMounts(join(dir, 'site'))
  assert.deepEqual(writable, ['docs'])
  assert.deepEqual(held.map((m) => [m.segment, m.why]), [['out', 'none']])
})

test('⛔ a mount written as an object, the form `writable` was set in, is refused, saying what replaced it', () => {
  const { site } = project('')
  w(join(site, '..'), 'site/site.yml', 'name: S\npaths:\n  pages/docs:\n    path: ../docs\n    writable: true\n')
  const { refused } = writableMounts(site)
  assert.deepEqual(refused, [{ segment: 'docs', path: '../docs' }])
  assert.match(refusedMountLines(refused[0]).join('\n'), /is an object\. A mount is its folder: `pages\/docs: \.\.\/docs`[\s\S]*`writable` is retired/)
})
