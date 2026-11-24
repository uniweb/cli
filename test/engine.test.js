/**
 * `uniweb engine get | update` — the Application Engine's files, from the backend you are
 * logged in to, written and never run.
 *
 * The backend's half: `GET /dev/engine?arch=` answers `{ version, files: [{ path, size, sha256,
 * url }] }`, or `403` with `reason` (`engine_not_invited`, `engine_licence_not_accepted` with
 * `accept_url`), or `404` where no engine is offered. Each `url` answers a range with `206`. These
 * tests answer as the backend says it does and check what the CLI writes, keeps and says.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { runVerb, tmp } from './helpers/run-verb.js'
import { placeIn } from '../src/commands/engine.js'

const ORIGIN = 'http://backend.test'
const ENV = { UNIWEB_SERVER: ORIGIN, UNIWEB_TOKEN: 'TKN' }
const sha = (b) => createHash('sha256').update(b).digest('hex')

const FILES = {
  'compose.yaml': Buffer.from('services: {}\n'),
  'AGENTS.md': Buffer.from('# Start the engine\n'),
  [`images-${process.arch}.tar.gz`]: Buffer.alloc(4096, 7)
}

/** A backend that serves FILES, with `version`; `refuse` answers the listing instead. */
function engineBackend({ files = FILES, refuse, expireOnce = false, corrupt = null } = {}) {
  const seen = []
  let listings = 0
  const respond = async (url, init = {}) => {
    const u = new URL(url)
    seen.push({ path: u.pathname, query: Object.fromEntries(u.searchParams), range: init.headers?.Range ?? null })
    if (u.pathname === '/dev/engine') {
      listings++
      if (refuse) return refuse()
      return Response.json({
        version: '2026.11.24',
        files: Object.entries(files).map(([path, b]) => ({ path, size: b.length, sha256: sha(b), url: `${ORIGIN}/file/${encodeURIComponent(path)}?n=${listings}` }))
      })
    }
    if (u.pathname.startsWith('/file/')) {
      const path = decodeURIComponent(u.pathname.slice('/file/'.length))
      if (expireOnce && u.searchParams.get('n') === '1') return new Response('expired', { status: 403 })
      let bytes = files[path]
      if (corrupt === path) bytes = Buffer.from(bytes).fill(0)
      const range = /^bytes=(\d+)-$/.exec(init.headers?.Range ?? '')
      if (range) return new Response(bytes.subarray(Number(range[1])), { status: 206 })
      return new Response(bytes, { status: 200 })
    }
    return undefined
  }
  return { respond, seen, downloads: () => seen.filter((r) => r.path.startsWith('/file/')) }
}

async function run(args, backend, dir = tmp('uw-engine-')) {
  const { engine } = await import('../src/commands/engine.js')
  const res = await runVerb(dir, engine, args, { env: ENV, respond: backend.respond })
  return { ...res, dir }
}

test('get writes every listed file into the directory, asking for this machine\'s arch', async () => {
  const backend = engineBackend()
  const { exitCode, output, dir } = await run(['get', 'eng'], backend)
  assert.equal(exitCode, 0, output)
  for (const [path, bytes] of Object.entries(FILES)) {
    assert.deepEqual(readFileSync(join(dir, 'eng', path)), bytes)
  }
  assert.equal(backend.seen[0].query.arch, process.arch)
  assert.match(output, /Wrote 3 files/)
  assert.match(output, /Next: follow eng\/AGENTS\.md/)
  assert.ok(!existsSync(join(dir, 'eng', 'AGENTS.md.part')))
})

test('a second run downloads nothing: what matches its size and SHA-256 is kept', async () => {
  const backend = engineBackend()
  const dir = tmp('uw-engine-')
  await run(['get', 'eng'], backend, dir)
  const before = backend.downloads().length
  const { exitCode, output } = await run(['update', 'eng'], backend, dir)
  assert.equal(exitCode, 0, output)
  assert.equal(backend.downloads().length, before)
  assert.match(output, /up to date \(2026\.11\.24\)/)
})

test('update replaces only the file whose SHA-256 changed, and leaves unlisted files alone', async () => {
  const dir = tmp('uw-engine-')
  await run(['get', 'eng'], engineBackend(), dir)
  writeFileSync(join(dir, 'eng', '.env'), 'MINE=1\n')
  const changed = { ...FILES, 'compose.yaml': Buffer.from('services: { a: {} }\n') }
  const backend = engineBackend({ files: changed })
  const { exitCode, output } = await run(['update', 'eng'], backend, dir)
  assert.equal(exitCode, 0, output)
  assert.deepEqual(backend.downloads().map((d) => d.path), ['/file/compose.yaml'])
  assert.deepEqual(readFileSync(join(dir, 'eng', 'compose.yaml')), changed['compose.yaml'])
  assert.equal(readFileSync(join(dir, 'eng', '.env'), 'utf8'), 'MINE=1\n')
  assert.match(output, /Wrote 1 file to eng, kept 2 unchanged/)
})

