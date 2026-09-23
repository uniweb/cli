/**
 * The scope `register` derives from the login (deriveScope). ⭐ A scope is a namespace:
 * `@<account handle>` is the account's own and needs no org (2026-09-23), so a login
 * with no org registers there without a prompt — in CI too — and nothing creates an
 * org. prompts.inject drives the picker; an injected global fetch fakes the orgs
 * endpoints.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import prompts from 'prompts'
import {
  deriveScope,
  validateHandle,
  bareHandle,
  publishScope
} from '../src/utils/registry-orgs.js'
import { buildRegistryPackage } from '@uniweb/build/uwx'

const BASE = { apiBase: 'http://localhost:8080', token: 't' }

function fakeOrgs({
  list = [],
  accountHandle = 'jane',
  createdHandles = []
} = {}) {
  return async (url, opts = {}) => {
    if ((opts.method || 'GET') === 'GET') {
      return {
        ok: true,
        status: 200,
        json: async () => ({ account_handle: accountHandle, orgs: list })
      }
    }
    const body = JSON.parse(opts.body)
    createdHandles.push(body.handle)
    return {
      ok: true,
      status: 200,
      json: async () => ({ handle: body.handle, is_primary: true })
    }
  }
}

test("validateHandle: grammar only — reserved names are the server's call", () => {
  assert.equal(validateHandle('jane'), null)
  assert.equal(validateHandle('@acme-co'), null)
  assert.equal(validateHandle('a--b'), null) // consecutive hyphens allowed
  assert.ok(validateHandle('ab')) // too short
  assert.ok(validateHandle('-bad-')) // leading/trailing hyphen
  assert.equal(validateHandle('std'), null) // grammar-valid; server 409s reserved
  assert.equal(bareHandle('@jane/extra'), 'jane')
})

test('publishScope: every spelling of a scope becomes @org — the registry has one', () => {
  assert.equal(publishScope('@std'), '@std')
  assert.equal(publishScope('std'), '@std')
  assert.equal(publishScope('@std/'), '@std')
  assert.equal(publishScope('@std/src'), '@std')
  assert.equal(publishScope('@'), null)
  assert.equal(publishScope(''), null)
  assert.equal(publishScope(undefined), null)
})

test('publishScope agrees with the .uwx assembly on the name it registers', () => {
  // The `.uwx` names the foundation; register's code delivery and bring-along's
  // catalog lookup name it again from the same scope. Three namings, one answer.
  for (const scope of ['@std', 'std', '@std/']) {
    const doc = buildRegistryPackage({
      schema: { _self: { name: 'marketing', version: '0.1.0' } },
      scope
    })
    const registered = doc.entities.find(
      (e) => e.model === '@uniweb/foundation-schema'
    ).info.name
    assert.equal(registered, `${publishScope(scope)}/marketing`, `scope ${scope}`)
  }
})

/** Run `fn` with fetch faked and stderr captured; returns `{ result, errs }`. */
async function withOrgs(orgsOpts, fn) {
  const realFetch = globalThis.fetch
  const realErr = console.error
  const errs = []
  globalThis.fetch = fakeOrgs(orgsOpts)
  console.error = (m) => errs.push(String(m))
  try {
    return { result: await fn(), errs: errs.join('\n') }
  } finally {
    globalThis.fetch = realFetch
    console.error = realErr
  }
}

/** As an interactive terminal: a TTY, and no CI. */
async function atTerminal(fn) {
  const tty = process.stdin.isTTY
  const ci = process.env.CI
  process.stdin.isTTY = true
  delete process.env.CI
  try {
    return await fn()
  } finally {
    process.stdin.isTTY = tty
    if (ci === undefined) delete process.env.CI
    else process.env.CI = ci
  }
}

test('no org: your personal scope — no prompt, no org created, and in CI too', async () => {
  const created = []
  const { result, errs } = await withOrgs({ list: [], createdHandles: created }, () =>
    deriveScope({ ...BASE, args: ['--non-interactive'] })
  )
  assert.equal(result, 'jane')
  assert.deepEqual(created, [], 'a scope is a namespace: nothing creates an org')
  assert.match(errs, /personal scope/, 'said, not asked')
})

test('an org named after you — made before 2026-09-23 — is your personal scope, once', async () => {
  const { result } = await withOrgs({ list: [{ handle: 'jane', is_primary: true }] }, () =>
    deriveScope({ ...BASE, args: ['--non-interactive'] })
  )
  assert.equal(result, 'jane')
})

test('orgs, non-interactive: your personal scope, said — pass --scope for an org', async () => {
  const { result, errs } = await withOrgs(
    { list: [{ handle: 'acme', is_primary: true }] },
    () => deriveScope({ ...BASE, args: ['--non-interactive'] })
  )
  assert.equal(result, 'jane')
  assert.match(errs, /--scope @org/)
})

test('orgs, at a terminal: a pick — your personal scope first, then each org', async () => {
  const { result } = await withOrgs(
    { list: [{ handle: 'acme', is_primary: true }, { handle: 'beta', is_primary: false }] },
    () =>
      atTerminal(() => {
        prompts.inject(['acme'])
        return deriveScope({ ...BASE })
      })
  )
  assert.equal(result, 'acme')
})

test('no account handle (a service account): its one org; none is a pointer', async () => {
  const one = await withOrgs({ accountHandle: null, list: [{ handle: 'acme', is_primary: true }] }, () =>
    deriveScope({ ...BASE, args: ['--non-interactive'] })
  )
  assert.equal(one.result, 'acme')
  const none = await withOrgs({ accountHandle: null, list: [] }, () =>
    deriveScope({ ...BASE, args: ['--non-interactive'] })
  )
  assert.equal(none.result, null)
  assert.match(none.errs, /--scope @org/)
  const several = await withOrgs(
    { accountHandle: null, list: [{ handle: 'a-one', is_primary: true }, { handle: 'b-two', is_primary: false }] },
    () => deriveScope({ ...BASE, args: ['--non-interactive'] })
  )
  assert.equal(several.result, null, 'no personal scope to fall back to — refused in CI')
})

test('createOrg surfaces the server detail on 409 (three flavors, one status)', async () => {
  const realFetch = globalThis.fetch
  globalThis.fetch = async () => ({
    ok: false,
    status: 409,
    json: async () => ({
      status: 409,
      title: 'Conflict',
      detail: 'only its owner can create @jane'
    })
  })
  try {
    const { createOrg } = await import('../src/utils/registry-orgs.js')
    await assert.rejects(
      () => createOrg({ apiBase: 'http://x', token: 't', handle: 'jane' }),
      (e) => e.status === 409 && /only its owner/.test(e.message)
    )
  } finally {
    globalThis.fetch = realFetch
  }
})
