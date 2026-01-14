# uniweb

CLI for the Uniweb Component Web Platform.

## Quick Start

Create a new Uniweb project with a starter template:

```bash
npx uniweb@latest create my-project --template workspace
```

This scaffolds a Vite project with everything wired—routing, state, and build pipeline ready. You get a site and a Foundation in a monorepo, pre-configured to work together.

```bash
cd my-project
pnpm install
pnpm dev
```

No heavy framework to learn. Foundations are React component libraries built with Vite and styled with Tailwind. Sites are Vite apps that load content from markdown files. The CLI handles the wiring.

## Installation

```bash
# Use directly with npx (recommended)
npx uniweb@latest <command>

# Or install globally
npm install -g uniweb
```

## Commands

### `create`

Create a new Uniweb project.

```bash
uniweb create [project-name] [options]
```

**Options:**

| Option              | Description                                            |
| ------------------- | ------------------------------------------------------ |
| `--template <type>` | Project template: `workspace`, `site`, or `foundation` |

**Examples:**

```bash
# Interactive prompts
uniweb create

# Create with specific name
uniweb create my-project

# Full workspace (site + foundation)
uniweb create my-workspace --template workspace

# Standalone foundation
uniweb create my-foundation --template foundation

# Standalone site
uniweb create my-site --template site
```

### `build`

Build the current project.

```bash
uniweb build [options]
```

**Options:**

| Option            | Description                                                           |
| ----------------- | --------------------------------------------------------------------- |
| `--target <type>` | Build target: `foundation` or `site` (auto-detected if not specified) |

**Examples:**

```bash
# Auto-detect and build
uniweb build

# Explicitly build as foundation
uniweb build --target foundation

# Explicitly build as site
uniweb build --target site
```

## Project Templates

### Workspace

A monorepo with both a site and foundation for co-development.

```
my-workspace/
├── package.json
├── pnpm-workspace.yaml
└── packages/
    ├── site/           # Website using the foundation
    └── foundation/     # Component library
```

### Site

A standalone site using an existing foundation.

```
my-site/
├── package.json
├── vite.config.js
├── site.yml
├── src/
│   └── main.jsx
└── pages/
    └── home/
        ├── page.yml
        └── 1-hero.md
```

### Foundation

A standalone component library.

```
my-foundation/
├── package.json
├── vite.config.js
├── tailwind.config.js
└── src/
    ├── meta.js          # Foundation metadata
    ├── styles.css
    └── components/
        └── Hero/
            ├── index.jsx
            └── meta.js
```

## Foundation Build Process

When you run `uniweb build` on a foundation:

1. **Discovers** components from `src/components/*/meta.js`
2. **Generates** entry point (`_entry.generated.js`)
3. **Runs** Vite build
4. **Processes** preview images (converts to WebP)
5. **Generates** `schema.json` with full metadata

**Output:**

```
dist/
├── foundation.js       # Bundled components
├── foundation.js.map   # Source map
├── schema.json         # Component metadata
└── assets/
    ├── style.css       # Compiled CSS
    └── [Component]/    # Preview images
        └── [preset].webp
```

## Related Packages

- [`@uniweb/build`](https://github.com/uniweb/build) - Foundation build tooling
- [`@uniweb/runtime`](https://github.com/uniweb/runtime) - Runtime loader for sites

## License

Apache 2.0
