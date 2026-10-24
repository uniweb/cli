/**
 * `uniweb doctor` — `agents.expectedOrigins` entries that name no origin.
 *
 * An entry is read by the rule a host checks by (`originOf`, `@uniweb/projections`), so one it
 * reads as no origin matches nothing: `app.example.com`, written without its scheme, declines the
 * very app it was meant to let in, and nothing says so but this check.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkAgentsBlock } from '../src/commands/doctor.js'

/** @returns {Array<{id: string, message: string}>} the issues raised for this block */
function issuesFor(agents) {
  const issues = []
  checkAgentsBlock({ siteName: 'site', siteYml: { agents }, issues })
  return issues
}

test('says nothing about origins written as origins', () => {
  assert.deepEqual(issuesFor({ expectedOrigins: ['https://app.example.com', 'http://localhost:5173/'] }), [])
  assert.deepEqual(issuesFor({ expectedOrigins: 'https://app.example.com' }), [])
  assert.deepEqual(issuesFor({ index: false }), [])
  assert.deepEqual(issuesFor({ expectedOrigins: [] }), [])
})

test('names each entry that names no origin', () => {
  const issues = issuesFor({ expectedOrigins: ['https://app.example.com', 'app.example.com', 'ftp://files.example.com'] })
  assert.deepEqual(issues.map((i) => i.id), ['agents-origin-unreadable'])
  assert.match(issues[0].message, /'app\.example\.com', 'ftp:\/\/files\.example\.com' name no origin/)
})

test('still flags an unknown key beside it', () => {
  const ids = issuesFor({ expectedOrgins: ['https://app.example.com'], expectedOrigins: ['app.example.com'] }).map((i) => i.id)
  assert.deepEqual(ids.sort(), ['agents-origin-unreadable', 'agents-unknown-key'])
})
