/**
 * Runtime registration (`uniweb runtime register`) — unit-pins runtime-upload.js
 * against the ASSUMED /dev/registry/runtime contract: collect (dist/app/** +
 * worker-runtime.js + shims/*.js, *.map excluded) → plan → PUT-per-file (mode-aware
 * auth + sha256), serve_base back. Mock-backed fetch; a temp dist/ as the real artifact.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { collectRuntimeFiles, hasWorkerRuntime, hasShims, uploadRuntime } from '../src/utils/runtime-upload.js'

const sha = (s) => createHash('sha256').update(s).digest('hex')

function makeDist({ app = true, worker = true, shims = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'uw-rt-'))
  const distDir = join(dir, 'dist')
  mkdirSync(distDir, { recursive: true })
  if (app) {
    mkdirSync(join(distDir, 'app', 'assets'), { recursive: true })
    writeFileSync(join(distDir, 'app', 'index.html'), '<html></html>')
    writeFileSync(join(distDir, 'app', 'manifest.json'), '{"v":1}')
    writeFileSync(join(distDir, 'app', 'assets', 'main.js'), 'console.log(1)')
    writeFileSync(join(distDir, 'app', 'assets', 'main.js.map'), '{"version":3}') // excluded
  }
  if (worker) writeFileSync(join(distDir, 'worker-runtime.js'), 'export const ssr=1')
  if (shims) {
    mkdirSync(join(distDir, 'shims'), { recursive: true })
    writeFileSync(join(distDir, 'shims', 'react.js'), 'export default {}')
    writeFileSync(join(distDir, 'shims', 'react-jsx-runtime.js'), 'export const jsx=0')
    writeFileSync(join(distDir, 'shims', 'uniweb-core.js'), 'export const Uniweb=0')
    writeFileSync(join(distDir, 'shims', 'react.js.map'), '{"version":3}') // excluded
  }
  return { dir, distDir }
}

test('collectRuntimeFiles gathers dist/app/** + worker-runtime.js, excludes *.map', () => {
  const { dir, distDir } = makeDist()
  try {
    const paths = collectRuntimeFiles(distDir).map((f) => f.path).sort()
    assert.deepEqual(paths, ['assets/main.js', 'index.html', 'manifest.json', 'worker-runtime.js'])
    const files = collectRuntimeFiles(distDir)
    assert.ok(!files.some((f) => f.path.endsWith('.map')), 'sourcemaps excluded')
    assert.equal(files.find((f) => f.path === 'index.html').content_type, 'text/html')
    assert.equal(files.find((f) => f.path === 'manifest.json').sha256, sha('{"v":1}'))
    assert.equal(hasWorkerRuntime(files), true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('collectRuntimeFiles returns [] when dist/app is missing', () => {
  const { dir, distDir } = makeDist({ app: false })
  try {
    assert.deepEqual(collectRuntimeFiles(distDir), [])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('hasWorkerRuntime is false when the worker bundle is absent', () => {
  const { dir, distDir } = makeDist({ worker: false })
  try {
    assert.equal(hasWorkerRuntime(collectRuntimeFiles(distDir)), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('collectRuntimeFiles gathers dist/shims/*.js as part of the ssr-edge set, excludes *.map', () => {
  const { dir, distDir } = makeDist({ shims: true })
  try {
    const files = collectRuntimeFiles(distDir)
    const paths = files.map((f) => f.path).sort()
    assert.deepEqual(paths, [
      'assets/main.js', 'index.html', 'manifest.json',
      'shims/react-jsx-runtime.js', 'shims/react.js', 'shims/uniweb-core.js',
      'worker-runtime.js',
    ])
    assert.ok(!files.some((f) => f.path.endsWith('.map')), 'shim sourcemaps excluded')
    assert.equal(files.find((f) => f.path === 'shims/react.js').content_type, 'text/javascript')
    assert.equal(hasShims(files), true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('hasShims is false when shims/ is absent (incomplete ssr-edge set)', () => {
  const { dir, distDir } = makeDist({ worker: true, shims: false })
  try {
    const files = collectRuntimeFiles(distDir)
    assert.equal(hasWorkerRuntime(files), true)
    assert.equal(hasShims(files), false, 'worker present but shims missing → incomplete')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('uploadRuntime plans /dev/registry/runtime, PUTs each (relative url resolved + auth), returns serveBase', async () => {
  const { dir, distDir } = makeDist()
  const calls = []
  const realFetch = globalThis.fetch
  globalThis.fetch = async (url, opts = {}) => {
    calls.push({ url: String(url), method: opts.method || 'GET', headers: opts.headers || {} })
    if (String(url).endsWith('/dev/registry/runtime')) {
      const body = JSON.parse(opts.body)
      assert.equal(body.version, '0.9.0')
      assert.ok(body.files.every((f) => f.sha256 && f.path))
      return {
        ok: true, status: 200,
        json: async () => ({
          mode: 'direct',
          serve_base: '/gateway/runtime/0.9.0/',
          uploads: body.files.map((f) => ({
            path: f.path, method: 'PUT', url: `/dev/registry/runtime/blob/${f.sha256}`, headers: {},
          })),
        }),
      }
    }
    assert.equal(opts.method, 'PUT')
    assert.ok(opts.headers['x-uniweb-sha256'], 'integrity header rides every PUT')
    assert.ok(opts.headers.Authorization, 'direct-mode PUT carries the bearer')
    return { ok: true, status: 200, text: async () => '' }
  }
  try {
    const result = await uploadRuntime({ apiBase: 'http://localhost:8080', token: 't', version: '0.9.0', distDir })
    assert.equal(result.failed.length, 0)
    assert.equal(result.uploaded.length, 4)
    assert.equal(result.serveBase, '/gateway/runtime/0.9.0/')
    const puts = calls.filter((c) => c.method === 'PUT')
    assert.ok(puts.every((c) => c.url.startsWith('http://localhost:8080/dev/registry/runtime/blob/')), 'relative url resolved')
  } finally {
    globalThis.fetch = realFetch
    rmSync(dir, { recursive: true, force: true })
  }
})

test('uploadRuntime throws with status 403 when the backend rejects a non-@std member', async () => {
  const { dir, distDir } = makeDist()
  const realFetch = globalThis.fetch
  globalThis.fetch = async () => ({ ok: false, status: 403, statusText: 'Forbidden', text: async () => 'not a member of @std' })
  try {
    await assert.rejects(
      () => uploadRuntime({ apiBase: 'http://localhost:8080', token: 't', version: '0.9.0', distDir }),
      (err) => err.status === 403 && /runtime plan rejected: HTTP 403/.test(err.message)
    )
  } finally {
    globalThis.fetch = realFetch
    rmSync(dir, { recursive: true, force: true })
  }
})

test('presigned mode attaches no auth header on the PUT', async () => {
  const { dir, distDir } = makeDist({ worker: false })
  let sawAuth = false
  const realFetch = globalThis.fetch
  globalThis.fetch = async (url, opts = {}) => {
    if (String(url).endsWith('/dev/registry/runtime')) {
      const body = JSON.parse(opts.body)
      return {
        ok: true, status: 200,
        json: async () => ({
          mode: 'presigned',
          uploads: body.files.map((f) => ({ path: f.path, method: 'PUT', url: `https://s3/${f.sha256}?sig=x`, headers: {} })),
        }),
      }
    }
    if (opts.headers?.Authorization) sawAuth = true
    return { ok: true, status: 200, text: async () => '' }
  }
  try {
    const result = await uploadRuntime({ apiBase: 'http://localhost:8080', token: 't', version: '0.9.0', distDir })
    assert.equal(result.mode, 'presigned')
    assert.equal(sawAuth, false, 'presigned PUT must not carry a foreign bearer')
  } finally {
    globalThis.fetch = realFetch
    rmSync(dir, { recursive: true, force: true })
  }
})
