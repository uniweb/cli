/**
 * The scaffolded CI toolchain must match the project's own.
 *
 * Two failures on a real GitHub Actions run drove this, both caused by CI
 * pinning a newer pnpm major than the project uses:
 *
 *   1. pnpm 11 + Node 20 → `ERR_UNKNOWN_BUILTIN_MODULE: node:sqlite`.
 *      pnpm 11 declares engines.node >=22.13; the CI node major came from
 *      the project's engines.node, and the workspace template declares
 *      >=20.19, so every scaffolded pnpm project got an uninstallable
 *      workflow.
 *   2. pnpm 11 refuses dependencies published in the last 24h, and changed
 *      build-script approval so `onlyBuiltDependencies` no longer suffices
 *      (`ERR_PNPM_IGNORED_BUILDS`) — which breaks any project using sharp.
 *
 * Neither is reachable from a local build; both need a real runner.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  resolveCiNodeVersion,
  resolveCiPnpmVersion,
  PNPM_VERSION,
  PNPM_MIN_NODE
} from '../src/versions.js'

test("the project's packageManager field decides the CI pnpm major", () => {
  assert.equal(resolveCiPnpmVersion({ packageManager: 'pnpm@10.30.0' }), '10')
  assert.equal(resolveCiPnpmVersion({ packageManager: 'pnpm@11.15.1' }), '11')
  // Corepack allows a hash suffix.
  assert.equal(
    resolveCiPnpmVersion({ packageManager: 'pnpm@10.30.0+sha512.abc' }),
    '10'
  )
})

test('an undeclared or non-pnpm packageManager falls back to the default major', () => {
  assert.equal(resolveCiPnpmVersion({}), PNPM_VERSION)
  assert.equal(resolveCiPnpmVersion(null), PNPM_VERSION)
  assert.equal(
    resolveCiPnpmVersion({ packageManager: 'yarn@4.0.0' }),
    PNPM_VERSION
  )
})

test('the default pnpm major tracks the current stable release', () => {
  // `pnpm@latest` is 11.x, so `npm i -g pnpm` gives a developer 11 and CI
  // should run what they run. This was briefly 10 while pnpm 11 could not
  // install a Uniweb project at all — the workspace template now emits
  // `allowBuilds` alongside `onlyBuiltDependencies`, so both majors work.
  //
  // Revisit when pnpm 12 goes stable: check its release notes for
  // install-time policy changes (11 added build-approval renaming and a
  // 24h minimum release age, both of which broke generated CI) and add its
  // engines.node to PNPM_MIN_NODE in the same commit.
  assert.equal(PNPM_VERSION, '11')
  assert.equal(PNPM_MIN_NODE['11'], 22, 'pnpm 11 declares engines.node >=22.13')
})

test('node floor follows the resolved pnpm major', () => {
  // pnpm 11 cannot start on Node 20 — the exact CI failure.
  assert.equal(resolveCiNodeVersion('>=20.19', 'pnpm', '11'), '22')
  // pnpm 10 runs on Node 18+, so the project's own floor stands.
  assert.equal(resolveCiNodeVersion('>=20.19', 'pnpm', '10'), '20')
  assert.equal(resolveCiNodeVersion(null, 'pnpm', '10'), '20')
})

test("a project's higher floor is respected, never clamped down", () => {
  assert.equal(resolveCiNodeVersion('>=24', 'pnpm', '11'), '24')
  assert.equal(resolveCiNodeVersion('>=24', 'pnpm', '10'), '24')
})

test('npm and yarn keep the project floor — no pnpm minimum applies', () => {
  assert.equal(resolveCiNodeVersion('>=20.19', 'npm'), '20')
  assert.equal(resolveCiNodeVersion('>=20.19', 'yarn'), '20')
  assert.equal(resolveCiNodeVersion(null, 'npm'), '20')
})

test('every supported pnpm major declares a node floor', () => {
  // Bumping PNPM_VERSION without adding its engines.node here would
  // silently reintroduce the node:sqlite class of failure.
  assert.ok(
    PNPM_MIN_NODE[PNPM_VERSION] !== undefined,
    `PNPM_VERSION is ${PNPM_VERSION} but PNPM_MIN_NODE has no entry for it — ` +
      `run \`npm view pnpm@${PNPM_VERSION} engines\` and add it.`
  )
})

test("@uniweb/build's fallback pnpm major agrees with the CLI's", async () => {
  // The two constants live in different packages — @uniweb/build cannot
  // import the CLI's (the dependency runs the other way), so the value is
  // duplicated. It drifted twice in one week: stale at '11' while the CLI
  // said '10', then stale at '10' when the CLI moved back to '11'.
  //
  // Generate a workflow WITHOUT passing a version, so the build package's
  // own fallback is what lands, and compare it to the CLI's authority.
  const { getAdapter } = await import('@uniweb/build/hosts')
  const result = await getAdapter('github-pages').initCi({
    site: { name: 'acme', path: 'site' },
    packageManager: 'pnpm'
    // pnpmVersion deliberately omitted → exercises the fallback
  })
  const emitted = result.files[0].content.match(
    /pnpm\/action-setup[\s\S]*?version: (\d+)/
  )?.[1]
  assert.equal(
    emitted,
    PNPM_VERSION,
    `@uniweb/build falls back to pnpm ${emitted} but the CLI resolves ${PNPM_VERSION} — ` +
      'update FALLBACK_PNPM_VERSION in build/src/hosts/ci-workflow.js to match.'
  )
})

/* ---------------------------------------------------------------- *
 * pnpm major: observed, never inferred from how the CLI was invoked  *
 * ---------------------------------------------------------------- */

