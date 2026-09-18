import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolvePlacement, SITE_KIND } from './src/utils/placement.js'

// `--path` is documented as a folder inside the workspace, and the result is
// consumed two different ways: the caller does join(rootDir, relativePath) to
// create the directory, while the workspace manifests record relativePath
// verbatim. An absolute path satisfied neither and nothing noticed — the site
// landed at <root>/tmp/... while package.json::workspaces and
// pnpm-workspace.yaml gained "/tmp/...", a path that exists on one machine.
// Reported by the backend lane 2026-09-18 from `clone --path <abs>`.

test('an absolute --path inside the workspace becomes root-relative', () => {
  const p = resolvePlacement('/ws', null, { path: '/ws/company/clonetest' }, SITE_KIND)
  assert.equal(p.relativePath, 'company/clonetest')
  assert.equal(p.packageName, 'clonetest')
  // The property that actually matters: it must not be absolute, because this
  // string is written into committed manifests.
  assert.ok(!p.relativePath.startsWith('/'), 'relativePath must never be absolute')
})

test('an absolute --path with a name still nests the name under it', () => {
  const p = resolvePlacement('/ws', 'docs', { path: '/ws/company' }, SITE_KIND)
  assert.equal(p.relativePath, 'company/docs')
  assert.equal(p.packageName, 'docs')
})

test('an absolute --path OUTSIDE the workspace is refused, not silently split', () => {
  const p = resolvePlacement('/ws', null, { path: '/tmp/clonetest' }, SITE_KIND)
  assert.equal(p.outsideRoot, '/tmp/clonetest')
  assert.equal(p.relativePath, null)
})

test('CONTROL — a relative --path is unchanged', () => {
  const p = resolvePlacement('/ws', null, { path: 'company/clonetest' }, SITE_KIND)
  assert.equal(p.relativePath, 'company/clonetest')
  assert.equal(p.packageName, 'clonetest')
  assert.equal(p.outsideRoot, undefined)
})
