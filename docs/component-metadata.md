# Component Metadata Guide

This guide explains how to write `meta.js` files for Uniweb components.

## Overview

A `meta.js` file declares a section type's content interface:
- What the component does (for documentation and editor UI)
- What content it expects from markdown
- What parameters content authors can configure
- What presets are available for quick setup

**In `src/sections/`**, `meta.js` is optional at the root level. A bare file (`Hero.jsx`) or folder (`Hero/Hero.jsx`) is automatically an addressable section type with an implicit empty content interface. Add `meta.js` when you need params, content expectations, or presets. Deeper nesting within `src/sections/` and other locations (like `src/components/`) require `meta.js` for a component to be addressable.

Components without `meta.js` (outside of `src/sections/` root) are ordinary React components — not selectable by content authors, but the foundation's actual rendering workhorses.

---

## Minimal Examples

The simplest section type — no `meta.js` at all:

```
src/sections/TextSection.jsx    ← addressable, title inferred as "Text Section"
```

When you need params or content expectations, add a `meta.js`:

```javascript
export default {
  title: 'Text Section',    // Optional — inferred from component name if omitted
  category: 'structure',
}
```

---

## What's Required vs Optional

When `meta.js` is present:

| Field | Required | Default |
|-------|----------|---------|
| `title` | No | Inferred from component name (`TeamRoster` → "Team Roster") |
| `category` | No | — |
| `description` | No | — |
| `purpose` | No | — |
| `hidden` | No | `false` |
| `background` | No | `false` |
| `data` | No | — |
| `content` | No | — |
| `schemas` | No | — |
| `params` | No | — |
| `presets` | No | — |

When `meta.js` is absent (only at root of `src/sections/`), the section type has no params, no content expectations, and a title inferred from the file or folder name.

---

## Full Example

```javascript
// sections/Hero/meta.js
export default {
  title: 'Hero Banner',
  description: 'Bold hero section with headline and call-to-action',
  category: 'impact',
  purpose: 'Impress',
  background: true,

  data: 'events:1',  // optional: dynamic data from CMS

  content: {
    title: 'Headline',
    pretitle: 'Eyebrow',
    paragraphs: 'Description [1-2]',
    links: 'CTA buttons [1-2]',
    image: 'Hero image [1]',
  },

  params: {
    theme: {
      type: 'select',
      label: 'Theme',
      options: ['gradient', 'glass', 'dark', 'light'],
      default: 'gradient',
    },
    layout: {
      type: 'select',
      label: 'Layout',
      options: [
        'center',
        'left',
        { value: 'split-right', label: 'Split (image right)' },
        { value: 'split-left', label: 'Split (image left)' },
      ],
      default: 'center',
    },
  },

  presets: {
    default: {
      label: 'Centered Hero',
      params: { theme: 'gradient', layout: 'center' },
    },
    split: {
      label: 'Split Layout',
      params: { theme: 'gradient', layout: 'split-right' },
    },
  },
}
```

---

## How Data Flows to Your Component

The meta.js describes the contract. Here's what your component actually receives:

```jsx
function Hero({ content, params, block, website }) {
  // ─── From markdown (content) ────────────────────────
  // Runtime guarantees all fields exist - no defensive checks needed
  const { title, pretitle, subtitle, paragraphs, links, imgs, items } = content

  // ─── From frontmatter (params) ──────────────────────
  const { theme, layout } = params

  // ─── From CMS (data) ────────────────────────────────
  const events = block.data?.events || []

  // ─── From JSON blocks (schemas) ─────────────────────
  const navLinks = block.data?.['nav-links'] || []

  return (
    <section className={theme}>
      {pretitle && <span className="eyebrow">{pretitle}</span>}
      {title && <H1>{title}</H1>}
      {paragraphs.map((p, i) => <P key={i}>{p}</P>)}
    </section>
  )
}
```

**Runtime guarantees**: The runtime ensures all content fields exist with sensible defaults (empty strings/arrays). You don't need defensive null checks—content structure is guaranteed.

| Source | Declared in | Accessed via |
|--------|-------------|--------------|
| Markdown content | `content: { ... }` | `content.title`, `content.paragraphs`, `content.items` |
| Frontmatter params | `params: { ... }` | `params.paramName` |
| CMS entities | `data: 'events:5'` | `block.data.events` |
| JSON blocks | `schemas: { ... }` | `block.data['schema-name']` |

---

## Schema Reference

### Identity Fields

| Field | Type | Description |
|-------|------|-------------|
| `title` | string | Display name in the editor. If omitted, inferred from component name (`TeamRoster` → "Team Roster") |
| `description` | string | What the component does |
| `category` | string | Grouping: `impact`, `showcase`, or `structure` |
| `purpose` | string | Single verb: Introduce, Express, Explain, etc. |
| `hidden` | boolean | If true, component exists but isn't selectable |

#### Categories

