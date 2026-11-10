# Guide: content

Lane guide — AGENTS.md procedure step 6 loads it before any content is written. When in doubt about any rule here, `uniweb inspect <path>` settles it.

## Sections

**A section with no `type:` renders through the foundation's default section type** — the `defaultSection` its `main.js` sets, else a section type named `Section` where the foundation has one, the fallback for foundations that declare none. This is what lets a directory of plain markdown with no frontmatter become pages: mounted documentation, an imported wiki. If such content shows "Component not found", the foundation has neither: declare `defaultSection` in its `main.js`, naming the type that content should render with. `uniweb doctor` states each foundation's default, and suggests one where a type stands out.

**Content before the first heading changes the parse:** headings after body content become items, not the section title. That's how repeating groups are made. An icon counts: `![](lu-globe)` above `# Title` leaves `content.title` empty and puts the heading in `items[0]`. For an icon that belongs to the title, write it under the heading, where it is still `content.icons[0]`; `uniweb inspect` shows the shape, and warns about an icon above one heading. An image above the title empties it too, with the heading in `content.headings` and no warning.

### The parsed object

```js
content = {
  title: '',        // string, or string[] for multi-line
  pretitle: '',     // `#>` label line(s); also smaller headings stacked above the title (older content)
  subtitle: '',     // line(s) one step below the title — each further one-step descent is another line
  paragraphs: [],
  links: [],        // { href, label, role, iconBefore, iconAfter } — links alone in a paragraph; not a sentence's, and a list item has its own
  images: [],       // { url, alt, caption, role, href, target } — `url`, where a video has `src`
  icons: [],        // { library, name }, or { url } for your own SVG
  videos: [],       // { src, alt, caption, role, poster, href, target }
  media: [],        // images, videos and insets on their own line, in the order written, each with its `kind`
  documents: [],    // { url, alt, caption, role: 'pdf', preview?, author?, description? } — from {role=pdf}
  insets: [],       // inline @Component references — { refId }
  lists: [],        // [[{ paragraphs, links, lists, … }]] — each item is an object, not a string
  quotes: [],
  snippets: [],     // fenced code — [{ language, code }]
  data: {},         // tagged blocks — yaml:/json: give the parsed value, md: gives { items, sequence }
  tables: [],       // only when present — [{ rows: [{ cells: [{ children, header, align }] }], attrs? }]
  math: [],         // only when present — display math, [{ id, latex, mathml }]; inline math stays in its paragraph
  headings: [],     // from nested content (quote/list bodies), or when an image sits above the title
  items: [],        // each has this same flat structure
  sequence: [],     // every element in document order
}
```

### Items have the full content shape

Each item has `title`, `pretitle`, `subtitle`, `paragraphs`, `links`, `icons`, `lists`, `snippets`, and `data`. Heading hierarchy inside an item follows the same rules (`####` inside a `###` item is that item's `subtitle`). A tagged block inside an item is that item's (`items[n].data`) and needs no `meta.js` declaration:

````markdown
### Starter               ← items[0].title
$9/month                  ← items[0].paragraphs[0]

```yaml:details
trial: 14 days
seats: 1
```                       ← items[0].data.details = { trial: "14 days", seats: 1 }
````

### Subtitle vs items

A heading right after the title is `subtitle` **only when exactly one step smaller** (H1→H2); each further one-step line continues the subtitle (`subtitle: [line2, line3]`). **Two steps smaller starts items** — the idiom for entries with no lead paragraph:

```markdown
# Our Stats                       │  content.title
### 15,000+                       │  content.items[0].title
Students from 90 countries        │  content.items[0].paragraphs[0]
### 200+                          │  content.items[1].title
```

With `## 15,000+` the first stat would join the headline as `subtitle`. A `---`, or any body content after the headline, also closes it. A later heading as large as the first leaves no title at all: `# A`, a paragraph, `# B` gives `items: [A, B]`.

### Multi-line headings

Consecutive headings at the same level merge into one title array; kit's `<H1>`…`<H6>` render arrays as one tag with line breaks.

```markdown
# Build the future              │  content.title = ["Build the future", "<span accent=\"true\">with confidence</span>"]
# [with confidence]{accent}     │
```

A repeated size always continues the part it repeats. Use `---` to force separate items where adjacent headings would otherwise continue the headline.

### Sequence

