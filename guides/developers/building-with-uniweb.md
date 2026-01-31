# Building with Uniweb

You know how to build a React app. You pick a bundler (Vite), write components, set up routes, and wire everything together. A typical SPA needs a router config, lazy imports, maybe a layout system. In Uniweb, the wiring is the file structure itself — markdown files name the components they want, folders define routes, and the build connects them.

This guide shows what a Uniweb project looks like and why almost everything in it is standard React and Vite. The unfamiliar part is small and mechanical.

---

## The Two Packages

A Uniweb project is a workspace with two packages:

```
my-project/
├── foundation/              # React components (Vite library build)
│   └── src/
│       └── sections/
│           └── Hero.jsx
├── site/                    # Content + routing (Vite app)
│   └── pages/
│       └── home/
│           └── hero.md
└── pnpm-workspace.yaml
```

**Foundation** is a standard Vite library project. It builds to a single `foundation.js` bundle plus a `schema.json` that describes what's inside. Your React code lives here — components, hooks, styles, whatever you need.

**Site** is a standard Vite app with file-based routing. Each folder in `pages/` is a route. Markdown files inside a folder define the sections on that page. The runtime loads the foundation and renders the right component for each section.

Both packages are independent. A foundation can serve multiple sites. A site can swap foundations. You can have several of each in one workspace — or just one of either, depending on what you're building.

---

## The Connection

Here's the complete round trip — a component and the markdown that addresses it.

**The component** — a bare `.jsx` file in `sections/`:

```jsx
export default function Hero({ content }) {
  return (
    <div className="py-20 text-center max-w-4xl mx-auto px-6">
      <h1 className="text-4xl font-bold">{content.title}</h1>
      <p className="text-xl mt-4">{content.paragraphs[0]}</p>
      {content.links[0] && (
        <a href={content.links[0].href} className="inline-block mt-8 px-6 py-3 bg-blue-600 text-white rounded-lg">
          {content.links[0].label}
        </a>
      )}
    </div>
  )
}
```

**The markdown** that uses it:

```markdown
---
type: Hero
---

# Welcome to Our Product

Create something great with less effort.

[Get Started](/about)
```

**What arrives in `content`:**

| Markdown element         | Content field          | Value                              |
| ------------------------ | ---------------------- | ---------------------------------- |
| `# Welcome to...`       | `content.title`        | `"Welcome to Our Product"`         |
| Paragraph text           | `content.paragraphs[0]`| `"Create something great..."` |
| `[Get Started](/about)`  | `content.links[0]`     | `{ href: "/about", label: "Get Started" }` |

The parser extracts semantic elements from markdown — headings become titles, paragraph text becomes `paragraphs`, links become `links`, images become `imgs`. Your component reads the structure it needs and ignores the rest. See [Content Structure](../../docs/content-structure.md) for the full mapping.

The component is a regular React function. It receives `content` (parsed markdown), `params` (configuration from `meta.js`, if you add one), and `block` (the runtime object for this section). For a first component, `content` is all you need.

---

## That's Component Content Architecture

Uniweb calls this pattern **Component Content Architecture** (CCA) — components and content are separate artifacts connected by convention, not code. The architecture is the file structure. There's no component registry to maintain. No router config to update. No mapping between URLs and components.

- **`sections/`** is the component catalog. The build discovers every `.jsx` file and folder at the root automatically. A file named `Hero.jsx` becomes a section type called "Hero" — content authors reference it with `type: Hero` in frontmatter.

- **`pages/`** is the routing table. Each folder is a route. `pages/home/` → `/`, `pages/about/` → `/about`, `pages/blog/` → `/blog`.

- **Frontmatter** is the connection. `type: Hero` in a markdown file tells the runtime which component to render. That's the entire binding mechanism.

Adding a component means dropping a file in `sections/`. Adding a page means creating a folder in `pages/`. No configuration files to update, no imports to add.

The build also scans `src/components/` for backward compatibility (components there need a `meta.js` to be addressable), but `sections/` is the standard — the folder name matches what content authors compose.

---

## What You Get

Without extra configuration, a Uniweb project gives you:

- **File-based routing** — folder = route, no `react-router` config needed
- **Hot reload** on both content and component changes
- **Production build** with pre-rendered static HTML for every page
- **Adding a page** = creating a folder with a markdown file

