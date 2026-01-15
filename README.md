# uniweb

Create a well-structured Vite + React site with content/code separation, file-based routing, localization, and structured content—out of the box. The architecture scales to dynamic content management and collaborative visual editing when you need it.

## Quick Start

Create a new Uniweb project:

```bash
npx uniweb@latest create my-project
cd my-project
pnpm install
pnpm dev
```

You get a workspace with two packages:

- **`site/`** — Content, pages, entry point
- **`foundation/`** — Your React components

Content authors work in markdown. Component authors work in React. Neither can break the other's work, and component updates flow to every site using them.

## What You Get

```
my-project/
├── site/                     # Content + configuration
│   ├── pages/                # File-based routing
│   │   └── home/
│   │       ├── page.yml      # Page metadata
│   │       └── 1-hero.md     # Section content
│   ├── locales/              # i18n (mirrors pages/)
│   │   └── es/
│   └── public/               # Static assets
│
└── foundation/               # Your components
    └── src/
        └── components/
            └── Hero/
                └── index.jsx
```

**Pages are folders.** Create `pages/about/` with a markdown file inside → visit `/about`. That's the whole routing model.

### Content as Markdown

```markdown
---
component: Hero
theme: dark
---

# Welcome

Build something great.

[Get Started](#)
```

Frontmatter specifies the component and configuration. The body contains the actual content—headings, paragraphs, links, images—which gets semantically parsed into structured data your component receives.

### Beyond Markdown

For content that doesn't fit markdown patterns—products, team members, events—use JSON blocks with schema tags:

````markdown
```json #team-member
{
  "name": "Sarah Chen",
  "role": "Lead Architect"
}
```
````

Components receive validated, typed data. Natural content stays in markdown; structured data goes in JSON blocks.

### Components as React

```jsx
export function Hero({ content, params }) {
  const { title } = content.main.header;
  const { paragraphs, links } = content.main.body;
  const { theme = 'light' } = params;

  return (
    <section className={`py-20 text-center ${theme === 'dark' ? 'bg-gray-900 text-white' : ''}`}>
      <h1 className="text-4xl font-bold">{title}</h1>
      <p className="text-xl text-gray-600">{paragraphs[0]}</p>
      {links[0] && (
        <a href={links[0].url} className="mt-8 px-6 py-3 bg-blue-600 text-white rounded inline-block">
          {links[0].text}
        </a>
      )}
    </section>
  );
}
```

Standard React. Standard Tailwind. The `{ content, params }` interface is only for *exposed* components—the ones content creators select in markdown frontmatter. Internal components (the majority of your codebase) use regular React props.

No framework to learn. Foundations are purpose-built component systems designed for a specific domain (marketing, documentation, learning, etc.). Sites are Vite apps that load content from markdown files. The CLI handles the wiring.

## The Bigger Picture

The structure you start with scales without rewrites:

