/**
 * Deploy destination resolution — how `uniweb deploy` decides WHERE a site
 * goes before it does anything irreversible.
 *
 * Three inputs feed the decision and they do not have equal weight:
 *
 *   --host <name>   explicit; wins outright
 *   --host          (no value) an explicit "ask me"; must outrank deploy.yml
 *   (flag absent)   deploy.yml's target wins, else the wizard asks
 *
 * The middle case is the subtle one and it regressed once: because
 * `readFlagValue` returns `null` for a valueless flag and `undefined` when
 * absent, a truthiness check collapsed the two. Bare `--host` then silently
 * used deploy.yml's host — and under --non-interactive it went ahead and
 * BUILT AND DEPLOYED to a destination the user was in the middle of
 * overriding. These tests pin the distinction.
 *
 * Driven through the real binary because the bug lived in argv handling, and
 * a unit test of the resolver would have parsed argv the same wrong way.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const CLI = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'src',
  'index.js'
)

/** A minimal site directory, optionally carrying a deploy.yml. */
function makeSite({ deployYml = null } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'uniweb-deploy-dest-'))
  writeFileSync(join(dir, 'site.yml'), 'title: Test\nfoundation: src\n')
  mkdirSync(join(dir, 'pages'), { recursive: true })
  // A non-empty dist/ so any accidental deploy attempt gets far enough to
  // be visible in stdout rather than bailing early on a missing build.
  mkdirSync(join(dir, 'dist'), { recursive: true })
  writeFileSync(join(dir, 'dist', 'index.html'), '<h1>x</h1>')
  if (deployYml) writeFileSync(join(dir, 'deploy.yml'), deployYml)
  return dir
}

const S3_TARGET = `default: production
targets:
  production:
    host: s3-cloudfront
    bucket: b
    distributionId: d
    region: r
`

/** Run the CLI, returning { code, out }. Never throws on non-zero. */
function runDeploy(cwd, args) {
  try {
    const out = execFileSync('node', [CLI, 'deploy', ...args], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, UNIWEB_SKIP_BUILD: '1', NO_COLOR: '1' }
    })
    return { code: 0, out }
  } catch (err) {
    return {
      code: err.status ?? 1,
      out: `${err.stdout || ''}${err.stderr || ''}`
    }
  }
}

test('bare --host outranks deploy.yml and refuses to guess when it cannot ask', () => {
  const dir = makeSite({ deployYml: S3_TARGET })
  try {
    const { code, out } = runDeploy(dir, ['--host', '--non-interactive'])
    assert.equal(code, 1, 'must not proceed')
    assert.match(out, /--host` requires a value when running non-interactively/)
    assert.match(out, /Known adapters:/)
    // The regression: silently falling through to deploy.yml's host and
    // deploying there. Nothing about s3 should appear, and no build.
    assert.doesNotMatch(out, /Building site/)
    assert.doesNotMatch(out, /would deploy via host adapter/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('an omitted --host lets deploy.yml decide', () => {
  const dir = makeSite({ deployYml: S3_TARGET })
  try {
    const { code, out } = runDeploy(dir, ['--dry-run'])
    assert.equal(code, 0)
    assert.match(out, /s3-cloudfront/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('an explicit --host=<name> overrides deploy.yml', () => {
  const dir = makeSite({ deployYml: S3_TARGET })
  try {
    const { code, out } = runDeploy(dir, [
      '--host=cloudflare-pages',
      '--dry-run'
    ])
    assert.equal(code, 0)
    assert.match(out, /cloudflare-pages/)
    assert.doesNotMatch(out, /would deploy via host adapter: s3-cloudfront/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('no destination anywhere: names the real options instead of assuming one', () => {
  const dir = makeSite()
  try {
    const { code, out } = runDeploy(dir, ['--non-interactive'])
    assert.equal(code, 1)
    assert.match(out, /needs a destination/)
    // Every escape route the user actually has, including CI setup — the
    // point of the message is that no host is assumed.
    assert.match(out, /uniweb publish/)
    assert.match(out, /uniweb deploy --host/)
    assert.match(out, /uniweb add ci/)
    assert.match(out, /uniweb export/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('every adapter reachable by --host can be acted on, not just resolved', () => {
  // Locks out the shipped bug where the picker offered six adapters but
  // five had no deploy hook, so choosing them dead-ended after the build.
  const dir = makeSite()
  try {
    for (const host of [
      'github-pages',
      'cloudflare-pages',
      'netlify',
      'vercel',
      's3-cloudfront'
    ]) {
      const { out } = runDeploy(dir, [`--host=${host}`, '--dry-run'])
      assert.doesNotMatch(
        out,
        /does not implement a deploy step/,
        `${host} should have a deploy hook`
      )
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
