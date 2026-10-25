/**
 * `uniweb doctor` — `public/data/` is build output, and git says whether it is ignored.
 *
 * In a repository, a rule anywhere git reads one counts: a workspace's root `.gitignore`
 * naming `site/public/data/` covers the site as well as the site's own file does. Outside a
 * repository, the site's own `.gitignore` is read for the rule `--fix` writes.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DATA_DIR } from '@uniweb/core/data-paths'
import { checkGeneratedDataDir } from '../src/commands/doctor.js'
import { repoOf } from '../src/utils/sync-point.js'

const ID = 'generated-data-not-ignored'

/** A workspace with a `site/` folder, inside a repository unless `git` is false. */
function workspace(t, { git = true, root, site } = {}) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'uniweb-doctor-ignore-')))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const sitePath = join(dir, 'site')
  mkdirSync(sitePath)
  if (git) execFileSync('git', ['init', '-q'], { cwd: dir })
  if (root !== undefined) writeFileSync(join(dir, '.gitignore'), root)
  if (site !== undefined) writeFileSync(join(sitePath, '.gitignore'), site)
  return sitePath
}

/** @returns {string[]} the ids of the issues this check raises */
function idsFor(sitePath, { fix = false } = {}) {
  const issues = []
  checkGeneratedDataDir({ sitePath, siteName: 'site', siteYml: {}, issues, shouldFix: () => fix, fixed: () => {} })
  return issues.map((i) => i.id)
}

test("a rule in the workspace root's .gitignore covers the site", (t) => {
  assert.deepEqual(idsFor(workspace(t, { root: `site/public/${DATA_DIR}/\n` })), [])
})

test('any spelling git reads counts, not only the one --fix writes', (t) => {
  assert.deepEqual(idsFor(workspace(t, { site: `/public/${DATA_DIR}\n` })), [])
})

test('no rule anywhere is reported, and --fix writes one git then reads', (t) => {
  const sitePath = workspace(t)
  assert.deepEqual(idsFor(sitePath, { fix: true }), [ID])
  assert.match(readFileSync(join(sitePath, '.gitignore'), 'utf8'), new RegExp(`^public/${DATA_DIR}/$`, 'm'))
  assert.deepEqual(idsFor(sitePath), [])
})

test("outside a repository, the site's own .gitignore is read", (t) => {
  const covered = workspace(t, { git: false, site: `public/${DATA_DIR}/\n` })
  if (repoOf(covered)) return t.skip('the temp directory is inside a repository')
  assert.deepEqual(idsFor(covered), [])
  assert.deepEqual(idsFor(workspace(t, { git: false })), [ID])
})
