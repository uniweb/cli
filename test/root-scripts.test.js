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
    assert.equal(scripts.preview, 'npm -w alpha/site run preview')
  })

  it('leaves preview on the site it runs when a site sorted ahead of it arrives', async () => {
    const scripts = await scriptsAfter(
      { dev: 'uniweb dev', preview: 'npm -w beta run preview' },
      [site('alpha'), site('beta')],
    )
    // Still beta's, in the form npm selects one site by: its folder.
    assert.equal(scripts.preview, 'npm -w beta/site run preview')
    assert.equal(scripts['preview:alpha'], 'npm -w alpha/site run preview')
    assert.equal(scripts['dev:alpha'], 'uniweb dev alpha')
    assert.equal(scripts['preview:beta'], undefined)
  })

  it('leaves a preview the CLI did not write', async () => {
    const scripts = await scriptsAfter({ preview: 'vite preview --port 9000' }, [site('alpha')])
    assert.equal(scripts.preview, 'vite preview --port 9000')
  })

  it('moves a preview that runs a site that is gone', async () => {
    const scripts = await scriptsAfter({ preview: 'npm -w gone run preview' }, [site('alpha')])
    assert.equal(scripts.preview, 'npm -w alpha/site run preview')
  })

  it('⭐ removes a script for a project whose site is gone, though it goes by the project\'s name', async () => {
    const scripts = await scriptsAfter(
      { dev: 'uniweb dev', 'dev:old': 'uniweb dev old-site', 'preview:old': 'npm -w old/site run preview', 'dev:mine': 'uniweb dev old-site --port 9000' },
      [site('alpha'), { name: 'new-site', path: 'new/site' }],
    )
    assert.equal(scripts['dev:old'], undefined)
    assert.equal(scripts['preview:old'], undefined)
    assert.equal(scripts['dev:new'], 'uniweb dev new-site')
    assert.equal(scripts['dev:mine'], 'uniweb dev old-site --port 9000', 'a command the CLI does not write is the person\'s')
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
    assert.equal(scripts.preview, 'npm -w alpha/site run preview')
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

  it('⭐ a project\'s site goes by the project\'s name, as a workspace of projects names its scripts', async () => {
    const own = { dev: 'uniweb dev', build: 'uniweb build', 'dev:press': 'uniweb dev press-site' }
    const courses = { name: 'courses-site', path: 'courses/site' }
    const { written, scripts } = await add(own, [courses], [{ name: 'press-site', path: 'press/site' }, courses])
    assert.deepEqual(written, ['dev:courses', 'preview:courses'])
    assert.equal(scripts['dev:courses'], 'uniweb dev courses-site')
    assert.equal(scripts['preview:courses'], 'pnpm --filter courses-site preview')
  })

  it("its package's name where the project's is another site's already", async () => {
    const courses = { name: 'courses-site', path: 'courses/site' }
    const { written } = await add({ dev: 'uniweb dev', build: 'uniweb build', 'dev:courses': 'uniweb dev other-site' }, [courses], [site('alpha'), courses])
    assert.deepEqual(written, ['dev:courses-site', 'preview:courses-site'])
  })

  it('CONTROL — a site that is not a project\'s own goes by its package\'s name', async () => {
    const { written } = await add({ dev: 'uniweb dev', build: 'uniweb build' }, [{ name: 'blog', path: 'sites/blog' }], [site('alpha'), { name: 'blog', path: 'sites/blog' }])
    assert.deepEqual(written, ['dev:blog', 'preview:blog'])
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
