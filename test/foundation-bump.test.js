/**
 * Changed foundation code is released under the next version — by default.
 *
 * [Diego, 2026-09-24] — a site whose project holds its own foundation is a content+code
 * bundle: *"a developer is used to code going with the site, so they don't think of
 * bumping the code of a site"*. A registered version is immutable, so code that changed
 * under a version the registry already holds is released under the next version above
 * it, written into the package's package.json first — for a person and an agent alike,
 * with no question and no flag. Until the same day this stopped: a terminal was asked,
 * a run without one refused, and `--yes` shipped the registered code.
 *
 * ⛔ One case still stops: a registered version NEWER than the local one — released from
 * another copy of the project, whose code this one may not have. `--bump` releases above
 * it; that is all `--bump` does, so a script can pass it on every run.
 *
 * Run: `pnpm test` or `node --test test/`
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { bringFoundationAlong } from '../src/backend/foundation-bring-along.js'
import { computeFoundationDigest } from '../src/utils/code-upload.js'

/**
 * site/ beside a local foundation in src/, whose package.json is 4-space indented so
 * a reflow would show. The fake CLI records the version package.json names each time
 * `register` runs, and fails that run while a `fail` file exists.
 */
function workspace(version) {
  const ws = mkdtempSync(join(tmpdir(), 'bump-'))
  const site = join(ws, 'site')
  const fnd = join(ws, 'src')
  mkdirSync(site, { recursive: true })
  mkdirSync(join(fnd, 'dist'), { recursive: true })
  writeFileSync(join(site, 'site.yml'), 'name: Acme\nfoundation: src\n')
  const pkg = {
    name: '@acme/base',
    version,
    type: 'module',
    dependencies: { '@uniweb/kit': '^0.9.0' }
  }
  const pkgText = JSON.stringify(pkg, null, 4) + '\n'
  writeFileSync(join(fnd, 'package.json'), pkgText)
  writeFileSync(join(fnd, 'dist', 'entry.js'), 'export default {}\n')
  const log = join(ws, 'register.log')
  const fail = join(ws, 'fail')
  const cliBin = join(ws, 'fake-cli.cjs')
  writeFileSync(
    cliBin,
    `const fs = require('node:fs')
if (process.argv[2] === 'register') {
  fs.appendFileSync(${JSON.stringify(log)}, JSON.parse(fs.readFileSync('package.json', 'utf8')).version + '\\n')
  if (fs.existsSync(${JSON.stringify(fail)})) process.exit(1)
}
`
  )
  return { ws, site, fnd, log, fail, cliBin, pkgText }
}

const localDigest = (fx) => computeFoundationDigest(join(fx.fnd, 'dist'))

async function run(fx, { args, latest, digest = 'sha256:not-the-local-code' }) {
  const said = { ok: [], info: [], warn: [], err: [], dim: [] }
  const say = Object.fromEntries(Object.keys(said).map((k) => [k, (m) => said[k].push(m)]))
  let error = null
  let res = null
  try {
    res = await bringFoundationAlong({
      client: { readFoundationLatest: async () => ({ latest_version: latest, digest }) },
      siteDir: fx.site,
      siteYml: { foundation: 'src' },
      args,
      say,
      confirm: async (q) => {
        throw new Error(`must not prompt: ${q}`)
      },
      cliBin: fx.cliBin,
      verb: 'push'
    })
  } catch (err) {
    error = err
  }
  return {
    res,
    error,
    said,
    pkgText: readFileSync(join(fx.fnd, 'package.json'), 'utf8'),
    registered: existsSync(fx.log) ? readFileSync(fx.log, 'utf8').trim().split('\n') : []
  }
}

/** Run with stdin looking like a terminal, the way a human's run does. */
async function atTerminal(fn) {
  const tty = process.stdin.isTTY
  const ci = process.env.CI
  process.stdin.isTTY = true
  delete process.env.CI
  try {
    return await fn()
  } finally {
    process.stdin.isTTY = tty
    if (ci === undefined) delete process.env.CI
    else process.env.CI = ci
  }
}

