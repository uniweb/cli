/**
 * Foundation code delivery (register phase 2) — unit-pinned against the
 * foundation-code-upload.md contract: collect (meta/ excluded) → plan
 * (POST /dev/registry/code-uploads) → PUT-per-file ENTRY LAST → direct-mode
 * verification fetch. Mock-backed fetch; a temp dist/ as the real artifact.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import {
  collectDistFiles,
  contentTypeFor,
  uploadOrder,
  gatewayUrl,
  uploadFoundationCode,
  ENTRY_PATH,
} from '../src/utils/code-upload.js'

function makeDist() {
  const dir = mkdtempSync(join(tmpdir(), 'uw-dist-'))
  writeFileSync(join(dir, 'entry.js'), 'export default 42\n')
  writeFileSync(join(dir, 'entry.js.map'), '{"version":3}\n')
  writeFileSync(join(dir, 'runtime-pin.json'), '{"runtime":"0.8.16"}\n')
  mkdirSync(join(dir, 'assets'))
  writeFileSync(join(dir, 'assets', 'style.css'), 'body{margin:0}\n')
  mkdirSync(join(dir, 'meta'))
  writeFileSync(join(dir, 'meta', 'schema.json'), '{"_self":{}}\n')
  return dir
}

test('collectDistFiles walks dist, excludes meta/ and *.map, hashes and types files', () => {
  const dir = makeDist()
  try {
    const files = collectDistFiles(dir)
    const paths = files.map((f) => f.path)
    assert.deepEqual(paths.sort(), [
      'assets/style.css',
      'entry.js',
      'runtime-pin.json',
    ])
    assert.ok(!paths.some((p) => p.startsWith('meta/')), 'meta/ excluded')
    assert.ok(!paths.some((p) => p.endsWith('.map')), 'sourcemaps excluded')
    const entry = files.find((f) => f.path === 'entry.js')
    assert.equal(entry.content_type, 'text/javascript')
    assert.equal(entry.size, 'export default 42\n'.length)
    assert.equal(
      entry.sha256,
      createHash('sha256').update('export default 42\n').digest('hex')
    )
    assert.equal(files.find((f) => f.path === 'assets/style.css').content_type, 'text/css')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('contentTypeFor maps known extensions and falls back to octet-stream', () => {
  assert.equal(contentTypeFor('a/b.woff2'), 'font/woff2')
  assert.equal(contentTypeFor('x.svg'), 'image/svg+xml')
  assert.equal(contentTypeFor('weird.bin'), 'application/octet-stream')
})

test('uploadOrder puts the entry last', () => {
  const order = uploadOrder([
    { path: ENTRY_PATH },
    { path: 'assets/style.css' },
    { path: 'entry.js.map' },
  ]).map((f) => f.path)
  assert.equal(order[order.length - 1], ENTRY_PATH)
  assert.equal(order.length, 3)
})

test('gatewayUrl mirrors the storage convention (scope without @)', () => {
  assert.equal(
    gatewayUrl('http://localhost:8080/', '@std/starter', '1.0.2', 'entry.js'),
    'http://localhost:8080/gateway/foundation/std/starter/1.0.2/entry.js'
  )
})

test('uploadFoundationCode plans, PUTs entry-last, verifies in direct mode', async () => {
  const dir = makeDist()
  const calls = []
  const realFetch = globalThis.fetch
  globalThis.fetch = async (url, opts = {}) => {
    calls.push({ url: String(url), method: opts.method || 'GET' })
    if (String(url).endsWith('/dev/registry/code-uploads')) {
      const body = JSON.parse(opts.body)
      assert.equal(body.name, '@std/starter')
      assert.ok(body.files.every((f) => f.sha256 && f.size >= 0))
      return {
        ok: true,
        status: 200,
        json: async () => ({
          mode: 'direct',
          expires_in: null,
          uploads: body.files.map((f) => ({
            path: f.path,
            method: 'PUT',
            url: `http://localhost:8080/dev/registry/code/std/starter/1.0.2/${f.path}`,
            headers: { 'content-type': f.content_type },
          })),
        }),
      }
    }
    if (opts.method === 'PUT') {
      assert.ok(opts.headers['x-uniweb-sha256'], 'integrity header rides every PUT')
      return { ok: true, status: 200, text: async () => '' }
    }
    // the verification GET of the entry
    return {
      ok: true,
      status: 200,
      arrayBuffer: async () => new TextEncoder().encode('export default 42\n').buffer,
    }
  }
  try {
    const result = await uploadFoundationCode({
      apiBase: 'http://localhost:8080',
      token: 't',
      name: '@std/starter',
      version: '1.0.2',
      distDir: dir,
    })
    assert.equal(result.failed.length, 0)
    assert.equal(result.uploaded.length, 3) // entry.js, runtime-pin.json, assets/style.css (meta/ + .map excluded)
    assert.equal(result.verified, true)
    const puts = calls.filter((c) => c.method === 'PUT').map((c) => c.url)
    assert.ok(puts[puts.length - 1].endsWith('/entry.js'), 'entry uploaded last')
    const gets = calls.filter((c) => c.method === 'GET')
    assert.ok(
      gets.some((c) => c.url === 'http://localhost:8080/gateway/foundation/std/starter/1.0.2/entry.js'),
      'verification fetch hits the gateway'
    )
  } finally {
    globalThis.fetch = realFetch
    rmSync(dir, { recursive: true, force: true })
  }
})

test('uploadFoundationCode surfaces per-file failures and skips verification', async () => {
  const dir = makeDist()
  const realFetch = globalThis.fetch
  globalThis.fetch = async (url, opts = {}) => {
    if (String(url).endsWith('/dev/registry/code-uploads')) {
      const body = JSON.parse(opts.body)
      return {
        ok: true,
        status: 200,
        json: async () => ({
          mode: 'direct',
          uploads: body.files.map((f) => ({ path: f.path, method: 'PUT', url: `http://x/${f.path}` })),
        }),
      }
    }
    if (String(url).endsWith('/style.css')) {
      return { ok: false, status: 413, text: async () => 'too large' }
    }
    return { ok: true, status: 200, text: async () => '' }
  }
  try {
    const result = await uploadFoundationCode({
      apiBase: 'http://localhost:8080',
      token: 't',
      name: '@std/starter',
      version: '1.0.2',
      distDir: dir,
    })
    assert.equal(result.failed.length, 1)
    assert.equal(result.failed[0].path, 'assets/style.css')
    assert.equal(result.failed[0].status, 413)
    assert.equal(result.verified, null, 'no verification after failures')
  } finally {
    globalThis.fetch = realFetch
    rmSync(dir, { recursive: true, force: true })
  }
})

test('origin-relative serve_base resolves against the registry origin', async () => {
  const dir = makeDist()
  const gets = []
  const realFetch = globalThis.fetch
  globalThis.fetch = async (url, opts = {}) => {
    if (String(url).endsWith('/dev/registry/code-uploads')) {
      const body = JSON.parse(opts.body)
      return {
        ok: true,
        status: 200,
        json: async () => ({
          mode: 'direct',
          serve_base: '/gateway/foundation/@std/starter/1.0.2/',
          uploads: body.files.map((f) => ({ path: f.path, method: 'PUT', url: `/dev/registry/code/std/starter/1.0.2/${f.path}` })),
        }),
      }
    }
    if (opts.method === 'PUT') return { ok: true, status: 200, text: async () => '' }
    gets.push(String(url))
    return {
      ok: true,
      status: 200,
      arrayBuffer: async () => new TextEncoder().encode('export default 42\n').buffer,
    }
  }
  try {
    const result = await uploadFoundationCode({
      apiBase: 'http://localhost:8080',
      token: 't',
      name: '@std/starter',
      version: '1.0.2',
      distDir: dir,
    })
    assert.equal(result.verified, true)
    assert.deepEqual(gets, ['http://localhost:8080/gateway/foundation/@std/starter/1.0.2/entry.js'])
  } finally {
    globalThis.fetch = realFetch
    rmSync(dir, { recursive: true, force: true })
  }
})
