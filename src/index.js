#!/usr/bin/env node

/**
 * Uniweb CLI
 *
 * Scaffolds new Uniweb sites and foundations, and builds projects.
 *
 * Usage:
 *   npx uniweb create [project-name]
 *   npx uniweb create --template site
 *   npx uniweb create --template foundation
 *   npx uniweb create --template workspace
 *   npx uniweb build
 *   npx uniweb build --target foundation
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { resolve, join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import prompts from 'prompts'
import { build } from './commands/build.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Colors for terminal output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
}

function log(message) {
  console.log(message)
}

function success(message) {
  console.log(`${colors.green}✓${colors.reset} ${message}`)
}

function error(message) {
  console.error(`${colors.red}✗${colors.reset} ${message}`)
}

function title(message) {
  console.log(`\n${colors.cyan}${colors.bright}${message}${colors.reset}\n`)
}

// Template definitions
const templates = {
  workspace: {
    name: 'Site + Foundation Workspace',
    description: 'Monorepo with a site and foundation for co-development',
  },
  site: {
    name: 'Site Only',
    description: 'A site that uses an existing foundation',
  },
  foundation: {
    name: 'Foundation Only',
    description: 'A standalone foundation package',
  },
}

async function main() {
  const args = process.argv.slice(2)
  const command = args[0]

  // Show help
  if (!command || command === '--help' || command === '-h') {
    showHelp()
    return
  }

  // Handle build command
  if (command === 'build') {
    await build(args.slice(1))
    return
  }

  // Handle create command
  if (command !== 'create') {
    error(`Unknown command: ${command}`)
    showHelp()
    process.exit(1)
  }

  title('Uniweb Project Generator')

  // Parse arguments
  let projectName = args[1]
  let templateType = null

  // Check for --template flag
  const templateIndex = args.indexOf('--template')
  if (templateIndex !== -1 && args[templateIndex + 1]) {
    templateType = args[templateIndex + 1]
    if (!templates[templateType]) {
      error(`Unknown template: ${templateType}`)
      log(`Available templates: ${Object.keys(templates).join(', ')}`)
      process.exit(1)
    }
  }

  // Interactive prompts
  const response = await prompts([
    {
      type: projectName ? null : 'text',
      name: 'projectName',
      message: 'Project name:',
      initial: 'my-uniweb-project',
      validate: (value) => {
        if (!value) return 'Project name is required'
        if (!/^[a-z0-9-]+$/.test(value)) {
          return 'Project name can only contain lowercase letters, numbers, and hyphens'
        }
        return true
      },
    },
    {
      type: templateType ? null : 'select',
      name: 'template',
      message: 'What would you like to create?',
      choices: [
        {
          title: templates.workspace.name,
          description: templates.workspace.description,
          value: 'workspace',
        },
        {
          title: templates.site.name,
          description: templates.site.description,
          value: 'site',
        },
        {
          title: templates.foundation.name,
          description: templates.foundation.description,
          value: 'foundation',
        },
      ],
    },
  ], {
    onCancel: () => {
      log('\nScaffolding cancelled.')
      process.exit(0)
    },
  })

  projectName = projectName || response.projectName
  templateType = templateType || response.template

  if (!projectName || !templateType) {
    error('Missing project name or template type')
    process.exit(1)
  }

  // Create project directory
  const projectDir = resolve(process.cwd(), projectName)

  if (existsSync(projectDir)) {
    error(`Directory already exists: ${projectName}`)
    process.exit(1)
  }

  log(`\nCreating ${templates[templateType].name.toLowerCase()}...`)

  // Generate project based on template
  switch (templateType) {
    case 'workspace':
      await createWorkspace(projectDir, projectName)
      break
    case 'site':
      await createSite(projectDir, projectName)
      break
    case 'foundation':
      await createFoundation(projectDir, projectName)
      break
  }

  // Success message
  title('Project created successfully!')

  log(`Next steps:\n`)
  log(`  ${colors.cyan}cd ${projectName}${colors.reset}`)
  log(`  ${colors.cyan}pnpm install${colors.reset}`)

  if (templateType === 'workspace') {
    log(`  ${colors.cyan}pnpm dev${colors.reset}`)
  } else if (templateType === 'site') {
    log(`  ${colors.cyan}pnpm dev${colors.reset}`)
  } else {
    log(`  ${colors.cyan}pnpm build${colors.reset}`)
  }

  log('')
}

function showHelp() {
  log(`
${colors.cyan}${colors.bright}Uniweb CLI${colors.reset}

${colors.bright}Usage:${colors.reset}
  npx uniweb <command> [options]

${colors.bright}Commands:${colors.reset}
  create [name]      Create a new project
  build              Build the current project

${colors.bright}Create Options:${colors.reset}
  --template <type>  Project template (workspace, site, foundation)

${colors.bright}Build Options:${colors.reset}
  --target <type>    Build target (foundation, site) - auto-detected if not specified

${colors.bright}Examples:${colors.reset}
  npx uniweb create my-project
  npx uniweb create my-site --template site
  npx uniweb create my-foundation --template foundation
  npx uniweb build
  npx uniweb build --target foundation

${colors.bright}Templates:${colors.reset}
  workspace    Site + Foundation monorepo for co-development
  site         Standalone site using an existing foundation
  foundation   Standalone foundation package
`)
}

// Template generators
async function createWorkspace(projectDir, projectName) {
  mkdirSync(projectDir, { recursive: true })

  // Root package.json
  writeJSON(join(projectDir, 'package.json'), {
    name: projectName,
    version: '0.1.0',
    private: true,
    type: 'module',
    workspaces: ['packages/*'],
    scripts: {
      dev: 'pnpm --filter site dev',
      'dev:runtime': 'VITE_FOUNDATION_MODE=runtime pnpm --filter site dev',
      'build:foundation': 'pnpm --filter foundation build',
      build: 'pnpm build:foundation && pnpm --filter site build',
    },
  })

  // pnpm-workspace.yaml
  writeFile(join(projectDir, 'pnpm-workspace.yaml'), `packages:
  - 'packages/*'
`)

  // .gitignore
  writeFile(join(projectDir, '.gitignore'), `node_modules
dist
.DS_Store
*.local
`)

  // Create site package
  await createSite(join(projectDir, 'packages/site'), 'site', true)

  // Create foundation package
  await createFoundation(join(projectDir, 'packages/foundation'), 'foundation', true)

  // Update site to reference workspace foundation
  const sitePackageJson = join(projectDir, 'packages/site/package.json')
  const sitePkg = JSON.parse(readFile(sitePackageJson))
  sitePkg.dependencies['foundation'] = 'workspace:*'
  writeJSON(sitePackageJson, sitePkg)

  success(`Created workspace: ${projectName}`)
}

async function createSite(projectDir, projectName, isWorkspace = false) {
  mkdirSync(projectDir, { recursive: true })
  mkdirSync(join(projectDir, 'src'), { recursive: true })
  mkdirSync(join(projectDir, 'pages/home'), { recursive: true })

  // package.json
  writeJSON(join(projectDir, 'package.json'), {
    name: projectName,
    version: '0.1.0',
    type: 'module',
    private: true,
    scripts: {
      dev: 'vite',
      build: 'vite build',
      preview: 'vite preview',
    },
    dependencies: {
      '@uniweb/runtime': '^0.1.0',
      ...(isWorkspace ? {} : { 'foundation-example': '^0.1.0' }),
    },
    devDependencies: {
      '@vitejs/plugin-react': '^4.2.1',
      react: '^18.2.0',
      'react-dom': '^18.2.0',
      'react-router-dom': '^6.22.0',
      vite: '^5.1.0',
      'vite-plugin-svgr': '^4.2.0',
    },
  })

  // vite.config.js
  const foundationImport = isWorkspace ? 'foundation' : 'foundation-example'
  writeFile(join(projectDir, 'vite.config.js'), `import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import svgr from 'vite-plugin-svgr'
import { siteContentPlugin, foundationPlugin } from '@uniweb/runtime/vite'

const useRuntimeLoading = process.env.VITE_FOUNDATION_MODE === 'runtime'

export default defineConfig({
  plugins: [
    react(),
    svgr(),
    siteContentPlugin({
      sitePath: './',
      inject: true,
    }),
    useRuntimeLoading && foundationPlugin({
      name: '${foundationImport}',
      path: ${isWorkspace ? "'../foundation'" : "require.resolve('" + foundationImport + "').replace('/src/index.js', '')"},
      serve: '/foundation',
      watch: true,
    }),
  ].filter(Boolean),
  server: {
    fs: { allow: ['..'] },
    port: 3000,
  },
})
`)

  // index.html
  writeFile(join(projectDir, 'index.html'), `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${projectName}</title>
    <style>
      body { margin: 0; font-family: system-ui, sans-serif; }
      .loading { display: flex; align-items: center; justify-content: center; min-height: 100vh; color: #64748b; }
    </style>
  </head>
  <body>
    <div id="root">
      <div class="loading">Loading...</div>
    </div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
`)

  // main.jsx
  writeFile(join(projectDir, 'src/main.jsx'), `import { initRuntime } from '@uniweb/runtime'

const useRuntimeLoading = import.meta.env.VITE_FOUNDATION_MODE === 'runtime'

async function start() {
  if (useRuntimeLoading) {
    initRuntime({
      url: '/foundation/foundation.js',
      cssUrl: '/foundation/assets/style.css'
    })
  } else {
    const foundation = await import('${foundationImport}')
    await import('${foundationImport}/styles')
    initRuntime(foundation)
  }
}

start().catch(console.error)
`)

  // site.yml
  writeFile(join(projectDir, 'site.yml'), `name: ${projectName}
defaultLanguage: en
`)

  // pages/home/page.yml
  writeFile(join(projectDir, 'pages/home/page.yml'), `title: Home
order: 1
`)

  // pages/home/1-hero.md
  writeFile(join(projectDir, 'pages/home/1-hero.md'), `---
component: Hero
title: Welcome to ${projectName}
subtitle: Built with Uniweb and Vite
ctaText: Get Started
ctaUrl: "#"
---

Your content goes here.
`)

  success(`Created site: ${projectName}`)
}

async function createFoundation(projectDir, projectName, isWorkspace = false) {
  mkdirSync(projectDir, { recursive: true })
  mkdirSync(join(projectDir, 'src/components/Hero'), { recursive: true })
  mkdirSync(join(projectDir, 'src/icons'), { recursive: true })

  // package.json
  writeJSON(join(projectDir, 'package.json'), {
    name: projectName,
    version: '0.1.0',
    type: 'module',
    main: './src/index.js',
    exports: {
      '.': './src/index.js',
      './styles': './src/styles.css',
      './dist': './dist/foundation.js',
      './dist/styles': './dist/assets/style.css',
    },
    files: ['dist', 'src'],
    scripts: {
      dev: 'vite',
      build: 'npx uniweb build',
      'build:vite': 'vite build',
      preview: 'vite preview',
    },
    peerDependencies: {
      react: '^18.0.0',
      'react-dom': '^18.0.0',
    },
    devDependencies: {
      '@vitejs/plugin-react': '^4.2.1',
      autoprefixer: '^10.4.18',
      postcss: '^8.4.35',
      react: '^18.2.0',
      'react-dom': '^18.2.0',
      tailwindcss: '^3.4.1',
      vite: '^5.1.0',
      'vite-plugin-svgr': '^4.2.0',
    },
  })

  // vite.config.js
  writeFile(join(projectDir, 'vite.config.js'), `import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import svgr from 'vite-plugin-svgr'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react(), svgr()],
  build: {
    lib: {
      entry: resolve(__dirname, 'src/entry-runtime.js'),
      formats: ['es'],
      fileName: 'foundation',
    },
    rollupOptions: {
      external: ['react', 'react-dom', 'react/jsx-runtime', 'react/jsx-dev-runtime'],
      output: {
        assetFileNames: 'assets/[name][extname]',
      },
    },
    sourcemap: true,
    cssCodeSplit: false,
  },
})
`)

  // tailwind.config.js
  writeFile(join(projectDir, 'tailwind.config.js'), `import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))

export default {
  content: [join(__dirname, './src/**/*.{js,jsx,ts,tsx}')],
  theme: {
    extend: {
      colors: {
        primary: '#3b82f6',
        secondary: '#64748b',
      },
    },
  },
  plugins: [],
}
`)

  // postcss.config.js
  writeFile(join(projectDir, 'postcss.config.js'), `export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
}
`)

  // .gitignore
  writeFile(join(projectDir, '.gitignore'), `node_modules
