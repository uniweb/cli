# AGENTS.md

## The Architecture in One Sentence

A Uniweb project separates **what the site says** from **how it's built**. Content authors write markdown — choosing section types, setting params, composing layouts. Component developers build reusable section types that receive pre-parsed content and render it. Neither touches the other's files. Neither can break the other's work.

Every pattern in this guide serves that separation: markdown for content, frontmatter for configuration, `meta.js` for the contract between the two roles, semantic tokens for context adaptation, and a runtime that handles section wrapping, backgrounds, theming, and token resolution so components don't have to.

Once the runtime parses content and hands it to your component as `{ content, params }`, **it's standard React.** Standard Tailwind. Standard anything — import any library, use any pattern, build any UI. The `{ content, params }` interface is only for section types (components that content authors select in markdown). Everything else in your foundation is ordinary React with ordinary props. The framework handles the content pipeline and the boilerplate; you handle the design and interaction.

### What this replaces

In conventional React, content lives in JSX or ad-hoc data files. Theming means conditional logic in every component. Dark mode means `isDark ? 'text-white' : 'text-gray-900'` scattered everywhere. Each component handles its own background, its own null checks, its own i18n wrapping. A "simple" marketing page becomes hundreds of lines of undifferentiated boilerplate — and when a non-developer needs to change a headline, they open a pull request into code they don't understand.

Uniweb eliminates these categories of work. The runtime handles theming, backgrounds, and context adaptation. Components receive guaranteed content shapes — empty strings and arrays, never null. You build a *system* of section types, not individual pages. Authors compose pages from your system. That's what makes i18n, theming, and multi-site tractable: they're properties of the system, not things bolted onto individual components.

### Before you start: what the runtime already does

The most common mistake is reimplementing what the framework provides for free. Check this before writing any component logic:

| The runtime handles | So components should NOT contain |
|---|---|
| Section backgrounds (image, video, gradient, color, overlay) from `background:` | Background rendering code, `bg-white`/`bg-gray-900` on wrapper |
| Context classes (`context-light`/`medium`/`dark`) on every section | Theme maps: `const themes = { light: {...}, dark: {...} }` |
| Token resolution — `text-heading` adapts automatically | Conditionals: `isDark ? 'text-white' : 'text-gray-900'` |
| Content parsing with guaranteed shape | Defensive null checks on content fields |
| Section wrapping in `<section>` with context class | Outer `<section>` with background/theme classes |
| i18n via locale-specific content directories | String wrapping with `t()` or `<Trans>` |

Components *should* contain: layout (`grid`, `flex`, `max-w-7xl`), spacing (`p-6`, `gap-8`), typography scale (`text-3xl`, `font-bold`), animations, border-radius — anything that stays the same regardless of theme context.

---

## Documentation