async function inWorkspace(version, fn) {
  const fx = workspace(version)
  try {
    return await fn(fx)
  } finally {
    rmSync(fx.ws, { recursive: true, force: true })
  }
}

const withWorkspace = (version, fn) => () => inWorkspace(version, fn)

test(
  'changed code under a registered version is released under the next one — written first',
  withWorkspace('1.4.2', async (fx) => {
    const { res, said, pkgText, registered } = await run(fx, {
      args: ['--non-interactive'],
      latest: '1.4.2'
    })
    assert.equal(res.proceed, true)
    assert.equal(res.released, true)
    assert.equal(res.bumped, '1.4.3')
    assert.equal(res.ref, '@acme/base@1.4.3', 'the site binds to the version just released')
    assert.deepEqual(registered, ['1.4.3'], 'register ran once, AFTER the version was written')
    // One line moved; the indentation, key order and trailing newline did not.
    assert.equal(pkgText, fx.pkgText.replace('"version": "1.4.2"', '"version": "1.4.3"'))
    const notes = said.dim.join('\n')
    assert.match(notes, /commit it/)
    assert.match(notes, /--no-release/, 'a release nobody asked for names the way out')
  })
)

test('the same at a terminal and with --yes — nobody is asked', async () => {
  // `confirm` throws in `run`, so any question fails the test.
  for (const [how, args, wrap] of [
    ['at a terminal', [], atTerminal],
    ['with --yes', ['--yes'], (fn) => fn()]
  ]) {
    await wrap(() =>
      inWorkspace('1.4.2', async (fx) => {
        const { res, error, registered } = await run(fx, { args, latest: '1.4.2' })
        assert.equal(error, null, `${how}: ${error?.message}`)
        assert.equal(res.bumped, '1.4.3', how)
        assert.deepEqual(registered, ['1.4.3'], how)
      })
    )
  }
})

test('--no-release keeps the registered code, and writes nothing', withWorkspace('1.4.2', async (fx) => {
  const { res, pkgText, registered } = await run(fx, {
    args: ['--no-release', '--non-interactive'],
    latest: '1.4.2'
  })
  assert.equal(res.proceed, true)
  assert.equal(res.released, false)
  assert.equal(res.ref, '@acme/base@1.4.2')
  assert.deepEqual(registered, [])
  assert.equal(pkgText, fx.pkgText)
}))

test('CONTROL: UNCHANGED code is not released, with --bump or without', async () => {
  for (const args of [['--non-interactive'], ['--bump', '--non-interactive']]) {
    await inWorkspace('1.4.2', async (fx) => {
      const { res, pkgText, registered } = await run(fx, {
        args,
        latest: '1.4.2',
        digest: localDigest(fx)
      })
      assert.equal(res.released, false, args.join(' '))
      assert.equal(res.bumped, undefined)
      assert.equal(res.ref, '@acme/base@1.4.2')
      assert.deepEqual(registered, [])
      assert.equal(pkgText, fx.pkgText)
    })
  }
})

test(
  'CONTROL: a local version above the registered one is released as it stands',
  withWorkspace('1.5.0', async (fx) => {
    const { res, pkgText, registered } = await run(fx, {
      args: ['--non-interactive'],
      latest: '1.4.2'
    })
    assert.equal(res.released, true)
    assert.equal(res.bumped, undefined)
    assert.deepEqual(registered, ['1.5.0'])
    assert.equal(pkgText, fx.pkgText)
  })
)

