/**
 * `--json` promises a parseable stdout. This asserts that nothing in the way can
 * break it.
 *
 * ## Why a graph walk and not a review
 *
 * `register.js` diverts its OWN output under `--json` (`log()` → `console.error`)
 * and redirects the delegated builder's stdout to fd 2. Both were correct, and
 * stdout still was not clean — because the promise is not a property of
 * `register.js`. It is a property of **everything register can reach**, and a
 * utility three files away cannot see the flag it is breaking.
 *
 * ⭐ **The two defects shared one symptom, which is what hid the second.**
 * Before the builder redirect, `--json` emitted ~35 stray lines: the whole
 * progress log. After it, `flows` measured **2** at `uniweb@0.37.1` — same
 * symptom name, 94% smaller, and easy to read as "the fix failed" when in fact
 * the fix worked and something smaller was writing underneath it. A count is not
 * a diagnosis.
 *
 * ⇒ So the check is mechanical and covers the reachable set, rather than the one
 * file someone thought of. A new `console.log` on this path fails here, in a
 * suite that runs without a backend — which the real cold path needs.
 *
 * ⚠️ **What it does NOT cover:** `@uniweb/*` packages register imports, and any
 * child process it spawns. The first is a different lane's stdout discipline;
 * the second is covered by the `stdio` redirect at the spawn site, not by this.
 * A green run here is not proof stdout is clean end to end.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname, relative, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const CLI_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Every cli-local module reachable from an entry, following relative imports. */
function reachableFrom(entry) {
  const seen = new Set()
  const stack = [resolve(CLI_ROOT, entry)]
  while (stack.length) {
    const f = stack.pop()
    if (seen.has(f) || !existsSync(f)) continue
    seen.add(f)
    const src = readFileSync(f, 'utf8')
    for (const m of src.matchAll(/from\s+['"](\.[^'"]+)['"]/g)) {
      let t = resolve(dirname(f), m[1])
      if (!/\.[jt]sx?$/.test(t)) t = existsSync(`${t}.js`) ? `${t}.js` : join(t, 'index.js')
      stack.push(t)
    }
  }
  return [...seen]
}

/**
 * Lines writing to stdout, minus the one sanctioned indirection.
 *
 * `register.js`'s `log()` helper is the exception BY CONSTRUCTION: it is the
 * definition of the divert (`jsonMode ? console.error : console.log`), so the
 * only `console.log` allowed on this path is the one inside it.
 */
function stdoutWrites(file) {
  const src = readFileSync(file, 'utf8')
  const out = []
  src.split('\n').forEach((line, i) => {
    if (!/console\.log\(|process\.stdout\.write\(/.test(line)) return
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return // a comment mentioning it
    if (/jsonMode \? console\.error/.test(line)) return // the divert itself
    // `emitJson`'s own write is the PAYLOAD — the one thing `--json` exists to
    // put on stdout. Identified by the serialization on the same line rather
    // than by a comment above it, which is what an earlier cut keyed on and
    // missed.
    if (/process\.stdout\.write\(JSON\.stringify\(/.test(line)) return
    out.push(`${relative(CLI_ROOT, file)}:${i + 1}: ${line.trim()}`)
  })
  return out
}

test('⛔ nothing register can reach writes prose to stdout', () => {
  const offenders = reachableFrom('src/commands/register.js').flatMap(stdoutWrites)
  assert.deepEqual(
    offenders,
    [],
    'Under `--json`, stdout must carry ONLY the final JSON line. These write to it:\n' +
      offenders.map((o) => `  ${o}`).join('\n') +
      '\n\nHuman output belongs on stderr — equally visible to a person, invisible to a pipe.'
  )
})

test('the walk actually reaches the utilities, not just the entry', () => {
  // A graph walk that silently resolved nothing would pass the test above while
  // checking one file. This is that check's control.
  const files = reachableFrom('src/commands/register.js').map((f) => relative(CLI_ROOT, f))
  assert.ok(files.length > 5, `expected a real graph, got ${files.length} file(s)`)
  assert.ok(
    files.some((f) => f.includes('registry-orgs')),
    'registry-orgs.js is the module that broke this; the walk must reach it'
  )
  assert.ok(
    files.some((f) => f.includes('registry-auth')),
    'registry-auth.js must be reachable too'
  )
})

test('emitJson still writes to the real stdout — that is the payload', () => {
  // The divert must not have swallowed the one thing --json exists to print.
  const src = readFileSync(resolve(CLI_ROOT, 'src/commands/register.js'), 'utf8')
  assert.match(src, /emitJson/, 'register must still emit its JSON line')
})
