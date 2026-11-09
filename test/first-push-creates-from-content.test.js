/**
 * A site's first push creates it FROM ITS CONTENT, and only then uploads its media.
 *
 * ⛔ Until 2026-11-09 a first push with media made an EMPTY site (`POST /dev/site`), uploaded to it,
 * and then sent the content. When the backend refused the content (measured on a local uniwebd: a
 * query of a type no foundation of the site declares), the site stayed behind, empty, and this copy,
 * holding its uuid and no base, stopped the next push until `--force`. The content lane's create
 * (`POST /dev/site/content`) takes the content or creates nothing, so creating the site there first
 * leaves nothing behind a refusal: no site, and no uploaded bytes.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { deflateSync, crc32 } from 'node:zlib'
import { readZip } from '@uniweb/build/uwx'
import { tmp, runVerb } from './helpers/run-verb.js'

const A = 'http://dev.test'
const SERVED = 'https://assets.example/t1/base.png'

/** A real 180×180 PNG, black. */
function png(size) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(body))
    return Buffer.concat([len, body, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.alloc((size * 3 + 1) * size))),
    chunk('IEND', Buffer.alloc(0))
  ])
}

const UNDECLARED = {
  status: 400,
  title: 'Validation',
  detail: "query `ghosts` names `@alice/probe`, which this site's foundations do not declare",
  reason: 'invalid_field',
  field: 'queries.ghosts.schema',
  rule: 'undeclared_type'
}

// A backend that takes `touch_icon`, keeps every request in order, and refuses the content's create
// while `refuse` says so.
function backend() {
  const calls = []
  const state = { refuse: true }
  const json = (body, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  const opts = {
    session: { version: 2, current: A, sessions: { [A]: { token: 't' } } },
    env: { UNIWEB_WORKSPACE: 'personal' },
    respond: (url, init) => {
      const path = new URL(url).pathname
      if (path === '/dev/config') return json({ siteContent: { settingsFields: ['seo', 'touch_icon'] } })
      const method = init?.method || 'GET'
      if (method !== 'GET') calls.push(path)
      if (path === '/dev/site') return json({ site_content_uuid: 'EMPTY-SITE' })
      if (path === '/dev/assets') {
        const { files } = JSON.parse(init.body)
        return json({ mode: 'direct', uploads: files.map((f) => ({ path: f.path, present: true, id: 't1', ext: 'png', serve_url: SERVED })) })
      }
      if (path === '/dev/site/content' && method === 'POST') {
        state.created = JSON.parse(readZip(Buffer.from(init.body)).get('entities/site-content.json').toString('utf8'))
        if (state.refuse) return json(UNDECLARED, 400)
        return json({ siteContentUuid: 'SITE-1', report: { finalized: [{ index: 0, uuid: 'SITE-1', changed: true, version: 'V1' }] } })
      }
      if (path === '/dev/site/content/push/SITE-1') {
        state.updated = JSON.parse(readZip(Buffer.from(init.body)).get('entities/site-content.json').toString('utf8'))
        return json({ siteContentUuid: 'SITE-1', report: { finalized: [{ index: 0, uuid: 'SITE-1', changed: true, version: 'V2' }] } })
      }
    }
  }
  return { calls, state, opts }
}

function site() {
  const dir = join(tmp('uw-first-'), 'site')
  mkdirSync(join(dir, 'pages', 'home'), { recursive: true })
  mkdirSync(join(dir, 'public'), { recursive: true })
  writeFileSync(join(dir, 'site.yml'), "name: T\nfoundation: '@a/base@1.0.0'\ntouchIcon: /touch-icon.png\n")
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 't', dependencies: { uniweb: '*' } }))
  writeFileSync(join(dir, 'pages', 'home', 'hero.md'), '# Hello\n')
  writeFileSync(join(dir, 'public', 'touch-icon.png'), png(180))
  return dir
}

test('⭐ a first push the backend refuses leaves no site, uploads nothing, and the retry needs no --force', { timeout: 60_000 }, async () => {
  const { push } = await import('../src/commands/push.js')
  const be = backend()
  const dir = site()

  const refused = await runVerb(dir, push, [], be.opts)
  assert.equal(refused.exitCode, 1, refused.output)
  assert.deepEqual(be.calls, ['/dev/site/content'], `only the content's create: ${be.calls.join(', ')}`)
  assert.match(refused.output, /query `ghosts` names `@alice\/probe`/)
  assert.match(refused.output, /no site was created/)
  assert.match(refused.output, /No media was uploaded/)
  assert.equal(existsSync(join(dir, 'sync.json')), false, 'nothing recorded: there is no site')

  // The author fixes what the backend named; the backend now takes it. A plain push goes.
  be.state.refuse = false
  be.calls.length = 0
  const retry = await runVerb(dir, push, [], be.opts)
  assert.equal(retry.exitCode, 0, retry.output)
  assert.doesNotMatch(retry.output, /Not pushed|--force/)
})

test('⭐ an accepted first push creates the site from its content, then uploads, then sends the serve URL', { timeout: 60_000 }, async () => {
  const { push } = await import('../src/commands/push.js')
  const be = backend()
  be.state.refuse = false
  const res = await runVerb(site(), push, [], be.opts)
  assert.equal(res.exitCode, 0, res.output)
  // The order is the point: no empty site, and no byte before the backend took the content.
  assert.deepEqual(be.calls, ['/dev/site/content', '/dev/assets', '/dev/site/content/push/SITE-1'], be.calls.join(', '))
  // The create names the media as written, and the site's foundation as the push sends it.
  assert.equal(be.state.created?.settings?.touch_icon, '/touch-icon.png', res.output)
  assert.equal(be.state.created?.info?.foundation, '@a/base@1.0.0')
  // The push after the upload sends the serve URL.
  assert.equal(be.state.updated?.settings?.touch_icon, SERVED, res.output)
})
