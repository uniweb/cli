# AGENTS.md

*This file ends with the line `End of AGENTS.md`. If you can't see that line, your tool cut the file short (Codex stops at `project_doc_max_bytes`, 32 KiB by default): read the rest of `AGENTS.md` yourself.*

A Uniweb project separates **what the site says** from **how it's built**. The site is structured content, not prose: a section file's frontmatter names a section type and sets its params; its body is written in markdown but is **parsed into a typed content object** — `title`, `subtitle`, `paragraphs`, `links`, `items`, `data`, … — before any component sees it. Markdown is the authoring syntax, not the thing rendered: headings mark structure, not size, and a heading after body text starts an item.

The foundation is the React that receives that object, under a runtime that owns the content pipeline, section wrapping, backgrounds, theming, light/dark, prerendering, routing and i18n. The components that face authors — **section types**, in `sections/` — receive `{ content, params, block }` and render; they are the only components with that signature. Developers define the vocabulary; authors compose with it. Everything behind one, in `components/`, is ordinary React with ordinary props: install any package, import any library, use any pattern. The foundation is a normal Node project; the few things you don't install (2.1, 2.4) are the exceptions.

§1 says why the constraints are worth keeping; §2 is where your priors are wrong — each row a reflex from React / Next / Astro / Vite habits, what Uniweb does instead, and whether anything will tell you. Read both, then follow §3 before touching a file; its step 6 loads the lane guide and is not optional. Commands are written `uniweb <command>`; without a global install, run them in the project as `npx uniweb <command>`.

## 1. Why this is worth doing right

Uniweb is an implementation of **Component Content Architecture (CCA)**: content and components are separate artifacts — different files, packages and maintainers — joined by a thin runtime at build time and in the browser. Full argument: `uniweb.io/docs/architecture/component-content-architecture.md`. What it buys you:

**You write less.** A section type carries no theme maps, null checks, hardcoded strings, wrapper element, sticky-spacer arithmetic or fetch lifecycle: the runtime does each once, for every section. What remains is rendering logic.

**Your work survives.** A component built on tokens renders correctly in every section context, on every site that adopts the foundation, through every rebrand, in the visual editor and in prerendered HTML. A component with `text-gray-900` breaks the first time an author writes `theme: dark`.

**Nothing has to be guessed.** The content shape is guaranteed. The directory listing is the catalog. `meta.js` is the interface. `inspect` prints the truth. The architecture removes exactly the uncertainties — what shape, which component, what it accepts — that make agents invent things.

**Other people can act without you.** Every param you declare and every content slot you name is something an author can change in markdown or in the visual editor with no developer, no build and no pull request. The care you put into `meta.js` is the autonomy someone else gets.

**A section type is a front desk, not a worker.** It reads params, picks a worker, and translates author vocabulary (`content`, `params`) into developer vocabulary (ordinary props). The workers live in `components/` and know nothing about CCA. That is the whole shape of a foundation: thin section types at the boundary, ordinary React behind them.

```jsx
const workers = { slider: SliderHero, contact: ContactHero }
export default function Hero({ content, params, block }) {
  const Worker = workers[params.variant] || SliderHero
  return <Worker title={content.title} links={content.links} images={content.images} block={block} />
}
```

One `type:` for the author, as many renderings as the design needs. A second section type that differs only in layout, or a conditional tree inside one, means you want a param and a worker.

**Content is an offer, not a contract.** As the developer: a section type takes what it expects from `content` — the first paragraph if it needs one, every paragraph or every item only when showing them all is the point — and neither touches nor reacts to the rest. No check for unexpected content, no warning. `meta.js content:` says what the type *reads*, not what a section may hold, and a param combination that leaves some content unused is normal. As the author: write what the type reads; extra content isn't a goal. The tolerance exists so that switching `type:` or a `variant` is a one-line trial — change it, compare, switch back — with nothing to rewrite first. When you make such a switch, don't strip what the new rendering ignores; whether it stays is the author's decision once the trial is settled.