`content.sequence` is the flat, ordered list of all elements before grouping. Each element has a `type` (`heading`, `paragraph`, `image`, `codeBlock`, `dataBlock`, `list`, `link`, `divider`, `inset`, …) plus type-specific fields. Grouped fields suit structured layouts (cards, features); `sequence` suits prose and cross-group searching:

```js
for (const el of content.sequence) if (el.type === 'dataBlock') allData[el.tag] = el.data
```

### Choosing how to model content

The rule: **would a content author need to change this?** Yes → markdown, frontmatter, or a tagged block. No → component code. Start with the content, not the component: write the markdown an author would naturally write, check the shape with `inspect`, then build the component to receive it.

- **Pure markdown** — headings, paragraphs, links, images, lists, items. The default.
- **Frontmatter params** — `columns: 3`, `variant: centered`. Presentation, not meaning.
- **Tagged data blocks** — products with SKUs, team members with roles, schedules, form definitions. When information is structured data an author still owns, a well-named block (`yaml:pricing`, `yaml:speakers`) beats contorted markdown. Formats: `yaml`, `json`.

Read the markdown out loud. If an author understands every line, you've chosen right. When you build a foundation you *design* these names; when you write against an existing foundation the vocabulary is fixed — the types in `sections/**`, the params each `meta.js` lists.

**A section may hold more than its type renders.** `meta.js content:` says what a type reads, not what a file may contain; extra content is ignored, never an error. Write for the type — extra content isn't a goal — but the tolerance is what makes changing `type:` or a `variant` a one-line trial: compare, switch back, nothing to rewrite first. When you make the switch, don't strip what the new rendering ignores; whether it stays is the author's decision once the trial is settled.

### Placeholders

A value that appears on many pages goes in `site.yml` once:

```yaml
placeholders:
  product: Uniweb
  vendor: { email: billing@acme.example }
```

Pages reference it as `{vendor.email}`; dot paths work, and a record's own field of the same name always wins (`{title}` on an article page is that article's). Resolution needs a foundation with a content handler (`createLoomHandlers` from `@uniweb/loom` in `main.js handlers:`); without one the literal `{…}` renders. Placeholders are the simplest case of Loom expressions, which also filter, sort, count and format data (`{COUNT OF publications WHERE refereed}`) — see the `data` guide.

### Icons

```markdown
![](lucide:house)     colon + friendly name — every library
![](lu:house)         colon + short code
![](lu-house)         dash — short codes only
```

Short codes: `lu` Lucide, `hi`/`hi2` Heroicons v1/v2, `fi` Feather, `pi` Phosphor, `tb` Tabler, `bs` Bootstrap, `md` Material, `ai` Ant Design, `ri` Remix, `si` Simple Icons, `io5` Ionicons, `bi` Boxicons, `vsc` VS Code, `wi` Weather, `gi` Game, `fa`/`fa6` Font Awesome 5/6. Browse at react-icons.github.io: the name is the component name without prefix, kebab-cased (`LuBuilding2` → `lu-building2`, `LuGrid2X2` → `lu-grid2-x2`); Lucide, Heroicons and Feather also accept the family's own spelling (`lu-building-2`). Attributes: `{size=20}`, `{color=red}`. Custom SVG: `![Logo](./logo.svg){role=icon}` or `![Logo](icon:./logo.svg)`. An icon the build cannot fetch is named in its prerender warning.

### Links and media attributes

```markdown
[text](url){target=_blank}              open in new tab
[text](./file.pdf){download}
[Go](/start){button}                    role "button" (also `button:/start`), plus a `variant`
![alt](./img.jpg){role=banner}          role picks the array: images, icons, videos, documents
![alt](./demo.mp4){role=video}          → content.videos
![alt](./report.pdf){role=pdf}          → content.documents — a file, drawn as a link
![alt](./img.jpg){href=/products}       clickable media: href + target ride along
```

Image attributes: `{width=800 height=600 loading=lazy fit=cover position=center author="Jane Doe"}`. `width` and `height` hold an image's place on the page while its file loads, so what's under it doesn't jump when it arrives; use the file's own size, and a stylesheet still scales it. A static build fills them in for a local file when you give neither, and so does a backend-hosted site for a file it holds, so you write them only for an image at another address. In a PDF, only a width with a unit (`50%`, `10cm`) sizes an image. Video: `{poster=./thumb.jpg autoplay muted loop controls}` — name a poster; a static build makes one only when none is named and ffmpeg is installed, and `uniweb publish` sends only a named poster. A `{role=pdf}` document adds `{preview=./cover.jpg author=… description=…}` and arrives as `{ url, name, mime, size?, alt, caption, … }`.

