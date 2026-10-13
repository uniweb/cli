// The workspace's packages — read as pnpm reads its patterns, and the `packages:` list
// edited in place (`src/utils/workspace-packages.js`).
//
// ⛔ Until 2026-10-13 the CLI held two partial readers: one saw `x/*`, `*/x` and plain
// paths, the other (`update`'s) only `x/*` and plain paths, so `*/sites/*` matched
// nothing anywhere while pnpm read it. And `add`, `rename` and `doctor --fix` rewrote
// pnpm-workspace.yaml from its `packages` alone, deleting its comments and every other
// key — `onlyBuiltDependencies` and `allowBuilds` among them.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import yaml from 'js-yaml'

import {
  resolveWorkspacePackages,
  patternsCover,
  editWorkspaceFilePackages,
  renderWorkspaceFile
} from '../src/utils/workspace-packages.js'

/** A workspace holding a package.json at each of `packages`, and plain folders at `folders`. */
function tree(packages, folders = []) {
  const root = mkdtempSync(join(tmpdir(), 'uniweb-wsp-'))
  for (const rel of packages) {
    mkdirSync(join(root, rel), { recursive: true })
    writeFileSync(join(root, rel, 'package.json'), '{}')
  }
  for (const rel of folders) mkdirSync(join(root, rel), { recursive: true })
  return root
}

