/**
 * Which site a command means, and which package `uniweb dev` starts for it.
 *
 * ⛔ Until 2026-10-31 only `snapshot` looked at the folder you stand in: `uniweb dev` inside
 * `marketing/site` served the workspace's first site, and a push from `docs/` asked which
 * site, or stopped when nothing could ask. And under npm `uniweb dev marketing` started the
 * foundation: `-w` reads a name as a folder too.
 *
 * Run: `pnpm test` or `node --test test/`
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pickSite, siteAround, siteNamed } from '../src/utils/pick-site.js'
import { devCommand } from '../src/commands/dev.js'
import { resolveSiteDir } from '../src/commands/deploy.js'

const ROOT = join('/work')
const PATHS = ['docs/site', 'memberships/sites/fitness', 'memberships/sites/society', 'marketing/site']
const at = (...parts) => join(ROOT, ...parts)

test('⭐ inside a site, that site — however deep', () => {
  assert.equal(siteAround(PATHS, ROOT, at('marketing', 'site')), 'marketing/site')
  assert.equal(siteAround(PATHS, ROOT, at('marketing', 'site', 'pages', 'home')), 'marketing/site')
  assert.equal(siteAround(PATHS, ROOT, at('memberships', 'sites', 'society', 'pages')), 'memberships/sites/society')
})

test('⭐ in a project folder with one site, that site: the folder itself, or its foundation beside it', () => {
  assert.equal(siteAround(PATHS, ROOT, at('marketing')), 'marketing/site')
  assert.equal(siteAround(PATHS, ROOT, at('marketing', 'src')), 'marketing/site')
  assert.equal(siteAround(PATHS, ROOT, at('marketing', 'src', 'sections', 'Hero')), 'marketing/site')
})

test('a folder holding several says nothing, and neither does the root or a folder holding none', () => {
  assert.equal(siteAround(PATHS, ROOT, at('memberships')), null)
  assert.equal(siteAround(PATHS, ROOT, at('memberships', 'src')), null)
  assert.equal(siteAround(PATHS, ROOT, ROOT), null)
  assert.equal(siteAround(PATHS, ROOT, at('tools', 'docs-capture')), null)
  assert.equal(siteAround(PATHS, ROOT, join('/elsewhere')), null)
})

test('a folder that only starts like a site is not in it', () => {
  assert.equal(siteAround(['app/site'], ROOT, at('app', 'site-old')), 'app/site', 'its project still holds the one site')
  assert.equal(siteAround(['app/site'], ROOT, at('app-old', 'src')), null)
})

test('a name: the package, the folder, or the project holding one site', () => {
  const sites = [
    { name: 'marketing-site', path: 'marketing/site' },
    { name: 'fitness', path: 'memberships/sites/fitness' },
    { name: 'society', path: 'memberships/sites/society' }
  ]
  assert.equal(siteNamed(sites, 'marketing-site').path, 'marketing/site')
  assert.equal(siteNamed(sites, 'marketing/site').path, 'marketing/site')
  assert.equal(siteNamed(sites, 'marketing').path, 'marketing/site', "the project's name")
  assert.equal(siteNamed(sites, 'marketing/').path, 'marketing/site')
  assert.equal(siteNamed(sites, 'memberships'), null, 'two sites there: it names neither')
  assert.equal(siteNamed(sites, 'nope'), null)
  assert.equal(siteNamed(sites, 'uniweb'), null, 'the start of a folder is not the folder')
})

test('pickSite: named, else where you stand, else the only one, else the first and says so', () => {
  const sites = [
    { name: 'a-site', path: 'a/site' },
    { name: 'b-site', path: 'b/site' }
  ]
  assert.equal(pickSite(sites, ROOT, { requested: 'b', cwd: ROOT }).site.name, 'b-site')
  assert.equal(pickSite(sites, ROOT, { requested: 'nope', cwd: ROOT }).site, null)
  assert.deepEqual(pickSite(sites, ROOT, { cwd: at('b', 'src') }), { site: sites[1] })
  assert.deepEqual(pickSite(sites, ROOT, { cwd: ROOT }), { site: sites[0], ambiguous: true })
  assert.deepEqual(pickSite([sites[1]], ROOT, { cwd: ROOT }), { site: sites[1], ambiguous: false })
})

test('⛔ under npm, dev starts a site by its folder: -w reads its name as a folder too', () => {
  const site = { name: 'marketing', path: 'marketing/site' }
  assert.deepEqual(devCommand('npm', site), ['npm', '-w', 'marketing/site', 'run', 'dev'])
  assert.deepEqual(devCommand('npm', { name: 's', path: 'my sites/s' }), ['npm', '-w', 'my sites/s', 'run', 'dev'], 'a space stays in one argument')
  assert.deepEqual(devCommand('pnpm', site), ['pnpm', '--filter', 'marketing', 'dev'], "pnpm's --filter reads a name as a name")
})

test('⭐ a push, a pull and a publish take the site from the folder you stand in', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'uw-pick-site-')))
  const write = (rel, body) => {
    mkdirSync(join(root, rel, '..'), { recursive: true })
    writeFileSync(join(root, rel), body)
  }
  write('pnpm-workspace.yaml', "packages:\n  - '*/src'\n  - '*/site'\n")
  write('package.json', JSON.stringify({ name: 'w', private: true }))
  for (const p of ['one', 'two']) {
    write(`${p}/site/package.json`, JSON.stringify({ name: `${p}-site` }))
    write(`${p}/site/site.yml`, 'name: S\n')
    write(`${p}/site/pages/home/page.yml`, 'title: Home\n')
    write(`${p}/src/package.json`, JSON.stringify({ name: `${p}-src`, main: './_entry.generated.js' }))
    write(`${p}/src/sections/Hero/index.jsx`, 'export default function Hero() { return null }\n')
  }
  const saved = process.cwd()
  try {
    for (const [from, expected] of [
      ['two', 'two/site'],
      ['two/src', 'two/site'],
      ['two/src/sections/Hero', 'two/site'],
      ['one/site/pages/home', 'one/site'],
      ['one/site', 'one/site']
    ]) {
      process.chdir(join(root, from))
      assert.equal(await resolveSiteDir(['--non-interactive'], 'push'), join(root, expected), from)
    }
  } finally {
    process.chdir(saved)
  }
})
