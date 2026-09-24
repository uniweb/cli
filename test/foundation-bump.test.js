/**
 * `--bump` — release a changed foundation under the next version.
 *
 * [Diego, 2026-09-24] — *"Bump before releasing"* · *"it sounds useful even with a
 * terminal"*. A registered version is immutable, so code that changed under a version
 * the registry already holds can only be released under a new one. Until now the
 * bring-along refused (no terminal) or asked whether to ship the OLD code (terminal),
 * and the new version was always the developer's hand edit.
 *
 * `--bump` writes the next version above the registered one into the package's
 * package.json and releases under it; at a terminal the same bump is offered first.
 * It acts only on what is known — a digest that differs, or a local version the
 * registry would not take as new — so on unchanged code it does nothing, which is what
 * makes it safe for a script to pass on every run.
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

async function run(fx, { args, latest, digest = 'sha256:not-the-local-code', answers }) {
  const said = { ok: [], info: [], warn: [], err: [], dim: [] }
  const say = Object.fromEntries(Object.keys(said).map((k) => [k, (m) => said[k].push(m)]))
  const asked = []
  let error = null
  let res = null
  try {
    res = await bringFoundationAlong({
      client: { readFoundationLatest: async () => ({ latest_version: latest, digest }) },
      siteDir: fx.site,
      siteYml: { foundation: 'src' },
      args,
      say,
      confirm: async (q, byDefault) => {
        if (!answers) throw new Error(`must not prompt: ${q}`)
        asked.push({ q, byDefault })
        return answers.shift()
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
    asked,
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

function withWorkspace(version, fn) {
  return async () => {
    const fx = workspace(version)
    try {
      await fn(fx)
    } finally {
      rmSync(fx.ws, { recursive: true, force: true })
    }
  }
}

test(
  '--bump: changed code under a registered version is released under the next one, written first',
  withWorkspace('1.4.2', async (fx) => {
    const { res, said, pkgText, registered } = await run(fx, {
      args: ['--bump', '--non-interactive'],
      latest: '1.4.2'
    })
    assert.equal(res.proceed, true)
    assert.equal(res.released, true)
    assert.equal(res.bumped, '1.4.3')
    assert.equal(res.ref, '@acme/base@1.4.3', 'the site binds to the version just released')
    assert.deepEqual(registered, ['1.4.3'], 'register ran once, AFTER the version was written')
    // One line moved; the indentation, key order and trailing newline did not.
    assert.equal(pkgText, fx.pkgText.replace('"version": "1.4.2"', '"version": "1.4.3"'))
    assert.ok(said.dim.some((m) => /commit it/.test(m)), JSON.stringify(said.dim))
  })
)

test(
  'CONTROL: --bump on UNCHANGED code does nothing — safe to pass on every run',
  withWorkspace('1.4.2', async (fx) => {
    const { res, pkgText, registered } = await run(fx, {
      args: ['--bump', '--non-interactive'],
      latest: '1.4.2',
      digest: localDigest(fx)
    })
    assert.equal(res.released, false)
    assert.equal(res.bumped, undefined)
    assert.equal(res.ref, '@acme/base@1.4.2')
    assert.deepEqual(registered, [])
    assert.equal(pkgText, fx.pkgText)
  })
)

test(
  'CONTROL: --bump with a local version already above the registered one releases it as is',
  withWorkspace('1.5.0', async (fx) => {
    const { res, pkgText, registered } = await run(fx, {
      args: ['--bump', '--non-interactive'],
      latest: '1.4.2'
    })
    assert.equal(res.released, true)
    assert.equal(res.bumped, undefined)
    assert.deepEqual(registered, ['1.5.0'])
    assert.equal(pkgText, fx.pkgText)
  })
)

test(
  '--bump when the registry holds a NEWER version: bumps above it, and says whose it might be',
  withWorkspace('0.2.0', async (fx) => {
    // The case a script meets on a database that outlived the files — and a teammate
    // meets on a stale checkout, which is why it is said at warn.
    const { res, said, registered } = await run(fx, {
      args: ['--bump', '--non-interactive'],
      latest: '0.2.1'
    })
    assert.equal(res.bumped, '0.2.2')
    assert.deepEqual(registered, ['0.2.2'])
    assert.ok(
      said.warn.some((m) => /0\.2\.1 is newer than your/.test(m) && /someone else's release/.test(m)),
      JSON.stringify(said.warn)
    )
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
  'with nobody to ask, the refusal names --bump and the version it would release',
  withWorkspace('1.4.2', async (fx) => {
    const { res, said, pkgText, registered } = await run(fx, {
      args: ['--non-interactive'],
      latest: '1.4.2'
    })
    assert.equal(res.proceed, false)
    assert.equal(res.refused, true)
    assert.match(said.dim.join('\n'), /`uniweb push --bump` — releases it as 1\.4\.3/)
    assert.deepEqual(registered, [])
    assert.equal(pkgText, fx.pkgText, 'a refusal writes nothing')
  })
)

test(
  '--bump is checked before --yes: it names what to do, --yes only says not to ask',
  withWorkspace('1.4.2', async (fx) => {
    const { res, registered } = await run(fx, { args: ['--bump', '--yes'], latest: '1.4.2' })
    assert.equal(res.bumped, '1.4.3')
    assert.deepEqual(registered, ['1.4.3'])
  })
)

test('at a terminal the bump is offered FIRST, yes by default', () =>
  atTerminal(
    withWorkspace('1.4.2', async (fx) => {
      const { res, asked, registered } = await run(fx, {
        args: [],
        latest: '1.4.2',
        answers: [true]
      })
      assert.equal(asked.length, 1)
      assert.match(asked[0].q, /Release your changes as 1\.4\.3\?/)
      assert.equal(asked[0].byDefault, true)
      assert.equal(res.bumped, '1.4.3')
      assert.deepEqual(registered, ['1.4.3'])
    })
  ))

test('at a terminal a no to the bump leads to the old question, and a no there writes nothing', () =>
  atTerminal(
    withWorkspace('1.4.2', async (fx) => {
      const { res, asked, pkgText, registered } = await run(fx, {
        args: [],
        latest: '1.4.2',
        answers: [false, false]
      })
      assert.equal(asked.length, 2)
      assert.match(asked[1].q, /Continue with the already-registered 1\.4\.2 anyway\?/)
      assert.equal(res.proceed, false)
      assert.deepEqual(registered, [])
      assert.equal(pkgText, fx.pkgText)
    })
  ))

test(
  'a failed release after a bump leaves the new version, and the next run releases it without bumping again',
  withWorkspace('1.4.2', async (fx) => {
    writeFileSync(fx.fail, '')
    const first = await run(fx, { args: ['--bump', '--non-interactive'], latest: '1.4.2' })
    assert.ok(first.error, 'the failed release reaches the caller')
    assert.match(first.pkgText, /"version": "1\.4\.3"/)
    unlinkSync(fx.fail)
    // The registry still holds only 1.4.2, so 1.4.3 is a new version to it.
    const second = await run(fx, { args: ['--bump', '--non-interactive'], latest: '1.4.2' })
    assert.equal(second.res.released, true)
    assert.equal(second.res.bumped, undefined, 'already above the registered one — no second bump')
    assert.deepEqual(second.registered, ['1.4.3', '1.4.3'])
  })
)

test(
  'without --bump, a version the registry refuses is followed by the --bump that would release it',
  withWorkspace('0.2.0', async (fx) => {
    writeFileSync(fx.fail, '')
    const { error, said } = await run(fx, { args: ['--non-interactive'], latest: '0.2.1' })
    assert.ok(error)
    assert.match(
      said.dim.join('\n'),
      /If the registry refused 0\.2\.0: `uniweb push --bump` releases your code as 0\.2\.2/
    )
  })
)

test(
  'CONTROL: a release that succeeds prints no --bump hint',
  withWorkspace('0.2.0', async (fx) => {
    const { res, said } = await run(fx, { args: ['--non-interactive'], latest: '0.2.1' })
    assert.equal(res.released, true)
    assert.doesNotMatch(said.dim.join('\n'), /--bump/)
  })
)
