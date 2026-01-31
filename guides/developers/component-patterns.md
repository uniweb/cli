# CCA Component Patterns

CCA components tend to be shorter, more reusable, and more composable than their traditional React equivalents. That's not because of extra abstraction — it's because CCA's separation of content, theming, and code removes entire categories of work from the component. No theme maps. No null checks. No hardcoded strings. What's left is the actual rendering logic.

But the separation also introduces a design question that doesn't come up in traditional React: how do you shape a component's interface when the people using it aren't developers? The params you expose, the content structure you expect, the variants you support — these form a vocabulary that content authors compose with. Getting that vocabulary right produces tighter components and fewer edge cases. The patterns in this guide are what's emerged from that work so far. More will surface as foundations get more ambitious.

If you're coming from a traditional React project — especially one with multiple pages that have similar-but-different sections — you'll want to read [Converting Existing Designs](./converting-existing-designs.md) first. That guide shows how to decompose pages into CCA components. This guide picks up where it leaves off: once you've identified the components, how do you design their interfaces?

---

## Organizing a Foundation

A foundation is a React project. Most of its code is ordinary React components — cards, buttons, layout helpers, renderers — with no special requirements. They live wherever makes sense: `ui/`, `lib/`, inline in the same file, npm packages. CCA doesn't know or care about them.

The only special thing in a foundation is the **content interface**: the small number of section types that content authors can reference by name in frontmatter (`type: Hero`, `type: Features`). These are identified by a `meta.js` file, which declares what content the section expects and what params it exposes. The build system scans `src/sections/` for folders containing `meta.js` — that's the only convention it enforces.

```
src/
├── sections/                # Content interfaces — section types (has meta.js)
│   ├── Hero/
│   │   ├── meta.js          # Content interface declaration
│   │   ├── Hero.jsx         # Entry — or index.jsx, both work
│   │   ├── Centered.jsx     # Internal variant
│   │   └── SplitForm.jsx    # Internal variant
│   ├── Gallery/
│   │   ├── meta.js
│   │   ├── Gallery.jsx
│   │   ├── Grid.jsx         # Internal renderer
│   │   └── Masonry.jsx      # Internal renderer
│   └── Header/
│       ├── meta.js
│       └── Header.jsx
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

`sections/` contains the content interfaces — the things content authors select by name. `components/` is where your React components live, organized however you like. `hooks/` is for custom React hooks. The build only scans `sections/` for `meta.js` (and falls back to `components/` for existing foundations that use the older convention). Everything else is standard React — create whatever folders describe what's in them.

### Entry file conventions

The build supports two naming conventions for the entry file in a content interface folder:

- **Named file**: `Hero/Hero.jsx` — clearer in editor tabs when you have many open
- **Index file**: `Hero/index.jsx` — the traditional React convention

Named files are checked first, so if both exist, `Hero.jsx` wins. Use whichever convention your team prefers.

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

### Custom discovery paths

By default, the build scans `src/sections/` one level deep for `meta.js` files (falling back to `src/components/` for older foundations). If your foundation grows to need subcategories, you can configure additional paths:

```js
// vite.config.js
import { defineFoundationConfig } from '@uniweb/build'

