/**
 * `uniweb status` for a site kept in another workspace than the command's: where the site is,
 * and how to work there, are said once — by `app.site` — and `app.changes` says only that what
 * changed on the backend is not known. ⛔ Until 2026-10-26 `app.changes` repeated the whole
 * refusal, and ended it with a second full stop.
 *
 * Run: `pnpm test` or `node --test test/`
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmp, runVerb } from './helpers/run-verb.js'

const ORIGIN = 'http://backend.test'
const SITE = '01a13807-2400-7000-8000-000000000002'

/** A synced site, outside git: the backend's changes are read from its answers alone. */
function project() {
  const dir = join(tmp('uw-elsewhere-'), 'site')
  const files = {
    'site.yml': "name: T\nfoundation: 'https://example.test/foundation/entry.js'\n",
    'package.json': JSON.stringify({ name: 't', dependencies: { uniweb: '*' } }),
    'pages/home/page.yml': 'title: Home\n',
    'pages/home/1-hero.md': '# Home\n',
    'sync.json': JSON.stringify({ version: 1, backends: { [ORIGIN]: { site: { uuid: SITE } } } })
  }
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(join(dir, rel, '..'), { recursive: true })
    writeFileSync(join(dir, rel), body)
  }
  return dir
}

const plain = (out) => out.replace(/\x1b\[[0-9;]*m/g, '')
const loggedIn = { version: 2, current: ORIGIN, sessions: { [ORIGIN]: { token: 't' } } }
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

// The backend's refusal of a site route whose workspace does not hold the site (site-state.test.js).
const WRONG_WORKSPACE = {
  status: 409, title: 'Wrong Workspace', reason: 'wrong_workspace', what: 'site',
  detail: 'this site belongs to the @acme workspace; open it there to work on it',
  workspace: { unit_uuid: '01a10f84-65f4-7332-ad55-a76018ce5a07', handle: 'acme' }
}

async function statusOf(respond, args = []) {
  const { status } = await import('../src/commands/status.js')
  return runVerb(project(), status, ['--personal', ...args], { session: loggedIn, respond })
}

const checksOf = (run) => JSON.parse(run.output.trim().split('\n').pop()).checks
const checkOf = (run, id) => checksOf(run).find((c) => c.id === id)

test('⭐ the refusal is said once, by the site check', { timeout: 30_000 }, async () => {
  const refusing = async (url) => (url.includes(SITE) ? json(WRONG_WORKSPACE, 409) : undefined)
  const run = await statusOf(refusing)
  const out = plain(run.output)
  const refusal = 'This site is in @acme, and you are working in your personal workspace (named on this command). To work on it, pass --org @acme.'
  assert.equal(out.split(refusal).length - 1, 1, out)
  assert.match(out, /The site is kept in another workspace\.\n {6}This site is in @acme/, out)
  assert.match(out, /Could not tell what changed on the backend while the site is kept in another workspace\.\n/, out)
  assert.doesNotMatch(out, /\.\./, out)

  const doc = await statusOf(refusing, ['--json'])
  assert.equal(checkOf(doc, 'app.site').state, 'blocking')
  const changes = checkOf(doc, 'app.changes')
  assert.equal(changes.state, 'unknown')
  assert.equal(changes.summary, 'Could not tell what changed on the backend while the site is kept in another workspace.')
})

// CONTROL: any other reason the backend's changes went unread is still said, with one full stop.
test('control: another reason is said, ending once', { timeout: 30_000 }, async () => {
  const unreachable = async (url) => {
    if (url.includes(`/dev/site/status/${SITE}`)) return json({ published: false, draft_dirty: false })
    if (url.includes(SITE)) throw new Error('The connection was reset.')
  }
  const run = await statusOf(unreachable, ['--json'])
  assert.equal(checkOf(run, 'app.site').state, 'ok', 'control: the site was found')
  assert.equal(checkOf(run, 'app.changes').summary, 'Could not tell what changed on the backend: The connection was reset.')
})
