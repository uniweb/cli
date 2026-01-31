# CLI Commands Reference

The Uniweb CLI (`uniweb`) scaffolds projects, builds foundations and sites, generates documentation, and manages translations.

## Quick Reference

```bash
uniweb create [name]           # Create a new project
uniweb build                   # Build the current project
uniweb docs                    # Generate component documentation
uniweb i18n <command>          # Manage translations
```

---

## uniweb create

Create a new Uniweb project from a template.

```bash
uniweb create [name] [options]
```

### Arguments

| Argument | Description |
|----------|-------------|
| `name` | Project directory name (prompted if omitted) |

### Options

| Option | Description |
|--------|-------------|
| `--template <type>` | Template to use (see below) |
| `--variant <name>` | Template variant (e.g., `tailwind3` for legacy Tailwind) |
| `--name <name>` | Project display name (for package.json) |

### Templates

**Built-in templates:**

| Template | Description |
|----------|-------------|
| `single` | One site + one foundation (default, recommended) |
| `multi` | Multiple sites and foundations workspace |

**Official templates:**

| Template | Description |
|----------|-------------|
| `marketing` | Marketing site with Hero, Features, Pricing, Testimonials |
| `docs` | Documentation site with sidebar, search, versioning |
| `academic` | Academic/research site |

**External templates:**

| Format | Example |
|--------|---------|
| npm package | `@myorg/uniweb-template` |
| GitHub repo | `github:user/repo` |
| GitHub URL | `https://github.com/user/repo` |

### Examples

```bash
# Interactive (prompts for name and template)
uniweb create

# Quick start with defaults
uniweb create my-site

# Use official marketing template
uniweb create my-site --template marketing

# Use npm package template
uniweb create my-site --template @acme/corporate-template

# Use GitHub template
uniweb create my-site --template github:myorg/custom-template

# Legacy Tailwind 3 variant
uniweb create my-site --template marketing --variant tailwind3
```

### Troubleshooting Template Downloads

Official templates (like `marketing`) are fetched from GitHub Releases. If download fails:

1. **Check network access** — Corporate networks may block GitHub API
2. **Use built-in template** — Run `uniweb create my-site` (no `--template`) to use the local `single` template
3. **Check rate limits** — GitHub API has rate limits for unauthenticated requests

---

## uniweb build

Build the current project (foundation, site, or workspace).

```bash
uniweb build [options]
```

The CLI auto-detects the project type:

| Indicator | Type |
|-----------|------|
| `src/sections/`, `src/components/`, or `src/foundation.js` | Foundation |
| `site.yml` or `pages/` | Site |
| `pnpm-workspace.yaml` | Workspace (builds all) |

When run at workspace root, builds all foundations first, then all sites.

### Options

| Option | Description |
|--------|-------------|
| `--target <type>` | Force build type: `foundation` or `site` |
| `--prerender` | Force static HTML generation (overrides site.yml) |
| `--no-prerender` | Skip static HTML generation (overrides site.yml) |
| `--foundation-dir <path>` | Path to foundation (for site prerendering) |
| `--platform <name>` | Deployment platform (e.g., `vercel`) |

### Foundation Build

When run in a foundation directory:

1. Discovers section types from `src/sections/` and `src/components/` (with `meta.js`)
2. Generates entry point (`_entry.generated.js`)
3. Runs Vite build
4. Processes preview images (converts to WebP)
5. Generates `schema.json` with full metadata

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

```bash
cd foundation
uniweb build
```

### Site Build

When run in a site directory:

1. Runs Vite build for the site
2. If `build.prerender: true` in `site.yml`, generates static HTML for all pages

```bash
cd site
uniweb build
```

### Pre-rendering (SSG)

Pre-rendering generates static HTML at build time for fast loads and SEO.

**Enable in site.yml:**
```yaml
build:
  prerender: true
```

**Or via CLI:**
```bash
uniweb build --prerender
```

**Output:**
```
dist/
├── index.html          # Homepage
├── about.html          # /about page
├── docs/
│   └── getting-started.html
└── assets/
```

### Examples

