/**
 * A command's output reaches a pipe whole before the CLI exits (`utils/exit.js`).
 *
 * `process.exit()` drops what a pipe has not taken yet — on macOS, where Node writes to a
 * pipe asynchronously. The reader it bites is a script, `| jq`, or an agent capturing the
 * output: `uniweb site list --json` reached one as half a JSON document (2026-10-07).
 *
 * Run: `pnpm test` or `node --test test/`
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const EXIT = pathToFileURL(join(here, '..', 'src', 'utils', 'exit.js')).href
const SIZE = 200000

/** A child that writes SIZE bytes to stdout and to stderr, then leaves by `leave`. */
function writeThenExit(leave) {
  const r = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `import { exitWhenDrained } from ${JSON.stringify(EXIT)}
       process.stdout.write('o'.repeat(${SIZE}))
       process.stderr.write('e'.repeat(${SIZE}))
       ${leave}`
    ],
    { encoding: 'utf8', maxBuffer: 4 * SIZE }
  )
  return { status: r.status, out: r.stdout.length, err: r.stderr.length }
}

test('⭐ everything written reaches the pipe before the exit — stdout and stderr — and the code is kept', () => {
  assert.deepEqual(writeThenExit('await exitWhenDrained(3)'), { status: 3, out: SIZE, err: SIZE })
})

test(
  'CONTROL — a bare process.exit() drops what the pipe had not taken (macOS, where pipe writes are asynchronous)',
  { skip: process.platform !== 'darwin' && 'pipe writes are synchronous on this platform' },
  () => {
    const r = writeThenExit('process.exit(3)')
    assert.equal(r.status, 3)
    assert.ok(r.out < SIZE, `the control delivered all ${SIZE} bytes — it no longer shows the defect`)
  }
)

test('every exit in index.js goes through exitWhenDrained — a new command gets it by construction', () => {
  const src = readFileSync(join(here, '..', 'src', 'index.js'), 'utf8')
  // ⚖️ One kind is exempt, and says so on its line: a prompt's onCancel. A prompt runs on a
  // terminal, whose writes are synchronous — nothing to drain — and an exit deferred there would
  // let the command run on past the cancel.
  const bare = src
    .split('\n')
    .flatMap((line, i) => (/process\.exit\(/.test(line) && !/a prompt: a terminal, so nothing to drain/.test(line) ? [`${i + 1}: ${line.trim()}`] : []))
  assert.deepEqual(bare, [], `index.js calls process.exit() directly:\n${bare.join('\n')}`)
})
