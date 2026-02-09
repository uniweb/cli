# AGENTS.md

> A comprehensive guide to building with Uniweb — for developers and AI assistants alike.

Uniweb is a Component Content Architecture (CCA). Content lives in markdown, code lives in React components, and a runtime connects them. The runtime handles section wrapping, background rendering, context theming, and token resolution — components receive pre-parsed content and render it with semantic tokens. Understanding what the runtime does (and therefore what components should *not* do) is the key to working effectively in this architecture.

## Documentation

This project was created with [Uniweb](https://github.com/uniweb/cli). Full documentation (markdown, fetchable): https://github.com/uniweb/docs

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

This creates a workspace with foundation + site + starter content — two commands to a dev server. Use `--template <name>` for an official template (`marketing`, `docs`, `academic`, etc.), `--template none` for foundation + site with no content, or `--blank` for an empty workspace.

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

The name is both the directory name and the package name. Use `--project <name>` to co-locate under a project directory (e.g., `--project docs` → `docs/foundation/`).

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

## Content Authoring

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

Each item has the same content shape as the top level — `title`, `paragraphs`, `icons`, `links`, `lists`, etc. are all available per item.

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

**Works at any heading slot** — title, subtitle, items:

```markdown
### Our Mission                 │  content.pretitle = "Our Mission"
# Build the future              │  content.title = ["Build the future",
# with confidence               │                   "with confidence"]
## The platform for             │  content.subtitle = ["The platform for",
## modern teams                 │                      "modern teams"]
```

**Rule:** Same-level continuation only applies before going deeper. Once a subtitle level is reached, same-level headings start new items instead of merging:

```markdown
# Features                      │  title = "Features"
                                │
We built this for you.          │  paragraph
                                │
### Fast                        │  items[0].title = "Fast"
### Secure                      │  items[1].title = "Secure" ← new item, not merged
```

Use `---` to force separate items when same-level headings would otherwise merge:

```markdown
# Line one                      │  title = "Line one"
---                             │  ← divider forces split
# Line two                      │  items[0].title = "Line two"
```

**Lists** contain bullet or ordered list items. Each list item is an object with the same content shape — not a plain string:

```markdown
# Features               ← title

- Fast builds             ← lists[0][0].paragraphs[0]
- **Hot** reload          ← lists[0][1].paragraphs[0]  (HTML: "<strong>Hot</strong> reload")
```

Items can contain lists:

```markdown
### Starter               ← items[0].title
$9/month                  ← items[0].paragraphs[0]

- Feature A               ← items[0].lists[0][0].paragraphs[0]
- Feature B               ← items[0].lists[0][1].paragraphs[0]
```

Render list item text with kit components (see [kit section](#uniwebkit) below):

```jsx
import { Span } from '@uniweb/kit'

content.lists[0]?.map((listItem, i) => (
  <li key={i}><Span text={listItem.paragraphs[0]} /></li>
))
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
![npm create uniweb](@CommandBlock){note="Vite + React + Routing — ready to go"}
```

Inset components must declare `inset: true` in their `meta.js`. They render at the exact position in the content flow where the author placed them. See meta.js section below for details.

### Links and Media Attributes

```markdown
[text](url){target=_blank}              <!-- Open in new tab -->
[text](./file.pdf){download}            <!-- Download -->
![alt](./img.jpg){role=banner}          <!-- Role determines array: imgs, icons, or videos -->
```

**Quote values that contain spaces:** `{note="Ready to go"}` not `{note=Ready to go}`. Unquoted values end at the first space.

Standalone links (alone on a line) become buttons. Inline links stay as text links.

**Standalone links** — paragraphs that contain *only* links (no other text) are promoted to `content.links[]`. This works for single links and for multiple links sharing a paragraph:

```markdown
[Primary](/start)              ← standalone → content.links[0]

[Secondary](/learn)            ← standalone → content.links[1]

[One](/a) [Two](/b)            ← links-only paragraph → content.links[0], content.links[1]
```

Links mixed with non-link text stay as inline `<a>` tags within `content.paragraphs[]`:

```markdown
Check out [this](/a) and [that](/b).   ← inline links in paragraph text, NOT in content.links[]
```

### Inline Text Styling

Style specific words or phrases using bracketed spans with boolean attributes:

```markdown
# Build [faster]{accent} with structure

This is [less important]{muted} context.
```

The framework provides two defaults: `accent` (colored + bold) and `muted` (subtle). These adapt to context automatically — in dark sections, `accent` resolves to a lighter shade.

**What you write → what components receive:**

| Markdown | HTML in content string |
|----------|----------------------|
| `[text]{accent}` | `<span accent="true">text</span>` |
| `[text]{muted}` | `<span muted="true">text</span>` |
| `[text]{color=red}` | `<span style="color: red">text</span>` |

CSS is generated from `theme.yml`'s `inline:` section using attribute selectors (`span[accent] { ... }`). Sites can define additional named styles:

```yaml
inline:
  accent:
    color: var(--link)
    font-weight: '600'
  callout:
    color: var(--accent-600)
    font-style: italic
```

**Common pattern — accented multi-line hero heading:**

```markdown
# Build the future
# [with confidence]{accent}
```

This produces `content.title = ["Build the future", "<span accent=\"true\">with confidence</span>"]` — an array rendered as a single `<h1>` with visual line breaks. See [Multi-Line Headings](#multi-line-headings) for details.

Components receive HTML strings with the spans already applied. Kit's `<H1>`, `<P>`, etc. render them correctly via `dangerouslySetInnerHTML`.

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

**Code blocks need tags too.** Untagged code blocks (plain ```js) are only visible to sequential-rendering components like Article or DocSection. If a component needs to access code blocks by name, tag them:

````markdown
```jsx:before
const old = fetch('/api')
```

```jsx:after
const data = useData()
```
````

Access: `content.data?.before`, `content.data?.after` → raw code strings.

### Lists as Navigation Menus

Markdown lists are ideal for navigation, menus, and grouped link structures. Each list item is a full content object with `paragraphs`, `links`, `icons`, and nested `lists`.

**Header nav — flat list with icons and links:**

```markdown
- ![](lu-home) [Home](/)
- ![](lu-book) [Docs](/docs)
- ![](lu-mail) [Contact](/contact)
```

Access: `content.lists[0]` — each item has `item.links[0]` (href + label) and `item.icons[0]` (icon).

**Footer — nested list for grouped links:**

```markdown
- Product
  - [Features](/features)
  - [Pricing](/pricing)
- Company
  - [About](/about)
  - [Careers](/careers)
```

Access: `content.lists[0]` — each top-level item has `item.paragraphs[0]` (group label) and `item.lists[0]` (array of sub-items, each with `subItem.links[0]`).

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

### Section Backgrounds

Set `background` in frontmatter — the runtime renders it automatically. The string form auto-detects the type:

```yaml
background: /images/hero.jpg                             # Image (by extension)
background: /videos/hero.mp4                             # Video (by extension)
background: linear-gradient(135deg, #667eea, #764ba2)    # CSS gradient
background: '#1a1a2e'                                    # Color (hex — quote in YAML)
background: var(--primary-900)                            # Color (CSS variable)
```

The object form gives more control:

```yaml
background:
  image: { src: /img.jpg, position: center top }
  overlay: { enabled: true, type: dark, opacity: 0.5 }
```

Overlay shorthand — `overlay: 0.5` is equivalent to `{ enabled: true, type: dark, opacity: 0.5 }`.

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

Components receive children via `block.childBlocks`. Use `ChildBlocks` from kit to render them — the runtime handles component resolution:

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

### Composition in practice

Section nesting and insets together give content authors significant layout power without requiring new components. A single Grid section type composes *any* combination of children — each child is its own section type with its own content:

```
pages/home/
├── page.yml
├── 1-hero.md
├── 2-highlights.md          # type: Grid, columns: 3
├── 3-cta.md
├── @stats.md                # type: StatCard — numbers and labels
├── @testimonial.md          # type: Testimonial — quote with attribution
└── @demo.md                 # type: SplitContent — text + ![](@LiveDemo) inset
```

```yaml
nest:
  highlights: [stats, testimonial, demo]
```

The content author chose three different section types as children, arranged them in a grid, and embedded an interactive component inside one of them — all through markdown and YAML. The developer wrote one Grid component, a few card-level section types, and an inset. No bespoke "highlights" component needed.

This is functional composition applied to content: small, focused section types that combine into richer layouts. The developer builds reusable pieces (Grid, StatCard, Testimonial, SplitContent); the content author composes them. Adding a fourth card means creating one `@`-prefixed file and adding its name to the `nest:` array.

### When to use which pattern

| Pattern | Authoring | Use when |
|---------|-----------|----------|
| **Items** (`content.items`) | Heading groups in one `.md` file | Repeating content within one section (cards, FAQ entries) |
| **Insets** (`block.insets`) | `![](@Component)` in markdown | Embedding a self-contained visual (chart, diagram, widget) |
| **Child sections** (`block.childBlocks`) | `@`-prefixed `.md` files + `nest:` | Children with rich authored content (testimonials, carousel slides) |

Does the content author write content *inside* the nested component? **Yes** → child sections. **No** (self-contained, driven by params/data) → insets. Repeating groups within one section → items. These patterns compose: a child section can contain insets, and items work inside children.

**Inset rule of thumb:** If the same interactive widget or self-contained visual appears inside multiple different sections (a copy-able command block, a chart, a demo player), make it an inset. The content author places it with `![](@CommandBlock)` wherever it's needed — no prop drilling, no imports.

## Semantic Theming

CCA separates theme from code. Components use **semantic CSS tokens** instead of hardcoded colors. The runtime applies a context class (`context-light`, `context-medium`, `context-dark`) to each section based on `theme:` frontmatter.

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
| `hover:bg-primary-hover` | Primary hover state |
| `border-primary-border` | Primary border (transparent by default) |
| `bg-secondary` | Secondary action background |
| `text-secondary-foreground` | Text on secondary background |
| `hover:bg-secondary-hover` | Secondary hover state |
| `border-secondary-border` | Secondary border |
| `text-success` / `bg-success-subtle` | Status: success |
| `text-error` / `bg-error-subtle` | Status: error |
| `text-warning` / `bg-warning-subtle` | Status: warning |
| `text-info` / `bg-info-subtle` | Status: info |

### What the runtime handles (don't write this yourself)

The runtime does significant work that other frameworks push onto components. Understanding this prevents writing unnecessary code:

1. **Section backgrounds** — The runtime renders image, video, gradient, color, and overlay backgrounds from frontmatter. Components never set their own section background.
2. **Context classes** — The runtime wraps every section in `<section class="context-{theme}">`, which auto-applies `background-color: var(--section)` and sets all token values.
3. **Token resolution** — All 24+ semantic tokens resolve automatically per context. A component using `text-heading` gets dark text in light context, white text in dark context — zero conditional logic.
4. **Colored section backgrounds** — Content authors create tinted sections via frontmatter, not component code:
   ```yaml
   ---
   type: Features
   theme: light
   background:
     color: var(--primary-50)       # Light blue tint with light-context tokens
   ---
   ```

**What components should NOT contain:**

| Don't write | Why |
|-------------|-----|
| `bg-white` or `bg-gray-900` on section wrapper | Engine applies `bg-section` via context class |
| `const themes = { light: {...}, dark: {...} }` | Context system replaces theme maps entirely |
| `isDark ? 'text-white' : 'text-gray-900'` | Just write `text-heading` — it adapts |
| Background rendering code | Declare `background:` in frontmatter instead |
| Color constants / tokens files | Colors come from `theme.yml` |
| Parallel color system (`--ink`, `--paper`) that duplicates what tokens already provide | Map source color roles to `theme.yml` colors/neutral. The build generates `--primary-50` through `--primary-950`, `--neutral-50` through `--neutral-950`, etc. Use palette shades directly (`var(--primary-300)`) for specific tones. Additive design classes that BUILD ON tokens are fine — a parallel system that REPLACES them bypasses context adaptation. |

**What to hardcode** (not semantic — same in every context): layout (`grid`, `flex`, `max-w-6xl`), spacing (`p-6`, `gap-8`), typography scale (`text-3xl`, `font-bold`), animations, border-radius.

**Content authors control context** in frontmatter:

```markdown
---
type: Testimonial
theme: dark           ← sets context-dark, all tokens resolve to dark values
---
```

Alternate between `light` (default), `medium`, and `dark` across sections for visual rhythm — no CSS needed. A typical marketing page:

```markdown
<!-- 1-hero.md -->
theme: dark

<!-- 2-features.md -->
(no theme — defaults to light)

<!-- 3-testimonials.md -->
theme: medium

<!-- 4-cta.md -->
theme: dark
```

**Per-section token overrides** — the object form lets authors fine-tune individual tokens for a specific section:

```yaml
theme:
  mode: light
  primary: neutral-900               # Dark buttons in a light section
  primary-hover: neutral-800
```

Any semantic token (`section`, `heading`, `body`, `primary`, `link`, etc.) can be overridden this way. The overrides are applied as inline CSS custom properties on the section wrapper — components don't need to know about them.

**Site controls the palette** in `theme.yml`. The same foundation looks different across sites because tokens resolve from the site's color configuration, not from component code.

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
  accent:                   # For [text]{accent} in markdown
    color: var(--link)
    font-weight: '600'

vars:                       # Override foundation-declared variables
  header-height: 5rem
```

Each color generates 11 OKLCH shades (50–950). The `neutral` palette is special — use a named preset (`stone` for warm) rather than a hex value. Three contexts are built-in: `light` (default), `medium`, `dark`. Context override keys match token names — `section:` not `bg:`, `primary:` not `btn-primary-bg:`.

### How colors reach components

Your hex color → 11 shades (50–950) → semantic tokens → components.

**Shade 500 = your exact input color.** The build generates lighter shades (50–400) above it and darker shades (600–950) below it, redistributing lightness proportionally to maintain a smooth scale. Set `exactMatch: false` on a color to opt out and use fixed lightness values instead.

Semantic tokens map shades to roles. The defaults for light/medium contexts:

| Token | Shade | Purpose |
|-------|-------|---------|
| `--primary` | 600 | Button background |
| `--primary-hover` | 700 | Button hover |
| `--link` | 600 | Link color |
| `--ring` | 500 | Focus ring |

In dark contexts, `--primary` uses shade 500 and `--link` uses shade 400.

**Buttons and links use shade 600 — darker than your input.** This is an accessibility choice: shade 600 provides better contrast with white button text. For medium-bright brand colors like orange, buttons will be noticeably darker than the brand color.

**Recipe — brand-exact buttons:**

```yaml
colors:
  primary: "#E35D25"

contexts:
  light:
    primary: primary-500         # Your exact color on buttons
    primary-hover: primary-600   # Darker on hover
```

> **Contrast warning:** Bright brand colors (orange, yellow, light green) at shade 500 may not meet WCAG contrast (4.5:1) with white foreground text. Test buttons for readability — if contrast is insufficient, keep the default shade 600 mapping or darken your base color.

### Foundation variables

Foundations declare customizable layout/spacing values in `foundation.js`. The starter includes:

```js
export const vars = {
  'header-height': { default: '4rem', description: 'Fixed header height' },
  'max-content-width': { default: '80rem', description: 'Maximum content width' },
  'section-padding-y': { default: 'clamp(4rem, 6vw, 7rem)', description: 'Vertical padding for sections' },
}
```

Sites override them in `theme.yml` under `vars:`. Components use them via Tailwind arbitrary values or CSS: `py-[var(--section-padding-y)]`, `h-[var(--header-height)]`, etc.

The `section-padding-y` default uses `clamp()` for fluid spacing — tighter on mobile, more breathing room on large screens. Use this variable for consistent section spacing instead of hardcoding padding in each component. Sites can override to a fixed value (`section-padding-y: 3rem`) or a different clamp in `theme.yml`.

**When to break the rules:** Header/footer components that float over content may need direct color logic (reading the first section's theme). Decorative elements with fixed branding (logos) use literal colors.

### Design richness beyond tokens

Semantic tokens handle context adaptation — the hard problem of making colors work in light, medium, and dark sections. **They are a floor, not a ceiling.** A great foundation adds its own design vocabulary on top.

The token set is deliberately small (24 tokens). It covers the dimensions that change per context. Everything that stays constant across contexts — border weights, shadow depth, radius scales, gradient angles, accent borders, glassmorphism, elevation layers — belongs in your foundation's `styles.css` or component code.

**Don't flatten a rich design to fit the token set.** If a source design has 4 border tones, create them:

```css
/* foundation/src/styles.css */
.border-subtle { border-color: color-mix(in oklch, var(--border), transparent 50%); }
.border-strong { border-color: color-mix(in oklch, var(--border), var(--heading) 30%); }
.border-accent { border-color: var(--primary-300); }
```

These compose with semantic tokens — they adapt per context because they reference `--border`, `--heading`, or palette shades. But they add design nuance the token set alone doesn't provide.

**The priority:** Design quality > portability > configurability. It's better to ship a foundation with beautiful, detailed design that's less configurable than to ship a generic one that looks flat. A foundation that looks great for one site is more valuable than one that looks mediocre for any site.

**Text tones beyond the 3-token set.** Source designs often have 4+ text tones (primary, secondary, tertiary, disabled). Uniweb provides 3 (`text-heading`, `text-body`, `text-subtle`). Don't collapse the extras — create them with `color-mix()` so they still adapt per context:

```css
/* foundation/src/styles.css */
.text-tertiary { color: color-mix(in oklch, var(--body), var(--subtle) 50%); }
.text-disabled { color: color-mix(in oklch, var(--subtle), transparent 40%); }
```

**When migrating from an existing design**, map every visual detail — not just the ones that have a semantic token. Shadow systems, border hierarchies, custom hover effects, accent tints: create CSS classes or Tailwind utilities in `styles.css` for anything the original has that tokens don't cover. Use palette shades directly (`var(--primary-300)`, `bg-neutral-200`) for fine-grained color control beyond the semantic tokens.

## Component Development

### Props Interface

```jsx
function MyComponent({ content, params, block }) {
  const { title, paragraphs, links, items } = content  // Guaranteed shape
  const { columns, variant } = params                    // Defaults from meta.js
  const { website } = useWebsite()                      // Or block.website
}
```

### Section Wrapper

The runtime wraps every section type in a `<section>` element with context class, background, and semantic tokens. Use static properties to customize this wrapper:

```jsx
function Hero({ content, params }) {
  return (
    <div className="max-w-7xl mx-auto px-6">
      <h1 className="text-heading text-5xl font-bold">{content.title}</h1>
    </div>
  )
}

Hero.className = 'pt-32 md:pt-48'   // Override spacing for hero (more top padding)
Hero.as = 'div'                      // Change wrapper element (default: 'section')

export default Hero
```

- `Component.className` — adds classes to the runtime's wrapper. Use for section-level spacing, borders, overflow. Set `py-[var(--section-padding-y)]` for consistent spacing from the theme variable, or override for specific sections (e.g., hero needs extra top padding). The component's own JSX handles inner layout only (`max-w-7xl mx-auto px-6`).
- `Component.as` — changes the wrapper element. Use `'nav'` for headers, `'footer'` for footers, `'div'` when `<section>` isn't semantically appropriate.

**Layout components** (Header, Footer) typically need `Component.className = 'p-0'` to suppress the runtime's default section padding, since they control their own padding. Also set `Component.as = 'header'` or `'footer'` for semantic HTML:

```jsx
function Header({ content, block }) { /* ... */ }
Header.className = 'p-0'
Header.as = 'header'
export default Header
```

### Content Patterns for Header and Footer

Header and Footer are the hardest components to content-model because they combine several content categories. Use different parts of the content shape for each role:

**Header** — title for logo, list for nav links, standalone link for CTA, tagged YAML for metadata:

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
  const logo = content.title                    // "Acme Inc"
  const navItems = content.lists[0] || []       // [{icons, links}, ...]
  const cta = content.links[0]                  // {href, label}
  const config = content.data?.config           // {github, version}
  // ...
}
```

**Footer** — paragraph for tagline, nested list for grouped columns, tagged YAML for legal:

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
- Community
  - [Discord](#)
  - [Blog](/blog)

```yaml:legal
copyright: © 2025 Acme Inc
```
````

```jsx
function Footer({ content, block }) {
  const tagline = content.paragraphs[0]         // "Build something great."
  const columns = content.lists[0] || []        // [{paragraphs, lists}, ...]
  const legal = content.data?.legal             // {copyright}

  // Each column: group.paragraphs[0] = label, group.lists[0] = links
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
  // hidden: true,          // Exclude from export (internal/helper component)
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
    variant: { type: 'select', options: ['default', 'centered', 'split'], default: 'default' },
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

Content fields (`title`, `pretitle`, `paragraphs[]`, list item text) are **HTML strings** — they contain markup like `<strong>`, `<em>`, `<a>` from the author's markdown. The kit provides components to render them correctly.

**Rendering text** (`@uniweb/kit`):

```jsx
import { H1, H2, P, Span } from '@uniweb/kit'

<H1 text={content.title} className="text-heading text-5xl font-bold" />
  // string → single <h1>, array → single <h1> with line breaks (multi-line headings)
<H2 text={content.subtitle} className="text-heading text-3xl font-bold" />
<P text={content.paragraphs} className="text-body" />
  // array → each string becomes its own <p>
<Span text={listItem.paragraphs[0]} className="text-subtle" />
```

`H1`–`H6`, `P`, `Span`, `Div` are all wrappers around `Text` with a preset tag:

```jsx
<Text text={content.title} as="h2" className="..." />  // explicit tag
```

These components render their own HTML tag — don't wrap them in a matching tag. `<h2><H2 text={...} /></h2>` creates a nested `<h2><h2>...</h2></h2>`, which is invalid HTML. Just use `<H2 text={...} />` directly.

Don't render content strings with `{content.paragraphs[0]}` in JSX — that shows HTML tags as visible text. Use `<P>`, `<H2>`, `<Span>`, etc. for content strings.

**Rendering full content** (`@uniweb/kit`):

```jsx
import { Section, Render } from '@uniweb/kit'

<Render content={block.parsedContent} block={block} />   // ProseMirror nodes → React
<Section block={block} width="lg" padding="md" />         // Render + prose styling + layout
```

`Render` processes ProseMirror nodes into React elements — paragraphs, headings, images, code blocks, lists, tables, alerts, and insets. `Section` wraps `Render` with prose typography and layout options. Use these when rendering a block's complete content. Use `P`, `H2`, etc. when you extract specific fields and arrange them with custom layout.

**Rendering visuals** (`@uniweb/kit`):

`<Visual>` renders the first non-empty candidate from the props you pass (inset, video, image). See Insets section below.

**Other primitives** (`@uniweb/kit`): `Link`, `Image`, `Icon`, `Media`, `Asset`, `SafeHtml`, `SocialIcon`, `FileLogo`, `cn()`

`Link` props: `to` (or `href`), `target`, `reload`, `download`, `className`, `children`:

```jsx
<Link to="/about">About</Link>            // SPA navigation via React Router
<Link to="page:about">About</Link>        // Resolves page ID to route
<Link reload href={localeUrl}>ES</Link>    // Full page reload, prepends basePath
// External URLs auto-get target="_blank" and rel="noopener noreferrer"
```

**Other styled** (`@uniweb/kit`): `SidebarLayout`, `Prose`, `Article`, `Code`, `Alert`, `Table`, `Details`, `Divider`, `Disclaimer`

**Hooks:**
- `useScrolled(threshold)` → boolean for scroll-based header styling
- `useMobileMenu()` → `{ isOpen, toggle, close }` with auto-close on navigation
- `useAccordion({ multiple, defaultOpen })` → `{ isOpen, toggle }` for expand/collapse
- `useActiveRoute()` → `{ route, rootSegment, isActive(page), isActiveOrAncestor(page) }` for nav highlighting (SSG-safe)
- `useGridLayout(columns, { gap })` → responsive grid class string
- `useTheme(name)` → standardized theme classes
- `useAppearance()` → `{ scheme, toggle, canToggle, setScheme, schemes }` — light/dark mode control with localStorage persistence
- `useRouting()` → `{ useLocation, useParams, useNavigate, Link, isRoutingAvailable }` — SSG-safe routing access (returns no-op fallbacks during prerender)
- `useWebsite()` → `{ website, localize, makeHref, getLanguage, getLanguages, getRoutingComponents }` — primary runtime hook
- `useThemeData()` → Theme instance for programmatic color access (`getColor(name, shade)`, `getPalette(name)`)
- `useColorContext(block)` → `'light' | 'medium' | 'dark'` — current section's color context

**Utilities:** `cn()` (Tailwind class merge), `filterSocialLinks(links)`, `getSocialPlatform(url)`

### Foundation Organization

```
foundation/src/
├── sections/            # Section types (auto-discovered)
│   ├── Hero.jsx         # Bare file — simple components need no folder
│   ├── Features/        # Folder — when you need meta.js, helpers, etc.
│   │   ├── index.jsx
│   │   └── meta.js
│   └── insets/          # Organizational subdirectory (lowercase)
│       └── Diagram/     # Nested section type — meta.js required
│           ├── index.jsx
│           └── meta.js
├── components/          # Your React components (no meta.js, not selectable)
│   ├── ui/              # shadcn-compatible primitives
│   │   └── button.jsx
│   └── Card.jsx
└── styles.css
```

**Discovery rules for `sections/`:**

- **Root level** — PascalCase bare files (`Hero.jsx`) and folders (`Features/`) are addressable by default. No `meta.js` required (an implicit one is generated with an inferred title).
- **Root level with meta.js** — Folder has `meta.js` → uses explicit meta (params, inset, children, etc.).
- **Nested levels** — `meta.js` required for addressability. Lowercase directories like `insets/`, `utilities/` are organizational — they're recursed into but not registered as section types themselves.
- **Hidden** — `hidden: true` in meta.js excludes a component from discovery entirely.

Everything outside `sections/` is ordinary React — organize however you like.

### Website and Page APIs

```jsx
const { website } = useWebsite()  // or block.website
const page = website.activePage   // or block.page 

// Navigation
const pages = website.getPageHierarchy({ for: 'header' })  // or 'footer'
// → [{ route, navigableRoute, label, hasContent, children }]

// Locale
website.hasMultipleLocales()
website.getLocales()        // [{ code, label, isDefault }]
website.getActiveLocale()   // 'en'
website.getLocaleUrl('es')

// Core properties
website.name              // Site name from site.yml
website.basePath          // Deployment base path (e.g., '/docs/')

// Route detection
const { isActive, isActiveOrAncestor } = useActiveRoute()
isActive(page)            // Exact match
isActiveOrAncestor(page)  // Ancestor match (for parent highlighting in nav)

// Appearance (light/dark mode)
const { scheme, toggle, canToggle } = useAppearance()

// Page properties
page.title                // Page title
page.label                // Short label for nav (falls back to title)
page.route                // Route path
page.isHidden()           // Hidden from navigation
page.showInHeader()       // Visible in header nav
page.showInFooter()       // Visible in footer nav
page.hasChildren()        // Has child pages
page.children             // Array of child Page objects
```

### Insets and the Visual Component

Components access inline `@` references via `block.insets` (separate from `block.childBlocks`):

```jsx
import { Visual } from '@uniweb/kit'

// Visual renders the first non-empty candidate: inset > video > image
function SplitContent({ content, block }) {
  return (
    <div className="flex gap-12">
      <div className="flex-1">
        <h2 className="text-heading">{content.title}</h2>
      </div>
      <Visual inset={block.insets[0]} video={content.videos[0]} image={content.imgs[0]} className="flex-1 rounded-lg" />
    </div>
  )
}
```

- `<Visual>` — renders first non-empty candidate from the props you pass (`inset`, `video`, `image`)
- `<Render>` / `<Section>` — automatically handles `@Component` references placed in content flow
- `block.insets` — array of Block instances from `@` references
- `block.getInset(refId)` — lookup by refId (used by sequential renderers)
- `content.insets` — flat array of `{ refId }` entries (parallel to `content.imgs`)

**SSG:** Insets, child blocks (`<ChildBlocks>`), and `<Visual>` all render correctly during prerender (SSG). The prerender pipeline provides an inline `childBlockRenderer` that handles these without React hooks. However, inset components that use React hooks internally (useState, useEffect) will still trigger prerender warnings — the component itself can't use hooks in the SSG pipeline due to dual React instances. The warnings are informational; the page renders correctly client-side.

Inset components declare `inset: true` in meta.js:

```js
// sections/insets/NetworkDiagram/meta.js
export default {
  inset: true,
  params: { variant: { type: 'select', options: ['full', 'compact'], default: 'full' } },
}
```

Whether an inset appears in a section palette is a concern of the parent component (via `children` and `insets` in its meta.js), not a property of the inset itself. Don't use `hidden: true` on insets — `hidden` means "don't export this component at all" (internal helpers, not-yet-ready components).

### Dispatcher Pattern

One section type with a `variant` param replaces multiple near-duplicates. Instead of `HeroLeft`, `HeroCentered`, `HeroSplit` — one `Hero` with `variant: left | centered | split`:

```jsx
function SplitContent({ content, block, params }) {
  const flipped = params.variant === 'flipped'
  return (
    <div className={`flex gap-16 items-center ${flipped ? 'flex-row-reverse' : ''}`}>
      <div className="flex-1">
        {content.pretitle && (
          <p className="text-xs font-bold uppercase tracking-widest text-subtle mb-4">
            {content.pretitle}
          </p>
        )}
        <h2 className="text-heading text-3xl font-bold">{content.title}</h2>
        <p className="text-body mt-4">{content.paragraphs[0]}</p>
      </div>
      <Visual inset={block.insets[0]} video={content.videos[0]} image={content.imgs[0]} className="flex-1 rounded-2xl" />
    </div>
  )
}
```

```js
// meta.js
export default {
  title: 'Split Content',
  content: { pretitle: 'Eyebrow label', title: 'Section heading', paragraphs: 'Description' },
  params: {
    variant: { type: 'select', options: ['default', 'flipped'], default: 'default' },
  },
}
```

Content authors choose the variant in frontmatter (`variant: flipped`), or the site can alternate it across sections. One component serves every "text + visual" layout on the site.

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
- **Visual component** — `<Visual>` renders the first non-empty visual from explicit candidates (inset, video, image), replacing manual media handling
- **Semantic theming** — the runtime orchestrates context classes and token resolution, replacing per-component dark mode logic
- **Engine backgrounds** — the runtime renders section backgrounds from frontmatter, replacing background-handling code in every section
- **Rich params** — `meta.js` params with types, defaults, and presets replace config objects and conditional logic

### Migration approach

1. **Check if you're inside an existing Uniweb workspace** (look for `pnpm-workspace.yaml` and a `package.json` with `uniweb` as a dependency). If yes, use `pnpm uniweb add` to create projects inside it. If no, create a new workspace:
   ```bash
   pnpm create uniweb my-project --template none
   ```

3. **Use named layouts** for different page groups — a marketing layout for landing pages, a docs layout for `/docs/*`. One site, multiple layouts, each with its own header/footer/sidebar content.

4. **Dump legacy components under `src/components/`** — they're not section types. Import them from section types as needed during the transition.

5. **Create section types one at a time.** Each is independent — one can use hardcoded content while another reads from markdown. Staged migration levels:
   - **Level 0**: Paste the whole original file as one section type. You get routing and dev tooling immediately.
   - **Level 1**: Decompose into section types. Name by purpose (`Institutions` → `Testimonial`). Consolidate duplicates via dispatcher pattern.
   - **Level 2**: Move content from JSX to markdown. Components read from `content` instead of hardcoded strings. Content authors can now edit without touching code.
   - **Level 3**: Replace hardcoded Tailwind colors with semantic tokens. Components work in any context and any brand.

6. **Map source colors to `theme.yml`, not to foundation CSS.** The most common migration mistake is recreating the source site's color tokens as CSS custom properties in `styles.css` (e.g., `--ink`, `--paper`, `--accent`). This creates a parallel color system that bypasses CCA's semantic tokens, context classes, and site-level theming entirely. Instead: identify the source's primary color → set it as `colors.primary` in theme.yml. Identify the neutral tone → set it as `colors.neutral` (e.g., `stone` for warm). Identify context needs → use `theme:` frontmatter per section. Components use `text-heading`, `bg-section`, `bg-card` — never custom color variables.

7. **Name by purpose, not by content** — `TheModel` → `SplitContent`, `WorkModes` → `FeatureColumns`, `FinalCTA` → `CallToAction`. Components render a *kind* of content, not specific content.

8. **UI helpers → `components/`** — Buttons, badges, cards go in `src/components/` (no `meta.js` needed, not selectable by content authors).

## Tailwind CSS v4

Foundation styles in `foundation/src/styles.css`:

```css
@import "tailwindcss";
@import "@uniweb/kit/theme-tokens.css";           /* Semantic tokens from theme.yml */
@source "./sections/**/*.{js,jsx}";
@source "./components/**/*.{js,jsx}";             /* UI helpers (Button, Card, etc.) */
@source "../node_modules/@uniweb/kit/src/**/*.jsx";

@theme {
  /* Additional custom values — NOT for colors already in theme.yml */
  --breakpoint-xs: 30rem;
}
```

Semantic color tokens (`text-heading`, `bg-section`, `bg-primary`, etc.) come from `theme-tokens.css` — which the runtime populates from the site's `theme.yml`. Don't redefine colors here that belong in `theme.yml`. Use `@theme` only for values the token system doesn't cover (custom breakpoints, animations, shadows).

**Custom CSS is expected alongside Tailwind.** Your foundation's `styles.css` is the design layer — shadow systems, border hierarchies, gradient effects, accent treatments, elevation scales, glassmorphism. If the source design has a visual detail, create a class for it. Tailwind handles layout and spacing; semantic tokens handle context adaptation; `styles.css` handles everything else that makes the design rich and distinctive.

## Troubleshooting

**"Could not load foundation"** — Check `site/package.json` has `"foundation": "file:../foundation"` (or `"default": "file:../../foundations/default"` for multi-site).

**Component not appearing** — Verify `meta.js` exists. Check for `hidden: true` (means component is excluded from export — only use for internal helpers). Rebuild: `cd foundation && pnpm build`.

**Styles not applying** — Verify `@source` in `styles.css` includes your component paths. Check custom colors match `@theme` definitions.

**Prerender warnings about hooks/useState** — Components with React hooks (useState/useEffect) — especially insets — will show SSG warnings during `pnpm build`. This is expected and harmless; see the note in the Insets section above.

**Content not appearing as expected?** In dev mode, open the browser console and inspect the parsed content shape your component receives:

```js
globalThis.uniweb.activeWebsite.activePage.bodyBlocks[0].parsedContent
```

Compare with the Content Shape table above to identify mapping issues (e.g., headings becoming items instead of title, links inline in paragraphs instead of in `links[]`).

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