test('what actually installed the project outranks the built-in default', async () => {
  // The default is a last resort, not a policy. A project installed with
  // pnpm 10 must get pnpm 10 in CI even while the default is 11 —
  // otherwise it lands in the one broken combination (pnpm 10 lockfile,
  // pnpm 11 CI), where CI rejects any dependency published in the last 24h.
  assert.equal(resolveCiPnpmVersion({}, '10'), '10')
  assert.equal(resolveCiPnpmVersion({}, '11'), '11')
})

test('an explicit packageManager outranks the installed version', () => {
  // The project stating its intent beats a record of one install — someone
  // mid-migration may have installed with the old major on purpose.
  assert.equal(
    resolveCiPnpmVersion({ packageManager: 'pnpm@11.15.1' }, '10'),
    '11'
  )
  assert.equal(
    resolveCiPnpmVersion({ packageManager: 'pnpm@10.30.0' }, '11'),
    '10'
  )
})

test('the default applies only when nothing can be observed', () => {
  assert.equal(resolveCiPnpmVersion({}, null), PNPM_VERSION)
  assert.equal(resolveCiPnpmVersion(null, null), PNPM_VERSION)
})

test('detectInstalledPnpmVersion reads the major pnpm recorded, or null', async () => {
  const { detectInstalledPnpmVersion } = await import('../src/utils/pm.js')
  const { mkdtempSync, mkdirSync, writeFileSync, rmSync } =
    await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')

  const dir = mkdtempSync(join(tmpdir(), 'uniweb-modules-'))
  try {
    assert.equal(
      detectInstalledPnpmVersion(dir),
      null,
      'no node_modules → null'
    )

    mkdirSync(join(dir, 'node_modules'), { recursive: true })
    // Current pnpm writes JSON despite the .yaml extension.
    writeFileSync(
      join(dir, 'node_modules', '.modules.yaml'),
      JSON.stringify(
        { nodeLinker: 'isolated', packageManager: 'pnpm@10.30.0' },
        null,
        2
      )
    )
    assert.equal(detectInstalledPnpmVersion(dir), '10')

    // The file is named .yaml and YAML permits the bare form, so accept
    // it too rather than depending on which serializer pnpm used. (Not a
    // format observed in the wild — defensive, and free.)
    writeFileSync(
      join(dir, 'node_modules', '.modules.yaml'),
      'nodeLinker: isolated\npackageManager: pnpm@11.15.1\n'
    )
    assert.equal(detectInstalledPnpmVersion(dir), '11')

    // A yarn/npm install leaves no such record.
    writeFileSync(
      join(dir, 'node_modules', '.modules.yaml'),
      'nodeLinker: isolated\n'
    )
    assert.equal(detectInstalledPnpmVersion(dir), null)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('never infers the pnpm major from how the CLI was invoked', () => {
  // `npm create uniweb` is the documented entry point and is commonly
  // followed by `pnpm install`, so the invoking manager says nothing about
  // the project's. resolveCiPnpmVersion takes only observed inputs — there
  // is no env/user-agent path into it, and this asserts that stays true.
  const before = process.env.npm_config_user_agent
  try {
    process.env.npm_config_user_agent =
      'pnpm/11.15.1 npm/? node/v22.0.0 darwin arm64'
    assert.equal(
      resolveCiPnpmVersion({}, '10'),
      '10',
      'invocation must not override the observed install'
    )
    assert.equal(
      resolveCiPnpmVersion({}, null),
      PNPM_VERSION,
      'invocation must not stand in for the default'
    )
  } finally {
    if (before === undefined) delete process.env.npm_config_user_agent
    else process.env.npm_config_user_agent = before
  }
})
