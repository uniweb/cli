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
 *     got as far as the wire. A test that needs the verb to get further answers the
 *     requests it expects with `respond`; anything it does not answer is refused.
 *
 * ⛔ **Output is captured at `console`, through wrappers installed when THIS module
 * loads** — not by patching `process.stdout.write`. Patching the stream also swallowed
 * the test runner's own reports, which travel over the same stdout: a file of five
 * tests reported one (2026-09-21). And not by replacing `console.log` per run, because
 * `push` binds `const log = console.log` when ITS module loads. ⇒ **Import this helper
 * before the verbs** — the suites import verbs dynamically, inside their tests.
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync, realpathSync } from 'node:fs'
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
 * @param {{ session?: object, env?: object, respond?: Function }} [opts] - `session`:
 *   the contents of `~/.uniweb/registry-auth.json` in the run's HOME — who the user is
 *   logged in as; `env`: variables set for the run only (UNIWEB_REGISTER_URL, say);
 *   `respond(url, init)`: answers a request with a `Response`, or returns nothing to
 *   let it be refused
 * @returns {Promise<{exitCode: number|'threw', output: string, requests: number,
 *   urls: string[]}>} `urls`: every request the verb tried, in order
 */
export async function runVerb(dir, verb, args, { session, env, respond } = {}) {
  const cwd = process.cwd()
  const saved = {
    fetch: globalThis.fetch,
    home: process.env.HOME,
    ci: process.env.CI,
    exit: process.exit,
    entry: process.argv[1],
    env: Object.fromEntries(Object.keys(env || {}).map((k) => [k, process.env[k]]))
  }
  const out = []
  const urls = []
  let requests = 0
  sink = out
  globalThis.fetch = async (url, init) => {
    requests++
    urls.push(String(url))
    const answer = respond ? await respond(String(url), init) : undefined
    if (answer) return answer
    throw new Error('no network in this test')
  }
  process.exit = (code) => {
    throw new Error(`process.exit(${code})`)
  }
  process.env.HOME = tmp('uw-home-')
  if (session) {
    mkdirSync(join(process.env.HOME, '.uniweb'), { recursive: true })
    writeFileSync(join(process.env.HOME, '.uniweb', 'registry-auth.json'), JSON.stringify(session))
  }
  process.env.CI = '1'
  process.argv[1] = stubEntry()
  for (const [k, v] of Object.entries(env || {})) process.env[k] = v
  try {
    process.chdir(dir)
    const res = await verb(args)
    return { exitCode: res?.exitCode, output: out.join(''), requests, urls }
  } catch (err) {
    return { exitCode: 'threw', output: `${out.join('')}\n${err.message}`, requests, urls }
  } finally {
    process.chdir(cwd)
    sink = null
    globalThis.fetch = saved.fetch
    process.env.HOME = saved.home
    if (saved.ci === undefined) delete process.env.CI
    else process.env.CI = saved.ci
    process.exit = saved.exit
    process.argv[1] = saved.entry
    for (const [k, v] of Object.entries(saved.env)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  }
}
