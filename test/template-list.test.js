/**
 * `uniweb template list` — the scriptable roster of official templates.
 *
 * It exists because tooling that scaffolds several templates in a row needs
 * their names before it can resolve any of them, and the only published place
 * that list lived was `src/framework-index.json` — an internal path inside this
 * package, promised to nobody. A consumer reading that file breaks silently on
 * any `files`/layout change, so this is the supported surface.
 *
 * The properties worth pinning: `--json` is parseable ALONE (a human line on
 * stdout would break every pipe), the roster is non-empty and matches the
 * source the interactive `create` picker reads, and the reserved `register`
 * path still refuses rather than being swallowed by the new subcommand.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const CLI = join(dirname(dirname(fileURLToPath(import.meta.url))), 'src/index.js')

function run(args) {
  try {
    return {
      code: 0,
      out: execFileSync('node', [CLI, ...args], { encoding: 'utf8', stdio: 'pipe' })
    }
  } catch (err) {
    return { code: err.status ?? 1, out: err.stdout || '', err: err.stderr || '' }
  }
}

test('template list --json puts JSON on stdout and NOTHING else', () => {
  const { code, out } = run(['template', 'list', '--json'])
  assert.equal(code, 0)
  // The whole point is that this pipes. A stray banner makes JSON.parse throw.
  const parsed = JSON.parse(out)
  assert.ok(Array.isArray(parsed.templates))
  assert.equal(parsed.count, parsed.templates.length)
  assert.match(parsed.cliVersion, /^\d+\.\d+\.\d+/)
})

test('every entry carries the fields a caller selects on', () => {
  const { templates } = JSON.parse(run(['template', 'list', '--json']).out)
  assert.ok(templates.length > 0, 'the roster must not be empty')
  for (const t of templates) {
    assert.equal(typeof t.id, 'string')
    assert.ok(t.id.length > 0)
    assert.equal(typeof t.name, 'string')
    assert.equal(typeof t.description, 'string')
    assert.ok(Array.isArray(t.tags))
  }
})

test('the roster is the same source the create picker reads', async () => {
  // Drift guard: if these ever diverge, the picker and the script surface
  // disagree about what "official" means, and only one of them is visible.
  const { OFFICIAL_TEMPLATES } = await import('../src/templates/resolver.js')
  const { templates } = JSON.parse(run(['template', 'list', '--json']).out)
  assert.deepEqual(
    templates.map((t) => t.id),
    OFFICIAL_TEMPLATES
  )
})

test('the human listing names each template', () => {
  const { code, out } = run(['template', 'list'])
  assert.equal(code, 0)
  const { templates } = JSON.parse(run(['template', 'list', '--json']).out)
  for (const t of templates) assert.ok(out.includes(t.id), `${t.id} missing from listing`)
})

test('⛔ the reserved register path still refuses', () => {
  // Adding a live subcommand must not turn the reserved one into a no-op.
  const { code, err } = run(['template', 'register'])
  assert.equal(code, 1)
  assert.match(err, /isn't available on the new backend yet/)
})

test('a bare `template` still refuses rather than listing', () => {
  // `list` is opt-in: someone typing `uniweb template` meant the old verb.
  const { code, err } = run(['template'])
  assert.equal(code, 1)
  assert.match(err, /isn't available on the new backend yet/)
})