This project was created with [Uniweb CLI](https://github.com/uniweb/cli). Full documentation (markdown, fetchable): https://github.com/uniweb/docs

**To read a specific page:** `https://raw.githubusercontent.com/uniweb/docs/main/{section}/{page}.md`

**By task:**

| Task | Doc page |
|------|----------|
| Writing page content | `authoring/writing-content.md` |
| Theming and styling | `authoring/theming.md` |
| Building components | `development/creating-components.md` |
| Kit API (hooks, components) | `reference/kit-reference.md` |
| Site configuration | `reference/site-configuration.md` |
| Content shape reference | `reference/content-structure.md` |
| Component metadata (meta.js) | `reference/component-metadata.md` |
| Migrating existing designs | `development/converting-existing.md` |

> **npm registry:** Use `https://registry.npmjs.org/uniweb` for package metadata — the npmjs.com website blocks automated requests.

## Project Structure

```
project/
├── foundation/     # Component developer's domain
├── site/           # Content author's domain
└── pnpm-workspace.yaml
```

Multi-site variant uses `foundations/` and `sites/` (plural) folders.

- **Foundation** (developer): React components. Those with `meta.js` are *section types* — selectable by content authors via `type:` in frontmatter. Everything else is ordinary React.
- **Site** (content author): Markdown content + configuration. Each section file references a section type. Authors work here without touching foundation code.

## Project Setup

Always use the CLI to scaffold projects — never write `package.json`, `vite.config.js`, `main.js`, or `index.html` manually. The CLI resolves correct versions and structure.

### New workspace

```bash
pnpm create uniweb my-project
cd my-project && pnpm install
```

This creates a workspace with foundation + site + starter content — two commands to a dev server. Use `--template <n>` for an official template (`marketing`, `docs`, `academic`, etc.), `--template none` for foundation + site with no content, or `--blank` for an empty workspace.

### Adding a co-located project

```bash
pnpm uniweb add project docs
pnpm install
```

This creates `docs/foundation/` + `docs/site/` with package names `docs-foundation` and `docs-site`. Use `--from <template>` to apply template content to both packages.

### Adding individual packages

```bash
pnpm uniweb add foundation           # First foundation → ./foundation/
pnpm uniweb add foundation ui        # Named → ./ui/
pnpm uniweb add site                 # First site → ./site/
pnpm uniweb add site blog            # Named → ./blog/
```

The name is both the directory name and the package name. Use `--project <n>` to co-locate under a project directory (e.g., `--project docs` → `docs/foundation/`).

### Adding section types

```bash
pnpm uniweb add section Hero
pnpm uniweb add section Hero --foundation ui   # When multiple foundations exist
```

Creates `src/sections/Hero/index.jsx` and `meta.js` with a minimal CCA-proper starter. The dev server picks it up automatically — no build or install needed.

### What the CLI generates

**Foundation** (`vite.config.js`, `package.json`, `src/foundation.js`, `src/styles.css`):
- `defineFoundationConfig()` in vite.config.js
- Dependencies pinned to current npm versions
- `@import "@uniweb/kit/theme-tokens.css"` in styles.css

**Site** (`vite.config.js`, `package.json`, `main.js`, `index.html`, `site.yml`):
- `defineSiteConfig()` in vite.config.js
- `react-router-dom` in devDependencies (required by pnpm strict mode)
- Standard `start()` call in main.js

## Commands

```bash
pnpm install    # Install dependencies
pnpm dev        # Start dev server
pnpm build      # Build for production
pnpm preview    # Preview production build (SSG + SPA)
```

> **npm works too.** Projects include both `pnpm-workspace.yaml` and npm workspaces. Replace `pnpm` with `npm` in any command above.

---

## Content Authoring

The decision rule: **would a content author need to change this?** Yes → it belongs in markdown, frontmatter, or a tagged data block. No → it belongs in component code.

Start with the content, not the component. Write the markdown a content author would naturally write, check what content shape the parser produces, *then* build the component to receive it.

### Section Format

Each `.md` file is a section. Frontmatter on top, content below:

```markdown
---
type: Hero
theme: dark
---

### V1.0.0 IS OUT         ← pretitle (small label above the title)

# Build the system.       ← title (the big headline)

## Not every page.         ← subtitle

Description paragraph.

[Call to Action](/link)

![Image](./image.jpg)
```

Content authors don't need to understand *why* `###` means pretitle — just that putting a smaller heading before the main heading creates a small label above it. Heading levels set *structure* (pretitle, title, subtitle), not font size — the component controls visual sizing.

### Content Shape

The semantic parser extracts markdown into a flat, guaranteed structure. No null checks needed — empty strings/arrays if content is absent:

```js
content = {
  title: '',        // Main heading (string or string[] for multi-line)
  pretitle: '',     // Heading before main title (auto-detected)
  subtitle: '',     // Heading after title (string or string[] for multi-line)
  subtitle2: '',    // Third-level heading
  paragraphs: [],   // Text blocks
  links: [],        // { href, label, role } — standalone links become buttons
  imgs: [],         // { src, alt, role }
  icons: [],        // { library, name, role }
  videos: [],       // Video embeds
  insets: [],       // Inline @Component references — { refId }
  lists: [],        // [[{ paragraphs, links, lists, ... }]] — each list item is an object, not a string
  quotes: [],       // Blockquotes
  data: {},         // From tagged code blocks (```yaml:tagname) and (```js:tagname)
  headings: [],     // Overflow headings after subtitle2
  items: [],        // Each has the same flat structure — from headings after body content
  sequence: [],     // All elements in document order
}
```

**Items** are repeating content groups (cards, features, FAQ entries). Created when a heading appears after body content:

```markdown
# Our Features          ← title

We built this for you.  ← paragraph

### Fast                ← items[0].title
![](lu-zap)             ← items[0].icons[0]
Lightning quick.        ← items[0].paragraphs[0]

### Secure              ← items[1].title
![](lu-shield)          ← items[1].icons[0]
Enterprise-grade.       ← items[1].paragraphs[0]
```

**Items have the full content shape** — this is the most commonly overlooked feature. Each item has `title`, `pretitle`, `subtitle`, `paragraphs`, `links`, `icons`, `lists`, and even `data` (tagged blocks). You don't need workarounds for structured content within items:

```markdown
### The Problem                ← items[0].pretitle
## Content gets trapped        ← items[0].title
Body text here.                ← items[0].paragraphs[0]

### The Solution               ← items[1].pretitle
## Separate content from code  ← items[1].title
```

If you need an eyebrow label above an item's title, that's `pretitle` — the same heading hierarchy as the top level. Heading hierarchy within items follows the same rules — `####` within a `###` item becomes `items[0].subtitle`. If you need metadata per item, use a tagged block inside the item:

````markdown
### Starter               ← items[0].title
$9/month                  ← items[0].paragraphs[0]

```yaml:details
trial: 14 days
seats: 1
```                        ← items[0].data.details = { trial: "14 days", seats: 1 }
````

**Complete example — markdown and resulting content shape side by side:**

```markdown
### Eyebrow                    │  content.pretitle = "Eyebrow"
# Our Features                 │  content.title = "Our Features"
## Build better products       │  content.subtitle = "Build better products"
                               │
We help teams ship faster.     │  content.paragraphs[0] = "We help teams..."
                               │
[Get Started](/start)          │  content.links[0] = { href: "/start", label: "Get Started" }
                               │
### Fast                       │  content.items[0].title = "Fast"
![](lu-zap)                    │  content.items[0].icons[0] = { library: "lu", name: "zap" }
Lightning quick.               │  content.items[0].paragraphs[0] = "Lightning quick."
                               │
### Secure                     │  content.items[1].title = "Secure"
![](lu-shield)                 │  content.items[1].icons[0] = { library: "lu", name: "shield" }
Enterprise-grade security.     │  content.items[1].paragraphs[0] = "Enterprise-grade..."
```

Headings before the main title become `pretitle`. Headings after the main title at a lower importance become `subtitle`. Headings that appear after body content (paragraphs, links, images) start the `items` array.

### Choosing how to model content

You have three layers. Most of the design skill is choosing between them:

**Pure markdown** — headings, paragraphs, links, images, lists, items. This is the default. If the content reads naturally as markdown and the parser's semantic structure captures it, stop here. Most sections live entirely in this layer.

**Frontmatter params** — `columns: 3`, `variant: centered`, `theme: dark`. Configuration that an author might change but that isn't *content*. Would changing this value change the section's *meaning*, or just its *presentation*? Presentation → param. Meaning → content.

**Tagged data blocks** — for content that doesn't fit markdown patterns. Products with SKUs, team members with roles, event schedules, pricing metadata, form definitions. When the information is genuinely structured data that a content author still owns, a well-named tagged block (`yaml:pricing`, `yaml:speakers`, `yaml:config`) is clearer than contorting markdown into a data format.

Read the markdown out loud. If a content author would understand what every line does and how to edit it, you've chosen the right layer. The moment markdown feels like it's encoding data rather than expressing content, step up to a tagged block — that's fine. A well-documented `yaml:pricing` block is better than a markdown structure that puzzles the author.

**You are designing these, not choosing from a menu.** The examples in this guide illustrate patterns, not exhaustive inventories. Any param name works in `meta.js`. Any tag name works for data blocks. Any section type name works. The framework has fixed mechanisms (the content shape, the context modes, the token system); nearly everything else is yours to define.

```js
// You design this — it's not a fixed schema
export default {
  params: {
    columns: { type: 'number', default: 3 },
    cardStyle: { type: 'select', options: ['minimal', 'bordered', 'elevated'], default: 'minimal' },
    showIcon: { type: 'boolean', default: true },
    maxItems: { type: 'number', default: 6 },
  }
}
```

````markdown
<!-- You invent the tag name — the framework parses it -->
```yaml:speakers
- name: Ada Lovelace
  role: Keynote
  topic: The Future of Computing
```
````
Access: `content.data?.speakers` — an array of objects. You defined this. The framework parsed it.

**Parameter naming matters.** Would an author understand the param without reading code? `columns: 3` yes. `gridCols: 3` no. `variant: centered` yes. `renderMode: flex-center` no. `align: left` yes. `contentAlignment: flex-start` no.

### Multi-Line Headings

Consecutive headings at the same level merge into a title array — a single heading split across visual lines:

```markdown
# Build the future              │  content.title = ["Build the future", "with confidence"]
# with confidence               │
```

Kit's `<H1>`, `<H2>`, etc. render arrays as a single tag with line breaks. This is how you create dramatic multi-line hero headlines.

**Works with accent styling:**

```markdown
# Build the future              │  content.title = [
# [with confidence]{accent}     │    "Build the future",
                                │    "<span accent=\"true\">with confidence</span>"
                                │  ]
```

**Rule:** Same-level continuation only applies before going deeper. Once a subtitle level is reached, same-level headings start new items instead of merging. Use `---` to force separate items when same-level headings would otherwise merge.

### Icons

Use image syntax with library prefix: `![](lu-house)`. Supported libraries: `lu` (Lucide), `hi2` (Heroicons), `fi` (Feather), `pi` (Phosphor), `tb` (Tabler), `bs` (Bootstrap), `md` (Material), `fa6` (Font Awesome 6), and others. Browse at [react-icons.github.io/react-icons](https://react-icons.github.io/react-icons/).

Custom SVGs: `![Logo](./logo.svg){role=icon}`

### Links and Media Attributes

```markdown
[text](url){target=_blank}              <!-- Open in new tab -->
[text](./file.pdf){download}            <!-- Download -->
![alt](./img.jpg){role=banner}          <!-- Role determines array: imgs, icons, or videos -->
```

**Quote values that contain spaces:** `{note="Ready to go"}` not `{note=Ready to go}`. Unquoted values end at the first space.

Standalone links (alone on a line) become buttons in `content.links[]`. Inline links stay as `<a>` tags within `content.paragraphs[]`. Multiple links sharing a paragraph are all promoted to `content.links[]`:

```markdown
[Primary](/start)              ← standalone → content.links[0]
[One](/a) [Two](/b)            ← links-only paragraph → both in content.links[]
Check out [this](/a) link.     ← inline → stays in paragraphs as <a> tag
```

### Inline Text Styling

```markdown
# Build [faster]{accent} with structure
This is [less important]{muted} context.
```

`accent` (colored + bold) and `muted` (subtle) adapt to context automatically. Components receive HTML strings with spans applied: `<span accent="true">faster</span>`.

Sites can define additional named styles in `theme.yml`'s `inline:` section.

### Structured Data

Tagged code blocks pass structured data via `content.data`:

````markdown
```yaml:form
fields:
  - name: email
    type: email
submitLabel: Send
```
````

Access: `content.data?.form` → `{ fields: [...], submitLabel: "Send" }`

**Untagged code blocks** (plain ``` js) are only visible to sequential-rendering components. If a component needs to access code blocks by name, tag them (`jsx:before`, `jsx:after` → `content.data?.before`, `content.data?.after`).

### Composition: Nesting and Embedding

Pages are sequences of sections — that's the obvious composition layer. But the framework supports real nesting: sections containing other sections, and sections containing embedded components. And it does this without leaving markdown.

**Insets — embedding components in content.** Many section types need a "visual" — a hero's illustration, a split-content section's media. The classic is an image or video. But what if it's a JSX + SVG diagram? A ThreeJS animation? An interactive code playground?

In other frameworks, this is where you'd reach for MDX, or prop-drill a component. In Uniweb, the content author writes:

```markdown
![Architecture overview](@NetworkDiagram){variant=compact}
```

Standard markdown image syntax — `![alt](@Component){attributes}`. The content author placed a full React component with content and params, and it looks like an image reference. The developer builds `NetworkDiagram` as an ordinary React component with `inset: true` in its `meta.js`. The kit's `<Visual>` component renders the first non-empty candidate — so the same section type works whether the author provides a static image, a video, or an interactive component:

```jsx
<Visual inset={block.insets[0]} video={content.videos[0]} image={content.imgs[0]} className="rounded-2xl" />
```

The content author controls what goes in the visual slot. The developer's component doesn't need to know or care whether it's rendering an image or a ThreeJS scene.

**Child sections — composing layouts from reusable pieces.** You encounter a complex layout — a 2:1 split with a panel and a main area, or a grid with different card types in each cell. Your instinct says: build a specialized component. But step back.

The panel? A reusable section type. The main area? Another one. The split? A Grid with `columns: "1fr 2fr"`. And your child components already adapt to narrow containers — container queries handle that.

But if you hardcode which components go where, the author can't rearrange or swap them. This is where child sections solve it:

```
pages/home/
├── 2-dashboard.md          # type: Grid, columns: "1fr 2fr"
├── @sidebar-stats.md       # type: StatPanel
└── @main-chart.md          # type: PerformanceChart
```

```yaml
# page.yml
nest:
  dashboard: [sidebar-stats, main-chart]
```

Each child is a regular section with its own type, params, and content. The Grid renders them with `<ChildBlocks from={block} />` — and you're in the middle: you can wrap each child, filter by type, reorder, add container classes. The author decides *what* goes in the grid; your component decides *how* it's rendered.

The author can swap a child for a different section type tomorrow without the developer changing a line of code. And the developer's components are reusable wherever child sections are accepted, not locked to this one layout.

**Choosing the right pattern:**

| Pattern | How authored | Use when |
|---|---|---|
| **Items** (`content.items`) | Heading groups within one `.md` file | Repeating content within one section: cards, features, FAQ entries |
| **Child sections** (`block.childBlocks`) | `@`-prefixed `.md` files + `nest:` | Children that need their own section type, rich content, or independent editing |
| **Insets** (`block.insets`) | `![](@Component)` in markdown | Self-contained visuals/widgets: charts, diagrams, code demos |

Does the content author write content *inside* the nested element? **Yes** → child sections. **No** (self-contained, param-driven) → inset. Repeating same-structure groups within one section → items. These compose: a child section can contain insets, items work inside children.

Inset components declare `inset: true` in meta.js. Don't use `hidden: true` on insets — `hidden` means "don't export this component at all" (for internal helpers), while `inset: true` means "available for `@Component` references in markdown."

**SSG:** Insets, `<ChildBlocks>`, and `<Visual>` all render correctly during prerender. Inset components that use React hooks internally (useState, useEffect) will trigger prerender warnings — this is expected and harmless; the page renders correctly client-side.

### Section Nesting Details

```
pages/home/
├── page.yml
├── 1-hero.md
├── 2-features.md        # Parent section (type: Grid)
├── 3-cta.md
├── @card-a.md           # Child of features (@ = not top-level)
├── @card-b.md
└── @card-c.md
```

```yaml
# page.yml
nest:
  features: [card-a, card-b, card-c]
```

**Rules:**
- `@`-prefixed files are excluded from the top-level section list
- `nest:` declares parent-child relationships (parent name → child names)
- `@@` prefix for deeper nesting (grandchildren)
- `nest:` is flat: `{ features: [a, b], a: [sub-1] }`
- Children ordered by position in the `nest:` array

```jsx
import { ChildBlocks } from '@uniweb/kit'

export default function Grid({ block, params }) {
  return (
    <div className={`grid grid-cols-${params.columns || 2} gap-6`}>
      <ChildBlocks from={block} />
    </div>
  )
}
```

### Section Backgrounds

Set `background` in frontmatter — the runtime renders it automatically:

```yaml
background: /images/hero.jpg                             # Image
background: /videos/hero.mp4                             # Video
background: linear-gradient(135deg, #667eea, #764ba2)    # Gradient
background: '#1a1a2e'                                    # Color (hex — quote in YAML)
background: var(--primary-900)                            # CSS variable
```

Object form for more control:

```yaml
background:
  image: { src: /img.jpg, position: center top }
  overlay: { enabled: true, type: dark, opacity: 0.5 }
```

Components that render their own background declare `background: 'self'` in `meta.js`.

### Page Organization

```
site/layout/
├── header.md               # type: Header — rendered on every page
├── footer.md               # type: Footer — rendered on every page
└── left.md                 # type: Sidebar — optional sidebar

site/pages/
└── home/
    ├── page.yml            # title, description, order
    ├── hero.md             # Single section
    └── (or for multi-section pages:)
    ├── 1-hero.md           # Numeric prefix sets order
    ├── 2-features.md
    └── 3-cta.md
```

Decimals insert between: `2.5-testimonials.md` goes between `2-` and `3-`.

**Ignored:** `README.md` (repo docs), `_*.md` or `_*/` (drafts/private).

**page.yml:**
```yaml
title: About Us
description: Learn about our company
order: 2                    # Navigation sort position
pages: [team, history, ...] # Child page order (... = rest). Without ... = strict (hides unlisted)
index: getting-started      # Which child page is the index
```

**site.yml:**
```yaml
index: home                         # Just set the homepage
pages: [home, about, ...]           # Order pages (... = rest, first = homepage)
pages: [home, about]                # Strict: only listed pages in nav
```

### Lists as Navigation Menus

Markdown lists model nav, menus, and grouped links. Each list item is a full content object with `paragraphs`, `links`, `icons`, and nested `lists`.

**Header nav:**
```markdown
- ![](lu-home) [Home](/)
- ![](lu-book) [Docs](/docs)
- ![](lu-mail) [Contact](/contact)
```
Access: `content.lists[0]` — each item has `item.links[0]` and `item.icons[0]`.

**Footer columns:**
```markdown
- Product
  - [Features](/features)
  - [Pricing](/pricing)
- Company
  - [About](/about)
  - [Careers](/careers)
```
Access: `content.lists[0]` — `group.paragraphs[0]` (label), `group.lists[0]` (sub-items with `subItem.links[0]`).

Render list item text with Kit components — list items contain HTML strings, not plain text:

```jsx
content.lists[0]?.map((group, i) => (
  <div key={i}>
    <Span text={group.paragraphs[0]} className="font-semibold text-heading" />
    <ul>
      {group.lists[0]?.map((subItem, j) => (
        <li key={j}><Link to={subItem.links[0]?.href}>{subItem.links[0]?.label}</Link></li>
      ))}
    </ul>
  </div>
))
```

**For richer navigation with icons, descriptions, or hierarchy**, use `yaml:nav` tagged blocks:

````markdown
```yaml:nav
- label: Dashboard
  href: /
  icon: lu:layout-grid
- label: Docs
  href: /docs
  icon: lu:book-open
  children:
    - label: Getting Started
      href: /docs/quickstart
```
````

Access: `content.data?.nav` — array of `{ label, href, icon, text, children, target }`. Components can support both modes: use `content.data?.nav` when provided, fall back to `website.getPageHierarchy()` for automatic nav. See `reference/navigation-patterns.md` for the full pattern.

---

## Semantic Theming

Components use **semantic CSS tokens** instead of hardcoded colors. The runtime applies a context class (`context-light`, `context-medium`, `context-dark`) to each section based on `theme:` frontmatter. The `theme` value is also available as `params.theme` — useful when a component needs conditional logic beyond CSS tokens (e.g., switching between a light and dark logo).

```jsx
// ❌ Hardcoded — breaks in dark context
<h2 className="text-slate-900">...</h2>

// ✅ Semantic — adapts to any context and brand
<h2 className="text-heading">...</h2>
```

**Core tokens** (available as Tailwind classes):

| Token | Purpose |
|-------|---------|
| `text-heading` | Headings |
| `text-body` | Body text |
| `text-subtle` | Secondary/de-emphasized text |
| `bg-section` | Section background |
| `bg-card` | Card/panel background |
| `bg-muted` | Hover states, zebra rows |
| `border-border` | Borders |
| `text-link` | Link color |
| `bg-primary` / `text-primary-foreground` / `hover:bg-primary-hover` | Primary actions |
| `bg-secondary` / `text-secondary-foreground` / `hover:bg-secondary-hover` | Secondary actions |
| `text-success` / `text-error` / `text-warning` / `text-info` | Status colors |

**Content authors control context** in frontmatter:

```markdown
---
type: Testimonial
theme: dark           ← sets context-dark, all tokens resolve to dark values
---
```

Alternate between `light` (default), `medium`, and `dark` across sections for visual rhythm.

**But the three presets aren't the limit.** The object form gives fine-grained control per section:

```yaml
theme:
  mode: light
  section: neutral-100               # Subtle off-white surface
  card: neutral-50                   # Cards lighter than surface
  primary: neutral-900               # Dark buttons instead of brand color
```

Any semantic token can be overridden. And `background:` accepts CSS variables and hex colors, so authors can alternate between `var(--neutral-50)`, `var(--neutral-100)`, and `var(--primary-50)` surfaces — all without component code. If a source design uses subtle surface variations (e.g., `--surface-base` vs `--surface-sunken`), map those to specific backgrounds or token overrides in frontmatter, not to component code.

### theme.yml

```yaml
# site/theme.yml
colors:
  primary: '#3b82f6'          # Your exact hex appears at shade 500
  secondary: '#64748b'
  accent: '#8b5cf6'
  neutral: stone              # Named preset: stone, zinc, gray, slate, neutral

contexts:
  light:
    section: '#fafaf9'        # Override individual tokens per context

fonts:
  import:
    - url: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap'
  heading: "'Inter', system-ui, sans-serif"
  body: "'Inter', system-ui, sans-serif"

inline:
  accent:
    color: var(--link)
    font-weight: '600'

vars:
  header-height: 5rem
```

Each color generates 11 OKLCH shades (50–950). `neutral` uses a named preset rather than hex. Shade 500 = your exact input color. Context override keys match token names: `section:` not `bg:`, `primary:` not `btn-primary-bg:`.

### How colors reach components

Your hex → 11 shades (50–950) → semantic tokens → components.

Semantic tokens map shades to roles. In light/medium: `--primary` uses shade 600, `--link` uses 600, `--ring` uses 500. In dark: `--primary` uses 500, `--link` uses 400.

**Buttons use shade 600 — darker than your input color.** This is an accessibility choice for contrast with white text. For brand-exact buttons:

```yaml
colors:
  primary: "#E35D25"
contexts:
  light:
    primary: primary-500         # Your exact color on buttons
    primary-hover: primary-600
```

> **Contrast warning:** Bright brand colors (orange, yellow, light green) at shade 500 may not meet WCAG contrast (4.5:1) with white foreground text. Test buttons for readability — if contrast is insufficient, keep the default shade 600 mapping.

### Foundation variables

Foundations declare customizable layout values in `foundation.js`:

```js
export const vars = {
  'header-height': { default: '4rem', description: 'Fixed header height' },
  'max-content-width': { default: '80rem', description: 'Maximum content width' },
  'section-padding-y': { default: 'clamp(4rem, 6vw, 7rem)', description: 'Vertical section padding' },
}
```

Sites override in `theme.yml` under `vars:`. Components use: `py-[var(--section-padding-y)]`, `h-[var(--header-height)]`.

### Design richness beyond tokens

Tokens handle context adaptation — the hard problem. **They are a floor, not a ceiling.** A great foundation adds design vocabulary on top:

```css
/* foundation/src/styles.css */
.border-subtle { border-color: color-mix(in oklch, var(--border), transparent 50%); }
.border-strong { border-color: color-mix(in oklch, var(--border), var(--heading) 30%); }
.text-tertiary { color: color-mix(in oklch, var(--body), var(--subtle) 50%); }
```

These compose with tokens — they adapt per context because they reference token variables. But they add nuance the 24-token set doesn't provide. Use palette shades directly (`var(--primary-300)`, `bg-neutral-200`) for fine-grained color control.

**The priority:** Design quality > portability > configurability. A beautiful foundation for one site is more valuable than a generic one that looks flat.

---

## Component Development

You're not building pages — you're building a **system** of section types that content authors compose into pages. Name by purpose, not content: `Testimonial` not `WhatClientsSay`, `SplitContent` not `AboutSection`. Expect consolidation: a React site with 30+ components typically maps to 8–15 Uniweb section types.

### Props Interface

```jsx
function MyComponent({ content, params, block }) {
  const { title, paragraphs, links, items } = content  // Guaranteed shape
  const { columns, variant } = params                    // Defaults from meta.js
  const { website } = useWebsite()                      // Or block.website
}
```

All non-reserved frontmatter fields become `params`. Reserved: `type`, `preset`, `input`, `data`, `id`, `background`, `theme`. Everything else flows to the component.

### block properties

| Property | Type | Description |
|----------|------|-------------|
| `block.page` | Page | Parent page |
| `block.website` | Website | Site-level data and navigation |
| `block.type` | string | Component type name |
| `block.childBlocks` | Block[] | File-based child sections |
| `block.insets` | Block[] | Inline `@Component` references |
| `block.getInset(refId)` | Block | Lookup inset by refId |
| `block.properties` | object | Raw frontmatter |
| `block.themeName` | string | `"light"`, `"medium"`, `"dark"` |
| `block.stableId` | string | Stable ID from filename or `id:` |

### Section Wrapper

The runtime wraps every section in `<section>` with context class and background. Customize with static properties:

```jsx
function Hero({ content, params }) {
  return (
    <div className="max-w-7xl mx-auto px-6">
      <h1 className="text-heading text-5xl font-bold">{content.title}</h1>
    </div>
  )
}

Hero.className = 'pt-32 md:pt-48'   // Override spacing
Hero.as = 'div'                      // Change wrapper element

export default Hero
```

- `Component.className` — adds classes to the runtime wrapper. Section-level spacing, borders, overflow.
- `Component.as` — changes wrapper element: `'nav'` for headers, `'footer'` for footers.

**Layout components** typically need `p-0` to suppress default padding:

```jsx
Header.className = 'p-0'
Header.as = 'header'
```

### Rendering Content with Kit

Content fields are **HTML strings** — they contain `<strong>`, `<em>`, `<a>` from markdown. Never render them with raw `{content.title}` in JSX — that shows HTML tags as visible text. Use Kit components:

**Extracted fields** (most common — custom layout with content from markdown):

```jsx
import { H1, H2, P, Span } from '@uniweb/kit'

<H1 text={content.title} className="text-heading text-5xl font-bold" />
<P text={content.paragraphs} className="text-body" />
<Span text={listItem.paragraphs[0]} className="text-subtle" />
```

These render their own HTML tag — don't wrap: `<H2 text={...} />` not `<h2><H2 text={...} /></h2>`.

**Full content rendering** (article/docs sections where the author controls the flow):

```jsx
import { Section, Render } from '@uniweb/kit'

<Section block={block} width="lg" padding="md" />
<Render content={block.parsedContent} block={block} />
```

**Visuals:**

```jsx
import { Visual } from '@uniweb/kit'

<Visual inset={block.insets[0]} video={content.videos[0]} image={content.imgs[0]} className="rounded-2xl" />
```

### Kit API by Use Case

**Rendering text:** `H1`–`H6`, `P`, `Span`, `Div`, `Text` (with `as` prop)

**Rendering content:** `Section` (Render + prose + layout), `Render` (ProseMirror → React), `ChildBlocks` (render child sections)

**Rendering media:** `Visual` (first non-empty: inset/video/image), `Image`, `Media`, `Icon`

**Navigation and routing:** `Link` (`to`/`href`, `to="page:about"` for page ID resolution, auto `target="_blank"` for external, `reload` for full page reload), `useActiveRoute()`, `useWebsite()`, `useRouting()`

**Header and layout:** `useScrolled(threshold)`, `useMobileMenu()`, `useAppearance()` (light/dark mode)

**Layout helpers:** `useGridLayout(columns, { gap })`, `useAccordion({ multiple, defaultOpen })`, `useTheme(name)`

**Data and theming:** `useThemeData()` (programmatic color access), `useColorContext(block)`

**Utilities:** `cn()` (Tailwind class merge), `Link`, `Image`, `Asset`, `SafeHtml`, `SocialIcon`, `filterSocialLinks(links)`, `getSocialPlatform(url)`

**Other styled:** `SidebarLayout`, `Prose`, `Article`, `Code`, `Alert`, `Table`, `Details`, `Divider`, `Disclaimer`

### Content Patterns for Header and Footer

Header and Footer combine several content categories. Use different parts of the content shape for each role:

**Header** — title for logo, list for nav, standalone link for CTA:

````markdown
---
type: Header
---

# Acme Inc

- ![](lu-search) [How It Works](/how-it-works)
- ![](lu-users) [For Teams](/for-teams)
- ![](lu-book) [Docs](/docs)

[Get Started](/docs/quickstart)

```yaml:config
github: https://github.com/acme
version: v2.1.0
```
````

```jsx
function Header({ content, block }) {
  const logo = content.title
  const navItems = content.lists[0] || []
  const cta = content.links[0]
  const config = content.data?.config
}
```

**Footer** — paragraph for tagline, nested list for columns, YAML for legal:

````markdown
---
type: Footer
---

Build something great.

- Product
  - [Features](/features)
  - [Pricing](/pricing)
- Developers
  - [Docs](/docs)
  - [GitHub](https://github.com/acme){target=_blank}

```yaml:legal
copyright: © 2025 Acme Inc
```
````

```jsx
function Footer({ content }) {
  const tagline = content.paragraphs[0]
  const columns = content.lists[0] || []
  const legal = content.data?.legal

  columns.map(group => ({
    label: group.paragraphs[0],
    links: group.lists[0]?.map(item => item.links[0])
  }))
}
```

### meta.js Structure

```javascript
export default {
  title: 'Feature Grid',
  description: 'Grid of feature cards with icons',
  category: 'marketing',
  // hidden: true,          // Exclude from export
  // background: 'self',    // Component renders its own background
  // inset: true,           // Available for @ComponentName in markdown
  // visuals: 1,            // Expects 1 visual
  // children: true,        // Accepts child sections

  content: {
    title: 'Section heading',
    paragraphs: 'Introduction [0-1]',
    items: 'Feature cards with icon, title, description',
  },

  params: {
    columns: { type: 'number', default: 3 },
    variant: { type: 'select', options: ['default', 'centered', 'split'], default: 'default' },
  },

  presets: {
    default: { label: 'Standard', params: { columns: 3 } },
    compact: { label: 'Compact', params: { columns: 4 } },
  },

  context: {
    allowTranslucentTop: true,
  },
}
```

All defaults belong in `meta.js`, not inline in component code.

### The Front Desk Pattern

Section types naturally use params to adjust their own rendering — `variant: flipped` reverses a flex direction, `columns: 3` sets a grid. That's not a pattern, that's the baseline.

The **Front Desk pattern** is when a section type does virtually no rendering itself. It reads the author's params, picks the right helper component from `src/components/`, and translates author-friendly vocabulary into developer-oriented props. The section type is a front desk — it greets the request and routes it to the right specialist:

```jsx
// sections/Features/index.jsx — the front desk
import { CardGrid } from '../../components/CardGrid'
import { CardList } from '../../components/CardList'
import { ComparisonTable } from '../../components/ComparisonTable'

const variants = { grid: CardGrid, list: CardList, comparison: ComparisonTable }

export default function Features({ content, block, params }) {
  const Layout = variants[params.variant] || CardGrid

  return (
    <Layout
      title={content.title}
      subtitle={content.paragraphs[0]}
      items={content.items}
      block={block}
      columns={params.columns}
      showIcons={params.showIcon !== false}
      compact={params.density === 'compact'}
    />
  )
}
```

```js
// meta.js — author-friendly language
export default {
  params: {
    variant: { type: 'select', options: ['grid', 'list', 'comparison'], default: 'grid' },
    columns: { type: 'number', default: 3 },
    showIcon: { type: 'boolean', default: true },
    density: { type: 'select', options: ['default', 'compact'], default: 'default' },
  }
}
```

The content author writes `variant: comparison` — they don't know or care about `ComparisonTable`. The section type translates `density: compact` into a `compact={true}` prop. `CardGrid`, `CardList`, `ComparisonTable` live in `src/components/` — ordinary React, reusable across multiple section types, testable independently.

This is the system-building pattern at its clearest: **section types are the public interface** to your content system (author-friendly names, documented in `meta.js`). **Helper components are the implementation** (developer-friendly APIs, ordinary React props). The section type is the thin translation layer that connects the two worlds.

### Foundation Organization

```
foundation/src/
├── sections/            # Section types (auto-discovered)
│   ├── Hero.jsx         # Bare file — no folder needed
│   ├── Features/        # Folder when you need meta.js
│   │   ├── index.jsx
│   │   └── meta.js
│   └── insets/          # Organizational subdirectory (lowercase)
│       └── Diagram/
│           ├── index.jsx
│           └── meta.js
├── components/          # Your React components (no meta.js, not selectable)
│   ├── ui/
│   │   └── button.jsx
│   └── Card.jsx
└── styles.css
```

**Discovery:** PascalCase files/folders at root of `sections/` are auto-discovered. Nested levels require `meta.js`. Lowercase directories are organizational only. `hidden: true` excludes a component entirely. Everything outside `sections/` is ordinary React.

### Website and Page APIs

```jsx
const { website } = useWebsite()
const page = website.activePage

// Navigation
website.getPageHierarchy({ for: 'header' })
// → [{ route, navigableRoute, label, hasContent, children }]

// Core properties
website.name              // Site name from site.yml
website.basePath          // Deployment base path (e.g., '/docs/')

// Locale
website.hasMultipleLocales()
website.getLocales()        // [{ code, label, isDefault }]
website.getActiveLocale()
website.getLocaleUrl('es')

// Route detection
const { isActive, isActiveOrAncestor } = useActiveRoute()

// Appearance
const { scheme, toggle, canToggle } = useAppearance()

// Page properties
page.title, page.label, page.route
page.isHidden(), page.showInHeader(), page.showInFooter()
page.hasChildren(), page.children
```

### Cross-Block Communication

```jsx
const firstBody = block.page.getFirstBodyBlockInfo()
// → { type, theme, context: { allowTranslucentTop }, state }
```

### Custom Layouts

Layouts live in `foundation/src/layouts/` and are auto-discovered:

```js
// foundation/src/foundation.js
export default {
  name: 'My Template',
  description: 'A brief description',
  defaultLayout: 'DocsLayout',
}
```

```jsx
// foundation/src/layouts/DocsLayout/index.jsx
export default function DocsLayout({ header, body, footer, left, right, params }) {
  return (
    <div className="min-h-screen flex flex-col">
      {header && <header>{header}</header>}
      <div className="flex-1 flex">
        {left && <aside className="w-64">{left}</aside>}
        <main className="flex-1">{body}</main>
        {right && <aside className="w-64">{right}</aside>}
      </div>
      {footer && <footer>{footer}</footer>}
    </div>
  )
}
```

**Layout meta.js** declares areas: `{ areas: ['header', 'footer', 'left'] }`. Area names are arbitrary.

**Layout content** — each layout has section files in `site/layout/`:

```
site/layout/
├── header.md              # Default layout
├── footer.md
└── marketing/             # Named layout sections
    ├── header.md
    └── footer.md
```

Named subdirectories are self-contained — no inheritance. Layout cascade: `page.yml` → `folder.yml` → `site.yml` → foundation `defaultLayout` → `"default"`.

---

## Migrating From Other Frameworks

Don't port line-by-line. Study the source, then rebuild from first principles. Other frameworks produce far more components than Uniweb needs — expect consolidation, not 1:1 correspondence.

### The mental model shift

| React / conventional | Uniweb equivalent |
|---|---|
| Props with typed data | Frontmatter params + `meta.js` |
| Component variants via props | `variant` param in frontmatter; Front Desk pattern for complex routing |
| Context / ThemeProvider | `theme:` frontmatter + semantic tokens (automatic) |
| Wrapper/layout components | Section nesting or custom layouts |
| Prop-drilling visuals into containers | Insets — `![](@Component)` rendered via `<Visual>` |
| Content in JSX or `.js` data files | Markdown → parser → `content` prop |
| CSS color tokens / design systems | `theme.yml` → palette shades + semantic tokens |
| `isDark ? ... : ...` conditionals | `text-heading` — context classes handle it |
| Per-component backgrounds | `background:` in frontmatter |
| Multiple near-identical components | One section type + `variant` param, or Front Desk pattern |
| i18n wrapping (`t()` / `<Trans>`) | Locale-specific content directories |

### Migration approach

1. **Scaffold the workspace:**
   ```bash
   pnpm create uniweb my-project --template none
   ```

2. **Use named layouts** for different page groups — marketing layout for landing pages, docs layout for `/docs/*`.

3. **Dump legacy components under `src/components/`** — they're not section types. Import from section types during transition.

4. **Create section types one at a time.** Migration levels:
   - **Level 0**: Paste the original as one section type. Routing and dev tooling work immediately.
   - **Level 1**: Decompose into section types. Consolidate duplicates — use `variant` params or the Front Desk pattern.
   - **Level 2**: Move content from JSX to markdown. Authors can now edit without code.
   - **Level 3**: Replace hardcoded colors with semantic tokens. Components work in any context.

5. **Map source colors to `theme.yml`.** The most common mistake is recreating source colors as CSS custom properties — this bypasses the token system. Instead: primary color → `colors.primary` in theme.yml. Neutral tone → `colors.neutral`. Context needs → `theme:` frontmatter.

6. **Name by purpose, not content** — `TheModel` → `SplitContent`, `WorkModes` → `FeatureColumns`.

7. **UI helpers → `components/`** — Buttons, badges, cards in `src/components/` (no `meta.js`, not selectable by authors).

---

## Tailwind CSS v4

Foundation styles in `foundation/src/styles.css`:

```css
@import "tailwindcss";
@import "@uniweb/kit/theme-tokens.css";
@source "./sections/**/*.{js,jsx}";
@source "./components/**/*.{js,jsx}";
@source "../node_modules/@uniweb/kit/src/**/*.jsx";

@theme {
  --breakpoint-xs: 30rem;
}
```

Semantic tokens come from `theme-tokens.css` (populated from `theme.yml`). Use `@theme` only for values tokens don't cover. **Custom CSS is expected alongside Tailwind** — shadow systems, border hierarchies, gradients, glassmorphism. Tailwind handles layout; tokens handle context; `styles.css` handles everything else.

## Troubleshooting

**"Could not load foundation"** — Check `site/package.json` has `"foundation": "file:../foundation"`.

**Component not appearing** — Verify `meta.js` exists. Check for `hidden: true`. Rebuild: `cd foundation && pnpm build`.

**Styles not applying** — Verify `@source` includes your component paths.

**Prerender warnings about hooks** — Components with useState/useEffect show SSG warnings during build. Expected and harmless.

**Content not appearing as expected?**
```bash
uniweb inspect pages/home/hero.md         # Single section
uniweb inspect pages/home/                 # Whole page
uniweb inspect pages/home/hero.md --raw    # ProseMirror AST
```

## Further Documentation

Full documentation: **https://github.com/uniweb/docs**

| Section | Path | Topics |
|---------|------|--------|
| **Getting Started** | `getting-started/` | What is Uniweb, quickstart, templates |
| **Authoring** | `authoring/` | Writing content, site setup, collections, theming, translations |
| **Development** | `development/` | Foundations, component patterns, data fetching, layouts, i18n |
| **Reference** | `reference/` | site.yml, page.yml, content structure, meta.js, kit API, CLI, deployment |

**Quick access:** `https://raw.githubusercontent.com/uniweb/docs/main/{section}/{page}.md`
