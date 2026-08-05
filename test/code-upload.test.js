/**
 * Foundation code delivery (register phase 2) — unit-pinned against the
 * foundation-code-upload.md contract: collect (meta/ excluded) → plan
 * (POST /dev/registry/code-uploads) → PUT-per-file ENTRY LAST → direct-mode
 * verification fetch. Mock-backed fetch; a temp dist/ as the real artifact.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import {
  collectDistFiles,
  computeFoundationDigest,
  readRuntimePin,
  contentTypeFor,
  uploadOrder,
  uploadFoundationCode,
  ENTRY_PATH
} from '../src/utils/code-upload.js'
import * as codeUpload from '../src/utils/code-upload.js'

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
      'runtime-pin.json'
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
    assert.equal(
      files.find((f) => f.path === 'assets/style.css').content_type,
      'text/css'
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('computeFoundationDigest is sha256:-prefixed and stable across calls (determinism)', () => {
  const dir = makeDist()
  try {
    const a = computeFoundationDigest(dir)
    const b = computeFoundationDigest(dir)
    assert.match(a, /^sha256:[0-9a-f]{64}$/)
    assert.equal(
      a,
      b,
      'same dist → same digest (multi-machine safety depends on this)'
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('computeFoundationDigest changes when uploaded code changes', () => {
  const dir = makeDist()
  try {
    const before = computeFoundationDigest(dir)
    writeFileSync(join(dir, 'entry.js'), 'export default 43\n')
    assert.notEqual(computeFoundationDigest(dir), before)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('computeFoundationDigest changes when meta/schema.json changes (schema is part of the fingerprint)', () => {
  const dir = makeDist()
  try {
    const before = computeFoundationDigest(dir)
    writeFileSync(
      join(dir, 'meta', 'schema.json'),
      '{"_self":{"version":"9.9.9"}}\n'
    )
    assert.notEqual(computeFoundationDigest(dir), before)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('computeFoundationDigest is filename-independent — same contents, different chunk name → same digest', () => {
  const a = mkdtempSync(join(tmpdir(), 'uw-dist-a-'))
  const b = mkdtempSync(join(tmpdir(), 'uw-dist-b-'))
  try {
    for (const dir of [a, b]) {
      writeFileSync(join(dir, 'entry.js'), 'export default 42\n')
      mkdirSync(join(dir, 'meta'))
      writeFileSync(join(dir, 'meta', 'schema.json'), '{"_self":{}}\n')
    }
    // Identical bytes under a different content-hashed chunk filename.
    writeFileSync(join(a, 'chunk-AAAA.js'), 'export const x = 1\n')
    writeFileSync(join(b, 'chunk-BBBB.js'), 'export const x = 1\n')
    assert.equal(computeFoundationDigest(a), computeFoundationDigest(b))
  } finally {
    rmSync(a, { recursive: true, force: true })
    rmSync(b, { recursive: true, force: true })
  }
})

test('computeFoundationDigest excludes *.map — a sourcemap change does not perturb it', () => {
  const dir = makeDist()
  try {
    const before = computeFoundationDigest(dir)
    writeFileSync(join(dir, 'entry.js.map'), '{"version":3,"changed":true}\n')
    assert.equal(computeFoundationDigest(dir), before)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('computeFoundationDigest returns null when there is nothing to hash', () => {
  const dir = mkdtempSync(join(tmpdir(), 'uw-dist-empty-'))
  try {
    assert.equal(computeFoundationDigest(dir), null)
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
    { path: 'entry.js.map' }
  ]).map((f) => f.path)
  assert.equal(order[order.length - 1], ENTRY_PATH)
  assert.equal(order.length, 3)
})

// Regression guard, replacing a test that asserted the opposite. This module used
// to export `gatewayUrl()`, which rebuilt the backend's serve path from the ref;
// the old test pinned that route shape verbatim — in a public package — and so
// made reintroducing the coupling look like passing behaviour. A serve location is
// read from the upload plan's `serve_base` or not known at all.
test('exports no serve-URL builder (locations are read, never constructed)', () => {
  const builders = Object.keys(codeUpload).filter((k) => /url|Url|URL/.test(k))
  assert.deepEqual(builders, [])
})

test('uploadFoundationCode plans, PUTs entry-last, verifies against the plan serve_base', async () => {
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
          // Deliberately NOT the real backend's serve shape. The point of the
          // contract is that the producer uses whatever location it is handed,
          // so the test hands it an arbitrary one — if this ever has to match a
          // real route for the test to pass, the coupling is back.
          serve_base: '/served/somewhere/else/',
          uploads: body.files.map((f) => ({
            path: f.path,
            method: 'PUT',
            url: `http://localhost:8080/dev/registry/code/std/starter/1.0.2/${f.path}`,
            headers: { 'content-type': f.content_type }
          }))
        })
      }
    }
    if (opts.method === 'PUT') {
      assert.ok(
        opts.headers['x-uniweb-sha256'],
        'integrity header rides every PUT'
      )
      return { ok: true, status: 200, text: async () => '' }
    }
    // the verification GET of the entry
    return {
      ok: true,
      status: 200,
      arrayBuffer: async () =>
        new TextEncoder().encode('export default 42\n').buffer
    }
  }
  try {
    const result = await uploadFoundationCode({
      apiBase: 'http://localhost:8080',
      token: 't',
      name: '@std/starter',
      version: '1.0.2',
      distDir: dir
    })
    assert.equal(result.failed.length, 0)
    assert.equal(result.uploaded.length, 3) // entry.js, runtime-pin.json, assets/style.css (meta/ + .map excluded)
    assert.equal(result.verified, true)
    const puts = calls.filter((c) => c.method === 'PUT').map((c) => c.url)
    assert.ok(
      puts[puts.length - 1].endsWith('/entry.js'),
      'entry uploaded last'
    )
    const gets = calls.filter((c) => c.method === 'GET')
    assert.ok(
      gets.some(
        (c) =>
          c.url === 'http://localhost:8080/served/somewhere/else/entry.js'
      ),
      'verification fetch resolves the plan serve_base against the origin'
    )
  } finally {
    globalThis.fetch = realFetch
    rmSync(dir, { recursive: true, force: true })
  }
})

test('uploadFoundationCode does NOT verify when the plan returns no serve_base', async () => {
  // The case that used to guess. When a delivery tier owns the URL the backend
  // returns serve_base: null, and the producer has no way to know where the
  // bytes will be readable — so it reports "not verified" rather than deriving a
  // location. Previously this path silently fell back to a reconstructed route,
  // which could only ever be right on a deployment where the backend also serves.
  const dir = makeDist()
  const calls = []
  const realFetch = globalThis.fetch
  globalThis.fetch = async (url, opts = {}) => {
    calls.push({ url: String(url), method: opts.method || 'GET' })
    if (String(url).endsWith('/dev/registry/code-uploads')) {
      const body = JSON.parse(opts.body)
      return {
        ok: true,
        status: 200,
        json: async () => ({
          mode: 'presigned',
          expires_in: 900,
          serve_base: null,
          uploads: body.files.map((f) => ({
            path: f.path,
            method: 'PUT',
            url: `https://example-object-store.test/${f.path}?sig=x`,
            headers: {}
          }))
        })
      }
    }
    if (opts.method === 'PUT') return { ok: true, status: 200, text: async () => '' }
    throw new Error('no GET should be attempted without a serve_base')
  }
  try {
    const result = await uploadFoundationCode({
      apiBase: 'http://localhost:8080',
      token: 't',
      name: '@std/starter',
      version: '1.0.2',
      distDir: dir
    })
    assert.equal(result.failed.length, 0)
    assert.equal(result.uploaded.length, 3)
    assert.equal(result.verified, null, 'unverifiable, not falsely verified')
    assert.equal(result.serveBase, null)
    assert.equal(
      calls.filter((c) => c.method === 'GET').length,
      0,
      'no verification fetch is attempted'
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
          uploads: body.files.map((f) => ({
            path: f.path,
            method: 'PUT',
            url: `http://x/${f.path}`
          }))
        })
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
      distDir: dir
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
          serve_base: '/served/code/@std/starter/1.0.2/',
          uploads: body.files.map((f) => ({
            path: f.path,
            method: 'PUT',
            url: `/dev/registry/code/std/starter/1.0.2/${f.path}`
          }))
        })
      }
    }
    if (opts.method === 'PUT')
      return { ok: true, status: 200, text: async () => '' }
    gets.push(String(url))
    return {
      ok: true,
      status: 200,
      arrayBuffer: async () =>
        new TextEncoder().encode('export default 42\n').buffer
    }
  }
  try {
    const result = await uploadFoundationCode({
      apiBase: 'http://localhost:8080',
      token: 't',
      name: '@std/starter',
      version: '1.0.2',
      distDir: dir
    })
    assert.equal(result.verified, true)
    assert.deepEqual(gets, [
      'http://localhost:8080/served/code/@std/starter/1.0.2/entry.js'
    ])
  } finally {
    globalThis.fetch = realFetch
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('readRuntimePin — the compatibility floor a foundation states', () => {
  /**
   * Until this existed, `dist/runtime-pin.json` was written by the build and
   * read by nothing, so a floor could never reach anyone able to act on it.
   * A consumer storing the value had no way to ever receive one.
   */
  test('reads the runtime version from a built dist/', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pin-'))
    writeFileSync(join(dir, 'runtime-pin.json'), '{"runtime":"0.9.8","policy":"auto-minor"}\n')
    assert.equal(readRuntimePin(dir), '0.9.8')
  })

  /**
   * ⚠️ null is UNKNOWN, not unconstrained. Every one of these is a floor nobody
   * stated, and a floor nobody stated cannot be shown to be satisfied — a
   * consumer's max() that skips nulls computes a floor over only the
   * foundations that happened to declare one, then reports the site compatible.
   */
  test('returns null for absent, malformed, or empty — all meaning "unknown"', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pin-'))
    assert.equal(readRuntimePin(dir), null, 'no pin file at all')

    writeFileSync(join(dir, 'runtime-pin.json'), '{ not json')
    assert.equal(readRuntimePin(dir), null, 'unparseable')

    writeFileSync(join(dir, 'runtime-pin.json'), '{"policy":"exact"}')
    assert.equal(readRuntimePin(dir), null, 'policy but no runtime')

    writeFileSync(join(dir, 'runtime-pin.json'), '{"runtime":""}')
    assert.equal(readRuntimePin(dir), null, 'empty string is not a version')

    writeFileSync(join(dir, 'runtime-pin.json'), '{"runtime":{"version":"0.9.8"}}')
    assert.equal(readRuntimePin(dir), null, 'wrong type rather than coerced')
  })
})
