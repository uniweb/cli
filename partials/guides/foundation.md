# Guide: foundation

Lane guide — AGENTS.md procedure step 6 loads it before any foundation code is written. Signatures and props: the kit is on disk at `node_modules/@uniweb/kit`; full API in `reference/kit-reference.md`.

## Discovery and entry

PascalCase files and directories at the root of `sections/` are auto-discovered; nested levels need a `meta.js`; lowercase directories are organizational; `hidden: true` excludes a component entirely. Discovery accepts a `.js` component only without JSX — JSX compiles in `.jsx`/`.tsx` only, and the build stops on a `.js` file holding it.

**Source root.** The `src/` directory *is* the foundation; the build reads `package.json::main` (`./_entry.generated.js` for new scaffolds). Older foundations nest source in `foundation/src/` with `main` pointing at `./src/_entry.generated.js`; both work.

**`main.js`.** One `export default { … }`: identity (`name`, `description`) and capabilities (`defaultLayout`, `defaultSection`, `viewTransitions`, `defaultInsets`, `xref`, `outputs`, `handlers`, `data`), plus an optional named `vars` export. Section types and layouts are merged in by `@uniweb/build`; you never write that wrapper. The build carries into `dist/entry.js` only what a published page reads — code it calls and lean data (`defaultLayout`, each var's `default`/`type`/`applyTo`, each `data:` key's schema ref); `name`, `description`, labels stay out and reach the editor via the schema. The file is plain JavaScript: a component it declares lives in a `.jsx` it imports. When you import your **own** `main.js` from a component (e.g. `compileDocument(website, { foundation })`), you get the bare default object — pass it through.

## Rendering content with Kit

Content fields are HTML strings from markdown (`<strong>`, `<em>`, `<a>`). Kit's text components render them: `H1`–`H6`, `P`, `Span`, `Div`, `Text` (with `as`). They render their own tag — `<H2 text={…} />`, never `<h2><H2 /></h2>`.

**Full content rendering** for article/docs sections where the author controls the flow:

```jsx
import { Section, Prose, Article } from '@uniweb/kit'
<Section block={block} width="lg" padding="md" />   // the whole section, on its own; no insets
<Prose content={content} block={block} />           // or only its prose, in your own markup; pass block if the content has insets
```

`Prose` renders headings, paragraphs, images, snippets, lists with prose typography. Markdown footnotes (`[^1]` and a `[^1]: the note` paragraph in the same file) become numbered links with the notes listed at the end; a section drawing `content.paragraphs` itself sees them as the text they are. Tagged data blocks are skipped (read them from `content.data`). It also works as a typography wrapper: `<Prose>{children}</Prose>`. `Article` is `Prose` in a semantic `<article>`.

**Drawing an element your own way.** `components` on `Prose`, `Render`, `Article` or `Section` replaces how one element type is drawn, and kit keeps the rest. An entry receives `{ element, block, children }`: a `codeBlock` has `element.text` and `element.attrs.language`, a `dataBlock` (a tagged fence, drawn where the author put it) has `element.tag` and `element.data`, and a `concept_block` has `element.tag` and `children`. To use it across sections, wrap `Prose` once in a component of your own.

```jsx
import { Prose, Code, Mermaid } from '@uniweb/kit'

function CodeBlock({ element: { text, attrs } }) {
  return attrs?.language === 'mermaid'
    ? <Mermaid source={text} />
    : <Code content={text} language={attrs?.language} />
}

<Prose content={content} block={block} components={{ codeBlock: CodeBlock }} />
```