The principles to reason from when a table in §2 doesn't cover the case:

- **The foundation provides options; the site configures.** The foundation doesn't know which site it serves; the site doesn't know how the foundation is built.
- **Components render from content, not context.** Never the URL, the router or the layout; variation comes through params or a different type, chosen by the author.
- **Configuration cascades** page → folder → site → foundation, like CSS specificity: defaults high, exceptions local.
- **Metadata declares the interface.** `meta.js` drives defaults, the editor's controls, the schema and the docs.
- **The site owns the theme.** Foundations declare variables, sites set values, components use tokens.

When a rule in §2 feels like friction, that is the moment you are about to take back a job the runtime already does — and do it worse, once per component instead of once per site. The architecture doesn't limit what you can build; it fixes where each decision lives.

## 2. Where your priors are wrong

### 2.1 Project and tooling

| By reflex you'd… | Here | Signal |
|---|---|---|
| Write `package.json`, `vite.config.js`, `index.html`, an entry file | `npx uniweb@latest create <name> --template <t>`; `uniweb add site / foundation / section / project / extension`. The CLI owns those files. | build fails far from the cause |
| `npm install` a foundation or theme; `npm install @uniweb/runtime` | A foundation is a workspace `file:` dependency or a catalog ref in `site.yml`, never an npm package. In a foundation the runtime arrives through `@uniweb/build`. Everything else — a carousel, a chart library, a date utility, `@uniweb/api` — you install in the foundation as in any project. | npm 404 / silent version skew |
| `npm update` / `pnpm update` the `@uniweb/*` packages; `npx uniweb update` | `npx uniweb@latest update --yes` (`--yes` because there is no terminal to answer the prompt). The packages are a matched set and AGENTS.md updates with them. Without `@latest` it runs the CLI the project already pins and reports "aligned". | `status` and `doctor` name the drift |
| Assume `localhost:5173`; run `npm run dev` inside the site | `uniweb dev` serves the site you are in (from the workspace root, the first, with a notice); read `Serving <site> at <url>`. `uniweb dev --status` / `--stop` know only that server. | wrong server, silent |
| Read `foundation:` in `site.yml` as a path | A **package name**. Follow the `file:` dep in the site's `package.json`. `@org/name@1.2.3` means the source is not in this repo. | the build: `did not resolve` |
| Trust folder names for the workspace layout | `pnpm-workspace.yaml` globs decide (§3.2). | — |
| `main.jsx`; JSX in a `.js` file | `main.js` is plain JS; JSX lives in `.jsx`. | build stops |
| Guess which section types exist or what a param is called | `ls <foundation>/sections/`, `cat …/<Type>/meta.js`. Every foundation's vocabulary is different; `uniweb docs --from-source` writes it all to `COMPONENTS.md`. | red box / silent |
| Predict what markdown parses to | `uniweb inspect <file>` prints the shape. | silent (wrong field) |
| Rely on what you remember about Uniweb | The pinned version is the truth: `uniweb <cmd> --help`, `uniweb guide`, `uniweb.io/llms.txt` (§6). A 404 on a URL you invented means your guess was wrong. | — |
| `--force` past a refusal; treat `git push` as deploy; publish on the person's behalf | Never force. Commit your own work as you go. `git push`, creating a site on a backend, going live, spending money and whatever `status` marks "ask the person first" are theirs. | push refused / money |

### 2.2 Content