In a plain Vite + React app, you'd install react-router, write route definitions, create lazy imports for code splitting, set up an SSG pipeline if you want static HTML, and build a system to connect content to components. Uniweb handles all of this through project structure — the conventions replace the configuration.

You still write React. You still use Tailwind (or CSS, or whatever you prefer). You still structure your components however makes sense. The framework handles routing, content delivery, and the build pipeline. Your job is the components.

---

## Growing From Here

Everything below is opt-in. A foundation that's just bare files in `sections/` with no `meta.js`, no params, and no theming is a valid foundation. Each addition solves a specific problem when you're ready for it.

### More section types

Add more files to `sections/`. Each `.jsx` file or folder at the root becomes a section type:

```
foundation/src/sections/
├── Hero.jsx
├── Features.jsx
├── Testimonial.jsx
├── CallToAction.jsx
├── Header.jsx
└── Footer.jsx
```

Content authors can now use `type: Hero`, `type: Features`, `type: Testimonial`, and so on. Header and Footer go in the site's `@header/` and `@footer/` folders to render on every page.

### Configuration with params

When a component needs options — layout style, column count, whether to show an image — promote the bare file to a folder and add `meta.js`:

```
foundation/src/sections/
└── Hero/
    ├── meta.js
    └── Hero.jsx
```

```js
// meta.js
export default {
  params: {
    layout: {
      type: 'select',
      label: 'Layout',
      options: ['centered', 'split'],
      default: 'centered',
    },
  },
}
```

```jsx
// Hero.jsx
export default function Hero({ content, params }) {
  if (params.layout === 'split') {
    return (
      <div className="grid md:grid-cols-2 gap-12 items-center py-20 px-6">
        <div>
          <h1 className="text-4xl font-bold">{content.title}</h1>
          <p className="text-xl mt-4">{content.paragraphs[0]}</p>
        </div>
        {content.imgs[0] && (
          <img src={content.imgs[0].src} alt={content.imgs[0].alt} className="rounded-lg" />
        )}
      </div>
    )
  }

  return (
    <div className="py-20 text-center max-w-4xl mx-auto px-6">
      <h1 className="text-4xl font-bold">{content.title}</h1>
      <p className="text-xl mt-4">{content.paragraphs[0]}</p>
    </div>
  )
}
```

Content authors set it in frontmatter:

```markdown
---
type: Hero
layout: split
---
```

Params force you to ask "what actually varies in this component?" — and that question produces a tighter interface. It's the same discipline as writing testable code: the constraint improves the design.

### Content-driven components

The progression from hardcoded to content-driven is natural. You start with a component that has its text in JSX. When that text needs to change without a code deploy, you move it to markdown and read from `content`. The [Converting Existing Designs](./converting-existing-designs.md) guide walks through this step by step.

### Theme

A foundation declares what's customizable. A site sets the values. CSS variables bridge them:

```js
// foundation.js
export default {
  vars: {
    'header-height': { default: '4rem' },
    'max-width': { default: '80rem' },
  },
}
```

```yaml
# site/theme.yml
vars:
  header-height: 5rem
```

Components use `var(--header-height)` and adapt automatically. The [Thinking in Contexts](./thinking-in-contexts.md) guide covers the full theming system — semantic tokens, context classes, and how components adapt to light/dark/medium contexts without hardcoding colors.

### Variants and the Dispatcher

When one section type needs multiple layouts (a homepage hero vs. a pricing hero), the Dispatcher pattern keeps a single section type with a `variant` param that delegates to different renderers. One component in the author's palette, multiple implementations underneath. See [Component Patterns](./component-patterns.md) for the full pattern.

---

## See Also

- **[Quickstart](../../docs/quickstart.md)** — Step-by-step project creation (`npx uniweb create`)
- **[Content Structure](../../docs/content-structure.md)** — How markdown becomes `content.title`, `content.items`, etc.
- **[Component Metadata](../../docs/component-metadata.md)** — Full `meta.js` reference (params, content expectations, presets)
- **[Converting Existing Designs](./converting-existing-designs.md)** — Bringing existing React code into a foundation
- **[Component Patterns](./component-patterns.md)** — Dispatcher, Building Blocks, and other design patterns
- **[Thinking in Contexts](./thinking-in-contexts.md)** — Semantic theming and how components adapt to any brand
