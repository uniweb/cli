# uniweb

A component content architecture for React. Build sites where content authors and component developers can't break each other's work—and scale from local files to visual editing without rewrites.

Create well-structured Vite + React projects with file-based routing, localization, and clean content/code separation out of the box.

## Quick Start

```bash
pnpm create uniweb my-site --template marketing
cd my-site
pnpm install
pnpm dev
```

Open http://localhost:5173 to see your site. Edit files in `site/pages/` and `foundation/src/sections/` to see changes instantly.

> **Need pnpm?** Run `npm install -g pnpm` or see [pnpm installation](https://pnpm.io/installation).

### Development Commands

Run these from the **project root** (where `pnpm-workspace.yaml` is):

```bash
pnpm dev        # Start development server
pnpm build      # Build foundation + site for production
pnpm preview    # Preview the production build
```

The `build` command generates static HTML in `site/dist/`. Open those files to verify your output before deploying.

The `marketing` template includes real components (Hero, Features, Pricing, Testimonials, FAQ, and more) with sample content—a working site you can explore and modify.

**Other templates:**

```bash
# Multilingual business site (English, Spanish, French)
pnpm create uniweb my-site --template international

# Academic site (researcher portfolios, lab pages)
pnpm create uniweb my-site --template academic

# Documentation site
pnpm create uniweb my-site --template docs

# Minimal starter (build from scratch)
pnpm create uniweb my-site
```

**See them live:** [View all template demos](https://uniweb.github.io/templates/)

## What You Get

Every project is a workspace with two packages:

- **`site/`** — Content, pages, entry point
- **`foundation/`** — React components

Content authors work in markdown. Component authors work in React. Neither can break the other's work.

```
my-project/
├── site/                     # Content + configuration
│   ├── pages/                # File-based routing
│   │   └── home/
│   │       ├── page.yml      # Page metadata
│   │       └── hero.md       # Section content
│   ├── locales/              # i18n (hash-based translations)
│   ├── main.js               # Entry point (~6 lines)
│   ├── vite.config.js        # 3-line config
│   └── public/               # Static assets
│
└── foundation/               # Your components
    ├── src/
    │   ├── sections/         # Section types (addressable from markdown)
    │   │   ├── Hero.jsx      # Bare file → section type (no meta.js needed)
    │   │   └── Features/
    │   │       ├── meta.js   # Content interface (params, presets)
    │   │       └── Features.jsx
    │   └── components/       # Regular React components
    │       └── Button.jsx
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

For content that doesn't fit markdown patterns—products, team members, events—use tagged code blocks:

````markdown
```yaml:team-member
name: Sarah Chen
role: Lead Architect
```
````

Access the parsed data via `content.data`:

```jsx
function TeamCard({ content }) {
  const member = content.data['team-member']
  return (
    <div>
      {member.name} — {member.role}
    </div>
  )
}
```

Natural content stays in markdown; structured data goes in tagged blocks (YAML or JSON).

### Components as React

```jsx
export default function Hero({ content }) {
  const { title, paragraphs, links } = content

  return (
    <section className="py-20 text-center">
      <h1 className="text-4xl font-bold" style={{ color: 'var(--heading)' }}>{title}</h1>
      <p className="text-xl" style={{ color: 'var(--text)' }}>{paragraphs[0]}</p>
      {links[0] && (
        <a
          href={links[0].href}
          className="mt-8 px-6 py-3 rounded inline-block"
          style={{ backgroundColor: 'var(--link)', color: 'white' }}
        >
          {links[0].label}
        </a>
      )}
    </section>
  )
}
```

Standard React. Semantic CSS variables (`var(--heading)`, `var(--text)`) adapt automatically when content authors set `theme: dark` in frontmatter — no conditional logic needed. The `{ content, params }` interface is only for _section types_ — components that content creators select in markdown frontmatter. Everything else uses regular React props.

## Next Steps

After creating your project:

1. **Explore the structure** — Browse `site/pages/` to see how content is organized. Each page folder contains `page.yml` (metadata) and `.md` files (sections).

2. **Generate component docs** — Run `pnpm uniweb docs` to create `COMPONENTS.md` with all available components, their parameters, and presets.

3. **Learn the configuration** — Run `uniweb docs site` or `uniweb docs page` for quick reference on configuration options.

4. **Create a section type** — Add a file to `foundation/src/sections/` (e.g., `Banner.jsx`) and rebuild. Bare files at the root are discovered automatically — no `meta.js` needed. Add `meta.js` when you want to declare params or presets. See the [Component Metadata Guide](https://github.com/uniweb/cli/blob/main/docs/component-metadata.md) for the full schema.

The `meta.js` file defines what content and parameters a component accepts. The runtime uses this metadata to apply defaults and guarantee content structure—no defensive null checks needed in your component code.

### Your First Content Change

Open `site/pages/home/hero.md` and edit the headline:

```markdown
---
type: Hero
---

# Your New Headline Here

Updated description text.

[Get Started](/about)
```

Save and see the change instantly in your browser.

### Your First Component Change

Open `foundation/src/sections/Hero.jsx`. The component receives parsed content:

```jsx
export default function Hero({ content }) {
  const { title, paragraphs, links, imgs, items } = content
  // Edit the JSX below...
}
```

The parser extracts semantic elements from markdown—`title` from the first heading, `paragraphs` from body text, `links` from `[text](url)`, and so on. The `items` array contains child groups created when headings appear after content (useful for features, pricing tiers, team members, etc.).

## Guides

**For developers** (building foundations and components):
- [Building with Uniweb](./guides/developers/building-with-uniweb.md) — How the project structure works
- [Converting Existing Designs](./guides/developers/converting-existing-designs.md) — Bringing React code into a foundation
- [Component Patterns](./guides/developers/component-patterns.md) — Dispatcher, Building Blocks, organization
- [Thinking in Contexts](./guides/developers/thinking-in-contexts.md) — Semantic theming

**For content authors** (writing pages in markdown):
- [Writing Content](./guides/authors/writing-content.md) — Headings, items, links, images
- [Site Setup](./guides/authors/site-setup.md) — Pages, navigation, configuration
- [Theming](./guides/authors/theming.md) — Colors, contexts, backgrounds
- [Recipes](./guides/authors/recipes.md) — Common patterns and solutions

**Reference docs:**

_Content & Configuration_
- [Content Structure](./docs/content-structure.md) — How content is parsed and structured
- [Site Configuration](./docs/site-configuration.md) — Complete site.yml reference
- [Page Configuration](./docs/page-configuration.md) — Complete page.yml reference
- [Linking](./docs/linking.md) — Stable page references that survive reorganization

_Components & Foundations_
- [Component Metadata](./docs/component-metadata.md) — Full meta.js schema reference
- [Foundation Configuration](./docs/foundation-configuration.md) — CSS variables and custom Layout
- [Site Theming](./docs/site-theming.md) — Colors, typography, and dark mode
- [Navigation Patterns](./docs/navigation-patterns.md) — Building navbars, menus, and sidebars
- [Special Sections](./docs/special-sections.md) — @header, @footer, and sidebars

_Advanced_
- [Internationalization](./docs/internationalization.md) — Multi-language sites
- [Data Fetching](./docs/data-fetching.md) — Load external data from files or APIs
- [Dynamic Routes](./docs/dynamic-routes.md) — Generate pages from data (blogs, catalogs)
- [Content Collections](./docs/content-collections.md) — Manage articles, team members, and more
- [Versioning](./docs/versioning.md) — Multi-version documentation
- [Site Search](./docs/search.md) — Built-in full-text search
- [Runtime API](./docs/runtime-api.md) — Hooks and core objects

## Foundations Are Portable

The `foundation/` folder ships with your project as a convenience, but a foundation is a self-contained artifact with no dependency on any specific site. Sites reference foundations by configuration, not by folder proximity.

**Three ways to use a foundation:**

| Mode             | How it works                       | Best for                                           |
| ---------------- | ---------------------------------- | -------------------------------------------------- |
| **Local folder** | Foundation lives in your workspace | Developing site and components together            |
| **npm package**  | `pnpm add @acme/foundation`        | Distributing via standard package tooling          |
| **Runtime link** | Foundation loads from a URL        | Independent release cycles, platform-managed sites |

You can delete the `foundation/` folder entirely and point your site at a published foundation. Or develop a foundation locally, then publish it for other sites to consume. The site doesn't care where its components come from.

**This enables two development patterns:**

_Site-first_ — You're building a website. The foundation is your component library, co-developed with the site. This is the common case.

_Foundation-first_ — You're building a component system. The site is a test harness with sample content. The real sites live elsewhere—other repositories, other teams, or managed on [uniweb.app](https://uniweb.app). The `multi` template supports this workflow with multiple test sites exercising a shared foundation.

## The Bigger Picture

The structure you start with scales without rewrites:

1. **Single project** — One site, one foundation. Develop and deploy together. Most projects stay here.

2. **Published foundation** — Release your foundation as an npm package or to [uniweb.app](https://uniweb.app). Other sites can use it without copying code.

3. **Multiple sites** — Several sites share one foundation. Update components once, every site benefits.

4. **Platform-managed sites** — Sites built on [uniweb.app](https://uniweb.app) with visual editing tools can use your foundation. You develop components locally; content teams work in the browser.

Start with local files deployed anywhere. The same foundation works across all these scenarios.

---

## Create a Project

```bash
# pnpm (recommended)
pnpm create uniweb my-site --template marketing

# npm (use -- before options)
npm create uniweb@latest my-site -- --template marketing

# npx
npx uniweb@latest create my-site --template marketing
```

Alternatively, install the CLI globally:

```bash
npm install -g uniweb
uniweb create my-site --template marketing
```

**Requirements:**

- Node.js 20.19 or later
- pnpm 10+ (recommended) or npm 10+

Projects use Vite 7 and Tailwind CSS v4 by default.

### Setting up pnpm

We recommend pnpm for dependency management (npm also works). Install pnpm via npm:

```bash
npm install -g pnpm
```

Or see the [official pnpm installation guide](https://pnpm.io/installation) for other options including Corepack, Homebrew, and more.

## Commands

### `create`

Create a new Uniweb project. See [Create a Project](#create-a-project) for usage examples.

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

### `build`

Build the current project.

```bash
uniweb build [options]
```

**Options:**

| Option              | Description                                                           |
| ------------------- | --------------------------------------------------------------------- |
| `--target <type>`   | Build target: `foundation` or `site` (auto-detected if not specified) |
| `--prerender`       | Force pre-rendering (overrides site.yml)                              |
| `--no-prerender`    | Skip pre-rendering (overrides site.yml)                               |
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

# Build site with pre-rendering (SSG) - force on
uniweb build --prerender

# Skip pre-rendering even if enabled in site.yml
uniweb build --no-prerender

# Build for Vercel deployment
uniweb build --platform vercel
```

### Pre-rendering (SSG)

Pre-rendering generates static HTML for each page at build time. Enable it in `site.yml`:

```yaml
build:
  prerender: true
```

Or use the `--prerender` flag. This gives you:

- **SEO**: Search engines see fully rendered content immediately
- **Performance**: First contentful paint is instant
- **Hosting**: Deploy to any static host (GitHub Pages, Netlify, S3, etc.)

The pre-rendered HTML includes embedded site content. When the page loads, React hydrates the existing DOM—no flash of loading state, then full client-side interactivity.

## Built-in Templates

### Single (Default)

A minimal workspace with a site and foundation as sibling packages. The recommended starting point.

```
my-project/
├── package.json              # Workspace root
├── pnpm-workspace.yaml
├── site/
│   ├── package.json
│   ├── vite.config.js
│   ├── site.yml
│   ├── main.js
│   └── pages/
└── foundation/
    ├── package.json
    ├── vite.config.js
    └── src/sections/
```

### Multi

A monorepo for foundation development or multi-site projects.

```
my-workspace/
├── sites/
│   ├── marketing/            # Main site or test site
│   └── docs/                 # Additional site
└── foundations/
    ├── marketing/            # Primary foundation
    └── documentation/        # Additional foundation
```

Use this when you need multiple sites sharing foundations, multiple foundations for different purposes, or test sites for foundation development.

## Official Templates

Feature-rich templates with real components and sample content. **[View all demos](https://uniweb.github.io/templates/)**

### Marketing

[**Live Demo**](https://uniweb.github.io/templates/marketing/) · `pnpm create uniweb my-site --template marketing`

**Includes:** Hero, Features, Pricing, Testimonials, CTA, FAQ, Stats, LogoCloud, Video, Gallery, Team

Perfect for product launches, SaaS websites, and business landing pages.

**Tailwind v3 variant:** `--variant tailwind3`

### Academic

[**Live Demo**](https://uniweb.github.io/templates/academic/) · `pnpm create uniweb my-site --template academic`

**Includes:** ProfileHero, PublicationList, ResearchAreas, TeamGrid, Timeline, ContactCard, Navbar, Footer

Perfect for researcher portfolios, lab websites, and academic department sites.

### Docs

[**Live Demo**](https://uniweb.github.io/templates/docs/) · `pnpm create uniweb my-site --template docs`

**Includes:** Header, LeftPanel, DocSection, CodeBlock, Footer

Perfect for technical documentation, guides, and API references.

### International

[**Live Demo**](https://uniweb.github.io/templates/international/) · `pnpm create uniweb my-site --template international`

**Includes:** Hero, Features, Team, CTA, Header (with language switcher), Footer (with language links)

**Languages:** English (default), Spanish, French

A multilingual business site demonstrating Uniweb's i18n capabilities. Includes pre-configured translation files and a complete localization workflow:

```bash
uniweb i18n extract   # Extract translatable strings
uniweb i18n status    # Check translation coverage
uniweb build          # Generates dist/es/, dist/fr/
```

Perfect for international businesses and learning the i18n workflow.

## External Templates

Use templates from npm or GitHub:

```bash
# npm package
pnpm create uniweb my-site --template @myorg/template-name

# GitHub repository
pnpm create uniweb my-site --template github:user/repo

# GitHub with specific branch/tag
pnpm create uniweb my-site --template github:user/repo#v1.0.0
```

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
import { defineSiteConfig } from '@uniweb/build/site'

export default defineSiteConfig({
  // All options are optional
  tailwind: true, // Enable Tailwind CSS v4 (default: true)
  plugins: [], // Additional Vite plugins
  // ...any other Vite config options
})
```

### Foundation Configuration

The `defineFoundationConfig()` function handles all Vite configuration for foundations:

```javascript
import { defineFoundationConfig } from '@uniweb/build'

export default defineFoundationConfig({
  // All options are optional - entry is auto-generated
  fileName: 'foundation', // Output file name
  externals: [], // Additional packages to externalize
  includeDefaultExternals: true, // Include react, @uniweb/core, etc.
  tailwind: true, // Enable Tailwind CSS v4 Vite plugin
  sourcemap: true, // Generate sourcemaps
  plugins: [], // Additional Vite plugins
  build: {}, // Additional Vite build options
  // ...any other Vite config options
})
```

For Tailwind CSS v3 projects, set `tailwind: false` and use PostCSS:

```javascript
export default defineFoundationConfig({
  tailwind: false, // Uses PostCSS instead of Vite plugin
})
```

## Foundation Build Process

When you run `uniweb build` on a foundation:

1. **Discovers** section types from `src/sections/` (bare files at root are implicit; nested paths require `meta.js`) and `src/components/` (requires `meta.js`)
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
  - 'site'
  - 'foundation'
  - 'sites/*'
  - 'foundations/*'
```

Also set in `package.json` for npm compatibility.

```json
{
  "workspaces": ["site", "foundation", "sites/*", "foundations/*"]
}
```

This means no config changes when evolving from single to multi-site.

## Releasing a Foundation

Publish your foundation to npm:

```bash
cd foundation
npm publish
```

Or to [uniweb.app](https://uniweb.app) for use with platform-managed sites:

```bash
uniweb login          # First time only
uniweb build
uniweb publish
```

Sites control their own update strategy—automatic, minor-only, patch-only, or pinned to a specific version.

## FAQ

**How is this different from MDX?**

MDX blends markdown and JSX—content authors write code. Uniweb keeps them separate: content stays in markdown, components stay in React. Content authors can't break components, and component updates don't require content changes.

**How is this different from Astro?**

Astro is a static site generator. Uniweb is a component content architecture that works with any deployment (static, SSR, or platform-managed). The foundation model means components are portable across sites and ready for integration with visual editors.

**Do I need uniweb.app?**

No. Local markdown files work great for developer-managed sites. The platform adds dynamic content, visual editing, and team collaboration when you need it.

**Can I use an existing component library?**

Yes. Foundations are standard React. Import any library into your foundation components. The `{ content, params }` interface only applies to section types (components with `meta.js`) — everything else uses regular React props.

**Is this SEO-friendly?**

Yes. Content is pre-embedded in the initial HTML—no fetch waterfalls, no layout shifts. Meta tags are generated per page. SSG is supported by default.

**What about dynamic routes?**

Pages can define data sources that auto-generate subroutes. A `/blog` page can have an index and a `[slug]` template that renders each post.

## Common Gotchas

### Homepage Configuration

Set your homepage with `index:` in `site.yml`:

```yaml
# site.yml
index: home # The page folder that becomes /
```

The `index:` option tells the build which page folder becomes the root route (`/`). The page still exists in `pages/home/`, but visitors access it at `/`.

Don't confuse this with `pages:` (which explicitly lists pages and hides any not listed).

### Content Shapes

Items come from **headings after body content**, not bullet lists. When H3 headings appear after the main content, they create `content.items`:

```markdown
---
type: Features
---

# Our Features

Leading paragraph.

### Fast

Lightning quick performance.

### Secure

Enterprise-grade security.
```

Becomes:

```js
content.title    // "Our Features"
content.items[0] // { title: 'Fast', paragraphs: ['Lightning quick performance.'], ... }
content.items[1] // { title: 'Secure', paragraphs: ['Enterprise-grade security.'], ... }
```

Each item has the same structure as the main content (title, paragraphs, links, imgs, etc.). Bullet lists become `content.lists`, not items. See [Content Structure](./docs/content-structure.md) for the full shape.

### Tagged Data Blocks

Tagged code blocks like:

````markdown
```yaml:team-member
name: Sarah Chen
role: Lead Architect
```
````

Are accessible via `content.data`:

```jsx
function TeamMember({ content }) {
  const member = content.data['team-member']
  return (
    <div>
      {member.name} - {member.role}
    </div>
  )
}
```

The tag name (after the colon) becomes the key in `content.data`.

### Root vs Package Commands

In a Uniweb workspace, commands run differently at different levels:

| Location      | Command        | What it does                            |
| ------------- | -------------- | --------------------------------------- |
| Project root  | `pnpm build`   | Builds all packages (foundation + site) |
| Project root  | `pnpm dev`     | Starts dev server for site              |
| `foundation/` | `uniweb build` | Builds just the foundation              |
| `site/`       | `uniweb build` | Builds just the site                    |

For day-to-day development, run `pnpm dev` from the project root. The workspace scripts handle the rest.

## Related Packages

- [`@uniweb/build`](https://github.com/uniweb/build) — Foundation build tooling
- [`@uniweb/runtime`](https://github.com/uniweb/runtime) — Foundation loader and orchestrator for sites
- [`@uniweb/templates`](https://github.com/uniweb/templates) — Official templates and template processing

## License

Apache 2.0
