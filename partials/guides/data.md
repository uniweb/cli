# Data: records, queries, parametric pages, external sources, Loom

On-demand guide (`uniweb guide data`); AGENTS.md is assumed read. Author guide: `authoring/collections.md`. Every query key: `reference/queries.md`. Predicates: `authoring/predicates.md`. Dynamic routes: `reference/dynamic-routes.md`. Component keys: `reference/component-metadata.md`.

## Records

A small database, not a page tree. Three things, deliberately separate:

```
site/
├── pages/
├── records/           # the site's records — every file in a schema directory is one
│   ├── article/       # directory names the data schema
│   ├── person/
│   └── folder.yml     # optional: sorts records into folders
├── queries.yml        # how content is REACHED
└── site.yml
```

| on disk | schema |
|---|---|
| `records/std/person/…` | `@std/person` — a standard type |
| `records/acme/project/…` | `@acme/project` — a type registered under another scope |
| `records/article/…` | `@/article` — your foundation's own |

**Every record needs its data schema — and a standard one comes first.** A directory whose schema nothing defines stops the build and the push. Before writing one, take what exists, in this order:

1. **A standard type**, `@std/<name>`, its records in `records/std/<name>/` and its keys `data: { posts: '@std/article' }`. It ships with the framework, so there is nothing to install, and the app knows it: `@std/article` has the app's article editor, which an article type of your own does not get.
2. **A type registered under another scope** — another foundation's, a library's, another org's — by its full name: records in `records/<scope>/<name>/`, keys `'@acme/member'` (§ *The component side*).
3. **Your own**, only for a shape none of these has: `schemas/<name>.yml` in the foundation (the format: https://uniweb.io/docs/development/data-schemas.md), records in `records/<name>/`.

| standard type | for | written |
|---|---|---|
| `article` | a blog post, news item or documentation page | by section: `brief` (title, excerpt, author, date, updated, image, tags), `body` (the text) |
| `person` | a person, team member or contact | flat |
| `event` | a calendar event, conference or webinar | flat |
| `product` | something a business sells | by section: `brief`, `body` |
| `service` | a service a business offers | by section: `brief`, `body` |
| `project` | a portfolio item, case study or project showcase | flat |
| `testimonial` | what a customer, client or patient said: `quote`, `name`, `context`, `avatar`, `rating`, `date`, `url` | flat |
| `publication` | an academic paper or research document | flat |
| `opportunity` | a job posting, grant or call for proposals | flat |
| `position`, `qualification` | a role someone held; a degree, diploma or certificate | flat |
| `nav` | a navigation menu or link tree | a list |
| `form` | a form an author designs | a list of controls |
| `scene` | a Scene Composition Format document | flat |

Each type's fields, with what each is for: https://github.com/uniweb/schemas/tree/main/src/standard. A record holds only its type's fields: `uniweb validate` reports one the type lacks, a push refuses it, and a build notes it and leaves it out, so a component receives the same record on a static host and a hosted site. What a site says differently (a topic) goes in a field the type has (`tags`), or the type is not the one.

Keep directories flat — `records/article/2025/x.md` reads as the `2025` schema of an `article` org. A `_`-prefixed file is not a record.

**Formats:** `.md` (frontmatter fields, body prose; auto-excerpt and first-image extraction), `.yml`/`.yaml` and `.json` (structured, no body), `.bib` (each `@entry{key, …}` is a record named by its cite key, normalized to CSL-JSON, LaTeX accents → Unicode). Mix freely in one directory. **One record per file**; the file name is `$name`, the one name it carries on every site (no `slug` field). A record's fields are its data schema's. Images sit beside the file (`./`). `draft: true` keeps a record off the live site: still a record, previewed by `pnpm dev`, excluded from a production build, kept undelivered on a backend.

**Links and files are records too.** `records/uniweb/link/x.yml` holding only `url:` (absolute) is a `@uniweb/link`; any file in `records/uniweb/file/` is a `@uniweb/file` named by its file name. Label and tags go on their `records/folder.yml` entry. Declare `data: { videos: '@uniweb/link' }` → `{ url, $name, $label, $tags }`; `data: { downloads: '@uniweb/file' }` → `{ file: { url, name, mime, size }, $name, $label, $tags }`. Two files of one name with different extensions clash. On a backend a component must declare the type for a query over it to be accepted.

**Multi-section schemas are written by section.** A `fields:` schema is flat. A schema with more than one section nests each field under its section; a field left at the top stops the build and a push. `@std/article` has `brief` and `body`:

```markdown
---
brief:
  title: Hello
  author: Ada
  date: 2026-05-01
---
The body — `body.content`.
```

**References name the record they point at**: `speaker: ada` for `records/speaker/ada.yml`; a `many` ref is a list of names. A component receives `{ entity, brief }` (`talk.speaker.brief.name`). `uniweb validate` and a push report names matching no record; a pull writes names back.

**`records/folder.yml`** — optional, only for folders; moves with the directory (`paths.records`). Needed only when a query wants a *slice*:

```yaml
- folder: archive
  label: The Archive
  records: [article/2025-*.md]
```

Paths are relative to `records/`, one file or a glob. An entry can be `{ path, tags, label }` — delivered beside the record as `$tags` (in order) and `$label` (one text or `{ en, fr }`, resolved to the page's language); a query reads them like any key (`where: { $tags: featured }`). `scope: archive` reads the folder and everything inside. A record sits in one folder; a computed subset is a query. The build refuses a top-level bare path (every file is a record already).

**With a backend, `records/` is what `uniweb push` sends.** No `records/` leaves the backend alone; an *empty* `records/` takes them out of the site's folder (the CLI asks). Records reach published pages only when `services.records: true`; once the site has been published, a push changes its records on the live site with no republish (pages wait for `uniweb publish`). To move records to another schema, move their files into its directory, renamed or not, and keep each file's `$uuid` line: the push sends each as a new record in the place the old one had. A record taken out of the folder stays on the backend, and the push that took it out offers to delete it (`--yes` deletes without asking).

## Queries

```yaml
# queries.yml: a bare map, with no root key (or `queries:` in site.yml)
recent:
  schema: '@/article'
  sort: date desc            # ONE key; text sorts in the page's language; missing values sort last
  limit: 10
team:
  schema: '@std/person'
  where: { active: true }    # a where-object predicate
```

**Show a query** with `query: name` (whole result) in `page.yml` or a section's frontmatter, or `fetch:` for more. `query: [team, articles]` declares several, each filling its own key. `query:` takes names only.

**Who receives it:** a section's own declaration → that section; a page's → every section on the page; a parent page's → sections of pages directly under it; `site.yml`'s → layout areas and top-level pages (homepage included), no deeper. A section on `/docs/setup` needing site-wide data names the query itself.

**A fetch always names a query.** `fetch: team` is `fetch: { query: team }`; `fetch: [team, articles]` is a list. Never a file (`/data/<query>.json` is what the build generates; writing it stops the build). A query's `scope`, `where`, `sort`, `limit` decide which records it selects — `limit` included. A fetch's `where` keeps those that also match, `sort` reorders, `limit` takes the first N, never more than the query selected; `scope` belongs to the query only. **Which records get a page is the query's decision**: `recent` (limit 10) gives each of its 10 a page; a list's `limit: 3` still leaves all 10 their pages. Two fetches under one key at one level: the first wins, the build warns.

```yaml
# pages/blog/page.yml       |  # a homepage section
title: Blog                  |  ---
query: recent                |  type: ArticleTeaser
                             |  fetch: { query: recent, limit: 3 }
```

### Parametric pages

A `[slug]/` directory inside the page that names the query gives each record its own page:

```
pages/blog/
├── page.yml          # title: Blog / query: recent
├── list.md
└── [slug]/
    ├── page.yml
    └── article.md    # just `type: Article` — the record arrives automatically
```

`records/article/design-tips.md` → `/blog/design-tips`. Generated pages are excluded from navigation.

**Link with `item.$route`, never a composed URL.** Every record a query delivers carries `$route` (the URL of the parametric page whose route query is that query), wherever the list appears. No page or no value → no `$route`, never a broken one. `detailPage: page:<id>` on a fetch links to another page instead. `$` marks framework-filled fields; a record's own `route` is untouched.

**The route query** — which query the URL narrows: the `[slug]` page's own `query:`, else its parent's, else `site.yml`'s (top-level `pages/[slug]/` only); if none, the query its sections all declare. The directory name says what the segment matches: `[slug]` the record's name (`$name`) — or the field the route query binds `:slug` to (`where: { slug: :slug }`, how an external API's records get pages); `[uuid]` its `$uuid`; any other `[name]` the record's field of that name (several values → any member matches; non-unique → the build warns). A directory inside `[slug]/` (`[slug]/cv/`) is a parametric page about the same record.

**`current:`** on a section's own `fetch:` chooses how it uses the page's record: `only` (default — the record), `exclude` (the others, "related"), `include` (all, a pager). `fetch: { query: articles, as: related, current: exclude, limit: 3 }`. It follows the query, not the key: a fetch of the route query gets the record unless it says otherwise; a fetch of another query reads `current:` only when written.

**The record arrives under the key the component declares, as that key says** — one record for `single: true` (`content.data.article`; `null` when the URL names none), a single-element array otherwise; a brief, with the brief's fields at the top (`article.title`), or with `whole: true` the record as stored, each section under its name (`article.brief.title`, `article.body.content`; a flat `fields:` schema's fields sit under `brief`).

**`[...path]/`** (exact spelling) captures the rest of the URL: `/blog/my-post` and `/blog/rust/2025/my-post` both reach it. Variables `:path` (whole capture), `:dir` (before the last segment), `:slug` (last segment) exist under every parametric page (under `[slug]`, `:dir` is empty). A record's own URL is its name, wherever `folder.yml` places it. A query may bind a part — `scope: :dir`, `where: { tag: :dir }` — and an unbound variable drops its clause, so one query serves the list page and the record page alike.

### Bigger sets

A list carries each record's brief, so heavy parts belong in a section of their own (`@std/article`'s body). A section showing them declares `whole: true`; elsewhere fetch on demand: `const { data: full } = useWholeRecord(record, { query })` holds the record as stored (`full.body.content`). File-based records are written whole at `/data/<name>/<record>.json`; an external query names its one-record request with `record:`. The hook is safe on any query (returns the record you passed when there's no separate source).

**`queryable:`** declares reader-filterable fields with enough metadata for the foundation to render controls:

```yaml
members:
  schema: '@std/person'
  queryable:
    department: { type: enum, label: Department, options: [biology, physics, chemistry] }
    tenured:    { type: boolean, label: Tenured }
    start_year: { type: range, label: Start year, min: 1800, max: 2025 }
```

## The component side

**Keys and schemas.** `meta.js data:` declares each `content.data` key with its shape — a **named ref**, an **inline field map**, an **inline rich form** (`{ fields: [...] }`), or `{}` (a key with no schema — an external API's records). Refs resolve on disk at build time: `@/name` (this foundation's `schemas/`), `@std/name` (from `@uniweb/schemas`), `@org/name` (from the package that defines it: one of the workspace, a library the foundation bundles, or `@org/schemas`; below). A schema drives the editor, checks data (`validate`), lets a fetch of another name fill the key; it fills no field — a record arrives as it is (`record.status ?? 'published'` is yours). A named schema declares no `default:` (inline maps/forms may). `data: false` declares nothing. Keys a foundation's handlers read go in `main.js data:` and reach every section.

```js
data: {
  articles: '@/article',
  authors:  '@std/person',
  pricing:  { tier: { type: 'string' } },
  article:  { schema: '@std/article', single: true, whole: true },   // long form: schema, single, whole — nothing else
}
```

`single`/`whole` are refused over a schema whose root is a list (`@std/nav`, `@std/form`). A `whole` key its source cannot answer whole is `null`. An optional `schemas.config.js` routes a scope to a directory: `export default { '@acme': '../shared/acme-schemas' }` — a routed scope wins, has no package fallback, and `@/`/`@uniweb` are never routable. Worked examples: `development/schemas-in-practice.md`.

**Any foundation can use a data schema another defines, by its full name** — `data: { members: '@acme/member' }`, `schema: '@acme/member'` in `queries.yml`. No backend is involved, and nothing to configure: a local build, `uniweb dev` included, reads the type from the package of the workspace that defines it (a foundation whose name gives the `@acme` scope, with the type in its own `schemas/`), or from a library the foundation bundles whose package.json gives that scope (`uniweb guide foundation` § Libraries). Two packages defining it stop the build, naming both. A type no such package defines comes from `schemas.config.js` (`'@acme/member': '../elsewhere/member.yml'`, or the scope's directory), which wins over both, or an installed `@acme/schemas` package. A scope is a namespace that keeps names from colliding, not a limit on who uses a type. So a type another foundation defines is named, never copied: a copy of its file is a second definition of the same type, which `doctor` points out where the two foundations' names give one scope (`type-defined-twice`). Registering, which only a site with a backend does, names such a type and sends no definition of it; a type a library defines is registered from the library, first (`uniweb guide foundation` § Libraries). A push also needs one of the site's foundations to declare the type, as a section type's data key or a schema of its own: the backend refuses a query whose type none of them declares, since nothing there would render it. A site can hold another site's records of a type too: `paths: { 'records/acme/member': '../../hub/site/records/acme/member' }` in its `site.yml` reads them as its own, a push adds them by reference rather than as copies once their own site has pushed them, and a pull leaves those files alone. That site can be in another repository checked out beside this one: the foundation then reads the type through `schemas.config.js` or a schemas package, and the push reads the records' ids from that site's committed `sync.json`. Two sites whose `paths: { records: … }` name one folder are not that: each push sends the folder's records as its own, two of each on the backend. A site's records of it sit in `records/acme/member/`; in `records/member/` they'd be the foundation's own `@/member`.

```jsx
function Article({ content, block }) {   // data: { article: { schema: '@std/article', single: true } }
  if (block.dataLoading) return <DataPlaceholder />
  if (block.dataError?.article) return <LoadFailed />   // the request failed — not "no records"
  const article = content.data.article
  if (!article) return <NotFound />
  return <ArticleView article={article} />
}
```

**Authoring queries** — `where:`, `sort:` (one key), `limit:` — select a query's records and narrow a fetch's. The browser evaluates them over fetched records; a host that answers queries evaluates the same language at the source; a transport receives them under `narrow`. The declaration is identical in every case.

**Component-side fetching** for a search box, "load more", a lazy popover: `useFetched`, `useCacheEntry`, `useWholeRecord` share the framework's cache and dedupe same-key requests. On a prerendered page a hook's first render finds only the page's own data; anything else prerenders as the loading state. Declare a key for whatever a page must show without JavaScript.

**`uniweb validate`** checks every record file against declared schemas (missing required, type/enum/format, nested fields, and what a push cannot carry: a field the schema lacks, a markdown body with no field for it); a violation fails it (`--lax` only reports), and `push`/`publish` refuse the same findings. External queries are reported as deferred. A `ref` must name a record in the project (a uuid is left alone); an `options` value isn't checked against the entity it names.

## External sources and transports

A public keyless JSON API is an **external query**:

```yaml
posts:
  url: https://api.example.com/posts
  transform: data.items                    # dot-path to the records
  record:                                  # one whole post, for an [id] page
    url: https://api.example.com/posts/{id}
```

Also `method: POST` + `body`, `where`/`sort`/`limit` (over what arrived, after `transform`), `queryable`. Its records have no `$name`, so a `[slug]` page over it binds the URL field in the query's own `where` (`where: { slug: :slug }`). `record:` takes `url`, `method`, `body`, `transform` (`url`/`method` default to the query's; a placeholder named by the directory — `{id}` for `[id]` — is the segment). `schema`, `scope`, `deferred`, `excerpt`, `path` are refused beside `url:`. The visitor's browser fetches it (a `fetch:` with `prerender: true` makes the build fetch instead); it compiles no `/data` file. A site's own schema records are another matter: on a published site they need `services.records: true`.

A backend needing a key, headers, paging or its own wire language is a **transport** — a named `{ resolve, cacheKey? }` exported by the foundation (or an extension), selected by the site per data key:

```yaml
# site.yml
fetcher:
  transports:
    articles: acme          # the foundation's transport handles `query: articles`
    events: default
  acme:
    apiKey: pk_public_123   # binding config that transport reads
```

Selection is explicit and site-owned: `fetcher.transports[as]`, else `fetcher.transports.default`, else the framework's fetcher. Never secrets in `site.yml`/`queries.yml` — proxy through the same origin at the deployment layer. A failed fetch leaves its key `null` and names the message on `block.dataError[key]`; never `[]`. Choosing between an external query and a transport: `development/data-sources.md`. Full model: `reference/data-fetching.md`.

## Content handlers (Loom)

Handlers in `main.js` transform every section's data/content before the component sees it. Optional, per block, error-isolated (a failing handler warns and falls back).

| Handler | Receives | Returns | Purpose |
|---|---|---|---|
| `data` | `(data, block)` | new data, or null | filter, reshape, augment assembled data |
| `content` | `(data, block)` | ProseMirror doc, or null | transform raw content (Loom, templates) |
| `props` | `(content, params, block)` | `{ content, params }`, or null | post-process the final shape |

The `content` handler receives the section's declared keys (declare in `main.js data:` every key a handler reads), reads raw ProseMirror from `block.rawContent`, and returns a new document the framework re-parses. `null` or the same reference = no change; anything else is ignored with one warning (a pass-through `(x) => x` returns the *data*, not the content). Unwrap defensively: `const doc = block.rawContent?.doc ?? block.rawContent`.

```js
import { createLoomHandlers } from '@uniweb/loom'
export default { handlers: createLoomHandlers({ vars: (data) => data?.profile?.[0] }) }
```

`vars` extracts the variable namespace. The handler reads the `source` and `where` frontmatter params: without `source`, simple substitution; with `source`, it splits the markdown at `---` and repeats the body per item. `where` filters first — `type = 'book'`, `year > 1870`, `refereed`, `type = 'book' AND refereed`; aggregates (`{COUNT OF publications}`) reflect the filtered set. For other cases use `Loom`, `instantiateContent`, `instantiateRepeated` directly. `instantiateContent` resolves placeholders in text and in where a link leads, so `[{email}](mailto:{email})` works; other attributes stay as written, so a value in an image's `src` has to be built in the handler. `source` and `where` are ordinary params (list them in `meta.js` for the editor).

**Data-driven dividers.** Header/body/footer in a repeated template, split *before* Loom runs because each segment gets a different variable context:

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

Different data contexts per region → Loom's pre-parse split. Same data, different UI → kit's `splitContent` after parsing.
