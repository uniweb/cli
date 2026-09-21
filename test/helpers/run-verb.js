/**
 * Run a backend verb (`push`, `publish`, `pull`, `forget`, …) in-process, SAFELY.
 *
 * These verbs were written to be run by a person, and four of their habits turn a
 * test into something worse than a failure unless each is fenced off:
 *
 *   - ⛔ **They re-run the CLI's own entry.** `publish` builds with
 *     `node <process.argv[1]> build --link`, deliberately, so the inner build is the
 *     same CLI. Under a test runner argv[1] is the TEST FILE, so a publish that gets
 *     that far re-runs the file, which publishes again, and so on — an unbounded
 *     chain of processes, each blocked on the next, that outlives the run. Measured
 *     2026-09-21: two hundred of them within seconds, from one mutated check. argv[1]
 *     points at a stub that exits at once instead.
 *   - **They prompt.** A verb that gets past the check under test must fail, not sit
 *     on stdin: `CI=1` makes every gated prompt refuse.
 *   - **They exit.** The non-interactive login calls `process.exit(1)`; here it
 *     throws, so it fails the test instead of killing the file.
 *   - **They reach for your real session and the network.** HOME is a fresh temp
 *     dir, and `fetch` is counted and refused — so `requests` says whether the verb
 *     got as far as the wire.
 *
 * ⛔ **Output is captured at `console`, through wrappers installed when THIS module
 * loads** — not by patching `process.stdout.write`. Patching the stream also swallowed
 * the test runner's own reports, which travel over the same stdout: a file of five
 * tests reported one (2026-09-21). And not by replacing `console.log` per run, because
 * `push` binds `const log = console.log` when ITS module loads. ⇒ **Import this helper
 * before the verbs** — the suites import verbs dynamically, inside their tests.
 */

import { mkdtempSync, rmSync, writeFileSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const made = []
process.on('exit', () => {
  for (const d of made) {
    try {
      rmSync(d, { recursive: true, force: true })
    } catch {
      /* best effort */
    }
  }
})

/** A fresh temp dir, realpath'd (macOS tmp is a symlink), removed at exit. */
export function tmp(prefix) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)))
  made.push(dir)
  return dir
}

const original = {}
let sink = null
for (const level of ['log', 'error', 'warn', 'info']) {
  original[level] = console[level]
  console[level] = (...args) =>
    sink ? sink.push(args.map(String).join(' ') + '\n') : original[level].apply(console, args)
}

let entryStub = null
function stubEntry() {
  if (!entryStub) {
    entryStub = join(tmp('uw-entry-'), 'no-cli.mjs')
    writeFileSync(entryStub, 'process.exit(3)\n')
  }
  return entryStub
}

/**
 * @param {string} dir - the directory to run from
 * @param {(args: string[]) => Promise<{exitCode?: number}>} verb
 * @param {string[]} args
 * @returns {Promise<{exitCode: number|'threw', output: string, requests: number}>}
 */
export async function runVerb(dir, verb, args) {
  const cwd = process.cwd()
  const saved = {
    fetch: globalThis.fetch,
    home: process.env.HOME,
    ci: process.env.CI,
    exit: process.exit,
    entry: process.argv[1]
  }
  const out = []
  let requests = 0
  sink = out
  globalThis.fetch = async () => {
    requests++
    throw new Error('no network in this test')
  }
  process.exit = (code) => {
    throw new Error(`process.exit(${code})`)
  }
  process.env.HOME = tmp('uw-home-')
  process.env.CI = '1'
  process.argv[1] = stubEntry()
  try {
    process.chdir(dir)
    const res = await verb(args)
    return { exitCode: res?.exitCode, output: out.join(''), requests }
  } catch (err) {
    return { exitCode: 'threw', output: `${out.join('')}\n${err.message}`, requests }
  } finally {
    process.chdir(cwd)
    sink = null
    globalThis.fetch = saved.fetch
    process.env.HOME = saved.home
    if (saved.ci === undefined) delete process.env.CI
    else process.env.CI = saved.ci
    process.exit = saved.exit
    process.argv[1] = saved.entry
  }
}