**Section links:** `page:about#team` → `/about#section-team`; `page:/#features` → a homepage section. The id is the file name without its number (`2-features.md` → `features`) or `id:` in frontmatter.

**Where media lives.** `./x` is beside the page, `/x` is in `public/`; both reach a static build and a published site. Keep a page's media beside it, and in `public/` what belongs to the whole site: the favicon, fonts. **Only a static host gives a file a fixed address** at the site root. A site published with Uniweb serves a file that something names from an address the upload gives it, and nothing at `/x` — so for a file other sites or scripts fetch by URL, keep it somewhere with its own address and add a page whose `redirect:` goes there. A static build copies `public/` whole and adds its own copy of each file a page names there. `uniweb push` uploads a file beside a page wherever the page is (mounted directories included); a file outside the site and its mounts is not uploaded — put that in `public/`. There is no `assets/` directory for media; a build stops on a `/x` only `assets/` holds.

**Placement** (`{placement=left|right|wide|full}`) on an image or video, or on a table's caption line, which follows the table after a blank line (`: Plans and prices {placement=wide #tbl-plans}`, which also sets caption and id; with no blank line it becomes a row). It's the author's intent, honoured by kit's `<Render>`, `<Prose>` and `<Article>` and ignored by other components; a section type declares which it honours in `meta.js` (`sequence: { placement: true }`) and the build warns on a mismatch.

**Attribute syntax.** Quote values with spaces (`{note="Ready to go"}`). `:` works wherever `=` does; pairs separate by whitespace, comma, or both. The separator must touch the key (`{note : warning}` is two flags); a value with a comma must be quoted; a colon in a value needs no quoting (`{href:https://example.com}`).

Standalone links (alone in a paragraph, or several sharing a links-only paragraph) are promoted to `content.links`; how they're drawn is the component's choice. Leave a blank line above one: a link on the line after text joins that text's paragraph. A link inside a sentence stays an `<a>` in `paragraphs` and is not in `links`.

**Footnotes.** `[^1]` in text and a `[^1]: the note` paragraph in the same file. `<Prose>` renders them as numbered links with the notes listed at the end; a component that draws `content.paragraphs` itself sees them as the text they are.

### Inline text styling

```markdown
# Build [faster]{accent} with structure
This is [less important]{muted} context.
```

`accent` and `callout` (accent color + bold) and `muted` are built in and adapt to context. `--accent` is the brand color unless `colors.accent` is declared, at the shade you authored. Components receive `<span accent="true">faster</span>`.

Sites adjust these or add named styles in `theme.yml` `inline:` — a name is a letter then letters, digits, `_`, `-`, never starting with `on`. Overrides merge property by property; to drop a default property give it `initial`/`inherit`/`unset`. On a site synced with the Uniweb app, built-in names round-trip editable in the visual editor; a name the editor doesn't know is preserved exactly but not editable.

### HTML is not content

A tag in markdown — `<strong>`, `<span class=…>`, `<div>` — shows as written, and the build names the file. Use `**bold**`, `[text]{accent}`, a link. The exception is `<br>`, a hard break anywhere. A newline inside a paragraph is a space; a deliberate line break is `<br>` or a `\` at the end of the line.

### Fenced code

Three uses by info string: `yaml:`/`json:` data (parsed into `content.data.tag`, for a key the component declares — otherwise it stays out of `data` and the dev console says so; still in `sequence`), `md:` a named kind of prose (`content.data.tag = { items, sequence }`; a body with no headings is one titleless item — a callout), and a bare language for a snippet (`content.snippets`, filter by `language`). `<Prose>` highlights snippets and skips tagged blocks.

Two tags, not a tag plus a variant: a warning and a note are `md:warning` and `md:note`. The fence takes no params.

A ` ```mermaid ` fence is a snippet that a foundation can draw as a diagram, with kit's `Mermaid` (foundation guide). Where it doesn't, or the diagram has a syntax error, the page shows it as code. Check by looking at the page: the build says nothing either way. ` ```mermaid:flow ` keeps the text at `content.data.flow`, for a section that declares `flow` and draws it. Leave colors out of a diagram and it takes the site's, in light and dark; a `fill` you set stays in both, and a pale one leaves its labels unreadable on a dark page.

### Math

LaTeX compiles to MathML Core at build time — no runtime library. `$x^2$` inline; `$$x^2$$` display (block on its own line, inline display mid-paragraph); a ` ```math ` fence for multi-line; `\$` for a literal dollar. A `$…$` span is math only when no whitespace touches the delimiters *and* the closing `$` isn't followed by a digit — so `$5 and $10` stays prose and `Let $f(x) = 5$ be` is math. Math survives prerender, epub/pagedjs output and the editor. Display math lands in `content.math`, and inline math stays in its paragraph. A foundation that draws equations imports `@uniweb/kit/math-tokens.css` (theme guide).

