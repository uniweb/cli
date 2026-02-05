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

The `build` command outputs to `site/dist/`. With pre-rendering enabled (the default for official templates), you get static HTML files ready to deploy anywhere.

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
export default function Hero({ content, params }) {
  const { title, paragraphs, links } = content

  return (
    <section className="py-20 text-center">
      <h1 className="text-4xl font-bold">{title}</h1>
      <p className="text-xl text-gray-600">{paragraphs[0]}</p>
      {links[0] && (
        <a
          href={links[0].href}
          className="mt-8 px-6 py-3 bg-blue-600 text-white rounded inline-block"
        >
          {links[0].label}
        </a>
      )}
    </section>
  )
}
```

Standard React. Standard Tailwind. The `{ content, params }` interface is only for _section types_ — components that content creators select in markdown frontmatter. Everything else uses regular React props.

## Next Steps

After creating your project:

1. **Explore the structure** — Browse `site/pages/` to see how content is organized. Each page folder contains `page.yml` (metadata) and `.md` files (sections).

2. **Generate component docs** — Run `pnpm uniweb docs` to create `COMPONENTS.md` with all available components, their parameters, and presets.

3. **Learn the configuration** — Run `uniweb docs site` or `uniweb docs page` for quick reference on configuration options.

4. **Create a section type** — Add a file to `foundation/src/sections/` (e.g., `Banner.jsx`) and rebuild. Bare files at the root are discovered automatically — no `meta.js` needed. Add `meta.js` when you want to declare params or presets. See the [Component Metadata Reference](https://github.com/uniweb/docs/blob/main/reference/component-metadata.md) for the full schema.

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

## Documentation

Full documentation is available at **[github.com/uniweb/docs](https://github.com/uniweb/docs)**:

| Section | Topics |
| ------- | ------ |
| [Getting Started](https://github.com/uniweb/docs/tree/main/getting-started) | Introduction, quickstart, templates |
| [Authoring](https://github.com/uniweb/docs/tree/main/authoring) | Writing content, site setup, theming, collections, translations |
| [Development](https://github.com/uniweb/docs/tree/main/development) | Building foundations, component patterns, data fetching, layouts |
| [Reference](https://github.com/uniweb/docs/tree/main/reference) | Configuration files, kit API, CLI commands, deployment |

### Quick Reference

| Topic              | Guide                                                               |
| ------------------ | ------------------------------------------------------------------- |
| Content Structure  | [How markdown becomes component props](https://github.com/uniweb/docs/blob/main/reference/content-structure.md) |
| Component Metadata | [The meta.js schema](https://github.com/uniweb/docs/blob/main/reference/component-metadata.md) |
| Site Configuration | [site.yml reference](https://github.com/uniweb/docs/blob/main/reference/site-configuration.md) |
| CLI Commands       | [create, build, docs, i18n](https://github.com/uniweb/docs/blob/main/reference/cli-commands.md) |
| Templates          | [Built-in, official, and external templates](https://github.com/uniweb/docs/blob/main/getting-started/templates.md) |
| Deployment         | [Vercel, Netlify, Cloudflare, and more](https://github.com/uniweb/docs/blob/main/reference/deployment.md) |

---

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

### Workspace Configuration

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

**Is Uniweb good for documentation sites?**

Yes — documentation is a natural fit. Content stays in markdown (easy to version, review, and contribute to), while the foundation handles navigation, search, and rendering. [Uniweb's own docs](https://github.com/uniweb/docs) use this pattern: pure markdown in a public repo, rendered by a separate foundation.

## Related Packages

- [`@uniweb/build`](https://github.com/uniweb/build) — Foundation build tooling
- [`@uniweb/runtime`](https://github.com/uniweb/runtime) — Foundation loader and orchestrator for sites
- [`@uniweb/templates`](https://github.com/uniweb/templates) — Official templates and template processing

## License

Apache 2.0
