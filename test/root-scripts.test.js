/**
 * What adding a site does to the workspace's own scripts.
 *
 * Adding a third site once moved `preview` to another site (the new one sorted first), and added
 * `dev:beta-site` beside an existing `dev:beta` that ran the same command. A root script is the
 * workspace's: adding a site adds that site's, and leaves what was there alone.
 */
import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { updateRootScripts } from '../src/utils/config.js'

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
