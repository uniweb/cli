# AGENTS.md

Guidance for AI agents working with this Uniweb project.

## Project Structure

```
project/
├── foundation/     # React component library
├── site/           # Content (markdown pages)
└── pnpm-workspace.yaml
```

Multi-site variant uses `foundations/` and `sites/` (plural) folders.

- **Foundation**: React components. Those with `meta.js` are *section types* — selectable by content authors via `type:` in frontmatter. Everything else is ordinary React.
- **Site**: Markdown content + configuration. Each section file references a section type.

## Project Setup

Always use the CLI to scaffold projects — never write `package.json`, `vite.config.js`, `main.js`, or `index.html` manually. The CLI resolves correct versions and structure.

### New workspace

```bash
pnpm create uniweb my-project
cd my-project && pnpm install
```

Use `--template blank` for an empty workspace, or `--template <name>` for an official template (`marketing`, `docs`, `academic`, etc.).

### Adding to an existing workspace

```bash
pnpm uniweb add foundation myname --project myname
pnpm uniweb add site myname --project myname
pnpm install
```

The `--project` flag co-locates foundation and site under `myname/`. The CLI names them `myname` (foundation) and `myname-site` (site) to avoid workspace name collisions.

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
```

## Content Authoring

### Section Format

Each `.md` file is a section. Frontmatter on top, content below:

```markdown
---
type: Hero
theme: dark
---

### Eyebrow Text        ← pretitle (heading before a more important one)

# Main Headline         ← title

## Subtitle             ← subtitle

Description paragraph.

[Call to Action](/link)

