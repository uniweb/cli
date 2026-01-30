# Uniweb Developer Guide

You're starting a content-heavy project. You reach for Vite and React. Smart choice.

Then you hit the content question.

## The Problem You Keep Solving

Where does content live? How does it flow to components?

- **Hardcoded in components.** Fast to start. Then someone needs to change a headline and they wait for you.
- **JSON files.** Better. But now you're writing loaders, handling data flow, managing the mapping yourself.
- **MDX.** Flexible. But content authors need to understand JSX, and your components couple to specific structures.
- **Headless CMS.** Clean content modeling. But now you're building a separate frontend, wiring APIs, managing the gap.

Each approach works. Each has tradeoffs. And each time, you're solving the same problem: *how does content become pages through components?*

This is undifferentiated work. Infrastructure *around* your product, not your product.

---

## The Insight

The relationship between content and components is an architectural concern—not something to solve ad-hoc in every project.

What's missing is a system that manages the content–component binding for you. Still Vite. Still React. But with separation enforced by **architecture**, not discipline.

---

## What Uniweb Gives You

Same tools you'd choose anyway:

- **Vite** — same dev server, same build
- **React** — same components, same ecosystem
- **Tailwind** — works out of the box

Plus architecture that handles the binding:

```
my-project/
├── site/                 # Content
│   └── pages/
│       └── home/
│           └── 1-hero.md
└── foundation/           # Components
    └── src/
        └── components/
            └── Hero/
```

**Content is markdown.** Authors write naturally:

```markdown
---
type: Hero
theme: dark
---

# Welcome

Build something great.

[Get Started](#)
```

**Components receive structured data.** The body gets semantically parsed—headings, paragraphs, links, images—organized and ready for your component:

```jsx
export function Hero({ content, params }) {
  const { title, paragraphs, links } = content
  const { theme } = params

  return (
    <section className={theme === 'dark' ? 'bg-gray-900 text-white' : ''}>
      <h1>{title}</h1>
      <p>{paragraphs[0]}</p>
      {links[0] && <a href={links[0].href}>{links[0].label}</a>}
    </section>
  )
}
```

No parsing logic. No `useState`. No `useEffect`. No loading states. The runtime guarantees your content structure.

This is the **Component Content Architecture (CCA)**: content is resolved before it reaches your components.

---

## What This Changes

**You're not the bottleneck.** Content authors work in markdown. They can't break your components. You don't block their changes.

**Code is policy.** You don't *hope* someone uses the right spacing—you define components where the spacing is already right. The architecture enforces what documentation cannot.

**Multiple sites, one Foundation.** Build your component library once. Use it across projects. Improve a component, every site gets the update.

**Localization without runtime overhead.** Content arrives already translated—no `t()` functions, no translation lookups. Each locale is a complete static build.

---

## Start Here

New to Uniweb? Start with the quickstart, then explore the concepts:

| Guide | What You'll Learn |
|-------|-------------------|
| [Quickstart](./quickstart.md) | Create a site in 5 minutes — hands-on tutorial |
| [Content Structure](./content-structure.md) | How markdown becomes component props |
| [Component Metadata](./component-metadata.md) | Defining what your components expect |
| [Site Configuration](./site-configuration.md) | The `site.yml` file |
| [Page Configuration](./page-configuration.md) | The `page.yml` file |

---

## Practical Guides

Hands-on guides for getting things done:

| Guide | What You'll Learn |
|-------|-------------------|
| [Site Setup](./guides/site-setup.md) | Configure your site — name, pages, languages, search, deployment |
| [Writing Content](./guides/writing-content.md) | How to write content for your Uniweb site — headings, images, links, icons, items |
| [Recipes](./guides/recipes.md) | Copy-paste solutions for heroes, features, FAQs, pricing, blogs, and more |
| [Theming](./guides/theming.md) | Customize colors, fonts, dark mode, and section themes |

---

## All Guides

### Getting Started

- **[Quickstart](./quickstart.md)** — Create your first site in 5 minutes
- **[Deployment](./deployment.md)** — Deploy to Vercel, Netlify, Cloudflare, and more

