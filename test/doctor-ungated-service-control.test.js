/**
 * `uniweb doctor` — a control drawn for a service the site may not have.
 *
 * A component that calls `useFormSubmit()` and never reads `canSubmit` renders
 * a form on every site, including those with no submission destination, where
 * it is permanently dead. Same for a search box and `isEnabled`.
 *
 * ⭐ The last test asserts against `templates/services` itself. The check this
 * suite's neighbour replaced was green while silent on that very template, so
 * pinning the real thing — not a fixture written to match the matcher — is the
 * part that would actually catch a regression.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkUngatedServiceControls } from '../src/commands/doctor.js'

const FRAMEWORK = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

/** A foundation source tree holding one component. */
function withComponent(source, { name = 'Widget', root = 'sections' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'uniweb-ungated-'))
  mkdirSync(join(dir, root, name), { recursive: true })
  writeFileSync(join(dir, root, name, 'index.jsx'), source)
  return dir
}

function idsFor(source, opts) {
  const dir = withComponent(source, opts)
  const issues = []
  try {
    checkUngatedServiceControls({
      foundationName: 'acme',
      folderName: 'foundation',
      srcDir: dir,
      issues,
    })
    return issues
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('flags a form drawn without reading canSubmit', () => {
  const issues = idsFor(`
    import { useFormSubmit } from '@uniweb/kit'
    export default function Quote({ block }) {
      const { submit, status } = useFormSubmit({ block })
      return <form onSubmit={submit}>{status}</form>
    }
  `)
  assert.deepEqual(issues.map((i) => i.id), ['ungated-service-control'])
  assert.equal(issues[0].details.hook, 'useFormSubmit')
  assert.equal(issues[0].details.gate, 'canSubmit')
})

test('says nothing when the gate is read', () => {
  const issues = idsFor(`
    import { useFormSubmit } from '@uniweb/kit'
    export default function Quote({ block }) {
      const { submit, canSubmit } = useFormSubmit({ block })
      if (!canSubmit) return null
      return <form onSubmit={submit} />
    }
  `)
  assert.deepEqual(issues, [])
})

test('flags a search control drawn without reading isEnabled', () => {
  const issues = idsFor(`
    import { useSearch } from '@uniweb/kit'
    export default function Box({ website }) {
      const { results, search } = useSearch(website)
      return <input onChange={(e) => search(e.target.value)} />
    }
  `)
  assert.deepEqual(issues.map((i) => i.details.gate), ['isEnabled'])
})

test('an import without a call is not drawing anything', () => {
  // Re-exporting a hook, or importing one for a type, draws no control.
  const issues = idsFor(`
    export { useFormSubmit } from '@uniweb/kit'
  `)
  assert.deepEqual(issues, [])
})

test('checks utils/ too — a gate factored out of a component still counts', () => {
  const issues = idsFor(
    `
    import { useFormSubmit } from '@uniweb/kit'
    export function useQuote(block) {
      const { submit } = useFormSubmit({ block })
      return submit
    }
  `,
    { root: 'utils', name: 'quote' }
  )
  assert.deepEqual(issues.map((i) => i.id), ['ungated-service-control'])
})

test('reports each offending file, so the message can be acted on', () => {
  const dir = mkdtempSync(join(tmpdir(), 'uniweb-ungated-'))
  mkdirSync(join(dir, 'sections', 'A'), { recursive: true })
  mkdirSync(join(dir, 'sections', 'B'), { recursive: true })
  const bad = `import { useSearch } from '@uniweb/kit'\nexport default (w) => { const { results } = useSearch(w); return results }\n`
  writeFileSync(join(dir, 'sections', 'A', 'index.jsx'), bad)
  writeFileSync(join(dir, 'sections', 'B', 'index.jsx'), bad)
  const issues = []
  try {
    checkUngatedServiceControls({ foundationName: 'acme', folderName: 'f', srcDir: dir, issues })
    assert.equal(issues.length, 2)
    assert.deepEqual(
      issues.map((i) => i.details.file).sort(),
      ['sections/A/index.jsx', 'sections/B/index.jsx']
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the services template is clean — it gates its form on canSubmit', () => {
  // The real thing, not a fixture. If QuoteForm ever stops gating, this fails.
  const issues = []
  checkUngatedServiceControls({
    foundationName: 'services',
    folderName: 'foundation',
    srcDir: join(FRAMEWORK, 'templates', 'services', 'foundation'),
    issues,
  })
  assert.deepEqual(issues, [])
})
