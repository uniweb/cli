/**
 * Scaffolding Utilities
 *
 * Shared scaffolding functions used by both `create` and `add` commands.
 * Each function scaffolds a single package from its package template.
 */

import fs from 'node:fs/promises'
import { existsSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import yaml from 'js-yaml'
import Handlebars from 'handlebars'
import { copyTemplateDirectory, registerVersions } from '../templates/processor.js'
import { getVersionsForTemplates, getCliVersion } from '../versions.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const TEMPLATES_DIR = join(__dirname, '..', '..', 'templates')
const STARTER_DIR = join(__dirname, '..', '..', 'starter')

/**
 * Scaffold a workspace root from the workspace package template
 *
 * @param {string} targetDir - Target directory
 * @param {Object} context - Template context
 * @param {string} context.projectName - Workspace/project name
 * @param {string[]} context.workspaceGlobs - Workspace glob patterns
 * @param {Object} context.scripts - Root package.json scripts
 * @param {Object} [options] - Processing options
 */
export async function scaffoldWorkspace(targetDir, context, options = {}) {
  registerVersions(getVersionsForTemplates())

  // Skip pnpm-workspace.yaml for blank workspaces (no packages yet).
  // The `add` command creates it on demand via addWorkspaceGlob().
  // Without this, pnpm fails with ERR_PNPM_NO_IMPORTER_MANIFEST_FOUND
  // because an empty packages: [] makes pnpm search parent directories.
  const skip = context.workspaceGlobs?.length ? [] : ['pnpm-workspace.yaml']

  // Inject CLI version for AGENTS.md stamp
  context = { ...context, cliVersion: getCliVersion() }

  const templatePath = join(TEMPLATES_DIR, 'workspace')
  await copyTemplateDirectory(templatePath, targetDir, context, {
    onProgress: options.onProgress,
    onWarning: options.onWarning,
    skip,
  })
}

/**
 * Scaffold a foundation from the foundation package template
 *
 * @param {string} targetDir - Target directory for the foundation
 * @param {Object} context - Template context
 * @param {string} context.name - Package name
 * @param {string} context.projectName - Workspace name
 * @param {boolean} [context.isExtension] - Whether this is an extension
 * @param {Object} [options] - Processing options
 */
export async function scaffoldFoundation(targetDir, context, options = {}) {
  registerVersions(getVersionsForTemplates())

  const templatePath = join(TEMPLATES_DIR, 'foundation')
  await copyTemplateDirectory(templatePath, targetDir, context, {
    onProgress: options.onProgress,
    onWarning: options.onWarning,
  })
}

/**
 * Scaffold a site from the site package template
 *
 * @param {string} targetDir - Target directory for the site
 * @param {Object} context - Template context
 * @param {string} context.name - Package name
 * @param {string} context.projectName - Workspace name
 * @param {string} context.foundationName - Foundation package name
 * @param {string} context.foundationPath - Relative file: path to foundation
 * @param {string} [context.foundationRef] - Foundation ref for site.yml (when multiple foundations)
 * @param {Object} [options] - Processing options
 */
export async function scaffoldSite(targetDir, context, options = {}) {
  registerVersions(getVersionsForTemplates())

  const templatePath = join(TEMPLATES_DIR, 'site')
  await copyTemplateDirectory(templatePath, targetDir, context, {
    onProgress: options.onProgress,
    onWarning: options.onWarning,
  })
}

/**
 * Apply content overlay from a content directory onto a target
 *
 * Content files overwrite scaffolded defaults. Structural files
 * (package.json, vite.config.js, main.js, index.html) are NOT overwritten.
 *
 * @param {string} contentDir - Source content directory (e.g., starter/foundation/)
 * @param {string} targetDir - Target directory to overlay onto
 * @param {Object} context - Handlebars context for .hbs files
 * @param {Object} [options] - Processing options
 */
export async function applyContent(contentDir, targetDir, context, options = {}) {
  if (!existsSync(contentDir)) return

  registerVersions(getVersionsForTemplates())

  // Structural files that content should never overwrite
  const STRUCTURAL_FILES = new Set([
    'package.json',
    'vite.config.js',
    'main.js',
    'index.html',
    '.gitignore',
  ])

  // Config files that should be merged, not overwritten.
  // Keys listed here are preserved from the scaffolded version.
  const MERGE_FILES = {
    'site.yml': ['name', 'foundation'],
  }

  await copyContentRecursive(contentDir, targetDir, context, STRUCTURAL_FILES, MERGE_FILES, options)
}

/**
 * Recursively copy content files, skipping structural files
 */
async function copyContentRecursive(sourceDir, targetDir, context, structuralFiles, mergeFiles, options) {
  await fs.mkdir(targetDir, { recursive: true })

  const entries = readdirSync(sourceDir, { withFileTypes: true })

  for (const entry of entries) {
    const sourcePath = join(sourceDir, entry.name)

    if (entry.isDirectory()) {
      const targetSubDir = join(targetDir, entry.name)
      await copyContentRecursive(sourcePath, targetSubDir, context, structuralFiles, mergeFiles, options)
    } else {
      // Determine the output filename (strip .hbs extension)
      const outputName = entry.name.endsWith('.hbs')
        ? entry.name.slice(0, -4)
        : entry.name

      // Skip structural files
      if (structuralFiles.has(outputName)) continue

      const targetPath = join(targetDir, outputName)

      // Get new content (process .hbs or read as-is)
      let newContent
      if (entry.name.endsWith('.hbs')) {
        const Handlebars = (await import('handlebars')).default
        const raw = await fs.readFile(sourcePath, 'utf-8')
        const template = Handlebars.compile(raw)
        newContent = template(context)
      }

      // Merge config files instead of overwriting.
      //
      // The "merge" here is narrow: take the content template's output
      // as the source of truth (so comments, formatting, and the full
      // educational structure of the content template survive) and
      // override only the specific top-level keys listed in
      // preserveKeys with the values from the already-scaffolded base
      // file (so the user's chosen project name and foundation ref
      // don't get replaced by whatever the content template hardcoded).
      //
      // Earlier versions of this code parsed both files through
      // js-yaml, merged the objects, and re-emitted the result via
      // yaml.dump() — which stripped every comment and blank line on
      // the way through. For templates like `cv/site/site.yml.hbs`
      // whose comments are the template's educational payload, that
      // was devastating. The line-level override below preserves the
      // content template's text verbatim except for the preserved keys.
      const preserveKeys = mergeFiles[outputName]
      if (preserveKeys && existsSync(targetPath)) {
        const existingContent = await fs.readFile(targetPath, 'utf-8')
        const existing = yaml.load(existingContent) || {}
        let merged = newContent ?? await fs.readFile(sourcePath, 'utf-8')

        for (const key of preserveKeys) {
          if (existing[key] === undefined) continue
          const baseLine = matchTopLevelLine(existingContent, key)
          if (baseLine) {
            merged = replaceTopLevelLine(merged, key, baseLine)
          }
        }

        await fs.writeFile(targetPath, merged)
      } else if (newContent !== undefined) {
        await fs.writeFile(targetPath, newContent)
      } else {
        // Copy as-is
        await fs.copyFile(sourcePath, targetPath)
      }

      if (options.onProgress) {
        options.onProgress(`Creating ${outputName}`)
      }
    }
  }
}

/**
 * Apply the built-in starter content
 *
 * @param {string} projectDir - Root project directory
 * @param {Object} context - Template context
 * @param {Object} [options] - Processing options
 * @param {string} [options.foundationDir] - Foundation directory name (default: 'foundation')
 * @param {string} [options.siteDir] - Site directory name (default: 'site')
 */
export async function applyStarter(projectDir, context, options = {}) {
  const foundationDir = options.foundationDir || 'foundation'
  const siteDir = options.siteDir || 'site'

  // Apply foundation starter content
  const foundationContentDir = join(STARTER_DIR, 'foundation')
  const foundationTargetDir = join(projectDir, foundationDir)
  await applyContent(foundationContentDir, foundationTargetDir, context, options)

  // Apply site starter content
  const siteContentDir = join(STARTER_DIR, 'site')
  const siteTargetDir = join(projectDir, siteDir)
  await applyContent(siteContentDir, siteTargetDir, context, options)
}

/**
 * Escape a string for safe inclusion in a RegExp literal. Used by the
 * site.yml line-level merge path.
 */
function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Find the verbatim text of a single-line top-level YAML entry like
 * `name: foo bar` or `foundation: my-foundation`. Returns the matched
 * line (including any inline comment) or null if the key isn't present.
 * Multi-line values (block scalars, nested maps) are deliberately
 * unsupported — the merge path only uses this for simple scalar keys.
 */
function matchTopLevelLine(content, key) {
  const match = content.match(new RegExp(`^${escapeRegex(key)}:.*$`, 'm'))
  return match ? match[0] : null
}

/**
 * Replace the verbatim text of a single-line top-level YAML entry.
 * Returns the content unchanged if the key isn't present. See
 * matchTopLevelLine for scope.
 */
function replaceTopLevelLine(content, key, replacement) {
  return content.replace(
    new RegExp(`^${escapeRegex(key)}:.*$`, 'm'),
    () => replacement,
  )
}

/**
 * Resolve a dependency version string from a template.json entry.
 *
 * Template authors can either hardcode a concrete spec (`"^0.2.1"`) or
 * use the same `{{version}}` Handlebars helper that `package.json.hbs`
 * uses (`"{{version \"@uniweb/press\"}}"`). The helper is populated
 * earlier in the scaffold flow via `registerVersions()`, so by the time
 * this runs `versionData` already holds the current on-disk versions
 * of every `@uniweb/*` package.
 *
 * Plain strings without `{{…}}` pass through untouched. Strings that
 * fail to compile (rare — e.g. malformed mustache) fall back to the
 * original literal so a bad template.json doesn't break scaffolding.
 */
function resolveDependencyVersion(rawValue) {
  if (typeof rawValue !== 'string' || !rawValue.includes('{{')) {
    return rawValue
  }
  try {
    return Handlebars.compile(rawValue)({})
  } catch {
    return rawValue
  }
}

/**
 * Merge additional dependencies from a content template into a scaffolded package.json
 *
 * Reads the package.json at the given path, adds any deps not already present
 * (in either dependencies or devDependencies), and writes it back.
 *
 * Each version string in `deps` is first processed through the shared
 * Handlebars pipeline so template.json entries can reference live
 * workspace versions via `{{version "@uniweb/press"}}` instead of
 * hardcoding a spec that goes stale on the next publish.
 *
 * @param {string} packageJsonPath - Absolute path to package.json
 * @param {Object} deps - Dependencies to merge (name → version spec)
 */
export async function mergeTemplateDependencies(packageJsonPath, deps) {
  if (!deps || Object.keys(deps).length === 0) return
  const pkg = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8'))
  if (!pkg.dependencies) pkg.dependencies = {}
  for (const [name, version] of Object.entries(deps)) {
    if (!pkg.dependencies[name] && !pkg.devDependencies?.[name]) {
      pkg.dependencies[name] = resolveDependencyVersion(version)
    }
  }
  await fs.writeFile(packageJsonPath, JSON.stringify(pkg, null, 2) + '\n')
}