```bash
# Build entire workspace (from root)
uniweb build

# Build foundation only
cd foundation && uniweb build

# Build site with prerendering
cd site && uniweb build --prerender

# Build for Vercel deployment
uniweb build --platform vercel
```

---

## uniweb docs

Generate documentation from your foundation's component schemas.

```bash
uniweb docs [subcommand] [options]
```

### Subcommands

| Subcommand | Description |
|------------|-------------|
| *(none)* | Generate `COMPONENTS.md` from foundation schema |
| `site` | Show `site.yml` configuration reference |
| `page` | Show `page.yml` configuration reference |
| `meta` | Show component `meta.js` reference |

### Options

| Option | Description |
|--------|-------------|
| `--output <file>` | Output filename (default: `COMPONENTS.md`) |
| `--from-source` | Read `meta.js` files directly instead of `schema.json` |
| `--target <path>` | Specify foundation directory |

### Generated Documentation

The `COMPONENTS.md` file includes for each component:

- Title and description
- Category and purpose
- Content expectations (what markdown elements it uses)
- Parameters with types, options, and defaults
- Available presets

### Examples

```bash
# Generate COMPONENTS.md in current foundation
cd foundation
uniweb docs

# Generate with custom filename
uniweb docs --output REFERENCE.md

# Generate from source (no build required)
uniweb docs --from-source

# Show site.yml reference
uniweb docs site

# Show page.yml reference
uniweb docs page

# Show meta.js reference
uniweb docs meta
```

---

## uniweb i18n

Manage internationalization and translations.

```bash
uniweb i18n <command> [options]
```

### Commands

| Command | Description |
|---------|-------------|
| `extract` | Extract translatable strings to manifest |
| `sync` | Update manifest with content changes |
| `status` | Show translation coverage per locale |

### Options

| Option | Description |
|--------|-------------|
| `--target <path>` | Specify site directory |
| `--verbose` | Show detailed output |
| `--dry-run` | Show changes without writing (sync only) |
| `--locale <code>` | Filter to specific locale (status only) |

### Workflow

**1. Extract strings:**
```bash
uniweb i18n extract
```

Parses all content and generates `locales/manifest.json` with translatable strings keyed by content hash.

**2. Provide translations:**

Create `locales/{locale}.json` with translations:

```json
{
  "a1b2c3d4": "Translated text here"
}
```

**3. Check coverage:**
```bash
uniweb i18n status
```

Shows which strings are translated per locale.

**4. After content changes:**
```bash
uniweb i18n sync
```

Detects changes, updates manifest, flags strings needing re-translation.

### Examples

```bash
# Extract all translatable strings
uniweb i18n extract

# Check translation status
uniweb i18n status

# Status for specific locale
uniweb i18n status --locale es

# Sync after content changes (dry run)
uniweb i18n sync --dry-run

# Sync and update manifest
uniweb i18n sync
```

---

## Project Structure

The CLI expects these project structures:

### Single Project (default)

```
my-project/
├── foundation/          # React components
│   ├── src/
│   │   └── sections/
│   ├── package.json
│   └── vite.config.js
├── site/                # Content
│   ├── pages/
│   ├── site.yml
│   └── package.json
├── package.json
└── pnpm-workspace.yaml
```

### Multi-Site Workspace

```
my-workspace/
├── foundations/
│   ├── corporate/
│   └── docs/
├── sites/
│   ├── main-site/
│   └── docs-site/
├── package.json
└── pnpm-workspace.yaml
```

---

## Environment Detection

The CLI auto-detects context:

| Directory Contains | Detected As |
|-------------------|-------------|
| `src/sections/` or `src/components/` | Foundation |
| `pages/` | Site |
| `pnpm-workspace.yaml` + `sites/` | Multi-site workspace |

When in a workspace root with multiple sites/foundations, the CLI prompts for selection.

---

## Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | Error (invalid arguments, build failure, etc.) |

---

## See Also

- [Site Configuration](./site-configuration.md) — `site.yml` reference
- [Page Configuration](./page-configuration.md) — `page.yml` reference
- [Component Metadata](./component-metadata.md) — `meta.js` reference
- [Internationalization](./internationalization.md) — Translation workflow
