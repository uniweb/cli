/**
 * `uniweb forget --backend <url>` — removes one backend's local records, nothing else.
 *
 * The headline is the ISOLATION: a project synced with two backends forgets one and
 * keeps the other whole. Then the two things it must never touch — record files, and
 * any backend it was not told to forget — and the script-friendly edges: idempotent,
 * and refusing without a named target.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { forget } from '../src/commands/forget.js'

const A = 'http://dev.test'
const B = 'https://uniweb.app'
const dirs = []
process.on('exit', () => {
  for (const d of dirs) {
    try {
      rmSync(d, { recursive: true, force: true })
    } catch {
      /* best effort */
    }
  }
})

/** A site synced with both backends, with a record file and a cache for each. */
function project() {
  const dir = mkdtempSync(join(tmpdir(), 'uw-forget-'))
  dirs.push(dir)
  writeFileSync(join(dir, 'site.yml'), "name: T\nfoundation: '@a/base'\n")
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 't', dependencies: { uniweb: '*' } }))
  mkdirSync(join(dir, 'entities', 'post'), { recursive: true })
  writeFileSync(join(dir, 'entities', 'post', 'hello.md'), '---\n$uuid: OWN-1\ntitle: Hi\n---\nBody\n')
  writeFileSync(
    join(dir, 'sync.json'),
    JSON.stringify({
      version: 1,
      backends: {
        [A]: { site: { uuid: 'SITE-DEV' }, records: { 'OWN-1': 'DEV-1' } },
        [B]: { site: { uuid: 'SITE-PROD' }, records: { 'OWN-1': 'OWN-1' } }
      }
    })
  )
  mkdirSync(join(dir, '.uniweb'), { recursive: true })
  writeFileSync(
    join(dir, '.uniweb', 'backend-cache.json'),
    JSON.stringify({ version: 1, backends: { [A]: { hashes: { x: 'h' } }, [B]: { hashes: { y: 'h' } } } })
  )
  return dir
}

const syncOf = (dir) => JSON.parse(readFileSync(join(dir, 'sync.json'), 'utf8')).backends
const cacheOf = (dir) =>
  JSON.parse(readFileSync(join(dir, '.uniweb', 'backend-cache.json'), 'utf8')).backends

/** Run the verb from inside `dir`, quietly. */
async function run(dir, args) {
  const cwd = process.cwd()
  const log = console.log
  const err = console.error
  console.log = () => {}
  console.error = () => {}
  try {
    process.chdir(dir)
    return await forget(args)
  } finally {
    process.chdir(cwd)
    console.log = log
    console.error = err
  }
}

test('⭐ forgets ONE backend and leaves the other whole', async () => {
  const dir = project()
  const res = await run(dir, ['--backend', A])

  assert.equal(res.exitCode, 0)
  assert.deepEqual(res.removed.sort(), ['.uniweb/backend-cache.json', 'sync.json'])

  assert.equal(syncOf(dir)[A], undefined, 'the forgotten backend is gone from sync.json')
  assert.equal(cacheOf(dir)[A], undefined, 'and from the cache')
  assert.deepEqual(syncOf(dir)[B].site, { uuid: 'SITE-PROD' }, 'the other backend is untouched')
  assert.deepEqual(cacheOf(dir)[B], { hashes: { y: 'h' } })
})

test('⛔ never touches a record file — its $uuid is the record\'s own id', async () => {
  const dir = project()
  const record = join(dir, 'entities', 'post', 'hello.md')
  const before = readFileSync(record, 'utf8')

  await run(dir, ['--backend', A])

  assert.equal(readFileSync(record, 'utf8'), before)
})

test('a full URL forgets the backend it belongs to', async () => {
  const dir = project()
  await run(dir, ['--backend', `${A}/dev/site/abc`])
  assert.equal(syncOf(dir)[A], undefined)
})

test('idempotent — a second call, or an unknown backend, is not an error', async () => {
  const dir = project()
  await run(dir, ['--backend', A])
  const again = await run(dir, ['--backend', A])
  assert.equal(again.exitCode, 0)
  assert.deepEqual(again.removed, [])

  const never = await run(dir, ['--backend', 'http://never.test'])
  assert.equal(never.exitCode, 0)
  assert.deepEqual(never.removed, [])
  assert.ok(syncOf(dir)[B], 'forgetting an unknown backend must not disturb a known one')
})

test('⛔ refuses without --backend — forgetting the wrong one duplicates a site', async () => {
  const dir = project()
  const res = await run(dir, [])
  assert.equal(res.exitCode, 2)
  assert.ok(syncOf(dir)[A] && syncOf(dir)[B], 'nothing removed')
})

test('refuses a value that is not a URL rather than guessing', async () => {
  const dir = project()
  const res = await run(dir, ['--backend', 'not a url'])
  assert.equal(res.exitCode, 2)
  assert.ok(syncOf(dir)[A])
})

test('works when the project has no cache file at all', async () => {
  const dir = project()
  rmSync(join(dir, '.uniweb'), { recursive: true, force: true })
  const res = await run(dir, ['--backend', A])
  assert.equal(res.exitCode, 0)
  assert.deepEqual(res.removed, ['sync.json'])
  assert.ok(!existsSync(join(dir, '.uniweb', 'backend-cache.json')))
})