dist
.DS_Store
*.local
_entry.generated.js
`)

  // src/styles.css
  writeFile(join(projectDir, 'src/styles.css'), `@tailwind base;
@tailwind components;
@tailwind utilities;
`)

  // src/meta.js (foundation-level metadata)
  writeFile(join(projectDir, 'src/meta.js'), `/**
 * ${projectName} Foundation Metadata
 */
export default {
  name: '${projectName}',
  description: 'A Uniweb foundation',

  // Runtime props (available at render time)
  props: {
    themeToggleEnabled: true,
  },

  // Style configuration for the editor
  styleFields: [
    {
      id: 'primary-color',
      type: 'color',
      label: 'Primary Color',
      default: '#3b82f6',
    },
  ],
}
`)

  // src/index.js (manual entry for dev - imports from components)
  writeFile(join(projectDir, 'src/index.js'), `/**
 * ${projectName} Foundation
 *
 * This is the manual entry point for development.
 * During build, _entry.generated.js is created automatically.
 */

import Hero from './components/Hero/index.jsx'

const components = { Hero }

export function getComponent(name) {
  return components[name]
}

export function listComponents() {
  return Object.keys(components)
}

export function getSchema(name) {
  return components[name]?.schema
}

export function getAllSchemas() {
  const schemas = {}
  for (const [name, component] of Object.entries(components)) {
    if (component.schema) schemas[name] = component.schema
  }
  return schemas
}

