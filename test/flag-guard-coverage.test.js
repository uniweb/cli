/**
 * The flag guard's accepted sets must cover every flag the verb can actually
 * reach — including flags read by helpers several modules away.
 *
 * This test exists because hand-enumeration failed twice in one sitting, in the
 * expensive direction (rejecting a working flag):
 *
 *   - `--no-verify` is read in `backend/foundation-bring-along.js`, two lines below
 *     the `--yes` that WAS found. It is publicly documented for `uniweb publish`,
 *     and the first cut of the guard rejected it.
 *   - `--yes` reaches `push` through `backend/site-sync.js`, where it changes the
 *     owner resolution — so push honoured the flag and rejected it in the same run.
 *
 * Both were invisible to "grep the command file, then spot-check the helpers": a
 * spot-check stops at the first hit. So the enumeration is mechanical now — walk
 * the verb's import graph and diff what it can read against what it accepts.
 *
 * The assertion is deliberately ONE-SIDED. Accepting a flag the verb ignores is
 * harmless (it was ignored before the guard too); rejecting one it honours breaks
 * a working command. So this fails only on the second case.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { VERB_FLAGS } from '../src/utils/flag-guard.js'

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '../src')

const ENTRY = {
  push: 'commands/push.js',
  publish: 'commands/publish.js',
  pull: 'commands/pull.js',
  clone: 'commands/clone.js',
  register: 'commands/register.js',
  status: 'commands/status.js'
}

// Accepted everywhere, so never a gap.
const GLOBAL = new Set(['--non-interactive', '--help', '-h'])

// Flags READ FROM `args`. Deliberately not every dash-literal: a subprocess
// argv like `['build', '--target', 'foundation']` is not a flag this command
// accepts, and matching it would produce false gaps.
const READS = [
  /args\.includes\(\s*'(-{1,2}[a-zA-Z][\w-]*)'\s*\)/g,
  /(?:readFlagValue|flagValue)\(\s*args,\s*'(-{1,2}[a-zA-Z][\w-]*)'/g
]

/** Relative imports only — node: and package specifiers have no args of ours. */
function importsOf(text) {
  const out = []
  const re = /from\s+'(\.[^']+)'/g
  let m
  while ((m = re.exec(text))) out.push(m[1])
  return out
}

/** Every flag the module graph rooted at `entry` reads from `args`. */
function reachableFlags(entry) {
  const seen = new Set()
  const flags = new Set()
  const walk = (rel) => {
    const file = resolve(SRC, rel)
    if (seen.has(file) || !existsSync(file)) return
    seen.add(file)
    const text = readFileSync(file, 'utf8')
    for (const re of READS) {
      re.lastIndex = 0
      let m
      while ((m = re.exec(text))) flags.add(m[1])
    }
    for (const spec of importsOf(text)) {
      walk(join(dirname(rel), spec))
    }
  }
  walk(entry)
  return flags
}

for (const [verb, entry] of Object.entries(ENTRY)) {
  test(`${verb} accepts every flag its import graph can read`, () => {
    const accepted = new Set([...VERB_FLAGS[verb], ...GLOBAL])
    const missing = [...reachableFlags(entry)].filter((f) => !accepted.has(f))
    assert.deepEqual(
      missing,
      [],
      `\`uniweb ${verb}\` would REJECT flags it honours: ${missing.join(', ')}\n` +
        `Add them to VERB_FLAGS.${verb} in src/utils/flag-guard.js.`
    )
  })
}

test('the walk actually reaches helper modules — the control', () => {
  // An empty or shallow walk would make every test above pass vacuously, which is
  // exactly the failure this file exists to prevent. Prove it sees a flag that
  // lives NOWHERE in the command file: `--no-verify` is only in
  // backend/foundation-bring-along.js, two hops from publish.js.
  const reachable = reachableFlags(ENTRY.publish)
  assert.ok(
    reachable.has('--no-verify'),
    'the import walk is not reaching helpers — every assertion above is vacuous'
  )
  assert.doesNotMatch(
    readFileSync(resolve(SRC, ENTRY.publish), 'utf8'),
    /args\.includes\('--no-verify'\)/,
    'precondition: --no-verify must NOT be readable from publish.js itself'
  )
})
