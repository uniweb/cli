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
import { copyTemplateDirectory, registerVersions } from '../templates/processor.js'
import { getVersionsForTemplates } from '../versions.js'

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

  const templatePath = join(TEMPLATES_DIR, 'workspace')
  await copyTemplateDirectory(templatePath, targetDir, context, {
    onProgress: options.onProgress,
    onWarning: options.onWarning,
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

      // Merge config files instead of overwriting
      const preserveKeys = mergeFiles[outputName]
      if (preserveKeys && existsSync(targetPath)) {
        const existingContent = await fs.readFile(targetPath, 'utf-8')
        const existing = yaml.load(existingContent) || {}
        const incoming = yaml.load(newContent || await fs.readFile(sourcePath, 'utf-8')) || {}

        // Template values as base, preserve specified keys from scaffolded version
        const merged = { ...incoming }
        for (const key of preserveKeys) {
          if (existing[key] !== undefined) merged[key] = existing[key]
        }
        await fs.writeFile(targetPath, yaml.dump(merged, { lineWidth: -1 }))
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
 * Merge additional dependencies from a content template into a scaffolded package.json
 *
 * Reads the package.json at the given path, adds any deps not already present
 * (in either dependencies or devDependencies), and writes it back.
 *
 * @param {string} packageJsonPath - Absolute path to package.json
 * @param {Object} deps - Dependencies to merge (name → version)
 */
export async function mergeTemplateDependencies(packageJsonPath, deps) {
  if (!deps || Object.keys(deps).length === 0) return
  const pkg = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8'))
  if (!pkg.dependencies) pkg.dependencies = {}
  for (const [name, version] of Object.entries(deps)) {
    if (!pkg.dependencies[name] && !pkg.devDependencies?.[name]) {
      pkg.dependencies[name] = version
    }
  }
  await fs.writeFile(packageJsonPath, JSON.stringify(pkg, null, 2) + '\n')
}
