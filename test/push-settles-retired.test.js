/**
 * A push with nothing to send still settles an earlier push's retired records
 * (`settleRetiredRecords`, `src/utils/retired-records.js`).
 *
 * ⛔ Until 2026-11-10 it returned at "Nothing to push" first. So the line a push without a
 * terminal prints about them, "push again with --yes", did nothing unless something else had
 * changed (measured on the playground: the owner of a mounted record deleted its file, and its
 * `push --yes` said "Nothing to push" and left the record on the backend).
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmp, runVerb } from './helpers/run-verb.js'

const A = 'http://dev.test'
const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })

function loggedIn(deletes) {
  return {
    session: { version: 2, current: A, sessions: { [A]: { token: 't' } } },
    env: { UNIWEB_WORKSPACE: 'personal' },
    respond: (url, init) => {
      if (url.endsWith('/dev/config')) return json({})
      if (url.includes('/dev/site/content'))
        return json({ siteContentUuid: 'SITE-1', report: { finalized: [{ index: 0, uuid: 'SITE-1', changed: true, version: 'V1' }] } })
      if (url.endsWith('/dev/entities/delete')) {
        const body = JSON.parse(init.body)
        deletes.push(body)
        return json({ deleted: body.uuids, kept: [] })
      }
    }
  }
}

const backendState = (site) => JSON.parse(readFileSync(join(site, 'sync.json'), 'utf8')).backends[A]

test('⭐ push --yes with nothing to send deletes the records an earlier push retired', { timeout: 60_000 }, async () => {
  const { push } = await import('../src/commands/push.js')
  const site = join(tmp('uw-settle-'), 'site')
  mkdirSync(join(site, 'pages', 'home'), { recursive: true })
  writeFileSync(join(site, 'site.yml'), "name: T\nfoundation: '@a/base@1.0.0'\n")
  writeFileSync(join(site, 'package.json'), JSON.stringify({ name: 't', dependencies: { uniweb: '*' } }))
  writeFileSync(join(site, 'pages', 'home', 'hero.md'), '# Hello\n')
  const deletes = []
  const first = await runVerb(site, push, [], loggedIn(deletes))
  assert.equal(first.exitCode, 0, first.output)

  // What an earlier push banked when it took a record out of the folder, its file deleted.
  const store = JSON.parse(readFileSync(join(site, 'sync.json'), 'utf8'))
  store.backends[A].retired = { R1: '@acme/member' }
  writeFileSync(join(site, 'sync.json'), JSON.stringify(store, null, 2))

  const res = await runVerb(site, push, ['--yes'], loggedIn(deletes))
  assert.equal(res.exitCode, 0, res.output)
  assert.match(res.output, /Nothing to push/)
  assert.deepEqual(deletes, [{ uuids: ['R1'], placed: 'keep' }])
  assert.match(res.output, /Deleted 1 record from the backend/)
  assert.equal(backendState(site).retired, undefined)
})
