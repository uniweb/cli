/**
 * `uniweb i18n words` names the sections that leave out their type's own words, which then show in
 * the foundation's language on every language's page, since only what a section holds is
 * translated. `--write` writes the type's words into each section that holds no block, as its block.
 * A section whose block leaves words out chose them, so it is listed with `--all` and never edited.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const CLI = join(dirname(dirname(fileURLToPath(import.meta.url))), 'src/index.js')

function run(args) {
  try {
    return { code: 0, out: execFileSync('node', [CLI, ...args], { encoding: 'utf8', stdio: 'pipe' }) }
  } catch (err) {
    return { code: err.status ?? 1, out: err.stdout || '', err: err.stderr || '' }
  }
}

/** A site on a local foundation whose Catalog type draws two words of its own. */
function project({ languages = '[en, es]' } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'i18n-words-'))
  const w = (rel, body) => {
    mkdirSync(join(root, rel, '..'), { recursive: true })
    writeFileSync(join(root, rel), typeof body === 'string' ? body : JSON.stringify(body, null, 2))
  }
  w('site/site.yml', `name: t\nfoundation: fnd\nindex: home\nlanguages: ${languages}\n`)
  w('site/package.json', { name: 'site', dependencies: { fnd: 'file:../fdn' } })
  w('fdn/package.json', { name: 'fnd', type: 'module', main: './_entry.generated.js' })
  w('fdn/main.js', "export default { name: '@acme/fnd' }\n")
  w('fdn/sections/Catalog/meta.js', "export default { title: 'Catalog', data: { labels: { search: { type: 'string', default: 'Search…' }, empty: { type: 'string', default: 'No results' } } } }\n")
  w('fdn/sections/Catalog/index.jsx', 'export default function Catalog() { return null }\n')
  w('site/pages/home/page.yml', 'title: Home\n')
  w('site/pages/home/1-catalog.md', '---\ntype: Catalog\n---\n\n# Our solutions\n\n### One\n\nThe first.\n')
  w('site/pages/home/2-partial.md', '---\ntype: Catalog\n---\n\n# Partial\n\n```yaml:labels\nsearch: Search solutions…\n```\n')
  return { root, site: join(root, 'site') }
}

test('lists a section that holds none of its type’s words, and with --all one whose block leaves some out', () => {
  const { root, site } = project()
  try {
    const plain = run(['i18n', 'words', '--target', site])
    assert.equal(plain.code, 0, plain.err)
    assert.match(plain.out, /pages\/home\/1-catalog\.md .*Catalog.* no `labels` block: search, empty/)
    assert.doesNotMatch(plain.out, /2-partial/)
    assert.match(plain.out, /1 more hold a block that leaves some of them out/)

    const all = JSON.parse(run(['i18n', 'words', '--all', '--json', '--target', site]).out)
    assert.deepEqual(all.languages, ['es'])
    assert.deepEqual(all.sections.map((s) => [s.file, s.hasBlock, s.words.map((w) => w.name)]), [
      ['pages/home/1-catalog.md', false, ['search', 'empty']],
      ['pages/home/2-partial.md', true, ['empty']],
    ])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('--write writes the words into the section as its own block, before its first item, and leaves a block it holds', () => {
  const { root, site } = project()
  try {
    const wrote = JSON.parse(run(['i18n', 'words', '--write', '--all', '--json', '--target', site]).out)
    assert.deepEqual(wrote.written.map((s) => s.file), ['pages/home/1-catalog.md'])
    assert.deepEqual(wrote.left.map((s) => [s.file, s.reason]), [['pages/home/2-partial.md', 'it holds a `labels` block of its own']])
    assert.equal(
      readFileSync(join(site, 'pages/home/1-catalog.md'), 'utf8'),
      '---\ntype: Catalog\n---\n\n# Our solutions\n\n```yaml:labels\nsearch: "Search…"\nempty: "No results"\n```\n\n### One\n\nThe first.\n',
    )
    assert.equal(readFileSync(join(site, 'pages/home/2-partial.md'), 'utf8'), '---\ntype: Catalog\n---\n\n# Partial\n\n```yaml:labels\nsearch: Search solutions…\n```\n')

    // Once written, the section holds its words, and nothing is listed.
    const after = run(['i18n', 'words', '--target', site])
    assert.match(after.out, /Every section holds a block of its type's words/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a block under an item’s heading is named where it is, and --write leaves it for its author to move', () => {
  // A block written at the end of a section with items is the last item's, so the section reads none
  // of it. ⛔ Until 2026-11-22 it was listed as holding no `labels` block, and --write wrote a second one.
  const { root, site } = project()
  try {
    const file = join(site, 'pages/home/3-end.md')
    const text = '---\ntype: Catalog\n---\n\n# At the end\n\n### One & two\n\nThe first.\n\n```yaml:labels\nsearch: Find\nempty: Nothing\n```\n'
    writeFileSync(file, text)
    const plain = run(['i18n', 'words', '--target', site])
    assert.equal(plain.code, 0, plain.err)
    assert.match(plain.out, /pages\/home\/3-end\.md .*Catalog.* its `labels` block is under “One & two”, so it is that item's/)
    assert.match(plain.out, /move it above the section's first item heading/)

    const wrote = JSON.parse(run(['i18n', 'words', '--write', '--json', '--target', site]).out)
    assert.deepEqual(wrote.written.map((s) => s.file), ['pages/home/1-catalog.md'])
    assert.deepEqual(wrote.left.map((s) => s.file), ['pages/home/3-end.md'])
    assert.match(wrote.left[0].reason, /under “One & two”/)
    assert.equal(readFileSync(file, 'utf8'), text)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a site in one language needs none of it', () => {
  const { root, site } = project({ languages: '[en]' })
  try {
    const out = run(['i18n', 'words', '--target', site])
    assert.equal(out.code, 0, out.err)
    assert.match(out.out, /one language \(en\)/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