| By reflex you'd… | Here | Signal |
|---|---|---|
| Pick heading levels for size | Levels are **structure**: `#` title; exactly one step smaller = `subtitle`; two steps smaller, a `---`, or any heading after body text = an `item`. `###` right after `#` is an item; `##` is a subtitle line. A later heading as large as the first leaves no `title`: all of them become items. | silent |
| Order the file the way the page should look | Write semantically; the component arranges. | — |
| Put an icon or image above the title, as it will look | Anything above the first heading empties `title`: an icon or text puts the heading in `items[0]`, an image puts it in `headings`. Write it under the heading — it is still `icons[0]` or `images[0]`. | silent; `inspect` shows it |
| `<span class>`, `<div>` in markdown | Shown as text. `[text]{accent}`, `**bold**`; a line break is `<br>` or a trailing `\`. | build names the file |
| Write `pages: [a, b]` or `sections: [a, b]` to set order | Those lists are **strict**: an unlisted page leaves every menu, an unlisted section leaves the page. `[a, b, ...]` means "these first". At the site root the first of `pages:` is `/`, whatever `index:` says. | silent |
| `primary: #3b82f6` | `'#3b82f6'` — an unquoted `#` starts a YAML comment. | build warns |
| Expect any frontmatter key to do something, any `type:` name to work | A key reaches `params` and does nothing unless the type reads it (its `meta.js` says which); one named for a content field (`title:`) replaces that field. Only types present in `sections/` work. | silent / red box |
| Strip the content a new `type:` / `variant:` won't render before switching | Nothing to strip (§1): the switch is a one-line trial, and what stays afterwards is the author's call. | content loss |
| `pages/fr/about.md` for French | `locales/` beside `pages/`; `pages/` holds the default language only. | silent — it becomes a page at `/fr` |
| `t('key')`, `<Trans>` | Nothing — content arrives translated; each language is its own build. | — |
| `src/assets/`, `assets/img.png` | `./img.png` beside the page, or `/img.png` in `public/`. There is no assets folder. | build stops, or warns |
| `fetch: /api/posts`, `fetch: ./data.json` | `fetch:` names a query from `queries.yml`; a URL belongs on the query (`url:`). | build stops |
| `records/blog/2025/post.md`; one YAML file holding a list | Flat: `records/<schema>/<name>.md`, one record per file; the file name is `$name`. | folder read as a schema, silent |
| `` `/blog/${slug}` `` | `item.$route` — never compose a URL. | works until a page moves |
| `page.yml` in a folder of pages | It makes one page, each `.md` a section. `folder.yml` keeps them pages and carries `layout`, `title` and SEO. Over a mount, `page.yml` with markdown of its own is a landing page *above* the mounted pages; a mount is one level under `pages/`, and a local subfolder beside it isn't read. | silent; the build names that subfolder |
| Paste the gtag / GTM / Meta pixel snippet into a component, `index.html`, or `services.tracking.scripts` | Uniweb Cloud (`publish`): `services.google: { id: G-… }`, or `GTM-…` for a container, and the host loads Google's tag, free, with no code, on any foundation. `head.html` isn't applied there, and `scripts` takes URLs only. Static build (`export`, `deploy --host`): the snippet in `head.html` beside `site.yml`. More: `uniweb guide services`. | silent — Google reports nothing |
| Expect `{company}` to resolve | Only under a foundation with `createLoomHandlers`; otherwise it renders literally. | build warns if `site.yml` has `placeholders:` |
| `hidden: true` on `pages/404/` to keep it out of nav | That makes it a draft. `hideIn: ['*']` controls nav. | silent |
| Treat `@child.md` / `_draft.md` as names | `@` = child section, placed by `nest:` (with none it renders last; a `sections:` list drops it); `_` = ignored. | build warns, unless `sections:` dropped it |

### 2.3 Section types and the components behind them