function inTree(packages, folders, fn) {
  const root = tree(packages, folders)
  try {
    return fn(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

// ─── Reading ────────────────────────────────────────────────────────────────

test('a project per type, each with several sites: */src and */sites/*', () => {
  inTree(
    ['memberships/src', 'memberships/sites/fitness', 'memberships/sites/society', 'courses/src', 'courses/sites/academy'],
    [],
    (root) => {
      assert.deepEqual(resolveWorkspacePackages(root, ['*/src', '*/sites/*']), [
        'courses/src',
        'memberships/src',
        'courses/sites/academy',
        'memberships/sites/fitness',
        'memberships/sites/society'
      ])
    }
  )
})

test('a folder a wildcard finds counts only with a package.json; one listed by path counts if it exists', () => {
  inTree(['a/site'], ['b/site', 'c'], (root) => {
    // CONTROL: `b/site` exists but holds no manifest — a wildcard passes it over, as pnpm does.
    assert.deepEqual(resolveWorkspacePackages(root, ['*/site']), ['a/site'])
    // Named by its own path, it counts — a content-only command reads such a folder.
    assert.deepEqual(resolveWorkspacePackages(root, ['b/site', 'c', 'missing']), ['b/site', 'c'])
  })
})

test('each folder once, in the order of the first pattern that names it', () => {
  inTree(['site', 'src', 'docs/site'], [], (root) => {
    assert.deepEqual(resolveWorkspacePackages(root, ['src', '*/site', 'site', 'docs/site', 'src']), [
      'src',
      'docs/site',
      'site'
    ])
  })
})

test('** reaches any depth, and ! excludes what the other patterns match', () => {
  inTree(['packages/a', 'packages/group/b', 'packages/test/c'], [], (root) => {
    assert.deepEqual(resolveWorkspacePackages(root, ['packages/**']), [
      'packages/a',
      'packages/group/b',
      'packages/test/c'
    ])
    assert.deepEqual(resolveWorkspacePackages(root, ['packages/**', '!**/test/**']), [
      'packages/a',
      'packages/group/b'
    ])
  })
})

test('a wildcard never enters node_modules or a dot-folder; a spelled-out path still can', () => {
  inTree(['x/node_modules/dep', '.hidden/pkg', 'x/real'], [], (root) => {
    assert.deepEqual(resolveWorkspacePackages(root, ['**']), ['x/real'])
    assert.deepEqual(resolveWorkspacePackages(root, ['*/*']), ['x/real'])
    assert.deepEqual(resolveWorkspacePackages(root, ['.hidden/pkg']), ['.hidden/pkg'])
  })
})

test('{a,b}, ? and [...] within a folder name', () => {
  inTree(['apps/web', 'apps/api', 'apps/cli', 'site1', 'site2', 'siteX'], [], (root) => {
    assert.deepEqual(resolveWorkspacePackages(root, ['apps/{web,api}']), ['apps/web', 'apps/api'])
    assert.deepEqual(resolveWorkspacePackages(root, ['site?']), ['site1', 'site2', 'siteX'])
    assert.deepEqual(resolveWorkspacePackages(root, ['site[0-9]']), ['site1', 'site2'])
    assert.deepEqual(resolveWorkspacePackages(root, ['site[!0-9]']), ['siteX'])
  })
})

test('the root is the workspace, never one of its packages', () => {
  inTree(['site'], [], (root) => {
    writeFileSync(join(root, 'package.json'), '{}')
    assert.deepEqual(resolveWorkspacePackages(root, ['.', './site/']), ['site'])
  })
})

test('extended glob syntax is refused by name, never read as a path', () => {
  inTree(['a', 'b'], [], (root) => {
    const write = process.stderr.write
    let said = ''
    process.stderr.write = (chunk) => ((said += chunk), true)
    try {
      assert.deepEqual(resolveWorkspacePackages(root, ['@(a|b)', 'b']), ['b'])
    } finally {
      process.stderr.write = write
    }
    assert.match(said, /does not read the workspace pattern "@\(a\|b\)"/)
  })
})

test('patternsCover answers for a folder not made yet', () => {
  assert.equal(patternsCover(['*/src', '*/sites/*'], 'memberships/sites/new'), true)
  assert.equal(patternsCover(['*/src', '*/sites/*'], 'memberships/site'), false)
  assert.equal(patternsCover(['memberships/sites/*'], './memberships/sites/new/'), true)
  assert.equal(patternsCover(['**/sites/**', '!**/test/**'], 'a/sites/test/b'), false)
  assert.equal(patternsCover(['**'], 'x/node_modules/y'), false)
})

// ─── Writing ────────────────────────────────────────────────────────────────

const parse = (text) => yaml.load(text)
const withoutPackages = ({ packages, ...rest }) => rest

test('an entry appended to the file `create` writes changes one line — comments and build settings stay', () => {
  const before = renderWorkspaceFile(['site', 'src'])
  assert.ok(parse(before).allowBuilds && parse(before).onlyBuiltDependencies, 'the template carries the build settings')
  const after = editWorkspaceFilePackages(before, (list) => [...list, 'memberships/sites/new'])
  assert.deepEqual(parse(after).packages, ['site', 'src', 'memberships/sites/new'])
  assert.deepEqual(withoutPackages(parse(after)), withoutPackages(parse(before)))
  const added = after.split('\n').filter((line) => !before.split('\n').includes(line))
  assert.deepEqual(added, ['  - "memberships/sites/new"'])
  for (const comment of before.split('\n').filter((l) => l.startsWith('#'))) {
    assert.ok(after.includes(comment), `kept: ${comment}`)
  }
})

test('a replaced entry keeps its quote style and its comment', () => {
  const before = "packages:\n  - 'courses/src'   # the courses foundation\n  - 'courses/sites/*'\n\nallowBuilds:\n  esbuild: true\n"
  const after = editWorkspaceFilePackages(before, (list) => list.map((p) => (p === 'courses/src' ? 'learning/src' : p)))
  assert.equal(after, before.replace("'courses/src'", "'learning/src'"))
})

test('an entry that a bare list could misread is quoted', () => {
  const before = 'packages:\n  - site\n'
  const after = editWorkspaceFilePackages(before, (list) => [...list, '*/sites/*', 'docs/site'])
  assert.equal(after, 'packages:\n  - site\n  - "*/sites/*"\n  - docs/site\n')
  assert.deepEqual(parse(after).packages, ['site', '*/sites/*', 'docs/site'])
})

test('a flow list on one line, and a file with no packages: key yet', () => {
  const flow = 'packages: ["site", "src"] # two\nallowBuilds:\n  esbuild: true\n'
  assert.deepEqual(parse(editWorkspaceFilePackages(flow, (l) => [...l, 'docs/site'])), {
    packages: ['site', 'src', 'docs/site'],
    allowBuilds: { esbuild: true }
  })
  const none = '# settings only\nallowBuilds:\n  esbuild: true\n'
  const added = editWorkspaceFilePackages(none, (l) => [...l, 'site'])
  assert.deepEqual(parse(added), { packages: ['site'], allowBuilds: { esbuild: true } })
  assert.ok(added.includes('# settings only'))
})

test('a list it cannot edit in place is refused, not rewritten', () => {
  const multiline = 'packages:\n  - "site"\n  - >-\n    folded\n'
  assert.equal(editWorkspaceFilePackages(multiline, (l) => [...l, 'docs/site']), null)
  const flowOverLines = 'packages: [\n  "site"\n]\n'
  assert.equal(editWorkspaceFilePackages(flowOverLines, (l) => [...l, 'docs/site']), null)
  // CONTROL: the same lists, unchanged, come back unchanged.
  assert.equal(editWorkspaceFilePackages('packages:\n  - "site"\n', (l) => l), 'packages:\n  - "site"\n')
})
