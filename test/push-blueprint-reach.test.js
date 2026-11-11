/**
 * ⭐ A PUSH THAT SENDS A CHANGED `blueprint.yml` TO A SITE WHOSE BACKEND HAS STARTED SAYS THAT THE CHANGE
 * DOESN'T REACH IT (`src/backend/blueprint-reach.js`).
 *
 * The file is how a backend started from the site begins, applied once, at its start. A push still
 * checks it and carries it with the site, so nothing refuses the change, and the person who made it
 * expects the running backend to follow. By the site's status read before the push sends:
 * `backend_state` `null` (none started) or no key (a backend older than the field) says nothing.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { siteProjectToDocument, createZip, readZip } from '@uniweb/build/uwx'
import { tmp, runVerb } from './helpers/run-verb.js'

const A = 'http://dev.test'
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
const w = (root, rel, body) => {
  mkdirSync(dirname(join(root, rel)), { recursive: true })
  writeFileSync(join(root, rel), body)
}
const commitAll = (cwd, msg) => {
  git(cwd, 'add', '-A')
  if (git(cwd, 'status', '--porcelain').trim()) git(cwd, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', msg)
}

const BLUEPRINT = "signup: invite_only\naccess:\n  '@/track': { all: { members: read } }\n"

// A clone of a synced site that asks for a backend and keeps its blueprint, on a cataloged foundation
// (its scope `@a`, so `@/track` is sent as `@a/track`).
function clone() {
  const repo = tmp('uw-bp-reach-')
  git(repo, 'init', '-q')
  w(repo, '.gitignore', '.uniweb\nnode_modules\n')
  w(repo, 'site/site.yml', "name: S\nfoundation: '@a/base@1.0.0'\nindex: home\nservices:\n  backend: true\n")
  w(repo, 'site/blueprint.yml', BLUEPRINT)
  w(repo, 'site/package.json', JSON.stringify({ name: 's', dependencies: { uniweb: '*' } }))
  w(repo, 'site/sync.json', JSON.stringify({ version: 1, backends: { [A]: { site: { uuid: 'SITE' } } } }, null, 2) + '\n')
  w(repo, 'site/pages/home/page.yml', 'title: Home\n')
  w(repo, 'site/pages/home/hero.md', '# Welcome\n')
  commitAll(repo, 'clone')
  return repo
}

const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16)

// The site as the backend holds it, which is what the files push; its status, with `backend_state` as
// given (absent when `undefined`); and every status read, kept in `asked`.
async function backendOf(siteDir, backendState) {
  const doc = await siteProjectToDocument(siteDir)
  doc.$uuid = 'SITE'
  let n = 0
  const stamp = (r) => {
    r.$uuid ||= `u-${n++}`
    for (const s of r.page_sections || []) s.$uuid ||= `u-${n++}`
  }
  for (const p of doc.pages) stamp(p)
  for (const r of doc.services || []) r.$uuid ||= `u-${n++}`
  const asked = []
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  const respond = (url, init) => {
    if (url.endsWith('/dev/config')) return json({})
    if (url.includes('/dev/site/status/SITE')) {
      asked.push(url)
      return json({ published: true, services: structuredClone(doc.services), ...(backendState === undefined ? {} : { backend_state: backendState }) })
    }
    if (url.includes('/dev/site/content/pull/SITE')) {
      const zip = createZip([
        { name: 'manifest.json', data: Buffer.from(JSON.stringify({ format: 'uwx/1', entries: [{ kind: 'entity', uuid: 'SITE', file: 'entities/SITE.json', version: hash(doc) }] })) },
        { name: 'entities/SITE.json', data: Buffer.from(JSON.stringify(doc)) }
      ])
      return new Response(zip, { status: 200 })
    }
    if (url.includes('/dev/site/content')) {
      const site = JSON.parse(readZip(Buffer.from(init.body)).get('entities/site-content.json').toString('utf8'))
      return json({ siteContentUuid: 'SITE', report: { finalized: [{ index: 0, uuid: 'SITE', changed: true, version: 'V2', document: site }] } })
    }
    return json(null, 404)
  }
  const opts = { session: { version: 2, current: A, sessions: { [A]: { token: 't' } } }, env: { UNIWEB_WORKSPACE: 'personal' }, respond }
  return { doc, asked, opts }
}

const SAID = /blueprint\.yml is how a backend started from this site begins, and this site's backend has started: the change just sent doesn't reach it\./

/** Take the site, change what `change` changes, commit, and push. */
async function pushAfter(backendState, change) {
  const { pull } = await import('../src/commands/pull.js')
  const { push } = await import('../src/commands/push.js')
  const repo = clone()
  const siteDir = join(repo, 'site')
  const be = await backendOf(siteDir, backendState)
  const pulled = await runVerb(siteDir, pull, [], be.opts)
  assert.equal(pulled.exitCode, 0, pulled.output)
  change(repo)
  commitAll(repo, 'an edit')
  const pushed = await runVerb(siteDir, push, [], be.opts)
  assert.equal(pushed.exitCode, 0, pushed.output)
  assert.match(pushed.output, /Pushed \d+ entit/, 'CONTROL — the push landed')
  return { output: pushed.output, asked: be.asked }
}
const openSignup = (repo) => w(repo, 'site/blueprint.yml', BLUEPRINT.replace('invite_only', 'open'))

test('⭐ a changed blueprint pushed to a site whose backend has started: the push says it reaches no backend', { timeout: 60_000 }, async () => {
  const { output, asked } = await pushAfter('active', openSignup)
  assert.match(output, SAID)
  assert.match(output, /The site's owner changes a running backend's settings in the backend's administration\./)
  assert.equal(asked.length, 1, 'the status, read once, before the push sent')
})

test("CONTROL — the same push to a site with no backend started says nothing: it is how that backend will begin", { timeout: 60_000 }, async () => {
  const { output, asked } = await pushAfter(null, openSignup)
  assert.equal(asked.length, 1, 'CONTROL — the status was read')
  assert.doesNotMatch(output, /this site's backend has started/)
})

test('⛔ a backend whose status has no `backend_state` is never read as none started — and nothing is said', { timeout: 60_000 }, async () => {
  const { output } = await pushAfter(undefined, openSignup)
  assert.doesNotMatch(output, /this site's backend has started/)
})

test('a push that changes a page and not the blueprint says nothing of it', { timeout: 60_000 }, async () => {
  const { output } = await pushAfter('active', (repo) => w(repo, 'site/pages/home/hero.md', '# Welcome, again\n'))
  assert.doesNotMatch(output, /this site's backend has started/)
})