| Category | Description | Examples |
|----------|-------------|----------|
| `impact` | High-impact elements to introduce and express ideas | Hero, CTA, Statement |
| `showcase` | Explain value, provide evidence, answer questions | Features, Pricing, FAQ, Testimonials |
| `structure` | Flexible functional elements for layouts | Header, Footer, Grid, Section, Gallery |

---

### Content

The `content` object describes what markdown content the component uses.

```javascript
content: {
  // String: label only, any count
  title: 'Headline',

  // String with count: label [count]
  paragraphs: 'Description [1-2]',
  links: 'CTA buttons [1-2]',
  image: 'Hero image [1]',

  // Object form: when you need a hint
  items: {
    label: 'Feature cards [3-6]',
    hint: 'Each H3 becomes a card',
  },
}
```

#### Count Syntax

Append count in brackets at the end of the label:

| Syntax | Meaning |
|--------|---------|
| `'Label'` | Any count (default) |
| `'Label [1]'` | Exactly 1 |
| `'Label [1-3]'` | 1 to 3 |
| `'Label [2+]'` | 2 or more |

This is guidance for content authors, not validation.

#### Standard Content Elements

These names are a **fixed vocabulary**—they map to what the semantic parser extracts from markdown:

| Element | Source | Description |
|---------|--------|-------------|
| `title` | H1 | Main headline |
| `pretitle` | Heading before title | Eyebrow/kicker text |
| `subtitle` | Heading after title | Secondary headline |
| `paragraphs` | Body text | Description paragraphs |
| `links` | `[text](url)` | Markdown links (become buttons/links) |
| `lists` | `- item` | Bullet or numbered lists |
| `items` | Subsequent headings | Content groups within the markdown |
| `subsections` | Child files | Nested section files (for composition) |

Use these exact names. The meta.js describes which of these your component uses—you're not inventing new names, you're declaring which parsed elements you consume.

#### Image Roles

Instead of generic `imgs`, use role-specific element names:

| Element | Role | Description |
|---------|------|-------------|
| `image` | Content image | Photos, graphics alongside content |
| `icon` | Small graphic | Icons, logos, avatars |
| `thumbnail` | Preview | Small preview images |
| `background` | Background | Handled by engine (see below) |

```javascript
content: {
  image: 'Hero image [1]',
  icon: 'Feature icon [1]',
}
```

#### Background Media

Background images and videos are handled at the engine level so components don't repeat this logic. Use the top-level `background` field:

```javascript
export default {
  title: 'Hero',
  background: true,  // Engine renders background media

  content: {
    title: 'Headline',
    image: 'Hero image [1]',
  },
}
```

| Value | Behavior |
|-------|----------|
| `true` or `'auto'` | Engine handles background |
| `'manual'` | Component handles its own background |
| `false` | No background support |

**Frontmatter Background Options**

When a component has `background: true`, authors can configure backgrounds in section frontmatter:

```yaml
---
type: Hero
background:
  # Image background
  image: /images/hero.jpg
  position: center          # CSS background-position
  size: cover               # CSS background-size

  # Video background (falls back to image on mobile or reduced-motion)
  video: /videos/hero.mp4   # Auto-detects webm fallback if available
  poster: /images/hero.jpg  # Shown while video loads

  # Or provide explicit video sources
  sources:
    - src: /videos/hero.webm
      type: video/webm
    - src: /videos/hero.mp4
      type: video/mp4

  # Overlay on top of background
  overlay:
    enabled: true
    type: dark              # 'dark' or 'light'
    opacity: 0.5
    # Or gradient overlay
    gradient:
      start: 'rgba(0,0,0,0.7)'
      end: 'rgba(0,0,0,0)'
      angle: 180
---
```

**Accessibility**: Video backgrounds automatically respect `prefers-reduced-motion`. When users have reduced motion enabled, the poster image is shown instead of video.

**Format Fallback**: When you provide a `.mp4` video, the engine automatically tries a `.webm` version first (better compression). Just ensure both formats exist at the same path.

---

### Data

The `data` field declares what dynamic/CMS entity types the component accepts:

```javascript
data: 'events',       // unlimited events
data: 'articles:5',   // up to 5 articles
data: 'project:1',    // exactly 1 project
```

#### Standard Entity Types

| Type | Description |
|------|-------------|
| `articles` | Blog posts, news items |
| `events` | Calendar events |
| `projects` | Portfolio/case studies |
| `publications` | Academic papers, research |
| `opportunities` | Jobs, grants, calls |
| `team` | Team members, people |
| `products` | E-commerce products |

#### Example: Event Listing

```javascript
export default {
  title: 'Event Grid',
  category: 'showcase',

  data: 'events:6',

  content: {
    title: 'Section title',
    paragraphs: 'Intro text [1]',
  },

  params: {
    layout: {
      type: 'select',
      options: ['grid', 'list', 'calendar'],
      default: 'grid',
    },
  },
}
```

The component receives entities via props and renders them alongside markdown content.

---

### Params

Parameters are configurable options set in frontmatter:

```yaml
---
type: Hero
theme: glass
layout: split-right
---
```

Define them in `params`:

