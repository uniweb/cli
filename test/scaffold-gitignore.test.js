/**
 * Scaffolded projects must ship with a `.gitignore`
 *
 * This guards a real, shipped regression: npm strips any file literally named
 * `.gitignore` from a package tarball. The package templates stored their
 * ignore files as `templates/<pkg>/.gitignore`, so the *published* `uniweb`
 * CLI carried none of them — every project scaffolded from npm came out with
 * no ignore file at all (node_modules/, dist/, .env, _entry.generated.js …
 * all committable). It went unnoticed for months because local testing
 * scaffolds from the source tree, where the files are present; only the
 * published tarball was broken.
 *
 * The fix stores them as `_gitignore` and renames `_` → `.` at scaffold time
 * (see `dotfileRename` in src/templates/processor.js). These tests pin both
 * halves so the invisibility that hid it the first time can't hide a
 * regression:
 *
 *   1. The npm tarball ships `_gitignore` (and never a strippable `.gitignore`)
 *      for every package template — catches the publish-time strip directly.
 *   2. The real scaffold path writes a `.gitignore` into each package — catches
 *      removal of the `_` → `.` rename.
 *   3. enumerateTemplateOutputs reports `.gitignore` — keeps the in-place
 *      `uniweb create .` conflict detection in sync with what's written.
 *   4. A content-template overlay can't clobber the base `.gitignore` — the
 *      property that lets official template-repo templates inherit a real
 *      ignore file (they overlay content on top of the base scaffold).
 *   5. End-to-end, `uniweb create --template <format-2>` yields a `.gitignore`
 *      at the workspace, foundation, and site level — the headline invariant:
 *      no matter the template source, node_modules/ and dist/ are ignored.
 *
 * Run: `pnpm test` or `node --test test/`
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, rm, readFile, writeFile, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { scaffoldWorkspace, scaffoldFoundation, scaffoldSite, applyContent } from '../src/utils/scaffold.js'
import { enumerateTemplateOutputs } from '../src/templates/processor.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CLI_ROOT = path.join(__dirname, '..')
const CLI_ENTRY = path.join(CLI_ROOT, 'src', 'index.js')
const TEMPLATES_DIR = path.join(CLI_ROOT, 'templates')
const PACKAGE_TEMPLATES = ['workspace', 'foundation', 'site']

async function exists(p) {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}

function tmp(prefix) {
  return mkdtemp(path.join(tmpdir(), prefix))
}

test('npm tarball ships _gitignore for every package template (npm strips literal .gitignore)', () => {
  const stdout = execFileSync('npm', ['pack', '--dry-run', '--json'], {
    cwd: CLI_ROOT,
    encoding: 'utf8',
  })
  const files = JSON.parse(stdout)[0].files.map((f) => f.path.replace(/\\/g, '/'))

  // A file literally named `.gitignore` anywhere under templates/ would be
  // silently dropped by npm at publish — exactly the bug this guards. The fix
  // is to store such files as `_gitignore`; none should slip back to `.`.
  const stripped = files.filter(
    (f) => f.startsWith('templates/') && path.posix.basename(f) === '.gitignore',
  )
  assert.deepEqual(
    stripped,
    [],
    `templates ship .gitignore files npm will strip from the tarball: ${stripped.join(', ')}`,
  )

  for (const pkg of PACKAGE_TEMPLATES) {
    assert.ok(
      files.includes(`templates/${pkg}/_gitignore`),
      `templates/${pkg}/_gitignore is missing from the npm tarball (scaffolded projects would have no .gitignore)`,
    )
  }
})

test('scaffolding via the real CLI path writes .gitignore into each package', async () => {
  const cases = [
    {
      pkg: 'workspace',
      run: (dir) =>
        scaffoldWorkspace(dir, {
          projectName: 'test-project',
          workspaceGlobs: ['site', 'foundation'],
          scripts: {},
        }),
    },
    {
      pkg: 'foundation',
      run: (dir) => scaffoldFoundation(dir, { name: 'foundation', projectName: 'test-project' }),
    },
    {
      pkg: 'site',
      run: (dir) =>
        scaffoldSite(dir, {
          name: 'site',
          projectName: 'test-project',
          foundationName: 'foundation',
          foundationPath: 'file:../foundation',
        }),
    },
  ]

  for (const { pkg, run } of cases) {
    const dir = await tmp(`uniweb-gi-${pkg}-`)
    try {
      await run(dir)
      assert.ok(await exists(path.join(dir, '.gitignore')), `${pkg}: scaffolded project is missing .gitignore`)
      assert.ok(!(await exists(path.join(dir, '_gitignore'))), `${pkg}: _gitignore leaked into scaffolded output`)

      // Content must match the template source verbatim (raw copy, no Handlebars).
      const rendered = await readFile(path.join(dir, '.gitignore'), 'utf8')
      const source = await readFile(path.join(TEMPLATES_DIR, pkg, '_gitignore'), 'utf8')
      assert.equal(rendered, source, `${pkg}: scaffolded .gitignore differs from template source`)
      assert.match(rendered, /node_modules/, `${pkg}: .gitignore should ignore node_modules`)
      assert.match(rendered, /dist/, `${pkg}: .gitignore should ignore dist`)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }
})

test('enumerateTemplateOutputs renames _gitignore -> .gitignore for the in-place create flow', async () => {
  for (const pkg of PACKAGE_TEMPLATES) {
    const outputs = await enumerateTemplateOutputs(path.join(TEMPLATES_DIR, pkg))
    assert.ok(outputs.includes('.gitignore'), `${pkg}: enumerated outputs missing .gitignore (${outputs.join(', ')})`)
    assert.ok(!outputs.includes('_gitignore'), `${pkg}: enumerated outputs leaked _gitignore`)
  }
})

test('a content-template overlay cannot remove or replace the base .gitignore', async () => {
  // The base package scaffold lays down `.gitignore` first; the content
  // template (starter / official template repo) is overlaid on top via
  // applyContent. `.gitignore` is structural there, so an overlay — even one
  // that ships its own adversarial `.gitignore` — must not win. This is what
  // guarantees official templates inherit a real ignore file.
  const target = await tmp('uniweb-gi-target-')
  const content = await tmp('uniweb-gi-content-')
  try {
    const base = 'node_modules\ndist\n'
    await writeFile(path.join(target, '.gitignore'), base)

    // Adversarial overlay: a .gitignore that would erase the standard ignores,
    // plus a normal content file that SHOULD be copied through.
    await writeFile(path.join(content, '.gitignore'), '# overlay junk — must not win\n')
    await writeFile(path.join(content, 'page.md'), '# hello\n')

    await applyContent(content, target, { projectName: 'test' })

    assert.equal(
      await readFile(path.join(target, '.gitignore'), 'utf8'),
      base,
      'overlay clobbered the base .gitignore (it must be treated as structural)',
    )
    assert.ok(await exists(path.join(target, 'page.md')), 'overlay content (page.md) was not applied')
  } finally {
    await rm(target, { recursive: true, force: true })
    await rm(content, { recursive: true, force: true })
  }
})

test('end-to-end: creating from a content template yields .gitignore at every level', async () => {
  // Drives the real `uniweb create` against a LOCAL format-2 template — the
  // exact code path (`createFromContentTemplate`) an official template-repo
  // template runs through, minus the network fetch. Proves the headline
  // invariant: no matter the template source, every package gets a .gitignore.
  const fixture = await tmp('uniweb-gi-fixture-')
  const workdir = await tmp('uniweb-gi-work-')
  try {
    // Minimal valid format-2 content template: template.json + foundation/ + site/.
    await writeFile(path.join(fixture, 'template.json'), JSON.stringify({ name: 'e2e-gitignore-template' }))
    await mkdir(path.join(fixture, 'foundation', 'sections', 'Hero'), { recursive: true })
    await writeFile(path.join(fixture, 'foundation', 'sections', 'Hero', 'index.jsx'), 'export default () => null\n')
    await mkdir(path.join(fixture, 'site', 'pages'), { recursive: true })
    await writeFile(path.join(fixture, 'site', 'pages', 'home.md'), '# Home\n')

    const r = spawnSync(
      process.execPath,
      [CLI_ENTRY, 'create', 'proj', '--template', fixture, '--no-git', '--non-interactive'],
      { cwd: workdir, encoding: 'utf8' },
    )
    assert.equal(r.status, 0, `create failed (exit ${r.status})\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`)

    // Workspace (root), foundation (src/), and site (site/) must each be ignored.
    const projDir = path.join(workdir, 'proj')
    for (const rel of ['.gitignore', path.join('src', '.gitignore'), path.join('site', '.gitignore')]) {
      const p = path.join(projDir, rel)
      assert.ok(await exists(p), `missing ${rel} in scaffolded project`)
      const body = await readFile(p, 'utf8')
      assert.match(body, /node_modules/, `${rel} should ignore node_modules`)
      assert.match(body, /dist/, `${rel} should ignore dist`)
    }
  } finally {
    await rm(fixture, { recursive: true, force: true })
    await rm(workdir, { recursive: true, force: true })
  }
})
