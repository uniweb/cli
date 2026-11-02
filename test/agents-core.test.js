/**
 * What every project's AGENTS.md has to be, however often its text is edited.
 *
 * ⭐ A TARGET AND A CEILING, not one limit [Diego, 2026-11-02]. Codex stops reading at
 * `project_doc_max_bytes`, 32 KiB by default, and a person can raise it, so the core tries to stay
 * within 32 KiB without hurting other agents to do it. Past that the file still works: it says near
 * its top how to tell it was cut, and what to do. The ceiling is what keeps the core a core.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  AGENTS_END_LINE,
  generateAgentsContent,
  readAgentsVersion,
  refreshAgentsContent,
} from '../src/utils/agents-stamp.js'
import { scaffoldWorkspace } from '../src/utils/scaffold.js'
import { getCliVersion } from '../src/versions.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const GUIDES = JSON.parse(readFileSync(join(HERE, '..', 'partials', 'guides', 'index.json'), 'utf8'))

/** Codex's default for `project_doc_max_bytes`: what the core tries to stay within. */
const TARGET = 32 * 1024
/** Adding past this means cutting elsewhere. */
const CEILING = 36 * 1024

test('it stays a core', (t) => {
  const size = Buffer.byteLength(generateAgentsContent())
  if (size > TARGET) t.diagnostic(`AGENTS.md is ${size} bytes, ${size - TARGET} over the ${TARGET}-byte target`)
  assert.ok(size <= CEILING, `AGENTS.md is ${size} bytes, over the ${CEILING}-byte ceiling: adding means cutting elsewhere`)
})

test('an agent can tell the file was cut, from a line inside any cap', () => {
  const content = generateAgentsContent()
  const notice = content.indexOf(`\`${AGENTS_END_LINE}\``)
  assert.ok(notice > 0 && notice < 512, 'the notice is near the top')
  assert.ok(content.endsWith(`\n\n${AGENTS_END_LINE}\n`), 'and the line it names ends the file')
  assert.equal(content.split('\n').filter((line) => line === AGENTS_END_LINE).length, 1)
})

test('one stamp, on the first line', () => {
  const content = generateAgentsContent()
  assert.ok(content.startsWith(`<!-- uniweb-agents v${getCliVersion()} -->\n`))
  assert.equal(content.match(/uniweb-agents v/g).length, 1)
})

test('it says how to run the CLI, and every guide is in its table', () => {
  const content = generateAgentsContent()
  assert.match(content, /without a global install, run them in the project as `npx uniweb <command>`/)
  for (const { name } of GUIDES) assert.ok(content.includes(`| \`uniweb guide ${name}\` |`), name)
})

test('`create` writes what `update` writes', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'uw-agents-'))
  await scaffoldWorkspace(dir, { projectName: 'p', workspaceGlobs: ['src', 'site'], scripts: {}, packages: [] })
  const written = readFileSync(join(dir, 'AGENTS.md'), 'utf8')
  assert.equal(written, refreshAgentsContent(null).content)
  assert.equal(readAgentsVersion(join(dir, 'AGENTS.md')), getCliVersion())
})