export default defineFoundationConfig({
  components: ['sections', 'sections/marketing', 'sections/docs']
})
```

Each path is scanned one level deep. A content interface's name comes from its folder name, so names must be unique across all paths.

---

## The Dispatcher

The most common CCA pattern is a content interface that exposes a single `layout` or `style` param and delegates to completely different rendering strategies based on its value. The entry file is a facade — it reads params and dispatches. The real rendering happens in plain React components alongside it.

Here's the Gallery component from the marketing template. Content authors choose between three layouts:

```js
// meta.js
params: {
  layout: {
    type: 'select',
    label: 'Layout',
    options: ['grid', 'masonry', 'carousel'],
    default: 'grid',
  },
}
```

And the component dispatches:

```jsx
export function Gallery({ content, params }) {
  const { layout, columns } = params
  const { imgs } = content

  const gridCols = {
    2: 'sm:grid-cols-2',
    3: 'sm:grid-cols-2 lg:grid-cols-3',
    4: 'sm:grid-cols-2 lg:grid-cols-4',
  }

  const masonryCols = {
    2: 'sm:columns-2',
    3: 'sm:columns-2 lg:columns-3',
    4: 'sm:columns-2 lg:columns-4',
  }

  return (
    <div className="max-w-6xl mx-auto">
      {layout === 'masonry' ? (
        <div className={cn('gap-4', masonryCols[columns])}>
          {imgs.map((img, i) => (
            <div key={i} className="break-inside-avoid mb-4">
              <img src={img.url} alt={img.alt} className="w-full rounded-xl" />
            </div>
          ))}
        </div>
      ) : layout === 'carousel' ? (
        <div className="overflow-x-auto">
          <div className="flex gap-4" style={{ width: 'max-content' }}>
            {imgs.map((img, i) => (
              <div key={i} className="w-80 flex-shrink-0">
                <img src={img.url} alt={img.alt} className="w-full h-60 object-cover rounded-xl" />
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className={cn('grid gap-4', gridCols[columns])}>
          {imgs.map((img, i) => (
            <div key={i} className="aspect-video">
              <img src={img.url} alt={img.alt} className="w-full h-full object-cover rounded-xl" />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
```

Three completely different CSS strategies — grid, CSS columns, and horizontal scroll — behind one component name with one param. The content author writes the same markdown in every case: just images with alt text. The `layout` param changes everything about how those images appear.

The Features component does the same thing with a `style` param — cards, minimal, or list — where each style gets its own class map:

```jsx
const styles = {
  cards: {
    container: cn('p-6 rounded-xl', t.card),
    iconWrapper: cn('w-12 h-12 rounded-lg flex items-center justify-center mb-4', t.iconBg),
  },
  minimal: {
    container: 'text-center',
    iconWrapper: cn('w-14 h-14 rounded-xl flex items-center justify-center mb-4 mx-auto', t.iconBg),
  },
  list: {
    container: 'flex gap-4',
    iconWrapper: cn('w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0', t.iconBg),
  },
}

const s = styles[style] || styles.cards
```

**When this pattern emerges:** You notice that a component needs to render the same content in structurally different ways — not just different colors or spacing, but different CSS layouts, different DOM structures, different interaction models. That's a dispatcher.

### Don't over-abstract the variant names

Here's a situation you'll encounter in practice. You're converting an existing site — or designing a foundation for a site concept with several pages — and you notice the hero sections across pages are similar but not the same. The homepage hero has a two-column layout with a browser mockup. The pricing page hero is centered text. The agencies page hero is minimal, left-aligned, text-only. The login page has a split-screen with a form on one side.

The CCA instinct says: these should all be one Hero component. And that's correct — one Hero with variants is better than `HeroHomepage`, `HeroPricing`, `HeroDirectory`, `HeroLogin`. But the next instinct is where things go wrong: trying to find clever, purpose-based param names that abstractly describe each variant. "What *is* the homepage layout, really? It's a... split-media? A content-with-aside?"

Don't do that. The Dispatcher pattern doesn't require elegant abstraction. It requires consolidation.

```js
// meta.js — and this is fine
params: {
  variant: {
    type: 'select',
    label: 'Layout',
    options: ['homepage', 'centered', 'directory', 'split-form'],
    default: 'homepage',
  },
}
```

Those option names came from where the variants were found. That's fine. They're meaningful to a content author building this site — "I want the hero to look like the homepage" is a perfectly good selection criterion. You're not shipping an open-source component library where `homepage` would be meaningless. You're shipping a foundation for a site (or family of sites) where these names map to real, tested layouts.

The same applies to any section type. If you have a Testimonial component and one variant came from a page about institutional partnerships, `variant: "institution"` is a legitimate option. It dispatches to an internal `InstitutionLayout` component that renders the look you want. The content author sees a layout that works. The code is clean. CCA is not violated — the content is still in markdown, the component is still reusable across pages, the theme still adapts to the site.

The win is consolidation: one component name, one meta.js, one place to add future variants. Not five components with five names polluting the component palette.

(For more on how section types get named during conversion, see [Converting Existing Designs](./converting-existing-designs.md) — especially the table on renaming components by purpose.)

### The dispatcher is thin

The dispatcher reads params and delegates. Adding a new variant means adding a new code path, not modifying existing ones. The content stays the same — the component transforms it differently.

When variants get large enough to extract, put them alongside the entry file:

```
src/sections/
└── Gallery/
    ├── meta.js           # Content interface
    ├── Gallery.jsx       # Dispatcher — reads params, delegates
    ├── Grid.jsx          # Renderer: CSS grid layout
    ├── Masonry.jsx       # Renderer: CSS columns
    └── Carousel.jsx      # Renderer: scroll-snap
```

The dispatcher imports `./Grid`, `./Masonry`, `./Carousel` — standard React. The renderers are plain components that receive normalized props; they don't know about CCA. The dispatcher is the only file that reads params and content structure.

The build only looks for `meta.js` in direct children of `sections/`, so these renderer files are invisible to discovery. They're ordinary React modules — no folder requirements, no naming conventions, no special status.

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
- [Runtime API](../../docs/runtime-api.md) — Block, Page, Website objects and hooks
