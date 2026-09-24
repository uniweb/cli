// ⭐ `uniweb validate` fails on a violation by default; `--lax` only reports it.
// It warned by default until 2026-09-24, with `--strict` to fail — and a gate that
// passes is one nobody reads. `push` / `publish` refuse the same findings.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { validate } from '../src/commands/validate.js'

function workspace(member) {
  const dir = mkdtempSync(join(tmpdir(), 'validate-exit-'))
  const files = {
    'pnpm-workspace.yaml': 'packages:\n  - foundation\n  - site\n',
    'package.json': JSON.stringify({ name: 'ws', private: true }),
    'foundation/package.json': JSON.stringify({ name: 'foundation', type: 'module', main: './_entry.generated.js' }),
    'foundation/main.js': 'export default {}\n',
    'foundation/schemas/member.yml': 'name: member\nfields:\n  name: { type: string, required: true }\n',
    'site/site.yml': 'name: s\nfoundation: foundation\n',
    'site/theme.yml': '',
    'site/records/member/ada.yml': member
  }
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(join(dir, rel, '..'), { recursive: true })
    writeFileSync(join(dir, rel), body)
  }
  return dir
}

test('a violation fails validate by default — even in a record no section reads', async () => {
  const ws = workspace('role: Intern\n')
  try {
    assert.equal((await validate([join(ws, 'site'), '--json'])).exitCode, 1)
  } finally {
    rmSync(ws, { recursive: true, force: true })
  }
})

test('--lax reports it and exits 0', async () => {
  const ws = workspace('role: Intern\n')
  try {
    assert.equal((await validate([join(ws, 'site'), '--json', '--lax'])).exitCode, 0)
  } finally {
    rmSync(ws, { recursive: true, force: true })
  }
})

test('CONTROL — a clean project exits 0', async () => {
  const ws = workspace('name: Ada\n')
  try {
    assert.equal((await validate([join(ws, 'site'), '--json'])).exitCode, 0)
  } finally {
    rmSync(ws, { recursive: true, force: true })
  }
})
