/**
 * `uncommittedUnder` returns paths relative to the site, not to the repo root.
 *
 * `git status --porcelain` prints repo-root-relative paths whatever directory it
 * runs in. Every caller does `join(siteDir, rel)` with the result, so an
 * un-normalized return is only correct when the site IS the repo root — and
 * silently wrong for a site nested in a repo, which is the ordinary layout.
 *
 * What it cost: pull exempts its own previous output from the uncommitted-work
 * guard by looking each dirty path up in a record keyed site-relative. The lookup
 * missed for every nested site, so pull refused on files pull itself had written,
 * and told the user to reach for `--force` — the destructive option — to get past
 * its own output.
 *
 * The two tests below are the same assertion at the two layouts, and only the
 * nested one ever failed. A test written at the root layout would have passed
 * against the bug, which is why the nested case is the point.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { uncommittedUnder } from '../src/utils/git.js'

const git = (args, cwd) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })

/**
 * A git repo with a site at `siteRel` carrying an uncommitted `site.yml`.
 * @returns {{root: string, siteDir: string}}
 */
function repoWithSite(siteRel) {
  const root = mkdtempSync(join(tmpdir(), 'uniweb-gitpaths-'))
  git(['init', '-q', '.'], root)
  const siteDir = siteRel ? join(root, siteRel) : root
  mkdirSync(join(siteDir, 'pages'), { recursive: true })
  writeFileSync(join(siteDir, 'site.yml'), 'name: probe\n')
  writeFileSync(join(siteDir, 'pages', 'a.md'), '# a\n')
  return { root, siteDir }
}

test('a NESTED site yields site-relative paths (the case that was broken)', () => {
  const { root, siteDir } = repoWithSite(join('myproject', 'site'))
  try {
    const dirty = uncommittedUnder(siteDir, ['site.yml', 'pages'])
    assert.ok(dirty, 'a git work tree returns a list')
    assert.ok(
      dirty.includes('site.yml'),
      `expected site-relative 'site.yml', got ${JSON.stringify(dirty)}`
    )
    // The regression: git's own spelling, which every caller then joins wrongly.
    assert.ok(
      !dirty.some((p) => p.includes('myproject')),
      `paths must not be repo-root-relative, got ${JSON.stringify(dirty)}`
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a site AT the repo root still works (where the bug was invisible)', () => {
  const { root, siteDir } = repoWithSite('')
  try {
    const dirty = uncommittedUnder(siteDir, ['site.yml', 'pages'])
    assert.ok(dirty.includes('site.yml'))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('every returned path resolves under the site dir', () => {
  // The property the callers actually depend on: `join(siteDir, rel)` must name
  // the real file, for reading it back and for hashing it.
  const { root, siteDir } = repoWithSite(join('nested', 'deeper', 'site'))
  try {
    const dirty = uncommittedUnder(siteDir, ['site.yml', 'pages'])
    for (const rel of dirty) {
      assert.ok(
        !rel.startsWith('..'),
        `${rel} escapes the site dir — join(siteDir, rel) would miss`
      )
    }
    assert.ok(dirty.includes('site.yml'))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('not a git work tree is null, distinct from clean', () => {
  const dir = mkdtempSync(join(tmpdir(), 'uniweb-nogit-'))
  try {
    writeFileSync(join(dir, 'site.yml'), 'name: x\n')
    assert.equal(uncommittedUnder(dir, ['site.yml']), null)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
