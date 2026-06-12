/**
 * First-publish org choice (deriveScope) — the one-prompt-once flow with the
 * personal-handle org as the lazy default. prompts.inject drives the picker;
 * an injected global fetch fakes the orgs endpoints.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import prompts from 'prompts'
import { deriveScope, offerCreateOrg, validateHandle, bareHandle } from '../src/utils/registry-orgs.js'

const BASE = { apiBase: 'http://localhost:8080', token: 't' }

function fakeOrgs({ list = [], createdHandles = [] } = {}) {
  return async (url, opts = {}) => {
    if ((opts.method || 'GET') === 'GET') {
      return { ok: true, status: 200, json: async () => list }
    }
    const body = JSON.parse(opts.body)
    createdHandles.push(body.handle)
    return { ok: true, status: 200, json: async () => ({ handle: body.handle, is_primary: true }) }
  }
}

test('validateHandle: grammar + reserved scopes', () => {
  assert.equal(validateHandle('jane'), null)
  assert.equal(validateHandle('@acme-co'), null)
  assert.ok(validateHandle('ab')) // too short
  assert.ok(validateHandle('-bad-')) // leading/trailing hyphen
  assert.ok(validateHandle('std')) // reserved
  assert.equal(bareHandle('@jane/extra'), 'jane')
})

test('0 orgs + handle: the personal org is the one-keystroke default', async () => {
  // offerCreateOrg is the interactive 0-orgs flow (deriveScope routes here
  // when a TTY exists; under the test runner we drive it directly).
  const created = []
  const realFetch = globalThis.fetch
  globalThis.fetch = fakeOrgs({ list: [], createdHandles: created })
  try {
    prompts.inject(['jane']) // the pre-selected personal choice
    const scope = await offerCreateOrg({ ...BASE, accountHandle: 'jane' })
    assert.equal(scope, 'jane')
    assert.deepEqual(created, ['jane']) // lazily claimed at first publish
  } finally {
    globalThis.fetch = realFetch
  }
})

test('0 orgs + handle: "A new organization…" prompts for a handle', async () => {
  const created = []
  const realFetch = globalThis.fetch
  globalThis.fetch = fakeOrgs({ list: [], createdHandles: created })
  try {
    prompts.inject([':new', 'acme'])
    const scope = await offerCreateOrg({ ...BASE, accountHandle: 'jane' })
    assert.equal(scope, 'acme')
    assert.deepEqual(created, ['acme'])
  } finally {
    globalThis.fetch = realFetch
  }
})

test('0 orgs + NO handle: crisp pointer, no prompt, no create', async () => {
  const created = []
  const realFetch = globalThis.fetch
  globalThis.fetch = fakeOrgs({ list: [], createdHandles: created })
  const errs = []
  const realErr = console.error
  console.error = (m) => errs.push(String(m))
  try {
    const scope = await offerCreateOrg({ ...BASE, accountHandle: null })
    assert.equal(scope, null)
    assert.deepEqual(created, [])
    assert.ok(errs.join('\n').includes('no handle'), 'guides the user to claim a handle')
  } finally {
    globalThis.fetch = realFetch
    console.error = realErr
  }
})

test('1 org: non-interactive uses it directly', async () => {
  const realFetch = globalThis.fetch
  globalThis.fetch = fakeOrgs({ list: [{ handle: 'jane', is_primary: true }] })
  try {
    const scope = await deriveScope({ ...BASE, accountHandle: 'jane' })
    assert.equal(scope, 'jane')
  } finally {
    globalThis.fetch = realFetch
  }
})

test('N orgs non-interactive: the personal org wins over primary', async () => {
  const realFetch = globalThis.fetch
  globalThis.fetch = fakeOrgs({
    list: [
      { handle: 'acme', is_primary: true },
      { handle: 'jane', is_primary: false },
    ],
  })
  try {
    const scope = await deriveScope({ ...BASE, accountHandle: 'jane' })
    assert.equal(scope, 'jane')
  } finally {
    globalThis.fetch = realFetch
  }
})
