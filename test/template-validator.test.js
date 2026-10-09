/**
 * A template's foundation or extension folder is copied over the package the CLI
 * scaffolds, as it is — so its code must be at the folder's root.
 *
 * Measured 2026-10-08: the official `extensions` template kept its extension's
 * code in `effects/src/`, which the CLI used to unwrap. uniweb 0.88.0 stopped
 * unwrapping and copied it nested, beside the scaffold's own empty `sections/`,
 * and every project made from the template failed to build, saying only that it
 * found no section types. Such a folder is now refused at `create`, naming what
 * to move.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { validateTemplate } from '../src/templates/validator.js'

/** A template on disk from `{ 'path/in/template': 'content' }`. */
function template(files) {
  const root = mkdtempSync(join(tmpdir(), 'uniweb-template-'))
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), content)
  }
  return root
}

const META = JSON.stringify({ name: 'Probe', format: 2 })

test('a foundation that keeps its code in src/ is refused, naming the move', async () => {
  const root = template({
    'template.json': META,
    'foundation/src/main.js': 'export default {}\n',
    'site/site.yml': 'name: Probe\n'
  })
  await assert.rejects(validateTemplate(root), (err) => {
    assert.equal(err.code, 'NESTED_PACKAGE_CODE')
    assert.match(err.message, /foundation\/ keeps its code in foundation\/src\//)
    assert.match(err.message, /move foundation\/src\/'s contents up into foundation\//)
    return true
  })
  rmSync(root, { recursive: true, force: true })
})

test("an extension declared in packages is held to the same rule — the 0.88.0 case", async () => {
  const root = template({
    'template.json': JSON.stringify({
      name: 'Probe',
      format: 2,
      packages: [
        { type: 'foundation', name: 'foundation' },
        { type: 'extension', name: 'effects' },
        { type: 'site', name: 'site', foundation: 'foundation' }
      ]
    }),
    'foundation/main.js': 'export default {}\n',
    'effects/src/main.js': 'export default {}\n',
    'site/site.yml': 'name: Probe\n'
  })
  await assert.rejects(validateTemplate(root), /effects\/ keeps its code in effects\/src\//)
  rmSync(root, { recursive: true, force: true })
})

test('control: a flat foundation passes, and so does a src/ that holds only helpers', async () => {
  for (const files of [
    { 'foundation/main.js': 'export default {}\n' },
    { 'foundation/main.js': 'export default {}\n', 'foundation/src/format.js': 'export const f = 1\n' }
  ]) {
    const root = template({ 'template.json': META, 'site/site.yml': 'name: Probe\n', ...files })
    const metadata = await validateTemplate(root)
    assert.deepEqual(
      metadata.contentDirs.map((d) => d.name),
      ['foundation', 'site']
    )
    rmSync(root, { recursive: true, force: true })
  }
})
