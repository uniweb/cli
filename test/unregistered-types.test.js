/**
 * A refused release says which local package to register first (`src/backend/unregistered-types.js`).
 * The registry refuses a foundation that names a type it does not hold. Measured 2026-11-10 on a
 * local backend: a push released a foundation naming `@acme/libplan`, which a library it bundles
 * defines, and the registry answered 400 until `uniweb register` ran in the library.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { unregisteredLocalTypes } from '../src/backend/unregistered-types.js'

function workspace() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'uw-unregistered-')))
  const files = {
    'pnpm-workspace.yaml': 'packages:\n  - foundations/*\n  - libraries/*\n',
    'package.json': JSON.stringify({ name: 'w', private: true }),
    'libraries/data/package.json': JSON.stringify({ name: 'data', uniweb: { scope: '@acme' } }),
    'libraries/data/schemas/plan.yml': 'name: plan\nfields:\n  title: { type: string }\n',
    'foundations/hub/package.json': JSON.stringify({ name: 'hub', main: './_entry.generated.js' }),
    'foundations/hub/main.js': "export default { name: '@acme/hub' }\n",
    'foundations/hub/schemas/member.yml': 'name: member\nfields:\n  name: { type: string }\n',
    'foundations/shop/package.json': JSON.stringify({ name: 'shop', main: './_entry.generated.js', dependencies: { data: 'file:../../libraries/data' } }),
    'foundations/shop/main.js': "export default { name: '@acme/shop' }\n",
    'foundations/shop/schemas/order.yml': 'name: order\nfields:\n  total: { type: number }\n'
  }
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true })
    writeFileSync(join(root, rel), body)
  }
  return root
}

const registry = (held) => ({ readDataSchema: async (name) => (held.includes(name) ? { name } : null) })

test('⭐ a type a library defines and the registry lacks: register it in the library', async () => {
  const root = workspace()
  try {
    const missing = await unregisteredLocalTypes({
      named: ['@acme/plan', '@acme/member', '@acme/order', '@std/person', '@acme/gone'],
      defined: ['@acme/order'],
      foundationDir: join(root, 'foundations/shop'),
      client: registry(['@acme/member'])
    })
    assert.deepEqual(missing, [{ ref: '@acme/plan', dir: join(root, 'libraries/data') }])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('another foundation of the workspace that defines it registers it too', async () => {
  const root = workspace()
  try {
    const missing = await unregisteredLocalTypes({
      named: ['@acme/member'],
      defined: [],
      foundationDir: join(root, 'foundations/shop'),
      client: registry([])
    })
    assert.deepEqual(missing, [{ ref: '@acme/member', dir: join(root, 'foundations/hub') }])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('CONTROL: a registry it could not ask says nothing', async () => {
  const root = workspace()
  try {
    const missing = await unregisteredLocalTypes({
      named: ['@acme/plan'],
      defined: [],
      foundationDir: join(root, 'foundations/shop'),
      client: { readDataSchema: async () => { throw new Error('HTTP 500') } }
    })
    assert.deepEqual(missing, [])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
