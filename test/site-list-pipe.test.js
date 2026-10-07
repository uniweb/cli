/**
 * `uniweb site list --json` reaches a reading process WHOLE, however long the list.
 *
 * ⛔ Only a real pipe shows this. To a pipe Node writes stdout asynchronously, so a CLI that
 * exits straight after printing loses everything past the first chunk — measured 2026-10-07:
 * 79 sites arrived as 8192 bytes of a JSON document, while the same command into a file was
 * whole. So this spawns the CLI against a local stand-in for the backend and reads it as a
 * script does.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'index.js')

test('a long `site list --json` reaches a pipe whole', async () => {
  const sites = Array.from({ length: 1500 }, (_, i) => ({
    uuid: `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`,
    name: `site number ${i} with a name long enough to fill the pipe`,
    updated_at: '2026-10-07T15:00:00Z'
  }))
  const server = createServer((req, res) => {
    const u = new URL(req.url, 'http://x')
    res.setHeader('content-type', 'application/json')
    if (u.pathname === '/dev/site') {
      const limit = Number(u.searchParams.get('limit'))
      const offset = Number(u.searchParams.get('offset'))
      return res.end(JSON.stringify({ sites: sites.slice(offset, offset + limit) }))
    }
    res.statusCode = 404
    res.end('{}')
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const origin = `http://127.0.0.1:${server.address().port}`
  try {
    const child = spawn(process.execPath, [CLI, 'site', 'list', '--json', '--personal'], {
      cwd: mkdtempSync(join(tmpdir(), 'uw-site-pipe-')),
      env: {
        ...process.env,
        HOME: mkdtempSync(join(tmpdir(), 'uw-home-')),
        UNIWEB_SERVER: origin,
        UNIWEB_TOKEN: 'TKN',
        CI: '1'
      },
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let out = ''
    child.stdout.on('data', (d) => (out += d))
    const code = await new Promise((r) => child.on('close', r))
    assert.equal(code, 0)
    assert.ok(out.length > 8192, `the output is long enough to have been cut (${out.length} bytes)`)
    const json = JSON.parse(out)
    assert.equal(json.sites.length, 1500)
  } finally {
    server.close()
  }
})
