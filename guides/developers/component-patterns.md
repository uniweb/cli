# CCA Component Patterns

CCA components tend to be shorter, more reusable, and more composable than their traditional React equivalents. That's not because of extra abstraction — it's because CCA's separation of content, theming, and code removes entire categories of work from the component. No theme maps. No null checks. No hardcoded strings. What's left is the actual rendering logic.

But the separation also introduces a design question that doesn't come up in traditional React: how do you shape a component's interface when the people using it aren't developers? The params you expose, the content structure you expect, the variants you support — these form a vocabulary that content authors compose with. Getting that vocabulary right produces tighter components and fewer edge cases. The patterns in this guide are what's emerged from that work so far. More will surface as foundations get more ambitious.

If you're coming from a traditional React project — especially one with multiple pages that have similar-but-different sections — you'll want to read [Converting Existing Designs](./converting-existing-designs.md) first. That guide shows how to decompose pages into CCA components. This guide picks up where it leaves off: once you've identified the components, how do you design their interfaces?

---

## Organizing a Foundation

A foundation is a React project. Most of its code is ordinary React components — cards, buttons, layout helpers, renderers — with no special requirements. They live wherever makes sense: `ui/`, `lib/`, inline in the same file, npm packages. CCA doesn't know or care about them.

The only special thing in a foundation is the **content interface**: the small number of section types that content authors can reference by name in frontmatter (`type: Hero`, `type: Features`). These live in `src/sections/`, which is the foundation's **addressable zone** — the build treats everything at the root of this folder as a section type, whether it's a bare file or a folder.

```
src/
├── sections/                # Addressable zone — section types
│   ├── CTA.jsx              # Bare file → section type (no meta.js needed)
│   ├── Hero/
│   │   ├── meta.js          # Explicit content interface (params, presets)
│   │   ├── Hero.jsx         # Entry — or index.jsx, both work
│   │   ├── Centered.jsx     # Internal variant (not addressable)
│   │   └── SplitForm.jsx    # Internal variant
│   ├── Gallery/
│   │   ├── meta.js
│   │   ├── Gallery.jsx
│   │   ├── Grid.jsx         # Internal renderer
│   │   └── Masonry.jsx      # Internal renderer
│   ├── Header/
│   │   └── Header.jsx       # Folder at root → section type (implicit meta)
│   └── Tabs/
│       ├── meta.js
│       ├── Tabs.jsx
│       └── Tab/             # Nested child — meta.js required
│           ├── meta.js
│           └── Tab.jsx
├── components/              # React components (shadcn-compatible, yours, etc.)
│   ├── ui/                  # shadcn primitives
│   │   ├── button.jsx
│   │   ├── card.jsx
│   │   └── badge.jsx
│   ├── TeamCard.jsx
│   └── PricingTier.jsx
├── hooks/                   # Custom React hooks
│   └── useScrollPosition.js
├── styles.css
└── foundation.js
```

### How discovery works

At the **root of `sections/`**, location is the marker. Any file or folder there is a section type — no `meta.js` needed:

- `CTA.jsx` → section type "CTA" with an implicit empty content interface
- `Header/Header.jsx` → section type "Header" with an implicit empty content interface
- `Hero/meta.js` + `Hero.jsx` → section type "Hero" with explicit params and presets

When `meta.js` is absent, the title is inferred from the component name by splitting PascalCase: `TeamRoster` → "Team Roster", `CTA` → "CTA". Add `meta.js` when you need params, content expectations, or a custom title.

**Deeper nesting** requires explicit `meta.js` — because a nested file could be a helper, a variant, or anything else. This enables two useful patterns:

- **Child section types**: `Tabs/Tab/meta.js` — a section type co-located with its parent, expressing the relationship in the file system
- **Organizational subfolders**: `marketing/Hero/meta.js` — grouping section types by category in large foundations

Files without `meta.js` at nested levels are private implementation — invisible to the build.