**Diagrams.** `Mermaid` draws a ` ```mermaid ` fence, and only where a foundation passes it one like this: elsewhere the fence stays code. The prerendered page holds the source as code, and the diagram replaces it when it comes near the view, so expect the page to move by the difference in height. Its colors come from the section's tokens. It's an image, drawn by an engine in a sandboxed frame loaded from a CDN, so its nodes can't be clicked, its text can't be selected, and its labels use the system font. A foundation that doesn't import it carries none of it.

**Prose styling.** `<Prose>` and any container you put `<Render>` output in use kit's `prose` classes, supplied by one import in `styles.css`:

```css
@import "@uniweb/kit/prose-tokens.css";
```

Skip it and prose is unstyled (lists lose bullets) while the markup looks right; the build warns and `doctor` flags it. `size` picks a step (`prose-sm`…`prose-2xl`) of the site's reading size, which `theme.yml` sets under `vars:` — `prose-size`, `prose-leading`, `prose-measure`, `prose-flow`, `prose-h1`…`prose-h4`; spread `proseVars` from `@uniweb/kit/prose-vars` into `main.js vars` to declare them. `<Prose>`/`<Article>` fill their box (`max-w-none`); set width on the box around them. Utility classes and element variants (`prose-headings:tracking-tight`, `prose-a:no-underline`) override; there are no palette modifiers and no `prose-invert` — colors are already the theme's.

### The Kit, by use case

**Text:** `H1`–`H6`, `P`, `Span`, `Div`, `Text`, `PlainText`
**Content:** `Section`, `Prose`, `Article`, `Render` (ProseMirror → React), `ChildBlocks`, `ChildGrid`, `splitContent()`
**Media:** `Visual` (a `content.media` item by kind; or first of inset/video/image), `Image`, `Media` (video), `Icon`, `Asset`, `SectionBackground`
**Navigation:** `Link`, `useActiveRoute()`, `useWebsite()`, `useRouting()`
**Header/layout:** `useScrolled(threshold)`, `useMobileMenu()`, `useAppearance()`
**Overlays:** `Overlay`
**Keyboard:** `useShortcut('mod+k', fn)`, `useShortcuts({…})`, `useShortcutLabel('mod+k')` — `mod` is Cmd on Apple, Ctrl elsewhere; the label renders per platform
**Documentation shells:** `useHeadings()` (the page's headings + the one being read, prerenderable), `website.getBranchHierarchy({ route, for })`, `useVersion()` — `versions` for a switcher (`version.href` is where each leads from this page, for `<Link>`), `isOlderVersion` and `latestVersion` for a notice, `hierarchy({ for: 'left' })` for a menu of one version (the whole tree on a site with none). Kit ships no ready-made layout; write yours in `layouts/`.
**Layout helpers:** `useGridLayout(columns, { gap })`, `useAccordion({ multiple, defaultOpen })`
**Theming data:** `useThemeData()`, `useColorContext(block)`
**Data fetching:** `useFetched`, `useCacheEntry`, `useWholeRecord`
**Forms:** `useFormValues`, `valueAt`, `useFormSubmit`, `submitForm`, `resolveSubmitTarget` (services guide)
**Utilities:** `cn()`, `SafeHtml`, `SocialIcon`, `filterSocialLinks(links)`, `getSocialPlatform(url)`, `getLocaleLabel(locale)`
**Other styled:** `Code`, `Mermaid`, `Enlargeable`, `Alert`, `Table`, `Details`, `Divider`, `Disclaimer`

Things you won't discover from exports:

- **`<Link>` takes `to` or `href`.** `to="page:about"` resolves a page id (survives moves) or a route, never a directory's name: the homepage is `page:/`, or `page:home` only when its `page.yml` says `id: home`. External URLs get `target="_blank"`; `reload` forces a full load.
- **A link back to a list is `<Link to="/store" back>`.** A link opens its page at the top, even the page the visitor just left, since the runtime restores a page's scroll only on back and forward. `back` steps back when the page before was that page (steps within this page don't count), so the list returns where they left it, and is an ordinary link otherwise. `useGoBack('/store')` does the same for a button. Keep the list's filter in `usePageState`, which stays with the page, so the view comes back too.
- **A modal needs `<Overlay>`, not a bigger z-index.** Each layout area's wrapper has its own layer, which makes it a stacking context; a `fixed` dialog inside one paints at its area's place in the stack, under the header/footer. `<Overlay onClose={close}>` renders into `document.body`, contains focus (moves it in, cycles Tab, marks the rest `inert`, returns it), handles Escape, scrim click, scroll lock; a dimmed scrim you override with `className` (`bg-transparent` removes it). `modal={false}` for a toast. Your dialog markup stays yours.
- **A reader can open a picture larger.** `components={{ image: EnlargeableImage }}` does it for an image in a page's body, and `Mermaid` does it on its own (`enlarge={false}` turns it off). `<Enlargeable>` goes around a picture a section draws itself. It's offered only when opening shows the picture noticeably larger, and the prerendered page doesn't change.
- **Kit brings no words.** What a reader or a screen reader meets comes from your foundation, so `Media` takes `playLabel`, `Asset` `downloadLabel`, `Disclaimer` `closeLabel` (it has a button at its foot only with one), `Prose` `footnoteBackLabel` and `DataPlaceholder` `label`. Without one it uses what the author wrote, a role or a symbol: a play button with no caption or alt is named `▶`. `<Link>`'s own tooltip is only a social service's name, an address or a number, so a link holding only an icon needs a `title` or `aria-label` from you. Words your own section draws are content: *A section's own words*, below.
- **A word wider than its box breaks**, so a long heading can't pan a phone's page (`overflow-wrap: break-word`, in kit's base). What must stay whole in a narrow box says `whitespace-nowrap`: a big numeral, a figure, a number with its unit. Without it, `10 min` in a tight box comes out as `10 mi / n`.
- **Headings balance their lines and a paragraph's last line keeps company**, inside prose and out (`text-wrap-style: balance` on `h1`–`h6`, `pretty` on `p`, in kit's base, at no weight). It sets only the style, so text in a `whitespace-nowrap` box stays on one line. A `text-wrap` or `text-*` class of your own wins; don't write the default again.
- **Kit hooks are SSR-safe.** "document is not defined" → use the hook, don't add guards.
- **`cn()` drops an earlier `leading-*` when a `text-<size>` follows**, since Tailwind's size classes set line height too: `cn('leading-[1.1] text-4xl')` → `text-4xl`. Put the size first, or fold the leading into it (`text-[clamp(2rem,5vw,4rem)]/[1.1]`).
- **"3 of 12 pages didn't render"** means the build stopped, exit 1, because a section threw while rendering a page, and `dist/` isn't complete. It names the error, the section type and the pages. A section that only fails here reads something only a browser has; `uniweb dev` won't show that one.

### Icon

**An icon your code draws is imported**, so it is in the page from the first render, with nothing to fetch:

```jsx
import send from '@uniweb/icons/families/lu/send.js'   // a dependency: npm install @uniweb/icons
<Icon svg={send} size="18" />
```

`@uniweb/icons` holds Lucide (`lu`), Heroicons (`hi`, `hi2`) and Feather (`fi`), the same drawings an author's names get, named as the corpus spells them (`building2.js`). For another family, import its SVG as a string, or its component, from that family's own package. **An icon an author names arrives as a name**, and `<Icon>` fetches it, since a site has no build:

```jsx
{content.icons.map((icon, i) => <Icon key={i} {...icon} />)}   // the section's markdown
<Icon icon={record.icon} />                                    // a record's field or a param: `lu-baby`
<Icon name="close" />   // built-in, no network: check close menu chevronDown chevronRight externalLink download play …
```

A name written in your code (`<Icon name="search" />`) is fetched the same way: until the browser has it, a prerendered page can show an empty box in its place. Other props: `url`, `size` (default `'24'`), `className`.

## Section wrapper and sticky

The runtime wraps every section in a bare `<section>` with its background, and a context class when the section pins `theme:` — no padding of its own to reset. `Type.className` adds classes to that wrapper; `Type.as` changes its tag. The built-in layout already wraps the header area in `<header>` and the footer area in `<footer>`, so `Header.as = 'header'` gives a header in a header. Use `as` to say something the layout doesn't:

```jsx
Header.className = 'border-b'
Header.as = 'div'
```

**Sticky is a setting.** `sticky: true` in the type's `meta.js` (an author turns it off with `sticky: false`); the runtime makes sticky the box that can stay in view. A body section sticks the same way and stays below the stuck header: the runtime publishes the header's reach as `--uw-sticky-top` (a type's `top` overrides: `sticky: { default: true, top: '4rem' }`). Section links land below the stuck header. Keep the bar in the flow: a bar made `absolute` or `fixed` leaves the runtime nothing to measure, and section links land under it.

**A header over the opening section is a setting too.** `underHeader: true` in a type's `meta.js` (a hero whose picture reaches the top of the window; an author turns it off with `underHeader: false`) has the runtime lay the header over that section when it opens a page: the header's box takes no room, the section starts at the top, and the header keeps its height, stuck if it sticks. The section pads its content by `var(--uw-header-height)`, which the page's stylesheet gives it: what the browser measures, before that the header type's `height` (`height: 'var(--header-height)'` in its `meta.js`), and `0px` where the layout draws no header. The header reads `block.getNextBlockInfo()?.underHeader`, true only when it lies over that section, to paint itself see-through, and its box carries `data-uw-header="over"`. A header whose bar is ever see-through, there or frosted on scroll, says `background: 'self'` and paints its own bar (`bg-section` where solid): otherwise the theme paints its section's surface behind the bar. A child in `<ChildGrid>` sticks beside its column, and scrolls with the page at one column. A sticky section inside `overflow: hidden` can't stick — use `overflow: clip`. A layout that wraps an area in its own element makes it sticky when `page.isSticky('header')`. `uniweb dev` names a sticky element that cannot move in the console.

## meta.js in full

```js
export default {
  title: 'Feature Grid',
  description: 'Grid of feature cards with icons',
  family: 'features',
  content: {
    title: 'Section heading',
    paragraphs: 'Introduction [0-1]',
    items: { label: 'Feature cards [3-6]', content: { icon: 'Icon [1]', title: 'Feature', paragraphs: 'Description' } },
    media: 'Photo, video or diagram [1]',
    // sequence: 'Prose and media',    // renders content.sequence — the section as written
  },
  params: { … }, vars: { … }, data: { … }, presets: { … },
  context: {}, initialState: {},
  // sticky: true, underHeader: true, height: '4rem', background: 'self', area: 'header' — section settings and placement, below
}
```

**`content:`** names what the component reads, each as an author label with optional count: `title`, `pretitle`, `subtitle`, `paragraphs`, `links`, `lists`, `items`, `media`, `icons`, `documents`, `snippets`, `tables`, `math`, `quotes`, `sequence`. It is a description for the editor and for other agents, not a validation schema. Take what you expect — `content.paragraphs[0]` if you need one paragraph — and render every paragraph or every item only when showing them all is the point. A section may hold content the type never reads; don't enumerate it, validate it or react to it.

- **`media`** is an image, a video, or an embedded component. `media: { label, types: ['image'] }` narrows it; `image:`, `videos:`, `insets:` are the same slot narrowed to one type. Read `content.media` (author's order, each with `kind`) and render with `<Visual media={content.media} block={block} />`. `<Image>` would drop a diagram placed there; `<Media>` is a video player. An image's `width` and `height`, when it has them, reach the `<img>` as attributes, through `<Visual>`, `<Image value={image} />`, `<Render>`, `<Prose>` and `<Article>`. So a class or a stylesheet rule that limits only its height needs `w-auto` too (`h-8 w-auto`, `max-h-16 w-auto`), or the width stays the file's. A section that draws its own `<img>` passes them itself where nothing else gives the picture a box: `<img src={image.url} alt={image.alt} width={image.width} height={image.height} />`. A row of logos at `h-10 w-auto` needs them, or each logo opens sideways as it loads, and so does a picture at `w-full`, or what's under it jumps; `h-full w-full object-cover` in a parent with its own shape holds its place without them.
- **`sequence`** says the component renders the whole section as written. `{ label, except: ['table', 'math'] }` names kinds it leaves out; `placement` the placements it lays out — `true` (all four, what `<Render>`/`<Prose>`/`<Article>` do), a list, or a map per kind. An editor offers an author only those.
- **`items: { label, content: {…} }`** says what each entry holds.

**`family:`** — an editor's section picker needs to know what a type *is* for its illustration, icon and translatable label; the icon is the family's. Name the component for its family (`uniweb families`: `Hero`, `Footer`, `Pricing`, `FAQ`, `CardGrid`, …) or declare `family: 'hero'` for a variant (`HeroWithEstimate`). Leave it off when nothing fits; `uniweb doctor` shows what each section resolved to.

**`meta.js` is a user interface.** Published, every `meta.js` becomes the foundation's schema and the visual editor builds controls from it: a `select` with `options` is a dropdown, a `boolean` a toggle, `label`/`description` the words an author reads, each preset a one-click choice.

## Two worlds: section types and your own components

`{ content, params, block }` is how **section types** work — a public interface with authors, documented by `meta.js`. Everything under `components/` is a normal React project: any props, any composition, any library — install it and import it — no `meta.js`, no discovery, no author visibility. There is no expected shape for `components/`: presentational primitives shared across section types, a thin wrapper adapting parsed content to a third-party component's props, layout scaffolding, stateful widgets, legacy components carried in during a migration. The only packages a foundation doesn't install are a foundation, `@uniweb/runtime` (it arrives through `@uniweb/build`), font packages (`@fontsource/*` — families are the site's) and `@tailwindcss/typography` (prose comes from kit).

Two symptoms of getting it backwards: helper components with a `{ content, params }` signature (a card taking `title`, `price`, `features` is better than one digging through `content`), and helpers in `sections/` (a `Button` in the section picker is a bug in your interface).

A section type is usually a composite translating parsed content into your components' props:

```jsx
// sections/Pricing/index.jsx
import PricingCard from '#components/PricingCard'
import formatPrice from '#utils/formatPrice'
export default function Pricing({ content, params }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-6xl mx-auto">
      {content.items.map((tier, i) => <PricingCard key={i} tier={tier} price={formatPrice(tier.data, params.currency || 'USD')} />)}
    </div>
  )
}
```

### Libraries: code several foundations share

A section type is a front desk; a **library** is the back office several foundations share: workers, hooks, logic and data types, with no section type of its own. Each foundation keeps its own section types, layouts and look, and calls on the same library. Take the first of these that holds what differs between two sites: the site's `theme.yml` (colors, fonts), foundation vars (radius, shadow, density), a param and the workers it picks, and only then a second foundation sharing a library with the first. A foundation is the vocabulary a kind of site is made with, so a second one is for another vocabulary, never for a smaller bundle.

`uniweb add library libraries/ui --foundation classic,modern` makes it and wires each foundation: `"ui": "file:../../libraries/ui"` in its dependencies, and `@import "ui/styles.css";` in its `styles.css`. The library's own stylesheet holds `@source "./**/*.{js,jsx}";`, as kit's does, so Tailwind reads its classes wherever it is installed; without the import they are in no CSS at all, and the build says which line to add. Run it again with another `--foundation` to wire one more. A library is any local package a foundation depends on: one made by hand, cloned, kept as a git submodule, or in a folder beside the workspace works the same, and `uniweb add library <its folder>` wires it.