### Lists as navigation

Each list item is a full content object (`paragraphs`, `links`, `icons`, nested `lists`):

```markdown
- ![](lu-home) [Home](/)          ← content.lists[0]; each item.links[0], with the icon as its iconBefore
- Product                          ← nested: group.paragraphs[0] is the label, group.lists[0] the sub-items
  - [Features](/features)
```

To change a nav item, first check how nav is produced: if `layout/header.md` lists the links (a list, or a `yaml:nav` block), edit it there; if it doesn't, the Header is generating nav from the page hierarchy — change page titles and order in `site.yml` / `page.yml` instead.

For richer navigation use a `yaml:nav` block — `[{ label, href, icon, text, children, target }]`, icons in any icon spelling or an SVG path — read as `content.data.nav` (declared `data: { nav: {} }`); components can fall back to `website.getPageHierarchy()`. Full pattern: `reference/navigation-patterns.md`.

### Section backgrounds

```yaml
background: /images/hero.jpg                             # image
background: /videos/hero.mp4                             # video
background: linear-gradient(135deg, #667eea, #764ba2)    # gradient — quote if it contains #
background: '#1a1a2e'                                    # color (quote)
background: primary-900                                  # palette token (bare name or var())
background:
  image: { src: /img.jpg, position: center top }
  overlay: { enabled: true, type: dark, opacity: 0.5 }
background:
  image: /img.jpg
  overlay:                                               # a fading overlay; every gradient field optional
    enabled: true
    opacity: 1                                           # 0.5 when left out, on the gradient too
    gradient: { angle: 90, start: 'rgba(0,0,0,0.8)', startPosition: 0, end: 'rgba(0,0,0,0)', endPosition: 60 }
background:
  video: { src: /videos/hero.mp4, poster: /images/hero.jpg }
```

An overlay is drawn only with `enabled: true` (the number shorthand, `overlay: 0.5`, sets it).

Components that draw their own declare `background: 'self'` in `meta.js`. They then paint everything behind their content, the section's surface color included (`bg-section` where they want it), and can still render the author's background with `<SectionBackground block={block} />`.

## Pages

```
site/layout/          # header.md, footer.md, left.md — rendered on every page
site/pages/home/
    ├── page.yml      # title, description, order
    ├── 1-hero.md
    └── 2-features.md
```

Decimals insert between (`2.5-x.md`). A page directory's number works the same way: `pages/2-about/` orders second and is `/about`, named `about` in `pages:` and `index:`. A number counts only with a dash after it, or as the whole name (`404`): `3d-printing.md` keeps its name. Ignored: `README.md`, `_*.md`, `_*/`.

```yaml
# page.yml
title: About Us
id: about                   # stable identity for page: links; the app may write a code (id: 3f58142d) — keep it
order: 2
sections: [hero, team, ...]
pages: [team, history, ...] # child page order when this page has child pages
redirect: academic          # to a child page (relative/absolute path, or URL)
slug: { fr: a-propos }      # localized URL segment per language
layout: marketing

# folder.yml — a directory OF PAGES (page.yml means a page built from sections)
title: Getting Started
pages: [quickstart, app-tour, ...]

# site.yml
index: home
pages: [home, about, ...]
foundation: '@acme/ui@1.2.0'
extensions: ['@acme/fx@0.3.1']
```

**The trailing `...`** in `pages:` and `sections:`: `[a, b, ...]` pins those first and includes the rest; `['...']` equals omitting the key; `[a, b]` is strict, and nothing warns: an unlisted page is dropped from every menu but stays routed, in `dist/` and in `llms.txt`; an unlisted section isn't rendered at all.

