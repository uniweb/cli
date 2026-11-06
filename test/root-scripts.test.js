/**
 * What adding a site, and renaming one, do to the workspace's own scripts.
 *
 * A root script is the workspace's: adding a site adds that site's, and leaves what was there alone
 * (`addRootScripts`). Renaming regenerates the per-site scripts the CLI wrote, since one for the old
 * name runs a site that is gone (`updateRootScripts`).
 *
 * Adding a third site once moved `preview` to another site (the new one sorted first), and added
 * `dev:beta-site` beside an existing `dev:beta` that ran the same command. ⛔ And until 2026-11-06
 * `add` regenerated every site's scripts: in a workspace of seven projects with scripts named its
 * own way, adding one wrote a pair beside each project's, and rewrote `preview`.
 */
import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { updateRootScripts, addRootScripts } from '../src/utils/config.js'

let dir
const scriptsAfter = async (scripts, sites, pm = 'npm') => {
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'w', scripts }))
  await updateRootScripts(dir, sites, pm)
  return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).scripts
}
const site = (name) => ({ name, path: `${name}/site` })

describe('updateRootScripts', () => {
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'root-scripts-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('writes dev and preview for a first site', async () => {
    const scripts = await scriptsAfter({ build: 'uniweb build' }, [site('alpha')])
    assert.equal(scripts.dev, 'uniweb dev')
    assert.equal(scripts.preview, 'npm -w alpha run preview')
  })

  it('leaves preview on the site it runs when a site sorted ahead of it arrives', async () => {
    const scripts = await scriptsAfter(
      { dev: 'uniweb dev', preview: 'npm -w beta run preview' },
      [site('alpha'), site('beta')],
    )
    assert.equal(scripts.preview, 'npm -w beta run preview')
    assert.equal(scripts['preview:alpha'], 'npm -w alpha run preview')
    assert.equal(scripts['dev:alpha'], 'uniweb dev alpha')
    assert.equal(scripts['preview:beta'], undefined)
  })

  it('leaves a preview the CLI did not write', async () => {
    const scripts = await scriptsAfter({ preview: 'vite preview --port 9000' }, [site('alpha')])
    assert.equal(scripts.preview, 'vite preview --port 9000')
  })

  it('moves a preview that runs a site that is gone', async () => {
    const scripts = await scriptsAfter({ preview: 'npm -w gone run preview' }, [site('alpha')])
    assert.equal(scripts.preview, 'npm -w alpha run preview')
  })

  it('adds no second script for a command the workspace already has', async () => {
    const scripts = await scriptsAfter(
      { dev: 'uniweb dev', 'dev:beta': 'uniweb dev beta-site', preview: 'npm -w alpha run preview' },
      [site('alpha'), site('beta-site')],
    )
    assert.equal(scripts['dev:beta'], 'uniweb dev beta-site')
    assert.equal(scripts['dev:beta-site'], undefined)
  })
})

describe('addRootScripts — what `uniweb add` writes', () => {
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'root-scripts-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  const add = async (scripts, added, sites, pm = 'pnpm') => {
    const path = join(dir, 'package.json')
    writeFileSync(path, JSON.stringify({ name: 'w', scripts }, null, 2) + '\n')
    const before = readFileSync(path, 'utf8')
    const written = await addRootScripts(dir, added, sites, pm)
    const after = readFileSync(path, 'utf8')
    return { written, scripts: JSON.parse(after).scripts, untouched: before === after }
  }

  it("writes dev, preview and build for the workspace's first site", async () => {
    const { written, scripts } = await add({}, [site('alpha')], [site('alpha')], 'npm')
    assert.deepEqual(written, ['build', 'dev', 'preview'])
    assert.equal(scripts.dev, 'uniweb dev')
    assert.equal(scripts.preview, 'npm -w alpha run preview')
    assert.equal(scripts.build, 'uniweb build')
  })

  it('adds the new site its own pair, and nothing for the site that was there', async () => {
    const { written, scripts } = await add(
      { dev: 'uniweb dev', build: 'uniweb build', preview: 'npm -w alpha run preview' },
      [site('beta')],
      [site('alpha'), site('beta')],
      'npm',
    )
    assert.deepEqual(written, ['dev:beta', 'preview:beta'])
    assert.equal(scripts['dev:beta'], 'uniweb dev beta')
    assert.equal(scripts.preview, 'npm -w alpha run preview')
    assert.equal(scripts['dev:alpha'], undefined)
  })

  it("⭐ leaves a workspace's own scripts as they are, and adds none for its other sites", async () => {
    // A workspace whose scripts are named its own way, `run` included, as one with seven projects had.
    const own = {
      dev: 'pnpm --filter io-site dev',
      build: 'pnpm -r build',
      preview: 'pnpm --filter io-site run preview',
      'dev:docs': 'pnpm --filter docs-site dev',
      'preview:docs': 'pnpm --filter docs-site run preview',
    }
    const { written, scripts } = await add(own, [site('hub-site')], [site('io-site'), site('docs-site'), site('hub-site')])
    assert.deepEqual(written, ['dev:hub-site', 'preview:hub-site'])
    assert.deepEqual(scripts, { ...own, 'dev:hub-site': 'uniweb dev hub-site', 'preview:hub-site': 'pnpm --filter hub-site preview' })
  })

  it('adds no second script for a command the workspace already runs under a name of its own', async () => {
    const { written, scripts } = await add(
      { dev: 'uniweb dev', 'dev:beta': 'uniweb dev beta-site' },
      [site('beta-site')],
      [site('alpha'), site('beta-site')],
      'npm',
    )
    assert.deepEqual(written, ['build', 'preview:beta-site'])
    assert.equal(scripts['dev:beta-site'], undefined)
  })

  it('a foundation or an extension adds no site, so at most a `build` the workspace lacks', async () => {
    const lacking = await add({ dev: 'uniweb dev' }, [], [site('alpha')])
    assert.deepEqual(lacking.written, ['build'])
    // CONTROL: with a `build` of its own, the file is not written at all.
    const complete = await add({ dev: 'uniweb dev', build: 'pnpm -r build' }, [], [site('alpha')])
    assert.deepEqual(complete.written, [])
    assert.equal(complete.untouched, true)
  })
})
