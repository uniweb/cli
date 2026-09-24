// ⭐ A push goes again while records wait for a reference's record (`pkg.waiting`): each
// pass, emitted afresh, sends what the last one made nameable. It stops when nothing waits
// — or when a pass changes nothing, because what waits waits on itself (two records that
// each require the other), naming them.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pushInPasses } from '../src/backend/site-sync.js'

const waiter = (id, name) => ({ id, model: '@acme/talk', slug: id, held: true, pending: [{ path: 'speaker', model: '@acme/speaker', name, required: true }] })

function harness(emits, { failOnPass = 0 } = {}) {
  const said = { note: [], error: [] }
  const sent = []
  const report = { note: (m) => said.note.push(m), error: (m) => said.error.push(m), info: () => {} }
  let i = 0
  return {
    said,
    sent,
    run: (first) =>
      pushInPasses({
        client: {},
        siteDir: '/nowhere',
        pkg: first,
        report,
        reemit: async () => emits[i++],
        push: async ({ pkg }) => {
          sent.push(pkg)
          if (sent.length === failOnPass) return { exitCode: 1, finalizedTotal: 0, wrote: [] }
          return { exitCode: 0, finalizedTotal: pkg.n || 0, wrote: pkg.wrote || [] }
        },
      }),
  }
}

test('nothing waits — one pass', async () => {
  const h = harness([])
  const result = await h.run({ n: 3, waiting: [] })
  assert.equal(result.exitCode, 0)
  assert.equal(result.passes, 1)
  assert.equal(h.sent.length, 1)
})

test('a chain completes one link per pass, and the counts add up', async () => {
  const h = harness([{ n: 1, waiting: [waiter('a', 'b')] }, { n: 1, waiting: [] }])
  const result = await h.run({ n: 2, waiting: [waiter('a', 'b'), waiter('b', 'c')], wrote: ['wrote 2 record file(s)'] })
  assert.equal(result.exitCode, 0)
  assert.equal(result.passes, 3)
  assert.equal(result.finalizedTotal, 4)
  assert.deepEqual(result.wrote, ['wrote 2 record file(s)'])
  assert.match(h.said.note[0], /2 records name a record this push created — pushing again/)
})

test('⛔ records that wait on each other stop the push, named', async () => {
  const stuck = [waiter('a', 'b'), waiter('b', 'a')]
  const h = harness([{ n: 0, waiting: stuck }])
  const result = await h.run({ n: 1, waiting: stuck })
  assert.equal(result.exitCode, 1)
  assert.equal(h.sent.length, 1) // the pass that changed nothing is not sent
  assert.match(h.said.error[0], /could not be completed/)
  assert.ok(h.said.note.some((m) => /a \(@acme\/talk\): speaker → "b"/.test(m)))
})

test('a failed pass ends it — no further pass is emitted', async () => {
  const h = harness([{ n: 1, waiting: [] }], { failOnPass: 1 })
  const result = await h.run({ n: 1, waiting: [waiter('a', 'b')] })
  assert.equal(result.exitCode, 1)
  assert.equal(h.sent.length, 1)
})

test('a later pass that refuses a record stops before sending it', async () => {
  const h = harness([{ n: 1, waiting: [], refusals: ['talk/a: "speaker" names "x", and no record of @acme/speaker is called that'] }])
  const result = await h.run({ n: 1, waiting: [waiter('a', 'b')] })
  assert.equal(result.exitCode, 1)
  assert.equal(h.sent.length, 1)
})
