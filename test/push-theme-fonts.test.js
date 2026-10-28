/**
 * The font files a site's theme names go up with its other media, and the theme a push sends
 * names each by its serve URL.
 *
 * ⛔ Until 2026-10-28 a push uploaded only what the media walk counts as media (images, video,
 * PDF), so a theme's `fonts.faces` went up as site paths: a hosted page preloaded each face from a
 * path its host does not serve, and the site fell back to system fonts.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { readZip } from '@uniweb/build/uwx'
import { tmp, runVerb } from './helpers/run-verb.js'

const A = 'http://dev.test'
const SERVED = 'https://assets.example/w1/base.woff2'

// A backend that holds every file it is asked to plan, and keeps what each request asked and sent.
function backend() {
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
        if (url.endsWith('/dev/config')) return json({ siteContent: { settingsFields: ['seo'] } })
        // A push with media creates the site first, so the upload has an owner.
        if (new URL(url).pathname === '/dev/site') return json({ site_content_uuid: 'SITE-1' })
        if (url.endsWith('/dev/assets')) {
          const { files } = JSON.parse(init.body)
          planned.push(...files)
          return json({ mode: 'direct', uploads: files.map((f) => ({ path: f.path, present: true, id: 'w1', ext: 'woff2', serve_url: SERVED })) })
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
  const dir = join(tmp('uw-fonts-'), 'site')
  mkdirSync(join(dir, 'pages', 'home'), { recursive: true })
  mkdirSync(join(dir, 'public', 'fonts'), { recursive: true })
  writeFileSync(join(dir, 'site.yml'), "name: T\nfoundation: '@a/base@1.0.0'\n")
  writeFileSync(
    join(dir, 'theme.yml'),
    'fonts:\n  body: "Söhne, sans-serif"\n  faces:\n    - { family: "Söhne", src: /fonts/s.woff2, weight: 400 }\n'
  )
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 't', dependencies: { uniweb: '*' } }))
  writeFileSync(join(dir, 'pages', 'home', 'hero.md'), '# Hello\n')
  // The bytes are never read as a font: the upload sends what the file holds, typed by its name.
  writeFileSync(join(dir, 'public', 'fonts', 's.woff2'), Buffer.from('wOF2'))
  return dir
}

test('⭐ a push uploads the font files the theme names, and sends their serve URLs', { timeout: 60_000 }, async () => {
  const { push } = await import('../src/commands/push.js')
  const be = backend()
  const res = await runVerb(site(), push, [], be.opts)
  assert.equal(res.exitCode, 0, `${res.output}\n${res.urls.join('\n')}`)
  const font = be.planned.find((f) => f.path.endsWith('fonts/s.woff2'))
  assert.ok(font, `not uploaded: ${JSON.stringify(be.planned.map((f) => f.path))}`)
  assert.equal(font.content_type, 'font/woff2')
  assert.equal(be.sent.at(-1)?.settings?.theme?.fonts?.faces?.[0]?.src, SERVED, res.output)
})
