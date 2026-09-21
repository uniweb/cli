/**
 * A site made from a template inherits none of the template's sync or deploy state.
 *
 * A template is a site project like any other, so it can carry `sync.json`,
 * `deploy.yml` and `.uniweb/` — a template author who pushed theirs and committed
 * the result ships them. Copied into a new project, they make that project's first
 * push update the TEMPLATE's site, because it sends the template's uuids. The same
 * failure as a hand-made copy, which `uniweb forget --all` answers; here the CLI is
 * the one copying, so it simply doesn't.
 *
 * Run: `pnpm test` or `node --test test/`
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { scaffoldSite, applyContent } from '../src/utils/scaffold.js'

const CONTEXT = { projectName: 'my-project', foundationRef: 'src' }

async function write(file, text) {
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, text)
}

test("⭐ the template's sync.json, deploy.yml and .uniweb/ stay behind", async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'uniweb-inherited-'))
  try {
    const site = path.join(root, 'site')
    const content = path.join(root, 'content')
    await scaffoldSite(site, CONTEXT)
    await write(
      path.join(content, 'sync.json'),
      JSON.stringify({ version: 1, backends: { 'https://uniweb.app': { site: { uuid: 'TEMPLATE-SITE' } } } })
    )
    await write(path.join(content, 'deploy.yml'), 'default: production\ntargets:\n  production:\n    host: uniweb\n')
    await write(path.join(content, '.uniweb', 'backend-cache.json'), '{"version":1,"backends":{}}')
    await write(path.join(content, 'pages', 'home', 'hero.md'), '# Hi\n')
    // Deeper down, the same names are just content.
    await write(path.join(content, 'public', 'data', 'sync.json'), '{"rows":[]}')

    await applyContent(content, site, CONTEXT)

    assert.ok(existsSync(path.join(site, 'pages', 'home', 'hero.md')), 'content is applied (control)')
    assert.ok(!existsSync(path.join(site, 'sync.json')), 'no sync.json')
    assert.ok(!existsSync(path.join(site, 'deploy.yml')), 'no deploy.yml')
    assert.ok(!existsSync(path.join(site, '.uniweb')), 'no .uniweb/')
    assert.ok(
      existsSync(path.join(site, 'public', 'data', 'sync.json')),
      'a file of that name below the top is content, and is applied'
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
