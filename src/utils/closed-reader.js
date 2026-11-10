/**
 * A reader that goes away stops the output, never the work.
 *
 * ⛔ An agent trims what it reads, and `uniweb create x | head -20` closes the pipe after twenty
 * lines. The next line raised EPIPE, which nothing handled, so the process ended there: 14 of the
 * project's 27 files, and the same command again said the directory exists. `uniweb build | head -5`
 * left no site. Merged with `2>&1` the stack trace went into the closed pipe too, so what came back
 * was healthy lines and head's exit status, 0 (measured 2026-11-01).
 *
 * ⭐ So a process nobody is reading keeps going, and exits with what the work came to.
 */

import { spawn } from 'node:child_process'
import { fstatSync } from 'node:fs'
import { whenDrained } from './exit.js'

// What a write says when its reader has gone: EPIPE from a pipe, and from a socket also ENOTCONN or
// ECONNRESET. ⛔ Until 2026-11-10 only EPIPE was taken for it, and a reader leaving a socket at the
// wrong moment ended `create` with "Error: write ENOTCONN" (the closed-reader test, once in six runs).
const READER_GONE = new Set(['EPIPE', 'ENOTCONN', 'ECONNRESET'])

/** For the CLI's own process, once, before it prints. Any other write error stays an error. */
export function outliveTheReader() {
  for (const stream of [process.stdout, process.stderr]) {
    stream.on('error', (err) => {
      if (!READER_GONE.has(err.code)) throw err
    })
  }
}

// A terminal or a file can't stop reading, and a child handed one directly keeps its colours and
// the exact order of its two streams.
function readerCanLeave(fd) {
  try {
    const at = fstatSync(fd)
    return at.isFIFO() || at.isSocket()
  } catch {
    return false
  }
}

/**
 * Run a child that does work and prints as it goes. Handed our output directly, it meets a closed
 * pipe in its own process and dies of it, as Vite does. So where the reader can leave, the child
 * writes to us and we pass it on, and only our writes can fail. pnpm and npm survive a closed reader
 * (measured 2026-11-01), our own CLI does through `outliveTheReader`, and a dev server has no work to
 * finish, so those keep `stdio: 'inherit'`.
 *
 * Resolves with the exit code, once the child's output has left this process, so an exit straight
 * after loses none of it (`exit.js`).
 *
 * @param {string} command
 * @param {string[]} args
 * @param {import('node:child_process').SpawnOptions} [options]
 * @returns {Promise<number|null>}
 */
export function runRelayed(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      ...options,
      stdio: ['inherit', readerCanLeave(1) ? 'pipe' : 'inherit', readerCanLeave(2) ? 'pipe' : 'inherit']
    })
    // Not `.pipe()`: that stops reading when its destination fails, and the child then blocks on a
    // full pipe for good.
    child.stdout?.on('data', (chunk) => process.stdout.write(chunk))
    child.stderr?.on('data', (chunk) => process.stderr.write(chunk))
    child.on('error', reject)
    child.on('close', (code) => whenDrained().then(() => resolve(code)))
  })
}
