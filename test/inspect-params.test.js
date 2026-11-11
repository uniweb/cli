/**
 * `uniweb inspect` shows a section's params as its component receives them, apart from its content:
 * the build's split of the frontmatter, then the section's own settings lifted out, as core lifts
 * them onto the Block (`@uniweb/schemas/section`). A param named like a content field stays a param,
 * and the content is the body's (the runtime copies neither into the other since 2026-11-11).
 *
 * ⛔ Until 2026-11-11 inspect kept a list of its own, which had drifted from the build's: `hidden`,
 * `query` and the lifted settings showed as params, and a key under `props:` showed as none.
 *
 * Run: `pnpm test` or `node --test test/`
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inspect } from '../src/commands/inspect.js'

async function inspected(text) {
  const root = await mkdtemp(join(tmpdir(), 'uniweb-inspect-params-'))
  const out = []
  const { log, error, warn } = console
  try {
    const dir = join(root, 'pages', 'home')
    await mkdir(dir, { recursive: true })
    await writeFile(join(root, 'site.yml'), 'name: S\n')
    await writeFile(join(dir, 'report.md'), text)
    console.log = (line) => out.push(line)
    console.error = console.warn = () => {}
    await inspect([dir])
  } finally {
    Object.assign(console, { log, error, warn })
    await rm(root, { recursive: true, force: true })
  }
  return JSON.parse(out.join('\n'))[0]
}

const FILE = [
  '---',
  'type: Report',
  'title: From the frontmatter',
  'items: 2',
  'component: Other',
  'props: { label: Hi }',
  'hidden: true',
  'query: invoices',
  'theme: dark',
  'grid: 3',
  'sticky: true',
  '---',
  '# From the body',
  '',
  '### One',
  'First.',
  '',
  '### Two',
  'Second.',
  '',
].join('\n')

test('params are what the component receives: no section key, no section setting, props merged in', async () => {
  const shown = await inspected(FILE)
  assert.equal(shown.type, 'Report')
  assert.deepEqual(shown.params, { title: 'From the frontmatter', items: 2, component: 'Other', label: 'Hi' })
})

test('the keys that are not params are shown beside them, as written', async () => {
  const shown = await inspected(FILE)
  for (const [key, value] of Object.entries({ hidden: true, query: 'invoices', theme: 'dark', grid: 3, sticky: true })) {
    assert.deepEqual(shown[key], value, key)
  }
})

test('a param named like a content field leaves the content as the body gave it', async () => {
  const { content } = await inspected(FILE)
  assert.equal(content.title, 'From the body')
  assert.deepEqual(content.items.map((item) => item.title), ['One', 'Two'])
})
