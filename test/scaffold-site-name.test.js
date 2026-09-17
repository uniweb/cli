/**
 * A content template's own `name` survives scaffolding
 *
 * `applyContent` merges a template's `site.yml` over the scaffolded one, taking
 * a few keys from the scaffold. `foundation` always comes from the scaffold: the
 * CLI resolved it for this project. `name` comes from the scaffold only when the
 * template sets none, because a template's name is the default name of a site
 * made from it. These pin both, plus the two shapes that must still fall back
 * to the project name: the `{{projectName}}` placeholder (rendered or not) and a
 * template with no `name:` line.
 *
 * Run: `pnpm test` or `node --test test/`
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import yaml from 'js-yaml'
import { scaffoldSite, applyContent } from '../src/utils/scaffold.js'

const CONTEXT = { projectName: 'my-project', foundationRef: 'src' }

async function scaffoldWith(contentFile, contentText) {
  const root = await mkdtemp(path.join(tmpdir(), 'uniweb-site-name-'))
  const site = path.join(root, 'site')
  const content = path.join(root, 'content')
  await scaffoldSite(site, CONTEXT)
  await mkdir(content, { recursive: true })
  await writeFile(path.join(content, contentFile), contentText)
  await applyContent(content, site, CONTEXT)
  const text = await readFile(path.join(site, 'site.yml'), 'utf8')
  await rm(root, { recursive: true, force: true })
  return { text, data: yaml.load(text) }
}

test('the scaffold names the site after the project (control)', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'uniweb-site-name-'))
  await scaffoldSite(root, CONTEXT)
  const data = yaml.load(await readFile(path.join(root, 'site.yml'), 'utf8'))
  await rm(root, { recursive: true, force: true })
  assert.equal(data.name, 'my-project')
  assert.equal(data.foundation, 'src')
})

test("a template's literal name wins; its foundation does not", async () => {
  const { data } = await scaffoldWith(
    'site.yml.hbs',
    'name: Product Launch\nfoundation: somewhere-else\ntags: [landing-page]\n'
  )
  assert.equal(data.name, 'Product Launch')
  assert.equal(data.foundation, 'src')
  assert.deepEqual(data.tags, ['landing-page'])
})

test('the {{projectName}} placeholder still yields the project name', async () => {
  const { data } = await scaffoldWith('site.yml.hbs', 'name: {{projectName}}\n')
  assert.equal(data.name, 'my-project')
})

test('an unrendered placeholder in a plain site.yml does not leak', async () => {
  // A plain `site.yml` is copied without Handlebars, so the placeholder
  // arrives literally and must fall back rather than become the name.
  const { text, data } = await scaffoldWith('site.yml', 'name: "{{projectName}}"\n')
  assert.equal(data.name, 'my-project')
  assert.ok(!text.includes('{{projectName}}'))
})

test('a template with no name line gets the project name inserted', async () => {
  const { data } = await scaffoldWith('site.yml.hbs', 'description: A site\n')
  assert.equal(data.name, 'my-project')
  assert.equal(data.foundation, 'src')
  assert.equal(data.description, 'A site')
})

test("the template's comments survive the merge", async () => {
  const { text } = await scaffoldWith(
    'site.yml.hbs',
    '# The sample site\nname: Research Profile # shown on the card\n'
  )
  assert.match(text, /^# The sample site$/m)
  assert.match(text, /^name: Research Profile # shown on the card$/m)
})