test('an interrupted download carries on from where it stopped, by range', async () => {
  const dir = tmp('uw-engine-')
  const big = `images-${process.arch}.tar.gz`
  mkdirSync(join(dir, 'eng'), { recursive: true })
  writeFileSync(join(dir, 'eng', `${big}.part`), FILES[big].subarray(0, 1000))
  const backend = engineBackend()
  const { exitCode, output } = await run(['get', 'eng'], backend, dir)
  assert.equal(exitCode, 0, output)
  assert.equal(backend.downloads().find((d) => d.path.endsWith(big)).range, 'bytes=1000-')
  assert.deepEqual(readFileSync(join(dir, 'eng', big)), FILES[big])
})

test('a file that does not match its SHA-256 is never kept', async () => {
  const backend = engineBackend({ corrupt: 'compose.yaml' })
  const { exitCode, output, dir } = await run(['get', 'eng'], backend)
  assert.equal(exitCode, 1)
  assert.match(output, /compose\.yaml did not match the size and SHA-256/)
  assert.ok(!existsSync(join(dir, 'eng', 'compose.yaml')))
  assert.ok(!existsSync(join(dir, 'eng', 'compose.yaml.part')))
})

test('an expired address is asked for again, once', async () => {
  const backend = engineBackend({ expireOnce: true })
  const { exitCode, output } = await run(['get', 'eng'], backend)
  assert.equal(exitCode, 0, output)
  assert.equal(backend.seen.filter((r) => r.path === '/dev/engine').length, 2)
})

test('a path that leaves the directory is refused before anything is written', async () => {
  const backend = engineBackend({ files: { 'AGENTS.md': FILES['AGENTS.md'], '../outside.txt': Buffer.from('x') } })
  const { exitCode, output, dir } = await run(['get', 'eng'], backend)
  assert.equal(exitCode, 1)
  assert.match(output, /outside the directory, refused: "\.\.\/outside\.txt"/)
  assert.equal(backend.downloads().length, 0)
  assert.ok(!existsSync(join(dir, 'outside.txt')))
})

test('placeIn: only a relative, `/`-separated path inside the directory', () => {
  const dir = '/tmp/eng'
  assert.equal(placeIn(dir, 'a/b.txt'), '/tmp/eng/a/b.txt')
  for (const bad of ['/etc/passwd', '../x', 'a/../../x', 'a//b', './a', 'a\\b', '', null, 'a/..']) {
    assert.equal(placeIn(dir, bad), null, String(bad))
  }
})

test('a licence not yet accepted is shown as sent, with where to accept it', async () => {
  const backend = engineBackend({
    refuse: () => Response.json({ status: 403, reason: 'engine_licence_not_accepted', detail: 'Accept the engine licence (version 1) first.', accept_url: 'http://app.test/engine' }, { status: 403 })
  })
  const { exitCode, output, dir } = await run(['get', 'eng'], backend)
  assert.equal(exitCode, 1)
  assert.match(output, /Accept the engine licence \(version 1\) first\./)
  assert.match(output, /Accept it here, then run this command again: http:\/\/app\.test\/engine/)
  assert.ok(!existsSync(join(dir, 'eng')))
})

test('an account not invited yet is told so; a backend with no engine says it offers none', async () => {
  let r = await run(['get'], engineBackend({ refuse: () => Response.json({ reason: 'engine_not_invited', detail: 'Your account has not been invited to the engine yet.' }, { status: 403 }) }))
  assert.equal(r.exitCode, 1)
  assert.match(r.output, /not been invited/)
  r = await run(['get'], engineBackend({ refuse: () => new Response('', { status: 404 }) }))
  assert.equal(r.exitCode, 1)
  assert.match(r.output, /offers no engine/)
})

test('update in a directory with no engine says how to get one', async () => {
  const backend = engineBackend()
  const { exitCode, output } = await run(['update'], backend)
  assert.equal(exitCode, 2)
  assert.match(output, /holds no engine to update\. To download one: uniweb engine get/)
  assert.equal(backend.downloads().length, 0)
})

test('an unknown flag is refused', async () => {
  const { exitCode, output } = await run(['get', '--server', 'http://x'], engineBackend())
  assert.equal(exitCode, 2)
  assert.match(output, /--server/)
})

test('a download that stops says so, and the next run carries on from there', async () => {
  const big = `images-${process.arch}.tar.gz`
  let cut = true
  const backend = engineBackend()
  const respond = async (url, init) => {
    if (cut && url.includes(encodeURIComponent(big))) {
      cut = false
      const stream = new ReadableStream({
        start(ctrl) {
          ctrl.enqueue(FILES[big].subarray(0, 1500))
        },
        // The connection drops once the first part has been read and written.
        async pull(ctrl) {
          await new Promise((r) => setTimeout(r, 20))
          ctrl.error(new Error('terminated'))
        }
      })
      return new Response(stream, { status: 200 })
    }
    return backend.respond(url, init)
  }
  const dir = tmp('uw-engine-')
  const { engine } = await import('../src/commands/engine.js')
  let r = await runVerb(dir, engine, ['get', 'eng'], { env: ENV, respond })
  assert.equal(r.exitCode, 1)
  assert.match(r.output, /the download stopped \(terminated\)\. Run the command again/)
  r = await runVerb(dir, engine, ['get', 'eng'], { env: ENV, respond })
  assert.equal(r.exitCode, 0, r.output)
  assert.equal(backend.downloads().at(-1).range, 'bytes=1500-')
  assert.deepEqual(readFileSync(join(dir, 'eng', big)), FILES[big])
})