export { Hero }
export default { getComponent, listComponents, getSchema, getAllSchemas, components }
`)

  // src/entry-runtime.js
  writeFile(join(projectDir, 'src/entry-runtime.js'), `import './styles.css'
export * from './index.js'
export { default } from './index.js'
`)

  // src/components/Hero/index.jsx
  writeFile(join(projectDir, 'src/components/Hero/index.jsx'), `import React from 'react'

export function Hero({ content }) {
  const { title, subtitle, ctaText, ctaUrl } = content

  return (
    <section className="py-20 px-6 bg-gradient-to-br from-primary to-blue-700 text-white">
      <div className="max-w-4xl mx-auto text-center">
        <h1 className="text-4xl md:text-5xl font-bold mb-6">{title}</h1>
        {subtitle && (
          <p className="text-lg text-blue-100 mb-8">{subtitle}</p>
        )}
        {ctaText && ctaUrl && (
          <a
            href={ctaUrl}
            className="inline-block px-6 py-3 bg-white text-primary font-semibold rounded-lg hover:bg-blue-50 transition-colors"
          >
            {ctaText}
          </a>
        )}
      </div>
    </section>
  )
}

export default Hero
`)

  // src/components/Hero/meta.js
  writeFile(join(projectDir, 'src/components/Hero/meta.js'), `/**
 * Hero Component Metadata
 */
export default {
  title: 'Hero Banner',
  description: 'A prominent header section with headline, subtitle, and call-to-action',
  category: 'Headers',

  elements: {
    title: {
      label: 'Headline',
      required: true,
    },
    subtitle: {
      label: 'Subtitle',
    },
    links: {
      label: 'Call to Action',
    },
  },

  properties: {
    alignment: {
      type: 'select',
      label: 'Text Alignment',
      options: [
        { value: 'center', label: 'Center' },
        { value: 'left', label: 'Left' },
      ],
      default: 'center',
    },
  },
}
`)

  success(`Created foundation: ${projectName}`)
}

// Utility functions
function writeFile(path, content) {
  const dir = dirname(path)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  writeFileSync(path, content)
}

function writeJSON(path, obj) {
  writeFile(path, JSON.stringify(obj, null, 2) + '\n')
}

function readFile(path) {
  return readFileSync(path, 'utf-8')
}

// Run CLI
main().catch((err) => {
  error(err.message)
  process.exit(1)
})
