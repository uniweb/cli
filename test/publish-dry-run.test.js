/**
 * `publish --dry-run` must actually RUN — the body, not a helper.
 *
 * ⭐ Why this test exists at all, when publish's decision logic is already
 * covered: on 2026-09-08 a service-request fix added a second binding for a
 * name the module ALREADY imports at the top —
 *
 *   import { isNonInteractive, confirm } from '../utils/interactive.js'   // line 78
 *   …
 *   const { isNonInteractive, confirm } = await import('…/interactive.js') // line 834
 *
 * — inside `publish()`'s own body. A `const` is scoped to the whole enclosing
 * body, so it shadowed the import from the first line of the function, and the
 * four earlier `confirm` references (the foundation and extension bring-alongs)
 * became temporal-dead-zone reads. Flows hit it against a fresh manor as
 * `✗ Foundation release failed: Cannot access 'confirm' before initialization`.
 *
 * ⛔ The commit shipped with a green suite, and that is the part worth keeping:
 * its tests exercised the pure decision helpers (`service-request.js`), which
 * are correct and were never the problem. **A TDZ is a property of the command
 * body's scope — no unit test of anything it calls can see it.** Only entering
 * `publish()` can.
 *
 * So this is deliberately a smoke test, not an assertion about publishing:
 * `--dry-run` walks the whole pre-network body — flags, site resolution,
 * conformance, origin ladder, scope check, both bring-alongs — and returns
 * before a single request goes out. An unreachable `--backend` keeps it
 * offline and deterministic; if a call ever escapes to the network, the port
 * refuses it rather than the test quietly depending on a live backend.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const CLI_ENTRY = join(__dirname, '..', 'src', 'index.js')

// Discard-refused: nothing listens, so any escaped request fails fast and loud.
const OFFLINE_BACKEND = 'http://127.0.0.1:9'

/** The smallest thing `publish` accepts as a site. */
function minimalSite() {
  const dir = mkdtempSync(join(tmpdir(), 'publish-dry-'))
  mkdirSync(join(dir, 'pages'), { recursive: true })
  writeFileSync(join(dir, 'site.yml'), 'title: Dry run\nfoundation: ./foundation\n')
  writeFileSync(join(dir, 'pages', 'index.md'), '---\ntype: Hero\n---\n\n# hi\n')
  return dir
}

test('publish --dry-run walks its own body without a dead-zone read', () => {
  const dir = minimalSite()
  try {
    const r = spawnSync(
      process.execPath,
      [CLI_ENTRY, 'publish', '--dry-run', '--backend', OFFLINE_BACKEND, '--non-interactive'],
      { cwd: dir, encoding: 'utf8' }
    )
    const out = `${r.stdout}${r.stderr}`

    // The precise regression. Named on its own because the exit-code assertion
    // below would report it as an anonymous failure, and this message is the
    // one a reader needs to recognize the class.
    assert.doesNotMatch(
      out,
      /before initialization/,
      `a binding was read inside its temporal dead zone:\n${out}`
    )
    assert.doesNotMatch(out, /Foundation release failed/, out)

    assert.equal(r.status, 0, `exit ${r.status}\n${out}`)
    assert.match(out, /Dry run/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