| By reflex you'd… | Here | Signal |
|---|---|---|
| Wrap the component in `<section>`; `Header.as = 'header'` | The runtime wraps every section in a bare `<section>` (no padding to reset); `Type.className` adds classes to it. The built-in layout already wraps the header and footer areas in `<header>`/`<footer>`. | double element |
| `{content.title}` in JSX | Content fields are **HTML strings**: `<H1 text={content.title} />`. | tags show as text |
| `<h2><H2 text=… /></h2>` | Kit text components render their own tag. | double tag |
| `content.items?.map`, `content.title ?? ''` | Never null — strings and arrays, always. | — |
| `className="sticky top-0"` | `sticky: true` in the type's `meta.js`. | `uniweb dev` names it |
| `fixed inset-0 z-[9999]` for a modal | `<Overlay>` from kit — layout areas are stacking contexts, no z-index escapes one. | silent — under the header |
| `typeof window`, `localStorage.theme`, a theme `useEffect` | `useAppearance()`; the scheme is resolved before first paint; kit hooks are SSR-safe. | theme flash |
| `<a href="/about">` | `<Link to="page:about">` (an `id:` survives moves) or `<Link href="/about">`. A bare `<a>` still routes but resolves no `page:` and adds no base path or locale. | silent |
| `window.location.href = '/fr'` to switch language | `<Link reload href={website.getLocaleUrl('fr')}>` or `website.switchLocale('fr')`. | base-path bug |
| `useEffect(() => fetch(…))` for records | Declare the key in `meta.js data:`; it arrives in `content.data`, prerendered. | prerenders as loading |
| `<Icon icon="lu-send" />` for an icon your section always shows | Import it (`uniweb guide foundation` § Icon). A name is for an icon content supplies at runtime: markdown, a param, a record's field. | silent; blank until the browser fetches it |
| A `Button` or `Card` in `sections/` | `components/`. Everything at the root of `sections/` becomes author vocabulary. | appears in the section picker |
| Helpers that take `{ content, params }` | Ordinary props. That signature is for section types only. | — |
| One section type per visual variant; or one with a conditional tree inside | A front desk (§1): one `type:`, a `variant` param, workers in `components/` with ordinary props. | author vocabulary bloats; variants invisible to the editor |
| Validate, enumerate or warn on content the component doesn't use; treat `content:` as an exact schema | Take what you expect and don't touch the rest (§1). `content:` declares what the type reads. | — |
| `params: { theme, background, grid, sticky, query }` | Section settings — read from `block`, never declared. | build warns |
| Write `meta.js` as internal metadata | It is the visual editor's UI and other agents' catalog. Labels for people, defaults for everything, author words for params (`columns`, not `gridCols`). | — |
| `window.uniweb`, `globalThis.uniweb` | `@uniweb/kit` and `block.*` only. | — |
| `<P text={member.bio} />` | Member and API text is **text**: `{value}` or `<PlainText>`. Only parser strings are safe HTML. | XSS |
| "Search unavailable" / a disabled control when a service is off | Draw nothing. `isSearchEnabled()`, `isSubmitEnabled()`, `isBackendEnabled()`, `isAssistantEnabled()`. | — |
| `fetch('/_agent/chat')`, a hardcoded search URL | `resolveService(website, 'assistant')`. | 404 on static hosts |
| `if (enabled) track(…)` | Never guard; with no destination `track()` is a no-op. | — |
| framer-motion `initial` / `animate` for an entrance | CSS animation — JS misses the prerendered first paint. | silent; only a build shows it |

### 2.4 Styling and theme

| By reflex you'd… | Here | Signal |
|---|---|---|
| `bg-white` / `bg-gray-900` on the section | `background:` in frontmatter; the runtime paints it. | breaks in dark context |
| `dark:text-white`, `isDark ? … : …` | Tokens adapt per **section context** (`theme:` on the section): `text-heading`, `text-body`, `bg-section`, `bg-card`, `border-border`. | breaks in context |
| `text-slate-900`, `text-blue-600` | Tokens, or palette shades from `theme.yml`: `text-primary-600`, `bg-neutral-100`. | silent |
| `:root { --brand: #… }` | `theme.yml colors:` → 11 shades + semantic tokens. | bypasses theming |
| `font-serif`, `font-sans` | Tailwind's stack, not the site's — unless the foundation declares it as a `font-*` var in `main.js`. Families are the site's (`theme.yml fonts:`). | silent |
| `@import url(fonts.googleapis…)` in CSS | `theme.yml fonts.import` / `faces`. | — |
| `@tailwind base;` | Tailwind v4: `@import "tailwindcss"` plus kit's token imports (theme guide). | silent — most utilities missing |
| Trust the foundation's own build to prove a class works | A site build and `uniweb dev` read only the folders `@source` names — one line per folder that writes classes (`sections`, `components`, `layouts`). | each names a folder you missed, as does `doctor` |
| `prose` from `@tailwindcss/typography`, `prose-invert` | `@import "@uniweb/kit/prose-tokens.css"`; no invert — colors are already the theme's. | build warns; unstyled lists |
| `html { scroll-behavior: smooth }` | Never on `html`/`body`; the runtime owns scrolling. | route transitions misbehave |
| `filter: blur(80px)` for a glow | Radial gradient + `mask-image`. | Safari jank |

