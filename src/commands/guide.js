/**
 * `uniweb guide` — the part of a project's manual that isn't in its AGENTS.md.
 *
 * AGENTS.md holds what an agent would confidently get wrong, and each guide holds the rest of a
 * subject, one command away. They ship in this package (`partials/guides/`), so what a project's
 * CLI prints describes the code in that project's `node_modules`, and nothing is added to the
 * project.
 *
 * ⭐ FOR AN AGENT, SO THE TEXT IS ALL THERE IS. The file goes to stdout as it is: no banner, no
 * color, no pager. `--path` names the file, for a tool that cuts long output.
 *
 * ⛔ READ-ONLY, AND SAFE ANYWHERE. No network, no project files and no cache, so it also works in
 * an empty folder (`npx uniweb@latest guide start`). `index.js` answers it before the update
 * check, as it does `start`. Unlike `start` it is delegated to a project's own CLI, because the
 * guide has to match the version the project pins.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { didYouMean } from '../utils/args.js'
import { checkFlags } from '../utils/flag-guard.js'

const GUIDES_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'partials', 'guides')

/**
 * The guides, in the order `uniweb guide` lists them.
 *
 * @returns {Array<{ name: string, title: string, description: string }>}
 */
export function listGuides() {
  return JSON.parse(readFileSync(join(GUIDES_DIR, 'index.json'), 'utf8'))
}

/** Where a guide's file is. */
export function guidePath(name) {
  return join(GUIDES_DIR, `${name}.md`)
}

/**
 * What a guide's name was probably meant to be, and every name there is, for a name that isn't one.
 *
 * @param {string} name
 * @param {string[]} names
 * @returns {string}
 */
function unknownGuide(name, names) {
  const near = didYouMean(name, names)
  return [
    `No guide named \`${name}\`.${near ? ` Did you mean \`${near}\`?` : ''}`,
    `  Guides: ${names.join(', ')}`,
  ].join('\n')
}

/**
 * @param {string[]} [args] - guide names, and `--path`
 * @returns {Promise<{ exitCode: number }>}
 */
export async function guide(args = []) {
  const badFlag = checkFlags('guide', args)
  if (badFlag) {
    console.error(badFlag.message)
    return { exitCode: 2 }
  }

  const guides = listGuides()
  const asked = args.filter((arg) => !arg.startsWith('-'))

  if (asked.length === 0) {
    const width = Math.max(...guides.map((g) => g.name.length))
    for (const g of guides) console.log(`${g.name.padEnd(width)}  ${g.description}`)
    return { exitCode: 0 }
  }

  const names = guides.map((g) => g.name)
  const unknown = asked.find((name) => !names.includes(name))
  if (unknown) {
    console.error(unknownGuide(unknown, names))
    return { exitCode: 1 }
  }

  if (args.includes('--path')) {
    for (const name of asked) console.log(guidePath(name))
    return { exitCode: 0 }
  }

  process.stdout.write(asked.map((name) => readFileSync(guidePath(name), 'utf8').trimEnd()).join('\n\n---\n\n') + '\n')
  return { exitCode: 0 }
}
