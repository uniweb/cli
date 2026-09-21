/**
 * `uniweb forget` — `--backend <url>` removes one backend's local records, nothing
 * else; `--all` removes everything a copied project inherited.
 *
 * The headline is the ISOLATION: a project synced with two backends forgets one and
 * keeps the other whole. Then the two things it must never touch — record files, and
 * any backend it was not told to forget — and the script-friendly edges: idempotent,
 * and refusing without a named target. Last, `--all`, whose job is turning a copy
 * into a new project: every file naming the original's sites and destinations goes.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { forget } from '../src/commands/forget.js'
import { syncedBackends, readSiteIdentity } from '../src/utils/site-identity.js'

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

// ─── deploy.yml ───────────────────────────────────────────────────────────────

/** Targets on both backends and a static host, each with its last deploy. */
function withDeployYml(dir) {
  writeFileSync(
    join(dir, 'deploy.yml'),
    [
      '# kept comment',
      'default: production',
      'targets:',
      '  production:',
      '    host: uniweb',
      `    backend: ${B}`,
      '  staging:',
      '    host: uniweb',
      `    backend: ${A}`,
      '  pages:',
      '    host: cloudflare-pages',
      '    project: acme',
      'deploys:',
      '  production:',
      `    backend: ${B}`,
      '    siteUuid: SITE-PROD',
      '  staging:',
      `    backend: ${A}`,
      '    siteUuid: SITE-DEV',
      '  pages:',
      '    url: https://acme.pages.dev',
      ''
    ].join('\n')
  )
  return dir
}
const deployText = (dir) => readFileSync(join(dir, 'deploy.yml'), 'utf8')

test('--backend drops that backend\'s deploy record and keeps every target', async () => {
  const dir = withDeployYml(project())
  const res = await run(dir, ['--backend', A])

  assert.equal(res.exitCode, 0)
  assert.ok(res.removed.includes('deploy.yml'))
  const text = deployText(dir)
  assert.doesNotMatch(text, /SITE-DEV/, 'the forgotten site\'s record is gone')
  assert.match(text, /SITE-PROD/, 'the other backend\'s record stays')
  assert.match(text, /acme\.pages\.dev/, 'a static host\'s record stays')
  assert.match(text, /staging:\n\s+host: uniweb/, 'the target itself stays')
  assert.match(text, /# kept comment/)
})

// ─── --all: a copy becomes a new project ──────────────────────────────────────

test('⭐ --all removes everything that names the original\'s sites and destinations', async () => {
  const dir = withDeployYml(project())
  const record = join(dir, 'entities', 'post', 'hello.md')
  const recordBefore = readFileSync(record, 'utf8')
  const siteYmlBefore = readFileSync(join(dir, 'site.yml'), 'utf8')

  const res = await run(dir, ['--all'])

  assert.equal(res.exitCode, 0)
  assert.deepEqual(res.forgot, [A, B].sort())
  assert.deepEqual(res.removed.sort(), ['.uniweb/backend-cache.json', 'deploy.yml', 'sync.json'])
  for (const f of ['sync.json', 'deploy.yml', join('.uniweb', 'backend-cache.json')]) {
    assert.ok(!existsSync(join(dir, f)), `${f} is gone`)
  }
  // What a push reads: no identity on either backend, so each push creates a site.
  assert.deepEqual(syncedBackends(dir), [])
  assert.equal(readSiteIdentity(dir, A).uuid, null)
  assert.equal(readSiteIdentity(dir, B).uuid, null)
  // And what is authored stays exactly as it was.
  assert.equal(readFileSync(record, 'utf8'), recordBefore, 'record files keep their own ids')
  assert.equal(readFileSync(join(dir, 'site.yml'), 'utf8'), siteYmlBefore)
})

test('--all is idempotent', async () => {
  const dir = project()
  await run(dir, ['--all'])
  const again = await run(dir, ['--all'])
  assert.equal(again.exitCode, 0)
  assert.deepEqual(again.removed, [])
})

test('--all clears a deploy-only project too — a copy must not ship to the original\'s host', async () => {
  const dir = project()
  rmSync(join(dir, 'sync.json'))
  rmSync(join(dir, '.uniweb'), { recursive: true, force: true })
  writeFileSync(join(dir, 'deploy.yml'), 'default: pages\ntargets:\n  pages:\n    host: cloudflare-pages\n    project: acme\n')

  const res = await run(dir, ['--all'])
  assert.equal(res.exitCode, 0)
  assert.deepEqual(res.removed, ['deploy.yml'])
  assert.ok(!existsSync(join(dir, 'deploy.yml')))
})

test('⛔ --all and --backend together is refused, and removes nothing', async () => {
  const dir = withDeployYml(project())
  const res = await run(dir, ['--all', '--backend', A])
  assert.equal(res.exitCode, 2)
  assert.ok(syncOf(dir)[A] && syncOf(dir)[B])
  assert.match(deployText(dir), /SITE-DEV/)
})
