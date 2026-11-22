/**
 * `uniweb i18n --help` names every subcommand `uniweb i18n` runs, read from the command's own
 * dispatch, so a new one can't be left out. ⛔ `words` ran and was missing from the help until
 * 2026-11-22.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const CLI = join(ROOT, 'src/index.js')

test('uniweb i18n --help names every subcommand the command runs', () => {
  const source = readFileSync(join(ROOT, 'src/commands/i18n.js'), 'utf8')
  const runs = [...new Set([...source.matchAll(/^\s*case '([a-z-]+)':/gm)].map((m) => m[1]))]
  assert.ok(runs.includes('extract') && runs.includes('words'), `read the dispatch: ${runs.join(', ')}`)
  const help = execFileSync('node', [CLI, 'i18n', '--help'], { encoding: 'utf8' }).replace(/\x1b\[[0-9;]*m/g, '')
  // A subcommand is named on its own line, or as another's alias (`sync` for `extract`).
  const named = (name) => new RegExp(`^\\s*i18n ${name}\\b`, 'm').test(help) || new RegExp(`alias: ${name}\\b`).test(help)
  assert.deepEqual(runs.filter((name) => !named(name)), [])
})
