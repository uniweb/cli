/**
 * `uniweb rename` edits a site's site.yml in place
 *
 * Renaming a foundation or an extension has to change one value in each
 * dependent site's `site.yml`. It used to load the file and dump it back, so a
 * rename silently stripped the author's comments and re-flowed their lists and
 * long strings. These run the real command on a scaffolded workspace and compare
 * the file byte for byte, and pin the refusal: a value that cannot be edited in
 * place stops the rename before anything moves.
 *
 * The command calls `process.exit` when it refuses, so it runs in a child.
 *
 * Run: `pnpm test` or `node --test test/`
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { isExtensionPackage } from '@uniweb/build'
import { scaffoldFoundation, scaffoldSite, scaffoldWorkspace } from '../src/utils/scaffold.js'

const RENAME = pathToFileURL(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'commands', 'rename.js')
).href

const EXT = '/extensions/effects/dist/entry.js'

const SITE_YML = `# The sample site — these comments are the point of a template
name: Research Profile
description: A researcher's site with a profile, research projects, a full publication list and the team.
tags: [academic, personal]

# Foundation to use for this site
foundation: src   # the local one

extensions:
  - ${EXT}   # particle hero

# Build options
build:
  prerender: true
`

async function workspace() {
  const root = await mkdtemp(path.join(tmpdir(), 'uniweb-rename-'))
  await scaffoldWorkspace(root, {
    projectName: 'rename-test',
    workspaceGlobs: ['site', 'src', 'extensions/*'],
    scripts: {}
  })
  await scaffoldFoundation(path.join(root, 'src'), { name: 'src', projectName: 'rename-test' })
  const ext = path.join(root, 'extensions', 'effects')
  await scaffoldFoundation(ext, { name: 'effects', projectName: 'rename-test' })
  await writeFile(path.join(ext, 'main.js'), 'export default { extension: true }\n')
  await scaffoldSite(path.join(root, 'site'), {
    name: 'site',
    projectName: 'rename-test',
    foundationName: 'src',
    foundationPath: 'file:../src',
    foundationRef: 'src'
  })
  await writeFile(path.join(root, 'site', 'site.yml'), SITE_YML)
  return root
}

function rename(root, ...args) {
  const code = `const { rename } = await import(${JSON.stringify(RENAME)}); await rename(${JSON.stringify(args)})`
  return spawnSync(process.execPath, ['--input-type=module', '-e', code], { cwd: root, encoding: 'utf8' })
}

test('the fixture is a workspace with a foundation, an extension and a site (control)', async () => {
  const root = await workspace()
  try {
    assert.ok(existsSync(path.join(root, 'src', 'package.json')))
    assert.equal(isExtensionPackage(path.join(root, 'extensions', 'effects')), true)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('rename foundation changes only the foundation line of site.yml', async () => {
  const root = await workspace()
  try {
    const run = rename(root, 'foundation', 'src', 'research-profile')
    assert.equal(run.status, 0, run.stdout + run.stderr)
    assert.equal(
      await readFile(path.join(root, 'site', 'site.yml'), 'utf8'),
      SITE_YML.replace('foundation: src   #', 'foundation: research-profile   #')
    )
    assert.ok(existsSync(path.join(root, 'research-profile', 'package.json')))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('rename extension changes only the extension entry of site.yml', async () => {
  const root = await workspace()
  try {
    const run = rename(root, 'extension', 'effects', 'visual-effects')
    assert.equal(run.status, 0, run.stdout + run.stderr)
    assert.equal(
      await readFile(path.join(root, 'site', 'site.yml'), 'utf8'),
      SITE_YML.replace(EXT, '/extensions/visual-effects/dist/entry.js')
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a foundation value it cannot edit in place stops the rename before anything moves', async () => {
  const root = await workspace()
  try {
    const blockScalar = SITE_YML.replace('foundation: src   # the local one', 'foundation: >-\n  src')
    await writeFile(path.join(root, 'site', 'site.yml'), blockScalar)
    const run = rename(root, 'foundation', 'src', 'research-profile')
    assert.equal(run.status, 1)
    assert.match(run.stderr.replace(/\x1b\[[0-9;]*m/g, ''), /Cannot rename: site\/site\.yml/)
    assert.equal(await readFile(path.join(root, 'site', 'site.yml'), 'utf8'), blockScalar)
    assert.ok(existsSync(path.join(root, 'src', 'package.json')), 'the foundation folder moved')
    assert.ok(!existsSync(path.join(root, 'research-profile')))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