### Core Concepts

- **[Content Structure](./content-structure.md)** — How markdown is parsed into structured content (title, paragraphs, links, items)
- **[Component Metadata](./component-metadata.md)** — The `meta.js` file: declaring content expectations, parameters, and presets
- **[Creating Components](./creating-components.md)** — Build custom components for your foundation

### Configuration

- **[Site Configuration](./site-configuration.md)** — Global settings in `site.yml`: identity, page ordering, features
- **[Page Configuration](./page-configuration.md)** — Per-page settings in `page.yml`: layout, SEO, data sources
- **[Foundation Configuration](./foundation-configuration.md)** — CSS variables and custom Layout for your foundation

### Content & Data

- **[Data Fetching](./data-fetching.md)** — Load external JSON/YAML and make it available to components
- **[Content Collections](./content-collections.md)** — Turn folders of markdown into queryable data (blogs, portfolios)
- **[Dynamic Routes](./dynamic-routes.md)** — Generate pages from data (one page per blog post, product, etc.)

### Navigation & Structure

- **[Linking](./linking.md)** — Stable `page:` links that survive restructuring
- **[Navigation Patterns](./navigation-patterns.md)** — Building menus, breadcrumbs, and navigation from page hierarchy
- **[Special Sections](./special-sections.md)** — Site-wide header, footer, and sidebars (`@header`, `@footer`, `@left`, `@right`)

### Features

- **[Site Theming](./site-theming.md)** — Colors, typography, dark mode, and CSS variables
- **[Search](./search.md)** — Built-in full-text search with zero configuration
- **[Internationalization](./internationalization.md)** — Multi-language sites with build-time translation
- **[Versioning](./versioning.md)** — Multiple documentation versions with automatic switching

### Reference

- **[CLI Commands](./cli-commands.md)** — Complete reference for `uniweb create`, `build`, `docs`, `i18n`
- **[Runtime API](./runtime-api.md)** — Hooks and objects available to components (`useWebsite`, `useVersion`, etc.)

---

## The Mental Model

```
┌─────────────────────────────────────────────────────────────┐
│                     CONTENT (Meaning)                       │
│  Markdown + YAML frontmatter                                │
│  What authors write                                         │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    THE BINDING (CCA)                        │
│  Parsing → Defaults → Locale resolution                     │
│  Managed by the runtime, not your code                      │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   COMPONENTS (Language)                     │
│  Receives { content, params }                               │
│  Just renders—no fetching, no wiring                        │
└─────────────────────────────────────────────────────────────┘
```

The binding between content and components is a **first-class architectural layer**, not an implementation detail you solve yourself.

---

## Quick Patterns

### Access site/page data

```jsx
import { useWebsite } from '@uniweb/kit'

function Footer({ content }) {
  const { website } = useWebsite()

  return (
    <footer>
      <p>© {new Date().getFullYear()} {website.name}</p>
    </footer>
  )
}
```

### Build navigation from page structure

```jsx
function Nav() {
  const { website } = useWebsite()
  const pages = website.getPageHierarchy({ for: 'header' })

  return (
    <nav>
      {pages.map(page => (
        <a key={page.id} href={page.route}>{page.label}</a>
      ))}
    </nav>
  )
}
```

### Language switcher

```jsx
function LanguageSwitcher() {
  const { website } = useWebsite()

  if (!website.hasMultipleLocales()) return null

  return (
    <select onChange={e => window.location.href = website.getLocaleUrl(e.target.value)}>
      {website.getLocales().map(loc => (
        <option key={loc.code} value={loc.code}>{loc.label}</option>
      ))}
    </select>
  )
}
```

---

## Try It

```bash
npx uniweb@latest create my-site --template marketing
cd my-site
pnpm install
pnpm dev
```

A working site with real components. See how content flows to components. Modify a component, see it update. Change content, see it render.

---

## Getting Help

- **CLI help**: `uniweb --help`
- **Issues**: [github.com/uniweb/cli/issues](https://github.com/uniweb/cli/issues)