## 3. The procedure, every task

**1. `uniweb status`.** It says what the site is, where it's synced and live, what changed since this copy last synced, and ends with the commands to run, in order. Run it when you begin, when you return, before push/publish/deploy, and after any refusal. Two things it will not decide for you:

- Never `--force` past a refusal, and leave the person's decisions to them (2.1).
- A copied project still carries the original's `sync.json`. `uniweb forget --all` in the copy before its first push, or the push updates the original's site.

**2. Read the workspace shape** from `pnpm-workspace.yaml` globs:

| Globs | Layout | Implies |
|---|---|---|
| `src`, `site` | single (default) | foundation `src/`, site `site/` |
| `foundations/*`, `sites/*` | segregated | a foundation edit hits every site sharing it |
| `*/src`, `*/site` | co-located | one pair per project: `docs/src` + `docs/site` |
| `*/src`, `*/sites/*` | projects with sites | each project's foundation with its own sites |
| plus a package whose `main.js` has `extension: true` | extensions | extra section types, runtime-loaded |

A site is any package with a `site.yml`. `paths:` in `site.yml` can mount another folder or repo into the page tree, so a route's markdown may not live under `pages/`.

**3. Find the foundation by the wiring.** `"docs-src": "file:../src"` in the site's `package.json` → `docs/src/`.

| `foundation:` value | Source in this repo? | Can you add a section type? |
|---|---|---|
| a workspace package name | yes — follow the `file:` dep | yes |
| `@org/name@1.2.3` (catalog ref; `@org/name` with no version must be a workspace package) | no | no — work within its types |
| `https://…` or `{ url: … }` | no | no |

`extensions:` entries take the same shapes, plus `/<name>/entry.js` for a static build, which `add extension` writes and `publish` refuses (`uniweb guide ship`). The primary foundation wins on a name collision.

**4. Learn the vocabulary.**

```bash
ls <foundation>/sections/                 # the section types that exist (repeat per extension)
cat <foundation>/sections/Hero/meta.js    # what it expects, what it accepts, its presets
```

**5. Pick a lane.**

| Task | Lane | Files |
|---|---|---|
| Add / edit / reorder a section; add a page | content | `<site>/pages/**` |
| Colors, fonts, light/dark | content | `<site>/theme.yml` |
| Header, footer, nav content | content | `<site>/layout/*.md`, page order in `site.yml` |
| How a section type looks everywhere; a new type; a new knob | foundation | `<foundation>/sections/<Type>/` (+ `meta.js`) |

On a content task and tempted to open the foundation: stop — usually a param already exists; re-read that type's `meta.js`. If it doesn't, that's a foundation change: say so rather than crossing quietly, because it changes every page using the type and, in a segregated workspace, every site sharing the foundation.

**6. Run `uniweb guide <lane>` — before writing, not when stuck.** `uniweb guide content` or `uniweb guide foundation` prints the lane's guide; read all of it, and if your tool cuts long output, `--path` gives you the file. The parse rules, the kit API and the layout system live there, not in your memory of other frameworks. A task that touches colors or fonts, or crosses into records, services, a backend, another language or shipping, runs that guide too (§6). This file is deliberately the short part; the guide is the rest of it.

**7. Work in the lane, and check as you go.**

