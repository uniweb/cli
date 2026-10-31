/**
 * `uniweb doctor` — where the site lives, which every absolute URL it states is made on.
 *
 * A host may state it (Netlify and Vercel at build, a Uniweb host when it serves the site, GitHub
 * Pages through the workflow `uniweb add ci` writes); otherwise `seo.origin` does. Until 2026-10-25
 * doctor asked every site for `seo.baseUrl`, which, once set, gave every page the home page's
 * canonical.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkSiteAddress } from '../src/commands/doctor.js'

/** A workspace with a `site/`, deploying to `host` when one is given, with a Pages workflow when given. */
function workspace(t, { host, workflow } = {}) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'uniweb-doctor-address-')))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const sitePath = join(dir, 'site')
  mkdirSync(sitePath)
  if (host) writeFileSync(join(sitePath, 'deploy.yml'), `default: ${host}\ntargets:\n  ${host}:\n    host: ${host}\n`)
  if (workflow !== undefined) {
    mkdirSync(join(dir, '.github', 'workflows'), { recursive: true })
    writeFileSync(join(dir, '.github', 'workflows', 'deploy-github-pages.yml'), workflow)
  }
  return { workspaceDir: dir, sitePath }
}

async function issuesFor(paths, siteYml = {}) {
  const issues = []
  await checkSiteAddress({ ...paths, siteName: 'site', siteYml, issues })
  return issues
}

test('a site that states its origin is fine', async (t) => {
  assert.deepEqual(await issuesFor(workspace(t), { seo: { origin: 'https://example.com' } }), [])
})

test('⛔ a retired seo.baseUrl is an error, naming what replaced it', async (t) => {
  const [issue] = await issuesFor(workspace(t), { seo: { baseUrl: 'https://example.com' } })
  assert.equal(issue.id, 'site-address-config')
  assert.equal(issue.type, 'error')
  assert.match(issue.message, /`seo\.baseUrl` is now `seo\.origin`/)
})

test('an origin with a path is an error — the path is the base’s', async (t) => {
  const [issue] = await issuesFor(workspace(t), { seo: { origin: 'https://user.github.io/repo' } })
  assert.equal(issue.id, 'site-address-config')
  assert.match(issue.message, /The path \/repo\/ is the site's base/)
})

test('⭐ a host that states the address needs no seo.origin', async (t) => {
  for (const host of ['netlify', 'vercel', 'uniweb']) {
    assert.deepEqual(await issuesFor(workspace(t, { host })), [], host)
  }
  const current = workspace(t, { host: 'github-pages', workflow: 'env:\n  UNIWEB_ORIGIN: ${{ steps.pages.outputs.origin }}\n' })
  assert.deepEqual(await issuesFor(current), [])
})

test('an older GitHub Pages workflow is named, with the command that regenerates it', async (t) => {
  const stale = workspace(t, { host: 'github-pages', workflow: "REPO='${{ github.event.repository.name }}'\n" })
  const [issue] = await issuesFor(stale)
  assert.equal(issue.id, 'site-address-from-github')
  assert.equal(issue.type, 'warn')
})

test('with nothing stating it, the site is told what it is missing', async (t) => {
  for (const paths of [workspace(t), workspace(t, { host: 'cloudflare-pages' }), workspace(t, { host: 'github-pages' })]) {
    const [issue] = await issuesFor(paths)
    assert.equal(issue.id, 'site-address-unknown')
    assert.match(issue.message, /no canonical URLs, no sitemap\.xml/)
  }
})

test('a warning once a host is named that does not state it, and a note before any is', async (t) => {
  assert.equal((await issuesFor(workspace(t)))[0].type, 'info')
  assert.equal((await issuesFor(workspace(t, { host: 'cloudflare-pages' })))[0].type, 'warn')
})
