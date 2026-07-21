/**
 * The scaffolded workspace must install under every package manager we
 * tell people to use.
 *
 * pnpm gates install scripts behind an approval list, and the two majors
 * spell it differently:
 *
 *   pnpm 10  onlyBuiltDependencies: [esbuild, sharp]      (a list)
 *   pnpm 11  allowBuilds: { esbuild: true, sharp: true }  (a map)
 *
 * pnpm 11 ignores the pnpm 10 name outright. With only the list, a fresh
 * `uniweb create` project fails on `pnpm install` with
 * ERR_PNPM_IGNORED_BUILDS and exits 1 — before anything is built, on the
 * developer's own machine. esbuild compiles and sharp resolves a platform
 * binary, and Uniweb sites use sharp for image processing, so this is
 * unconditional rather than an edge case.
 *
 * pnpm 10 understands both names (verified: `allowBuilds` alone installs a
 * working sharp under 10 and 11), so listing the pair costs nothing and
 * keeps the scaffold installable on either major.
 *
 * npm and yarn run install scripts by default and ignore this file
 * entirely — they read `workspaces` in package.json, which the workspace
 * template also emits.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import yaml from 'js-yaml'

const TEMPLATE = join(
  dirname(fileURLToPath(import.meta.url)),
  '..', 'templates', 'workspace', 'pnpm-workspace.yaml.hbs'
)

/** The packages that carry install scripts in a scaffolded project. */
const NATIVE_DEPS = ['esbuild', 'sharp']

/**
 * Render the handlebars template well enough to parse as YAML. Only the
 * `packages` block is dynamic; substituting one glob is sufficient and
 * keeps this test independent of the handlebars runtime.
 */
function renderTemplate() {
  return readFileSync(TEMPLATE, 'utf8')
    .replace(/\{\{#each workspaceGlobs\}\}[\s\S]*?\{\{\/each\}\}/, '  - "site"\n  - "src"')
}

test('the scaffolded workspace file is valid YAML', () => {
  assert.doesNotThrow(() => yaml.load(renderTemplate()))
})

test('pnpm 10 approval (onlyBuiltDependencies) covers every native dep', () => {
  const doc = yaml.load(renderTemplate())
  assert.ok(Array.isArray(doc.onlyBuiltDependencies), 'expected a list')
  for (const dep of NATIVE_DEPS) {
    assert.ok(
      doc.onlyBuiltDependencies.includes(dep),
      `onlyBuiltDependencies is missing ${dep} — pnpm 10 will skip its build`
    )
  }
})

test('pnpm 11 approval (allowBuilds) covers every native dep', () => {
  const doc = yaml.load(renderTemplate())
  assert.ok(
    doc.allowBuilds && !Array.isArray(doc.allowBuilds) && typeof doc.allowBuilds === 'object',
    'allowBuilds must be a MAP — pnpm 11 renamed the list form and ignores it'
  )
  for (const dep of NATIVE_DEPS) {
    assert.equal(
      doc.allowBuilds[dep], true,
      `allowBuilds is missing ${dep} — pnpm 11 install exits 1 with ERR_PNPM_IGNORED_BUILDS`
    )
  }
})

test('both spellings stay in sync, so neither major is left behind', () => {
  const doc = yaml.load(renderTemplate())
  const fromList = [...doc.onlyBuiltDependencies].sort()
  const fromMap = Object.entries(doc.allowBuilds)
    .filter(([, allowed]) => allowed === true)
    .map(([name]) => name)
    .sort()
  assert.deepEqual(
    fromMap, fromList,
    'adding a native dep to one approval list but not the other breaks that pnpm major'
  )
})

test('the template still declares workspace packages', () => {
  // npm and yarn ignore this file, but pnpm needs the globs — a rewrite
  // that dropped them would break pnpm workspaces silently.
  const doc = yaml.load(renderTemplate())
  assert.ok(Array.isArray(doc.packages) && doc.packages.length > 0)
})
