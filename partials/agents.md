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

## Project Structure

Most projects start as a workspace with two packages:

```
project/
├── src/            # Component developer's domain (the foundation package)
├── site/           # Content author's domain
└── pnpm-workspace.yaml
```

A site is pure content. A foundation is the site's source code — that's why it lives in `src/`. The foundation's `package.json::name` is `src` (a unique workspace package name; symmetric with `site`).

- **Foundation** (developer, in `src/`): React components. Those in `src/sections` and `src/layouts` are *section types* — selectable by content authors via `type:` in frontmatter, or used for site-level layout areas (header, footer, panel). Most have a `meta.js` with metadata in them. Everything in `src/components` (or elsewhere) is ordinary React — the developer's workbench for helper components that section types import and compose internally.
- **Site** (content author, in `site/`): Markdown content + configuration. Each section file references a section type. Authors work here without touching foundation code. It may also contain collections of structured content and/or references to external data sources.

**The composition boundary:** Authors compose pages from finished section types — choosing types, writing content, setting params. Developers compose section types from building blocks — importing helpers from `components/`, using libraries, writing JSX. These are two different levels of composition. The section type is the boundary between them. Don't expose building-block composition to authors; build complete, self-contained section types that handle their own internal structure.

> Multi-site projects use sub-folders with site/foundation pairs in them (each project gets its own `src/` + `site/`), or segregate foundations and sites into separate folders (`foundations/`, `sites/`).

## Project Setup

Always use the CLI to scaffold projects — never write `package.json`, `vite.config.js`, `entry.js`, or `index.html` manually. The CLI resolves correct versions and structure.

**npm or pnpm.** Projects include both `pnpm-workspace.yaml` and npm workspaces. Replace `pnpm` with `npm` in any command below.

### New workspace

```bash
pnpm create uniweb my-project --template <n>
cd my-project && pnpm install
```
Use `--template <n>` for an official template (`none`, `starter`, `marketing`, `docs`, `academic`, etc.), `--template none` for foundation + site with no content, or `--blank` for an empty workspace.

### Adding a co-located project

```bash
uniweb add project docs
pnpm install
```

This creates `docs/src/` + `docs/site/` with package names `docs-src` and `docs-site`. Use `--from <template>` to apply template content to both packages.

### Adding individual packages

The CLI creates exactly the folder you ask for. No silent nesting under `foundations/` or `sites/` — the framework doesn't require a particular folder layout, so the CLI doesn't impose one.

```bash
uniweb add foundation           # No name → ./src/                    (package: src)
uniweb add foundation ui        # Bare name → ./ui/                   (package: ui)
uniweb add foundation foundations/effects   # Slash → folder is the path  (package: effects)
uniweb add foundation marketing --path libs # name + parent → ./libs/marketing/  (package: marketing)

uniweb add site                 # No name → ./site/                   (package: site)
uniweb add site blog            # Bare name → ./blog/                 (package: blog)
uniweb add site sites/store     # Slash → folder is the path           (package: store)
```

