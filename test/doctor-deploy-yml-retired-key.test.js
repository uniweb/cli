/**
 * `uniweb doctor` names deploy.yml's retired keys — `lastDeploy:` and `autoSave:` — and
 * `--fix deploy-yml-retired-key` moves them, keeping the file's comments.
 *
 * A renamed key returns empty; it does not fail. Measured 2026-10-26 on real projects: a
 * site's only record of its S3 deploy sat under `lastDeploy:`, which `uniweb status` could
 * not see, and three files kept `autoSave:`, which nothing has read since 2026-09-20.
 *
 * Run: `pnpm test` or `node --test test/`
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmp, runVerb } from './helpers/run-verb.js'

const DEPLOY_YML = `# the person's own words
default: production
targets:
  production:
    host: s3-cloudfront # the bucket
lastDeploy:
  production:
    at: 2026-05-26T18:38:41.635Z
    host: s3-cloudfront
autoSave: off
`

/** A workspace with one site, whose deploy.yml keeps both retired keys. */
function workspace() {
  const root = tmp('uw-doctor-retired-')
  const files = {
    'pnpm-workspace.yaml': 'packages:\n  - site\n',
    'package.json': JSON.stringify({ name: 'w', private: true, workspaces: ['site'] }),
    'site/package.json': JSON.stringify({ name: 'site', private: true }),
    'site/site.yml': 'name: S\n',
    'site/pages/home/page.yml': 'title: Home\n',
    'site/deploy.yml': DEPLOY_YML
  }
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(join(root, rel, '..'), { recursive: true })
    writeFileSync(join(root, rel), body)
  }
  return root
}

async function doctorIn(dir, args = []) {
  const { doctor } = await import('../src/commands/doctor.js')
  const cwd = process.cwd()
  try {
    process.chdir(dir)
    return await doctor(args, { quiet: true })
  } finally {
    process.chdir(cwd)
  }
}

const retired = (res) => res.issues.find((i) => i.id === 'deploy-yml-retired-key')

test('⭐ the retired keys are named, and the file is left as it is', { timeout: 60_000 }, async () => {
  const root = workspace()
  const issue = retired(await doctorIn(root))
  assert.ok(issue, 'the check fired')
  assert.equal(issue.type, 'warn')
  assert.match(issue.message, /`lastDeploy:` and `autoSave:`/)
  assert.equal(readFileSync(join(root, 'site', 'deploy.yml'), 'utf8'), DEPLOY_YML)
})

test('⭐ --fix deploy-yml-retired-key moves the record and the switch, keeping the comments', { timeout: 60_000 }, async () => {
  const root = workspace()
  const issue = retired(await doctorIn(root, ['--fix', 'deploy-yml-retired-key']))
  assert.equal(issue?.fixed, true)
  const text = readFileSync(join(root, 'site', 'deploy.yml'), 'utf8')
  assert.match(text, /# the person's own words/)
  assert.match(text, /# the bucket/)
  assert.doesNotMatch(text, /^(lastDeploy|autoSave):/m)
  assert.match(text, /^saveDeploys: false$/m)
  assert.match(text, /^deploys:\n {2}production:\n {4}at: 2026-05-26/m)
  assert.equal(retired(await doctorIn(root)), undefined, 'control: a second run finds nothing')
})

// ⛔ The line said "`autoSave:` is `saveDeploys:` now", which read as a rename: a copied project
// came back holding `saveDeploys: lastDeploy` (2026-10-26). It now says what each value means.
test('the old values are said by what they mean, not as a rename', { timeout: 60_000 }, async () => {
  const { doctor } = await import('../src/commands/doctor.js')
  const { output } = await runVerb(workspace(), doctor, [], {})
  assert.match(output, /`lastDeploy:` is `deploys:` now; `autoSave:` goes — `autoSave: off` is `saveDeploys: false`, and `autoSave: lastDeploy` is what happens anyway/)
  assert.doesNotMatch(output, /`autoSave:` is `saveDeploys:`/)
})

test('⭐ saveDeploys holding an old autoSave value is named, and --fix writes what it meant', { timeout: 60_000 }, async () => {
  const root = workspace()
  writeFileSync(join(root, 'site', 'deploy.yml'), '# mine\ndefault: production\ntargets:\n  production:\n    host: uniweb\nsaveDeploys: lastDeploy\n')
  const found = await doctorIn(root)
  const issue = retired(found)
  assert.equal(issue?.type, 'error', 'a deploy.yml the CLI refuses to read')
  assert.match(issue.message, /`saveDeploys: lastDeploy`, a value of the retired `autoSave:`/)
  assert.equal(found.issues.some((i) => i.id === 'deploy-yml-malformed'), false)

  assert.equal(retired(await doctorIn(root, ['--fix', 'deploy-yml-retired-key']))?.fixed, true)
  const text = readFileSync(join(root, 'site', 'deploy.yml'), 'utf8')
  assert.doesNotMatch(text, /saveDeploys/)
  assert.match(text, /# mine/)
  assert.equal(retired(await doctorIn(root)), undefined, 'control: a second run finds nothing')
})

test('control: a deploy.yml on the current keys is not named', { timeout: 60_000 }, async () => {
  const root = workspace()
  writeFileSync(join(root, 'site', 'deploy.yml'), 'default: production\ntargets:\n  production:\n    host: uniweb\nsaveDeploys: false\n')
  assert.equal(retired(await doctorIn(root)), undefined)
})