test('⛔ a NEWER registered version stops it — at a terminal or not, nothing written or sent', async () => {
  // Released from another copy of the project: releasing above it would make this
  // copy's older code the newest, and bind the site to it.
  for (const [how, wrap] of [
    ['no terminal', (fn) => fn()],
    ['at a terminal', atTerminal]
  ]) {
    await wrap(() =>
      inWorkspace('0.2.0', async (fx) => {
        const { res, error, said, pkgText, registered } = await run(fx, {
          args: how === 'no terminal' ? ['--non-interactive'] : [],
          latest: '0.2.1'
        })
        assert.equal(error, null, `${how}: ${error?.message}`)
        assert.equal(res.proceed, false, how)
        assert.equal(res.refused, true, 'a refusal, not a human declining')
        assert.match(said.err.join('\n'), /0\.2\.1, newer than your 0\.2\.0/)
        const ways = said.dim.join('\n')
        assert.match(ways, /Nothing was sent/)
        assert.match(ways, /`uniweb push --bump` — releases your code as 0\.2\.2/)
        assert.match(ways, /`uniweb push --no-release` — sends content bound to the released 0\.2\.1/)
        assert.deepEqual(registered, [])
        assert.equal(pkgText, fx.pkgText)
      })
    )
  }
})

test(
  '--bump releases above a newer registered version, and says whose it may be',
  withWorkspace('0.2.0', async (fx) => {
    const { res, said, registered } = await run(fx, {
      args: ['--bump', '--non-interactive'],
      latest: '0.2.1'
    })
    assert.equal(res.bumped, '0.2.2')
    assert.deepEqual(registered, ['0.2.2'])
    assert.ok(
      said.warn.some((m) => /0\.2\.1, newer than your/.test(m) && /someone else's release/.test(m)),
      JSON.stringify(said.warn)
    )
  })
)

test(
  'without a digest from the backend nothing is released — not even with --bump',
  withWorkspace('1.4.2', async (fx) => {
    // Nothing says the code changed. Releasing on no evidence would mint a version on
    // every push a script makes against such a backend.
    const { res, pkgText, registered } = await run(fx, {
      args: ['--bump', '--non-interactive'],
      latest: '1.4.2',
      digest: null
    })
    assert.equal(res.proceed, true)
    assert.equal(res.released, false)
    assert.deepEqual(registered, [])
    assert.equal(pkgText, fx.pkgText)
  })
)

test(
  '--bump with --no-release is refused before anything is read or written',
  withWorkspace('1.4.2', async (fx) => {
    const said = { ok: [], info: [], warn: [], err: [], dim: [] }
    const res = await bringFoundationAlong({
      client: {
        readFoundationLatest: async () => {
          throw new Error('must not reach the network')
        }
      },
      siteDir: fx.site,
      siteYml: { foundation: 'src' },
      args: ['--bump', '--no-release'],
      say: Object.fromEntries(Object.keys(said).map((k) => [k, (m) => said[k].push(m)])),
      confirm: async () => {
        throw new Error('must not prompt')
      },
      cliBin: fx.cliBin,
      verb: 'push'
    })
    assert.equal(res.proceed, false)
    assert.equal(res.refused, true)
    assert.match(said.err.join('\n'), /pass one of the two/)
    assert.equal(readFileSync(join(fx.fnd, 'package.json'), 'utf8'), fx.pkgText)
  })
)

test(
  'a registered version that is not SemVer: changed code is refused, and it says why',
  withWorkspace('build-7', async (fx) => {
    const { res, said, pkgText, registered } = await run(fx, {
      args: ['--non-interactive'],
      latest: 'build-7'
    })
    assert.equal(res.proceed, false)
    assert.equal(res.refused, true)
    assert.match(said.err.join('\n'), /not a SemVer version/)
    assert.deepEqual(registered, [])
    assert.equal(pkgText, fx.pkgText)
  })
)

test(
  'a failed release leaves the new version, and the next run releases it without counting up again',
  withWorkspace('1.4.2', async (fx) => {
    writeFileSync(fx.fail, '')
    const first = await run(fx, { args: ['--non-interactive'], latest: '1.4.2' })
    assert.ok(first.error, 'the failed release reaches the caller')
    assert.match(first.pkgText, /"version": "1\.4\.3"/)
    unlinkSync(fx.fail)
    // The registry still holds only 1.4.2, so 1.4.3 is a new version to it.
    const second = await run(fx, { args: ['--non-interactive'], latest: '1.4.2' })
    assert.equal(second.res.released, true)
    assert.equal(second.res.bumped, undefined, 'already above the registered one')
    assert.deepEqual(second.registered, ['1.4.3', '1.4.3'])
  })
)
