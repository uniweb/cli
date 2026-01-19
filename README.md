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
│   ├── locales/              # i18n (hash-based translations)
│   │   ├── manifest.json     # Auto-extracted strings
│   │   └── es.json           # Spanish translations
│   ├── main.js               # 1-line entry point
│   ├── vite.config.js        # 3-line config
│   └── public/               # Static assets
│
└── foundation/               # Your components
    ├── src/
    │   └── components/
    │       └── Hero/
    │           ├── index.jsx
    │           └── meta.js
    ├── vite.config.js        # 3-line config
    └── dist/                 # Built output
```

**Pages are folders.** Create `pages/about/` with markdown files inside → visit `/about`. That's the whole routing model.

### Content as Markdown

```markdown
---
type: Hero
theme: dark
---

# Welcome

Build something great.

[Get Started](#)
```

Frontmatter specifies the component type and configuration. The body contains the actual content—headings, paragraphs, links, images—which gets semantically parsed into structured data your component receives.

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

Components receive validated, localized data. Natural content stays in markdown; structured data goes in JSON blocks.

### Components as React

```jsx
export function Hero({ content, params }) {
  const { title } = content.main.header;
  const { paragraphs, links } = content.main.body;
  const { theme = "light" } = params;

  return (
    <section
      className={`py-20 text-center ${theme === "dark" ? "bg-gray-900 text-white" : ""}`}
    >
      <h1 className="text-4xl font-bold">{title}</h1>
      <p className="text-xl text-gray-600">{paragraphs[0]}</p>
      {links[0] && (
        <a
          href={links[0].url}
          className="mt-8 px-6 py-3 bg-blue-600 text-white rounded inline-block"
        >
          {links[0].text}
        </a>
      )}
    </section>
  );
}
```

Standard React. Standard Tailwind. The `{ content, params }` interface is only for _exposed_ components—the ones content creators select in markdown frontmatter. Internal components (the majority of your codebase) use regular React props.

No framework to learn. Foundations are purpose-built component systems designed for a specific domain (marketing, documentation, learning, etc.). Sites are Vite apps that load content from markdown files.

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

**Requirements:**

- Node.js 20.19 or later
- pnpm 10+ (recommended) or npm 10+

Projects use Vite 7 and Tailwind CSS v4 by default.

### Setting up pnpm

Uniweb projects use pnpm for dependency management. The easiest way to get pnpm is via **Corepack**, which ships with Node.js.

**Enable Corepack (one-time setup):**

```bash
corepack enable
```

> **Node 25+**: Corepack is no longer bundled. Install it first:
> ```bash
> npm i -g corepack && corepack enable
> ```

**Troubleshooting:**

- If `pnpm` isn't found after enabling Corepack, you may have a global pnpm installation shadowing it. Remove it with `npm uninstall -g pnpm`.
- Alternatively, install pnpm directly: `npm install -g pnpm`

Once Corepack is enabled, running `pnpm install` in a Uniweb project will automatically use the correct pnpm version specified in `package.json`.

## Commands

### `create`

Create a new Uniweb project.

```bash
uniweb create [project-name] [options]
```

**Options:**

| Option              | Description                  |
| ------------------- | ---------------------------- |
| `--template <type>` | Project template (see below) |

**Template Sources:**

| Source     | Example                        | Description                     |
| ---------- | ------------------------------ | ------------------------------- |
| Built-in   | `single`, `multi`              | Minimal starter templates       |
| Official   | `marketing`                    | Feature-rich showcase templates |
| npm        | `@org/my-template`             | Published npm packages          |
| GitHub     | `github:user/repo`             | GitHub repositories             |
| GitHub URL | `https://github.com/user/repo` | Full GitHub URLs                |

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

# Official marketing template (landing pages, pricing, testimonials)
uniweb create my-site --template marketing

# From npm package
uniweb create my-site --template @myorg/starter-template

# From GitHub repository
uniweb create my-site --template github:myorg/uniweb-template
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
| `--prerender`       | Pre-render pages to static HTML (SSG) - site builds only              |
| `--foundation-dir`  | Path to foundation directory (for prerendering)                       |
| `--platform <name>` | Deployment platform (e.g., `vercel`) for platform-specific output     |

**Examples:**

```bash
# Auto-detect and build
uniweb build

# Explicitly build as foundation
uniweb build --target foundation

# Explicitly build as site
uniweb build --target site

# Build site with pre-rendering (SSG)
uniweb build --prerender

# Build for Vercel deployment
uniweb build --platform vercel
```

### Pre-rendering (SSG)

The `--prerender` flag generates static HTML for each page at build time. This is useful for:

- **SEO**: Search engines see fully rendered content immediately
- **Performance**: First contentful paint is instant (no JavaScript required)
- **Hosting**: Deploy to any static host (GitHub Pages, Netlify, S3, etc.)

**How it works:**

1. The site build runs first, generating the JavaScript bundle and `site-content.json`
2. The prerenderer loads the foundation and site content in Node.js
3. Each page is rendered to HTML using React's `renderToString()`
4. The HTML is injected into the shell with the site content embedded

**Hydration:**

The pre-rendered HTML includes a `<script id="__SITE_CONTENT__">` tag with the full site data. When the page loads in the browser:

1. The static HTML displays immediately (no flash of loading state)
2. React hydrates the existing DOM instead of replacing it
3. The site becomes fully interactive with client-side routing

**Usage:**

```bash
# From site directory
cd site
pnpm build:ssg

# Or from workspace root
cd site && uniweb build --prerender
```

## Built-in Templates

### Single (Default)

A minimal workspace with a site and foundation as sibling packages. This is the recommended starting point.

```
my-project/
├── package.json              # Workspace root (npm + pnpm compatible)
├── pnpm-workspace.yaml       # Pre-configured for evolution (see below)
├── CLAUDE.md                 # AI assistant instructions
│
├── site/                     # Site package (content + entry)
│   ├── package.json
│   ├── vite.config.js        # 3-line config
│   ├── index.html
│   ├── site.yml              # Site configuration (foundation, title, i18n)
│   ├── main.js               # 1-line entry point
│   ├── pages/                # Content pages (file-based routing)
│   │   └── home/
│   │       ├── page.yml
│   │       └── 1-hero.md
│   └── public/               # Static assets
│
└── foundation/               # Foundation package (components)
    ├── package.json
    ├── vite.config.js        # 3-line config
    └── src/
        ├── index.js          # Component exports
        ├── entry-runtime.js  # Runtime entry (imports styles + index)
        ├── styles.css        # Tailwind CSS v4
        ├── meta.js           # Foundation metadata
        └── components/
            └── Section/
                ├── index.jsx
                └── meta.js
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
├── package.json              # Workspace root (npm + pnpm compatible)
├── pnpm-workspace.yaml       # Same config as single template
├── CLAUDE.md                 # AI assistant instructions
│
├── sites/
│   ├── marketing/            # Main marketing site
│   │   ├── package.json
│   │   ├── vite.config.js    # 3-line config
│   │   ├── site.yml
│   │   ├── main.js         # 1-line entry point
│   │   └── pages/
│   └── docs/                 # Documentation site
│
└── foundations/
    ├── marketing/            # Marketing foundation
    │   ├── package.json
    │   ├── vite.config.js    # 3-line config
    │   └── src/components/
    └── documentation/        # Documentation foundation
```

Use this when you need:

- Multiple sites sharing foundations
- Multiple foundations for different purposes
- A testing site for foundation development

## Official Templates

Feature-rich templates that demonstrate what's possible with Uniweb. These include real components, sample content, and production-ready structure.

### Marketing

A complete marketing site with landing page components:

```bash
uniweb create my-site --template marketing
```

**Includes:** Hero, Features, Pricing, Testimonials, CTA, FAQ, Stats, LogoCloud, Video, Gallery, Team

Perfect for product launches, SaaS websites, and business landing pages.

**Tailwind v3 variant:**

```bash
uniweb create my-site --template marketing --variant tailwind3
```

### Academic

A professional academic site for researchers, labs, and departments:

```bash
uniweb create my-site --template academic
```

**Includes:** ProfileHero, PublicationList, ResearchAreas, TeamGrid, Timeline, ContactCard, Navbar, Footer

Perfect for researcher portfolios, lab websites, and academic department sites.

### Docs

A documentation site with navigation levels:

```bash
uniweb create my-site --template docs
```

**Includes:** Header, LeftPanel, DocSection, CodeBlock, Footer

Perfect for technical documentation, guides, and API references.

## External Templates

You can use templates from npm or GitHub:

```bash
# npm package
uniweb create my-site --template @myorg/template-name

# GitHub repository
uniweb create my-site --template github:user/repo

# GitHub with specific branch/tag
uniweb create my-site --template github:user/repo#v1.0.0
```

External templates must follow the same structure as official templates. See [`@uniweb/templates`](https://github.com/uniweb/templates) for the template format specification.

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

## Configuration

### Site Configuration

The `defineSiteConfig()` function handles all Vite configuration for sites:

```javascript
import { defineSiteConfig } from "@uniweb/build/site";

export default defineSiteConfig({
  // All options are optional
  tailwind: true, // Enable Tailwind CSS v4 (default: true)
  plugins: [], // Additional Vite plugins
  // ...any other Vite config options
});
```

### Foundation Configuration

The `defineFoundationConfig()` function handles all Vite configuration for foundations:

```javascript
import { defineFoundationConfig } from "@uniweb/build";

export default defineFoundationConfig({
  // All options are optional
  entry: "src/entry-runtime.js", // Entry point path
  fileName: "foundation", // Output file name
  externals: [], // Additional packages to externalize
  includeDefaultExternals: true, // Include react, @uniweb/core, etc.
  tailwind: true, // Enable Tailwind CSS v4 Vite plugin
  sourcemap: true, // Generate sourcemaps
  plugins: [], // Additional Vite plugins
  build: {}, // Additional Vite build options
  // ...any other Vite config options
});
```

For Tailwind CSS v3 projects, set `tailwind: false` and use PostCSS:

```javascript
export default defineFoundationConfig({
  tailwind: false, // Uses PostCSS instead of Vite plugin
});
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

# Update package names and workspace dependencies in package.json files
```

Both patterns work simultaneously—evolve gradually as needed.

## Releasing a Foundation

Publish your foundation to [uniweb.app](https://uniweb.app) to make it available for your sites:

```bash
uniweb login          # First time only
uniweb build
uniweb publish        # Publishes the foundation in the current directory
```

Each release creates a new version. Sites link to foundations at runtime and control their own update strategy—automatic, minor-only, patch-only, or pinned to a specific version. You own your foundations and license them to sites—yours or your clients'.

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

**Is this SEO-friendly?**

Yes. Content is pre-embedded in the initial HTML—no fetch waterfalls, no layout shifts, instant interaction. Meta tags are generated per page for proper social sharing previews. SSG and SSR are also supported.

**What about dynamic routes?**

Pages can define data sources that auto-generate subroutes. A `/blog` page can have an index (listing) and a `[slug]` template that renders each post. No manual folders for every entry.

## Related Packages

- [`@uniweb/build`](https://github.com/uniweb/build) — Foundation build tooling
- [`@uniweb/runtime`](https://github.com/uniweb/runtime) — Foundation loader and orchestrator for sites
- [`@uniweb/templates`](https://github.com/uniweb/templates) — Official templates and template processing

## License

Apache 2.0