![Image](./image.jpg)
```

### Content Shape

The semantic parser extracts markdown into a flat, guaranteed structure. No null checks needed — empty strings/arrays if content is absent:

```js
content = {
  title: '',        // Main heading
  pretitle: '',     // Heading before main title (auto-detected)
  subtitle: '',     // Heading after title
  subtitle2: '',    // Third-level heading
  paragraphs: [],   // Text blocks
  links: [],        // { href, label, role } — standalone links become buttons
  imgs: [],         // { src, alt, role }
  icons: [],        // { library, name, role }
  videos: [],       // Video embeds
  insets: [],       // Inline @Component references — { refId }
  lists: [],        // Bullet/ordered lists
  quotes: [],       // Blockquotes
  data: {},         // From tagged code blocks (```yaml:tagname)
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
Lightning quick.        ← items[0].paragraphs[0]

### Secure              ← items[1].title
Enterprise-grade.       ← items[1].paragraphs[0]
```

### Icons

Use image syntax with library prefix: `![](lu-house)`. Supported libraries: `lu` (Lucide), `hi2` (Heroicons), `fi` (Feather), `pi` (Phosphor), `tb` (Tabler), `bs` (Bootstrap), `md` (Material), `fa6` (Font Awesome 6), and others. Browse at [react-icons.github.io/react-icons](https://react-icons.github.io/react-icons/).

Custom SVGs: `![Logo](./logo.svg){role=icon}`

### Insets (Component References)

Place a foundation component inline within content using `@` syntax:

```markdown
![description](@ComponentName)
![description](@ComponentName){param=value other=thing}
```

The three parts carry distinct information:
- `[description]` — text passed to the component as `block.content.title`
- `(@Name)` — foundation component to render
- `{params}` — configuration attributes passed as `block.properties`

```markdown
![Architecture diagram](@NetworkDiagram){variant=compact}
![Cache metrics](@PerformanceChart){period=30d}
![](@GradientBlob){position=top-right}
```

Inset components must declare `inset: true` in their `meta.js`. They render at the exact position in the content flow where the author placed them. See meta.js section below for details.

### Links and Media Attributes

```markdown
[text](url){target=_blank}              <!-- Open in new tab -->
[text](./file.pdf){download}            <!-- Download -->
![alt](./img.jpg){role=banner}          <!-- Role determines array: imgs, icons, or videos -->
```

Standalone links (alone on a line) become buttons. Inline links stay as text links.

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

### Section Backgrounds

Set `background` in frontmatter — the runtime renders it automatically:

```yaml
---
type: Hero
theme: dark
background: /images/hero.jpg              # Simple: URL (image or video auto-detected)
---
```

Full syntax supports `image`, `video`, `gradient`, `color` modes plus overlays:

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
    ├── hero.md             # Single section — no prefix needed
    └── (or for multi-section pages:)
    ├── 1-hero.md           # Numeric prefix sets order
    ├── 2-features.md
    └── 3-cta.md
```

Decimals insert between: `2.5-testimonials.md` goes between `2-` and `3-`.

**Ignored files/folders:**
- `README.md` — repo documentation, not site content
- `_*.md` or `_*/` — drafts and private content (e.g., `_drafts/`, `_old-hero.md`)

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

Use `pages:` with `...` for ordering, without `...` for strict visibility control. Use `index:` for simple homepage selection.

### Section Nesting (Child Sections)

Some section types need children — a Grid that arranges cards, a TabGroup that holds panels. Use the `@` prefix and `nest:` property:

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
- `nest:` declares parent-child relationships (parent name → array of child names)
- Child files **must** use the `@` prefix — the filename and YAML must agree
- `@@` prefix signals deeper nesting (e.g., `@@sub-item.md` for grandchildren)
- `nest:` is flat — each key is a parent: `nest: { features: [a, b], a: [sub-1] }`
- Children are ordered by their position in the `nest:` array
- Orphaned `@` files (no parent in `nest:`) appear at top-level with a warning

Components receive children via `block.childBlocks`:

```jsx
export default function Grid({ block }) {
  return (
    <div className="grid grid-cols-2">
      {block.childBlocks.map(child => {
        const Comp = child.initComponent()
        return Comp ? <Comp key={child.id} block={child} /> : null
      })}
    </div>
  )
}
```

### When to Use Which Pattern

| Pattern | Authoring | Use when |
|---------|-----------|----------|
| **Items** (`content.items`) | Heading groups in one `.md` file | Repeating content within one section (cards, FAQ entries) |
| **Insets** (`block.insets`) | `![](@Component)` in markdown | Embedding a self-contained visual (chart, diagram, widget) |
| **Child sections** (`block.childBlocks`) | `@`-prefixed `.md` files + `nest:` | Children with rich authored content (testimonials, carousel slides) |

Does the content author write content *inside* the nested component? **Yes** → child sections. **No** (self-contained, driven by params/data) → insets. Repeating groups within one section → items.

## Semantic Theming

CCA (Component Content Architecture) separates theme from code. Components use **semantic CSS tokens** instead of hardcoded colors. The runtime applies a context class (`context-light`, `context-medium`, `context-dark`) to each section based on `theme:` frontmatter.

```jsx
// ❌ Hardcoded — breaks in dark context, locked to one palette
<h2 className="text-slate-900">...</h2>

// ✅ Semantic — adapts to any context and brand automatically
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
| `bg-primary` | Primary action background |
| `text-primary-foreground` | Text on primary background |
| `bg-secondary` | Secondary action background |
| `text-success` / `bg-success-subtle` | Status: success |
| `text-error` / `bg-error-subtle` | Status: error |
| `text-warning` / `bg-warning-subtle` | Status: warning |
| `text-info` / `bg-info-subtle` | Status: info |

**Content authors control context** in frontmatter:

```markdown
---
type: Testimonial
theme: dark           ← sets context-dark, all tokens resolve to dark values
---
```

**Site controls the palette** in `theme.yml`. The same foundation looks different across sites because tokens resolve from the site's color configuration, not from component code.

### theme.yml

```yaml
# site/theme.yml
colors:
  primary:
    base: '#3b82f6'
    exactMatch: true        # Use this exact hex at the 500 shade
  secondary: '#64748b'
  accent: '#8b5cf6'
  neutral: stone            # Named preset: stone, zinc, gray, slate, neutral

contexts:
  light:
    section: '#fafaf9'      # Override individual tokens per context
    primary: var(--primary-500)
    primary-hover: var(--primary-600)

fonts:
  import:
    - url: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap'
  heading: "'Inter', system-ui, sans-serif"
  body: "'Inter', system-ui, sans-serif"

inline:
  emphasis:                 # For [text]{emphasis} in markdown
    color: var(--link)
    font-weight: '600'

vars:                       # Override foundation-declared variables
  header-height: 5rem
```

Each color generates 11 OKLCH shades (50–950). The `neutral` palette is special — use a named preset (`stone` for warm) rather than a hex value. Three contexts are built-in: `light` (default), `medium`, `dark`. Context override keys match token names — `section:` not `bg:`, `primary:` not `btn-primary-bg:`.

### Foundation variables

Foundations declare customizable layout/spacing values in `foundation.js`:

```js
export default {
  vars: {
    'header-height': { default: '4rem' },
    'sidebar-width': { default: '280px' },
  },
}
```

Sites override them in `theme.yml` under `vars:`. Components use them as `var(--header-height)`.

**When to break the rules:** Header/footer components that float over content may need direct color logic (reading the first section's theme). Decorative elements with fixed branding (logos) use literal colors.

## Component Development

### Props Interface

```jsx
function MyComponent({ content, params, block }) {
  const { title, paragraphs, links, items } = content  // Guaranteed shape
  const { theme, columns } = params                     // Defaults from meta.js
  const { website } = useWebsite()                      // Or block.website
}
```

### meta.js Structure

```javascript
export default {
  title: 'Feature Grid',
  description: 'Grid of feature cards with icons',
  category: 'marketing',
  // hidden: true,          // Hide from content authors
  // background: 'self',    // Component renders its own background
  // inset: true,           // Available for @ComponentName references in markdown
  // visuals: 1,            // Expects 1 visual (image, video, or inset)
  // children: true,        // Accepts file-based child sections

  content: {
    title: 'Section heading',
    paragraphs: 'Introduction [0-1]',
    items: 'Feature cards with icon, title, description',
  },

  params: {
    columns: { type: 'number', default: 3 },
    theme: { type: 'select', options: ['light', 'dark'], default: 'light' },
  },

  presets: {
    default: { label: 'Standard', params: { columns: 3 } },
    compact: { label: 'Compact', params: { columns: 4 } },
  },

  // Static capabilities for cross-block coordination
  context: {
    allowTranslucentTop: true,  // Header can overlay this section
  },
}
```

All defaults belong in `meta.js`, not inline in component code.

### @uniweb/kit

**Primitives** (`@uniweb/kit`): `H1`–`H6`, `P`, `Span`, `Text`, `Link`, `Image`, `Icon`, `Media`, `Asset`, `SocialIcon`, `FileLogo`, `cn()`

**Styled** (`@uniweb/kit/styled`): `Section`, `Render`, `Visual`, `SidebarLayout`, `Code`, `Alert`, `Table`, `Details`, `Divider`, `Disclaimer`

**Hooks:**
- `useScrolled(threshold)` → boolean for scroll-based header styling
- `useMobileMenu()` → `{ isOpen, toggle, close }` with auto-close on navigation
- `useAccordion({ multiple, defaultOpen })` → `{ isOpen, toggle }` for expand/collapse
- `useActiveRoute()` → `{ route, isActiveOrAncestor(page) }` for nav highlighting (SSG-safe)
- `useGridLayout(columns, { gap })` → responsive grid class string
- `useTheme(name)` → standardized theme classes

**Utilities:** `cn()` (Tailwind class merge), `filterSocialLinks(links)`, `getSocialPlatform(url)`

### Foundation Organization

```
foundation/src/
├── sections/            # Section types (auto-discovered via meta.js)
│   ├── Hero/
│   │   ├── Hero.jsx     # Entry — or index.jsx, both work
│   │   └── meta.js
│   └── Features/
│       ├── Features.jsx
│       └── meta.js
├── components/          # Your React components (no meta.js, not selectable)
│   ├── ui/              # shadcn-compatible primitives
│   │   └── button.jsx
│   └── Card.jsx
└── styles.css
```

Only folders with `meta.js` in `sections/` (or `components/` for older foundations) become section types. Everything else is ordinary React — organize however you like.

### Website and Page APIs

```jsx
const { website } = useWebsite()

// Navigation
const pages = website.getPageHierarchy({ for: 'header' })  // or 'footer'
// → [{ route, navigableRoute, label, hasContent, children }]

// Locale
website.hasMultipleLocales()
website.getLocales()        // [{ code, label, isDefault }]
website.getActiveLocale()   // 'en'
website.getLocaleUrl('es')
```

### Insets and the Visual Component

Components access inline `@` references via `block.insets` (separate from `block.childBlocks`):

```jsx
import { Visual } from '@uniweb/kit/styled'

// Visual renders the first visual: inset > video > image
function SplitContent({ content, block, params }) {
  return (
    <div className="flex gap-12">
      <div className="flex-1">
        <h2 className="text-heading">{content.title}</h2>
      </div>
      <Visual content={content} block={block} className="flex-1 rounded-lg" />
    </div>
  )
}
```

- `block.insets` — array of Block instances from `@` references
- `block.getInset(refId)` — lookup by refId (used by sequential renderers)
- `content.insets` — flat array of `{ refId }` entries (parallel to `content.imgs`)
- `<Visual>` — renders first inset > video > image from content (from `@uniweb/kit/styled`)

Inset components declare `inset: true` in meta.js. Use `hidden: true` for inset-only components:

```js
// sections/insets/NetworkDiagram/meta.js
export default {
  inset: true,
  hidden: true,
  params: { variant: { type: 'select', options: ['full', 'compact'], default: 'full' } },
}
```

### Cross-Block Communication

Components read neighboring blocks for adaptive behavior (e.g., translucent header over hero):

```jsx
const firstBody = block.page.getFirstBodyBlockInfo()
// → { type, theme, context: { allowTranslucentTop }, state }

// context = static (from meta.js), state = dynamic (from useBlockState)
```

### Custom Layouts

Layouts live in `foundation/src/layouts/` and are auto-discovered. Set the default in `foundation.js`:

```js
// foundation/src/foundation.js
export default {
  name: 'My Template',              // Display name (falls back to package.json name)
  description: 'A brief description', // Falls back to package.json description
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

Layout receives pre-rendered areas as props plus `params`, `page`, and `website`. The `body` area is always implicit.

**Layout meta.js** declares which areas the layout renders:

```js
// foundation/src/layouts/DocsLayout/meta.js
export default {
  areas: ['header', 'footer', 'left'],
}
```

Area names are arbitrary strings — `header`, `footer`, `left`, `right` are conventional, but a dashboard layout could use `topbar`, `sidebar`, `statusbar`.

**Site-side layout content** — each layout can have its own section files:

```
site/layout/
├── header.md              # Default layout sections
├── footer.md
├── left.md
└── marketing/             # Sections for the "marketing" layout
    ├── header.md          # Different header for marketing pages
    └── footer.md
```

Named subdirectories are self-contained — no inheritance from the root. If `marketing/` has no `left.md`, marketing pages have no left panel.

**Layout cascade** (first match wins): `page.yml` → `folder.yml` → `site.yml` → foundation `defaultLayout` → `"default"`.

```yaml
# page.yml — select layout and hide areas
layout:
  name: MarketingLayout
  hide: [left, right]
```

## Migrating From Other Frameworks

Don't port line-by-line. Study the original implementation, then plan a new one in Uniweb from first principles. Other frameworks produce far more components than Uniweb needs — expect consolidation, not 1:1 correspondence.

### Why fewer components

Uniweb section types do more with less because the framework handles concerns that other frameworks push onto components:

- **Dispatcher pattern** — one section type with a `variant` param replaces multiple near-duplicate components (`HeroHomepage` + `HeroPricing` → `Hero` with `variant: homepage | pricing`)
- **Section nesting** — `@`-prefixed child files replace wrapper components that exist only to arrange children
- **Insets** — `![](@ComponentName)` replaces prop-drilling of visual components into containers
- **Visual component** — `<Visual>` renders image/video/inset from content, replacing manual media handling
- **Semantic theming** — the runtime orchestrates context classes and token resolution, replacing per-component dark mode logic
- **Engine backgrounds** — the runtime renders section backgrounds from frontmatter, replacing background-handling code in every section
- **Rich params** — `meta.js` params with types, defaults, and presets replace config objects and conditional logic

### Migration approach

1. **Start with a blank workspace** (unless adding to an existing one):
   ```bash
   pnpm create uniweb my-project --template blank
   ```

2. **Choose the workspace structure** — single (one foundation + one site), segregated (shared foundation, multiple sites), or co-located (independent projects grouped by directory). See the docs for workspace recipes.

3. **Use named layouts** for different page groups — a marketing layout for landing pages, a docs layout for `/docs/*`. One site, multiple layouts, each with its own header/footer/sidebar content.

4. **Dump legacy components under `src/components/`** — they're not section types. Import them from section types as needed during the transition.

5. **Create section types one at a time.** Each is independent — one can use hardcoded content while another reads from markdown. Staged migration levels:
   - **Level 0**: Paste the whole original file as one section type. You get routing and dev tooling immediately.
   - **Level 1**: Decompose into section types. Name by purpose (`Institutions` → `Testimonial`). Consolidate duplicates via dispatcher pattern.
   - **Level 2**: Move content from JSX to markdown. Components read from `content` instead of hardcoded strings. Content authors can now edit without touching code.
   - **Level 3**: Replace hardcoded Tailwind colors with semantic tokens. Components work in any context and any brand.

6. **Name by purpose, not by content** — `TheModel` → `SplitContent`, `WorkModes` → `FeatureColumns`, `FinalCTA` → `CallToAction`. Components render a *kind* of content, not specific content.

7. **UI helpers → `components/`** — Buttons, badges, cards go in `src/components/` (no `meta.js` needed, not selectable by content authors).

## Tailwind CSS v4

Theme defined in `foundation/src/styles.css`:

```css
@import "tailwindcss";
@source "./sections/**/*.{js,jsx}";
@source "../node_modules/@uniweb/kit/src/**/*.jsx";

@theme {
  --color-primary: #3b82f6;
}
```

Use with: `bg-primary`, `text-primary`, `bg-primary/10`

## Troubleshooting

**"Could not load foundation"** — Check `site/package.json` has `"foundation": "file:../foundation"` (or `"default": "file:../../foundations/default"` for multi-site).

**Component not appearing** — Verify `meta.js` exists and doesn't have `hidden: true`. Rebuild: `cd foundation && pnpm build`.

**Styles not applying** — Verify `@source` in `styles.css` includes your component paths. Check custom colors match `@theme` definitions.

## Further Documentation

Full Uniweb documentation is available at **https://github.com/uniweb/docs** — raw markdown files you can fetch directly.

| Section | Path | Topics |
|---------|------|--------|
| **Getting Started** | `getting-started/` | What is Uniweb, quickstart guide, templates overview |
| **Authoring** | `authoring/` | Writing content, site setup, collections, theming, linking, search, recipes, translations |
| **Development** | `development/` | Building foundations, component patterns, data fetching, custom layouts, i18n, converting existing designs |
| **Reference** | `reference/` | site.yml, page.yml, content structure, meta.js, kit hooks/components, theming tokens, CLI commands, deployment |

**Quick access pattern:** `https://raw.githubusercontent.com/uniweb/docs/main/{section}/{page}.md`

Examples:
- Content structure details: `reference/content-structure.md`
- Component metadata (meta.js): `reference/component-metadata.md`
- Kit hooks and components: `reference/kit-reference.md`
- Theming tokens: `reference/site-theming.md`
- Data fetching patterns: `reference/data-fetching.md`
