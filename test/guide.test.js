/**
 * `uniweb guide` prints the rest of a project's manual, from the package itself: in an empty
 * folder as in a project, to a pipe, with nothing added, because an agent reads what it prints.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const CLI = join(HERE, '..', 'src', 'index.js')
const PARTIALS = join(HERE, '..', 'partials')
const GUIDES = join(PARTIALS, 'guides')

const index = JSON.parse(readFileSync(join(GUIDES, 'index.json'), 'utf8'))
const names = index.map((g) => g.name)
const file = (name) => readFileSync(join(GUIDES, `${name}.md`), 'utf8')

/** The CLI in a folder that holds nothing, so no project can answer in its place. */
function guide(...args) {
  const cwd = mkdtempSync(join(tmpdir(), 'uw-guide-'))
  return spawnSync(process.execPath, [CLI, 'guide', ...args], { cwd, encoding: 'utf8' })
}

test('the index and the files match, one for one', () => {
  const files = readdirSync(GUIDES).filter((f) => f.endsWith('.md')).map((f) => f.replace(/\.md$/, ''))
  assert.deepEqual([...files].sort(), [...names].sort())
  for (const g of index) {
    assert.ok(g.title, `${g.name} has a title`)
    assert.ok(g.description, `${g.name} has a description`)
  }
})

test('with no name, one line per guide: its name and what it is for', () => {
  const run = guide()
  assert.equal(run.status, 0, run.stderr)
  const lines = run.stdout.trimEnd().split('\n')
  assert.equal(lines.length, index.length)
  index.forEach((g, i) => {
    assert.ok(lines[i].startsWith(g.name), lines[i])
    assert.ok(lines[i].endsWith(g.description), lines[i])
  })
})

test('a guide prints as its file is, whole, in an empty folder', () => {
  for (const name of names) {
    const run = guide(name)
    assert.equal(run.status, 0, run.stderr)
    assert.equal(run.stdout, file(name).trimEnd() + '\n', name)
  }
})

test('nothing but the guide reaches stdout: no banner and no color', () => {
  const run = guide('content')
  assert.ok(run.stdout.startsWith('# '))
  assert.doesNotMatch(run.stdout, /\x1b\[/)
})

test('several guides print with a rule between them', () => {
  const run = guide('i18n', 'migrate')
  assert.equal(run.status, 0, run.stderr)
  assert.equal(run.stdout, `${file('i18n').trimEnd()}\n\n---\n\n${file('migrate').trimEnd()}\n`)
})

test('--path prints where the file is, instead of the file', () => {
  const run = guide('content', '--path')
  assert.equal(run.status, 0, run.stderr)
  const path = run.stdout.trim()
  assert.ok(isAbsolute(path), path)
  assert.ok(existsSync(path), path)
  assert.equal(readFileSync(path, 'utf8'), file('content'))
})

test('a name that is no guide exits 1, with the guides and the nearest name', () => {
  const run = guide('contnt')
  assert.equal(run.status, 1)
  assert.equal(run.stdout, '')
  assert.match(run.stderr, /Did you mean `content`\?/)
  for (const name of names) assert.ok(run.stderr.includes(name), name)
})

test('a flag it does not know is refused', () => {
  const run = guide('content', '--pth')
  assert.equal(run.status, 2)
  assert.match(run.stderr, /Did you mean `--path`\?/)
})

test('--help describes it without printing a guide', () => {
  const run = guide('--help')
  assert.equal(run.status, 0)
  assert.match(run.stdout, /uniweb guide <name> --path/)
})

test('the docs only name guides that exist', () => {
  const docs = ['agents.md', ...readdirSync(GUIDES).filter((f) => f.endsWith('.md')).map((f) => join('guides', f))]
  for (const doc of docs) {
    const text = readFileSync(join(PARTIALS, doc), 'utf8')
    for (const [, name] of text.matchAll(/uniweb guide ([a-z0-9]+)/g)) {
      assert.ok(names.includes(name), `${doc} names \`uniweb guide ${name}\``)
    }
  }
})

test('the package ships them', () => {
  const pkg = JSON.parse(readFileSync(join(HERE, '..', 'package.json'), 'utf8'))
  assert.ok(pkg.files.includes('partials'), 'partials/ is in the tarball, and guides/ with it')
})