```bash
uniweb inspect pages/home/hero.md   # from the site dir: the parsed shape (--full, --sequence, --raw; a folder = the page)
uniweb doctor                       # project configuration (--fix repairs)
uniweb validate                     # records against declared schemas
uniweb <command> --help             # exact flags, no side effects
```

`inspect` every section you write. Look at the page — the terminal won't report most of §4.

## 4. The build is green and the page is wrong

| Symptom | Cause |
|---|---|
| Red `Component not found: <Type>` box | `type:` not in `sections/` (or an extension) |
| A section doesn't render | left out of a strict `sections:` list; `_`-prefixed; a type nested below the root of `sections/` without `meta.js` |
| A heading landed in the wrong field | the step rule (2.2) — `inspect` |
| `title` empty | something (an icon, an image, a line of text) sits above the first heading, or a later heading is as large as the first |
| Pages missing from the nav | a strict `pages:` list — add `...` |
| A color is empty | unquoted `#` in YAML |
| Literal `{name}` on the page | no Loom content handler |
| A class works in the foundation's build, not in the site's or `uniweb dev` | its folder has no `@source` line — `uniweb doctor` names it |
| Sticky header scrolls away | `sticky` class instead of `sticky: true` in `meta.js` |
| Modal under the header | z-index instead of `<Overlay>` |
| Entrance animation never plays | JS-started; write it in CSS; `uniweb dev` doesn't prerender |
| Colors wrong in one section only | hardcoded color classes instead of tokens |
| Wrong typeface | `font-serif` / `font-sans` without a `font-*` var |
| Prose lost its bullets | `prose-tokens.css` not imported |

## 5. Contract cards

### Content

One `.md` file per section.

```markdown
---
type: Hero
theme: dark
---
#> Eyebrow                     │  pretitle (label line)
# Build [faster]{accent}       │  title — consecutive same-level headings merge into a title array
## Not every page              │  subtitle — exactly one step smaller, directly after the title

We help teams ship faster.     │  paragraphs[0]

[Get Started](/start)          │  links[0] — a link alone in its paragraph; with no blank line it joins the text above

![](lu-zap)                    │  icons[0] = { library: 'lu', name: 'zap' } — also lu:zap, lucide:zap

### Fast                       │  items[0].title — two steps smaller, or ANY heading once body content has begun
Lightning quick.               │  items[0].paragraphs[0]
```

```js
content = { title, pretitle, subtitle, paragraphs, links, images, icons, videos, documents, insets,
            media /* images, videos and insets on their own line, in written order, each with `kind` */,
            lists, quotes, snippets, data, items, sequence,
            tables, math /* only when present */, headings /* from quote/list bodies, or when an image sits above the title */ }
// strings and arrays, never null · items carry this same full shape · sequence = everything in document order
// an image's address is `url`; a video's is `src` · a link inside a sentence stays in `paragraphs`, never in `links`
```

**Fenced blocks.** ` ```yaml:tag ` / ` ```json:tag ` → `content.data.tag`, **only when the component declares that key in `meta.js` `data:`** (an undeclared key stays out of `data`; inside an item no declaration is needed). ` ```md:tag ` → `content.data.tag = { items, sequence }` — a named *kind* of prose (FAQ, callout), declared the same way. A bare language → `content.snippets`. ` ```@Component{params} ` wraps parsed content in an inset component.

**Media and links.** `![alt](./img.jpg){role=banner}`; `{role=video}` → `videos`; `{role=pdf}` → `documents`; `![](@Component){param=x}` → inset. `page:about#team` links a section (id = file name without its number, or `id:`). Quote attribute values with spaces.

**Backgrounds and theme are frontmatter.** `background:` takes an image, video, gradient, quoted color or palette token, or an object (`image`, `video`, `overlay`); `theme: light | medium | dark`, or a map with token overrides (`section: neutral-100`).

