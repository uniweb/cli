/**
 * `uniweb doctor` names a data schema two foundations of one scope in the workspace each define: a copy,
 * where naming the registered type in full was enough, since any foundation may use any registered data
 * schema. A recommendation whether or not the copies agree; it stops nothing (`type-defined-twice`).
 *
 * ⛔ On 2026-11-08 `uniweb register` also refused a definition differing from another in the workspace,
 * for a few hours, in uniweb 1.30.0. It was withdrawn: the registry judges a register, and one
 * project's files had no say in another foundation's release.
 *
 * Run: `pnpm test` or `node --test test/`
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmp } from './helpers/run-verb.js'

const MEMBER = 'name: member\nfields:\n  name: { type: text }\n'

function workspace({ press = MEMBER } = {}) {
  const root = tmp('uw-types-twice-')
  const w = (rel, body) => {
    mkdirSync(dirname(join(root, rel)), { recursive: true })
    writeFileSync(join(root, rel), body)
  }
  w('pnpm-workspace.yaml', "packages:\n  - '*'\n")
  w('package.json', JSON.stringify({ name: 'ws', private: true }))
  for (const [dir, schema] of [['hub', MEMBER], ['press', press]]) {
    w(`${dir}/package.json`, JSON.stringify({ name: `${dir}-src`, version: '0.1.0', type: 'module', main: './_entry.generated.js' }))
    w(`${dir}/main.js`, `export default {\n  name: '@acme/${dir}',\n}\n`)
    w(`${dir}/schemas/member.yml`, schema)
  }
  return root
}

test('⭐ doctor names each name defined twice, as a recommendation whether or not the copies agree', { timeout: 60_000 }, async () => {
  const { checkTypesDefinedTwice } = await import('../src/commands/doctor.js')
  const agree = workspace()
  const issues = []
  await checkTypesDefinedTwice({ workspaceDir: agree, checkedDirs: null, issues })
  assert.deepEqual(issues.map((i) => [i.id, i.type, i.files]), [['type-defined-twice', 'info', ['hub/schemas/member.yml', 'press/schemas/member.yml']]])

  const differ = workspace({ press: MEMBER + '  role: { type: text }\n' })
  const warned = []
  await checkTypesDefinedTwice({ workspaceDir: differ, checkedDirs: null, issues: warned })
  assert.deepEqual(warned.map((i) => [i.type, i.message]), [['info', '@acme/member is defined 2 times in the workspace, differently']])

  // CONTROL — checked from a package that defines neither, it names none.
  const none = []
  await checkTypesDefinedTwice({ workspaceDir: agree, checkedDirs: [join(agree, 'elsewhere')], issues: none })
  assert.deepEqual(none, [])
})
