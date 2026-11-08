/**
 * ⭐ ONE NAME IN A SCOPE IS ONE TYPE: `uniweb register` refuses a data schema whose definition differs
 * from another of the same name in the workspace — two foundations of `@acme` each defining `member` —
 * since a register replaces what the type is for the other's sites too. It refuses before any build or
 * request, and says where each definition is and what to do. Copies that agree are not refused here;
 * `uniweb doctor` names them (`type-defined-twice`).
 *
 * Run: `pnpm test` or `node --test test/`
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmp, runVerb } from './helpers/run-verb.js'
import { register } from '../src/commands/register.js'

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

test('⭐ a definition that differs from another of its name in the workspace is refused, before any build', { timeout: 60_000 }, async () => {
  const root = workspace({ press: MEMBER + '  role: { type: text }\n' })
  const r = await runVerb(join(root, 'press'), register, ['--dry-run'])
  assert.equal(r.exitCode, 2, r.output)
  assert.match(r.output, /defined differently elsewhere in the workspace/)
  assert.match(r.output, /@acme\/member/)
  assert.match(r.output, /hub\/schemas\/member\.yml/)
  assert.match(r.output, /schemas\.config\.js/)
  assert.doesNotMatch(r.output, /No usable build/, 'refused before the build is looked for')
  assert.equal(r.requests, 0, 'nothing asked of a backend')
})

test('CONTROL — copies that agree are not refused here', { timeout: 60_000 }, async () => {
  const root = workspace()
  const r = await runVerb(join(root, 'press'), register, ['--dry-run'])
  assert.doesNotMatch(r.output, /defined differently/)
  // A dry run then wants a build, which this fixture has none of.
  assert.match(r.output, /No usable build/)
})

test('⭐ doctor names each name defined twice: a recommendation where they agree, a warning where they differ', { timeout: 60_000 }, async () => {
  const { checkTypesDefinedTwice } = await import('../src/commands/doctor.js')
  const agree = workspace()
  const issues = []
  await checkTypesDefinedTwice({ workspaceDir: agree, checkedDirs: null, issues })
  assert.deepEqual(issues.map((i) => [i.id, i.type, i.files]), [['type-defined-twice', 'info', ['hub/schemas/member.yml', 'press/schemas/member.yml']]])

  const differ = workspace({ press: MEMBER + '  role: { type: text }\n' })
  const warned = []
  await checkTypesDefinedTwice({ workspaceDir: differ, checkedDirs: null, issues: warned })
  assert.equal(warned[0].type, 'warn')

  // CONTROL — checked from a package that defines neither, it names none.
  const none = []
  await checkTypesDefinedTwice({ workspaceDir: agree, checkedDirs: [join(agree, 'elsewhere')], issues: none })
  assert.deepEqual(none, [])
})
