/**
 * Starter content for a section type — `uniweb add section <Name> --starter`.
 *
 * ⭐ IT IS DERIVED FROM `content:`, NOT AUTHORED. A developer declares what
 * their component expects; this turns that declaration into something an author
 * can edit instead of an empty box. There is no `starter:` key in `meta.js` and
 * there should not be [Diego, 2026-09-16] — authored sample copy drifts against
 * the declaration it is meant to match, and it can never be localized, because a
 * developer's string is the foundation's own words and is shown verbatim in
 * every UI language.
 *
 * ⚖️ THE GENERATOR IS NOT HERE. It is `@uniweb/schemas/starter`, because the
 * visual editor is its other caller and must reach it in a browser — this file
 * is the CLI's rendering of the same answer. Anything that decides WHAT the
 * content is belongs there; what is left here is reading a `meta.js` off disk
 * and serializing.
 */

import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  yellow: '\x1b[33m',
}

/**
 * Load a section's `meta.js` as it is on disk NOW.
 *
 * ⛔ The URL carries the file's content hash. Node caches an ES module by URL
 * for the life of the process, and `@uniweb/build`'s own loader hit exactly this
 * — a dev server regenerating after a `meta.js` edit re-imported the file it had
 * started with. Same rule here, same reason.
 */
async function loadMeta(metaPath) {
  const version = createHash('sha1').update(await readFile(metaPath)).digest('hex').slice(0, 16)
  const mod = await import(`${pathToFileURL(metaPath).href}?content=${version}`)
  return mod.default
}

/**
 * The three framework functions this composes, imported at call time.
 *
 * ⚖️ Dynamic, matching `inspect.js`: these resolve through the project's own
 * workspace, and a clear message beats a stack trace when one is missing.
 */
async function loadPipeline() {
  try {
    const [schemas, parser, writer] = await Promise.all([
      import('@uniweb/schemas/starter'),
      import('@uniweb/semantic-parser'),
      import('@uniweb/content-writer'),
    ])
    return {
      starterContent: schemas.starterContent,
      buildDoc: parser.buildDoc,
      serializeSection: writer.serializeSection,
    }
  } catch (err) {
    throw new Error(
      `Starter content needs @uniweb/schemas, @uniweb/semantic-parser and @uniweb/content-writer.\n` +
        `  ${err.message}\n` +
        `  Run your package manager's install in this workspace and try again.`,
    )
  }
}

/**
 * Generate starter content for one section type and render it.
 *
 * @param {object} args
 * @param {string} args.name        - the section type (PascalCase).
 * @param {string} args.sectionDir  - the section's directory in the foundation.
 * @param {string} [args.preset]    - a declared preset whose params become the frontmatter.
 * @param {boolean} [args.json]     - emit the structure and the ProseMirror doc instead of markdown.
 * @param {string} [args.write]     - write the markdown to this path instead of printing it.
 * @returns {Promise<{markdown: string, result: object}>}
 */
export async function generateStarter({ name, sectionDir, preset, json, write }) {
  const { starterContent, buildDoc, serializeSection } = await loadPipeline()

  const metaPath = join(sectionDir, 'meta.js')
  const meta = existsSync(metaPath) ? await loadMeta(metaPath) : {}
  const result = starterContent({ name, ...meta }, { preset })

  const doc = buildDoc(result.content)
  const markdown = doc ? serializeSection(result.params, doc) : ''

  if (json) {
    process.stdout.write(
      JSON.stringify(
        {
          section: name,
          family: result.family,
          elementsInferred: result.elementsInferred,
          unfilled: result.unfilled,
          params: result.params,
          content: result.content,
          doc,
        },
        null,
        2,
      ) + '\n',
    )
    return { markdown, result }
  }

  if (write) {
    await writeFile(write, markdown, 'utf-8')
  }

  return { markdown, result }
}

/**
 * The human-facing report that follows generation.
 *
 * ⭐ It SAYS when the element list was ours. A component declaring no `content:`
 * gets its family's canonical set, and a developer reading generated content
 * they never specified should be told why — otherwise the natural conclusion is
 * that the generator invented a declaration on their behalf.
 */
export function reportStarter(result, { write } = {}) {
  const c = colors
  const fam = result.family.id
    ? `${c.cyan}${result.family.id}${c.reset} ${c.dim}(${result.family.source})${c.reset}`
    : `${c.dim}no family — generic copy${c.reset}`

  console.log('')
  console.log(`  ${c.dim}family:${c.reset}   ${fam}`)
  console.log(`  ${c.dim}slots:${c.reset}    ${Object.keys(result.content).join(', ') || '—'}`)

  if (result.elementsInferred) {
    console.log('')
    console.log(
      `  ${c.yellow}!${c.reset} This section declares no ${c.bright}content:${c.reset} — the elements above came from its family.`,
    )
    console.log(
      `    ${c.dim}Declare what the component expects and the starter content follows it instead.${c.reset}`,
    )
  }

  if (result.unfilled.length) {
    console.log('')
    console.log(`  ${c.yellow}!${c.reset} Not filled: ${result.unfilled.join(', ')}`)
    console.log(
      `    ${c.dim}\`background\` is frontmatter, not content. A video needs an address we cannot invent.${c.reset}`,
    )
    console.log(
      `    ${c.dim}A \`data\` block needs a schema: a @/ ref resolves at build, and an empty {} declares no shape.${c.reset}`,
    )
  }

  if (write) {
    console.log('')
    console.log(`  ${c.cyan}→${c.reset} written to ${write}`)
  }
  console.log('')
}

/**
 * A `content:` declaration for a section being scaffolded, derived from the
 * family the name resolves to. Written into the new `meta.js` so the scaffold is
 * coherent: a declaration, a component, and content that fills it.
 */
export function declarationFor(result) {
  const LABELS = {
    title: 'Headline',
    pretitle: 'Small label above the headline',
    subtitle: 'Secondary headline',
    paragraphs: 'Body copy [1-2]',
    links: 'Calls to action [0-2]',
    lists: 'Bullet points [0-1]',
    items: 'One per entry [3-6]',
    images: 'Image [1]',
    icons: 'Icon [1]',
  }
  const lines = Object.keys(result.content).map(
    (slot) => `    ${slot === 'images' ? 'image' : slot === 'icons' ? 'icon' : slot}: '${LABELS[slot] || slot}',`,
  )
  return lines.length ? `\n  content: {\n${lines.join('\n')}\n  },\n` : ''
}
