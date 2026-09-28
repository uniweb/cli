/**
 * A scaffolded package.json is already in the shape `update` writes.
 *
 * `update` (and `add`, `rename`, `doctor`) rewrites a package.json through
 * `writeJsonPreservingStyle`, which keeps the file's indentation but is
 * `JSON.stringify` underneath — so it writes every array one item per line.
 * A template that wrote an array on one line had it reflowed by the project's
 * first `update`: a bump of two version ranges came with an eleven-line diff to
 * a `files` list nobody touched. Every package template must therefore render
 * a package.json that the writer reproduces byte for byte.
 *
 * Run: `pnpm test` or `node --test test/`
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { scaffoldWorkspace, scaffoldFoundation, scaffoldSite } from '../src/utils/scaffold.js'
import { stringifyJsonLike } from '../src/utils/json-file.js'

const cases = [
  // The contexts `create` passes (src/index.js): a project, and a blank workspace.
  {
    pkg: 'workspace',
    run: (dir) =>
      scaffoldWorkspace(dir, {
        projectName: 'test-project',
        workspaceGlobs: ['site', 'src'],
        scripts: { dev: 'uniweb dev', build: 'uniweb build', preview: 'pnpm --filter site preview' }
      })
  },
  {
    pkg: 'blank workspace',
    run: (dir) => scaffoldWorkspace(dir, { projectName: 'test-project', workspaceGlobs: [], scripts: { build: 'uniweb build' } })
  },
  {
    pkg: 'foundation',
    run: (dir) => scaffoldFoundation(dir, { name: 'src', projectName: 'test-project' })
  },
  {
    pkg: 'site',
    run: (dir) =>
      scaffoldSite(dir, { name: 'site', projectName: 'test-project', foundationName: 'src', foundationPath: 'file:../src' })
  }
]

for (const { pkg, run } of cases) {
  test(`the ${pkg} template's package.json survives update's writer unchanged`, async () => {
    const dir = await mkdtemp(path.join(tmpdir(), `uniweb-pkgstyle-${pkg}-`))
    try {
      await run(dir)
      const src = await readFile(path.join(dir, 'package.json'), 'utf8')
      assert.equal(stringifyJsonLike(JSON.parse(src), src), src)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
}

test('CONTROL — an array written on one line does not survive it', () => {
  const src = '{\n  "files": ["dist", "main.js"]\n}\n'
  assert.notEqual(stringifyJsonLike(JSON.parse(src), src), src)
})
