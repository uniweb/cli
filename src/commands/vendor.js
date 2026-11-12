/**
 * `uniweb vendor run <file>#<function>` — run one vendor function on this machine, under the rules
 * it runs by on the platform: the web's globals and not Node's, no network, frozen built-in
 * prototypes, a JSON object in and a JSON object out, each within its size, and a short time per
 * call. The run itself is `@uniweb/build`'s `runVendorFunction`.
 *
 * ⭐ WHY A VERB, when a test can import the file: a test runs it in Node, which allows everything
 * those rules take away, and where it runs its console output is discarded. So a function that
 * passes its tests can fail every call there with nothing to go on. This run fails it here.
 *
 * The file is named as an integration names it, or by its path:
 *
 *   uniweb vendor run courses#grade --input answers.json      a file of this package's vendors/
 *   uniweb vendor run @acme/grading#score --input in.json     a library's, by its full name
 *   uniweb vendor run src/vendors/courses.js#grade < in.json  a path
 *
 * Exit 0 with the answer on stdout, or 1 with why on stderr. `--json` prints one object, either way.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  green: '\x1b[32m',
}

const USAGE = 'uniweb vendor run <file>#<function> [--input <file.json>] [--json]'

/**
 * @param {string[]} args
 * @returns {Promise<{ exitCode: number }>}
 */
export async function vendor(args = []) {
  const [sub, ...rest] = args
  if (sub !== 'run') {
    fail(sub ? `\`uniweb vendor ${sub}\` is not a command. ${USAGE}` : USAGE)
    return { exitCode: 1 }
  }
  return run(rest)
}

async function run(args) {
  const json = args.includes('--json')
  const inputAt = args.indexOf('--input')
  const inputPath = inputAt >= 0 ? args[inputAt + 1] : null
  const positional = args.filter((a, i) => !a.startsWith('--') && !(inputAt >= 0 && i === inputAt + 1))
  const say = (failure, extra = {}) => {
    if (json) process.stdout.write(JSON.stringify({ ok: false, failure, warnings: [], ...extra }) + '\n')
    else fail(failure)
    return { exitCode: 1 }
  }

  if (positional.length !== 1 || !positional[0].includes('#')) {
    return say(`Name the function as \`<file>#<function>\`, as an integration does. ${USAGE}`)
  }
  if (inputAt >= 0 && !inputPath) return say('`--input` takes a JSON file, or `-` for stdin.')

  const ref = positional[0]
  const hash = ref.lastIndexOf('#')
  const fileRef = ref.slice(0, hash)
  const exportName = ref.slice(hash + 1)
  if (!fileRef || !exportName) return say(`Name the function as \`<file>#<function>\`, as an integration does. ${USAGE}`)

  const located = await locate(fileRef)
  if (located.error) return say(located.error)

  let inputText
  if (inputPath && inputPath !== '-') {
    if (!existsSync(inputPath)) return say(`There is no file \`${inputPath}\` to read the input from.`)
    inputText = readFileSync(inputPath, 'utf8')
  } else if (inputPath === '-' || !process.stdin.isTTY) {
    inputText = await readStdin()
  } else {
    return say('Give the function its input: `--input <file.json>`, or pipe the JSON in.')
  }

  const { runVendorFunction } = await import('@uniweb/build')
  const result = await runVendorFunction({ file: located.file, exportName, inputText })

  if (json) {
    process.stdout.write(JSON.stringify(result) + '\n')
    return { exitCode: result.ok ? 0 : 1 }
  }

  for (const w of result.warnings) process.stderr.write(`${colors.yellow}⚠${colors.reset} ${w}\n`)
  if (result.ok) {
    process.stdout.write(JSON.stringify(result.answer, null, 2) + '\n')
  } else {
    fail(result.failure)
    for (const p of result.problems || []) process.stderr.write(`  - ${p}\n`)
  }
  if (result.wallMs != null) {
    const time = result.cpuMs != null ? `${fmt(result.cpuMs)} ms of CPU` : `${fmt(result.wallMs)} ms`
    process.stderr.write(`${colors.dim}${ref}: ${time} on this machine, which is not where it runs.${colors.reset}\n`)
  }
  return { exitCode: result.ok ? 0 : 1 }
}

/**
 * The vendor file `fileRef` names: a path (holding a `/` or ending `.js`), a full name
 * `@scope/name` found in the workspace, or a name of this package's own (`name` or `@/name`).
 */
async function locate(fileRef) {
  const cwd = process.cwd()
  if (!fileRef.startsWith('@') && (fileRef.includes('/') || fileRef.endsWith('.js'))) {
    const file = resolve(cwd, fileRef)
    return existsSync(file) ? { file } : { error: `There is no file \`${fileRef}\`.` }
  }

  const build = await import('@uniweb/build')
  const { classifyPackage, isSchemasPackage, resolveFoundationSrcPath, ownVendorFiles, workspaceVendorFiles, VENDORS_DIR } = build

  const own = fileRef.startsWith('@/') ? fileRef.slice(2) : fileRef.startsWith('@') ? null : fileRef
  const isFoundation = classifyPackage(cwd) === 'foundation'
  const srcDir = isFoundation ? resolveFoundationSrcPath(cwd) : cwd

  if (own !== null) {
    if (!isFoundation && !isSchemasPackage(cwd)) {
      return { error: `\`${fileRef}\` is a vendor file of this package, and this is not a foundation or a library. Run it from one, or give the file's path.` }
    }
    const found = ownVendorFiles(srcDir).find((v) => v.name === own)
    if (found) return { file: found.file }
    const shown = isFoundation ? `src/${VENDORS_DIR}` : VENDORS_DIR
    const tried = join(shown, `${own}.js`)
    return { error: `There is no vendor file \`${own}\`: \`${tried}\` isn't there${own.startsWith('_') ? ', and a name starting with `_` is left out' : ''}.` }
  }

  const files = await workspaceVendorFiles(fileRef, srcDir)
  if (files.length === 1) return { file: files[0] }
  if (files.length > 1) return { error: `\`${fileRef}\` is defined by ${files.length} packages: ${files.join(', ')}.` }
  return { error: `No package here defines \`${fileRef}\`. Run it from the library that defines it, or give the file's path.` }
}

function readStdin() {
  return new Promise((done, failed) => {
    let text = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (chunk) => (text += chunk))
    process.stdin.on('end', () => done(text))
    process.stdin.on('error', failed)
  })
}

function fail(message) {
  process.stderr.write(`${colors.red}✗${colors.reset} ${message}\n`)
}

function fmt(ms) {
  return ms < 10 ? ms.toFixed(2) : String(Math.round(ms))
}
