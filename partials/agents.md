# AGENTS.md

## The Architecture in One Sentence

A Uniweb project separates **what the site says** from **how it's built**. Content authors write markdown — choosing section types, setting params, composing layouts. Component developers build reusable section types that receive pre-parsed content and render it. Neither touches the other's files.

Every pattern here serves that separation: markdown for content, frontmatter for configuration, `meta.js` for the contract between the two roles, semantic tokens for context adaptation, and a runtime that handles section wrapping, backgrounds, theming, and token resolution so components don't have to.

Once the runtime parses content and hands it to your component as `{ content, params }`, **it's standard React.** Standard Tailwind. Import any library, use any pattern. The `{ content, params }` interface applies only to *section types* (components authors select in markdown); everything else in your foundation is ordinary React with ordinary props.

You build a *system* of section types, not individual pages. That's what makes i18n, theming, and multi-site tractable — they're properties of the system rather than things bolted onto each component.

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

> Full documentation is fetchable markdown at `https://raw.githubusercontent.com/uniweb/docs/main/{section}/{page}.md`. This guide covers what you can't derive by reading code; the index at the end points to everything else. Fetch a page rather than guessing.

---

## Working in an Existing Project

The rest of this guide explains how Uniweb works. This section is what to do *first* when you've been handed a project that already uses it, plus a task.

### 1. Orient — what kind of project is this?

Find the site package: it's the one with a `site.yml` and a `pages/` folder. `site/` is the convention, but a workspace can hold several (under `sites/`, or as co-located pairs like `docs/site` + `docs/src`).

Then read `site.yml` and look at `foundation:`. It decides what you're able to change at all:

| `foundation:` value | What it means | Can you add a section type? |
|---|---|---|
| a workspace package name (`src`, `docs-src`) | the foundation's source is in this repo | **Yes** — in `src/` (or the named folder) |
| a versioned registry ref (`@org/name@1.2.3`) | the foundation is published; **its source is not in this repo** | **No** — work within the types it already offers |
| an `https://…` URL, or `{ url: … }` | same, loaded from that URL | **No** |

A versionless `@org/name` is an error rather than a shorthand — the build rejects it and asks for a version.

### 2. Learn this project's vocabulary — before you write anything

**A foundation is a fixed vocabulary of section types, and every project's is different.** Nothing in the framework tells you what a given project offers; you read it:

```bash
ls src/sections/                    # the section types this project has
cat src/sections/Hero/meta.js       # what one expects and accepts
```

Each `meta.js` is a catalog entry: `description` (what the type is for), `content:` (what markdown it expects), `params:` (what frontmatter it accepts, with defaults), `presets:` (named param bundles). Read them as a menu — that is what they are. There is no CLI command that lists them; reading the folder *is* the discovery step.

> **Never write a `type:` or a param you haven't confirmed exists.** An unknown section type does **not** fail the build. The build goes green and the page renders a red box reading `Component not found: <Type>` where your section should be. A param that no `meta.js` declares is accepted silently and does nothing. Both failures are invisible from the terminal — you will report success on a broken page.

### 3. Find your lane

The architecture exists to keep content and code separate. Your task sits in one of them. Decide before you edit, then stay there.

| Task | Lane | Files you touch |
|---|---|---|
| Add / edit / reorder a section on a page | content | `site/pages/**` |
| Add a page | content | `site/pages/<name>/` |
| Change colors, fonts, light/dark | content | `site/theme.yml` |
| Change header, footer, or nav content | content | `site/layout/*.md`, or page order in `site.yml` |
| Change how a section type *looks* everywhere | foundation | `src/sections/<Type>/` |
| Add a new section type | foundation | `src/sections/<NewType>/` |
| Expose a new knob to authors | foundation | `src/sections/<Type>/meta.js` + the component |

**If you're on a content task and find yourself wanting to open `src/`, stop.** Usually it means you missed a param the section type already exposes — re-read its `meta.js`. If the knob genuinely doesn't exist, that's a foundation change: say so explicitly rather than quietly crossing the boundary, because editing a section type changes it for every page — and every other site — using that foundation.

### 4. The loop

```bash
uniweb dev                         # from the workspace root; it picks the site
```

Markdown, `theme.yml`, and component edits hot-reload. New section types are picked up without a restart.

**When you're unsure what shape your markdown produces, don't reason about it — run it.** From the *site* directory (paths resolve against your shell's working directory):

```bash
uniweb inspect pages/home/hero.md              # the parsed content shape
uniweb inspect pages/home/                     # every section on the page
uniweb inspect pages/home/hero.md --full       # include empty fields (matches runtime)
uniweb inspect pages/home/hero.md --sequence   # include the sequence array
uniweb inspect pages/home/hero.md --raw        # the ProseMirror AST
```

This settles any question in *Content Shape* below — whether a heading became a subtitle or an item, whether the parser saw your data block, why `content.title` is an array. One command beats re-deriving the rules.

### 5. Recipes

**Add a section to a page.** `ls site/pages/<page>/` to see the existing sections and their numeric prefixes → pick a `type:` from the vocabulary (step 2) → create `site/pages/<page>/N-name.md` with frontmatter plus markdown. Use a decimal (`2.5-…`) to slot between existing sections without renaming them.

**Add a page.** Create `site/pages/<name>/`, add `page.yml` (at minimum `title:`), add one or more section `.md` files. It gets the route `/<name>` automatically. Only touch `pages:` in the parent `page.yml` / `site.yml` if you need a specific order.

**Change the brand color.** `site/theme.yml` → `colors.primary`. One line, and every component follows. Do **not** edit Tailwind color classes in components to change brand color — that is the exact anti-pattern this system removes.

**Change a nav item.** First check how nav is produced. If `site/layout/header.md` lists the links (a markdown list, or a `yaml:nav` block), edit it there. If it doesn't, the Header is generating nav from the page hierarchy — change page titles and order in `site.yml` / `page.yml` instead.

**Change one section's columns / spacing / variant.** Check that type's `meta.js` `params:` first. If the knob exists, set it in that section's frontmatter and you're done, in the content lane. If it doesn't, it's a foundation change — see the warning in step 3.

---

## Content Shape

### Section format

Each `.md` file is a section. Frontmatter on top, content below:

```markdown
---
type: Hero
theme: dark
---

### V1.0.0 IS OUT         ← pretitle (small label above the title)

# Build the system.       ← title (the big headline)

## Not every page.        ← subtitle

Description paragraph.

[Call to Action](/link)

![Image](./image.jpg)
```

Heading levels set *structure* (pretitle, title, subtitle), not font size — the component controls visual sizing.

**Markdown order ≠ rendering order.** The parser extracts content into a flat structure; the component decides how to arrange it visually. Write markdown in semantic order, not visual order — start with the heading, then add icons, images, and text in any order.

**Placing content *before* the first heading changes the parse:** headings after body content become items, not the section title. This is by design — it's how repeating content groups are created.

### The parsed object

The semantic parser produces a flat, guaranteed structure. No null checks needed — empty strings/arrays when content is absent:

```js
content = {
  title: '',        // Main heading (string or string[] for multi-line)
  pretitle: '',     // Heading before main title (auto-detected)
  subtitle: '',     // Heading after title (string or string[] for multi-line)
  paragraphs: [],   // Text blocks
  links: [],        // { href, label, role } — standalone links (not inside lists)
  images: [],       // { src, alt, role, href }
  icons: [],        // { library, name, role }
  videos: [],       // { src, alt, role, poster, href }
  insets: [],       // Inline @Component references — { refId }
  lists: [],        // [[{ paragraphs, links, lists, ... }]] — each list item is an object, not a string
  quotes: [],       // Blockquotes
  snippets: [],     // Fenced code — [{ language, code }]
  data: {},         // From tagged data blocks (```yaml:tagname, ```json:tagname)
  headings: [],     // Headings after subtitle, in document order
  items: [],        // Each has the same flat structure — from headings after body content
  sequence: [],     // All elements in document order
}
```

> **Don't predict this — print it.** `uniweb inspect <path>` (run from the site directory) shows the actual parsed shape of any section or page. Every rule in this section is faster to confirm than to re-derive, and the rules below are the ones most often gotten wrong from memory.

### Markdown → content, side by side

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

The three rules that produce this: headings *before* the main title become `pretitle`; a heading *after* the title at lower importance becomes `subtitle`; headings appearing *after body content* start the `items` array.

### Items have the full content shape

This is the most commonly overlooked feature. Each item has `title`, `pretitle`, `subtitle`, `paragraphs`, `links`, `icons`, `lists`, `snippets`, and `data` — you don't need workarounds for structured content inside items. Heading hierarchy within an item follows the same rules (`####` inside a `###` item becomes that item's `subtitle`).

````markdown
### Starter               ← items[0].title
$9/month                  ← items[0].paragraphs[0]

```yaml:details
trial: 14 days
seats: 1
```                       ← items[0].data.details = { trial: "14 days", seats: 1 }
````

