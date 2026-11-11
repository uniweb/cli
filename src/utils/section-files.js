/**
 * The files `uniweb add section` writes: a new section type's component and `meta.js`, in a
 * foundation's `sections/` or a library's, and the lines a foundation passes a library's type on with.
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { declarationFor, generateStarter } from '../commands/starter.js'

/** A new section type's component, which reads a title, paragraphs and links. */
export function sectionComponent(name) {
  return `import { H2, P, Link, cn } from '@uniweb/kit'

export default function ${name}({ content, params }) {
  const { title, paragraphs = [], links = [] } = content || {}

  return (
    <div className="max-w-4xl mx-auto px-6">
      {title && <H2 text={title} className="text-heading text-3xl font-bold" />}
      <P text={paragraphs} className="text-body mt-4" />
      {links.length > 0 && (
        <div className="mt-6 flex gap-3 flex-wrap">
          {links.map((link, i) => (
            <Link key={i} to={link.href} className={cn(
              'px-5 py-2.5 rounded-lg font-medium transition-colors',
              i === 0
                ? 'bg-primary text-primary-foreground hover:bg-primary-hover'
                : 'bg-secondary text-secondary-foreground hover:bg-secondary-hover'
            )}>
              {link.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
`
}

/** A new section type's `meta.js`, with the `content:` declaration `--starter` derived, if any. */
export function sectionMeta(name, declaration = '') {
  return `export default {
  title: '${name}',
  description: '',${declaration}
  params: {},
}
`
}

/**
 * Write a new section type's two files into `sectionDir`. With `starter`, its `meta.js` gets a
 * `content:` declaration from the family the name resolves to, so the declaration, the component
 * and the starter content agree; without it, the stub declares nothing.
 *
 * @param {{ name: string, sectionDir: string, starter?: boolean }} o
 * @returns {Promise<object|null>} the starter result the declaration came from, with `starter`
 */
export async function writeSection({ name, sectionDir, starter = false }) {
  await mkdir(sectionDir, { recursive: true })
  let declaration = ''
  let result = null
  if (starter) {
    const preview = await generateStarter({ name, sectionDir })
    result = preview.result
    declaration = await declarationFor(preview.result)
  }
  await writeFile(join(sectionDir, 'index.jsx'), sectionComponent(name))
  await writeFile(join(sectionDir, 'meta.js'), sectionMeta(name, declaration))
  return result
}

/**
 * The import a foundation's file of a section type passes a library's on with:
 * `<library>/sections/<Name>/<file>`.
 */
export function passOnSpecifier(libraryName, name, file) {
  return `${libraryName}/sections/${name}/${file}`
}

/**
 * The two files a foundation offers a library's section type with, as it is: each passes on the
 * library's file of that name. A foundation that offers the type differently keeps its own
 * `meta.js` and passes on `index.jsx` alone.
 *
 * @returns {{ 'index.jsx': string, 'meta.js': string }}
 */
export function passOnFiles(libraryName, name) {
  return {
    'index.jsx':
      `// The library ${libraryName}'s ${name}, offered by this foundation as it is: edit it there, in sections/${name}/.\n` +
      `export { default } from '${passOnSpecifier(libraryName, name, 'index.jsx')}'\n`,
    'meta.js':
      `// Its title, params and presets are ${libraryName}'s too. To offer it differently here, write this foundation's own instead.\n` +
      `export { default } from '${passOnSpecifier(libraryName, name, 'meta.js')}'\n`
  }
}