`components/` is where your React components live, organized however you like. `hooks/` is for custom React hooks. Everything outside `sections/` is standard React. (The build also falls back to scanning `src/components/` for `meta.js`, so older foundations that put section types there continue to work.)

### Entry file conventions

The build supports two naming conventions for the entry file in a section type folder:

- **Named file**: `Hero/Hero.jsx` — clearer in editor tabs when you have many open
- **Index file**: `Hero/index.jsx` — the traditional React convention

Named files are checked first, so if both exist, `Hero.jsx` wins. At the root of `sections/`, bare files like `CTA.jsx` are always named — `index.jsx` at the root has no meaning (there's no "default section type").

### Your components live in `components/`

The `components/` folder is yours — organize it however makes sense for your project. A `components/ui/` subfolder follows the [shadcn/ui](https://ui.shadcn.com) convention (shadcn's CLI installs there by default). Section types import from them like any other module:

```jsx
// sections/Features/Features.jsx
import { Card, CardContent } from '../../components/ui/card'

export function Features({ content, params }) {
  return (
    <div className="grid md:grid-cols-3 gap-6">
      {content.items.map((item, i) => (
        <Card key={i}>
          <CardContent>
            <h3 style={{ color: 'var(--heading)' }}>{item.title}</h3>
            <p style={{ color: 'var(--text)' }}>{item.paragraphs[0]}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
```

CCA doesn't constrain your import graph. Import from `components/`, from npm packages, from `hooks/`, from sibling files inside the section folder — whatever your rendering needs.

---

## The Dispatcher

You have a Gallery component that needs to render images three different ways: a CSS grid, a masonry layout, and a horizontal carousel. Or a Hero that looks completely different on the homepage versus the pricing page. The content is the same — images with alt text, or a heading with a paragraph and links — but the rendering is structurally different. Different DOM, different CSS strategies, different interaction models.

The Dispatcher pattern handles this. The section type is a thin entry file that reads a param and delegates to separate renderer components. Each renderer is plain React — it doesn't know about CCA. The dispatcher is the only file that touches params and content structure.

```
src/sections/
└── Gallery/
    ├── meta.js           # Content interface — declares layout param
    ├── Gallery.jsx       # Dispatcher — reads param, delegates
    ├── Grid.jsx          # Renderer: CSS grid
    ├── Masonry.jsx       # Renderer: CSS columns
    └── Carousel.jsx      # Renderer: horizontal scroll-snap
```

The meta.js declares the choice:

```js
// meta.js
export default {
  params: {
    layout: {
      type: 'select',
      label: 'Layout',
      options: ['grid', 'masonry', 'carousel'],
      default: 'grid',
    },
  },
}
```

And the entry file dispatches:

```jsx
// Gallery.jsx
import Grid from './Grid'
import Masonry from './Masonry'
import Carousel from './Carousel'

const layouts = { grid: Grid, masonry: Masonry, carousel: Carousel }

export default function Gallery({ content, params }) {
  const Layout = layouts[params.layout] || Grid
  return <Layout imgs={content.imgs} columns={params.columns} />
}
```

That's the entire dispatcher — six lines of logic. Each renderer receives normalized props and renders one way. `Grid.jsx` knows about CSS grid. `Masonry.jsx` knows about CSS columns. `Carousel.jsx` knows about scroll-snap. None of them know about CCA params or content structure. Adding a fourth layout means adding a file and a key to the map, without touching the existing renderers.

The renderer files are invisible to the build — they're nested inside a section type folder without their own `meta.js`. They're ordinary React modules.

The content author writes the same markdown in every case — just images with alt text. The `layout` param changes everything about how those images appear. One component name, one content structure, three completely different visual results.

### When the variants are lighter

Not every dispatcher needs separate files. When variants differ in styling but share the same DOM structure, a class map inside the entry file is enough:

```jsx
// Features.jsx — variants differ in class sets, not structure
const styles = {
  cards: {
    container: 'p-6 rounded-xl bg-surface',
    icon: 'w-12 h-12 rounded-lg flex items-center justify-center mb-4',
  },
  minimal: {
    container: 'text-center',
    icon: 'w-14 h-14 rounded-xl flex items-center justify-center mb-4 mx-auto',
  },
  list: {
    container: 'flex gap-4',
    icon: 'w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0',
  },
}

export default function Features({ content, params }) {
  const s = styles[params.style] || styles.cards
  // ... render items using s.container, s.icon
}
```

This is a lighter form of the same pattern — the entry file reads a param and selects a rendering strategy. The difference is that the strategies are class maps rather than separate components. Use separate files when variants have different DOM structures or interaction logic; use inline maps when they share the same JSX and only differ in classes. (See [Static Class Maps](#static-class-maps) for more on how these maps work with Tailwind.)

### Variant naming

The instinct when consolidating similar components is to find clever, abstract names for each variant. "What *is* the homepage hero, really? A split-media? A content-with-aside?"

Don't do that. The dispatcher pattern doesn't require elegant abstraction. It requires consolidation.

```js
// meta.js — and this is fine
export default {
  params: {
    variant: {
      type: 'select',
      label: 'Layout',
      options: ['homepage', 'centered', 'directory', 'split-form'],
      default: 'homepage',
    },
  },
}
```

Those names came from where the variants were found. That's fine — "I want the hero to look like the homepage" is a perfectly good selection criterion. You're not shipping an open-source component library where `homepage` would be meaningless. You're shipping a foundation for a site (or family of sites) where these names map to real, tested layouts.

The win is consolidation: one component name, one meta.js, one place to add future variants. Not five components with five names in the content author's palette. The variant vocabulary can evolve later — start with names that are meaningful now.

(If you're consolidating variants from an existing site or AI-generated pages, see [Converting Existing Designs](./converting-existing-designs.md) for the staged migration approach — including how to keep legacy implementations untouched in `components/` while the section type dispatches to them.)

---

## Building Blocks

Some components don't render content at all. They arrange other components.

In CCA, a page is a sequence of sections, each rendered by its own component. But sometimes you need a section that *contains* other sections — a two-column layout where each column is its own component, or a grid where each cell renders a different section type.

This is what `block.childBlocks` and the `ChildBlocks` renderer are for.

### How child blocks work

In the page folder, you nest section files inside a parent section:

```yaml
# pages/home/page.yml
sections:
  hero: Hero
  layout:
    type: Grid
    params:
      columns: 2
    sections:
      - type: Features
      - type: Testimonial
```

The Grid component receives `block.childBlocks` — an array of Block instances, each with its own type, content, and params. The component controls the container; the children control themselves:

```jsx
import { ChildBlocks } from '@uniweb/runtime'

export function Grid({ block, params }) {
  const { columns } = params

  const gridCols = {
    2: 'grid-cols-1 md:grid-cols-2',
    3: 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3',
    4: 'grid-cols-1 md:grid-cols-2 lg:grid-cols-4',
  }

  return (
    <div className={cn('grid gap-6', gridCols[columns])}>
      <ChildBlocks from={block} />
    </div>
  )
}
```

That's it. `ChildBlocks` renders each child block through the same BlockRenderer pipeline — the children get their own component, their own context class, their own backgrounds. The Grid only controls the grid.

You can also use the block's method directly:

```jsx
export function Grid({ block, params }) {
  if (block.hasChildBlocks()) {
    const ChildBlocks = block.getChildBlockRenderer()
    return (
      <div className="grid md:grid-cols-2 gap-6">
        <ChildBlocks />
      </div>
    )
  }
}
```

### Why this matters

With one Grid component and a `columns` param, content authors can create any layout without individual components needing complex arrangement logic. A Features component renders features. A Testimonial component renders a testimonial. Neither knows it's inside a grid cell — and neither should.

Container queries let children adapt to the cell size they end up in. A Features component that shows 3 columns at full width can drop to 1 column when it's inside a 2-column Grid cell, without knowing anything about the Grid.

**The key insight:** Building Block components separate *arrangement* from *content*. The arrangement component controls the container. The content components control themselves. Content authors compose the two by nesting sections in page configuration.

---

## Multi-Source Rendering

CCA components can receive content from markdown items *or* from external data (API responses, collections, fetched profiles). The component adapts to whichever source is present.

The Team component from the marketing template shows this clearly:

```jsx
export function Team({ content, params }) {
  // Support both fetched data and markdown items
  const rawMembers = content.data.team || content.items || []

  // Normalize to consistent shape
  const members = rawMembers.map((member) => {
    if (member.name !== undefined) {
      // Fetched data format: { name, role, bio, avatar, social }
      return {
        name: member.name,
        role: member.role,
        bio: member.bio || member.body,
        photo: member.avatar ? { url: member.avatar } : null,
        socialLinks: Object.entries(member.social || {})
          .filter(([, url]) => url)
          .map(([platform, url]) => ({ href: url, text: platform })),
      }
    }
    // Markdown items format: { title, paragraphs, imgs, links }
    return {
      name: member.title,
      role: member.paragraphs?.[0],
      bio: member.paragraphs?.[1],
      photo: member.imgs?.[0],
      socialLinks: member.links || [],
    }
  })

  // From here, render `members` — same code regardless of source
}
```

The content author doesn't choose the data source. They either write markdown:

```markdown
### Jane Smith

Engineering Lead

Built the platform from scratch.

![](jane.jpg)

[LinkedIn](https://linkedin.com/in/jane)
```

Or configure a data fetch in `page.yml`:

```yaml
data:
  team:
    source: /api/team
```

The component handles both. The rendering code after normalization is identical — it maps over `members` and renders cards.

**The key insight:** This means the same component serves static sites (markdown content) and dynamic sites (API-backed data) without the content author needing to understand the distinction. The normalization layer is the boundary — above it, two data shapes; below it, one rendering path.

---

## Conditional Properties

When a component has many params, the author's editing UI can become cluttered with options that aren't relevant. Conditional properties hide params based on the current value of other params.

Consider a Grid component with a `columns` param and layout ratio options for 2-column layouts:

```js
// meta.js
params: {
  columns: {
    type: 'select',
    label: 'Columns',
    options: [
      { value: 2, label: '2 Columns' },
      { value: 3, label: '3 Columns' },
      { value: 4, label: '4 Columns' },
    ],
    default: 3,
  },
  ratio: {
    type: 'select',
    label: 'Column Ratio',
    options: [
      { value: '50-50', label: 'Equal (50/50)' },
      { value: '40-60', label: 'Narrow / Wide (40/60)' },
      { value: '60-40', label: 'Wide / Narrow (60/40)' },
      { value: '33-67', label: 'Sidebar / Main (33/67)' },
    ],
    default: '50-50',
    condition: { columns: 2 },
  },
}
```

The `ratio` param only appears when `columns` is `2`. For 3- or 4-column layouts, it vanishes — because column ratios don't apply when all columns are equal.

Without this, a Grid with 4 column options and 4 ratio options shows 8 controls at all times. With conditional properties, authors see at most 5 — the 4 column options, plus the ratio options only when they're meaningful.

**The key insight:** Conditional properties aren't just about cleaner UI. They prevent invalid configurations. A content author can't set a 60/40 ratio on a 3-column grid because the option doesn't exist in that state. The meta.js constrains the configuration space to only valid combinations.

---

## Static Class Maps

Tailwind's JIT compiler scans your source files for class strings at build time. It needs to find complete class names — it can't piece together fragments. This has a specific implication for CCA components: param values can't be interpolated into class names.

```jsx
// ❌ Tailwind can't find this — it never appears as a complete string
className={`py-${size}`}

// ❌ This either — template literals are opaque to the scanner
className={`grid-cols-${columns}`}
```

The solution is static maps — objects where every value is a complete, scannable class string:

```jsx
const padding = {
  sm: 'py-2 lg:py-4',
  md: 'py-4 lg:py-8',
  lg: 'py-8 lg:py-16',
}

const gridCols = {
  2: 'sm:grid-cols-2',
  3: 'sm:grid-cols-2 lg:grid-cols-3',
  4: 'sm:grid-cols-2 lg:grid-cols-4',
}

<div className={cn(padding[params.spacing], gridCols[params.columns])}>
```

Every string in the map is a complete token that Tailwind can find by scanning the file. The keys are param values. The values are the CSS.

This is more than a workaround — it's a better design. Each entry in the map is a *complete responsive declaration*. `sm` doesn't mean "small padding" — it means a specific set of breakpoint-aware values that the foundation designer chose. The content author sees "Small", "Medium", "Large" in the UI; the developer controls exactly what each label means in CSS.

This pattern appears throughout the marketing template. The Features component maps `columns` to responsive grid classes. The Gallery maps `columns` to both grid and masonry variants. The CTA maps `theme` to coordinated class sets for section, button, secondary button, and description text — all as static objects.

```jsx
// CTA component — multiple elements, one param, all static
const buttonStyles = {
  primary: 'bg-white text-primary hover:bg-blue-50',
  gradient: 'bg-white text-primary hover:bg-blue-50',
  dark: 'bg-white text-gray-900 hover:bg-gray-100',
  light: 'bg-primary text-white hover:bg-blue-700',
}

const descStyles = {
  primary: 'text-blue-100',
  gradient: 'text-blue-100',
  dark: 'text-gray-400',
  light: 'text-gray-600',
}
```

One `theme` param, four coordinated maps. Every value scannable. Every combination tested.

---

## Parameters as Intent

This has been covered elsewhere (see [Thinking in Contexts](./thinking-in-contexts.md) and [Converting Existing Designs](./converting-existing-designs.md)), but it's worth reinforcing here because the component patterns above depend on it.

Params describe purpose, not CSS. A `spacing: comfortable` param isn't a CSS shortcut; it's a semantic choice that the foundation designer maps to whatever values serve the design. `layout: masonry` isn't `columns: 3` with extra steps; it's a named rendering strategy that encapsulates responsive behavior, gap logic, and break-inside rules.

The constraint is generative — like writing testable code. When you can't expose `className` or `style` directly, you're forced to ask: what are the *meaningful* variations of this component? The answers become the param options, and those options are all tested, all responsive, all compatible with the foundation's design system. You end up with a tighter interface than "pass whatever CSS you want" — fewer invalid states, less surface area to maintain.

But — as discussed in the [Dispatcher](#the-dispatcher) section — "purpose-based" doesn't mean "abstractly named." A Gallery's `layout: masonry` is purpose-based: the author wants a masonry look. A Hero's `variant: homepage` is also purpose-based: the author wants the homepage look. Both are meaningful to the person choosing them. The line is between intent ("I want this layout") and implementation ("give me `grid-cols-3` and `py-8`"). Variant names that came from real pages in a real site are intent — the author recognizes them. CSS fragments are implementation — the author shouldn't see them.

---

## What's Next

These are the patterns we've found so far by building foundations with CCA. More will emerge — especially around:

- **Data-driven composition**, where collections and fetched data create section structures that don't exist in the markdown
- **Cross-section communication**, where one component's state (like a filter) affects what other sections display
- **Adaptive complexity**, where a component scales its rendering based on how much content the author provided

This guide will grow as those patterns become clear. If you discover something that feels like a reusable pattern while building your foundation, it probably is.

---

## See Also

- [Thinking in Contexts](./thinking-in-contexts.md) — Semantic theming and when to break the rules
- [Converting Existing Designs](./converting-existing-designs.md) — Bringing existing React code into CCA
- [Content Structure](../../docs/content-structure.md) — How markdown becomes `content.items`, `content.data`, and `content.sequence`
- [Component Metadata](../../docs/component-metadata.md) — The full `meta.js` API
- [Kit Reference](../../docs/kit-reference.md) — Hooks, data classes, and utilities from @uniweb/kit
