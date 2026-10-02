/**
 * `uniweb update` keeps a project's notes in AGENTS.md: the blocks between a
 * `<!-- project-notes:start -->` line and a `<!-- project-notes:end -->` line,
 * carried verbatim to the end of the regenerated file. Everything else in the
 * file is this CLI's partial, rewritten for each version.
 *
 * The report behind it (2026-10-01): notes written into AGENTS.md were lost on
 * every version bump, because `update` rewrote the file whole.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  generateAgentsContent,
  readProjectNotes,
  refreshAgentsContent,
  PROJECT_NOTES_START,
  PROJECT_NOTES_END,
} from '../src/utils/agents-stamp.js'

const OLD_PARTIAL = '<!-- uniweb-agents v0.1.0 -->\n# Old guide\n\nSome rules.\n'
const NOTES = `${PROJECT_NOTES_START}
## Our notes

- Hero images live in \`site/public/hero/\`.
- See [NOTES.md](./NOTES.md).

\`\`\`md
${PROJECT_NOTES_END}
\`\`\`
${PROJECT_NOTES_END}`

test('a block is kept verbatim, at the end of the new file — wherever it was', () => {
  const existing = `${OLD_PARTIAL}\n${NOTES}\n\n## More of the old guide\n`
  const { content, kept } = refreshAgentsContent(existing)
  assert.equal(kept, 1)
  assert.ok(content.startsWith(generateAgentsContent().trimEnd()))
  assert.ok(content.endsWith(`\n\n${NOTES}\n`))
  assert.ok(!content.includes('More of the old guide'))
})

test('several blocks are kept, in order', () => {
  const second = `${PROJECT_NOTES_START}\nsecond\n${PROJECT_NOTES_END}`
  const { content, kept } = refreshAgentsContent(`${OLD_PARTIAL}${NOTES}\nOUTSIDE-ANY-BLOCK\n${second}\n`)
  assert.equal(kept, 2)
  assert.ok(content.endsWith(`${NOTES}\n\n${second}\n`))
  assert.ok(!content.includes('OUTSIDE-ANY-BLOCK'))
})

test('refreshing twice gives the same file — nothing is kept twice', () => {
  const once = refreshAgentsContent(`${OLD_PARTIAL}${NOTES}\n`).content
  const twice = refreshAgentsContent(once)
  assert.equal(twice.content, once)
  assert.equal(twice.kept, 1)
})

test('the partial names the markers in a sentence and holds no block of its own', () => {
  const partial = generateAgentsContent()
  assert.ok(partial.includes(PROJECT_NOTES_START), 'the partial tells the reader about the block')
  assert.deepEqual(readProjectNotes(partial), { blocks: [] })
})

test('no AGENTS.md, or none with a block: the partial alone', () => {
  assert.deepEqual(refreshAgentsContent(null), { content: generateAgentsContent(), kept: 0 })
  assert.deepEqual(refreshAgentsContent(`${OLD_PARTIAL}a note outside a block\n`), {
    content: generateAgentsContent(),
    kept: 0,
  })
})

test('a marker in a code fence, outside a block, is not a marker', () => {
  const existing = `${OLD_PARTIAL}~~~\n${PROJECT_NOTES_START}\n~~~\n`
  assert.deepEqual(readProjectNotes(existing), { blocks: [] })
})

test('a marker is a line of its own, with or without spaces inside the comment; CRLF files too', () => {
  assert.deepEqual(readProjectNotes('<!--project-notes:start-->\nx\n  <!-- project-notes:end -->  \n'), {
    blocks: ['<!--project-notes:start-->\nx\n  <!-- project-notes:end -->'],
  })
  assert.deepEqual(readProjectNotes(`${PROJECT_NOTES_START}\r\nx\r\n${PROJECT_NOTES_END}\r\n`), {
    blocks: [`${PROJECT_NOTES_START}\r\nx\r\n${PROJECT_NOTES_END}`],
  })
})

test('markers that do not pair up refuse: the file is left as it is', () => {
  for (const existing of [
    `${OLD_PARTIAL}${PROJECT_NOTES_START}\nnotes with no end\n`,
    `${OLD_PARTIAL}notes with no start\n${PROJECT_NOTES_END}\n`,
    `${PROJECT_NOTES_START}\na\n${PROJECT_NOTES_START}\nb\n${PROJECT_NOTES_END}\n`,
  ]) {
    const result = refreshAgentsContent(existing)
    assert.equal(result.content, undefined)
    assert.match(result.error, /project-notes:(start|end)/)
  }
})
