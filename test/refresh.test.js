/**
 * uniweb refresh — the catch-up verb.
 *
 * A developer on a synced site has two independent external sources, git and the
 * backend, and used to have to know that. These pin the behaviour that makes the
 * command trustworthy: it never pushes, it says which sources it actually
 * consulted, it stops rather than layering two conflicts at once, and it exits
 * non-zero when work is left for a human.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { refresh } from '../src/commands/refresh.js'

const hasGit = (() => {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()

function site({ uuid = null, git = false, remote = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'uniweb-refresh-'))
  writeFileSync(
    join(dir, 'site.yml'),
    `${uuid ? `$uuid: ${uuid}\n` : ''}name: S\nfoundation: '@a/base'\n`
  )
  mkdirSync(join(dir, 'pages'), { recursive: true })
  if (git) {
    const g = (a) => execFileSync('git', a, { cwd: dir, stdio: 'ignore' })
    g(['init', '-q'])
    writeFileSync(join(dir, '.gitignore'), '.uniweb\n')
    g(['add', '-A'])
    execFileSync(
      'git',
      ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'base'],
      { cwd: dir, stdio: 'ignore' }
    )
    if (remote) g(['remote', 'add', 'origin', 'https://example.invalid/x.git'])
  }
  return dir
}

// Capture stdout so the report can be asserted — the report IS the feature for a
// command whose job is telling you where you stand.
function capture(fn) {
  const lines = []
  const origLog = console.log
  const origErr = console.error
  console.log = (...a) => lines.push(a.join(' '))
  console.error = (...a) => lines.push(a.join(' '))
  return fn()
    .finally(() => {
      console.log = origLog
      console.error = origErr
    })
    .then((r) => ({ r, out: lines.join('\n') }))
}

test('refresh names the sources it skipped rather than implying it checked everything', async () => {
  // "Up to date" is a different claim from "up to date with what I could reach".
  // Silently skipping a source is how someone concludes they are current when the
  // half that moved is the half that was skipped.
  const dir = site() // no git, never synced
  try {
    const { r, out } = await capture(() =>
      refresh([], {
        resolveSiteDir: async () => dir,
        pull: async () => ({ exitCode: 0 })
      })
    )
    assert.equal(r.exitCode, 0)
    assert.match(out, /Skipped: git \(not a repository\)/)
    assert.match(out, /Skipped: backend \(this site has never been synced\)/)
    assert.match(out, /Up to date/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test(
  'refresh skips git cleanly when the repo has no remote',
  { skip: !hasGit },
  async () => {
    const dir = site({ git: true })
    try {
      const { r, out } = await capture(() =>
        refresh([], {
          resolveSiteDir: async () => dir,
          pull: async () => ({ exitCode: 0 })
        })
      )
      assert.equal(r.exitCode, 0)
      assert.match(out, /Skipped: git \(no remote configured\)/)
      assert.match(out, /Commit : [0-9a-f]{8}/) // provenance still reported
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
)

test(
  'refresh STOPS on a git failure instead of layering the backend on top',
  { skip: !hasGit },
  async () => {
    // Two independent conflicts at once, with no clear order to address them in, is
    // worse than one. The unreachable remote stands in for any git-side failure.
    const dir = site({ uuid: 'SITE', git: true, remote: true })
    try {
      const { r, out } = await capture(() =>
        refresh([], {
          resolveSiteDir: async () => dir,
          pull: async () => ({ exitCode: 0 })
        })
      )
      assert.equal(r.exitCode, 1)
      assert.match(out, /git pull failed/)
      // …and it must not have gone on to touch the backend.
      assert.ok(!/Merging the backend/.test(out))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
)

test('refresh --no-git reaches the backend step and reports the skip', async () => {
  const dir = site({ uuid: 'SITE' })
  try {
    const { out } = await capture(() =>
      refresh(['--no-git'], {
        resolveSiteDir: async () => dir,
        pull: async () => ({ exitCode: 0 })
      })
    )
    assert.match(out, /Skipped: git \(--no-git\)/)
    assert.match(out, /Merging the backend/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('refresh never pushes — no push verb is reachable from it', async () => {
  // The property that lets it be run reflexively. Asserted on the source rather
  // than by mocking, because the guarantee is "there is no code path", not "this
  // particular run happened not to".
  const { readFileSync } = await import('node:fs')
  const src = readFileSync(
    new URL('../src/commands/refresh.js', import.meta.url),
    'utf8'
  )
  assert.ok(
    !/pushSyncPackages|publishSite|from '\.\/push\.js'|from '\.\/publish\.js'/.test(
      src
    )
  )
})

test('refresh forwards --backend and its value to the delegated pull', async () => {
  // `--backend http://x` is two argv entries. A naive filter forwards the flag and
  // drops the URL, so the pull silently targets the default backend while the user
  // believes they overrode it — wrong content, no error.
  const dir = site({ uuid: 'SITE' })
  try {
    let seen = null
    await capture(() =>
      refresh(['--no-git', '--backend', 'http://127.0.0.1:9999'], {
        resolveSiteDir: async () => dir,
        pull: async (a) => {
          seen = a
          return { exitCode: 0 }
        }
      })
    )
    assert.deepEqual(seen, ['--merge', '--backend', 'http://127.0.0.1:9999'])

    await capture(() =>
      refresh(['--no-git', '--backend=http://x'], {
        resolveSiteDir: async () => dir,
        pull: async (a) => {
          seen = a
          return { exitCode: 0 }
        }
      })
    )
    assert.deepEqual(seen, ['--merge', '--backend=http://x'])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('refresh exits non-zero on conflicts, so `refresh && push` cannot ship markers', async () => {
  const dir = site({ uuid: 'SITE' })
  try {
    const { r, out } = await capture(() =>
      refresh(['--no-git'], {
        resolveSiteDir: async () => dir,
        pull: async () => ({
          exitCode: 1,
          merge: { clean: [], conflicted: ['pages/home/hero.md'], kept: [] }
        })
      })
    )
    assert.equal(r.exitCode, 1)
    assert.match(out, /need you to resolve conflicts before pushing/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
