/**
 * `uniweb inspect <folder>` shows a page: its sections in the page's order, and not the files it
 * leaves out. It asks the build's own walk of the page, so it has no second rule.
 *
 * ⛔ Until 2026-10-31 it listed the folder's files by name, whatever `page.yml` said, so an agent
 * reading it to check a page saw another page.
 *
 * Run: `pnpm test` or `node --test test/`
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inspect } from '../src/commands/inspect.js'

async function run(folder) {
  const out = []
  const err = []
  const { log, error, warn } = console
  console.log = (line) => out.push(line)
  console.error = (line) => err.push(String(line))
  console.warn = (line) => err.push(String(line))
  try {
    await inspect([folder])
  } finally {
    Object.assign(console, { log, error, warn })
  }
  return { files: JSON.parse(out.join('\n')).map((r) => r._file), err: err.join('\n') }
}

async function folder({ site = true, yml, files }, body) {
  const root = await mkdtemp(join(tmpdir(), 'uniweb-inspect-'))
  try {
    const dir = join(root, 'pages', 'home')
    await mkdir(dir, { recursive: true })
    if (site) await writeFile(join(root, 'site.yml'), 'name: S\n')
    if (yml) await writeFile(join(dir, 'page.yml'), yml)
    for (const file of files) await writeFile(join(dir, file), `---\ntype: T\n---\n# ${file}\n`)
    return await body(dir)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

const FILES = ['alpha.md', 'beta.md', 'gamma.md']

test("a page's sections come in the order `sections:` names them", async () => {
  await folder({ yml: 'sections: [gamma, alpha, beta]\n', files: FILES }, async (dir) => {
    const { files, err } = await run(dir)
    assert.deepEqual(files, ['gamma.md', 'alpha.md', 'beta.md'])
    assert.equal(err, '')
  })
})

test('a file the page leaves out is not shown as on it, and is named', async () => {
  await folder({ yml: 'sections: [gamma, alpha]\n', files: FILES }, async (dir) => {
    const { files, err } = await run(dir)
    assert.deepEqual(files, ['gamma.md', 'alpha.md'])
    assert.match(err, /Not on this page: beta\.md/)
  })
})

test('with no list, by the numbers in their names', async () => {
  await folder({ files: ['10-a.md', '2-b.md', '1-c.md'] }, async (dir) => {
    assert.deepEqual((await run(dir)).files, ['1-c.md', '2-b.md', '10-a.md'])
  })
})

test('a child comes after its parent', async () => {
  await folder({ yml: 'nest:\n  grid: [card]\n', files: ['1-hero.md', '2-grid.md', '3-end.md', '@card.md'] }, async (dir) => {
    assert.deepEqual((await run(dir)).files, ['1-hero.md', '2-grid.md', '@card.md', '3-end.md'])
  })
})

test('CONTROL: a folder outside a site has no page to ask, so it keeps its name order', async () => {
  await folder({ site: false, yml: 'sections: [gamma, alpha]\n', files: FILES }, async (dir) => {
    assert.deepEqual((await run(dir)).files, FILES)
  })
})

test("a page whose config can't be read is still shown, in name order, and says so", async () => {
  await folder({ yml: 'data: refused\n', files: FILES }, async (dir) => {
    const { files, err } = await run(dir)
    assert.deepEqual(files, FILES)
    assert.match(err, /In name order: could not read this page's order/)
  })
})