**Pages.** `pages/<name>/` → `/<name>`; a name or `slug:` holding `?`, `#` or `%` stops the build. `page.yml`: `title`, `description`, `id`, `order`, `sections: [a, b, ...]`, `pages: [...]`, `nest`, `redirect`, `slug: { fr: … }`, `hidden` (draft; takes the pages below it), `hideIn` (nav only), `knowledge` (agent-only, never rendered — not a security control), `query` / `fetch`, `seo`, `layout`. `folder.yml` for a folder *of pages*. Numeric prefixes order sections; `2.5-x.md` slots between. Config cascades `page.yml → folder.yml → site.yml → foundation`. `layout/header.md`, `footer.md` render on every page — a markdown list is the nav, a standalone link the CTA, `yaml:nav` for richer menus. Child sections: `@child.md` + `nest: { parent: [child] }`.

**`site.yml`.** `index`, `pages`, `foundation`, `extensions`, `paths`, `placeholders`, `languages`, `services`, `agents`, `seo` (`origin`: scheme + host, `image`: 1200×630), `favicon`, `touchIcon`. Everything in `site.yml` and `queries.yml` ships to the browser — **never a secret**.

**Records — run `uniweb guide data` before touching them.** `records/<schema>/<name>.md|yml|json|bib` (`records/article/` → `@/article`); `queries.yml` names → `{ schema, where, sort, limit, scope }`; a page or section shows one with `query: name` or `fetch: { query, … }` (narrows, never widens); a `[slug]/` folder inside the query's page gives each record a page.

### Foundation

```
src/
├── sections/     # section types — PascalCase file or folder at the root; a folder when it needs meta.js
├── layouts/      # custom layouts, auto-discovered
├── components/   # ordinary React — any props, any library, no meta.js, invisible to authors
├── utils/
├── main.js       # export default { name, description, defaultLayout, defaultSection, handlers, … } + export const vars
└── styles.css    # @import "tailwindcss" + kit's theme-tokens.css + prose-tokens.css; one @source per folder with classes
```

`uniweb add section Hero` scaffolds `sections/Hero/{index.jsx,meta.js}`. Import shared code as `#components/*`, `#utils/*`.

**Props.** `function Type({ content, params, block })`. Frontmatter becomes `params` except the reserved keys:

| Reserved | What it is | Read from |
|---|---|---|
| `type`, `id`, `hidden` | the section itself | — |
| `query`, `fetch` | its data | `content.data[key]`, for keys declared in `data:` |
| `theme`, `background`, `grid`, `vars`, `sticky` | settings the runtime applies | `block` — `useColorContext(block)`, `<SectionBackground block>`, `<ChildGrid from={block}>`, `block.sticky` |
| `props` | params as one map | merged into `params` |
| `data`, `preset`, `input` | `data:` stops the build (it was `query:`); the others warn and do nothing | — |

```jsx
import { H1, P, Prose, Visual, Icon, Link, ChildBlocks, Overlay, PlainText } from '@uniweb/kit'
<H1 text={content.title} className="text-heading text-5xl font-bold" />   // renders its own tag
<P text={content.paragraphs} className="text-body" />
<Prose content={content} block={block} />                                 // the whole section in document order
<Visual media={content.media} block={block} />                             // image, video or inset, by kind
```

```js
// meta.js — the catalog entry other agents read and the visual editor's UI
export default {
  title: 'Feature Grid', description: 'Grid of feature cards with icons',
  family: 'features',          // the standard kind it is (`uniweb families`); a name like `Hero` resolves on its own
  // hidden: true · inset: true · section: true · children: true · background: 'self' · sticky: true
  content: { title: 'Heading', paragraphs: 'Intro [0-1]', media: 'Photo [1]',
             items: { label: 'Cards [3-6]', content: { icon: 'Icon [1]', title: 'Name', paragraphs: 'Text' } } },
  params:  { columns: { type: 'number', default: 3 },
             variant: { type: 'select', options: ['default', 'centered'], default: 'default' } },
  vars:    { 'card-gap': { default: '1.5rem' } },             // CSS-only knobs, emitted on #section-{id}
  data:    { articles: '@std/article',                        // every content.data key the component reads
             article: { schema: '@std/article', single: true, whole: true },
             'md:faq': 'Questions [3+]', nav: {} },           // {} = the key, no schema
  presets: { compact: { label: 'Compact', params: { columns: 4 } } },
}
```

