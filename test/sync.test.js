/**
 * uniweb sync — refresh followed by push.
 *
 * It adds no safety of its own; both halves already carry it. So what is worth
 * pinning is the composition: that it stops when the first half says stop, that it
 * never reimplements either half, and that `--force` reaches only the half it means
 * something for.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { sync } from '../src/commands/sync.js'

test('sync does NOT push when refresh reports conflicts', async () => {
  // Pushing after an unresolved merge puts conflict markers into content that
  // authors see. This is the whole reason the composite is allowed to exist.
  let pushed = false
  const res = await sync([], {
    refresh: async () => ({ exitCode: 1 }),
    push: async () => {
      pushed = true
      return { exitCode: 0 }
    }
  })
  assert.equal(res.exitCode, 1)
  assert.equal(pushed, false)
})

test('sync pushes when refresh is clean, and returns the push result', async () => {
  let pushed = false
  const res = await sync([], {
    refresh: async () => ({ exitCode: 0 }),
    push: async () => {
      pushed = true
      return { exitCode: 0 }
    }
  })
  assert.equal(pushed, true)
  assert.equal(res.exitCode, 0)

  // A failing push is the command's failure — not swallowed by a clean refresh.
  const res2 = await sync([], {
    refresh: async () => ({ exitCode: 0 }),
    push: async () => ({ exitCode: 1 })
  })
  assert.equal(res2.exitCode, 1)
})

test('sync keeps --force away from the refresh half', async () => {
  // `--force` means "overwrite upstream" to push, but to pull it means "discard my
  // local work" — the very work this command exists to send. Same word, opposite
  // effects on the two halves.
  let refreshArgs = null
  let pushArgs = null
  await sync(['--force', '--backend', 'http://x'], {
    refresh: async (a) => {
      refreshArgs = a
      return { exitCode: 0 }
    },
    push: async (a) => {
      pushArgs = a
      return { exitCode: 0 }
    }
  })
  assert.ok(!refreshArgs.includes('--force'))
  assert.ok(refreshArgs.includes('--backend'))
  assert.ok(pushArgs.includes('--force'))
})

test('sync reimplements neither half', () => {
  // The deploy/publish lesson: two paths doing nearly the same thing drift until
  // one is quietly wrong. This one must stay a composition.
  const src = readFileSync(
    new URL('../src/commands/sync.js', import.meta.url),
    'utf8'
  )
  assert.ok(
    !/pushSyncPackages|emitSyncPackages|siteContentDocumentToProject|pullRemote/.test(
      src
    )
  )
  assert.match(src, /await import\('\.\/refresh\.js'\)/)
  assert.match(src, /await import\('\.\/push\.js'\)/)
})
