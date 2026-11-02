/**
 * A reader that goes away stops the output, never the work (`utils/closed-reader.js`).
 *
 * ⛔ Only a real pipe shows this, and only what the process did afterwards tells: its exit code and
 * what is on disk. So each test spawns a process and closes the read end after the first thing it
 * says, as `| head -1` does.
 *
 * Run: `pnpm test` or `node --test test/`
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const CLI = join(here, '..', 'src', 'index.js')
const READER = pathToFileURL(join(here, '..', 'src', 'utils', 'closed-reader.js')).href
const work = mkdtempSync(join(tmpdir(), 'uw-closed-reader-'))
test.after(() => rmSync(work, { recursive: true, force: true }))

/** Run a process, closing its stdout after the first thing it says. */
function whileTheReaderLeaves(args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: work, stdio: ['ignore', 'pipe', 'pipe'], ...options })
    let stderr = ''
    child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk })
    child.stdout.once('data', () => child.stdout.destroy())
    child.on('error', reject)
    child.on('close', (status) => resolve({ status, stderr }))
  })
}

/** A process that says one thing, then does `body`. */
const driver = (body) => [
  '--input-type=module',
  '-e',
  `import { outliveTheReader, runRelayed } from ${JSON.stringify(READER)}
   import { spawn } from 'node:child_process'
   outliveTheReader()
   console.log('first')
   await new Promise((r) => setTimeout(r, 20))
   ${body}`
]

/** Prints a line every 2 ms for a while, then writes the file it is given: work with an end to it. */
const WORKER = `const lines = setInterval(() => console.log('still working'), 2)
setTimeout(() => { clearInterval(lines); require('node:fs').writeFileSync(process.argv[1], 'done') }, 120)`

const filesIn = (dir) => readdirSync(join(work, dir), { recursive: true }).sort()

test('`create` still makes the whole project, and exits 0', async () => {
  const args = ['--template', 'starter', '--no-git']
  const stayed = spawnSync(process.execPath, [CLI, 'create', 'stayed', ...args], { cwd: work, stdio: 'ignore' })
  assert.equal(stayed.status, 0)
  const left = await whileTheReaderLeaves([CLI, 'create', 'left', ...args])
  assert.equal(left.stderr, '')
  assert.equal(left.status, 0)
  assert.deepEqual(filesIn('left'), filesIn('stayed'))
})

test('`create` still fails when the work fails', async () => {
  mkdirSync(join(work, 'taken'))
  const r = await whileTheReaderLeaves([CLI, 'create', 'taken', '--template', 'starter', '--no-git'])
  assert.equal(r.status, 1)
  assert.deepEqual(filesIn('taken'), [])
})

test('a relayed child finishes its work, and its exit code comes back', async () => {
  const done = join(work, 'relayed-done')
  const r = await whileTheReaderLeaves(driver(`
    process.exit(await runRelayed(process.execPath, ['-e', ${JSON.stringify(WORKER)}, ${JSON.stringify(done)}]))
  `))
  assert.equal(r.stderr, '')
  assert.equal(r.status, 0)
  assert.equal(existsSync(done), true)
})

test('a relayed child that fails still fails', async () => {
  const r = await whileTheReaderLeaves(driver(`
    process.exit(await runRelayed(process.execPath, ['-e', 'console.log("x"); process.exit(4)']))
  `))
  assert.equal(r.status, 4)
})

test('CONTROL — handed our output directly, the same child dies of the closed pipe, its work undone', async () => {
  const done = join(work, 'inherited-done')
  const r = await whileTheReaderLeaves(driver(`
    const child = spawn(process.execPath, ['-e', ${JSON.stringify(WORKER)}, ${JSON.stringify(done)}], { stdio: 'inherit' })
    child.on('close', (code) => process.exit(code))
  `))
  assert.notEqual(r.status, 0, 'the control finished — it no longer shows why runRelayed exists')
  assert.equal(existsSync(done), false)
})

test('a slow reader gets all of a relayed child\'s output, on both streams, up to the exit', async () => {
  const SIZE = 1000000
  const child = spawn(
    process.execPath,
    driver(`
      const code = await runRelayed(process.execPath, ['-e', ${JSON.stringify(
        `process.stdout.write('o'.repeat(${SIZE})); process.stderr.write('e'.repeat(${SIZE})); process.exitCode = 3`
      )}])
      process.exit(code)
    `),
    { stdio: ['ignore', 'pipe', 'pipe'] }
  )
  const closed = new Promise((resolve) => child.on('close', resolve))
  // Nothing reads until the child has finished, so what it said is still queued in the driver.
  await new Promise((resolve) => setTimeout(resolve, 400))
  let out = 0
  let err = 0
  child.stdout.on('data', (chunk) => { out += chunk.length })
  child.stderr.on('data', (chunk) => { err += chunk.length })
  assert.deepEqual({ status: await closed, out, err }, { status: 3, out: SIZE + 'first\n'.length, err: SIZE })
})

test('a write error that is not a closed reader stays an error', () => {
  const r = spawnSync(
    process.execPath,
    driver(`process.stdout.emit('error', Object.assign(new Error('the disk is full'), { code: 'ENOSPC' }))`),
    { encoding: 'utf8' }
  )
  assert.equal(r.status, 1)
  assert.match(r.stderr, /the disk is full/)
})