**Cascade:** `page.yml → folder.yml → site.yml → foundation defaults`. Put `layout: marketing` in a `folder.yml` and every page inherits it; one page can still override.

**A directory of pages holds pages of one section.** Under a `folder.yml`, each page is one `.md` file of one section, and each subdirectory is a directory of pages too. The build stops on a subdirectory with a `page.yml` of its own, a parametric `[slug]/` included. A page of several sections goes outside that directory. In the app, such a page takes no second section, and a pull holds one made there.

**Such a page's frontmatter holds its page's settings**, beside its section's `type:` and params: `title` (else its H1), `description`, `label`, `keywords`, `slug`, `hideIn`, `layout`, `seo`, `knowledge`, `trackSections`, as in a `page.yml`. A section param with one of those names goes under `props:` (`props: { label: … }`); the build warns where the section type declares one. `id:` is the section's id there too, and `hidden:` drafts the page. A pull writes the app's changes to them back into the file.

**Routes:** pages map 1:1 to routes, and under `pages/` every directory is a page; `pages:` controls order only. The site root is the exception: the first of `pages:` sets `/`, else `index:`, declared in `site.yml` or in the pages directory's own `folder.yml`/`page.yml`, with `site.yml` winning. A directory with `page.yml` but no markdown is a page with no sections (`hasContent: false`); visiting it redirects to the first descendant with content.

**Mounted directories:** a local directory for a mounted route says how *this site* presents it. Keep `layout:`, `title:` and SEO in a `folder.yml` there; the mounted repo's own `folder.yml` supplies ordering and title where the stub is silent. A `page.yml` with markdown of its own makes a real page above the mounted pages — a landing page for the branch. A mount is one level under `pages/`, and a subdirectory in the local directory isn't read, since the branch's pages come from the mount; the build says so. What a site can't do from outside a repo it mounts: leave a file out, title or order a nested directory, or use a `README.md` as a page — those are the mounted repo's to do. A relative link to a markdown file (`./deploying.md#setup`), which is how docs in a repo link to each other, leads to the page that file became; the build names one that leads nowhere. A mount that is its own repository (a submodule, or a clone beside the site) takes its edits as commits there, and `uniweb refresh` takes its latest; a push or publish stops on one that is behind its remote or holds uncommitted changes, and `--mounts-as-is` sends it as it is. A pull writes an author's app edits into a mounted directory where the site's own repository holds it, or a submodule of it does (a commit there, to push before the site's repository). A directory it cannot merge into — a clone beside the site — keeps its text and the app keeps the author's: the pull and `status` name each such page as held, and a push leaves it alone while its file is unchanged. A mount is its directory, `pages/docs: ../docs`; the object form is refused.

**Visibility flags:** `hidden: true` is a draft (not published; `uniweb dev` previews it; on a page it takes the pages below with it; on a section it's also kept from the component's params and takes its children with it); `hideIn: ['*']` or `[header]` controls nav placement only; `knowledge: true` is a different audience (below). An authored `pages/404/` needs no flag — `hidden: true` there makes it a draft and the site falls back to the generic 404.

**SEO and social cards.** Site-wide defaults in `site.yml`; any page overrides per field in `page.yml` (page wins, site fills gaps). Each page's static `<head>` carries Open Graph, Twitter Card, canonical, robots, and hreflang on a multilingual site. Set the social `image` once at site level — a 1200×630 JPEG/PNG. The site's `description` is the home page's; each page's own reads best under ~160 characters. A `head.html` tag of the same name is replaced. `uniweb doctor` checks the image and descriptions.

```yaml
# site.yml
keywords: [components, react, cms]
favicon: /favicon.svg            # name it even when the file exists; a published site links only what's named
touchIcon: /touch-icon.png       # 180×180 PNG, no transparency (iOS draws transparent as black)
seo:
  origin: https://acme.com       # scheme + host only; set where no host states the address
  image: /og-default.png
  noindex: false                 # true keeps the whole site out of search
# page.yml
seo:
  image: /og-about.png
  canonical: https://acme.com/team   # only to name ANOTHER URL
```

**Where the site lives:** every absolute URL (canonical, `og:url`, sitemap, `llms.txt` links) is built on the site's origin plus base path. The GitHub Pages workflow asks GitHub; Netlify and Vercel state their URL; on any other static host set `seo.origin`. With no address, pages state no canonical and no `sitemap.xml` is written — `uniweb doctor` says so.