```javascript
params: {
  theme: {
    type: 'select',
    label: 'Theme',
    hint: 'Affects background and text colors',  // optional guidance
    options: ['gradient', 'glass', 'dark', 'light'],
    default: 'gradient',
  },
  showPattern: {
    type: 'boolean',
    label: 'Show background pattern',
    default: true,
  },
  maxItems: {
    type: 'number',
    label: 'Maximum items to display',
    default: 6,
  },
  customClass: {
    type: 'string',
    label: 'Custom CSS class',
    hint: 'Added to the section wrapper element',
  },
}
```

**Runtime guarantees**: Param defaults from meta.js are automatically applied by the runtime. Your component receives `params` with defaults already merged in—no need for `theme || 'gradient'` fallbacks.

#### Param Types

| Type | Editor UI | Value |
|------|-----------|-------|
| `select` | Dropdown | String from options |
| `boolean` | Toggle | true/false |
| `string` | Text input | Any string |
| `number` | Number input | Numeric value |

#### Options Shorthand

When option value equals label, use strings:

```javascript
// Full form
options: [
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' },
]

// Shorthand (value === label)
options: ['dark', 'light']

// Mixed
options: [
  'dark',
  'light',
  { value: 'glass', label: 'Glassmorphism' },
]
```

---

### Presets

Presets are pre-configured parameter combinations:

```javascript
presets: {
  default: {
    label: 'Centered Hero',
    params: { theme: 'gradient', layout: 'center' },
  },
  glass: {
    label: 'Glassmorphism',
    params: { theme: 'glass', layout: 'center' },
  },
  minimal: {
    label: 'Minimal Light',
    params: { theme: 'light', layout: 'left', showPattern: false },
  },
}
```

The preset name (key) is used in frontmatter:

```yaml
---
type: Hero
preset: glass
---
```

---

### Schemas (Tagged Blocks)

For structured data in markdown, use tagged code blocks:

````markdown
```yaml:nav-links
- label: Home
  href: /
- label: About
  href: /about
  type: button
```
````

Define the schema in meta.js:

```javascript
schemas: {
  'nav-links': {
    label: { type: 'string' },
    href: { type: 'string' },
    type: {
      type: 'select',
      options: ['plain', 'button', 'dropdown'],
      default: 'plain',
    },
    icon: 'string',  // Shorthand for { type: 'string' }
    children: { type: 'array', of: 'nav-links' },  // Recursive
  },
}
```

The parsed data is available at `content.data['tag-name']` (YAML or JSON both work):

```jsx
function Header({ content }) {
  const navLinks = content.data['nav-links'] || []
  // [{ label: "Home", href: "/" }, { label: "About", href: "/about", type: "button" }]
}
```

Schema validation (applying defaults, type checking) is a future enhancement. Currently the raw parsed JSON is passed through.

#### Schema Field Types

```javascript
// Full form
field: { type: 'string', default: 'value' }

// Shorthand
field: 'string'
field: 'number'
field: 'boolean'

// Select
field: {
  type: 'select',
  options: ['a', 'b', 'c'],
  default: 'a',
}

// Nested object
field: {
  type: 'object',
  schema: { name: 'string', value: 'number' },
}

// Array
field: { type: 'array', of: 'string' }
field: { type: 'array', of: 'other-schema-name' }
field: { type: 'array', of: { name: 'string' } }
```

---

## Composition Components

Some components arrange other components (like Grid). They accept child sections:

```javascript
// sections/Grid/meta.js
export default {
  title: 'Grid',
  description: 'Arrange components in a responsive layout',
  category: 'structure',
  purpose: 'Arrange',

  content: {
    title: 'Section title',
    subsections: {
      label: 'Grid items',
      hint: 'Each child section becomes a grid cell. Use any component type.',
    },
  },

  params: {
    columns: {
      type: 'select',
      label: 'Columns',
      options: ['2', '3', '4', 'auto'],
      default: 'auto',
    },
  },
}
```

In markdown, child sections are nested files:

```
pages/home/
├── 1-intro.md          # type: Grid
├── 1.1-text.md         # type: TextBox (child of Grid)
├── 1.2-media.md        # type: Media (child of Grid)
└── 2-features.md       # type: Features
```

Or using explicit hierarchy in page.yml:

```yaml
sections:
  - intro:              # Grid
      - text            # TextBox
      - media           # Media
  - features            # Features
```

---

## Design Principles

1. **Graceful degradation** — Components handle missing content without errors
2. **Sensible defaults** — Every param should have a good default
3. **Intent over implementation** — Params describe purpose (`theme: dark`) not CSS (`background: #1a1a1a`)
4. **Minimal metadata** — Only include what the editor needs; implementation details stay in code
5. **Composition over configuration** — Use Grid + simple components instead of mega-components with many options

---

## See Also

- [Content Structure](./content-structure.md) — How content is parsed and structured
- [Kit Reference](./kit-reference.md) — Hooks, components, and utilities from @uniweb/kit
- [Foundation Configuration](./foundation-configuration.md) — CSS variables and custom Layout
- [Data Fetching](./data-fetching.md) — Loading external data into components
