# AGENTS.md

## Part 0 — Read this first

A Uniweb project separates **what the site says** from **how it's built**. Content authors write markdown — choosing section types, setting params, composing pages. Component developers build section types that receive pre-parsed content and render it. Neither touches the other's files.

**Why that separation is cheap rather than ceremonial.** Every Uniweb site ships a runtime. A foundation is an ES module that plugs into it — either **standalone** (inlined into the site's own bundle, one self-describing artifact) or **linked** (loaded by URL at runtime as a federated module). Same foundation either way; the packaging is a deploy-time decision, not something your components know about. The runtime owns the content pipeline, section wrapping, backgrounds, theming, light/dark, prerendering, routing, and i18n; it orchestrates rendering and bridges the author's world into yours. Your components receive `{ content, params }` and render. **These are enforced guarantees, not conventions you have to uphold** — so you can drop the defensive code you'd write elsewhere.

| The runtime handles | So components should NOT contain |
|---|---|
| Section backgrounds (image, video, gradient, color, overlay) from `background:` | Background rendering code, `bg-white`/`bg-gray-900` on the wrapper |
| Context classes (`context-light`/`medium`/`dark`) on every section | Theme maps: `const themes = { light: {…}, dark: {…} }` |
| Token resolution — `text-heading` adapts automatically | Conditionals: `isDark ? 'text-white' : 'text-gray-900'` |
| Content parsing with a guaranteed shape | Defensive null checks on content fields |
| Section wrapping in `<section>` with context class | An outer `<section>` with background/theme classes |
| Light/dark scheme resolution before first paint | `localStorage` reads, `typeof window` guards |
| i18n via locale-specific content directories | String wrapping with `t()` or `<Trans>` |

Concretely, the code you don't write: no theme maps, no `isDark ? … : …`, no null checks on content fields, no `t()` wrapping, no per-component background rendering, no SSR guards, no outer `<section>`. A hero that's 200 lines of undifferentiated React elsewhere is a 40-line component plus a markdown file here — and the markdown is editable by someone who has never opened your code.

Components *should* contain: layout (`grid`, `flex`, `max-w-7xl`), spacing (`p-6`, `gap-8`), typography scale (`text-3xl`, `font-bold`), animations, border-radius — anything that stays the same regardless of theme context.

Once content reaches your component, **it's standard React.** Standard Tailwind. Import any library, use any pattern. The `{ content, params }` interface applies only to *section types* (the components authors select in markdown); everything else in your foundation is ordinary React with ordinary props.

You're building a *system* of section types, not individual pages. That's what makes theming, i18n, and multi-site tractable — they're properties of the system rather than things bolted onto each component.

### Route yourself

| Your situation | Start at |
|---|---|
| New or nearly empty project | **Part 1**, then Part 4 |
| Existing project, content task (pages, copy, colors, nav) | **Part 2**, then Part 3 |
| Existing project, component task (new section type, restyle) | **Part 2**, then Part 4 |
| Porting a design from React / Next / a generated site | **Part 1**, then Part 5 → *Migrating* |

### Three commands that replace guessing

```bash
uniweb inspect <path>        # print the parsed content shape of a section or page
uniweb <command> --help      # exact flags, always current — no side effects
uniweb doctor                # diagnose project configuration (--fix to repair)
```

`uniweb inspect` is the important one. Every parse rule in Part 3 is faster to *confirm* than to re-derive, and re-deriving from memory is where agents go wrong. Don't predict the shape — print it.

### The four silent failures

Most Uniweb mistakes do not fail the build. The build goes green, the terminal is clean, and the page is wrong. If you don't look at the page or run `inspect`, you will report success on broken output.

1. **An unknown section type renders a red `Component not found: <Type>` box.** The build does not fail. Never write a `type:` you haven't confirmed exists — see Part 2, step 2.
2. **An undeclared param is accepted and does nothing.** Frontmatter keys no `meta.js` declares are passed through and ignored, not rejected.
3. **Content lands in the wrong field.** A heading becomes a `subtitle` when you wanted an item, or the reverse. That's the level rule (Part 3). `uniweb inspect` settles it.
4. **A section silently doesn't render.** `@`-prefixed files are child sections (only rendered via `nest:`), `_`-prefixed files are drafts, and section types nested below the root of `sections/` without a `meta.js` are never discovered.

### Documentation

This guide covers what you can't derive by reading code. Everything else is in the full documentation — and **you can reach all of it without guessing at URLs.**

**Start at the index.** One address, and it's the only documentation URL worth memorizing:

```
https://www.uniweb.io/llms.txt
```

It lists every documentation page with a one-line description and a fetchable link. Go there whenever your question isn't answered in this file — and *especially* when you don't know whether a feature exists at all. That's where guessing does the most damage: **a 404 on a path you invented tells you your guess was wrong, not that the feature is missing.** Concluding "the framework doesn't support X" from a failed fetch is a mistake worth actively guarding against; the index answers the existence question directly.

Then **follow the link the index gives you** rather than constructing one yourself. The index is the source of truth for where pages live, so it stays correct when the site's URL conventions change. (Pages also serve markdown to any client that sends `Accept: text/markdown`.)

**Clone the repo instead** when you expect several lookups, or may lose network access later:

```bash
git clone --depth 1 https://github.com/uniweb/docs .uniweb-docs   # then gitignore it
```

Same content, greppable, and one network operation instead of many. `grep -ri "deferred" .uniweb-docs` beats any number of fetches while you're still exploring.

Documentation paths in this guide are given bare — `development/creating-components.md` — so they resolve three ways: as a key in the index, as a file in a clone, or at `https://raw.githubusercontent.com/uniweb/docs/main/{path}`.

> **Don't confuse the two doc sites.** `www.uniweb.io/docs` is the **developer** documentation — this is the one you want. `docs.uniweb.app` is the *author-facing* app documentation, written for non-technical people using the visual editor; it won't answer framework questions.

**The table below saves you the round trip** for the tasks that come up most:

| Task | Page |
|------|------|
| Writing page content | `authoring/writing-content.md` |
| Theming and styling | `authoring/theming.md` |
| Authoring collections | `authoring/collections.md` |
| Where-object predicate format | `authoring/predicates.md` |
| Connecting a backend / custom transports | `development/connecting-a-backend.md` |
| Building components | `development/creating-components.md` |
| Schemas in practice | `development/schemas-in-practice.md` |
| Workspace layouts and their wiring | `development/project-structures.md` |
| Migrating an existing design | `development/converting-existing.md` |
| Internationalization (full model) | `development/internationalization.md` |
| Kit API (hooks, components) | `reference/kit-reference.md` |
| Content shape reference | `reference/content-structure.md` |
| Component metadata (`meta.js`) | `reference/component-metadata.md` |
| Site configuration | `reference/site-configuration.md` |
| Data fetching model | `reference/data-fetching.md` |
| Navigation patterns | `reference/navigation-patterns.md` |

For anything not in that table, start at the index. For CLI flags, prefer `uniweb <command> --help` over any of this — it's always current.

---

## Part 1 — Starting a project

**Always use the CLI to scaffold — never hand-write `package.json`, `vite.config.js`, `entry.js`, or `index.html`.** The CLI resolves correct versions and structure; hand-written config is the most common way to end up with a project that can't build.

```bash
npx uniweb create my-project --template marketing
cd my-project && pnpm install
uniweb dev
```

**Choosing a template.** `--template <name>` gives you a working site plus a foundation you can study and edit. `--template none` gives you the same two packages with no content — the right choice when you're building a foundation from scratch or porting a design. `--blank` gives you an empty workspace and assumes you'll add packages with `uniweb add`; use it only if you already know the framework.

Official templates: `marketing` (tokens, insets, grids, multi-line headings), `docs` (sidebar nav, code highlighting), `dynamic` (live API data, loading states), `international` (i18n, collections, multi-locale routing), `store` (product grids, e-commerce), `academic` (publications, timeline, math), `extensions` (multi-foundation, runtime loading).

**npm or pnpm.** Projects include both `pnpm-workspace.yaml` and npm workspaces. Replace `pnpm` with `npm` in any command in this guide.

### What you get

```
my-project/
├── src/            # the foundation — component developer's domain
├── site/           # the site — content author's domain
└── pnpm-workspace.yaml
```

A site is pure content. A foundation is the site's source code — that's why it lives in `src/`. The foundation's `package.json::name` is `src`, symmetric with `site`.

- **Foundation** (`src/`): React components. Those in `sections/` and `layouts/` are *section types* — selectable by authors via `type:`, or used for layout areas. Everything in `components/` and `utils/` is ordinary React and JS: the developer's workbench, not visible to authors.
- **Site** (`site/`): markdown content and configuration, plus optional collections of structured content and references to external data sources.

**The composition boundary.** Authors compose pages from finished section types — choosing types, writing content, setting params. Developers compose section types from building blocks — importing helpers, using libraries, writing JSX. Two different levels of composition, and the section type is the boundary between them. Don't expose building-block composition to authors; build complete, self-contained section types that handle their own internal structure.

### Growing the workspace

```bash
uniweb add project docs                            # co-located pair → docs/src + docs/site
uniweb add foundation [name|path] [--path parent]  # no name → ./src/, bare name → ./name/, slash → that path
uniweb add site [name|path]
uniweb add extension <name> [--site <name>]        # secondary foundation, wired to a site
uniweb add section Hero [--foundation ui]          # sections/Hero/{index.jsx,meta.js}
```

The CLI creates exactly the folder you ask for — no silent nesting under `foundations/` or `sites/`. If the target exists or the package name is taken, it stops with a precise error and suggests alternatives (using the same `classifyPackage` logic the build uses, so cross-type collisions are caught: you can't `add site marketing` when a foundation named `marketing` exists).

`uniweb add section` scaffolds a CCA-proper starter, and the dev server picks it up with no build or install.

### Learn from a working template

**When you're unsure how to implement a pattern — data fetching, i18n, layouts, insets, theming — read a real one instead of guessing.** Install an official template as a second project in your workspace:

```bash
uniweb add project marketing --from marketing
pnpm install
```

That creates `marketing/src/` + `marketing/site/` alongside your project. You don't need to build or run it. Read:

- `marketing/src/sections/` — components with `meta.js`: what content they expect, what params they accept, what presets they define
- `marketing/site/pages/` — real content files, showing the markdown → component mapping
- `marketing/site/theme.yml` and `site.yml` — theming and configuration in practice

This is the highest-bandwidth way to learn the framework, and it works with no network access. Install several if you like; each is independent. To run one: `cd marketing/site && pnpm dev`.

### The loop

```bash
uniweb dev            # from the workspace root; it picks the site for you
pnpm build            # production build (SSG + SPA)
pnpm preview          # preview the production build
```

Markdown, `theme.yml`, and component edits hot-reload. New section types are picked up without a restart.

---

## Part 2 — Working in an existing project

The rest of this guide explains how Uniweb works. This part is what to do *first* when you've been handed a project that already uses it, plus a task.

### 1. Orient — what kind of workspace is this?

**There is no single layout. Read `pnpm-workspace.yaml` first** — its `packages:` globs name the shape in one glance:

| Globs | Layout | What it implies |
|---|---|---|
| `src`, `site` | **single** (the default) | foundation in `src/`, site in `site/` |
| `foundations/*`, `sites/*` | **segregated** | several sites may share one foundation — a foundation edit hits all of them |
| `*/src`, `*/site` | **co-located projects** | one self-contained pair per project: `docs/src` + `docs/site` |
| `extensions/*` (alongside any of the above) | extensions present | extra section types, runtime-loaded — see step 2 |

Those names are convention; the globs are the truth. Full guide with the wiring for each: `development/project-structures.md`.

**A site is any package with a `site.yml` and a `pages/` folder** — a workspace can hold several. Everything below calls yours `<site>/`.

**Find the foundation by following the wiring, not by guessing the folder.** `foundation:` in `site.yml` is a **package name**, not a path, and folder name matches package name only by convention — co-located projects break it deliberately (folder `docs/src`, package `docs-src`). Go from name to folder via the matching `file:` dependency in `<site>/package.json`:

```json
// docs/site/package.json  →  the foundation is at docs/src/
{ "dependencies": { "docs-src": "file:../src" } }
```

If `foundation:` isn't a workspace package name, the source isn't in this repo at all:

| `foundation:` value | What it means | Can you add a section type? |
|---|---|---|
| a workspace package name (`src`, `docs-src`, `marketing`) | source is in this repo — follow the `file:` dep to it | **Yes** |
| a versioned registry ref (`@org/name@1.2.3`) | published; **its source is not in this repo** | **No** — work within the types it offers |
| an `https://…` URL, or `{ url: … }` | same, loaded from that URL | **No** |

A versionless `@org/name` is an error rather than a shorthand — the build rejects it and asks for a version.

> **Foundations are never npm packages.** They're runtime federated modules, not libraries. Don't `npm install` one, and don't add one to `dependencies` by hand. The four supported shapes are exactly the ones above: a workspace sibling, a `file:` dependency, a versioned registry ref, or a full URL.

**Check `paths:` in `site.yml` before going looking for content.** It mounts outside directories into the page tree (`paths: { pages/docs: ../../../docs }`), so a route's markdown may live in another repo or a submodule rather than under `<site>/pages/`.

### 2. Learn this project's vocabulary — before you write anything

**A foundation is a fixed vocabulary of section types, and every project's is different.** Nothing in the framework tells you what a given project offers; you read it — in the foundation folder you resolved in step 1, not a guessed `src/`:

```bash
ls <foundation>/sections/                    # the section types available
cat <foundation>/sections/Hero/meta.js       # what one expects and accepts
```

**Extensions add to that vocabulary.** If `site.yml` carries an `extensions:` list, each entry is a second foundation contributing its own section types, usable by name in exactly the same way. Enumerate their `sections/` too. The primary foundation wins on a name collision, and extensions are checked in declared order.

Each `meta.js` is a catalog entry: `description` (what the type is for), `content:` (what markdown it expects), `params:` (what frontmatter it accepts, with defaults), `presets:` (named param bundles). Read them as a menu — that is what they are. There is no CLI command that lists them; reading the folder *is* the discovery step.

> **Never write a `type:` or a param you haven't confirmed exists.** Both failures are silent (Part 0) — invisible from the terminal, visible only on the page.

### 3. Find your lane

The architecture exists to keep content and code separate. Your task sits in one of them. Decide before you edit, then stay there.

| Task | Lane | Files you touch |
|---|---|---|
| Add / edit / reorder a section on a page | content | `<site>/pages/**` |
| Add a page | content | `<site>/pages/<name>/` |
| Change colors, fonts, light/dark | content | `<site>/theme.yml` |
| Change header, footer, or nav content | content | `<site>/layout/*.md`, or page order in `site.yml` |
| Change how a section type *looks* everywhere | foundation | `<foundation>/sections/<Type>/` |
| Add a new section type | foundation | `<foundation>/sections/<NewType>/` |
| Expose a new knob to authors | foundation | `<foundation>/sections/<Type>/meta.js` + the component |

**If you're on a content task and find yourself wanting to open the foundation, stop.** Usually it means you missed a param the section type already exposes — re-read its `meta.js`. If the knob genuinely doesn't exist, that's a foundation change: say so explicitly rather than quietly crossing the boundary. Editing a section type changes it for every page that uses it — and in a segregated workspace, for **every site in the repo sharing that foundation**, which is exactly the layout chosen when a foundation is the primary deliverable. Check who else depends on it before you edit.

### 4. The loop

```bash
uniweb dev                         # from the workspace root; it picks the site
```

**When you're unsure what shape your markdown produces, don't reason about it — run it.** From the *site* directory (paths resolve against your shell's working directory):

```bash
uniweb inspect pages/home/hero.md              # the parsed content shape
uniweb inspect pages/home/                     # every section on the page
uniweb inspect pages/home/hero.md --full       # include empty fields (matches runtime)
uniweb inspect pages/home/hero.md --sequence   # include the sequence array
uniweb inspect pages/home/hero.md --raw        # the ProseMirror AST
```

This settles any question in Part 3 — whether a heading became a subtitle or an item, whether the parser saw your data block, why `content.title` is an array. One command beats re-deriving the rules.

### 5. Recipes

Paths are relative to the site package you identified in step 1 — `site/` in the default layout, `sites/main/` or `docs/site/` in others.

**Add a section to a page.** `ls <site>/pages/<page>/` to see the existing sections and their numeric prefixes → pick a `type:` from the vocabulary (step 2) → create `<site>/pages/<page>/N-name.md` with frontmatter plus markdown. Use a decimal (`2.5-…`) to slot between existing sections without renaming them.

**Add a page.** Create `<site>/pages/<name>/`, add `page.yml` (at minimum `title:`), add one or more section `.md` files. It gets the route `/<name>` automatically. Only touch `pages:` in the parent `page.yml` / `site.yml` if you need a specific order.

**Change the brand color.** `<site>/theme.yml` → `colors.primary`. One line, and every component follows. Do **not** edit Tailwind color classes in components to change brand color — that is the exact anti-pattern this system removes.

**Change how code blocks look.** `<site>/theme.yml` → `code:`. Name one of Shiki's 65 bundled themes (`code: dracula`), name one per scheme (`code: { light: github-light, dark: github-dark }`), or take a theme and adjust it (`code: { theme: github-dark, background: '#0D0D0D' }`). Hand-picking every syntax colour is possible and is the last thing to reach for.

**Change a nav item.** First check how nav is produced. If `<site>/layout/header.md` lists the links (a markdown list, or a `yaml:nav` block), edit it there. If it doesn't, the Header is generating nav from the page hierarchy — change page titles and order in `site.yml` / `page.yml` instead.

**Update the project's Uniweb dependencies — and this file.** `uniweb update`. One command aligns every `@uniweb/*` dependency *and* refreshes this AGENTS.md together, to the version matrix of the CLI that runs it. Preview with `--dry-run`. **Don't reach for `npm update` / `pnpm update`** — see *Staying current* in Part 5 for why that breaks things quietly.

**Change one section's columns / spacing / variant.** Check that type's `meta.js` `params:` first. If the knob exists, set it in that section's frontmatter and you're done, in the content lane. If it doesn't, it's a foundation change — see the warning in step 3.

---

## Part 3 — The content lane

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

**A section with no `type:` renders through the foundation's default section type — a component named `Section`, unless the foundation's `main.js` sets `defaultSection` to something else.** This is what lets a folder of plain markdown with no frontmatter at all become pages: mounted documentation, an imported wiki, anything written before it met this framework. If such content renders blank, the foundation has no `Section` — that, not the markdown, is what to fix.

**Markdown order ≠ rendering order.** The parser extracts content into a flat structure; the component decides how to arrange it visually. Write markdown in semantic order, not visual order — start with the heading, then add icons, images, and text in any order.

**Placing content *before* the first heading changes the parse:** headings after body content become items, not the section title. This is by design — it's how repeating content groups are created.

### The parsed object

The semantic parser produces a flat, guaranteed structure. No null checks needed — empty strings and arrays when content is absent:

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
  lists: [],        // [[{ paragraphs, links, lists, … }]] — each item is an object, not a string
  quotes: [],       // Blockquotes
  snippets: [],     // Fenced code — [{ language, code }]
  data: {},         // From tagged data blocks (```yaml:tagname, ```json:tagname)
  headings: [],     // Headings after subtitle, in document order
  items: [],        // Each has the same flat structure — from headings after body content
  sequence: [],     // All elements in document order
}
```

> **Don't predict this — print it.** `uniweb inspect <path>` shows the actual parsed shape of any section or page. The rules below are the ones most often gotten wrong from memory.

### Markdown → content, side by side

```markdown
### Eyebrow                    │  content.pretitle = "Eyebrow"
# Our Features                 │  content.title = "Our Features"
## Build better products       │  content.subtitle = "Build better products"
                               │
We help teams ship faster.     │  content.paragraphs[0] = "We help teams…"
                               │
[Get Started](/start)          │  content.links[0] = { href: "/start", label: "Get Started" }
                               │
### Fast                       │  content.items[0].title = "Fast"
![](lu-zap)                    │  content.items[0].icons[0] = { library: "lu", name: "zap" }
Lightning quick.               │  content.items[0].paragraphs[0] = "Lightning quick."
                               │
### Secure                     │  content.items[1].title = "Secure"
![](lu-shield)                 │  content.items[1].icons[0] = { library: "lu", name: "shield" }
Enterprise-grade security.     │  content.items[1].paragraphs[0] = "Enterprise-grade…"
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
const allData = {}
for (const el of content.sequence) {
  if (el.type === 'dataBlock') allData[el.tag] = el.data
}
```

Grouped fields and `sequence` are two interpretations of the same content. Grouped suits structured layouts (cards, features); sequential suits prose and cross-group searching.

### Choosing how to model content

The decision rule: **would a content author need to change this?** Yes → markdown, frontmatter, or a tagged data block. No → component code.

Start with the content, not the component. Write the markdown an author would naturally write, check what shape the parser produces (`uniweb inspect <file>`), *then* build the component to receive it. You have three layers, and most of the design skill is choosing between them:

**Pure markdown** — headings, paragraphs, links, images, lists, items. The default. If the content reads naturally as markdown and the parser captures it, stop here.

**Frontmatter params** — `columns: 3`, `variant: centered`. Configuration an author might change but that isn't *content*. Would changing this alter the section's *meaning* or just its *presentation*? Presentation → param. Meaning → content.

**Tagged data blocks** — for content that doesn't fit markdown patterns: products with SKUs, team members with roles, event schedules, form definitions. When information is genuinely structured data that an author still owns, a well-named block (`yaml:pricing`, `yaml:speakers`) is clearer than contorting markdown. Formats: `yaml` and `json`. Parsed at build time into `content.data.tagName`.

Read the markdown out loud. If an author would understand what every line does, you've chosen right. The moment markdown feels like it's encoding data rather than expressing content, step up to a tagged block.

**When you are building the foundation, you are designing these, not choosing from a menu.** The examples in this guide illustrate patterns, not exhaustive inventories. Any param name works in `meta.js`, any tag name works for data blocks, any section type name works. The framework has fixed mechanisms (content shape, context modes, token system); nearly everything else is yours to define.

**When you are writing content against a foundation that already exists, the opposite holds.** The vocabulary is fixed and finite: the section types are exactly what `sections/**` declares, and their params are exactly what each `meta.js` lists. Inventing a name there doesn't extend the system — it renders a red `Component not found` box on a build that otherwise reports success.

**Parameter naming matters.** Would an author understand it without reading code? `columns: 3` yes, `gridCols: 3` no. `variant: centered` yes, `renderMode: flex-center` no. `align: left` yes, `contentAlignment: flex-start` no.

### Icons

Image syntax with a library prefix — **two interchangeable spellings, the same everywhere** (markdown, and Kit's `<Icon name>`):

```markdown
![](lucide:house)     colon + friendly name — every library
![](lu:house)         colon + short code
![](lu-house)         dash — short codes only, to stay unambiguous with ordinary paths
```

Short codes: `lu` (Lucide), `hi` / `hi2` (Heroicons v1 / v2), `fi` (Feather), `pi` (Phosphor), `tb` (Tabler), `bs` (Bootstrap), `md` (Material), `ai` (Ant Design), `ri` (Remix), `si` (Simple Icons), `io5` (Ionicons), `bi` (Boxicons), `vsc` (VS Code), `wi` (Weather), `gi` (Game), `fa` / `fa6` (Font Awesome 5 / 6). Browse at [react-icons.github.io/react-icons](https://react-icons.github.io/react-icons/).

Optional attributes: `{size=20}`, `{color=red}`. Custom SVGs: `![Logo](./logo.svg){role=icon}` (or `![Logo](icon:./logo.svg)`) — always available, no library needed.

### Links and media attributes

```markdown
[text](url){target=_blank}              <!-- Open in new tab -->
[text](./file.pdf){download}            <!-- Download -->
![alt](./img.jpg){role=banner}          <!-- Role determines array: images, icons, or videos -->
```

**Quote values containing spaces:** `{note="Ready to go"}`, not `{note=Ready to go}` — unquoted values end at the first space.

**Separators are forgiving.** `:` works wherever `=` does, and pairs may be separated by whitespace, a comma, or both — `{role=banner width=1200}`, `{role:banner, width:1200}` and `{role:banner,width:1200}` are identical. `=` and spaces are canonical, and that is what gets written back on save. Two rules keep it unambiguous: the separator must **touch** the key (`{note:warning}` is one pair, `{note : warning}` is two flags), and a value containing a **comma** must be quoted (`{style="a, b"}`). A value containing a colon needs no quoting — only the first colon separates, so `{href:https://example.com}` is fine.

Standalone links (alone on a line) become buttons in `content.links[]`. Inline links stay as `<a>` tags inside `content.paragraphs[]`. Multiple links sharing a paragraph are all promoted:

```markdown
[Primary](/start)              ← standalone → content.links[0]
[One](/a) [Two](/b)            ← links-only paragraph → both in content.links[]
Check out [this](/a) link.     ← inline → stays in paragraphs as an <a> tag
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

**For richer navigation** with icons, descriptions, or hierarchy, use a `yaml:nav` tagged block:

````markdown
```yaml:nav
- label: Dashboard
  href: /
  icon: lu:layout-grid       # same icon spellings as anywhere else —
- label: Docs                # lu:name, lucide:name, lu-name, or an SVG path
  href: /docs
  icon: /icons/book.svg
  children:
    - label: Getting Started
      href: /docs/quickstart
```
````

Access: `content.data?.nav` — an array of `{ label, href, icon, text, children, target }`. Components can support both modes: use `content.data?.nav` when provided, fall back to `website.getPageHierarchy()`. Full pattern: `reference/navigation-patterns.md`.

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

**Configuration cascades: `page.yml` → `folder.yml` → `site.yml` → foundation defaults.** Each level inherits from the one above and overrides specific values, the way CSS specificity works. This is what makes bulk assignment natural — put `layout: marketing` in a `folder.yml` and every page in that folder inherits it, while one page can still override with its own `page.yml`. Reach for `folder.yml` before editing the same key into a dozen `page.yml` files.

**Route mapping:** folder structure maps 1:1 to routes. Every folder keeps its natural route — `pages:` controls **order only**, not which child "becomes" the parent. The only exception is the site root, where `index:` (or first in `pages:`) sets `/`.

**Content-less containers:** folders with `page.yml` but no markdown are structural groups (`hasContent: false`). Visiting one auto-redirects to the first descendant with content — this is what supports courses → modules → lessons at any depth.

**A local folder for a mounted route should use `folder.yml`, not `page.yml`.** The filename is how you say what the folder holds — `page.yml` for a page built from sections, `folder.yml` for a folder of pages — and for a mount that answer also decides how the mounted tree is read. A `page.yml` stub over a mounted folder of pages says "sections", and top-level markdown in the mounted repo collapses into one page instead of becoming pages of its own. Keep `layout:`, `title:` and SEO in that stub; the mounted repo's own `folder.yml` supplies its ordering and title where the stub is silent.

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

**Localized URLs:** on a multilingual site (`languages:` in site.yml), `slug: { <lang>: <segment> }` gives a page a native URL segment per language; the folder name stays the canonical route. Nested folders compose automatically, and localized URLs flow through navigation, the language switcher, and the sitemap. See Part 5 for the translation workflow.

### Your site is readable by agents, automatically

Every build emits two things an AI agent can use directly, alongside the HTML. **Free, on by default, nothing to install.**

| Artifact | What it is |
|---|---|
| `/llms.txt` | An annotated index of the site — every page, with a one-line description, linking to the `.md` below |
| `/{route}.md` | Each page as clean markdown: the content, no navigation, no chrome |

The point is the pair. An agent fetches the index, *reads* what each page is about, and goes straight to the one it needs — two requests, no HTML stripping, no guessing at URLs. Descriptions come from `page.yml`'s `description:`, then `seo.ogDescription`, then the page's opening paragraph, so a site usually gets a complete index without writing any of them.

**Large sites also get per-branch indexes.** A branch with at least 5 pages gets its own — `/docs/llms.txt` lists just the docs, titled by that folder. The site index still lists everything; a branch index is an extra entry point, not a replacement, so an agent that starts at `/llms.txt` still reaches any page in two hops.

```yaml
# site.yml — all optional; these are the defaults
agents:
  index: true            # /llms.txt
  markdown: true         # /{route}.md
  branchIndexes: true    # /docs/llms.txt for branches big enough to want one
  branchMinPages: 5      # how big is big enough
  exclude: [/internal]   # keep a branch out of both (cascades)

agents: false            # or turn the whole thing off in one word
```

**Set `seo.baseUrl` if you want absolute links** in the index — without it the links are root-relative, which still works for an agent that arrived via the index. `uniweb doctor` warns when it's unset.

**What's excluded, and it's deliberate:** `seo.noindex` pages, `hidden` pages, `_`-prefixed drafts, and dynamic route templates. An index *describes* pages rather than merely listing them, so an unlinked page would become both discoverable and summarized — which is why these exclusions are load-bearing rather than tidy-up. `noindex` or `hidden` on a **folder** takes the whole branch with it.

**Declaring how your content may be used** is a separate axis from whether it may be fetched, and it goes in `seo.robots`:

```yaml
# site.yml
seo:
  robots:
    contentSignals:
      search: true       # may appear in search results
      ai-input: true     # may be retrieved at inference time
      ai-train: false    # may not be used to train a model
```

That emits a `Content-Signal:` line in `robots.txt`. Declare only what you mean — an omitted signal says nothing, which is not the same as saying no.

### Collections and dynamic routes

Most content lives in `pages/` — a fixed composition of sections on a fixed set of pages. **Collections are the other kind: repeating content managed as a set of files**, one item per file, that pages pull from. Blog posts, team members, products, case studies, bibliographies.

They're delivered through the **same data pipeline as remote APIs**, so from a component's point of view a locally-authored collection and a backend-served one look identical. Whether the records live in files or behind an endpoint is a transport concern (see *Fetching from other sources* in Part 4).

```
site/
├── pages/
├── collections/
│   ├── articles/
│   │   ├── getting-started.md
│   │   └── design-tips.md
│   └── team/
│       └── alice.yml
└── site.yml
```

**Four formats, one shape.** All of these produce the same records at runtime:

| Format | Best for | Notes |
|---|---|---|
| `.md` | Items with prose — articles, case studies | Frontmatter holds fields, body holds text; auto-excerpt and first-image extraction |
| `.yml` / `.yaml` | Structured records with no prose body — team, products | Cleaner than a markdown file with an empty body |
| `.json` | Same as YAML | When the data comes out of another tool |
| `.bib` | Bibliographies | Each `@entry{key, …}` is a record, cite key is the slug; normalized to CSL-JSON, LaTeX accents converted to Unicode |

**One record per file, or many.** A single mapping at the top of a file makes one record and the filename stem becomes its `slug`. A top-level array (YAML/JSON) or a multi-entry `.bib` makes many, each carrying its own `slug`. You can mix both in one folder — an exported `refs.bib` beside a hand-written `extras.yml`.

**Keep collection folders flat.** `collections/articles/design-tips.md` works; `collections/articles/2025/design-tips.md` does not.

Item frontmatter conventionally uses `title`, `date`, `tags`, `image`, `description`, `published`, `author` — plus any fields your content needs (`price`, `role`, `order`). Images can sit beside the item file and be referenced with `./`. `published: false` hides an item without deleting it; items with no `published` field are included.

**Declare each collection in `site.yml`:**

```yaml
collections:
  articles: collections/articles         # simple form — just point at the folder

  team:                                  # extended form
    path: collections/team               # or `url:` for a remote source
    sort: order asc                       # `date desc`, `title asc`, …
    where: { published: { ne: false } }   # a predicate — see authoring/predicates.md
    limit: 100
```

**Show a collection on a page** with `data:` in `page.yml` (the whole collection), or `fetch:` in a section's frontmatter (a subset):

```yaml
# pages/blog/page.yml          |   # a section on the homepage
title: Blog                    |   ---
data: articles                 |   type: ArticleTeaser
                               |   fetch: { collection: articles, limit: 3, sort: date desc }
                               |   ---
```

**Give each item its own page with a `[slug]/` folder** under the list page:

```
pages/blog/
├── page.yml          # title: Blog / data: articles
├── list.md
└── [slug]/
    ├── page.yml
    └── article.md    # just `type: Article` — the item arrives automatically
```

`collections/articles/design-tips.md` becomes `/blog/design-tips`. The section inside `[slug]/` needs no special markdown — the matched record is delivered to it. Generated pages are excluded from navigation menus.

> **The record arrives as a single-element array under the collection key** — `content.data.articles[0]`, not `content.data.article`. The runtime never coerces it to an object and never synthesizes a singular key. See *Data* in Part 4.

**Two options for bigger collections:**

`deferred: [body]` strips heavy fields from the list payload — cards stay light, while a `[slug]` page still receives the full record automatically and other components fetch on demand via `useEntityDetail`. For a remote collection, add `detailUrl: /api/articles/{slug}` so the framework knows how to fetch one full record; file-based collections emit per-record files at `/data/<name>/<slug>.json` and need no configuration.

`queryable:` declares which fields a reader may filter on, with enough metadata for the foundation to render controls:

```yaml
collections:
  members:
    path: collections/members
    queryable:
      department: { type: enum, label: Department, options: [biology, physics, chemistry] }
      tenured:    { type: boolean, label: Tenured }
      start_year: { type: range, label: Start year, min: 1800, max: 2025 }
```

The site declares the *surface*; the foundation reads the metadata, renders matching controls (dropdown, toggle, slider), and composes the predicate when the reader picks values.

Full author guide: `authoring/collections.md`. Predicate operators: `authoring/predicates.md`.

---

## Part 4 — The foundation lane

You're not building pages — you're building a **system** of section types that authors compose into pages. Name by purpose, not content: `Testimonial` not `WhatClientsSay`, `SplitContent` not `AboutSection`. Expect consolidation: a React site with 30+ components typically maps to 8–15 Uniweb section types.

### Where things go

```
src/                     # the foundation package (folder name is `src`)
├── sections/            # Section types (auto-discovered)
│   ├── Hero.jsx         # Bare file — no folder needed
│   ├── Features/        # Folder when you need meta.js
│   │   ├── index.jsx
│   │   └── meta.js
│   └── insets/          # Organizational subdirectory (lowercase)
├── layouts/             # Custom layouts (optional, auto-discovered)
├── components/          # Your React components — any props you like, no meta.js
├── utils/               # Helper functions, non-React logic
├── main.js
├── styles.css
└── package.json         # name: "src"
```

**Discovery:** PascalCase files and folders at the root of `sections/` are auto-discovered. Nested levels require a `meta.js`. Lowercase directories are organizational only. `hidden: true` excludes a component entirely. Everything outside `sections/` and `layouts/` is ordinary React.

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

### Props interface

```jsx
function MyComponent({ content, params, block }) {
  const { title, paragraphs, links, items } = content   // Guaranteed shape
  const { columns, variant } = params                   // Defaults from meta.js
  const { website } = useWebsite()                      // Or block.website
}
```

Frontmatter becomes `params`, minus the keys the framework consumes outright: `type` (and its legacy alias `component`), `preset`, `input`, `props`, `fetch`, `data`, `id`. `props:` is the one that isn't dropped but merged *into* params.

**Framework fields you'd expect to be stripped are not.** `background`, `theme`, `source`, `where`, and `vars` are acted on by the runtime *and* passed through — so `params.theme` is readable when a component needs logic beyond CSS tokens (a light vs. dark logo, say). Components ignore the keys they don't use, the same way they ignore unused `content.data` keys.

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

### The Kit, by use case

Names only — for signatures and props, read the package: it's on disk at `node_modules/@uniweb/kit`, and `reference/kit-reference.md` has the full API.

**Text:** `H1`–`H6`, `P`, `Span`, `Div`, `Text` (with `as`)
**Content:** `Section`, `Prose`, `Article`, `Render` (ProseMirror → React), `ChildBlocks`, `splitContent()`
**Media:** `Visual` (first non-empty: inset/video/image), `Image`, `Media`, `Icon`, `Asset`
**Navigation:** `Link`, `useActiveRoute()`, `useWebsite()`, `useRouting()`
**Header/layout:** `useScrolled(threshold)`, `useMobileMenu()`, `useAppearance()`
**Overlays:** `Overlay` (modals, palettes, drawers, toasts — portals out of the layout, contains focus; read the note below before hand-rolling one)
**Keyboard:** `useShortcut('mod+k', fn)`, `useShortcuts({…})`, `useShortcutLabel('mod+k')` — `mod` is Cmd on Apple platforms and Ctrl elsewhere, and the label renders per-platform so a hint never shows the wrong key
**Long-form prose:** `<Prose>` and the container you put `<Render>` output in both use Tailwind Typography's `prose` classes, which come from a plugin your *foundation* installs — kit ships no stylesheet. Without it the markup is right and completely unstyled. Add `@tailwindcss/typography` to the foundation's deps, then:

```css
@plugin "@tailwindcss/typography";
@import "@uniweb/kit/prose-tokens.css";   /* makes prose answer to theme.yml */
```

Use **one** `prose` container per subtree — the `--tw-prose-*` variables are inherited, so a nested one silently resets them and the outer container goes on looking correct. The section that renders the document is usually the better owner; a layout should supply column width and padding.

**Documentation shells:** `useHeadings()` (the page's headings + the one being read, derived from content so it prerenders), `website.getBranchHierarchy({ route, for })` (the page tree for one branch). Kit ships no ready-made layout — a layout is your foundation's design; write it in `src/layouts/` and use these for the behaviour.
**Layout helpers:** `useGridLayout(columns, { gap })`, `useAccordion({ multiple, defaultOpen })`
**Theming data:** `useThemeData()`, `useColorContext(block)`
**Data fetching:** `useFetched`, `useCacheEntry`, `useEntityDetail`
**Utilities:** `cn()`, `SafeHtml`, `SocialIcon`, `filterSocialLinks(links)`, `getSocialPlatform(url)`, `getLocaleLabel(locale)`
**Other styled:** `Code`, `Alert`, `Table`, `Details`, `Divider`, `Disclaimer`

Four things you won't discover by reading exports:

> **Content fields are HTML strings.** Covered above — it's the single most common rendering bug.

> **`<Link>` takes `to` or `href`.** `to="page:about"` resolves a page ID (survives moves), external URLs get `target="_blank"` automatically, and `reload` forces a full page load.

> **`cn()` gotcha — a later `text-<size>` silently drops an earlier `leading-*`.** Tailwind's size classes set line height too, so `cn()` treats the size as replacing the leading: `cn('leading-[1.1] text-4xl')` → `text-4xl`. Put the size first, or fold the leading into it (`text-[clamp(2rem,5vw,4rem)]/[1.1]`). Most likely to bite when the size comes from a lookup and the leading sits in a shared base string.

> **Kit hooks are SSR-safe by design.** If you hit "document is not defined" during a build, don't add `typeof document` guards — reach for the hook instead (`useAppearance()` for scheme, `useScrolled()` for scroll position).

> **A modal needs `<Overlay>`, not a bigger z-index.** The runtime gives each layout area its own `view-transition-name` so header, rails and body animate independently. That makes each area a stacking context *and* a containing block for `fixed` children — so a dialog rendered from inside your Header is sealed into the header's context and paints *under* the page body no matter what z-index it carries. Raising the number looks like it should work and never does. `<Overlay onClose={close}>…</Overlay>` renders into `document.body`, where the z-index means what you expect.
>
> It also does the part that is easy to skip: a modal overlay **contains focus** — moves focus in, cycles Tab within, marks the rest of the page `inert`, and returns focus to whatever opened it. That is what makes the `role="dialog" aria-modal="true"` on your box true rather than merely asserted; without it a keyboard user Tabs straight out into a page a screen-reader user has been told is unreachable. Plus Escape, the scrim click, the scroll lock, and a dimmed scrim you override with `className` (`bg-transparent` removes it). `modal={false}` for a toast: it escapes the stacking context and nothing else, so the page stays usable. Your dialog's markup stays yours.

### Icon component

```jsx
{content.icons.map((icon, i) => <Icon key={i} {...icon} />)}   // From content
<Icon name="search" />                                          // Lucide (default)
<Icon name="hi2-arrow-right" />                                 // Other library by prefix
<Icon name="close" />                                           // Built-in (no network)
```

Built-ins (instant, no network): `check`, `close`, `menu`, `chevronDown`, `chevronRight`, `externalLink`, `download`, `play`, and a few others. Other props: `svg`, `url`, `size` (default `'24'`), `className`.

### Section wrapper

The runtime wraps every section in `<section>` with its context class and background. Customize with static properties:

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
  category: 'showcase',     // free-form editor grouping — nothing validates it.
                            // impact / showcase / structure is a suggested set.
                            // It names the kind of *component*, not the kind of
                            // site: a genre like 'marketing' belongs to a template
  purpose: 'Explain',       // free-form; a single verb reads well
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

**All defaults belong in `meta.js`, not inline in component code.** `meta.js` is also the catalog entry another agent reads to discover your section type (Part 2, step 2) — write `description` and `content:` for that reader.

> **`meta.js` is a user interface, not just metadata.** When a foundation is published, every `meta.js` is registered as the foundation's schema, and the visual editor builds its controls from it: the build generates a `schema.json` from every `meta.js` in the foundation, and the editor renders it: a `select` param with `options` becomes a dropdown, a `boolean` becomes a toggle, `label` and `description` become the words a non-technical author reads, and each entry in `presets` becomes a one-click choice. That's the real reason param naming matters — `variant: centered` and `renderMode: flex-center` aren't a style preference, they're the difference between a legible control and a baffling one. Write `meta.js` as though someone who will never see your code has to use it, because that's exactly who does.

### Two worlds: section types and your own components

The `{ content, params, block }` interface is not "how components work in Uniweb." It is how **section types** work — the components an author names with `type:` in frontmatter. A section type is a *public interface*: its name, params, and content expectations are a contract with content authors, and `meta.js` is its documentation.

**Everything under `components/` is yours.** It's a normal React project in there, and the framework has no opinion about it:

- **Any props you want** — `<PricingCard tier={tier} price={price} featured />`. No `content`, no `params`, no `block` unless you choose to pass them.
- **Any composition** — children, render props, context, `forwardRef`, custom hooks, whatever the job needs.
- **Any library** — install it and import it.
- **No `meta.js`, no naming convention, no auto-discovery, no author visibility.**

Two symptoms of getting this backwards, both worth checking yourself against:

> **Don't give helper components a `{ content, params }` signature.** Copying the section interface downward is the most common version of this mistake. It makes every helper harder to reuse and hides what it actually needs. A card that takes `title`, `price`, and `features` is better than one that takes `content` and digs through it.

> **Don't put helpers in `sections/`.** Anything at the root of `sections/` becomes author-selectable vocabulary. A `Button` or `Card` appearing in the editor's section picker is a bug in your foundation's interface design, not a harmless extra.

**A section type is usually a composite.** Its job is to translate parsed content into whatever your own components expect, then arrange them:

```jsx
// sections/Pricing/index.jsx
import PricingCard from '#components/PricingCard'
import formatPrice from '#utils/formatPrice'

export default function Pricing({ content, params }) {
  const currency = params.currency || 'USD'
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-6xl mx-auto">
      {content.items.map((tier, i) => (
        <PricingCard key={i} tier={tier} price={formatPrice(tier.data, currency)} />
      ))}
    </div>
  )
}
```

The author writes `type: Pricing` and defines tiers as content items. `PricingCard` knows nothing about Uniweb — it takes a tier and a price. That boundary is what makes it testable, reusable across section types, and replaceable without touching the author-facing contract.

**There are many ways to use `components/`**, and no expected shape. Presentational primitives shared across section types (buttons, cards, badges). A thin wrapper adapting the parsed content shape to a third-party component's props. Layout scaffolding several section types share. Stateful widgets. Legacy components carried in during a migration. The Front Desk pattern below is *one* specific arrangement worth knowing — not a requirement, and not the main reason to have helper components.

### The Front Desk pattern

One arrangement of the above is worth naming, because it comes up whenever a single `type:` needs to cover genuinely different renderings.

Section types naturally use params to adjust their own rendering — `variant: flipped` reverses a flex direction, `columns: 3` sets a grid. That's the baseline, not a pattern. The **Front Desk pattern** is the step beyond it: a section type that does virtually no rendering itself, instead reading the author's params, picking the right helper component, and translating author-friendly vocabulary into developer-oriented props.

The workers behind the desk need not share an interface. A `Hero` might delegate to a `SliderHero` (image carousel) and a `ContactHero` (quote form) expecting different content and different props. The front desk declares the **union** of everything its workers might need — some content goes unused for a given variant, and that's normal in CCA: params change behavior, and that includes not rendering some content.

```js
// meta.js — the union of all variants' needs
export default {
  params: {
    variant: { type: 'select', options: ['slider', 'contact'], default: 'slider' },
    slideInterval: { type: 'number', default: 5 },
    density: { type: 'select', options: ['default', 'compact'], default: 'default' },
    style: { type: 'select', options: ['default', 'dramatic'], default: 'default' },
  }
}
```

```jsx
// sections/Hero/index.jsx — the front desk
import { SliderHero } from '#components/SliderHero'
import { ContactHero } from '#components/ContactHero'

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

`SliderHero` uses `images`, `interval`, `transition` and ignores the rest; `ContactHero` uses `formData` and `compact` and ignores the rest. The author writes `variant: contact` — they don't know or care that `ContactHero` exists.

This is the system-building pattern at its clearest: **section types are the public interface** (author-friendly names, documented in `meta.js`); **helper components are the implementation** (ordinary React props). The section type is the thin translation layer between the two worlds.


**When to reach for this pattern:** when a page type has consistent structural elements — header bars, navigation footers, contextual sidebars — that the content author shouldn't have to add as separate sections. If the author would otherwise repeat the same boilerplate sections on every page of a given type, the section component should compose them internally.

**Common mistake:** solving structural repetition at the layout level. If only some page types need a content header (lessons do, the homepage doesn't), that's a section concern. The layout owns page-wide chrome; the section owns its internal structure.

### Params, component vars, foundation vars

Three places a value can live, and picking the right one is most of the design:

| | Declared in | Reaches the component as | Author overrides in | CSS scope |
|---|---|---|---|---|
| **Param** | `meta.js` `params:` | a JS prop | section frontmatter | — |
| **Component var** | `meta.js` `vars:` | a CSS custom property | section frontmatter `vars:` | `#section-{id}` |
| **Foundation var** | `main.js` `vars:` | a CSS custom property | `theme.yml` `vars:` | `:root` (global) |

**Param when the value drives logic** — a count, a variant name, a boolean the JSX branches on. **Component var when it only drives CSS** and belongs to one section type; it never enters JS, so it doesn't re-render anything:

```js
// meta.js — same schema as foundation vars (default, label, type, options, group, description)
vars: {
  'card-gap':    { default: '1.5rem', label: 'Card Gap', type: 'select', options: ['1rem', '1.5rem', '2rem'] },
  'card-radius': { default: 'var(--radius-md)', description: 'Inherits the foundation var by default' },
}
```

```jsx
<div className="grid gap-[var(--card-gap)]">          // emitted on #section-{id}
```

```yaml
---
type: PricingTable
vars: { card-gap: 2rem }        # author override — only declared names apply
---
```

Unknown var names in frontmatter are ignored, and component vars are always context-independent (unlike foundation `color`/`gradient` vars, which resolve per light/dark context).

**Foundation var when the value must stay consistent *across* components** — shared radii, spacing scales, extra typefaces. A header height is a layout param, not a foundation var; a sidebar width is a layout param too. Declare foundation vars in **`main.js`**, the single source of truth:

```js
export const vars = {
  'radius-lg': { default: '1rem', description: 'Large border radius' },
  'section-padding-y': { default: 'clamp(4rem, 6vw, 7rem)', description: 'Vertical section padding' },
}
```

Each entry ships the default as a CSS custom property (so `var(--section-padding-y)` resolves everywhere), gives the visual editor a description and type, and is what a site overrides under `vars:` in `theme.yml`. You don't declare these anywhere else — the defaults reach the browser on their own, in dev and production, bundled or runtime-loaded.

A `styles.css` `@theme` block is a different tool: it registers a token so **Tailwind generates utilities** from it (`@theme { --breakpoint-xs: 30rem }` → `xs:` variants). Use it to extend Tailwind's vocabulary, not to ship a plain default.

**A name matching a Tailwind namespace is an intentional override.** A var named after a Tailwind v4 scale — `radius-*`, `shadow-*`, `spacing`, `font-*` — redefines that scale wherever the matching utility appears: declaring `radius-lg` retunes every `rounded-lg` in the foundation. That's the point when you mean it — name deliberately so you don't reshape a utility by accident.

### Semantic theming

Components use **semantic CSS tokens** instead of hardcoded colors. The runtime applies a context class (`context-light`, `context-medium`, `context-dark`) to each section from its `theme:` frontmatter.

```jsx
<h2 className="text-slate-900">…</h2>   // ❌ Hardcoded — breaks in dark context
<h2 className="text-heading">…</h2>     // ✅ Semantic — adapts to any context and brand
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

> **`serif` and `font-serif` are the same font var** — the `font-` spelling is just the one Tailwind's `font-serif` utility reads. Declare it either way in `main.js`; the site sets it by the bare role name under `fonts:`.

> The `code` role owns `--font-code`. Tailwind's `font-mono` utility (which reads `--font-mono`) is a **separate** concern — control it by declaring your own `font-mono` font var. So `fonts.code` styles code without disturbing `font-mono`-styled labels, and vice-versa.

### Tailwind v4 and styles.css

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

**Tokens are a floor, not a ceiling.** They solve context adaptation — the hard problem. A great foundation adds design vocabulary on top:

```css
.border-subtle { border-color: color-mix(in oklch, var(--border), transparent 50%); }
.text-tertiary { color: color-mix(in oklch, var(--body), var(--subtle) 50%); }
```

These compose with tokens — they adapt per context because they reference token variables — while adding nuance the token set doesn't provide. Use palette shades directly (`var(--primary-300)`, `bg-neutral-200`) for fine-grained control. **The priority: design quality > portability > configurability.** A beautiful foundation for one site is worth more than a generic one that looks flat.

Two lines a ported CSS reset will try to bring with it, both of which break things:

> **Don't set `scroll-behavior: smooth` globally.** The runtime owns scrolling: it already smooth-scrolls anchor targets itself (`scrollIntoView({ behavior: 'smooth' })`), so the CSS adds nothing there — but it resets and restores scroll on route changes with the two-argument `scrollTo(x, y)`, which *inherits* the property. Route changes then animate their scroll-to-top, and back-button restoration (which scrolls, checks the position on the next frame, and retries) keeps interrupting its own animation. Scope it to a specific scrollable element if you need it; never to `html` or `body`.

> **Font smoothing is a per-scheme decision, not a reset.** `-webkit-font-smoothing: antialiased` (macOS only) forces grayscale rasterization, which thins strokes. On dark surfaces that usefully counteracts the bloom of light text on near-black; on light surfaces it costs contrast and makes body text spindly. Scope it — `.scheme-dark { -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; }` — rather than putting it on `html`.

### Composition: items, child sections, insets

Pages are sequences of sections — the obvious layer. The framework also supports real nesting, without leaving markdown.

| Pattern | How authored | Use when |
|---|---|---|
| **Items** (`content.items`) | Heading groups within one `.md` | Repeating content in one section: cards, features, FAQ entries |
| **Child sections** (`block.childBlocks`) | `@`-prefixed `.md` files + `nest:` | Children needing their own section type, rich content, or independent editing |
| **Insets** (`block.insets`) | `![](@Component)` in markdown | Self-contained visuals/widgets: charts, diagrams, code demos |
| **Block insets** (`block.insets`) | ` ```@Component ` fence around markdown | A component that *wraps* authored prose: callouts, disclosures, admonitions |

Does the author write content *inside* the nested element? **Yes** → child sections, or a block inset when the wrapper is presentational and lives mid-page. **No** (self-contained, param-driven) → inset. Repeating same-structure groups → items. These compose: a child section can contain insets; items work inside children; a block inset can contain both.

**Insets — embedding components in content.** Many section types need a "visual" — a hero's illustration, a split-content section's media. Classically an image or video. But what if it's a JSX + SVG diagram, a ThreeJS animation, an interactive playground? Elsewhere you'd reach for MDX or prop-drilling. Here the author writes standard image syntax:

```markdown
![Architecture overview](@NetworkDiagram){variant=compact}
```

The developer builds `NetworkDiagram` as an ordinary React component with `inset: true` in `meta.js`. Kit's `<Visual>` renders the first non-empty candidate, so one section type works whether the author supplies an image, a video, or an interactive component:

```jsx
<Visual inset={block.insets[0]} video={content.videos[0]} image={content.images[0]} className="rounded-2xl" />
```

**Insets are full section types** — they receive `{ content, params, block }`. The alt text becomes `content.title` and attributes become `params`: `![npm create uniweb](@CommandBlock){note="Ready to go"}` → `content.title = "npm create uniweb"`, `params.note = "Ready to go"`.

**Don't use `hidden: true` on insets.** `hidden` means "don't export this component at all" (internal helpers); `inset: true` means "available for `@Component` references in markdown."

**Block insets — a component that wraps content.** The image form is a leaf: it takes params but no body. When the component should surround authored prose — a callout, a disclosure, an admonition — use the fenced form instead. Same `@Component{params}` reference, written as a code fence's info string:

````markdown
```@Alert{type=warning}
Back up your database **before** running this.

- The migration is not reversible
- Allow ten minutes of downtime
```
````

The body is ordinary content, not text: it is parsed exactly like the rest of the page, so headings, lists, tables, icons, inline styling, leaf insets and further containers all work inside one. To nest a code block or another container, open the outer fence with more backticks than the inner one.

**The component is yours, and it receives parsed content.** `@Alert` resolves against the foundation through the same lookup as `![](@NetworkDiagram)` — declare it with `inset: true` in `meta.js`. Where a leaf inset gets its alt text as `content.title` and nothing else, a container gets its whole body parsed: `title`, `paragraphs`, `items`, `sequence`. Render it with `<Prose content={content} block={block} />` or read the fields directly. A name the foundation doesn't define falls back to a plain bordered box that still shows the body — never a drop.

Prefer a **child section** when the author needs their own section type and independent editing; prefer a **block inset** when the wrapper is presentational and belongs inline in a single file's prose.

**Child sections.** You hit a complex layout — a 2:1 split with a panel and a main area. Your instinct says build a specialized component. Step back: the panel is a reusable section type, the main area is another, and the split is a Grid with `columns: "1fr 2fr"`. Your child components already adapt to narrow containers — container queries handle that. But hardcoding which components go where means the author can't rearrange or swap them. Child sections solve that:

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

Each child is a regular section with its own type, params, and content — and you're in the middle: wrap each child, filter by type, reorder, add container classes. The author decides *what* goes in the grid; your component decides *how* it renders. Tomorrow the author can swap a child for a different section type with no code change, and your components stay reusable wherever child sections are accepted.

**Data and child blocks:** page-level `data:` is available to all blocks including children, and each child resolves data independently through the page → site hierarchy. If a child needs data, declare it in the child's `meta.js` or its frontmatter (`data: articles`).

**SSG:** insets, `<ChildBlocks>`, and `<Visual>` all render correctly during prerender. Inset components using React hooks internally trigger prerender warnings — expected and harmless; the page renders correctly client-side.

### Dividers — content boundaries

`---` creates a boundary between content regions; the developer decides what each region means.

**UI regions.** `splitContent()` from `@uniweb/kit` splits parsed content at divider elements — e.g. lesson prose vs challenge content:

```jsx
const [lesson, challenge] = splitContent(content)
```

<!-- template:loom -->
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

**Which to use:** different data contexts per region → Loom pre-parse split (content handler). Same data, different UI treatment → kit post-parse split (`splitContent`). A foundation can use both — Loom splits and iterates to produce final content, then the component splits the result to route regions to different UI.
<!-- /template:loom -->

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

Layouts are full components with their own `params` in `meta.js`, not just structural wrappers — a header height or sidebar width is a layout param.

**Layout `meta.js`** declares areas and optional scroll behavior: `{ areas: ['header', 'footer', 'left'], scroll: 'self' }`. Area names are arbitrary. `scroll` controls scroll restoration: unset = runtime manages `window` (default), `'self'` = the layout scrolls itself, or a CSS selector (`'main'`) = runtime manages that element.

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

Section types sometimes coordinate — the typical case is a Header that needs to know whether the section below supports a floating translucent overlay (a Hero with a full-bleed background does, a plain text section doesn't). The section that **owns the capability declares it**; the section that **needs to adapt reads it**. `getNextBlockInfo()` — and `getPrevBlockInfo()`, `page.getFirstBodyBlockInfo()` — expose two channels:

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

### block, website, and page

```jsx
const { website } = useWebsite()
const page = website.activePage
```

| `block` property | Description |
|----------|-------------|
| `block.page` / `block.website` | Parent page / site-level data and navigation |
| `block.type` | Component type name |
| `block.childBlocks` / `block.insets` | Child sections / inline `@Component` references |
| `block.getInset(refId)` | Lookup an inset by refId |
| `block.properties` | Raw frontmatter |
| `block.rawContent` | ProseMirror document — passed internally by `<Article block={block} />` |
| `block.themeName` | `"light"`, `"medium"`, `"dark"` |
| `block.stableId` / `block.key` | Stable ID from filename or `id:` / unique key across pages — use as React key |
| `block.path` | Page route this block belongs to |
| `block.dataLoading` | True while declared data is still resolving |

```jsx
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

### Data

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

**Declaring schemas.** `meta.js` declares the schema for each `content.data` key with a single `data:` field — there is no separate `schemas:` key. Each value is a **named ref**, an **inline field map**, or an **inline rich-form** (`{ fields: [...] }`, an editor form). Refs resolve on disk at build time, never fetched: `@/name` (this foundation's `schemas/`), `@std/name` (shared standards, from `@uniweb/schemas`), `@org/name` (an org's own `@org/schemas` package). The schema is a hint — it supplies field defaults and drives the editor, not delivery, which is default-on. For an explicit opt-out (rare), set `data: false`.

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

A foundation can route a scope to a plain folder of schema files instead of a package via an optional `schemas.config.js` at its root — `export default { '@acme': '../shared/acme-schemas' }`. A routed scope wins over the package convention; `@/` and `@uniweb` are never routable; a routed scope has no package fallback for a missing schema (it errors rather than silently loading a different definition). Per-schema keys override single entries (most-specific wins: file › directory › package). Worked examples: `development/schemas-in-practice.md`.

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

### Fetching from other sources (`fetcher:`)

A site isn't limited to file-based collections. The `fetcher:` block in `site.yml` tunes the framework's default fetcher and opts into foundation-provided **named transports** per schema:

```yaml
# site.yml
fetcher:
  baseUrl: https://api.example.com
  headers: { X-Tenant: acme }
  envelope: { collection: data.items, item: data.article, error: errors.0.message }

  supports: [where, limit, sort]     # which operators the source evaluates natively

  transports:
    articles: uniweb                 # a foundation-registered transport handles `data: articles`
    events: default                  # explicitly route back to the default fetcher
  uniweb:                            # binding config that transport reads
    siteFolder: abc-123-def
```

**`supports:` is a capability declaration, not a switch.** With `supports: []` (the default) the source is treated as static: the whole collection is fetched and the framework applies `where` / `sort` / `limit` in JS afterward, so two pages with different predicates share one cache entry. With `supports: [where]` the predicate ships in the request and the cache splits per predicate. With `[where, limit, sort]` the source returns the final result and the framework passes it through. Pushdown applies only to remote `url:` sources — local `path:` reads are static files and always evaluate operators as a runtime fallback.

**Selection is explicit and site-owned.** For each request: `fetcher.transports[schema]` wins if set; otherwise `fetcher.transports.default` if set; otherwise the framework's default fetcher applies `baseUrl` / `headers` / `envelope`. No route-walking, no `match()` predicates, no silent foundation-owned routing — the site picks.

> **Never put secrets in `site.yml`** — every value in it is public to the browser. Sites needing private credentials proxy through the same origin at the deployment layer, so the site fetches `/api/…` and the proxy attaches the credential server-side.

**Failures degrade rather than break:** a failed fetch falls back to `[]`, logs a build warning, and the page still renders. Components should handle the empty case — which the guaranteed content shape already encourages.

Recipes for staying on the default fetcher, and for writing a custom transport: `development/connecting-a-backend.md`.

Full model: `reference/data-fetching.md`. Where-object format with examples: `authoring/predicates.md`.

### Search (`search:`)

Search follows the same arrangement as `fetcher:` — the **site** declares where results come from, and a search UI reads them the same way regardless. Never hardcode a search endpoint in a component; that couples the foundation to one host.

```yaml
# site.yml
search:
  enabled: true
  provider: index        # default — download an index, match in the browser
```

| Provider | Answers with | Trade-off |
|---|---|---|
| `index` (default) | `search-index.json` + Fuse.js in the browser | Free, works on **any** host including a plain static one, tolerates typos. Contains only what existed at build time. |
| `endpoint` | A server-side search API | Can cover records fetched from an API, and can be re-indexed without rebuilding the site. Requires a host that serves one. |
| *any other name* | A foundation-supplied search transport | Fully open — Typesense, Meilisearch, Pagefind, a vendor API |

```yaml
search:
  provider: endpoint
  endpoint: _search      # optional; base-RELATIVE, so one spelling works everywhere
```

`endpoint:` resolves against the site's base path — `/` → `/_search`, `base: /docs/` → `/docs/_search`, a subpath-served site follows its subpath. An absolute `https://…` URL points at another origin.

**Results have one shape, whatever the provider.** Always present: `id`, `type`, `route`, `href`, `title`, `pageTitle`, `excerpt`, `snippetHtml`. Provider-optional (`null` when absent): `sectionId`, `anchor`, `description`, `component`, `snippetText`, `matches`, `collection`, `item`. Whether an optional field arrives is a deployment fact, not a content fact — the same site yields `item` from a server provider and `null` from the local index — so guard them: `result.item?.image`.

`snippetHtml` is HTML with `<mark>`. Render it through `SafeHtml`, never as text.

**Failures degrade rather than break** — a failing provider falls back to the local index when one exists, otherwise returns no results with a console warning. A search box never throws at a visitor.

```jsx
import { useSearch } from '@uniweb/kit'

const { results, isLoading, query } = useSearch(website)   // `query` is a function
<input onChange={e => query(e.target.value)} />            // debounced internally
```

Full reference: `authoring/search.md`.

<!-- template:loom -->
### Content handlers

Content handlers are a transform layer between data assembly and the component, declared in `main.js` and applied to every section in the foundation. The standard content shape is the default; handlers reshape it. All three are optional, run per block, and are error-isolated — a failing handler logs a warning and falls back to default behavior.

| Handler | When it runs | Receives | Returns | Purpose |
|---|---|---|---|---|
| `data` | After data assembly, before content transform | `(data, block)` | New data object, or null | Filter, reshape, or augment assembled data |
| `content` | After the data handler | `(data, block)` | ProseMirror document, or null | Transform raw content (Loom instantiation, template expansion) |
| `props` | After parsing, defaults, and guarantees | `(content, params, block)` | `{ content, params }`, or null | Post-process the final shape before the component sees it |

The `content` handler receives `block.parsedContent.data` and reads raw ProseMirror from `block.rawContent`, returning a new ProseMirror document that the framework re-parses through the semantic parser. Returning `null` — or the same reference as `block.rawContent` — signals no change.

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
<!-- /template:loom -->

---

## Part 5 — Commands, shipping, and migration

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
uniweb login / logout                 # Start or clear the backend session the verbs above reuse
uniweb org list / create <handle>     # Publish orgs you belong to — the @org in a scoped ref
uniweb content export [dir]           # Package a site (or a built foundation's schema) as .uwx

uniweb rename <foundation|site|extension> <old> <new>   # Rename across the whole workspace
uniweb i18n extract / init / sync / status / audit      # Translation workflow (build first)
uniweb i18n init-freeform / update-hash / move / rename / prune --freeform

uniweb -v                         # Installed CLI version — and whether a newer one exists
uniweb doctor                     # Diagnose project configuration (--fix to auto-repair)
uniweb validate                   # Check file-based data against declared schemas (--strict for CI)
uniweb update                     # Align @uniweb/* deps + AGENTS.md to the CLI (--dry-run, --yes)
uniweb inspect <path>             # Show parsed content for a section or page (--raw for the AST)

uniweb <command> --help           # Per-command flags — no side effects. Prefer this over guessing.
```

**Four verbs dispatch but are deliberately not listed above.** `invite`, `handoff` and `template` are **reserved names with no implementation** — the flows they named ran against a backend the CLI no longer talks to, and the names are held so a future rebuild doesn't need a breaking change. `runtime register` uploads a built runtime and is internal. Running any of them is not useful; their absence from this list is the answer, not an omission to fix.

### Where a site can live

**There is no lock-in, and no default you're pushed toward.** Four independent paths, and a project can change its mind:

| Path | Command | Good for |
|---|---|---|
| Free static host, via CI | `uniweb add ci --host=<adapter>` | most self-hosted sites — one command, then every push deploys |
| Free static host, from this machine | `uniweb deploy --host=<adapter>` | one-off or manual deploys |
| Any static host at all | `uniweb export` | full control; no Uniweb account needed |
| Uniweb Cloud | `uniweb publish` | teams with non-technical content authors, or client work |

`uniweb deploy` never assumes a host: with nothing configured it opens a picker listing only destinations it can act on, and records the choice in `deploy.yml` so later runs go straight there. On Cloudflare Pages / Netlify / Vercel, `add ci` also adds per-PR previews that comment the URL. Adapters: `github-pages`, `cloudflare-pages`, `netlify`, `vercel`, plus `s3-cloudfront` for `deploy`. Destination config lives in `deploy.yml` beside `site.yml`; host credentials come from the environment, never from that committed file.

Foundations have their own free path too: `uniweb add ci --target foundation` publishes to permanent versioned URLs on GitHub Pages.

### Uniweb Cloud and the two-sided workflow

`uniweb publish` ships to Uniweb Cloud, and it's worth understanding what that buys, because it isn't only hosting — it's how a team of technical and non-technical people works on one site.

**Content authors work visually in the Uniweb App.** They compose the same extended markdown and set the same component params you defined, through a visual editor — never touching code, git, or the CLI. They see exactly the section types your foundation offers and exactly the knobs each one exposes, because **every `meta.js` is registered as the foundation's schema** when you publish. Your `meta.js` is the app's UI (see *meta.js* in Part 4).

**Sync is developer-only and one-sided by design.** `uniweb push` and `uniweb pull` are your commands, not theirs:

- **The app is the live source of truth for content** — where authors work and where your push lands live.
- **Git is the reviewed, durable record** — you `pull` content back, read it with `git diff`, and commit.
- **Authors never push or pull.** For them, content simply updates, whether the change came from another author or from a developer's CLI.

**Conflicts behave like a collaborative document, not like git.** A developer's push arrives the way a live collaborator's edit would. Different sections never conflict, and different params of the same section never conflict — last edit wins. The app warns only when two content edits target the same section at the same time.

**The Cloud also provides a real backend for structured data:** a database for every registered data schema, and a CMS that edits both static page content and dynamic data entities typed by those schemas. That's the piece that makes it viable for teams and client work — the client manages records, not markdown files.

Either side can publish. Nothing about this changes how you build: the same foundation and the same site run under `uniweb dev`, `uniweb export`, or a CI deploy with no account at all.

**Publishing vs registering.** Foundations on Uniweb Cloud live in the catalog as `@org/name@version`. When a foundation powers a single site, **don't run `uniweb register` yourself** — `uniweb publish` from the site directory releases the local foundation to the catalog (when its code changed) and goes live in one step. Register deliberately only when the foundation is a product meant for multiple sites; consuming sites then pin `foundation: '@org/name@1.2.3'`. **The catalog is private and access-segregated, not a public package registry** — people see only the foundations licensed to sites they own or edit. The *site* carries the license, and it rides along with site ownership when a developer hands a site to a client. Don't describe publishing as making a foundation publicly discoverable. Schemas can also be registered on their own from a schemas-only package (`@uniweb/schemas`, any `@org/schemas`, or a bare folder of `schemas/*.{yml,json,js}`) — that's how `@std` schemas are published. Auth via `uniweb login`, `--token`, or `UNIWEB_TOKEN`; preview with `--dry-run`.

### Staying current

```bash
uniweb -v                  # installed CLI version, and whether a newer one is available
uniweb doctor              # report drift in this project, changing nothing
uniweb update --dry-run    # preview exactly what update would change
uniweb update              # apply: align @uniweb/* deps AND refresh AGENTS.md
```

**`uniweb update` is the command for bringing a project up to date.** It aligns the project's `@uniweb/*` dependencies *and* this AGENTS.md to the version matrix of the CLI that runs it. Deps and documentation move together — that's the whole point of the verb.

> **Don't run `npm update` or `pnpm update` on the `@uniweb/*` packages.** They're a matched set resolved by the CLI's version matrix, not independently versioned libraries you upgrade one at a time. Updating them directly gets you a combination nobody tested, and it won't refresh AGENTS.md — so this guide silently drifts out of sync with the code it describes, which is worse than being out of date, because nothing looks wrong.

Two ordering rules: `update` won't refresh AGENTS.md while declared deps still lag the CLI, or while edited deps haven't been installed — either would put the doc ahead of the code. And updating the CLI itself is your package manager's job (`npm i -g uniweb@latest`, `pnpm add -g uniweb@latest`); `uniweb update` does not do that. To pin a project to the newest published release with no global install: `npx uniweb@latest update --yes`.

### `package.json` `uniweb` block

Platform-specific configuration that doesn't belong in npm-standard fields. All fields optional.

| Field | Where used | Default | Purpose |
|---|---|---|---|
| `id` | `uniweb register` | bare segment of a scoped `name` | The foundation's registered id — the bare name in `@org/<id>`. Decoupled from `package.json::name` (a workspace concern), so renaming on the registry doesn't ripple through site dependencies. |
| `namespace` | `uniweb register` | none | Legacy explicit org-namespace override; equivalent to a scoped `package.json::name`. Rarely needed. |
| `runtimePolicy` | `dist/runtime-pin.json` | `"auto-minor"` | How sites using this foundation receive runtime updates. |

**Runtime policy** (foundation authors only — sites don't set this). At build time a foundation pins the `@uniweb/runtime` version it built against into `dist/runtime-pin.json`, alongside a policy controlling how that version moves forward on already-published sites: `exact` (stay put), `auto-patch` (within `MAJOR.MINOR.x`), `auto-minor` (within `MAJOR.x.y`, the default). Most foundations should leave it unset — the runtime is backwards-compatible at the minor level by convention, so `auto-minor` lets sites pick up fixes without a foundation rebuild. Set `exact` only if you depend on undocumented runtime internals or have audited against one release. Site owners cannot override your choice.

`@uniweb/runtime` arrives **transitively** through `@uniweb/build`, so your foundation pins a runtime version without declaring one — that's intentional. **Don't add `@uniweb/runtime` to your foundation's dependencies**; to bump the pinned version, bump `@uniweb/build`. If the pin is missing or malformed, the platform serves the foundation through its legacy compatibility path — sites still work, they just don't participate in runtime propagation.

### Localization

**Content reaches components already translated.** There is no `t()`, no runtime lookup, no string wrapping — each language is a complete static build with its own HTML, `hreflang` tags, and search index. The default language has no URL prefix (`/about`); others are prefixed (`/es/about`).

**Translations live in `locales/`, a sibling of `pages/` at the site root — never inside `pages/`.** The markdown under `pages/` is one language: the default.

```yaml
# site.yml
defaultLanguage: en
languages: [en, es, fr]        # or [{ code: es, label: Español }, …], or '*' to
                               # auto-discover from the locales/ folder
publishLanguages: [en, es]     # optional — fr stays a dev-previewable draft,
                               # excluded from production output entirely
```

```bash
uniweb build                   # FIRST — extract scans built content, not source
uniweb i18n extract            # → locales/manifest.json, keyed by 8-char content hash
uniweb i18n init es fr         # → locales/es.json, locales/fr.json, pre-filled with source
#  …translate the values…
uniweb build                   # merges translations, emits dist/es/, dist/fr/
```

Running `extract` before a build is the usual first mistake — it reads the compiled content, so a stale build yields a stale manifest. After content changes, `uniweb i18n sync` updates the manifest and `init` refreshes the language files; `status` and `audit` report coverage and stale entries.

**Two mechanisms.** *Hash-based strings* (the default) — `locales/{locale}.json` maps content hash → translation, so structure stays identical across languages. When one source string needs different translations depending on where it appears, the value takes an override form:

```json
{ "e5f6g7h8": { "default": "Learn More", "overrides": { "/pricing:cta": "See Pricing" } } }
```

*Free-form bodies* — when a language needs different structure, different images, or copy rewritten rather than translated. The file replaces one section's content:

```
locales/freeform/es/pages/about/hero.md        # by page route
locales/freeform/es/collections/articles/x.md  # collections work too
```

These are **body only — no frontmatter**; params and config still come from the source section. `uniweb i18n init-freeform es pages/about hero` creates one pre-filled and records a source hash, so `uniweb i18n status --freeform` can tell you when the original moved on (`update-hash` to acknowledge). `move`, `rename`, and `prune --freeform` keep them aligned when pages get reorganized.

**Collections translate in the same `extract` run**, into their own manifest at `locales/collections/manifest.json`.

**Component side.** Nothing to do: `content.title` arrives in the active language. The one thing a foundation builds is a switcher.

```jsx
import { useWebsite, Link, getLocaleLabel } from '@uniweb/kit'

function LanguageSwitcher() {
  const { website } = useWebsite()
  if (!website.hasMultipleLocales()) return null

  return website.getLocales().map(locale => (
    <Link reload key={locale.code} href={website.getLocaleUrl(locale.code)}>
      {getLocaleLabel(locale)}
    </Link>
  ))
}
```

> **Use `<Link reload>` — not a plain `<a>`, and not `window.location.href`.** `getLocaleUrl()` returns a root-relative path that does **not** include the deployment base path, so under a subdirectory deploy (`base: /docs/` in `site.yml`) a raw href sends the visitor outside the site. `<Link reload>` prepends `website.basePath` and forces the full page load a locale switch requires — an SPA `<Link>` won't do, because the other language is a different build.

Full model: `development/internationalization.md`. Author's view: `authoring/translating.md`.

### Migrating from other frameworks

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
| `isDark ? … : …` conditionals | `text-heading` — context classes handle it |
| Per-component backgrounds | `background:` in frontmatter |
| Multiple near-identical components | One section type + `variant` param, or Front Desk |
| i18n wrapping (`t()` / `<Trans>`) | Locale-specific content directories |

**Approach:** scaffold with `--template none` → use named layouts for different page groups → dump legacy components under `components/` (they're not section types; import them from section types during transition) → create section types one at a time.

**It's incremental, not a rewrite.** Level **0** — paste the original as one section type; routing and dev tooling work immediately, and you have a running site. Level **1** — decompose into section types, consolidating duplicates via `variant` params or Front Desk. Level **2** — move content from JSX to markdown, so authors can edit without code. Level **3** — replace hardcoded colors with semantic tokens, so components work in any context. Each level is shippable; stopping at 1 is a legitimate outcome.

**The most common mistake** is recreating source colors as CSS custom properties — that bypasses the token system. Instead: primary color → `colors.primary` in `theme.yml`, neutral tone → `colors.neutral`, context needs → `theme:` frontmatter.

Also: name by purpose, not content (`TheModel` → `SplitContent`, `WorkModes` → `FeatureColumns`), and put UI helpers (buttons, badges, cards) in `components/` with no `meta.js`.

Full guide: `development/converting-existing.md`.

---

## Part 6 — Troubleshooting

Most Uniweb failures are **silent** — the build succeeds and the page is wrong. Check these first, because nothing in the terminal will point you at them.

**A red `Component not found: <Type>` box where a section should be** — the `type:` in that section's frontmatter names a section type this foundation doesn't have. `ls <foundation>/sections/` for the real list. The build does not fail on this, so it only surfaces by looking at the page.

**A param has no effect** — it isn't declared in that section type's `meta.js` `params:`. Undeclared frontmatter is passed through and ignored rather than rejected. Read the `meta.js` for the real knobs; if the one you want doesn't exist, exposing it is a foundation change.

**A section doesn't appear at all** — the file is `@`-prefixed (a child section, only rendered via `nest:`), or `_`-prefixed (treated as a draft and skipped), or it's a section type nested below the root of `sections/` without a `meta.js`, which means it was never discovered.

**Content lands in the wrong field** — a heading became a `subtitle` when you wanted an item, or the reverse. That's the level rule (exactly one level deeper = subtitle; skipping a level, or any body content first, starts items). Run `uniweb inspect <path>` rather than re-deriving it.

**A var in frontmatter does nothing** — component vars only apply when declared in that section type's `meta.js` `vars:`. Unknown names are ignored silently.

Loud failures:

**"Could not load foundation"** — check that the site's `package.json` depends on the foundation *by its workspace package name*. For the default layout that's `"src": "file:../src"`; for a co-located project (`docs/src` + `docs/site`) it's `"docs-src": "file:../src"`. The key must match the foundation's `package.json::name`, not the folder it happens to sit in.

**Component not appearing** — verify `meta.js` exists; check for `hidden: true`; rebuild the foundation.

**Styles not applying** — verify `@source` in `styles.css` includes your component paths.

**Prerender warnings about hooks** — components with `useState`/`useEffect` show SSG warnings during build in local symlinked mode. Expected and harmless.

**"document is not defined" during build** — your component touches `document`, `window`, or `localStorage` during render rather than inside `useEffect`. **Don't add `typeof document` guards** — use the kit hook instead: dark mode → `useAppearance()`, scroll detection → `useScrolled()`. Kit hooks are SSR-safe by design.

**A modal renders behind the page** — page content or a sidebar paints over your dialog and its backdrop, and raising the z-index changes nothing. Each layout area carries a `view-transition-name`, which makes it a stacking context your `fixed` element cannot escape. Render through `<Overlay>` from `@uniweb/kit` (see Part 4) instead of a bare `fixed inset-0 z-…` div.

**Content not parsing as expected** — `uniweb inspect pages/home/hero.md` (add `--raw` for the ProseMirror AST), or point it at a folder for a whole page.

---

## Documentation index

**Index of every page: https://www.uniweb.io/llms.txt** — start there when you don't know which page you need.

Source repo (public, cloneable): **https://github.com/uniweb/docs** · any page as raw markdown at `https://raw.githubusercontent.com/uniweb/docs/main/{section}/{page}.md`. See *Documentation* in Part 0 for when to fetch versus clone.

| Section | Covers |
|---------|--------|
| `architecture/` | Component Content Architecture — the why behind the patterns in this file |
| `getting-started/` | What is Uniweb, quickstart, templates |
| `authoring/` | Writing content, site setup, collections, theming, translations, predicates |
| `development/` | Foundations, component patterns, project structures, data, layouts, i18n, migration, schemas |
| `reference/` | site.yml, page.yml, content structure, meta.js, kit API, navigation, data fetching, CLI, deployment |

The by-task table is in Part 0. For CLI flags, prefer `uniweb <command> --help` over this file — it's always current.