- Export workers from its `index.js` and import them as from any package: `import { PlanCard } from 'ui'`.
- A worker takes ordinary props and reads every design decision from foundation vars and theme tokens (`var(--card-radius)`, `bg-card`), never a fixed radius or color. That is what lets one worker look classic in one foundation and modern in another.
- Import `@uniweb/core` by its bare name only, as kit does: a subpath bundles a second core.
- A section type the library holds stays each foundation's to offer: a directory in the foundation's `sections/` whose `index.jsx` is `export { default } from 'ui/sections/Banner/index.jsx'`, with a `meta.js` that re-exports the library's the same way. Share one only when both vocabularies offer that type with the same content and params; otherwise each foundation writes its own over the same workers.
- Data types: `uniweb add library libraries/data --schemas --scope @acme` gives it a `schemas/` folder and its scope (`"uniweb": { "scope": "@acme" }` in its package.json). Foundations name its types in full (`data: { plans: '@acme/plan' }`), with nothing to configure (`uniweb guide data`). On a synced site, `register` in a foundation registers the types it names from the library first, since a foundation is taken only once they are; `push` and `publish` release the foundation through `register`, so they do too, and a change to a type releases each foundation that names it on its site's next push. `uniweb register` in the library registers them alone.
- Each foundation bundles the library, so a build after a change in the library rebuilds every foundation that uses it, and `uniweb status` run in the library names those foundations and their sites. A registered foundation version keeps the library as it was built, as it keeps kit: a fix reaches a hosted site when that site's foundation releases again, which `uniweb publish` from the site does.
- A library outside the workspace (`uniweb add library ../acme-shared`, another repository's folder): builds and `uniweb dev` read it from that folder, whatever npm or pnpm installed, and its peers (React, kit) resolve from the foundation. Depend on it with `file:`, never `link:`, which under pnpm gives each site a copy of its foundation. `uniweb update` doesn't move its ranges: keep its kit range with the foundations'.

### The Front Desk pattern

A section type is triage: it reads params, picks a worker, and translates author vocabulary into developer props — and that is all it does. The workers are ordinary components that know nothing about CCA, and they need not share an interface: a `Hero` might hand off to a `SliderHero` (image carousel) or a `ContactHero` (quote form) that want different content and different props. The front desk declares the **union** of what they need, and unused content for a given variant is normal — params change behavior, and that includes not rendering some content. This is what lets an author (or an A/B test) flip `variant:` on a section without touching its markdown.

```js
// meta.js
params: {
  variant: { type: 'select', options: ['slider', 'contact'], default: 'slider' },
  slideInterval: { type: 'number', default: 5 },
  density: { type: 'select', options: ['default', 'compact'], default: 'default' },
}
```

```jsx
const workers = { slider: SliderHero, contact: ContactHero }
export default function Hero({ content, block, params }) {
  const Worker = workers[params.variant] || SliderHero
  return <Worker title={content.title} links={content.links} images={content.images} block={block}
                 formData={content.data?.quote} interval={params.slideInterval}
                 compact={params.density === 'compact'} />
}
```

Reach for it when a page type has consistent structural elements (header bars, nav footers, contextual sidebars) an author shouldn't add as separate sections. Don't solve that at the layout level: if only some page types need it, it's a section concern — the layout owns page-wide chrome, the section owns its internal structure.

## Params, component vars, foundation vars

| | Declared in | Reaches the component as | Author overrides in | CSS scope |
|---|---|---|---|---|
| Param | `meta.js params:` | a JS prop | section frontmatter | — |
| Component var | `meta.js vars:` | a CSS custom property | frontmatter `vars:` | `#section-{id}` |
| Foundation var | `main.js vars:` | a CSS custom property | `theme.yml vars:` | `:root` |

```js
// meta.js — same schema as foundation vars: default, label, type, options, group, description
vars: {
  'card-gap':    { default: '1.5rem', label: 'Card Gap', type: 'select', options: ['1rem', '1.5rem', '2rem'] },
  'card-radius': { default: 'var(--radius-md)' },
}
// usage: className="grid gap-[var(--card-gap)]"
```

Unknown var names in frontmatter are ignored; component vars are context-independent (foundation `color`/`gradient` vars resolve per light/dark context). A header height or sidebar width is a **layout param**, not a foundation var.

```js
// main.js
export const vars = {
  'radius-lg': { default: '1rem', description: 'Large border radius' },
  'section-padding-y': { default: 'clamp(4rem, 6vw, 7rem)' },
}
```

Each entry ships its default as a CSS custom property everywhere, in dev and production, bundled or runtime-loaded. A `styles.css` `@theme` block is different: it registers a token so **Tailwind generates utilities** (`@theme { --breakpoint-xs: 30rem }` → `xs:`). A var named after a Tailwind namespace (`radius-*`, `shadow-*`, `spacing`, `font-*`) redefines that scale wherever the utility appears — deliberate when you mean it.

Colors, tokens, light and dark, fonts and `styles.css` are in `uniweb guide theme`.

## A section's own words

The words a section draws itself — a search box's placeholder, an "All" filter, "No results", a menu button's `aria-label` — are content, not params: an author may change them, and a site in several languages translates them with the page. Their home is a tagged data block the type declares with an inline field map. The editor shows its fields, filled in from each `default:`, and `uniweb i18n` and a push translate it like the rest of the page, on a static site and a synced one alike. A param is a choice (a variant, a count) and is never translated.

```js
// sections/Catalog/labels.js — the type's own words, in the foundation's language
export default { search: 'Search…', all: 'All', empty: 'No results' }

// sections/Catalog/meta.js
import LABELS from './labels.js'
export default {
  data: { labels: Object.fromEntries(Object.entries(LABELS).map(([key, text]) => [key, { type: 'string', default: text }])) },
}

// sections/Catalog/index.jsx — what the section wrote, else the type's words
import LABELS from './labels.js'
const labels = { ...LABELS, ...content.data.labels }
```

````markdown
```yaml:labels
search: Search solutions…
empty: No solutions found
```
````

The runtime fills no default into a data block (`uniweb guide data`), so the component falls back to the same `labels.js` for a section written without the block. A later release that changes a default changes only the sections that never wrote their own.

## Composition

| Pattern | Authored | Rendered by |
|---|---|---|
| Items | heading groups | `content.items.map(…)` |
| Concept blocks | ` ```md:tag ` | `content.data.tag.items` / `.sequence` |
| Child sections | `@file.md` + `nest:` | `<ChildBlocks from={block} />`, `<ChildGrid from={block} />` |
| Insets | `![](@Component)` | `<Visual media={content.media} block={block} />`; `block.insets`, `block.getInset(refId)` |
| Block insets | ` ```@Component ` fence | the component, receiving parsed `content` |

**Concept blocks.** Declare as the author writes the fence: `data: { 'md:faq': 'Questions and answers [3+]' }` (or `{ label, hint, content: { title: 'Question', paragraphs: 'Answer' } }`; `faq: {}` declares with no description). Read `content.data.faq` — `items` for row-shaped rendering, `sequence` to render faithfully when you don't recognise the tag. The shape is fixed by the fence, not the tag; the framework never learns what `faq` means.

**A data block whose value is a schema** — an author-designed form at `content.data.form` — is the inverse of every other component: declare the key, receive the fields, draw what you're given. You may declare a schema of the *envelope* (`title`, `description`, `fields`) for validation, never of the form's own fields.

**Insets** are full section types: `{ content, params, block }`, alt text → `content.title`, attributes → `params`. `inset: true` in `meta.js`; add `section: true` for a component placed both ways. A component meant for a layout area names it, `area: 'header'` (a list for several, `true` for any, names as the layouts' `areas:` call them), and an editor offers it there, never among a page's sections; `section: true` again for both. The hosting section declares a `media` slot and renders `<Visual>`, so one type works whether the author supplies an image, a video or an interactive component. Don't use `hidden: true` on insets — that means "never export".

**Block insets** get their whole body parsed (`title`, `paragraphs`, `items`, `sequence`); render with `<Prose content={content} block={block} />` or read fields. Prefer a child section when the author needs their own type and independent editing; a block inset when the wrapper is presentational and inline.

**Child sections.** The parent decides *how*, the author decides *what*:

```jsx
import { ChildBlocks } from '@uniweb/kit'
export default function Grid({ block, params }) {
  return <div className={`grid grid-cols-${params.columns || 2} gap-6`}><ChildBlocks from={block} /></div>
}
```

`ChildBlocks` renders each child bare by default — no wrapper, no context class, no background (right for grid cells, tabs, slides); `wrapAs="div"` makes them independent sections with their own theming. You're in the middle: wrap, filter by type, reorder. A section type offering column layouts declares `children: { grid: [3, 2, '40/60'] }` and renders `<ChildGrid from={block} fallback={3} />`; the author picks with `grid:`, and `fallback` is the default (with none, one column). Don't declare a param named `grid`.

Page-level `query:`/`fetch:` reaches children too; each child resolves data through page → parent page → site, or declares its own in frontmatter. SSG: insets, `<ChildBlocks>` and `<Visual>` prerender; hook-using insets produce harmless prerender warnings.

**Dividers.** `---` is a boundary; `splitContent(content)` from kit splits `sequence` at dividers for different UI treatment (`const [lesson, challenge] = splitContent(content)`) and leaves the grouped fields whole, so draw each region from its sequence: `<Prose content={lesson} block={block} />`. Different *data* contexts per region → Loom's pre-parse split (data guide). A foundation can use both.

## Custom layouts

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

Layouts are auto-discovered in `layouts/`. Set `defaultLayout` in `main.js` or name one `Default`; with neither, a page gets the built-in layout: header, page, footer and nothing else, so `layout/left.md` isn't drawn. A `defaultLayout` naming no layout stops the build. Layouts have their own `params` in `meta.js` (header height, sidebar width).

**Layout `meta.js`:** `{ areas: ['header', 'footer', 'left'], scroll: 'self' }`. Area names are arbitrary; a page renders the areas its site's `layout/` directory fills. `scroll`: unset = runtime manages `window`; `'self'` = the layout scrolls itself; a selector (`'main'`) = runtime manages that element. `transitions` names an area for a move of its own (`{ left: 'sidebar' }`). With no names the page crossfades, and chrome that stays in place stays steady, so name one only to morph it: the name moves its box from where it was on screen to where it lands, so anything `fixed` in a box that scrolls drops through the page. Naming the body (`{ body: 'main' }`) freezes Safari on long pages. `layers` sets which area paints on top (`{ header: 2, left: 1 }`); every area is above the body by default, and a sticky area above non-sticky ones. A `z-index` inside an area cannot lift it past another — use `layers`, or `<Overlay>` to escape entirely.

**Layout content** lives in `site/layout/`: `header.md`, `footer.md` for the default layout, or a named subdirectory (`site/layout/marketing/`) for named layouts — self-contained, no inheritance; the name matches regardless of case and a trailing `Layout` (`layout/docs/` serves `DocsLayout`). An area with several sections is a directory inside a layout's directory (`layout/default/header/1-topbar.md`); areas have no `page.yml` and render in filename order. Cascade: `page.yml → folder.yml → site.yml → defaultLayout → "default"`.

Layout sections are regular section types; each content category takes a role:

````markdown
---
type: Header
---
# Acme Inc                              ← content.title — the logo
- ![](lu-search) [How It Works](/how)   ← content.lists[0] — the nav
[Get Started](/docs/quickstart)         ← content.links[0] — the CTA
```yaml:config
github: https://github.com/acme         ← content.data.config (declare data: { config: {} })
```
````

```jsx
function Footer({ content }) {
  const tagline = content.paragraphs[0]
  const columns = (content.lists[0] || []).map(g => ({ label: g.paragraphs[0], links: g.lists[0]?.map(i => i.links[0]) }))
}
```

## Cross-block communication

A Header adapting to the section below it, a light logo over a photograph: the section that **owns** a fact declares it, the one that **adapts** reads it, via `getNextBlockInfo()` / `getPrevBlockInfo()` / `page.getFirstBodyBlockInfo()`. (Whether the header lies over that section at all is `underHeader`, above.)

- **`context`** — static, from `meta.js`.
- **`state`** — dynamic, via `block.useBlockState()`, initial value from `initialState`.

```js
// Hero/meta.js
export default { context: { tone: 'photo' }, initialState: { tone: 'photo' } }
```

```jsx
const [state, setState] = block.useBlockState(useState)               // Hero
const info = block.getNextBlockInfo()                                 // Header
const overPhoto = (info?.state?.tone ?? info?.context?.tone) === 'photo'
```

Key names are yours.

## block, website, page

| `block` | |
|---|---|
| `block.page` / `block.website` | parent page / site data and navigation |
| `block.type` | component type name |
| `block.childBlocks` / `block.insets` / `block.getInset(refId)` | nesting |
| `block.properties` | the section's params (frontmatter without the reserved keys) |
| `block.rawContent` | the section's ProseMirror document before parsing |
| `block.themeName` | `"light"`, `"medium"`, `"dark"`, or `""` for a section that follows the scheme |
| `block.stableId` / `block.key` | stable id from filename or `id:` / unique key across pages — React key |
| `block.path` | page route |
| `block.sticky` | whether it sticks |
| `block.dataLoading` / `block.dataError` | data state (AGENTS.md contract card) |
| `block.track(name, fields)` | tracking (services guide) |

```js
const { website } = useWebsite(); const page = website.activePage
website.getPageHierarchy({ for: 'header' })   // = getHeaderPages(); options: for, nested (default true), includeHidden, under: route, filter, sort
website.getPageHierarchy({ nested: false })   // = getAllPages()
// nodes: { id, route, navigableRoute, translatedRoute, title, label, description, hasContent, children }
website.name, website.basePath
website.hasMultipleLocales(), website.getLocales(), website.getActiveLocale(), website.getLocaleUrl('es'), website.switchLocale('es')
page.title, page.getLabel() /* page.label is null unless set */, page.route, page.description
page.isHidden(), page.showInHeader(), page.showInFooter(), page.hasContent(), page.hasChildren(), page.children, page.parent
page.getNavigableRoute()    // first descendant route with content
```

Content-less containers appear as group nodes (`hasContent: false`); link with `navigableRoute`.

## Packaging

**A heavy library used on demand.** `import('some-package')` where you use it keeps the package out of the page's first load and out of `dist/entry-ssr.js`, the file a host loads to render a page. A dynamic import of your own module only splits the browser's load: `entry-ssr.js` folds that module in, with every package it imports statically, and runs them when the file loads. So put the `import()` on the package, not on a component of yours that imports it. The build is green either way; the size of `entry-ssr.js` shows which you have.

**`package.json` `uniweb` block** (all optional): `runtimePolicy` — a statement of how far past the recorded runtime version a host may move a site. The foundation's name and scope are `name` in `main.js` (`'@acme/marketing'`), not here; a name with no scope is unregistered, and the first `uniweb register` writes the scope in (from `--scope` or the Uniweb workspace you are logged in to). A foundation's own schemas register under the same scope (`@/article` → `@acme/article`). `uniweb.supports` is covered in the services guide.

**Runtime floor.** Your code externalizes `react`, `react-dom`, both JSX runtimes and `@uniweb/core`; the runtime supplies them. At build time the foundation records the `@uniweb/runtime` version it linked against into `dist/runtime-pin.json`, and `uniweb register` sends that version as its floor. `{ "uniweb": { "runtimePolicy": "exact" } }` asks for no movement past it, for a foundation that reaches into undocumented internals: it is recorded in that file and not sent at register, so whether anything acts on it is the host's to say. `@uniweb/runtime` arrives transitively through `@uniweb/build`; don't add it to the foundation's dependencies — bump `@uniweb/build` instead.
