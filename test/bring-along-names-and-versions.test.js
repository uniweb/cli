/**
 * Bring-along names a foundation the way `register` does, and says what decides
 * a version that is not newer than the registered one.
 *
 * `push` and `publish` look the local foundation up in the catalog before
 * shipping. `register` submits it under its name — `main.js`'s `name`, else the
 * package's (`readFoundationName`, the rule the build reads) — so the lookup and
 * the pinned ref must use the same name — otherwise the foundation reads as never
 * released, is re-released on every push, and the site is pinned to a name the
 * catalog lacks. A name that cannot register (`src`, `foundation`) is not looked
 * up at all: the `@org/src` in the catalog is some other project's.
 *
 * A registry takes a new version only when it is greater than every version it
 * holds. A local version OLDER than the registered latest stops the push: that
 * version was released from another copy, whose code this one may not have
 * (2026-09-24; it was submitted for the registry to decide until then). One equal
 * in precedence is the registered version itself.
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

/**
 * site/ beside a local foundation in src/ (flat layout; `main` is main.js's content
 * when given), with a fake CLI so nothing real is spawned.
 */
function workspace(pkg, { main } = {}) {
  const ws = mkdtempSync(join(tmpdir(), 'bring-along-'))
  const site = join(ws, 'site')
  const fnd = join(ws, 'src')
  mkdirSync(site, { recursive: true })
  mkdirSync(join(fnd, 'dist'), { recursive: true })
  writeFileSync(join(site, 'site.yml'), 'name: Acme\nfoundation: src\n')
  writeFileSync(join(fnd, 'package.json'), JSON.stringify({ main: './_entry.generated.js', ...pkg }))
  if (main) writeFileSync(join(fnd, 'main.js'), main)
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

test('a foundation named in main.js is looked up and pinned under that name — scope and all', async () => {
  // ⭐ The scope is part of the name (2026-09-22): `@acme/docs` is what `register`
  // registers, so it is what the catalog is asked for.
  const fixture = workspace(
    { name: 'src', version: '1.0.0' },
    { main: "export default { name: '@acme/docs' }\n" }
  )
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

test('a BARE name has not registered — it is released, not looked up', async () => {
  // `register` writes the scope it registers under into the name, so a bare name
  // names nothing in any catalog yet.
  const fixture = workspace({ name: 'base', version: '1.0.0' }, { main: "export default { name: 'base' }\n" })
  const looked = []
  const client = {
    readFoundationLatest: async (name) => {
      looked.push(name)
      return { latest_version: '1.0.0', digest: 'sha256:another-project' }
    }
  }
  const { res } = await run(fixture, client)
  assert.deepEqual(looked, [])
  assert.equal(res.released, true)
})

test('⛔ a leftover uniweb.scope is not looked up — register says to move it into the name', async () => {
  // Retired 2026-09-22. It read as unreleased here, and `register` refuses it with the
  // `main.js` line that replaces it, so nothing is pinned under a name made from it.
  const fixture = workspace({ name: 'base', version: '1.0.0', uniweb: { scope: 'acme' } })
  const looked = []
  const client = {
    readFoundationLatest: async (name) => {
      looked.push(name)
      return null
    }
  }
  const { res } = await run(fixture, client)
  assert.deepEqual(looked, [])
  assert.equal(res.ref, null)
})

test('⛔ a foundation named src is not looked up — the @org/src there is not its', async () => {
  // No main.js name, package name `src`: releasing is how it gets one (`register`
  // asks, or refuses naming the fix), so bring-along releases rather than binding
  // to whatever another project registered as `@acme/src`.
  const fixture = workspace({ name: 'src', version: '1.0.0' })
  const looked = []
  const client = {
    readFoundationLatest: async (name) => {
      looked.push(name)
      return { latest_version: '1.0.0', digest: 'sha256:another-project' }
    }
  }
  const { res } = await run(fixture, client)
  assert.deepEqual(looked, [])
  assert.equal(res.released, true)
  assert.equal(res.ref, null, 'still unnamed after the (fake) register — nothing to pin')
})

test('⛔ a leftover uniweb.id is not looked up either — register says where the name went', async () => {
  const fixture = workspace({ name: 'src', version: '1.0.0', uniweb: { id: 'docs' } })
  const looked = []
  const client = {
    readFoundationLatest: async (name) => {
      looked.push(name)
      return null
    }
  }
  const { res } = await run(fixture, client)
  assert.deepEqual(looked, [])
  assert.equal(res.ref, null)
})

test('CONTROL: without a main.js name the package name is the catalog name', async () => {
  const fixture = workspace({ name: '@acme/base', version: '1.0.0' })
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

test('a local version older than the registered latest stops — it is not called a new version', async () => {
  const { res, said } = await run(workspace({ name: '@acme/base', version: '1.4.1' }), registered('1.4.2'))
  assert.equal(res.proceed, false)
  assert.equal(res.refused, true)
  assert.match(said.err.join('\n'), /1\.4\.2, newer than your 1\.4\.1/)
  assert.doesNotMatch(said.info.join('\n'), /new version/)
})

test('a version equal in precedence (build metadata only) is the registered one — its change goes under the next', async () => {
  const { res, said } = await run(workspace({ name: '@acme/base', version: '1.4.2+build.7' }), registered('1.4.2'))
  assert.equal(res.bumped, '1.4.3')
  assert.match(said.info.join('\n'), /as 1\.4\.3/)
})

test('CONTROL: a greater version is still released as a new version', async () => {
  const { res, said } = await run(workspace({ name: '@acme/base', version: '1.5.0' }), registered('1.4.2'))
  assert.equal(res.proceed, true)
  assert.match(said.info.join('\n'), /new version; registered latest is 1\.4\.2/)
})
