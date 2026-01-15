#!/usr/bin/env node

/**
 * Uniweb CLI
 *
 * Scaffolds new Uniweb sites and foundations, and builds projects.
 *
 * Usage:
 *   npx uniweb create [project-name]
 *   npx uniweb create --template site        # site/ + foundation/ (default)
 *   npx uniweb create --template workspace   # sites/* + foundations/*
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
  site: {
    name: 'Site + Foundation Project',
    description: 'Single project with site/ and foundation/ packages (recommended)',
  },
  workspace: {
    name: 'Multi-Site Workspace',
    description: 'Monorepo with sites/ and foundations/ for larger projects',
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
          title: templates.site.name,
          description: templates.site.description,
          value: 'site',
        },
        {
          title: templates.workspace.name,
          description: templates.workspace.description,
          value: 'workspace',
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
    case 'site':
      await createSiteProject(projectDir, projectName)
      break
    case 'workspace':
      await createMultiWorkspace(projectDir, projectName)
      break
  }

  // Success message
  title('Project created successfully!')

  log(`Next steps:\n`)
  log(`  ${colors.cyan}cd ${projectName}${colors.reset}`)
  log(`  ${colors.cyan}pnpm install${colors.reset}`)
  log(`  ${colors.cyan}pnpm dev${colors.reset}`)
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
  --template <type>  Project template (site, workspace)

${colors.bright}Build Options:${colors.reset}
  --target <type>    Build target (foundation, site) - auto-detected if not specified
  --platform <name>  Deployment platform (e.g., vercel) for platform-specific output

${colors.bright}Examples:${colors.reset}
  npx uniweb create my-project
  npx uniweb create my-project --template site
  npx uniweb create my-workspace --template workspace
  npx uniweb build
  npx uniweb build --target foundation

${colors.bright}Templates:${colors.reset}
  site         Single project with site/ and foundation/ packages (default)
  workspace    Multi-site/foundation monorepo with sites/ and foundations/
`)
}

// Template generators

/**
 * Creates a single project with site/ and foundation/ as sibling packages.
 * This is the default template for new projects.
 */
async function createSiteProject(projectDir, projectName) {
  mkdirSync(projectDir, { recursive: true })

  // Root package.json
  writeJSON(join(projectDir, 'package.json'), {
    name: projectName,
    version: '0.1.0',
    private: true,
    type: 'module',
    scripts: {
      dev: 'pnpm --filter site dev',
      'dev:runtime': 'VITE_FOUNDATION_MODE=runtime pnpm --filter site dev',
      build: 'pnpm -r build',
    },
    pnpm: {
      onlyBuiltDependencies: ['esbuild', 'sharp'],
    },
  })

  // pnpm-workspace.yaml
  writeFile(join(projectDir, 'pnpm-workspace.yaml'), `packages:
  - 'site'
  - 'foundation'
`)

  // .gitignore
  writeFile(join(projectDir, '.gitignore'), `node_modules
dist
.DS_Store
*.local
`)

  // README.md
  writeFile(join(projectDir, 'README.md'), `# ${projectName}

Structured Vite + React, ready to go.

## Quick Start

\`\`\`bash
pnpm install
pnpm dev
\`\`\`

Open [http://localhost:3000](http://localhost:3000) to see your site.

## Project Structure

\`\`\`
${projectName}/
├── site/                     # Content + configuration
│   ├── pages/                # File-based routing
│   │   └── home/
│   │       ├── page.yml      # Page metadata
│   │       └── 1-hero.md     # Section content
│   ├── locales/              # i18n (mirrors pages/)
│   ├── src/                  # Site entry point
│   └── public/               # Static assets
│
├── foundation/               # Your components
│   └── src/
│       ├── components/       # React components
│       ├── meta.js           # Foundation metadata
│       └── styles.css        # Tailwind styles
│
├── package.json
└── pnpm-workspace.yaml
\`\`\`

## Development

### Standard Mode (recommended)

\`\`\`bash
pnpm dev
\`\`\`

Edit components in \`foundation/src/components/\` and see changes instantly via HMR.
Edit content in \`site/pages/\` to add or modify pages.

### Runtime Loading Mode

\`\`\`bash
pnpm dev:runtime
\`\`\`

Tests production behavior where the foundation is loaded as a separate module.
Use this to debug issues that only appear in production.

## Building for Production

\`\`\`bash
pnpm build
\`\`\`

**Output:**
- \`foundation/dist/\` — Bundled components, CSS, and schema.json
- \`site/dist/\` — Production-ready static site

## Adding Components

1. Create a new folder in \`foundation/src/components/YourComponent/\`
2. Add \`index.jsx\` with your React component
3. Add \`meta.js\` describing the component's content slots and options
4. Export from \`foundation/src/index.js\`

## Adding Pages

1. Create a folder in \`site/pages/your-page/\`
2. Add \`page.yml\` with page metadata
3. Add markdown files (\`1-section.md\`, \`2-section.md\`, etc.) for each section

Each markdown file specifies which component to use:

\`\`\`markdown
---
component: Hero
title: Your Title
subtitle: Your subtitle
---

Optional body content here.
\`\`\`

## Scaling Up

When your project grows to multiple sites or foundations, migrate to a workspace:

\`\`\`bash
# Rename folders (name by purpose)
mv site sites/marketing
mv foundation foundations/marketing

# Update pnpm-workspace.yaml
packages:
  - 'sites/*'
  - 'foundations/*'
\`\`\`

## Publishing Your Foundation

Your \`foundation/\` is already a complete package:

\`\`\`bash
cd foundation
npx uniweb build
npm publish
\`\`\`

## What is Uniweb?

Uniweb is a **Component Web Platform** that bridges content and components.
Foundations define the vocabulary (available components, options, design rules).
Sites provide content that flows through Foundations.

Learn more:
- [Uniweb on GitHub](https://github.com/uniweb)
- [CLI Documentation](https://github.com/uniweb/cli)
- [uniweb.app](https://uniweb.app) — Visual editing platform

`)

  // Create site package
  await createSite(join(projectDir, 'site'), 'site', true)

  // Create foundation package
  await createFoundation(join(projectDir, 'foundation'), 'foundation', true)

  // Update site to reference workspace foundation
  const sitePackageJson = join(projectDir, 'site/package.json')
  const sitePkg = JSON.parse(readFile(sitePackageJson))
  sitePkg.dependencies['foundation'] = 'workspace:*'
  writeJSON(sitePackageJson, sitePkg)

  success(`Created project: ${projectName}`)
}