**Localized URLs:** on a multilingual site, `slug: { <lang>: <segment> }` gives a native segment per language; the directory name stays canonical. See the `i18n` guide.

### Older versions of docs

Most docs need one version. When a release is about to stop being the latest and its readers need its docs kept, run `uniweb add version v2` (`--in <folder>`, `--label "2.x"`). It copies the docs to a directory named `v2` beside them, at `/docs/v2/…`, with the copy's links leading into the copy, no page ids in it, and search engines told to leave it out. Keep writing where you were: the pages beside version directories are the latest, and their URLs never change. **Don't copy a version directory by hand.** A foundation draws versions with kit's `useVersion` (foundation guide). Reference: `reference/versioning.md`.

### Knowledge pages

`knowledge: true` in `page.yml`/`folder.yml` marks a page as agent-only: never rendered (no route, no HTML), cascading to the subtree by route prefix (`/kb` never claims `/kbase`). It isn't how to make a site AI-readable: ordinary pages already are (below). It is source material for an assistant the site offers to its visitors; it's kept out of `llms.txt`, the `.md` projections and the search index because it was never a page. It is **not a security control** — the assistant can quote it to whoever asks. Anything that must not reach a visitor doesn't belong in site content at all.

Who can read it depends on the host: `uniweb publish` (backend-hosted) carries it for an assistant; `uniweb export` / `deploy --host` (static) drops these pages and says so. `agents.exclude` and any `_`-prefixed segment outrank it. A site can be nothing but knowledge (root `knowledge: true`) — then it exists to *be* an agent at `/_agent/chat`, and only on a host that runs one: a static host yields an empty shell with a build that says "complete" and `Collected 0 pages`. Confirm with the host before building an integration against it.

### Agent-readable output

A static build emits `/llms.txt` (an annotated index of every page) and `/{route}.md` (each page as clean markdown); a host that serves the site derives its own. Descriptions come from `page.yml description:`, then `seo.ogDescription`, then the opening paragraph. A top-level directory with no content of its own and ≥5 pages gets `/docs/llms.txt`; each language gets its own (`/fr/llms.txt`, `/fr/search-index.json`). Excluded deliberately: `seo.noindex`, `hidden`, `_`-prefixed, and a parametric page's URL pattern; `noindex`/`hidden` on a directory with no content of its own takes the branch.

```yaml
agents:
  index: true            # /llms.txt
  markdown: true         # /{route}.md
  branchIndexes: true
  branchMinPages: 5
  exclude: [/internal]
  expectedOrigins: [https://app.example.com]   # declared callers of the site's agent — see below
agents: false            # or off entirely
```

`expectedOrigins` is a declaration a host may honour by declining agent requests whose browser-sent `Origin` isn't listed; the site's own origin is always fine, and a request with no `Origin` (a server) is allowed — server callers are authenticated by other means arranged with the host. It is not a spend limit. `uniweb doctor` flags unknown keys here since the block is forwarded opaquely.

```yaml
seo:
  robots:
    contentSignals: { search: true, ai-input: true, ai-train: false }   # emits Content-Signal in robots.txt
```

Declare only what you mean — an omitted signal says nothing.

## Composition from the author's side

| Pattern | Authored as | Use when |
|---|---|---|
| Items | heading groups in one `.md` | repeating content: cards, features, FAQ entries |
| Concept blocks | ` ```md:<tag> ` fence | a named kind of content: FAQ, callout, steps |
| Child sections | `@`-prefixed files + `nest:` | children needing their own type, rich content, independent editing |
| Insets | `![](@Component){params}` | self-contained visuals/widgets |
| Block insets | ` ```@Component{params} ` fence | a component that wraps authored prose |

**Child sections:** `@`-prefixed files are excluded from the top-level list; `@@` nests deeper. `nest:` in `page.yml` maps parent → children and is flat (`{ features: [a, b], a: [sub-1] }`); children render in array order. A parent that lays children out in a grid takes `grid: 3` / `grid: '40/60'` in its frontmatter — a section key, not a param.

**Block insets:** the body is parsed like the rest of the page (headings, lists, tables, icons, further insets). To nest a fence inside, open the outer one with more backticks. A name the foundation doesn't define renders `Component not found` on purpose.
