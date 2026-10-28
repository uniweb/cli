/**
 * A key a push sends only where the deployment takes it can name a file — `touch_icon` does — so
 * the emit that says which files go up must be made with the same keys as the one sent.
 *
 * ⛔ Until 2026-10-28 `push` and `publish` asked which files to upload of an emit made WITHOUT the
 * deployment's key lists (`deploymentFields`): the touch icon was not in it, so it was never
 * uploaded, and the document sent named it by the site path it was written as. A hosted site
 * linked `/touch-icon.png`, which its host does not serve.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
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

// A backend whose `settings` takes `touch_icon` — or, with `takes: false`, does not — which holds
// every file it is asked to plan, and keeps what each request asked and sent.
function backend({ takes = true } = {}) {
  const planned = []
  const sent = []
  const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
  return {
    planned,
    sent,
    opts: {
      session: { version: 2, current: A, sessions: { [A]: { token: 't' } } },
      env: { UNIWEB_WORKSPACE: 'personal' },
      respond: (url, init) => {
        if (url.endsWith('/dev/config')) return json({ siteContent: { settingsFields: takes ? ['seo', 'touch_icon'] : ['seo'] } })
        // A push with media creates the site first, so the upload has an owner.
        if (new URL(url).pathname === '/dev/site') return json({ site_content_uuid: 'SITE-1' })
        if (url.endsWith('/dev/assets')) {
          const { files } = JSON.parse(init.body)
          planned.push(...files.map((f) => f.path))
          return json({ mode: 'direct', uploads: files.map((f) => ({ path: f.path, present: true, id: 't1', ext: 'png', serve_url: SERVED })) })
        }
        if (url.includes('/dev/site/content')) {
          sent.push(JSON.parse(readZip(Buffer.from(init.body)).get('entities/site-content.json').toString('utf8')))
          return json({ siteContentUuid: 'SITE-1', report: { finalized: [{ index: 0, uuid: 'SITE-1', changed: true, version: 'V1' }] } })
        }
      }
    }
  }
}

function site() {
  const dir = join(tmp('uw-touch-'), 'site')
  mkdirSync(join(dir, 'pages', 'home'), { recursive: true })
  mkdirSync(join(dir, 'public'), { recursive: true })
  writeFileSync(join(dir, 'site.yml'), "name: T\nfoundation: '@a/base@1.0.0'\ntouchIcon: /touch-icon.png\n")
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 't', dependencies: { uniweb: '*' } }))
  writeFileSync(join(dir, 'pages', 'home', 'hero.md'), '# Hello\n')
  writeFileSync(join(dir, 'public', 'touch-icon.png'), png(180))
  return dir
}

test('⭐ a push uploads the touch icon and sends it as its serve URL', { timeout: 60_000 }, async () => {
  const { push } = await import('../src/commands/push.js')
  const be = backend()
  const res = await runVerb(site(), push, [], be.opts)
  assert.equal(res.exitCode, 0, `${res.output}\n${res.urls.join('\n')}`)
  assert.ok(be.planned.some((p) => p.endsWith('touch-icon.png')), `not uploaded: ${JSON.stringify(be.planned)}`)
  assert.equal(be.sent.at(-1)?.settings?.touch_icon, SERVED, res.output)
})

test('where the deployment takes no touch icon, a push neither uploads nor sends one', { timeout: 60_000 }, async () => {
  const { push } = await import('../src/commands/push.js')
  const be = backend({ takes: false })
  const res = await runVerb(site(), push, [], be.opts)
  assert.equal(res.exitCode, 0, res.output)
  assert.deepEqual(be.planned.filter((p) => p.endsWith('touch-icon.png')), [])
  assert.equal(be.sent.at(-1)?.settings?.touch_icon, undefined)
})

// `publish` cannot be driven this far in-process: it builds the site by running the CLI's own
// entry, which `runVerb` stubs (it would re-run the test file). So its half is read off the source:
// the emit that says which files go up is made with the deployment's keys, read before it.
test('publish asks which files go up of an emit made with the deployment’s keys', async () => {
  const { readFileSync } = await import('node:fs')
  const src = readFileSync(new URL('../src/commands/publish.js', import.meta.url), 'utf8')
  const at = src.indexOf('probe = await emitSyncPackages(siteDir, {')
  assert.ok(at > 0, 'the media probe moved — find it and point this test at it')
  const probe = src.slice(at, src.indexOf('})', at))
  assert.match(probe, /\.\.\.fields,/)
  const read = src.indexOf('const fields = await deploymentFields(')
  assert.ok(read > 0 && read < at, 'the keys are read before the probe')
})
