/**
 * Bring-along names a foundation the way `register` does, and says what decides
 * a version that is not newer than the registered one.
 *
 * `push` and `publish` look the local foundation up in the catalog before
 * shipping. `register` submits it under `uniweb.id` when the package sets one
 * (the build reads `uniweb.id || name`), so the lookup and the pinned ref must
 * use the same name — otherwise the foundation reads as never released, is
 * re-released on every push, and the site is pinned to a name the catalog lacks.
 *
 * A registry takes a new version only when it is greater than every version it
 * holds. An older local version may still be one it already has, so bring-along
 * cannot refuse it; it has to say so instead of calling it a new version.
 *
 * Run: `pnpm test` or `node --test test/`
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { bringFoundationAlong } from '../src/backend/foundation-bring-along.js'
import { computeFoundationDigest } from '../src/utils/code-upload.js'

/** site/ beside a local foundation in src/, with a fake CLI so nothing real is spawned. */
function workspace(pkg) {
  const ws = mkdtempSync(join(tmpdir(), 'bring-along-'))
  const site = join(ws, 'site')
  const fnd = join(ws, 'src')
  mkdirSync(site, { recursive: true })
  mkdirSync(join(fnd, 'dist'), { recursive: true })
  writeFileSync(join(site, 'site.yml'), 'name: Acme\nfoundation: src\n')
  writeFileSync(join(fnd, 'package.json'), JSON.stringify(pkg))
  writeFileSync(join(fnd, 'dist', 'entry.js'), 'export default {}\n')
  const cliBin = join(ws, 'fake-cli.js')
  writeFileSync(cliBin, 'process.exit(0)\n')
  chmodSync(cliBin, 0o755)
  return { ws, site, fnd, cliBin }
}

function recorder() {
  const said = { ok: [], info: [], warn: [], err: [], dim: [] }
  const say = Object.fromEntries(Object.keys(said).map((k) => [k, (m) => said[k].push(m)]))
  return { said, say }
}

async function run({ ws, site, cliBin }, client) {
  const { said, say } = recorder()
  try {
    const res = await bringFoundationAlong({
      client,
      siteDir: site,
      siteYml: { foundation: 'src' },
      args: ['--non-interactive'],
      say,
      confirm: async () => {
        throw new Error('must not prompt')
      },
      cliBin,
      verb: 'push'
    })
    return { res, said }
  } finally {
    rmSync(ws, { recursive: true, force: true })
  }
}

test('a foundation with uniweb.id is looked up and pinned under that id', async () => {
  const fixture = workspace({ name: 'src', version: '1.0.0', uniweb: { scope: '@acme', id: 'docs' } })
  const digest = computeFoundationDigest(join(fixture.fnd, 'dist'))
  const looked = []
  const client = {
    readFoundationLatest: async (name) => {
      looked.push(name)
      // Only the name `register` used is in the catalog.
      return name === '@acme/docs' ? { latest_version: '1.0.0', digest } : null
    }
  }
  const { res, said } = await run(fixture, client)
  assert.deepEqual(looked, ['@acme/docs'])
  assert.equal(res.released, false, 'unchanged since release — nothing to re-release')
  assert.equal(res.ref, '@acme/docs@1.0.0')
  assert.ok(said.dim.some((m) => /unchanged since release/.test(m)), JSON.stringify(said))
})

test('uniweb.scope without its @ is looked up and pinned under @org, as register names it', async () => {
  // `register` reads `acme` and `@acme` alike and registers `@acme/base`; a lookup that
  // joined the raw value asked the catalog for `acme/base` and pinned the site to it.
  const fixture = workspace({ name: 'base', version: '1.0.0', uniweb: { scope: 'acme' } })
  const looked = []
  const client = {
    readFoundationLatest: async (name) => {
      looked.push(name)
      return null
    }
  }
  const { res } = await run(fixture, client)
  assert.deepEqual(looked, ['@acme/base'])
  assert.equal(res.ref, '@acme/base@1.0.0')
})

test('CONTROL: without uniweb.id the package name is the catalog name', async () => {
  const fixture = workspace({ name: 'base', version: '1.0.0', uniweb: { scope: '@acme' } })
  const looked = []
  const client = {
    readFoundationLatest: async (name) => {
      looked.push(name)
      return null
    }
  }
  const { res } = await run(fixture, client)
  assert.deepEqual(looked, ['@acme/base'])
  assert.equal(res.ref, '@acme/base@1.0.0')
})

const registered = (latest_version) => ({
  readFoundationLatest: async () => ({ latest_version, digest: 'sha256:not-the-local-code' })
})

test('a local version older than the registered latest is not called a new version', async () => {
  const { res, said } = await run(workspace({ name: '@acme/base', version: '1.4.1' }), registered('1.4.2'))
  assert.equal(res.proceed, true, 'still submitted — the registry decides')
  const line = said.info.join('\n')
  assert.match(line, /not newer than the registered latest 1\.4\.2/)
  assert.doesNotMatch(line, /new version/)
})

test('a version equal in precedence (build metadata only) is not newer either', async () => {
  const { said } = await run(workspace({ name: '@acme/base', version: '1.4.2+build.7' }), registered('1.4.2'))
  assert.match(said.info.join('\n'), /not newer than the registered latest/)
})

test('CONTROL: a greater version is still released as a new version', async () => {
  const { res, said } = await run(workspace({ name: '@acme/base', version: '1.5.0' }), registered('1.4.2'))
  assert.equal(res.proceed, true)
  assert.match(said.info.join('\n'), /new version; registered latest is 1\.4\.2/)
})