/**
 * Creates a multi-site/foundation workspace with sites/ and foundations/ directories.
 * Used for larger projects with multiple sites sharing foundations.
 */
async function createMultiWorkspace(projectDir, projectName) {
  mkdirSync(projectDir, { recursive: true })

  // Root package.json
  writeJSON(join(projectDir, 'package.json'), {
    name: projectName,
    version: '0.1.0',
    private: true,
    type: 'module',
    scripts: {
      dev: 'pnpm --filter marketing dev',
      'dev:runtime': 'VITE_FOUNDATION_MODE=runtime pnpm --filter marketing dev',
      build: 'pnpm -r build',
    },
    pnpm: {
      onlyBuiltDependencies: ['esbuild', 'sharp'],
    },
  })

  // pnpm-workspace.yaml
  writeFile(join(projectDir, 'pnpm-workspace.yaml'), `packages:
  - 'sites/*'
  - 'foundations/*'
`)

  // .gitignore
  writeFile(join(projectDir, '.gitignore'), `node_modules
dist
.DS_Store
*.local
`)

  // README.md
  writeFile(join(projectDir, 'README.md'), `# ${projectName}

A Uniweb workspace for multiple sites and foundations.

## Quick Start

\`\`\`bash
pnpm install
pnpm dev
\`\`\`

Open [http://localhost:3000](http://localhost:3000) to see the marketing site.

## Project Structure

\`\`\`
${projectName}/
├── sites/
│   └── marketing/            # Main marketing site
│       ├── pages/            # Content pages
│       ├── locales/          # i18n
│       └── src/
│
├── foundations/
│   └── marketing/            # Marketing foundation
│       └── src/
│           ├── components/   # React components
│           └── styles.css    # Tailwind styles
│
├── package.json
└── pnpm-workspace.yaml
\`\`\`

## Development

\`\`\`bash
# Run the marketing site (default)
pnpm dev

# Run a specific site
pnpm --filter docs dev

# Runtime loading mode (tests production behavior)
pnpm dev:runtime
\`\`\`

## Adding More Sites

Create a new site in \`sites/\`:

\`\`\`bash
mkdir -p sites/docs
# Copy structure from sites/marketing or create manually
\`\`\`

Update \`sites/docs/site.yml\` to specify which foundation:

\`\`\`yaml
name: docs
defaultLanguage: en
foundation: documentation    # Or marketing, or any foundation
\`\`\`

## Adding More Foundations

Create a new foundation in \`foundations/\`:

\`\`\`bash
mkdir -p foundations/documentation
# Build components for documentation use case
\`\`\`

Name foundations by purpose: marketing, documentation, learning, etc.

## Building for Production

\`\`\`bash
# Build everything
pnpm build

# Build specific packages
pnpm --filter marketing build
pnpm --filter foundations/marketing build
\`\`\`

## Learn More

- [Uniweb on GitHub](https://github.com/uniweb)
- [uniweb.app](https://uniweb.app) — Visual editing platform

`)

  // Create first site in sites/marketing
  await createSite(join(projectDir, 'sites/marketing'), 'marketing', true)

  // Create first foundation in foundations/marketing
  await createFoundation(join(projectDir, 'foundations/marketing'), 'marketing', true)

  // Update site to reference workspace foundation
  const sitePackageJson = join(projectDir, 'sites/marketing/package.json')
  const sitePkg = JSON.parse(readFile(sitePackageJson))
  sitePkg.dependencies['marketing'] = 'workspace:*'
  writeJSON(sitePackageJson, sitePkg)

  // Update site.yml to reference the marketing foundation
  writeFile(join(projectDir, 'sites/marketing/site.yml'), `name: marketing
defaultLanguage: en

# Foundation to use for this site
foundation: marketing
`)

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
      autoprefixer: '^10.4.18',
      'js-yaml': '^4.1.0',
      postcss: '^8.4.35',
      react: '^18.2.0',
      'react-dom': '^18.2.0',
      'react-router-dom': '^6.22.0',
      tailwindcss: '^3.4.1',
      vite: '^5.1.0',
      'vite-plugin-svgr': '^4.2.0',
    },
  })

  // Foundation import name (used for initial site.yml)
  const foundationImport = isWorkspace ? 'foundation' : 'foundation-example'

  // tailwind.config.js - reads foundation from site.yml
  writeFile(join(projectDir, 'tailwind.config.js'), `import { readFileSync, existsSync } from 'fs'
import yaml from 'js-yaml'

// Read foundation from site.yml
const siteConfig = yaml.load(readFileSync('./site.yml', 'utf8'))
const foundation = siteConfig.foundation || 'foundation'

// Resolve foundation path (workspace sibling or node_modules)
const workspacePath = \`../\${foundation}/src/**/*.{js,jsx,ts,tsx}\`
const npmPath = \`./node_modules/\${foundation}/src/**/*.{js,jsx,ts,tsx}\`
const contentPath = existsSync(\`../\${foundation}\`) ? workspacePath : npmPath

export default {
  content: [contentPath],
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

  // vite.config.js - reads foundation from site.yml
  writeFile(join(projectDir, 'vite.config.js'), `import { defineConfig } from 'vite'
import { readFileSync, existsSync } from 'fs'
import yaml from 'js-yaml'
import react from '@vitejs/plugin-react'
import svgr from 'vite-plugin-svgr'
import { siteContentPlugin, foundationPlugin } from '@uniweb/runtime/vite'

// Read foundation from site.yml
const siteConfig = yaml.load(readFileSync('./site.yml', 'utf8'))
const foundation = siteConfig.foundation || 'foundation'

// Check if foundation is a workspace sibling or npm package
const isWorkspaceFoundation = existsSync(\`../\${foundation}\`)
const foundationPath = isWorkspaceFoundation ? \`../\${foundation}\` : \`./node_modules/\${foundation}\`

const useRuntimeLoading = process.env.VITE_FOUNDATION_MODE === 'runtime'

export default defineConfig({
  resolve: {
    alias: {
      // Alias #foundation to the actual foundation package
      '#foundation': foundation,
    },
  },
  plugins: [
    react(),
    svgr(),
    siteContentPlugin({
      sitePath: './',
      inject: true,
    }),
    useRuntimeLoading && foundationPlugin({
      name: foundation,
      path: foundationPath,
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

  // main.jsx - uses #foundation alias (configured in vite.config.js from site.yml)
  writeFile(join(projectDir, 'src/main.jsx'), `import { initRuntime } from '@uniweb/runtime'

const useRuntimeLoading = import.meta.env.VITE_FOUNDATION_MODE === 'runtime'

async function start() {
  if (useRuntimeLoading) {
    initRuntime({
      url: '/foundation/foundation.js',
      cssUrl: '/foundation/assets/style.css'
    })
  } else {
    // #foundation alias is resolved by Vite based on site.yml config
    const foundation = await import('#foundation')
    await import('#foundation/styles')
    initRuntime(foundation)
  }
}

start().catch(console.error)
`)

  // site.yml
  writeFile(join(projectDir, 'site.yml'), `name: ${projectName}
defaultLanguage: en

# Foundation to use for this site
foundation: ${foundationImport}
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

  // README.md (only for standalone site, not workspace)
  if (!isWorkspace) {
    writeFile(join(projectDir, 'README.md'), `# ${projectName}

A Uniweb site — a content-driven website powered by a Foundation component library.

## Quick Start

\`\`\`bash
pnpm install
pnpm dev
\`\`\`

Open [http://localhost:3000](http://localhost:3000) to see your site.

## Project Structure

\`\`\`
${projectName}/
├── pages/              # Your content
│   └── home/
│       ├── page.yml    # Page metadata
│       └── 1-hero.md   # Section content
├── src/
│   └── main.jsx        # Site entry point
├── site.yml            # Site configuration
├── vite.config.js
└── package.json
\`\`\`

## Adding Pages

1. Create a folder in \`pages/your-page/\`
2. Add \`page.yml\`:

\`\`\`yaml
title: Your Page Title
order: 2
\`\`\`

3. Add section files (\`1-hero.md\`, \`2-features.md\`, etc.):

\`\`\`markdown
---
component: Hero
title: Section Title
subtitle: Section subtitle
---

Optional markdown content here.
\`\`\`

## How It Works

- Each folder in \`pages/\` becomes a route (\`/home\`, \`/about\`, etc.)
- Section files are numbered to control order (\`1-*.md\`, \`2-*.md\`)
- The \`component\` field specifies which Foundation component renders the section
- Other frontmatter fields become the component's content

## Configuration

The \`site.yml\` file configures your site:

\`\`\`yaml
name: ${projectName}
defaultLanguage: en
foundation: ${foundationImport}    # Which foundation to use
\`\`\`

To use a different foundation, update the \`foundation\` field and install the package.

## Building for Production

\`\`\`bash
pnpm build
\`\`\`

Output is in \`dist/\` — ready to deploy to any static host.

## Learn More

- [Uniweb on GitHub](https://github.com/uniweb)
- [uniweb.app](https://uniweb.app)

`)
  }

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

  // README.md (only for standalone foundation, not workspace)
  if (!isWorkspace) {
    writeFile(join(projectDir, 'README.md'), `# ${projectName}

A Uniweb Foundation — a React component library for content-driven websites.

## Quick Start

\`\`\`bash
pnpm install
pnpm dev      # Start Vite dev server for component development
pnpm build    # Build for production
\`\`\`

## Project Structure

\`\`\`
${projectName}/
├── src/
│   ├── components/       # Your components
│   │   └── Hero/
│   │       ├── index.jsx # React component
│   │       └── meta.js   # Component metadata
│   ├── meta.js           # Foundation metadata
│   ├── index.js          # Exports
│   └── styles.css        # Tailwind styles
├── package.json
├── vite.config.js
└── tailwind.config.js
\`\`\`

## Adding Components

1. Create \`src/components/YourComponent/index.jsx\`:

\`\`\`jsx
export function YourComponent({ content }) {
  const { title, description } = content
  return (
    <section className="py-12 px-6">
      <h2>{title}</h2>
      <p>{description}</p>
    </section>
  )
}

export default YourComponent
\`\`\`

2. Create \`src/components/YourComponent/meta.js\`:

\`\`\`js
export default {
  title: 'Your Component',
  description: 'What this component does',
  category: 'Content',
  elements: {
    title: { label: 'Title', required: true },
    description: { label: 'Description' },
  },
}
\`\`\`

3. Export from \`src/index.js\`:

\`\`\`js
export { YourComponent } from './components/YourComponent/index.jsx'
\`\`\`

## Build Output

After \`pnpm build\`:

\`\`\`
dist/
├── foundation.js      # Bundled components
├── assets/style.css   # Compiled Tailwind CSS
└── schema.json        # Component metadata for editors
\`\`\`

## What is a Foundation?

A Foundation defines the vocabulary for Uniweb sites:
- **Components** — The building blocks creators can use
- **Elements** — Content slots (title, description, images, etc.)
- **Properties** — Configuration options exposed to creators
- **Presets** — Pre-configured variations of components

Learn more at [github.com/uniweb](https://github.com/uniweb)

`)
  }

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
