/**
 * The CLI's version table — what `create` writes into a new project, and what `update`
 * and `doctor` align a project to (src/versions.js).
 *
 * Pinned here:
 *
 *   - ⭐ Every range is a tilde, `~<version>`, from a workspace checkout as from npm: a
 *     breaking change ships as a minor, in 1.x as in 0.x, and a caret admits a 1.x minor
 *     (ruled 2026-10-11). pnpm publishes the CLI's `workspace:~` deps as tilde ranges; until
 *     that day a workspace run read them as exact versions — a sandbox scaffold pinned
 *     `0.20.0` where a user's got `^0.20.0`.
 *   - ⭐ A version is not a reason to depend on a package. Every version a scaffold asks
 *     for is in the bundled framework index, so the CLI's `dependencies` name only what its
 *     code loads — each one is installed with every `npx uniweb`. `@uniweb/kit` and
 *     `@uniweb/runtime` were depended on for their versions alone: installed on its own,
 *     `uniweb@0.89.0` was 86 packages and 56 MB, and 23 packages and 15 MB without them.
 *     Kit's Tailwind plugin also left every new project's first install warning about a
 *     missing `tailwindcss` peer.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getResolvedVersions, loadFrameworkIndex } from '../src/versions.js'

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(readFileSync(join(CLI, 'package.json'), 'utf8'))

function filesUnder(dir, pattern, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
    const p = join(dir, entry.name)
    if (entry.isDirectory()) filesUnder(p, pattern, out)
    else if (pattern.test(entry.name)) out.push(p)
  }
  return out
}

/** The `@uniweb/*` packages a source text loads: a static import, a dynamic one, a resolve. */
function loadsIn(text) {
  const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
  const found = new Set()
  const patterns = [
    // A statement — so generated code inside a string (`const c = \`import …\``) is not one.
    /(?:^|\n)\s*(?:import|export)\b[\s\S]{0,400}?\bfrom\s+['"](@uniweb\/[^'"/]+)/g,
    /\bimport\s*\(\s*['"](@uniweb\/[^'"/]+)/g,
    /\b(?:require|resolve)\s*\(\s*['"](@uniweb\/[^'"/]+)/g
  ]
  for (const re of patterns) for (const m of code.matchAll(re)) found.add(m[1])
  return found
}

test('the load matcher: static and dynamic imports count; generated code and comments do not', () => {
  assert.deepEqual([...loadsIn(`import { a } from '@uniweb/core/locale-config'`)], ['@uniweb/core'])
  assert.deepEqual(
    [...loadsIn(`const [w] = await Promise.all([\n  import('@uniweb/content-writer'),\n])`)],
    ['@uniweb/content-writer']
  )
  assert.deepEqual([...loadsIn("const code = `import { H2 } from '@uniweb/kit'\n`")], [])
  assert.deepEqual([...loadsIn(`/** import { Article } from '@uniweb/kit' */`)], [])
})

test('⛔ the CLI depends only on the @uniweb/* packages its code loads', () => {
  const loaded = new Set()
  for (const file of filesUnder(join(CLI, 'src'), /\.(js|mjs|jsx)$/)) {
    for (const name of loadsIn(readFileSync(file, 'utf8'))) loaded.add(name)
  }
  assert.ok(loaded.size > 0, 'the scan found loads in src/')
  const unloaded = Object.keys(manifest.dependencies || {}).filter(
    (name) => name.startsWith('@uniweb/') && !loaded.has(name)
  )
  assert.deepEqual(
    unloaded,
    [],
    `depended on, never loaded: ${unloaded.join(', ')}. The CLI reads every package's ` +
      'version from its bundled framework-index.json (src/versions.js) — a dependency is ' +
      'not needed for one, and each is installed with every `npx uniweb`.'
  )
})

test('every @uniweb/* version a scaffold asks for is in the bundled framework index', () => {
  const asked = new Set()
  for (const file of filesUnder(join(CLI, 'templates'), /\.hbs$/)) {
    for (const m of readFileSync(file, 'utf8').matchAll(/\{\{\s*version\s+"(@uniweb\/[^"]+)"\s*\}\}/g)) {
      asked.add(m[1])
    }
  }
  assert.ok(asked.size > 0, 'the scaffolds ask for @uniweb/* versions')
  const index = loadFrameworkIndex()
  assert.ok(index, 'the bundled framework index loads')
  const missing = [...asked].filter((name) => !index.packages[name]?.version)
  assert.deepEqual(missing, [], `asked for by a scaffold, absent from framework-index.json: ${missing}`)
})

test('⭐ every version in the table is a tilde range — as a published CLI writes it', () => {
  const table = getResolvedVersions()
  assert.ok(table['@uniweb/core'], 'the table names @uniweb/core')
  for (const [name, spec] of Object.entries(table)) {
    assert.match(spec, /^~\d+\.\d+\.\d+/, `${name}: ${spec}`)
  }
})

test('from a workspace checkout, a workspace: dependency reads as ~<the sibling\'s version>', (t) => {
  const sibling = join(CLI, '..', 'core', 'package.json')
  if (!existsSync(sibling)) return t.skip('not a workspace checkout')
  assert.match(manifest.dependencies['@uniweb/core'], /^workspace:/, 'the path under test')
  const { version } = JSON.parse(readFileSync(sibling, 'utf8'))
  assert.equal(getResolvedVersions()['@uniweb/core'], `~${version}`)
})