Where a value lives: a **param** when JS branches on it; a **component var** (`meta.js vars:`) when only CSS reads it; a **foundation var** (`main.js export const vars`) when it must hold across components.

**Data keys.** A section receives exactly the keys its `data:` declares, each filled by a tagged block, else by a fetch whose `as` (default: the query's name) or schema matches, else `null`. A ref = a list of briefs, the brief's fields at the top (`article.title`); `single: true` = one or `null`; `whole: true` = each section under its name (`article.brief.title`, `article.body.content`). `null`: unfilled, loading (`block.dataLoading`) or failed (`block.dataError[key]`); `[]`: answered, no records.

**Tokens.** Semantic (as `text-*`, `bg-*`, `border-*`): `heading body subtle section card muted border ring link link-hover primary primary-foreground primary-hover primary-border secondary(…) success warning error info` (+ `-subtle`). Palette: `primary | secondary | accent | neutral` × `50…950`, from `theme.yml colors` (your hex is shade 500; buttons use 600). Tailwind `dark:` tracks the site scheme only with `@custom-variant dark (&:where(.scheme-dark, .scheme-dark *));`.

**Composition.** Items (repeating groups in one file) · `md:tag` concept blocks · child sections (`@file.md` + `nest:`, rendered with `<ChildBlocks from={block} />`; `children: true`) · insets (`![](@Component)` via `<Visual>`; `inset: true`) · block insets (` ```@Component ` fence) · `---` + `splitContent(content)` for regions (it splits `sequence` only). Author writes inside it → child section or block inset; self-contained → inset; repeating → items.

## 6. Guides

Every guide ships with the CLI this project pins, so it describes the version in front of you. Step 6 runs `content` or `foundation` before any writing; you will know when you need the rest. `uniweb guide` alone lists them.

| When you… | Run |
|---|---|
| write or restructure content, nav, layout files, SEO, math, icons, doc versions | `uniweb guide content` |
| build a section type, layout or inset | `uniweb guide foundation` |
| change colors, fonts, light/dark, tokens, `styles.css` | `uniweb guide theme` |
| start a project, grow the workspace, learn from a template | `uniweb guide start` |
| work with records, queries, `[slug]` pages, external APIs, schemas, Loom | `uniweb guide data` |
| add search, forms, tracking, Google Analytics or Tag Manager, an assistant | `uniweb guide services` |
| the site has accounts or member data (`services.backend`, `@uniweb/api`) | `uniweb guide backend` |
| add a language | `uniweb guide i18n` |
| publish, deploy, push/pull, register, CI, workspaces, updates | `uniweb guide ship` |
| port a React / Next / generated design | `uniweb guide migrate` |

**The documentation index is `https://uniweb.io/llms.txt`** — every page with a one-line description and a fetchable link. Go there for anything not answered here and especially to learn whether a feature exists; follow its links rather than constructing them. For several lookups: `git clone --depth 1 https://github.com/uniweb/docs .uniweb-docs` (gitignore it) and grep; bare paths above resolve as index keys, files in the clone, or `https://raw.githubusercontent.com/uniweb/docs/main/{path}`. The docs describe the **latest** release: when `uniweb status` says this project is behind, the fix is `npx uniweb@latest update --yes`, not older docs. Syntax the docs no longer show is listed under *Retired forms* in `uniweb guide ship`. `docs.uniweb.app` is for authors in the visual editor and won't answer framework questions.

## 7. Notes about this project

Keep conventions in a file of your own (`NOTES.md`). `uniweb update` rewrites this file and keeps only blocks between a `<!-- project-notes:start -->` line and a `<!-- project-notes:end -->` line: use one to point to that file.