### Subtitle vs items — the level rule

A heading immediately after the title becomes `subtitle` **only when it is exactly one level deeper** (H1→H2, H2→H3). Skipping levels (H1→H3) breaks the group and the deeper heading starts items instead. To get items with no subtitle, close the title group with a `---` divider or a paragraph:

```markdown
# Our Stats                       │  content.title = "Our Stats"
---                               │  ← divider closes the title group
## 15,000+                        │  content.items[0].title = "15,000+"
Students from 90 countries        │  content.items[0].paragraphs[0]
                                  │
## 200+                           │  content.items[1].title = "200+"
Programs offered                  │  content.items[1].paragraphs[0]
```

Without the `---`, `## 15,000+` would become `content.subtitle`.

### Multi-line headings

Consecutive headings at the same level merge into a title array — one heading split across visual lines. Kit's `<H1>`, `<H2>`, … render arrays as a single tag with line breaks.

```markdown
# Build the future              │  content.title = ["Build the future", "with confidence"]
# with confidence               │

# Build the future              │  content.title = [
# [with confidence]{accent}     │    "Build the future",
                                │    "<span accent=\"true\">with confidence</span>"
                                │  ]
```

**Rule:** same-level continuation only applies *before* going deeper. Once a subtitle level is reached, same-level headings start new items instead of merging. Use `---` to force separate items where headings would otherwise merge.

### Sequential content

`content.sequence` is the flat, ordered list of all elements before any grouping. Each element has a `type` (`heading`, `paragraph`, `image`, `codeBlock`, `dataBlock`, `list`, `link`, `divider`, `inset`, …) plus type-specific fields. Use it when grouping isn't the right lens — rendering prose in document order, or finding elements regardless of which group they landed in:

```js
// All data blocks, regardless of heading groups
const allData = {}
for (const el of content.sequence) {
  if (el.type === 'dataBlock') allData[el.tag] = el.data
}
```

Grouped fields and `sequence` are two interpretations of the same content. Grouped suits structured layouts (cards, features); sequential suits prose and cross-group searching.

---

## Authoring Vocabulary

### Choosing how to model content

The decision rule: **would a content author need to change this?** Yes → markdown, frontmatter, or a tagged data block. No → component code.

Start with the content, not the component. Write the markdown an author would naturally write, check what shape the parser produces (`uniweb inspect <file>`), *then* build the component to receive it. You have three layers, and most of the design skill is choosing between them:

**Pure markdown** — headings, paragraphs, links, images, lists, items. The default. If the content reads naturally as markdown and the parser captures it, stop here.

**Frontmatter params** — `columns: 3`, `variant: centered`. Configuration an author might change but that isn't *content*. Would changing this alter the section's *meaning* or just its *presentation*? Presentation → param. Meaning → content.

**Tagged data blocks** — for content that doesn't fit markdown patterns: products with SKUs, team members with roles, event schedules, form definitions. When information is genuinely structured data that an author still owns, a well-named block (`yaml:pricing`, `yaml:speakers`) is clearer than contorting markdown. Formats: `yaml` and `json`. Parsed at build time into `content.data.tagName`.

Read the markdown out loud. If an author would understand what every line does, you've chosen right. The moment markdown feels like it's encoding data rather than expressing content, step up to a tagged block.

**When you are building the foundation, you are designing these, not choosing from a menu.** The examples in this guide illustrate patterns, not exhaustive inventories. Any param name works in `meta.js`, any tag name works for data blocks, any section type name works. The framework has fixed mechanisms (content shape, context modes, token system); nearly everything else is yours to define.

**When you are writing content against a foundation that already exists, the opposite holds.** The vocabulary is fixed and finite: the section types are exactly what `src/sections/**` declares, and their params are exactly what each `meta.js` lists. Inventing a name there doesn't extend the system — it renders a red `Component not found` box on a build that otherwise reports success. Confirm before you write; see *Working in an existing project* above.

**Parameter naming matters.** Would an author understand it without reading code? `columns: 3` yes, `gridCols: 3` no. `variant: centered` yes, `renderMode: flex-center` no. `align: left` yes, `contentAlignment: flex-start` no.

### Icons