1. **Single project** — One site, one component library. Most projects stay here.
2. **Multi-site** — One foundation powers multiple sites. Release it once, updates propagate automatically.
3. **Full platform** — [uniweb.app](https://uniweb.app) adds visual editing, live content management, and team collaboration. Your foundation plugs in and its components become native to the editor.

Start with local markdown files deployed anywhere. Connect to [uniweb.app](https://uniweb.app) when you're ready for dynamic content and team collaboration.

---

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

| Option              | Description                           |
| ------------------- | ------------------------------------- |
| `--template <type>` | Project template: `single` or `multi` |

**Examples:**

```bash
# Interactive prompts
uniweb create

# Create with specific name (defaults to single template)
uniweb create my-project

# Single project with site + foundation
uniweb create my-project --template single

# Multi-site/foundation monorepo
uniweb create my-workspace --template multi
```

### `build`

Build the current project.

```bash
uniweb build [options]
```

**Options:**

| Option              | Description                                                           |
| ------------------- | --------------------------------------------------------------------- |
| `--target <type>`   | Build target: `foundation` or `site` (auto-detected if not specified) |
| `--platform <name>` | Deployment platform (e.g., `vercel`) for platform-specific output     |

**Examples:**

```bash
# Auto-detect and build
uniweb build

# Explicitly build as foundation
uniweb build --target foundation

# Explicitly build as site
uniweb build --target site

# Build for Vercel deployment
uniweb build --platform vercel
```

## Project Templates

### Single (Default)

A minimal workspace with a site and foundation as sibling packages. This is the recommended starting point.

```
my-project/
├── package.json              # Workspace root (includes workspaces field for npm)
├── pnpm-workspace.yaml       # Pre-configured for evolution (see below)
│
├── site/                     # Site package (content + entry)
│   ├── package.json
│   ├── vite.config.js
│   ├── index.html
│   ├── site.yml
│   ├── src/
│   │   └── main.jsx          # Thin entry point
│   ├── pages/                # Content structure
│   │   └── home/
│   │       ├── page.yml
│   │       └── 1-hero.md
│   ├── locales/              # i18n (mirrors pages/)
│   │   └── es/
│   │       └── home/
│   └── public/               # Static assets
│
└── foundation/               # Foundation package (components)
    ├── package.json
    ├── vite.config.js
    ├── src/
    │   ├── index.js          # Component registry
    │   ├── styles.css        # Tailwind
    │   ├── meta.js           # Foundation metadata
    │   └── components/
    │       └── Hero/
    │           ├── index.jsx
    │           └── meta.js
    └── ...
```

**Key characteristics:**

- **Convention-compliant** — Each package has its own `src/`
- **Clear dep boundaries** — Component libs → `foundation/package.json`, runtime → `site/package.json`
- **Zero extraction** — `foundation/` is already a complete, publishable package
- **Scales naturally** — Rename to `sites/marketing/` and `foundations/marketing/` when needed

### Multi

A monorepo for multi-site or multi-foundation development.

```
my-workspace/
├── package.json              # Workspace root (includes workspaces field for npm)
├── pnpm-workspace.yaml       # Same config as site template
│
├── sites/
│   ├── marketing/            # Main marketing site
│   │   ├── package.json
│   │   ├── site.yml
│   │   ├── src/
│   │   ├── pages/
│   │   └── ...
│   └── docs/                 # Documentation site
│
└── foundations/
    ├── marketing/            # Marketing foundation
    │   ├── package.json
    │   ├── src/components/
    │   └── ...
    └── documentation/        # Documentation foundation
```

Use this when you need:

- Multiple sites sharing foundations
- Multiple foundations for different purposes
- A testing site for foundation development

## Dependency Management

Each package manages its own dependencies:

**`site/package.json`:**

- `@uniweb/runtime`
- `@my-project/foundation` (workspace link)
- Vite, Tailwind (dev)

**`foundation/package.json`:**

- Component libraries (carousel, icons, etc.)
- React as peer dependency

```bash
# Add component dependency
cd foundation && pnpm add embla-carousel

# Site references foundation via workspace
# No path gymnastics needed
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

## Workspace Configuration

Both templates use the same unified workspace configuration:

```yaml
# pnpm-workspace.yaml
packages:
  - "site"
  - "foundation"
  - "sites/*"
  - "foundations/*"
```

```json
// package.json (workspaces field for npm compatibility)
{
  "workspaces": ["site", "foundation", "sites/*", "foundations/*"]
}
```

This means **no config changes when evolving your project**.

## Evolving Your Project

The workspace is pre-configured for growth. Choose your path:

**Add alongside existing structure:**

```bash
# Keep site/ and foundation/, add more in sites/ and foundations/
mkdir -p sites/docs
mkdir -p foundations/documentation
```

**Or migrate to multi-site structure:**

```bash
# Move and rename by purpose
mv site sites/marketing
mv foundation foundations/marketing

# Update package names in each package.json
# Update workspace:* references to new names
```

Both patterns work simultaneously—evolve gradually as needed.

## Releasing a Foundation

Publish your foundation to [uniweb.app](https://uniweb.app) to make it available for your sites:

```bash
uniweb login          # First time only
uniweb build
uniweb publish        # Publishes the foundation in the current directory
```

Each release creates a new version you can link to sites. You own your foundations and license them to sites—yours or your clients'. Content creators work on sites; when you release updates, linked sites receive them automatically.

You can also publish to npm:

```bash
npm publish
```

## FAQ

**How is this different from MDX?**

MDX blends markdown and JSX—content authors write code. Uniweb keeps them separate: content stays in markdown, components stay in React. Content authors can't break components, and component updates don't require content changes.

**How is this different from Astro?**

Astro is a static site generator. Uniweb is a content architecture that works with any deployment (static, SSR, or platform-managed). The Foundation model means components are reusable across sites and ready for visual editing.

**Do I need uniweb.app?**

No. Local markdown files work great for developer-managed sites. The platform adds dynamic content, visual editing, and team collaboration when you need it.

## Related Packages

- [`@uniweb/build`](https://github.com/uniweb/build) — Foundation build tooling
- [`@uniweb/runtime`](https://github.com/uniweb/runtime) — Runtime loader for sites

## License

Apache 2.0