If the target folder already exists, or the package name is already taken by another package in the workspace, the CLI stops with a precise error and suggests alternatives. The check uses the same `classifyPackage` logic the build uses, so cross-type collisions are caught (you can't `add site marketing` if a foundation named `marketing` is already in the workspace).

Use `--project <n>` to co-locate a foundation+site pair under a project directory: `--project docs` → `docs/src/` (package `docs-src`) + `docs/site/` (package `docs-site`). The `-src` / `-site` suffix is the convention for co-located projects only — single-foundation workspaces use bare `src`.

### Adding section types

```bash
uniweb add section Hero
uniweb add section Hero --foundation ui   # When multiple foundations exist
```

Creates `sections/Hero/index.jsx` and `meta.js` with a minimal CCA-proper starter. The dev server picks it up automatically — no build or install needed.

### What the CLI generates

**Foundation** (`vite.config.js`, `package.json`, `main.js`, `styles.css`):
- `defineFoundationConfig()` in vite.config.js
- Dependencies pinned to current npm versions
- `@import "@uniweb/kit/theme-tokens.css"` in styles.css

**Site** (`vite.config.js`, `package.json`, `entry.js`, `index.html`, `site.yml`):
- `defineSiteConfig()` in vite.config.js
- `react-router-dom` in devDependencies (required by pnpm strict mode)
- Standard `start()` call in entry.js

## Commands

```bash
# Local development
uniweb dev                        # Start dev server (picks the site for you)
pnpm install                      # Install dependencies
pnpm build                        # Build for production
pnpm preview                      # Preview production build (SSG + SPA)

# Ship the site (uniweb verbs)
uniweb deploy                     # Deploy to Uniweb hosting (default; needs `uniweb login` first)
uniweb deploy --host=<adapter>    # Deploy to a static host: cloudflare-pages, netlify,
                                  # vercel, github-pages, s3-cloudfront, generic-static
uniweb deploy --dry-run           # Resolve foundation/runtime + print summary; no writes
uniweb export                     # Build dist/ for any static host (no Uniweb account)
uniweb publish                    # Publish a foundation to the Uniweb registry
uniweb doctor                     # Diagnose project configuration issues (--fix to auto-repair)
uniweb update                     # Align @uniweb/* deps + this AGENTS.md with the CLI's matrix.
                                  # Use --dry-run to preview, --yes for non-interactive.
                                  # `npx uniweb@latest update` pins to the latest release.

# Help
uniweb --help                     # Top-level help
uniweb <command> --help           # Per-command help (no side effects)
```

`uniweb deploy` auto-publishes a workspace-local foundation as part of the deploy under a site-scoped slot — no separate `uniweb publish` step needed for site-bound foundations.

**Staying current.** `uniweb update` aligns this project's `@uniweb/*` deps and `AGENTS.md` to the CLI that runs it; `uniweb doctor` reports drift without mutating. To pin to the newest published release, run `npx uniweb@latest update --yes` — no global install needed. The verb won't refresh AGENTS.md while declared deps still lag the CLI, or while edited deps haven't been installed: both would put the doc ahead of the code. Updating the CLI itself is your package manager's job (`npm i -g uniweb@latest`, `pnpm add -g uniweb@latest`, …); `uniweb update` does not do that.

---

## `package.json` `uniweb` configuration

The `uniweb` block in `package.json` carries platform-specific configuration that doesn't belong in the npm-standard fields. All fields are optional; defaults apply when omitted.

```json
{
  "name": "src",
  "version": "1.0.0",
  "uniweb": {
    "id": "marketing",
    "runtimePolicy": "auto-minor"
  },
  "dependencies": {
    "@uniweb/core": "0.7.8",
    "@uniweb/runtime": "0.8.9"
  }
}
```

| Field | Where used | Default | Purpose |
|---|---|---|---|
| `id` | `uniweb publish` | (set via `--name` or scoped `package.json::name`) | The foundation's published id — the bare-name segment in `@org/<id>`. Decoupled from `package.json::name` (a workspace concern), so renaming the foundation on the registry doesn't ripple through site dependencies. Only relevant for catalog-published foundations; site-bound foundations skip this. |
| `namespace` | `uniweb publish` | (none — see scope resolution) | Legacy explicit org-namespace override. Equivalent to using a scoped `package.json::name` (`"@myorg/foundation"`). Rarely needed in modern foundations. |
| `runtimePolicy` | `dist/runtime-pin.json` (foundation build) | `"auto-minor"` | Controls how sites using this foundation receive runtime updates. Three values: `"exact"`, `"auto-patch"`, `"auto-minor"`. See "Foundation runtime policy" below. |

**Catalog vs site-bound foundations.** Two distribution intents share the same `dist/foundation.js` artifact:

- A **catalog foundation** is a deliberate product — named, versioned, listed in the catalog, consumable by other developers' sites. Use `uniweb publish @org/name` for these. The CLI requires an explicit name argument so you don't accidentally catalog a foundation that was meant to be site-bound.
- A **site-bound foundation** powers exactly one site. Don't run `uniweb publish` for it. Just run `uniweb deploy` from the site directory — the CLI auto-publishes your local foundation as part of the deploy, **uploaded with the site's other published assets** (per-site storage, never to the catalog). With no naming ceremony, no catalog visibility, and no developer-vs-site ownership confusion. To later promote the foundation to a catalog product, run `uniweb publish @org/name` from the foundation directory and update the site's `site.yml` to a versioned ref (`foundation: '@org/name@1.2.3'`).

**On the split between `package.json::name` and `uniweb.id`:** the workspace name is what pnpm uses for `file:` linking and what `site.yml::foundation` references. The published id is what the registry stores. Keeping them separate means renaming on the registry (e.g. `marketing` → `marketing-pro`) is a one-shot `uniweb publish --name marketing-pro` — it persists to `uniweb.id` without touching the workspace.

These are the only fields the platform consumes today. Future platform features that need static configuration will land here too.

---

## Foundation runtime policy

(Foundation authors only — sites don't set this.)

When a foundation builds, it pins the `@uniweb/runtime` version it was built against (from its own dependencies) into `dist/runtime-pin.json`. Foundations can also declare a *policy* that controls how the runtime version moves forward on already-published sites:

```json
// foundation's package.json
{
  "name": "@uniweb/votiverse",
  "version": "0.1.1",
  "uniweb": {
    "runtimePolicy": "auto-minor"
  },
  "dependencies": {
    "@uniweb/core": "0.7.8"
  }
}
```

Three valid values:

| Value | Meaning |
|---|---|
| `exact` | The site stays on exactly the runtime version this foundation built against. Newer runtime versions are not auto-applied. |
| `auto-patch` | The site auto-updates within the same `MAJOR.MINOR.x` (e.g. `0.8.9` → `0.8.10`). Conservative; matches typical npm patch semantics. |
| `auto-minor` | The site auto-updates within the same `MAJOR.x.y` (e.g. `0.8.9` → `0.9.0`). |

**Default when unset:** `auto-minor`. Most foundations don't need to set this field — the platform's runtime is internally backwards-compatible at the minor level by convention, and `auto-minor` lets your foundation's sites pick up bug fixes and additive features without rebuilding the foundation.

Set `exact` if your foundation depends on undocumented runtime internals or has been audited against one specific runtime release and you don't want to allow drift.

The field is read by `@uniweb/build` at build time and emitted into `dist/runtime-pin.json` next to the runtime version:

```json
// dist/runtime-pin.json (auto-generated)
{ "runtime": "0.8.9", "policy": "auto-minor" }
```

Sites using your foundation will see this pin + policy when they're served. Site owners cannot override your policy choice — this is the foundation author's contract with the platform.

### Where does the pinned runtime version come from?

You may notice your foundation's `dist/runtime-pin.json` reports a runtime version (e.g. `0.8.9`) without your `package.json` declaring `@uniweb/runtime` anywhere. This is intentional.

`@uniweb/runtime` is pulled in **transitively** through `@uniweb/build` (which every foundation has as a devDependency). The runtime version baked into your foundation's pin is whichever version your `@uniweb/build` version pulled in at install time:

```
your foundation
  └─ devDependencies: "@uniweb/build": "0.12.0"
       └─ pulls in @uniweb/runtime  (whatever version that build version locks)
            → resolved at install time → version goes into dist/runtime-pin.json
```

Practical implications:

- **You don't need to add `@uniweb/runtime` to your foundation's dependencies.** Runtime is the host environment, not a foundation import.
- **To bump the runtime version your foundation pins, bump your `@uniweb/build` dep.** When a newer build version ships pulling in a newer runtime, updating your devDependency is how you adopt it.
- **You can override by adding `@uniweb/runtime` directly to your foundation's `dependencies`** — but this is rarely needed and creates two sources of truth for the runtime version. Don't do this unless you have a specific reason.
- **Whichever runtime version is pinned, your `runtimePolicy` controls how sites can move forward beyond it.** Pinning `0.8.9` with `auto-minor` lets sites pick up `0.9.0` or higher (within the same major); pinning with `exact` locks them at `0.8.9` until you rebuild your foundation.

### What happens when fields aren't set

The system has multi-layer fallbacks so missing or partial information is always handled gracefully:

| Scenario | What happens |
|---|---|
| **`uniweb.runtimePolicy` not set in `package.json`** | `dist/runtime-pin.json` is emitted with the runtime version but no `policy` field. At serve time the platform applies `auto-minor` as the implicit default. Most foundations don't need to set `runtimePolicy` — leaving it unset is the correct choice when you want default behavior. |
| **`@uniweb/runtime` not resolvable at build time** | The build silently skips emitting `runtime-pin.json`. This was the pre-Strategy-S behavior — your foundation falls back to the legacy self-contained build path. New foundations created with `npx uniweb create` always have `@uniweb/runtime` as a dependency, so this only affects unusual workspace setups. |
| **`runtime-pin.json` is missing or malformed** | The platform's edge dispatcher detects the absence and serves the foundation through the legacy bundling path (the foundation's own `ssr-worker-bundle.js` is used). Your sites still work; they just don't participate in runtime propagation. |
| **`runtime-pin.json` has a `runtime` version that's not actually deployed to the platform** | The site publish flow rejects the publish with a clear error message asking you to deploy the pinned runtime version first. This is caught at publish time, not at serve time. |
| **You set `policy: "auto-minor"` but no compatible newer version exists** | The site stays on the version you pinned. The resolver only moves forward when a newer version satisfying the policy is actually available. |

Bottom line: a foundation that doesn't set `runtimePolicy` gets `auto-minor` behavior automatically. A foundation that doesn't ship `runtime-pin.json` at all (e.g. a legacy build) still serves correctly through the platform's compatibility path — you just don't get the propagation benefits. Set `runtimePolicy` explicitly only when you want to override the default (typically to `exact` for stability-critical builds).

---

## Content Authoring

The decision rule: **would a content author need to change this?** Yes → it belongs in markdown, frontmatter, or a tagged data block. No → it belongs in component code.

Start with the content, not the component. Write the markdown a content author would naturally write, check what content shape the parser produces, *then* build the component to receive it.

**Markdown order ≠ rendering order.** The parser extracts content into a flat structure (`title`, `icons`, `images`, `paragraphs`). The component decides how to arrange these visually. Don't write markdown in visual order — write it in semantic order. Start sections with the heading, then add icons, images, and text in any order:

```markdown
# Site Name               ← title — always start with the heading
![](lu-graduation-cap)    ← icon — component controls where this renders
```

Placing content *before* the first heading changes the parse: headings after body content become items, not the section title. This is by design — it's how repeating content groups (cards, features) are created.

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

**Items have the full content shape** — this is the most commonly overlooked feature. Each item has `title`, `pretitle`, `subtitle`, `paragraphs`, `links`, `icons`, `lists`, `snippets`, and even `data` (tagged data blocks). You don't need workarounds for structured content within items:

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

**Subtitle vs items:** A heading immediately after the title becomes `subtitle` only when it is **exactly one level deeper** (H1→H2, H2→H3). Skipping levels (H1→H3) breaks the group — the deeper heading starts items instead. If you want items without a subtitle, use a `---` divider or a paragraph to close the title group:

```markdown
# Our Stats                       │  content.title = "Our Stats"
---                                │  ← divider closes the title group
## 15,000+                        │  content.items[0].title = "15,000+"
Students from 90 countries        │  content.items[0].paragraphs[0]
                                   │
## 200+                           │  content.items[1].title = "200+"
Programs offered                  │  content.items[1].paragraphs[0]
```

Without the `---`, `## 15,000+` would become `content.subtitle` instead of an item.

### Sequential content

`content.sequence` is the flat, ordered list of all elements before any grouping. Each element has a `type` (`heading`, `paragraph`, `image`, `codeBlock`, `dataBlock`, `list`, `link`, `divider`, `inset`, etc.) and type-specific fields. Use it when grouping isn't the right lens — for example, rendering prose in document order with `<Prose>`, or finding specific elements regardless of which group they ended up in:

```js
// All data blocks, regardless of heading groups
const allData = {}
for (const el of content.sequence) {
  if (el.type === 'dataBlock') allData[el.tag] = el.data
}

// All headings in order
const headings = content.sequence.filter(e => e.type === 'heading')
```

The grouped fields (`title`, `paragraphs`, `items`, `data`) and the sequential view (`sequence`) are two interpretations of the same content. Grouped is better for structured layouts (cards, features). Sequential is better for prose rendering and for finding content without caring about group boundaries.

### Choosing how to model content

You have three layers. Most of the design skill is choosing between them:

**Pure markdown** — headings, paragraphs, links, images, lists, items. This is the default. If the content reads naturally as markdown and the parser's semantic structure captures it, stop here. Most sections live entirely in this layer.

**Frontmatter params** — `columns: 3`, `variant: centered`, `theme: dark`. Configuration that an author might change but that isn't *content*. Would changing this value change the section's *meaning*, or just its *presentation*? Presentation → param. Meaning → content.

**Tagged data blocks** — for content that doesn't fit markdown patterns. Products with SKUs, team members with roles, event schedules, pricing metadata, form definitions. When the information is genuinely structured data that a content author still owns, a well-named tagged block (`yaml:pricing`, `yaml:speakers`, `yaml:config`) is clearer than contorting markdown into a data format. Supported formats: `yaml` and `json`. The format is a serialization format (how to parse the data), not a language for display. Tagged blocks are parsed at build time into JS objects and delivered as `content.data.tagName`.

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
![alt](./img.jpg){role=banner}          <!-- Role determines array: images, icons, or videos -->
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

`accent` (link-colored + bold), `callout` (accent-colored + bold), and `muted` (subtle) are built-in defaults that adapt to context automatically. Components receive HTML strings with spans applied: `<span accent="true">faster</span>`.

Sites can override these or define additional named styles in `theme.yml`'s `inline:` section.

### Fenced Code in Content

Fenced code in markdown serves two distinct purposes depending on whether it has a tag:

**Tagged data blocks** — structured data parsed into JS objects. The format (`yaml`/`json`) is a serialization format, not a display language. The tag is the key in `content.data`:

````markdown
```yaml:form
fields:
  - name: email
    type: email
submitLabel: Send
```
````

Access: `content.data?.form` → `{ fields: [...], submitLabel: "Send" }`. Supported formats: `yaml` (or `yml`) and `json`.

**Code snippets** — display content with a language for syntax highlighting. Available in `content.snippets` as `[{ language, code }]`:

````markdown
```jsx
function Hello() {
  return <h1>Hello world</h1>
}
```
````

Access: `content.snippets[0]` → `{ language: 'jsx', code: 'function Hello() {...}' }`. The `language` attribute is a display hint for syntax highlighting, not a parsing format. Filter by language: `content.snippets.filter(s => s.language === 'css')`.

Both appear in `content.sequence` for document-order rendering. The difference: tagged data blocks are parsed and extracted to `content.data`; code snippets are preserved and collected in `content.snippets`. `<Prose>` handles this automatically — it renders code snippets with syntax highlighting and skips tagged data blocks, which components access separately via `content.data`.

### Math (LaTeX)

Authors write LaTeX directly in markdown; the browser renders real math natively. The LaTeX is compiled to MathML Core **at build time** — no runtime math library ships to the browser, no CSS from a math package is required.

Three forms, matching Pandoc / GitHub / VS Code / Jupyter / Obsidian convention:

| Form | Mode | Example |
|---|---|---|
| `$x^2$` | Inline | `Let $f(x) = ax + b$ be a function.` |
| `$$x^2$$` | Display (block when on its own line, inline display mid-paragraph) | `$$\sum_{i=1}^n i$$` |
| ` ```math ` fence | Display (multi-line friendly) | see below |
| `\$` | Literal `$` | `The price is \$20.` |

Multi-line display math uses a `math` code fence:

````markdown
```math
\int_0^\infty e^{-x^2}\,dx = \frac{\sqrt{\pi}}{2}
```
````

Disambiguation for `$...$`: a dollar-delimited span counts as math only when the body has no whitespace next to the delimiters *and* the closing `$` is not immediately followed by a digit. So `It costs $5 and $10 total` and `Budget: $200` stay as prose without any escaping, while `Let $f(x) = 5$ be a function` is math. Use `\$` when you need a literal `$` in content where the rules would otherwise trip it up.

Math rides through the same content pipeline as everything else — it appears in prerendered HTML, survives `compile('epub')` and `compile('pagedjs')`, and roundtrips cleanly through the editor. Component code needs nothing special; `<Prose>` and `<Text>` already render the MathML that the pipeline embedded.

### Composition: Nesting and Embedding

Pages are sequences of sections — that's the obvious composition layer. But the framework supports real nesting: sections containing other sections, and sections containing embedded components. And it does this without leaving markdown.

**Insets — embedding components in content.** Many section types need a "visual" — a hero's illustration, a split-content section's media. The classic is an image or video. But what if it's a JSX + SVG diagram? A ThreeJS animation? An interactive code playground?

In other frameworks, this is where you'd reach for MDX, or prop-drill a component. In Uniweb, the content author writes:

```markdown
![Architecture overview](@NetworkDiagram){variant=compact}
```

Standard markdown image syntax — `![alt](@Component){attributes}`. The content author placed a full React component with content and params, and it looks like an image reference. The developer builds `NetworkDiagram` as an ordinary React component with `inset: true` in its `meta.js`. The kit's `<Visual>` component renders the first non-empty candidate — so the same section type works whether the author provides a static image, a video, or an interactive component:

```jsx
<Visual inset={block.insets[0]} video={content.videos[0]} image={content.images[0]} className="rounded-2xl" />
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

**What inset components receive:** Insets are full section types — they get `{ content, params, block }` like any other section. The alt text becomes `content.title`, and attributes become `params`:

```markdown
![npm create uniweb](@CommandBlock){note="Ready to go"}
```
→ CommandBlock receives `content.title = "npm create uniweb"` and `params.note = "Ready to go"`.

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

`ChildBlocks` renders each child as a bare component by default — no wrapper element, no context classes, no background. This is the right behavior for grid cells, tab panels, carousel slides, and inline children where the parent controls the container.

For the rare case where children should be independent sections with their own theming and backgrounds, pass `wrapAs`:

```jsx
<ChildBlocks from={block} wrapAs="div" />
```

**Data and child blocks:** Page-level `data:` is available to all blocks on the page, including children. Each child block resolves data independently through the same page → site hierarchy. If a child component needs data, declare it in the child's `meta.js` or in the child section's frontmatter (`data: articles`).

### Dividers — Content Boundaries

The `---` (horizontal rule) in markdown creates a boundary between content regions. The developer decides what each region means. Two patterns:

**Data-driven iteration (Loom).** Dividers separate header/body/footer in a repeated template. The content handler splits *before* Loom runs because each segment gets a different variable context — the body template contains item-level fields that don't exist on the top-level data. The header and footer are instantiated once against the full data; the body is repeated per data item.

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

The `source` frontmatter param names the data array to iterate. The content handler (see "Content Handlers" below) reads it. A second `---` starts a footer, rendered once after all items.

**UI regions (component).** Dividers separate structural areas that the component renders differently — e.g., lesson prose vs challenge content. `splitContent()` from `@uniweb/kit` splits the parsed content at divider elements in the sequence:

```jsx
import { splitContent } from '@uniweb/kit'

function Lesson({ content, block }) {
  const [lesson, challenge] = splitContent(content)
  return (
    <div>
      <Prose content={lesson} block={block} />
      <aside><Prose content={challenge} block={block} /></aside>
    </div>
  )
}
```

**When to use which:** Different data contexts per region → Loom pre-parse split (handled by the content handler). Same data, different UI treatment → kit post-parse split (`splitContent`). A foundation can use both — Loom splits and iterates to produce final content, then the component splits the result to route regions to different UI.

### Section Backgrounds

Set `background` in frontmatter — the runtime renders it automatically:

```yaml
background: /images/hero.jpg                             # Image
background: /videos/hero.mp4                             # Video
background: linear-gradient(135deg, #667eea, #764ba2)    # Gradient
background: '#1a1a2e'                                    # Color (hex — quote in YAML)
background: primary-900                                   # Palette token (bare name or var())
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
id: about                   # Stable identity (for page: links, survives moves)
order: 2                    # Navigation sort position
pages: [team, history, ...] # Child page order (... = rest). Without ... = strict (hides unlisted)
redirect: academic          # Redirect to child page (relative or absolute path, or URL)
```

**site.yml:**
```yaml
index: home                         # Just set the homepage
pages: [home, about, ...]           # Order pages (... = rest, first = homepage)
pages: [home, about]                # Strict: only listed pages in nav
```

**Route mapping:** Folder structure maps 1:1 to routes. Every folder keeps its natural route — `pages:` controls **order only**, not which child "becomes" the parent. The only exception is the site root: `index:` (or first in `pages:`) in site.yml sets the homepage at `/`.

**Content-less containers:** Folders with `page.yml` but no markdown are structural groups. They appear in `getPageHierarchy()` with `hasContent: false` and their own title/label. When visited directly, the runtime auto-redirects to the first descendant with content. This supports hierarchical navigation (courses → modules → lessons) at any depth.

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

**Semantic tokens** (available as Tailwind classes — `text-*`, `bg-*`, `border-*`):

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

Use with any Tailwind prefix: `text-heading`, `bg-section`, `border-border`, `bg-primary`, `text-primary-foreground`, `hover:bg-primary-hover`, `bg-error-subtle`, etc.

**Palette shades** are also available: `text-primary-600`, `bg-neutral-100`, `border-accent-300` — 11 shades (50–950) for each palette color (primary, secondary, accent, neutral). See `theme-tokens.css` for the complete mapping.

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
  callout:
    color: var(--accent)
    font-weight: '600'

vars:
  radius: 0.75rem
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

Most customization is handled by component params. Both section components and layout components declare their own params in `meta.js` — layouts are full components with params, not just structural wrappers. A header height, for example, is typically a layout param, not a foundation var.

Foundation-level CSS variables are for values that must stay consistent **across** multiple components — shared radii, spacing scales, or additional font roles beyond the three the theming system already provides (body, heading, mono). Don't reach for foundation vars when a component or layout param would do.

If you need them, declare vars in two places:

**`main.js`** — metadata for the editor and schema:

```js
export const vars = {
  'radius': { default: '0.5rem', description: 'Default border radius for cards and buttons' },
  'radius-lg': { default: '1rem', description: 'Large border radius' },
  'section-padding-y': { default: 'clamp(4rem, 6vw, 7rem)', description: 'Vertical section padding' },
}
```

**`styles.css`** — the actual CSS that ships with the foundation:

```css
@theme inline {
  --radius: 0.5rem;
  --radius-lg: 1rem;
  --section-padding-y: clamp(4rem, 6vw, 7rem);
}
```

The `styles.css` declaration ensures defaults are present in the foundation's CSS output and enables Tailwind shorthand (`rounded-(--radius)` instead of `rounded-[var(--radius)]`). The `main.js` declaration provides descriptions and types for the visual editor. Sites override values in `theme.yml` under `vars:` — the site's theme CSS takes priority over the foundation defaults.

**Common mistake:** Using foundation vars for values that belong to a specific component. A header height is a layout param, not a foundation var — the layout component owns it. A sidebar width is a layout param too. Foundation vars are for values that multiple unrelated components share — radii, spacing, shadows.

### Design richness beyond tokens

Tokens handle context adaptation — the hard problem. **They are a floor, not a ceiling.** A great foundation adds design vocabulary on top:

```css
/* styles.css */
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

All non-reserved frontmatter fields become `params`. Reserved: `type`, `preset`, `input`, `data`, `id`, `background`, `theme`, `source`, `where`. Everything else flows to the component.

### Data

A component on a page with a `data:` or `fetch:` declaration automatically receives that data in `content.data.{key}`. No opt-in required in `meta.js`. **Bound collections always arrive as arrays.** On a list page, `content.data.articles` is the full collection. On a template page (`[slug]/`), the matched record is delivered under the *same* collection key as a single-element array — the detail section reads `content.data.articles[0]`. When nothing matches, the key is `[]`. The runtime never coerces the array to a single object and never synthesizes a separate singular key.

```jsx
function Article({ content, block }) {
  if (block.dataLoading) return <DataPlaceholder />
  const article = content.data.articles?.[0]   // focused record on a [slug] page
  if (!article) return <NotFound />
  return <ArticleView article={article} />
}
```

Components can ignore keys in `content.data` they don't need — the same way unused `params` are ignored.

**Declaring data schemas.** `meta.js` declares the schema for each `content.data` key with a single `data:` field — there is no separate `schemas:` key. Each entry's value is one of: a **named ref** (`'@/article'` resolves to this foundation's `foundation/schemas/article.{js,json,yml}`; `'@uniweb/person'` is a shared standard), an **inline field map** (`{ field: { type, default } }`), or an **inline rich-form** (`{ fields: [...] }`, an editor form). Refs use Uniweb namespacing — `@/name` (self), `@uniweb/name` (shared standards) — resolved on disk at build time, never fetched. The schema is a hint: it supplies field defaults and drives the editor, not delivery (which is default-on). For an explicit opt-out (rare), set `data: false`.

```js
// meta.js
export default {
  data: {
    articles: '@/article',                               // named ref (this foundation)
    authors:  '@uniweb/person',                          // named ref (shared standard)
    pricing:  { tier: { type: 'string', default: '' } }, // inline field map
  },
}
```

When the same record needs to be a single object rather than a one-element array, that's the foundation's job: read `content.data.articles[0]`, or reshape `content.data` once with a `handlers.data` hook.

**Authoring queries.** Fetch declarations (`fetch:` or the `data:` shorthand) accept query operators that describe which records you want, in what order, how many: `where:` (a where-object predicate), `sort:` (e.g. `date desc`), `limit:` (first N records). Whether the source evaluates them or the framework applies them as a runtime fallback is a transport detail controlled by the site's `fetcher.supports:` declaration.

```yaml
# pages/blog/page.yml
fetch:
  collection: articles
  where: { published: true, tags: featured }
  sort: date desc
  limit: 3
```

**Lean lists with `deferred:`.** Collections with heavy fields (article bodies, large nested arrays) can declare `deferred: [body]` in `site.yml`. The cascade payload omits those fields; per-record full files are emitted at `/data/<name>/<slug>.json` (file-based collections — markdown, YAML, or JSON) or fetched from an author-declared `detailUrl:` pattern (API-backed collections). On dynamic-route pages the focused entity's full record is delivered automatically; elsewhere components fetch on demand via the `useEntityDetail` kit hook.

**Component-side fetching.** When a component genuinely needs to fetch something on its own (a search box, a "load more" button, a popover that lazy-loads), use the kit hooks (`useFetched`, `useCacheEntry`, `useEntityDetail`). They share the framework's cache and dispatcher with declarative fetches; same-key requests dedupe automatically.

See [Data Fetching](https://github.com/uniweb/docs/blob/main/reference/data-fetching.md) for the full model and [Predicates](https://github.com/uniweb/docs/blob/main/authoring/predicates.md) for the where-object format with examples.

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
| `block.rawContent` | object | ProseMirror document — passed internally when using `<Article block={block} />` |
| `block.themeName` | string | `"light"`, `"medium"`, `"dark"` |
| `block.stableId` | string | Stable ID from filename or `id:` |
| `block.key` | string | Unique key across pages (path + id) — use as React key |
| `block.path` | string | Page route this block belongs to |

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
import { H1, H2, H3, P, Span } from '@uniweb/kit'

<H1 text={content.title} className="text-heading text-5xl font-bold" />
<H2 text={content.subtitle} className="text-heading text-2xl" />
<H3 text={item.title} className="text-heading text-lg font-semibold" />
<P text={content.paragraphs} className="text-body" />
<Span text={listItem.paragraphs[0]} className="text-subtle" />
```

Kit provides `H1` through `H6` — use the appropriate level for semantic hierarchy. These render their own HTML tag — don't wrap: `<H2 text={...} />` not `<h2><H2 text={...} /></h2>`.

**Full content rendering** (article/docs sections where the author controls the flow):

```jsx
import { Section, Prose } from '@uniweb/kit'

<Section block={block} width="lg" padding="md" />
<Prose content={content} block={block} />
```

`Prose` renders from the parsed content sequence — headings, paragraphs, images, code snippets, lists, etc. — with prose typography. Tagged data blocks are **skipped** (they're structured data, not prose). Access them via `content.data` for custom rendering:

```jsx
function Lesson({ content, block }) {
  return (
    <div>
      <Prose content={content} block={block} />
      {content.data.quiz && <Quiz data={content.data.quiz} />}
    </div>
  )
}
```

Pass `content` (the parsed content object — has `.sequence`). Pass `block` too if the content uses insets. Also works as a pure typography wrapper: `<Prose>{children}</Prose>`.

`Article` is an older alternative that renders from `block.rawContent` (raw ProseMirror nodes) — it renders everything including data blocks. Prefer `Prose` for new components.

**Visuals:**

```jsx
import { Visual } from '@uniweb/kit'

<Visual inset={block.insets[0]} video={content.videos[0]} image={content.images[0]} className="rounded-2xl" />
```

### Kit API by Use Case

**Rendering text:** `H1`–`H6`, `P`, `Span`, `Div`, `Text` (with `as` prop)

**Rendering content:** `Section` (full section with prose + layout), `Prose` (prose from parsed content sequence, skips data blocks), `Article` (raw ProseMirror rendering), `Render` (ProseMirror nodes → React), `ChildBlocks` (render child sections)

**Rendering media:** `Visual` (first non-empty: inset/video/image), `Image`, `Media`, `Icon`

**Navigation and routing:** `Link` (`to`/`href`, `to="page:about"` for page ID resolution, auto `target="_blank"` for external, `reload` for full page reload), `useActiveRoute()`, `useWebsite()`, `useRouting()`

**Header and layout:** `useScrolled(threshold)`, `useMobileMenu()`, `useAppearance()`

**Layout helpers:** `useGridLayout(columns, { gap })`, `useAccordion({ multiple, defaultOpen })`, `useTheme(name)`

**Data and theming:** `useThemeData()` (programmatic color access), `useColorContext(block)`

**Utilities:** `cn()` (Tailwind class merge — `cn('px-4', condition && 'bg-primary')` resolves conflicts), `Link`, `Image`, `Asset`, `SafeHtml`, `SocialIcon`, `filterSocialLinks(links)`, `getSocialPlatform(url)`

**Other styled:** `SidebarLayout`, `Prose`, `Article`, `Code`, `Alert`, `Table`, `Details`, `Divider`, `Disclaimer`

### Hook Signatures

```js
useActiveRoute()    → { route, rootSegment, isActive(pageOrRoute), isActiveOrAncestor(pageOrRoute) }
useMobileMenu()     → { isOpen, open, close, toggle }  // auto-closes on route change
useScrolled(threshold?) → boolean                       // true when scrolled past threshold (px)
useAppearance()     → { scheme, setScheme, toggle, canToggle, schemes }
useWebsite()        → { website }                       // the Website object
useThemeData()      → Theme                             // programmatic color access
useColorContext(block) → 'light' | 'medium' | 'dark'   // current section context
```

`isActive` and `isActiveOrAncestor` accept a Page object or a route string. `useAppearance` reads `appearance:` from `theme.yml` — `scheme` is `'light'`|`'dark'`, `canToggle` reflects `allowToggle` config. Stores preference in localStorage, respects system preference.

### Icon Component

The `<Icon>` renders icons from content or explicit props:

```jsx
{content.icons.map((icon, i) => <Icon key={i} {...icon} />)}   // From content
<Icon name="search" />                                          // Lucide (default)
<Icon name="hi2-arrow-right" />                                 // Other library
<Icon name="close" />                                           // Built-in (no network)
```

The `name` prop handles everything: built-in names, Lucide icons (default when no library prefix), and other libraries via prefix (`hi2-arrow-right`, `tb-star`). From content, spread the icon object which has `library` + `name` fields.

Other props: `svg` (direct SVG string), `url` (fetch from URL), `size` (default `'24'`), `className`.

Built-in icons (instant, no network): `check`, `close`, `menu`, `chevronDown`, `chevronRight`, `externalLink`, `download`, `play`, and a few others.

### Content Patterns for Header and Footer

Layout sections (`header.md`, `footer.md`) are regular section types — they support the full content shape including tagged data blocks, lists, links, icons, and items. The only difference is they render on every page instead of one.

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

  // context and initialState: keys are developer-defined, not framework fields.
  // Design your own names for your foundation's cross-block communication.

  // Static — neighbors read via getNextBlockInfo().context
  context: {
    // Example: a Hero might declare this so a Header knows it can float.
    // allowTranslucentTop: true,
  },

  // Dynamic — neighbors read via getNextBlockInfo().state
  // Component can update with useBlockState()
  initialState: {
    // Example: Hero starts translucent-ready, but component logic may disable it.
    // allowTranslucentTop: true,
  },
}
```

All defaults belong in `meta.js`, not inline in component code.

### The Front Desk Pattern

Section types naturally use params to adjust their own rendering — `variant: flipped` reverses a flex direction, `columns: 3` sets a grid. That's not a pattern, that's the baseline.

The **Front Desk pattern** is when a section type does virtually no rendering itself. It reads the author's params, picks the right helper component, and translates author-friendly vocabulary into developer-oriented props. The section type is a front desk — it greets the request and routes it to the right specialist.

The workers behind the front desk don't need to share the same interface. A `Hero` might delegate to a `SliderHero` that renders an image carousel and a `ContactHero` that renders a quote request form. They expect different content and different props — that's fine. The front desk declares the **union** of all content its workers might need. Some content won't be used for a given variant, and that's perfectly normal in CCA — params change behavior, and that includes not rendering some content:

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
import { SliderHero } from '../../components/SliderHero'
import { ContactHero } from '../../components/ContactHero'

const variants = { slider: SliderHero, contact: ContactHero }

export default function Hero({ content, block, params }) {
  const Variant = variants[params.variant] || SliderHero

  return (
    <Variant
      // Shared — every variant gets these
      title={content.title}
      subtitle={content.paragraphs[0]}
      links={content.links}
      block={block}
      // Content that only some variants use
      images={content.images}
      formData={content.data?.quote}
      // Translated params — author vocabulary → developer props
      interval={params.slideInterval}
      compact={params.density === 'compact'}
      transition={params.style === 'dramatic' ? 'zoom' : 'fade'}
    />
  )
}
```

`SliderHero` uses `images`, `interval`, and `transition`; it ignores `formData` and `compact`. `ContactHero` uses `formData` and `compact`; it ignores `images` and `interval`. Each worker takes what it needs. Some params only matter for certain variants (`slideInterval` for slider, `density` for contact). Some are high-level names that the front desk translates into developer-oriented values (`style: dramatic` → `transition="zoom"`). The content author writes `variant: contact` — they don't know or care about `ContactHero`.

This is the system-building pattern at its clearest: **section types are the public interface** to your content system (author-friendly names, documented in `meta.js`). **Helper components are the implementation** (developer-friendly APIs, ordinary React props). The section type is the thin translation layer that connects the two worlds.

### Section components are composites

A section component is rarely a single flat render. It imports helper components from `components/` and utilities from `utils/` to build a complex UI while presenting a single `type:` to the content author. These directories are the developer's workbench — ordinary React and JS, not selectable by authors, not auto-discovered.

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

The content author writes `type: Pricing` and defines tiers as content items. The section component maps items to cards using a helper component from `components/` and a formatting utility from `utils/`. Neither is selectable by authors — they're implementation details behind the section type boundary.

**When to reach for this pattern:** When a page type has consistent structural elements (header bars, navigation footers, contextual sidebars) that the content author shouldn't need to add as separate sections. If the author would have to add the same boilerplate sections to every page of a certain type, the section component should compose them internally.

**Common mistake:** Solving structural repetition at the layout level. If only some page types need a content header (lessons do, the homepage doesn't), it's a section concern, not a layout concern. The layout owns the page-wide chrome (header area, sidebar area). The section owns its own internal structure.

### Foundation Organization

```
src/                     # the foundation package (folder name is `src`)
├── sections/            # Section types (auto-discovered)
│   ├── Hero.jsx         # Bare file — no folder needed
│   ├── Features/        # Folder when you need meta.js
│   │   ├── index.jsx
│   │   └── meta.js
│   └── insets/          # Organizational subdirectory (lowercase)
│       └── Diagram/
│           ├── index.jsx
│           └── meta.js
├── layouts/             # Custom layouts (optional, auto-discovered)
│   └── DocsLayout/
│       ├── index.jsx
│       └── meta.js
├── components/          # Your React components (no meta.js, not selectable)
│   ├── ui/
│   │   └── button.jsx
│   └── Card.jsx
├── utils/               # Helper functions, non-React logic
│   └── splitContent.js
├── main.js
├── styles.css
└── package.json         # name: "src"
```

**Discovery:** PascalCase files/folders at root of `src/sections/` are auto-discovered. Nested levels require `meta.js`. Lowercase directories are organizational only. `hidden: true` excludes a component entirely. Everything outside `src/sections/` is ordinary React.

**Source root.** The foundation package's source files live at the package root — the `src/` folder *is* the foundation. The build reads `package.json::main` to know that (for new scaffolds, `main: "./_entry.generated.js"`). Older foundations may use an even-more-nested layout where the source lives in `foundation/src/` and `main` points to `./src/_entry.generated.js`; both shapes work through the same code path.

**Import aliases:** Foundations include subpath imports in `package.json` for shared internals. Use them instead of brittle relative paths:

| Alias | Maps to | Use for |
|-------|---------|---------|
| `#components/*` | `./components/*` | Shared React components |
| `#utils/*` | `./utils/*` | Helper functions, non-React logic |

```jsx
// ✅ Clean — use aliases
import LessonHeader from '#components/LessonHeader'
import splitContent from '#utils/splitContent'

// ❌ Fragile — breaks if you reorganize sections/
import LessonHeader from '../../components/LessonHeader'
```

Within the same directory (e.g., one component importing a sibling), use normal relative imports (`./AIFeedbackCard`).

**Foundation entry shape (`main.js`).** A single `export default { … }` whose top-level keys are the capabilities the foundation provides — e.g. `name`, `description`, `defaultLayout`, `defaultSection`, `viewTransitions`, `props`, `defaultInsets`, `xref`, `outputs`, `handlers`. Optionally a named `vars` export for theme-variable metadata (see *Foundation variables*). Everything else (section types, layouts) is auto-discovered from `sections/` and `layouts/` and merged in by `@uniweb/build`. The build wraps your default export under `default.capabilities` in the produced `dist/foundation.js`; you don't write that wrapper yourself, and most foundation code never sees it. The one place it matters: when you import your **own** `main.js` from a foundation component (e.g., a download button calling `compileDocument(website, { foundation })`), you get the bare default object — pass it through directly, Press handles both shapes.

### Website and Page APIs

```jsx
const { website } = useWebsite()
const page = website.activePage

// Navigation — getPageHierarchy(options)
// Returns [{ id, route, navigableRoute, translatedRoute, title, label, description, hasContent, version, children }]
//
// Options:
//   for: 'header' | 'footer'  — filter by nav type (respects hideInHeader/hideInFooter)
//   nested: true (default)    — nested hierarchy with children; false = flat list
//   includeHidden: false       — include hidden pages
//   filter: (page) => bool    — custom filter function
//   sort: (a, b) => number    — custom sort function
//
// Convenience methods:
//   website.getHeaderPages()  — same as getPageHierarchy({ for: 'header' })
//   website.getFooterPages()  — same as getPageHierarchy({ for: 'footer' })
//   website.getAllPages()     — flat list: getPageHierarchy({ nested: false })
//
// Common patterns:
website.getPageHierarchy({ for: 'header' })           // Header nav (excludes hideInHeader pages)
website.getPageHierarchy()                             // Full nested hierarchy (no nav filtering)
website.getPageHierarchy({ nested: false })            // Flat list of all visible pages
website.getPageHierarchy({ nested: false, includeHidden: true })  // Everything including hidden

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
page.title, page.label, page.route, page.description
page.isHidden(), page.showInHeader(), page.showInFooter()
page.hasContent()                   // True if page has its own content (not just a folder)
page.hasChildren(), page.children   // Direct child Page instances
page.parent                         // Parent Page instance (null for root pages)
page.getNavigableRoute()            // First descendant route with content (for linking)

// Hierarchical navigation — content-less containers are group nodes:
// { route: '/courses/intro', title: 'Introduction', hasContent: false,
//   navigableRoute: '/courses/intro/lesson-1', children: [...] }
// Use navigableRoute for links, title for display, hasContent to style differently.
```

### Cross-Block Communication

Section types sometimes need to coordinate. The typical case: a Header needs to know whether the section below it supports a floating translucent overlay — a Hero with a full-bleed background does, a plain text section doesn't. The section that **owns the capability declares it**; the section that **needs to adapt reads it**.

`getBlockInfo()` exposes two channels:

- **`context`** — Static capabilities from `meta.js`. Never changes. The declaring section type always has this capability.
- **`state`** — Dynamic runtime state via `useBlockState()`. Can change based on component logic. Initial value comes from `initialState` in `meta.js`.

```jsx
// Header reads the next section's info to decide how to render
const nextBlockInfo = block.getNextBlockInfo()
// nextBlockInfo.context  → static (meta.js)
// nextBlockInfo.state    → dynamic (useBlockState)
```

**Static context** — Hero declares a permanent capability, Header reads it:

```js
// Hero/meta.js — "I always support a translucent header over me"
export default {
  context: { allowTranslucentTop: true },
}
```

```jsx
// Header/index.jsx — adapts based on what's below
const nextBlockInfo = block.getNextBlockInfo()
const isFloating = nextBlockInfo?.context?.allowTranslucentTop || false
```

**Dynamic state** — Hero declares an initial value but can change it at runtime:

```js
// Hero/meta.js — starts as true, but component logic may change it
export default {
  initialState: { allowTranslucentTop: true },
}
```

```jsx
// Hero/index.jsx — conditionally updates
function Hero({ content, block }) {
  const [state, setState] = block.useBlockState(useState)
  // state.allowTranslucentTop is true initially (from meta.js)
  // Component logic can change it: setState({ allowTranslucentTop: false })
}
```

```jsx
// Header/index.jsx — reads dynamic state, falls back to static context
const nextBlockInfo = block.getNextBlockInfo()
const isFloating = nextBlockInfo?.state?.allowTranslucentTop
  ?? nextBlockInfo?.context?.allowTranslucentTop
  ?? false
```

The key names (`allowTranslucentTop`, `expanded`, etc.) are yours to design — they're not framework fields. Define whatever protocol your foundation's sections need.

Other navigation methods: `block.getPrevBlockInfo()`, `block.page.getFirstBodyBlockInfo()`.

### Custom Layouts

Layouts live in `layouts/` (inside the foundation package) and are auto-discovered:

```js
// main.js
export default {
  name: 'My Template',
  description: 'A brief description',
  defaultLayout: 'DocsLayout',
}
```

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

**Layout meta.js** declares areas and optional scroll behavior: `{ areas: ['header', 'footer', 'left'], scroll: 'self' }`. Area names are arbitrary. The `scroll` property controls how the runtime manages scroll restoration: not set = runtime manages on `window` (default), `'self'` = layout handles its own scrolling, or a CSS selector (e.g. `'main'`) = runtime manages scroll on that element.

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

## Content Handlers

Content handlers are a transform layer that runs between data assembly and the component. They're declared in `main.js` and apply to every section in the foundation. The standard content shape (title, paragraphs, items, sequence) is the default — handlers can reshape it.

### The three hooks

The foundation declares handlers as an object in its default export:

```js
// main.js
export default {
  handlers: {
    data:    (data, block) => { /* ... */ },
    content: (data, block) => { /* ... */ },
    props:   (content, params, block) => { /* ... */ },
  },
}
```

All three are optional. Each runs per block and is error-isolated (a failing handler logs a warning and falls back to the default behavior).

| Handler | When it runs | Receives | Returns | Purpose |
|---|---|---|---|---|
| `data` | After data assembly, before content transform | `(data, block)` | New data object, or null | Filter, reshape, or augment the assembled data |
| `content` | After data handler | `(data, block)` | ProseMirror document, or null | Transform raw content (Loom instantiation, template expansion) |
| `props` | After parsing, defaults, and guarantees | `(content, params, block)` | `{ content, params }`, or null | Post-process the final shape before the component sees it |

### Loom integration

The most common use of content handlers is Loom-based content instantiation — resolving `{placeholder}` expressions in markdown against live data. `@uniweb/loom` provides a factory that creates the handler for you:

```js
import { createLoomHandlers } from '@uniweb/loom'

export default {
  handlers: createLoomHandlers({
    vars: (data) => data?.profile?.[0],
  }),
}
```

The `vars` function extracts the Loom variable namespace from the assembled data. The factory returns a `content` handler that reads the `source` and `where` frontmatter params — without `source`, the handler does simple substitution; with `source`, the handler splits the markdown at `---` dividers and repeats the body per data item (see "Dividers — Content Boundaries" above). When `where` is also set, the source array is filtered first — only items where the expression evaluates to truthy are iterated:

```yaml
---
type: PublicationList
source: publications
where: "type = 'book'"
---
```

`where` expressions use Loom Plain form: `type = 'book'` (equality), `year > 1870` (comparison), `refereed` (truthy check), `type = 'book' AND refereed` (boolean combination). Aggregate expressions in the header (like `{COUNT OF publications}`) reflect the filtered set.

### Writing a custom handler

When the factory doesn't cover your case, write handlers directly:

```js
import { Loom, instantiateContent, instantiateRepeated } from '@uniweb/loom'

const loom = new Loom()

export default {
  handlers: {
    content: (data, block) => {
      const profile = data?.profile?.[0]
      if (!profile) return null

      const doc = block.rawContent?.doc ?? block.rawContent
      const source = block.properties?.source

      if (!source) return instantiateContent(doc, loom, profile)
      return instantiateRepeated(doc, loom, profile, source)
    },
  },
}
```

The content handler receives `block.parsedContent.data` and reads raw ProseMirror from `block.rawContent`. It returns a new ProseMirror document — the framework re-parses it through the semantic parser. Returning `null` or the same reference as `block.rawContent` signals no change.

### Reserved frontmatter fields

`source` and `where` are convention-level reserved fields — they flow through to both `block.properties` (for handler access) and `params` (visible to components). Components can ignore them. This is consistent with how `background` and `theme` work. List them in `meta.js` params with descriptions so the editor and schema recognize them.

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

3. **Dump legacy components under `components/`** — they're not section types. Import from section types during transition.

4. **Create section types one at a time.** Migration levels:
   - **Level 0**: Paste the original as one section type. Routing and dev tooling work immediately.
   - **Level 1**: Decompose into section types. Consolidate duplicates — use `variant` params or the Front Desk pattern.
   - **Level 2**: Move content from JSX to markdown. Authors can now edit without code.
   - **Level 3**: Replace hardcoded colors with semantic tokens. Components work in any context.

5. **Map source colors to `theme.yml`.** The most common mistake is recreating source colors as CSS custom properties — this bypasses the token system. Instead: primary color → `colors.primary` in theme.yml. Neutral tone → `colors.neutral`. Context needs → `theme:` frontmatter.

6. **Name by purpose, not content** — `TheModel` → `SplitContent`, `WorkModes` → `FeatureColumns`.

7. **UI helpers → `components/`** — Buttons, badges, cards in `components/` (no `meta.js`, not selectable by authors).

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

## Troubleshooting

**"Could not load foundation"** — Check `site/package.json` has `"foundation": "file:../foundation"`.

**Component not appearing** — Verify `meta.js` exists. Check for `hidden: true`. Rebuild: `cd foundation && pnpm build`.

**Styles not applying** — Verify `@source` includes your component paths.

**Prerender warnings about hooks** — Components with useState/useEffect show SSG warnings during build in local symlinked mode. Expected and harmless — the page renders correctly client-side.

**"document is not defined" during build** — Your component accesses `document`, `window`, or `localStorage` during render (not inside `useEffect`). Don't add `typeof document` guards — use the kit hook instead. Dark mode? `useAppearance()`. Scroll detection? `useScrolled()`. Kit hooks are SSR-safe by design.

**Content not appearing as expected?**
```bash
uniweb inspect pages/home/hero.md         # Single section
uniweb inspect pages/home/                 # Whole page
uniweb inspect pages/home/hero.md --raw    # ProseMirror AST
```

## Learning from Official Templates

When you're unsure how to implement a pattern — data fetching, i18n, layouts, insets, theming — install an official template as a reference project in your workspace:

```bash
uniweb add project marketing --from marketing
pnpm install
```

This creates `marketing/src/` (the foundation, package `marketing-src`) + `marketing/site/` (the site, package `marketing-site`) alongside your existing project. You don't need to build or run it — just read the source files to see how working components handle content, params, theming, and data.

**What to study:**
- `{name}/src/sections/` — components with meta.js (content expectations, params, presets)
- `{name}/site/pages/` — real content files showing markdown → component mapping
- `{name}/site/theme.yml` + `site.yml` — theming and configuration patterns

**Available templates:**

| Template | Demonstrates |
|----------|-------------|
| `marketing` | Semantic tokens, insets, grids, multi-line headings, inline styling |
| `docs` | Sidebar navigation, navigation levels, code highlighting |
| `dynamic` | Live API data fetching, loading states, transforms |
| `international` | i18n, blog with collections, multi-locale routing |
| `store` | Product grid, collections, e-commerce patterns |
| `academic` | Publications, team grid, timeline, math |
| `extensions` | Multi-foundation architecture, runtime loading |

You can install multiple templates. Each becomes an independent project in the workspace. To run one in dev: `cd {name}/site && pnpm dev`

## Further Documentation

Full documentation: **https://github.com/uniweb/docs**

| Section | Path | Topics |
|---------|------|--------|
| **Getting Started** | `getting-started/` | What is Uniweb, quickstart, templates |
| **Authoring** | `authoring/` | Writing content, site setup, collections, theming, translations |
| **Development** | `development/` | Foundations, component patterns, data fetching, layouts, i18n |
| **Reference** | `reference/` | site.yml, page.yml, content structure, meta.js, kit API, CLI, deployment |

**Quick access:** `https://raw.githubusercontent.com/uniweb/docs/main/{section}/{page}.md`