Image syntax with a library prefix: `![](lu-house)`. Libraries: `lu` (Lucide), `hi2` (Heroicons), `fi` (Feather), `pi` (Phosphor), `tb` (Tabler), `bs` (Bootstrap), `md` (Material), `fa6` (Font Awesome 6), and others — browse at [react-icons.github.io/react-icons](https://react-icons.github.io/react-icons/). Custom SVGs: `![Logo](./logo.svg){role=icon}`.

### Links and media attributes

```markdown
[text](url){target=_blank}              <!-- Open in new tab -->
[text](./file.pdf){download}            <!-- Download -->
![alt](./img.jpg){role=banner}          <!-- Role determines array: images, icons, or videos -->
```

**Quote values containing spaces:** `{note="Ready to go"}`, not `{note=Ready to go}` — unquoted values end at the first space.

Standalone links (alone on a line) become buttons in `content.links[]`. Inline links stay as `<a>` tags inside `content.paragraphs[]`. Multiple links sharing a paragraph are all promoted:

```markdown
[Primary](/start)              ← standalone → content.links[0]
[One](/a) [Two](/b)            ← links-only paragraph → both in content.links[]
Check out [this](/a) link.     ← inline → stays in paragraphs as <a> tag
```

### Inline text styling

```markdown
# Build [faster]{accent} with structure
This is [less important]{muted} context.
```

`accent` and `callout` (both accent-colored + bold) and `muted` (subtle) are built-in defaults that adapt to context. `--accent` is your brand color unless you declare a separate `colors.accent`, and resolves to the shade you authored — not a darkened one, since accent is decorative emphasis rather than body-size link text. Components receive HTML strings with spans applied: `<span accent="true">faster</span>`.

Sites can adjust these or add named styles in `theme.yml`'s `inline:` section. Overrides merge **property by property**, so declare only what differs (`accent: { font-weight: inherit }` keeps the default color); to drop a default property rather than change it, give it a neutral value (`initial`, `inherit`, `unset`).

### Fenced code: data blocks vs snippets

Fenced code serves two purposes depending on whether it carries a tag.

**Tagged data blocks** — structured data parsed into JS objects. The tag is the key in `content.data`; the format (`yaml`/`yml`/`json`) is a serialization format, not a display language.

````markdown
```yaml:form
fields:
  - name: email
    type: email
submitLabel: Send
```
````

→ `content.data?.form` = `{ fields: [...], submitLabel: "Send" }`

**Code snippets** — display content with a language for syntax highlighting, collected in `content.snippets` as `[{ language, code }]`. Filter with `content.snippets.filter(s => s.language === 'css')`.

Both appear in `content.sequence`. `<Prose>` handles the difference automatically — it renders snippets with highlighting and skips tagged data blocks, which components access separately via `content.data`.

### Math (LaTeX)

Authors write LaTeX directly; it compiles to MathML Core **at build time** — no runtime math library, no extra CSS. Three forms, matching Pandoc / GitHub / VS Code / Jupyter / Obsidian convention:

| Form | Mode |
|---|---|
| `$x^2$` | Inline |
| `$$x^2$$` | Display (block on its own line, inline display mid-paragraph) |
| ` ```math ` fence | Display (multi-line friendly) |
| `\$` | Literal `$` |

**Disambiguation gotcha:** a `$…$` span counts as math only when the body has no whitespace next to the delimiters *and* the closing `$` isn't immediately followed by a digit. So `It costs $5 and $10 total` and `Budget: $200` stay prose without escaping, while `Let $f(x) = 5$ be a function` is math. Use `\$` when the rules would otherwise trip.

Math rides the normal content pipeline — it appears in prerendered HTML, survives `compile('epub')` and `compile('pagedjs')`, and roundtrips through the editor. Component code needs nothing special.

### Lists as navigation menus

Markdown lists model nav, menus, and grouped links. Each list item is a full content object with `paragraphs`, `links`, `icons`, and nested `lists`.

```markdown
- ![](lu-home) [Home](/)          ← content.lists[0], each item.links[0] + item.icons[0]
- ![](lu-book) [Docs](/docs)

- Product                          ← nested: group.paragraphs[0] is the label,
  - [Features](/features)          ←   group.lists[0] holds sub-items
  - [Pricing](/pricing)
```

List items contain HTML strings, not plain text — render them with Kit components:

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

**For richer navigation** with icons, descriptions, or hierarchy, use a `yaml:nav` tagged block:

````markdown
```yaml:nav
- label: Dashboard
  href: /
  icon: lu:layout-grid       ← note the COLON form here, not the `lu-house` hyphen form
- label: Docs                   used in markdown image syntax
  href: /docs
  icon: lu:book-open
  children:
    - label: Getting Started
      href: /docs/quickstart
```
````

Access: `content.data?.nav` — an array of `{ label, href, icon, text, children, target }`. Components can support both modes: use `content.data?.nav` when provided, fall back to `website.getPageHierarchy()`. Full pattern: `reference/navigation-patterns.md`.

---

## Semantic Theming

Components use **semantic CSS tokens** instead of hardcoded colors. The runtime applies a context class (`context-light`, `context-medium`, `context-dark`) to each section from its `theme:` frontmatter. The value is also available as `params.theme`, for the rare case where a component needs logic beyond CSS tokens (switching between a light and dark logo, say).

```jsx
<h2 className="text-slate-900">...</h2>   // ❌ Hardcoded — breaks in dark context
<h2 className="text-heading">...</h2>     // ✅ Semantic — adapts to any context and brand
```

**Semantic tokens** (available as Tailwind `text-*`, `bg-*`, `border-*` classes):

| Token | Purpose |
|-------|---------|
| `heading` | Heading text |
| `body` | Body text |
| `subtle` | Secondary/de-emphasized text |
| `section` | Section background |
| `card` | Card/panel/well background |
| `muted` | Hover states, zebra rows |
| `border` | Lines, dividers |
| `ring` | Focus indicators |
| `link` / `link-hover` | Link colors |
| `primary` / `primary-foreground` / `primary-hover` / `primary-border` | Primary actions |
| `secondary` / `secondary-foreground` / `secondary-hover` / `secondary-border` | Secondary actions |
| `success` / `warning` / `error` / `info` | Status colors |
| `success-subtle` / `warning-subtle` / `error-subtle` / `info-subtle` | Status backgrounds (alerts) |

**Palette shades** are also available — `text-primary-600`, `bg-neutral-100`, `border-accent-300` — 11 shades (50–950) per palette color (primary, secondary, accent, neutral). See `theme-tokens.css` for the complete mapping.

**Authors control context** via `theme: dark` in frontmatter, alternating `light` (default), `medium`, and `dark` across sections for visual rhythm. **The three presets aren't the limit** — the object form overrides any token per section:

```yaml
theme:
  mode: light
  section: neutral-100               # Subtle off-white surface
  card: neutral-50                   # Cards lighter than surface
  primary: neutral-900               # Dark buttons instead of brand color
```

`background:` also accepts CSS variables and hex, so authors can alternate `var(--neutral-50)` / `var(--primary-50)` surfaces with no component code. If a source design uses subtle surface variations (`--surface-base` vs `--surface-sunken`), map those to backgrounds or token overrides in frontmatter — not to component code.

### Section context vs site scheme

Uniweb splits what other frameworks fuse into one "dark mode":

- **Section context** — the `theme:` field on one section (`light`/`medium`/`dark`). Per-section, author-controlled.
- **Site scheme** — the global light/dark preference under `appearance:` in `theme.yml`. The site-wide toggle a visitor flips.

They compose rather than fight: a section with **no `theme:`** inherits the site scheme and follows the toggle; a section that **pins** `theme: dark` stays dark in either scheme. A dark site can carry one bright white CTA. You never write `isDark ? … : …` — semantic tokens adapt to whichever scheme and context resolve around them.

```yaml
appearance:
  default: light                # 'light' | 'dark' | 'system'
  allowToggle: true             # offer a visitor switch (also generates the dark tokens)
  respectSystemPreference: true # first visit follows the OS; false pins `default`
  schemes: [light, dark]        # optional — declares the available set
```

Shorthands: `appearance: light` / `dark` (fixed, no toggle), `appearance: system` (follow the OS).

A site **has dark mode** whenever it offers a toggle, defaults to `dark`/`system`, or lists `dark` in `schemes:`. Precedence: a stored choice wins over the OS, which wins over `default:`. Note that `default: light` is a *fallback*, not a guarantee — a dark OS still wins on first visit unless `respectSystemPreference: false`. (`default: system` is just the honest way to say "there is no fixed default — use the OS.")

| Goal | `theme.yml` |
|---|---|
| Always light, no switch | `appearance: light` |
| Always dark, no switch | `appearance: dark` |
| Toggle, follow the OS on first visit | `appearance: { default: system, allowToggle: true }` |
| Toggle, but always start light | `appearance: { default: light, allowToggle: true, respectSystemPreference: false }` |

**Rendering a toggle.** The runtime resolves the scheme and applies it to `<html>` (`scheme-dark`/`scheme-light`) *before the page paints* — never touch `localStorage` or `document` yourself, and there's no flash of the wrong scheme. A section type only renders the button:

```jsx
import { useAppearance } from '@uniweb/kit'

function SchemeToggle() {
  const { scheme, toggle, canToggle } = useAppearance()
  if (!canToggle) return null            // hidden unless the site enables toggling
  return <button onClick={toggle}>{scheme === 'dark' ? 'Light' : 'Dark'}</button>
}
```

**Tailwind `dark:` variant.** If your foundation uses `dark:` utilities, bind them to the site scheme so they track the toggle. In `styles.css`:

```css
@custom-variant dark (&:where(.scheme-dark, .scheme-dark *));
```

Without this, `dark:` falls back to `@media (prefers-color-scheme: dark)` and ignores the site's setting. Prefer semantic tokens over `dark:` where you can — they adapt to per-section context, which a global `dark:` cannot.

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

appearance: { default: light, allowToggle: true }

fonts:
  heading: "'Inter', system-ui, sans-serif"
  body: "'Inter', system-ui, sans-serif"

inline:
  callout: { color: var(--accent), font-weight: '600' }

vars:
  radius: 0.75rem
```

Each color generates 11 OKLCH shades (50–950); shade 500 is your exact input. `neutral` takes a named preset rather than hex. Context override keys match token names: `section:` not `bg:`, `primary:` not `btn-primary-bg:`.

**How colors reach components:** your hex → 11 shades → semantic tokens → components. In light/medium, `--primary` uses shade 600, `--link` 600, `--ring` 500; in dark, `--primary` uses 500 and `--link` 400.

**Buttons use shade 600 — darker than your input color.** That's an accessibility choice for contrast with white text. For brand-exact buttons:

```yaml
colors: { primary: "#E35D25" }
contexts:
  light:
    primary: primary-500         # Your exact color on buttons
    primary-hover: primary-600
```

> **Contrast warning:** bright brand colors (orange, yellow, light green) at shade 500 may fail WCAG 4.5:1 against white text. Test for readability — if contrast is insufficient, keep the default 600 mapping.

### Fonts

Font families are a **site** setting, under `fonts:` in `theme.yml`. A foundation never installs a font package (no `@fontsource/*`) and never hardcodes a family — if you reach for either, you're off the paved path. Three roles are wired onto standard elements for you:

| Role | Wired onto | Typical use |
|---|---|---|
| `body` | `body` (all text by default) | paragraphs, UI |
| `heading` | `h1, h2, h3` | titles |
| `code` | `code, pre, kbd, samp` | code, monospace |

(`code` was previously named `mono`; `fonts.mono` is no longer an alias — rename it.)

Because the site wires families onto real elements, **the norm is that a foundation doesn't set fonts itself** — render semantic markup (`<H1>`, `<P>`, `<code>` from the kit) and the roles apply. Everything else stays Tailwind.

**In a component, weight is yours; family is the site's.** Weight/size/style utilities (`font-bold`, `italic`, `text-xl`) are ordinary design vocabulary. A font-**family** utility is different: `font-sans`/`font-serif` resolve to Tailwind's built-in stacks unless the foundation makes them site-controlled, so a bare `font-serif` silently hardcodes a typeface.

**When a design needs typefaces the three roles can't express** — an editorial serif, a display face for hero titles — declare each as a **font var** in `main.js`. A `font-*`-named var is recognized as a typeface automatically (no `type` needed); a bare-named one takes `type: 'font'`. Either way the site loads and owns the family:

```js
// foundation src/main.js
export const vars = {
  'font-serif': {
    default: 'ui-serif, Georgia, serif',
    description: 'Editorial serif — blurbs, taglines, quotes',
    applyTo: ['blockquote', '.tagline'],   // framework emits the rule, like a built-in role
  },
  'font-display': {
    default: 'ui-sans-serif, system-ui, sans-serif',
    // no applyTo → the component wires it (a `font-display` utility, or var(--font-display))
  },
}
```

The `fonts:` block takes **any** role name, built-in or foundation-added, so a site sets its whole type system in one place. The three roles are defaults you can **retarget** too — redeclaring a role's var with a new `applyTo` changes which elements it paints, while the site still owns the family.

```yaml
# site/theme.yml — loading, hosted or self-hosted; both config-only, no dependency
fonts:
  heading: "Poppins, sans-serif"
  serif: '"Fraunces", Georgia, serif'      # a foundation-declared role, set by name
  import:
    - url: "https://fonts.googleapis.com/css2?family=Poppins:wght@600;700"
  faces:
    - { family: "Fraunces", src: /fonts/fraunces.woff2, weight: "100 900" }
```

The build auto-adds preconnect hints for imports, emits `@font-face` + preload for faces, and drops any family no role references.

> **`serif` and `font-serif` are the same font var** — the `font-` spelling is just the one Tailwind's `font-serif` utility reads. Declare it either way in `main.js` (`vars: { serif: … }` works identically); the site sets it by the bare role name under `fonts:`.

> The `code` role owns `--font-code`. Tailwind's `font-mono` utility (which reads `--font-mono`) is a **separate** concern — control it by declaring your own `font-mono` font var. So `fonts.code` styles code without disturbing `font-mono`-styled labels, and vice-versa.

### Foundation variables

Most customization belongs in component params — both section and layout components declare their own in `meta.js`. A header height is a layout param, not a foundation var.

Foundation-level CSS variables are for values that must stay consistent **across** multiple components: shared radii, spacing scales, extra typefaces. Declare them in **`main.js`**, the single source of truth:

```js
export const vars = {
  'radius-lg': { default: '1rem', description: 'Large border radius' },
  'section-padding-y': { default: 'clamp(4rem, 6vw, 7rem)', description: 'Vertical section padding' },
}
```

Each entry ships the default as a CSS custom property (so `var(--section-padding-y)` resolves everywhere), gives the visual editor a description and type, and is what a site overrides under `vars:` in `theme.yml`. You don't declare these anywhere else — the defaults reach the browser on their own, in dev and production, bundled or runtime-loaded.

A `styles.css` `@theme` block is a different tool: it registers a token so **Tailwind generates utilities** from it (`@theme { --breakpoint-xs: 30rem }` → `xs:` variants). Use it to extend Tailwind's vocabulary, not to ship a plain default.

**A name matching a Tailwind namespace is an intentional override.** A var named after a Tailwind v4 scale — `radius-*`, `shadow-*`, `spacing`, `font-*` — redefines that scale wherever the matching utility appears: declaring `radius-lg` retunes every `rounded-lg` in the foundation. That's the point when you mean it — name deliberately so you don't reshape a utility by accident.

### Design richness beyond tokens

Tokens handle context adaptation — the hard problem. **They are a floor, not a ceiling.** A great foundation adds design vocabulary on top:

```css
.border-subtle { border-color: color-mix(in oklch, var(--border), transparent 50%); }
.text-tertiary { color: color-mix(in oklch, var(--body), var(--subtle) 50%); }
```

These compose with tokens — they adapt per context because they reference token variables — while adding nuance the token set doesn't provide. Use palette shades directly (`var(--primary-300)`, `bg-neutral-200`) for fine-grained control. **The priority: design quality > portability > configurability.**

---

## Component Development

You're not building pages — you're building a **system** of section types authors compose into pages. Name by purpose, not content: `Testimonial` not `WhatClientsSay`, `SplitContent` not `AboutSection`. Expect consolidation: a React site with 30+ components typically maps to 8–15 Uniweb section types.

### Props interface

```jsx
function MyComponent({ content, params, block }) {
  const { title, paragraphs, links, items } = content   // Guaranteed shape
  const { columns, variant } = params                   // Defaults from meta.js
  const { website } = useWebsite()                      // Or block.website
}
```

All non-reserved frontmatter fields become `params`. Reserved: `type`, `preset`, `input`, `data`, `id`, `background`, `theme`, `source`, `where`. Everything else flows through.

### Rendering content with Kit

Content fields are **HTML strings** — they contain `<strong>`, `<em>`, `<a>` from markdown. **Never render them with raw `{content.title}` in JSX** — that shows HTML tags as visible text. Use Kit components:

```jsx
import { H1, H2, H3, P, Span } from '@uniweb/kit'

<H1 text={content.title} className="text-heading text-5xl font-bold" />
<H2 text={content.subtitle} className="text-heading text-2xl" />
<P text={content.paragraphs} className="text-body" />
<Span text={listItem.paragraphs[0]} className="text-subtle" />
```

Kit provides `H1`–`H6`. These render their own HTML tag — **don't wrap them**: `<H2 text={…} />`, not `<h2><H2 text={…} /></h2>`.

**Full content rendering** (article/docs sections where the author controls the flow):

```jsx
import { Section, Prose } from '@uniweb/kit'

<Section block={block} width="lg" padding="md" />
<Prose content={content} block={block} />
```

`Prose` renders from the parsed sequence — headings, paragraphs, images, snippets, lists — with prose typography. Tagged data blocks are **skipped**; access them via `content.data` for custom rendering. Pass `content` (needs `.sequence`), and `block` too if the content uses insets. Also works as a pure typography wrapper: `<Prose>{children}</Prose>`.

`Article` is an older alternative rendering from `block.rawContent` (raw ProseMirror), including data blocks. Prefer `Prose` for new components.

### Kit API by use case

**Text:** `H1`–`H6`, `P`, `Span`, `Div`, `Text` (with `as`)
**Content:** `Section`, `Prose`, `Article`, `Render` (ProseMirror → React), `ChildBlocks`
**Media:** `Visual` (first non-empty: inset/video/image), `Image`, `Media`, `Icon`
**Navigation:** `Link` (`to`/`href`, `to="page:about"` for page-ID resolution, auto `target="_blank"` for external, `reload` for full page load), `useActiveRoute()`, `useWebsite()`, `useRouting()`
**Header/layout:** `useScrolled(threshold)`, `useMobileMenu()`, `useAppearance()`
**Layout helpers:** `useGridLayout(columns, { gap })`, `useAccordion({ multiple, defaultOpen })`, `useTheme(name)`
**Theming data:** `useThemeData()`, `useColorContext(block)`
**Utilities:** `cn()`, `Link`, `Image`, `Asset`, `SafeHtml`, `SocialIcon`, `filterSocialLinks(links)`, `getSocialPlatform(url)`
**Other styled:** `SidebarLayout`, `Code`, `Alert`, `Table`, `Details`, `Divider`, `Disclaimer`

```js
useActiveRoute()        → { route, rootSegment, isActive(pageOrRoute), isActiveOrAncestor(pageOrRoute) }
useMobileMenu()         → { isOpen, open, close, toggle }   // auto-closes on route change
useScrolled(threshold?) → boolean                            // true past threshold (px)
useAppearance()         → { scheme, setScheme, toggle, canToggle, schemes }
useWebsite()            → { website }
useThemeData()          → Theme                              // programmatic color access
useColorContext(block)  → 'light' | 'medium' | 'dark'
```

> **`cn()` gotcha — a later `text-<size>` silently drops an earlier `leading-*`.** Tailwind's size classes set line height too, so `cn()` treats the size as replacing the leading: `cn('leading-[1.1] text-4xl')` → `text-4xl`. Put the size first, or fold the leading into it (`text-[clamp(2rem,5vw,4rem)]/[1.1]`). Most likely to bite when the size comes from a lookup and the leading sits in a shared base string.

### Icon component

```jsx
{content.icons.map((icon, i) => <Icon key={i} {...icon} />)}   // From content
<Icon name="search" />                                          // Lucide (default)
<Icon name="hi2-arrow-right" />                                 // Other library by prefix
<Icon name="close" />                                           // Built-in (no network)
```

Built-ins (instant, no network): `check`, `close`, `menu`, `chevronDown`, `chevronRight`, `externalLink`, `download`, `play`, and a few others. Other props: `svg`, `url`, `size` (default `'24'`), `className`.

### Section wrapper

The runtime wraps every section in `<section>` with context class and background. Customize with static properties:

```jsx
function Hero({ content, params }) {
  return <div className="max-w-7xl mx-auto px-6">…</div>
}

Hero.className = 'pt-32 md:pt-48'   // adds classes to the runtime wrapper
Hero.as = 'div'                      // changes the wrapper element
export default Hero
```

**Layout components typically need `p-0`** to suppress default padding:

```jsx
Header.className = 'p-0'
Header.as = 'header'
```

### meta.js

```javascript
export default {
  title: 'Feature Grid',
  description: 'Grid of feature cards with icons',
  category: 'marketing',
  // hidden: true,          // Exclude from export entirely (internal helpers)
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

  // context / initialState: keys are developer-defined, not framework fields.
  context: {},        // Static — neighbors read via getNextBlockInfo().context
  initialState: {},   // Dynamic — neighbors read .state; component updates via useBlockState()
}
```

**All defaults belong in `meta.js`, not inline in component code.**

### The Front Desk pattern

Section types naturally use params to adjust their own rendering — that's the baseline, not a pattern. The **Front Desk pattern** is when a section type does virtually no rendering itself: it reads the author's params, picks the right helper component, and translates author-friendly vocabulary into developer-oriented props.

The workers behind the desk need not share an interface. A `Hero` might delegate to a `SliderHero` (image carousel) and a `ContactHero` (quote form) expecting different content and props. The front desk declares the **union** of what its workers need — some content goes unused for a given variant, which is normal.

```jsx
// sections/Hero/index.jsx — the front desk
const variants = { slider: SliderHero, contact: ContactHero }

export default function Hero({ content, block, params }) {
  const Variant = variants[params.variant] || SliderHero
  return (
    <Variant
      title={content.title} subtitle={content.paragraphs[0]} links={content.links} block={block}
      images={content.images}                                 // only some variants use these
      formData={content.data?.quote}
      interval={params.slideInterval}                         // author vocabulary → developer props
      compact={params.density === 'compact'}
      transition={params.style === 'dramatic' ? 'zoom' : 'fade'}
    />
  )
}
```

This is the system-building pattern at its clearest: **section types are the public interface** (author-friendly names, documented in `meta.js`); **helper components are the implementation** (ordinary React props). The section type is the thin translation layer.

More generally, a section component is rarely a flat render — it imports helpers from `components/` and utilities from `utils/` to build complex UI behind a single `type:`. Those directories are the developer's workbench: ordinary React, not author-selectable, not auto-discovered.

**When to reach for this pattern:** when a page type has consistent structural elements — header bars, navigation footers, contextual sidebars — that the content author shouldn't have to add as separate sections. If the author would otherwise repeat the same boilerplate sections on every page of a given type, the section component should compose them internally.

**Common mistake:** solving structural repetition at the layout level. If only some page types need a content header (lessons do, the homepage doesn't), that's a section concern. The layout owns page-wide chrome; the section owns its internal structure.

### Foundation organization

```
src/                     # the foundation package (folder name is `src`)
├── sections/            # Section types (auto-discovered)
│   ├── Hero.jsx         # Bare file — no folder needed
│   ├── Features/        # Folder when you need meta.js
│   │   ├── index.jsx
│   │   └── meta.js
│   └── insets/          # Organizational subdirectory (lowercase)
├── layouts/             # Custom layouts (optional, auto-discovered)
├── components/          # Your React components (no meta.js, not selectable)
├── utils/               # Helper functions, non-React logic
├── main.js
├── styles.css
└── package.json         # name: "src"
```

**Discovery:** PascalCase files/folders at the root of `src/sections/` are auto-discovered. Nested levels require `meta.js`. Lowercase directories are organizational only. `hidden: true` excludes a component entirely. Everything outside `src/sections/` is ordinary React.

**Source root.** The foundation package's source lives at the package root — the `src/` folder *is* the foundation. The build reads `package.json::main` (for new scaffolds, `main: "./_entry.generated.js"`). Older foundations nest source in `foundation/src/` with `main` pointing at `./src/_entry.generated.js`; both work through the same code path.

**Import aliases.** Foundations include subpath imports for shared internals — use them instead of brittle relative paths:

| Alias | Maps to | Use for |
|-------|---------|---------|
| `#components/*` | `./components/*` | Shared React components |
| `#utils/*` | `./utils/*` | Helper functions, non-React logic |

```jsx
import LessonHeader from '#components/LessonHeader'      // ✅
import LessonHeader from '../../components/LessonHeader' // ❌ breaks if you reorganize sections/
```

Within the same directory, use normal relative imports (`./AIFeedbackCard`).

**Foundation entry (`main.js`).** A single `export default { … }` whose top-level keys are the capabilities the foundation provides — `name`, `description`, `defaultLayout`, `defaultSection`, `viewTransitions`, `props`, `defaultInsets`, `xref`, `outputs`, `handlers` — plus an optional named `vars` export. Section types and layouts are auto-discovered and merged in by `@uniweb/build`. The build wraps your default export under `default.capabilities` in `dist/entry.js`; you never write that wrapper. The one place it matters: when you import your **own** `main.js` from a component (e.g. a download button calling `compileDocument(website, { foundation })`), you get the bare default object — pass it through directly, Press handles both shapes.

### Custom layouts

Layouts live in `layouts/` inside the foundation and are auto-discovered. Set `defaultLayout` in `main.js`.

```jsx
// layouts/DocsLayout/index.jsx
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

**Layout meta.js** declares areas and optional scroll behavior: `{ areas: ['header', 'footer', 'left'], scroll: 'self' }`. Area names are arbitrary. `scroll` controls scroll restoration: unset = runtime manages `window` (default), `'self'` = the layout scrolls itself, or a CSS selector (`'main'`) = runtime manages that element.

**Layout content** lives in `site/layout/` — `header.md`, `footer.md` for the default layout, or a named subdirectory (`site/layout/marketing/`) for named layouts. Named subdirectories are self-contained — no inheritance. Cascade: `page.yml` → `folder.yml` → `site.yml` → foundation `defaultLayout` → `"default"`.

Layout sections are regular section types — they support the full content shape, including tagged data blocks, lists, links, and items. The only difference is they render on every page. Each content category takes a different role:

````markdown
---
type: Header
---
# Acme Inc                              ← content.title — the logo

- ![](lu-search) [How It Works](/how)   ← content.lists[0] — the nav
- ![](lu-book) [Docs](/docs)

[Get Started](/docs/quickstart)         ← content.links[0] — the CTA

```yaml:config
github: https://github.com/acme         ← content.data.config — everything else
```
````

```jsx
function Header({ content }) {
  const logo = content.title
  const navItems = content.lists[0] || []
  const cta = content.links[0]
  const config = content.data?.config
}

function Footer({ content }) {
  const tagline = content.paragraphs[0]      // a plain paragraph
  const columns = (content.lists[0] || []).map(group => ({
    label: group.paragraphs[0],              // nested list → columns
    links: group.lists[0]?.map(item => item.links[0])
  }))
}
```

### Cross-block communication

Section types sometimes coordinate — the typical case is a Header that needs to know whether the section below supports a floating translucent overlay. The section that **owns the capability declares it**; the section that **needs to adapt reads it**. `getNextBlockInfo()` (and `getPrevBlockInfo()`, `page.getFirstBodyBlockInfo()`) expose two channels:

- **`context`** — static capabilities from `meta.js`. Never changes.
- **`state`** — dynamic runtime state via `useBlockState()`. Initial value from `initialState` in `meta.js`.

```js
// Hero/meta.js
export default {
  context:      { allowTranslucentTop: true },   // "I always support this"
  initialState: { allowTranslucentTop: true },   // …or start true and let logic change it
}
```

```jsx
// Hero/index.jsx — dynamic case
const [state, setState] = block.useBlockState(useState)

// Header/index.jsx — reads dynamic state, falls back to static context
const info = block.getNextBlockInfo()
const isFloating = info?.state?.allowTranslucentTop ?? info?.context?.allowTranslucentTop ?? false
```

The key names are yours to design — they're not framework fields.

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
| `block.rawContent` | object | ProseMirror document — passed internally by `<Article block={block} />` |
| `block.themeName` | string | `"light"`, `"medium"`, `"dark"` |
| `block.stableId` | string | Stable ID from filename or `id:` |
| `block.key` | string | Unique key across pages (path + id) — use as React key |
| `block.path` | string | Page route this block belongs to |

### Website and Page APIs

```jsx
const { website } = useWebsite()
const page = website.activePage

// getPageHierarchy(options) →
//   [{ id, route, navigableRoute, translatedRoute, title, label, description, hasContent, version, children }]
// Options: for: 'header'|'footer'|<area> (respects hideIn) · nested: true (default)
//          includeHidden: false · filter: (page) => bool · sort: (a, b) => number
website.getPageHierarchy({ for: 'header' })      // = website.getHeaderPages()
website.getPageHierarchy({ nested: false })      // = website.getAllPages()

website.name, website.basePath
website.hasMultipleLocales(), website.getLocales(), website.getActiveLocale(), website.getLocaleUrl('es')

page.title, page.label, page.route, page.description
page.isHidden(), page.showInHeader(), page.showInFooter()
page.hasContent()          // true if the page has its own content (not just a folder)
page.hasChildren(), page.children, page.parent
page.getNavigableRoute()   // first descendant route with content (for linking)
```

Content-less containers appear as group nodes (`hasContent: false`) — use `navigableRoute` for links, `title` for display, `hasContent` to style differently.

---

## Composition: Items, Child Sections, Insets

Pages are sequences of sections — the obvious layer. The framework also supports real nesting, without leaving markdown.

| Pattern | How authored | Use when |
|---|---|---|
| **Items** (`content.items`) | Heading groups within one `.md` | Repeating content in one section: cards, features, FAQ entries |
| **Child sections** (`block.childBlocks`) | `@`-prefixed `.md` files + `nest:` | Children needing their own section type, rich content, or independent editing |
| **Insets** (`block.insets`) | `![](@Component)` in markdown | Self-contained visuals/widgets: charts, diagrams, code demos |

Does the author write content *inside* the nested element? **Yes** → child sections. **No** (self-contained, param-driven) → inset. Repeating same-structure groups → items. These compose: a child section can contain insets; items work inside children.

### Insets — embedding components in content

Many section types need a "visual" — a hero's illustration, a split-content section's media. Classically an image or video. But what if it's a JSX + SVG diagram, a ThreeJS animation, an interactive playground? Elsewhere you'd reach for MDX or prop-drilling. Here the author writes standard image syntax:

```markdown
![Architecture overview](@NetworkDiagram){variant=compact}
```

The developer builds `NetworkDiagram` as an ordinary React component with `inset: true` in `meta.js`. Kit's `<Visual>` renders the first non-empty candidate, so one section type works whether the author supplies an image, a video, or an interactive component:

```jsx
<Visual inset={block.insets[0]} video={content.videos[0]} image={content.images[0]} className="rounded-2xl" />
```

**Insets are full section types** — they receive `{ content, params, block }`. The alt text becomes `content.title` and attributes become `params`: `![npm create uniweb](@CommandBlock){note="Ready to go"}` → `content.title = "npm create uniweb"`, `params.note = "Ready to go"`.

**Don't use `hidden: true` on insets.** `hidden` means "don't export this component at all" (internal helpers); `inset: true` means "available for `@Component` references in markdown."

### Child sections

You hit a complex layout — a 2:1 split with a panel and a main area. Your instinct says build a specialized component. Step back: the panel is a reusable section type, the main area is another, and the split is a Grid with `columns: "1fr 2fr"`. But hardcoding which components go where means the author can't rearrange or swap them. Child sections solve that:

```
pages/home/
├── page.yml
├── 2-dashboard.md          # Parent section (type: Grid, columns: "1fr 2fr")
├── @sidebar-stats.md       # Child (@ = not top-level)
└── @main-chart.md
```

```yaml
# page.yml
nest:
  dashboard: [sidebar-stats, main-chart]
```

**Rules:**
- `@`-prefixed files are excluded from the top-level section list; `@@` nests deeper (grandchildren)
- `nest:` maps parent name → child names, and is **flat**: `{ features: [a, b], a: [sub-1] }`
- Children are ordered by position in the `nest:` array

```jsx
import { ChildBlocks } from '@uniweb/kit'

export default function Grid({ block, params }) {
  return <div className={`grid grid-cols-${params.columns || 2} gap-6`}><ChildBlocks from={block} /></div>
}
```

`ChildBlocks` renders each child as a **bare component by default** — no wrapper, no context class, no background. That's right for grid cells, tab panels, carousel slides. For the rare case where children should be independent sections with their own theming and backgrounds, pass `wrapAs="div"`.

Each child is a regular section with its own type, params, and content — and you're in the middle: wrap each child, filter by type, reorder, add container classes. The author decides *what* goes in the grid; your component decides *how* it renders. Tomorrow the author can swap a child for a different section type with no code change.

**Data and child blocks:** page-level `data:` is available to all blocks including children, and each child resolves data independently through the page → site hierarchy. If a child needs data, declare it in the child's `meta.js` or its frontmatter (`data: articles`).

**SSG:** insets, `<ChildBlocks>`, and `<Visual>` all render correctly during prerender. Inset components using React hooks internally trigger prerender warnings — expected and harmless; the page renders correctly client-side.

### Dividers — content boundaries

`---` creates a boundary between content regions; the developer decides what each region means. Two patterns:

**UI regions (component).** `splitContent()` from `@uniweb/kit` splits parsed content at divider elements — e.g. lesson prose vs challenge content:

```jsx
const [lesson, challenge] = splitContent(content)
```

**Data-driven iteration (Loom).** Dividers separate header/body/footer in a repeated template. The split happens *before* Loom runs, because each segment gets a different variable context — the body contains item-level fields that don't exist on the top-level data. Header and footer are instantiated once against the full data; the body repeats per item.

```markdown
---
type: CvEntry
source: education
---
# Education
{COUNT OF education} degrees.
---
## {degree}
{institution} — {field} ({start}–{end})
```

**Which to use:** different data contexts per region → Loom pre-parse split (content handler). Same data, different UI treatment → kit post-parse split (`splitContent`). A foundation can use both.

---

## Pages, Backgrounds, and Site Config

### Section backgrounds

Set `background` in frontmatter — the runtime renders it:

```yaml
background: /images/hero.jpg                             # Image
background: /videos/hero.mp4                             # Video
background: linear-gradient(135deg, #667eea, #764ba2)    # Gradient
background: '#1a1a2e'                                    # Color (hex — quote in YAML)
background: primary-900                                  # Palette token (bare name or var())

background:                                              # Object form for more control
  image: { src: /img.jpg, position: center top }
  overlay: { enabled: true, type: dark, opacity: 0.5 }
```

Components that render their own background declare `background: 'self'` in `meta.js`.

### Page organization

```
site/layout/          # header.md, footer.md, left.md — rendered on every page
site/pages/home/
    ├── page.yml      # title, description, order
    ├── 1-hero.md     # Numeric prefix sets order
    ├── 2-features.md
    └── 3-cta.md
```

Decimals insert between: `2.5-testimonials.md` goes between `2-` and `3-`. **Ignored:** `README.md`, and `_*.md` / `_*/` (drafts and private files).

```yaml
# page.yml
title: About Us
id: about                   # Stable identity (for page: links, survives moves)
order: 2                    # Navigation sort position
pages: [team, history, ...] # Child page order (... = rest). Without ... = strict (hides unlisted)
redirect: academic          # Redirect to a child page (relative/absolute path, or URL)
slug: { fr: a-propos }      # Localized URL segment per language

# site.yml
index: home                 # Just set the homepage
pages: [home, about, ...]   # Order pages (... = rest, first = homepage); without ... = strict
```

**Route mapping:** folder structure maps 1:1 to routes. Every folder keeps its natural route — `pages:` controls **order only**, not which child "becomes" the parent. The only exception is the site root, where `index:` (or first in `pages:`) sets `/`.

**Content-less containers:** folders with `page.yml` but no markdown are structural groups (`hasContent: false`). Visiting one auto-redirects to the first descendant with content — this is what supports courses → modules → lessons at any depth.

**Localized URLs:** on a multilingual site (`languages:` in site.yml), `slug: { <lang>: <segment> }` gives a page a native URL segment per language; the folder name stays the canonical route. Nested folders compose automatically, and localized URLs flow through navigation, the language switcher, and the sitemap. `publishLanguages: [en, fr]` lists which declared languages a published build ships — unlisted ones stay dev-previewable drafts (absent = publish all; the default language must be listed).

**SEO & social cards:** set site-wide defaults in `site.yml`; any page overrides per-field in `page.yml` (page wins, site fills gaps). These render into every page's static `<head>` — Open Graph, Twitter Card, canonical, robots — so shares and crawlers see them without running JS. The social `image` is the field most worth setting once at site level.

```yaml
# site.yml
keywords: [components, react, cms]
seo:
  image: /og-default.png
  noindex: false                    # true keeps the WHOLE site out of search

# page.yml
seo:
  image: /og-about.png
  canonical: https://acme.com/about
```

---

## Data

A component on a page with a `data:` or `fetch:` declaration automatically receives that data in `content.data.{key}` — no opt-in in `meta.js`.

**Bound collections always arrive as arrays.** On a list page, `content.data.articles` is the full collection. On a template page (`[slug]/`), the matched record is delivered under the *same* key as a single-element array — the detail section reads `content.data.articles[0]`. When nothing matches, the key is `[]`. The runtime never coerces to a single object and never synthesizes a singular key.

```jsx
function Article({ content, block }) {
  if (block.dataLoading) return <DataPlaceholder />
  const article = content.data.articles?.[0]   // focused record on a [slug] page
  if (!article) return <NotFound />
  return <ArticleView article={article} />
}
```

Components can ignore keys in `content.data` they don't need, the same way unused `params` are ignored. When a record genuinely needs to be a single object, that's the foundation's job — read `[0]`, or reshape once with a `handlers.data` hook.

**Declaring schemas.** `meta.js` declares the schema for each `content.data` key with a single `data:` field — there is no separate `schemas:` key. Each value is a **named ref**, an **inline field map**, or an **inline rich-form** (`{ fields: [...] }`, an editor form). Refs resolve on disk at build time, never fetched: `@/name` (this foundation's `foundation/schemas/`), `@std/name` (shared standards, from `@uniweb/schemas`), `@org/name` (an org's own `@org/schemas` package). The schema is a hint — it supplies field defaults and drives the editor, not delivery, which is default-on. For an explicit opt-out (rare), set `data: false`.

```js
// meta.js
export default {
  data: {
    articles: '@/article',                               // named ref (this foundation)
    authors:  '@std/person',                             // named ref (shared standard)
    pricing:  { tier: { type: 'string', default: '' } }, // inline field map
  },
}
```

A foundation can route a scope to a plain folder of schema files instead of a package via an optional `schemas.config.js` at its root — `export default { '@acme': '../shared/acme-schemas' }`. A routed scope wins over the package convention; `@/` and `@uniweb` are never routable; a routed scope has no package fallback for a missing schema (it errors rather than silently loading a different definition). Per-schema keys override single entries (most-specific wins: file › directory › package).

**Authoring queries.** Fetch declarations accept `where:` (a where-object predicate), `sort:` (e.g. `date desc`), and `limit:`. Whether the source evaluates them or the framework applies them as a runtime fallback is a transport detail controlled by the site's `fetcher.supports:` declaration.

```yaml
# pages/blog/page.yml
fetch:
  collection: articles
  where: { published: true, tags: featured }
  sort: date desc
  limit: 3
```

**Lean lists with `deferred:`.** Collections with heavy fields (article bodies, large nested arrays) can declare `deferred: [body]` in `site.yml`. The cascade payload omits those fields; per-record full files are emitted at `/data/<name>/<slug>.json` (file-based collections) or fetched from an author-declared `detailUrl:` (API-backed). On dynamic-route pages the focused record's full data is delivered automatically; elsewhere components fetch on demand via `useEntityDetail`.

**Component-side fetching.** When a component genuinely needs to fetch on its own (a search box, "load more", a lazy popover), use the kit hooks — `useFetched`, `useCacheEntry`, `useEntityDetail`. They share the framework's cache and dispatcher with declarative fetches; same-key requests dedupe automatically.

**Validate before shipping.** `uniweb validate` checks file-based data against your declared schemas — missing required fields, type/enum/format mismatches, nested fields. Warns by default; `--strict` for a non-zero CI exit. Distinct from `uniweb doctor` (project structure): `validate` checks your *data* against the schemas you *declared*. Remote (`url:`), `ref`/`options`, and rich `sections`-form inputs are reported deferred.

Full model: `reference/data-fetching.md`. Where-object format with examples: `authoring/predicates.md`.

---

## Content Handlers

Content handlers are a transform layer between data assembly and the component, declared in `main.js` and applied to every section in the foundation. The standard content shape is the default; handlers reshape it. All three are optional, run per block, and are error-isolated — a failing handler logs a warning and falls back to default behavior.

| Handler | When it runs | Receives | Returns | Purpose |
|---|---|---|---|---|
| `data` | After data assembly, before content transform | `(data, block)` | New data object, or null | Filter, reshape, or augment assembled data |
| `content` | After the data handler | `(data, block)` | ProseMirror document, or null | Transform raw content (Loom instantiation, template expansion) |
| `props` | After parsing, defaults, and guarantees | `(content, params, block)` | `{ content, params }`, or null | Post-process the final shape before the component sees it |

The `content` handler reads `block.parsedContent.data` and raw ProseMirror from `block.rawContent`, and returns a new ProseMirror document that the framework re-parses through the semantic parser. Returning `null` — or the same reference as `block.rawContent` — signals no change.

> **`block.rawContent` may or may not be wrapped.** Unwrap it defensively — `const doc = block.rawContent?.doc ?? block.rawContent` — before passing it to `instantiateContent` / `instantiateRepeated`. This is the first thing a hand-written handler gets wrong.

**Loom integration** is the most common use: resolving `{placeholder}` expressions against live data. `@uniweb/loom` provides a factory:

```js
import { createLoomHandlers } from '@uniweb/loom'

export default {
  handlers: createLoomHandlers({ vars: (data) => data?.profile?.[0] }),
}
```

`vars` extracts the Loom variable namespace. The returned `content` handler reads the `source` and `where` frontmatter params: without `source` it does simple substitution; with `source` it splits the markdown at `---` dividers and repeats the body per data item. `where` filters the source array first — `type = 'book'` (equality), `year > 1870` (comparison), `refereed` (truthy), `type = 'book' AND refereed` (combination). Aggregates like `{COUNT OF publications}` reflect the filtered set.

For cases the factory doesn't cover, write handlers directly using `Loom`, `instantiateContent`, and `instantiateRepeated` from `@uniweb/loom`.

> **`instantiateContent` resolves `{placeholders}` in text nodes only** — not in link `href`s or other node/mark attributes. So `[{email}](mailto:{email})` fills the visible label but leaves the `mailto:` URL literal. For dynamic URLs, emit the value as plain text and let the component linkify it, or build the href in the handler yourself.

**Reserved frontmatter:** `source` and `where` are convention-level reserved fields — they flow to both `block.properties` (for handler access) and `params` (visible to components), consistent with `background` and `theme`. Components can ignore them. List them in `meta.js` params with descriptions so the editor and schema recognize them.

---

## Tailwind CSS v4

Foundation styles in `styles.css`:

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

**Don't set `scroll-behavior: smooth` globally.** It's a common line in a hand-written `html { … }` reset, and porting one into a foundation breaks navigation. The runtime owns scrolling: it already smooth-scrolls anchor targets itself (`scrollIntoView({ behavior: 'smooth' })`), so the CSS adds nothing there — but it resets and restores scroll on route changes with the two-argument `scrollTo(x, y)`, which *inherits* the property. Route changes then animate their scroll-to-top, and back-button restoration (which scrolls, checks the position on the next frame, and retries) keeps interrupting its own animation. Scope it to a specific scrollable element if you need it; never to `html` or `body`.

**Font smoothing is a per-scheme decision, not a reset.** `-webkit-font-smoothing: antialiased` (macOS only) forces grayscale rasterization, which thins strokes. On dark surfaces that usefully counteracts the bloom of light text on near-black; on light surfaces it costs contrast and makes body text spindly. If you want it, scope it — `.scheme-dark { -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; }` — rather than putting it on `html` the way most CSS resets do.

---

## Migrating From Other Frameworks

Don't port line-by-line. Study the source, then rebuild from first principles. Other frameworks produce far more components than Uniweb needs — expect consolidation, not 1:1 correspondence.

| React / conventional | Uniweb equivalent |
|---|---|
| Props with typed data | Frontmatter params + `meta.js` |
| Component variants via props | `variant` param; Front Desk pattern for complex routing |
| Context / ThemeProvider | `theme:` frontmatter + semantic tokens (automatic) |
| Wrapper/layout components | Section nesting or custom layouts |
| Prop-drilling visuals into containers | Insets — `![](@Component)` rendered via `<Visual>` |
| Content in JSX or `.js` data files | Markdown → parser → `content` prop |
| CSS color tokens / design systems | `theme.yml` → palette shades + semantic tokens |
| `isDark ? ... : ...` conditionals | `text-heading` — context classes handle it |
| Per-component backgrounds | `background:` in frontmatter |
| Multiple near-identical components | One section type + `variant` param, or Front Desk |
| i18n wrapping (`t()` / `<Trans>`) | Locale-specific content directories |

**Approach:** scaffold with `--template none` → use named layouts for different page groups → dump legacy components under `components/` (they're not section types; import them from section types during transition) → create section types one at a time.

**Migration levels:** **0** — paste the original as one section type (routing and dev tooling work immediately). **1** — decompose into section types, consolidating duplicates via `variant` params or Front Desk. **2** — move content from JSX to markdown, so authors can edit without code. **3** — replace hardcoded colors with semantic tokens, so components work in any context.

**The most common mistake** is recreating source colors as CSS custom properties — that bypasses the token system. Instead: primary color → `colors.primary` in theme.yml, neutral tone → `colors.neutral`, context needs → `theme:` frontmatter.

Also: name by purpose, not content (`TheModel` → `SplitContent`, `WorkModes` → `FeatureColumns`), and put UI helpers (buttons, badges, cards) in `components/` with no `meta.js`.

Detail: `development/converting-existing.md`.

---

## Project Structure and Setup

Most projects start as a workspace with two packages:

```
project/
├── src/            # Component developer's domain (the foundation package)
├── site/           # Content author's domain
└── pnpm-workspace.yaml
```

A site is pure content; a foundation is the site's source code — that's why it lives in `src/`. The foundation's `package.json::name` is `src`, symmetric with `site`.

- **Foundation** (developer, `src/`): React components. Those in `src/sections` and `src/layouts` are *section types* — selectable by authors via `type:`, or used for layout areas. Everything in `src/components` is ordinary React, the developer's workbench.
- **Site** (author, `site/`): markdown content + configuration, plus optional collections of structured content and references to external data sources.

**The composition boundary:** authors compose pages from finished section types; developers compose section types from building blocks. The section type is the boundary. Don't expose building-block composition to authors — build complete, self-contained section types that handle their own internal structure.

> Multi-site projects use sub-folders with site/foundation pairs (each gets its own `src/` + `site/`), or segregate them into `foundations/` and `sites/`.

**Always use the CLI to scaffold — never hand-write `package.json`, `vite.config.js`, `entry.js`, or `index.html`.** The CLI resolves correct versions and structure.

```bash
pnpm create uniweb my-project --template <name>   # official template, or --template none / --blank
uniweb add project docs                            # co-located pair → docs/src + docs/site
uniweb add foundation [name|path] [--path parent]  # no name → ./src/, bare name → ./name/, slash → that path
uniweb add site [name|path]
uniweb add extension <name> [--site <name>]        # secondary foundation, wired to a site
uniweb add section Hero [--foundation ui]          # sections/Hero/{index.jsx,meta.js}; dev server picks it up
```

The CLI creates exactly the folder you ask for — no silent nesting. If the target exists or the package name is taken, it stops with a precise error and suggests alternatives (using the same `classifyPackage` logic the build uses, so cross-type collisions are caught). Projects include both `pnpm-workspace.yaml` and npm workspaces — **replace `pnpm` with `npm` in any command here.**

For unfamiliar patterns — data fetching, i18n, layouts, insets, theming — install an official template as a reference project and read its source: `uniweb add project marketing --from marketing`. Templates: `marketing` (tokens, insets, grids, multi-line headings), `docs` (sidebar nav, code highlighting), `dynamic` (live API data, loading states), `international` (i18n, collections, multi-locale routing), `store` (product grids, e-commerce), `academic` (publications, timeline, math), `extensions` (multi-foundation, runtime loading).

---

## Commands

```bash
uniweb dev                        # Start dev server (picks the site for you)
pnpm build / pnpm preview         # Build for production / preview the build (SSG + SPA)

uniweb deploy                     # Wizard: pick a destination, then deploy (or set up CI)
uniweb deploy --host=<adapter>    # Build + upload now, from this machine
uniweb add ci --host=<adapter>    # CI so every push deploys — usually best for a free host
uniweb export                     # Build dist/ for any static host (no Uniweb account)
uniweb publish                    # Ship to Uniweb hosting, foundation included (needs `uniweb login`)

uniweb add ci --target foundation # Publish a foundation for free at permanent versioned URLs
                                  # (GitHub Pages → foundations/<name>/<version>/entry.js)

uniweb push / pull / clone / status   # Git-style content sync with the Uniweb backend
uniweb register [--scope @org]        # Register a foundation + its data schemas to the registry

uniweb rename <foundation|site|extension> <old> <new>   # Rename across the whole workspace
uniweb doctor                     # Diagnose project configuration (--fix to auto-repair)
uniweb validate                   # Check file-based data against declared schemas (--strict for CI)
uniweb update                     # Align @uniweb/* deps + AGENTS.md to the CLI (--dry-run, --yes)
uniweb inspect <path>             # Show parsed content for a section or page (--raw for the AST)

uniweb <command> --help           # Per-command flags — no side effects. Prefer this over guessing.
```

**Choosing where a site goes.** `uniweb deploy` never assumes a host: with nothing configured it opens a picker listing only destinations it can act on, and records the choice in `deploy.yml` so later runs go straight there. For a free static host, prefer `uniweb add ci --host=<adapter>` — one command, then every push deploys, and on Cloudflare Pages / Netlify / Vercel it also adds per-PR previews that comment the URL. Adapters: `github-pages`, `cloudflare-pages`, `netlify`, `vercel`, plus `s3-cloudfront` for `deploy`. Destination config lives in `deploy.yml` beside `site.yml`; host credentials come from the environment, never from that committed file.

**Publishing vs registering.** Foundations on Uniweb hosting live in the catalog as `@org/name@version`. When a foundation powers a single site, **don't run `uniweb register` yourself** — `uniweb publish` from the site directory releases the local foundation to the catalog (when its code changed) and goes live in one step. Register deliberately only when the foundation is a product meant for multiple sites; consuming sites then pin `foundation: '@org/name@1.2.3'`. Schemas can also be registered on their own from a schemas-only package (`@uniweb/schemas`, any `@org/schemas`, or a bare folder of `schemas/*.{yml,json,js}`) — that's how `@std` schemas are published. Auth via `uniweb login`, `--token`, or `UNIWEB_TOKEN`; preview with `--dry-run`.

**Staying current.** `uniweb update` aligns `@uniweb/*` deps and `AGENTS.md` to the CLI that runs it; `uniweb doctor` reports drift without mutating. To pin to the newest release: `npx uniweb@latest update --yes`. The verb won't refresh AGENTS.md while declared deps still lag the CLI, or while edited deps haven't been installed — both would put the doc ahead of the code. Updating the CLI itself is your package manager's job.

### `package.json` `uniweb` block

Platform-specific configuration that doesn't belong in npm-standard fields. All fields optional.

| Field | Where used | Default | Purpose |
|---|---|---|---|
| `id` | `uniweb register` | bare segment of a scoped `name` | The foundation's registered id — the bare name in `@org/<id>`. Decoupled from `package.json::name` (a workspace concern), so renaming on the registry doesn't ripple through site dependencies. |
| `namespace` | `uniweb register` | none | Legacy explicit org-namespace override; equivalent to a scoped `package.json::name`. Rarely needed. |
| `runtimePolicy` | `dist/runtime-pin.json` | `"auto-minor"` | How sites using this foundation receive runtime updates. |

**Runtime policy** (foundation authors only — sites don't set this). At build time a foundation pins the `@uniweb/runtime` version it built against into `dist/runtime-pin.json`, alongside a policy controlling how that version moves forward on already-published sites: `exact` (stay put), `auto-patch` (within `MAJOR.MINOR.x`), `auto-minor` (within `MAJOR.x.y`, the default). Most foundations should leave it unset — the runtime is backwards-compatible at the minor level by convention, so `auto-minor` lets sites pick up fixes without a foundation rebuild. Set `exact` only if you depend on undocumented runtime internals or have audited against one release. Site owners cannot override your choice.

`@uniweb/runtime` arrives **transitively** through `@uniweb/build`, so your foundation pins a runtime version without declaring one — that's intentional. **Don't add `@uniweb/runtime` to your foundation's dependencies**; to bump the pinned version, bump `@uniweb/build`. If the pin is missing or malformed, the platform serves the foundation through its legacy compatibility path — sites still work, they just don't participate in runtime propagation.

---

## Troubleshooting

Most Uniweb failures are **silent** — the build succeeds and the page is wrong. Check these first, because nothing in the terminal will point you at them.

**A red `Component not found: <Type>` box where a section should be** — the `type:` in that section's frontmatter names a section type this foundation doesn't have. `ls src/sections/` for the real list. The build does not fail on this, so it only surfaces by looking at the page.

**A param has no effect** — it isn't declared in that section type's `meta.js` `params:`. Undeclared frontmatter is passed through and ignored rather than rejected. Read the `meta.js` for the real knobs; if the one you want doesn't exist, exposing it is a foundation change.

**A section doesn't appear at all** — the file is `@`-prefixed (a child section, only rendered via `nest:`), or `_`-prefixed (treated as a draft and skipped), or it's a section type nested below the root of `src/sections/` without a `meta.js`, which means it was never discovered.

**Content lands in the wrong field** — a heading became a `subtitle` when you wanted an item, or the reverse. That's the level rule (exactly one level deeper = subtitle; skipping a level, or any body content first, starts items). Run `uniweb inspect <path>` on the file rather than re-deriving it.

Loud failures:

**"Could not load foundation"** — check that `site/package.json` depends on the foundation *by its workspace package name*. For the default layout that's `"src": "file:../src"`; for a co-located project (`docs/src` + `docs/site`) it's `"docs-src": "file:../src"`. The key must match the foundation's `package.json::name`, not the folder it happens to sit in.

**Component not appearing** — verify `meta.js` exists; check for `hidden: true`; rebuild with `cd foundation && pnpm build`.

**Styles not applying** — verify `@source` includes your component paths.

**Prerender warnings about hooks** — components with useState/useEffect show SSG warnings during build in local symlinked mode. Expected and harmless.

**"document is not defined" during build** — your component touches `document`, `window`, or `localStorage` during render rather than inside `useEffect`. **Don't add `typeof document` guards** — use the kit hook instead: dark mode → `useAppearance()`, scroll detection → `useScrolled()`. Kit hooks are SSR-safe by design.

**Content not parsing as expected** — `uniweb inspect pages/home/hero.md` (add `--raw` for the ProseMirror AST), or point it at a folder for a whole page.

---

## Documentation Index

Full documentation: **https://github.com/uniweb/docs** · fetch any page as raw markdown at
`https://raw.githubusercontent.com/uniweb/docs/main/{section}/{page}.md`

| Task | Page |
|------|------|
| Writing page content | `authoring/writing-content.md` |
| Theming and styling | `authoring/theming.md` |
| Where-object predicate format | `authoring/predicates.md` |
| Building components | `development/creating-components.md` |
| Migrating an existing design | `development/converting-existing.md` |
| Kit API (hooks, components) | `reference/kit-reference.md` |
| Content shape reference | `reference/content-structure.md` |
| Component metadata (meta.js) | `reference/component-metadata.md` |
| Site configuration | `reference/site-configuration.md` |
| Data fetching model | `reference/data-fetching.md` |
| Navigation patterns | `reference/navigation-patterns.md` |

| Section | Covers |
|---------|--------|
| `getting-started/` | What is Uniweb, quickstart, templates |
| `authoring/` | Writing content, site setup, collections, theming, translations |
| `development/` | Foundations, component patterns, data fetching, layouts, i18n |
| `reference/` | site.yml, page.yml, content structure, meta.js, kit API, CLI, deployment |

For CLI flags, prefer `uniweb <command> --help` over this file — it's always current.
