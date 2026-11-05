# Services: search, forms, tracking, assistant

On-demand guide (`uniweb guide services`); AGENTS.md is assumed read. References: `authoring/search.md`, `development/receiving-form-submissions.md`, `reference/site-configuration.md`.

## The arrangement

A host states what it offers in the served payload's `config.services`, keyed by name. Every service resolves by one rule: **the host's offer, then the site's own address, then neither.** Drawing the UI is the foundation's job; where requests go comes from the site or its host — never a section type.

**Ask before you draw**, one predicate per service, no arguments: `isSearchEnabled()`, `isSubmitEnabled()`, `isBackendEnabled()`, `isAssistantEnabled()`, `isTrackingEnabled()`. `false` always means draw nothing. The hooks that draw a feature return the same answer (`useSearch().isEnabled`, `useFormSubmit().canSubmit`). For the address itself:

```jsx
const { url, source } = resolveService(website, 'assistant')   // or 'search', or your own name
```

A synchronous read, not a request — the answer was settled at publish and travels in the site's metadata. Absent is the answer, not a lookup that failed. `source` (`'site'`, `'host'`, `null`) is a diagnostic for you while wiring a site up; `'host'` with a null `url` means the host answered and offered no address. The name is open: a foundation can define a service the framework never heard of (`website.isServiceEnabled('booking')`) and a host can fill it.

Absence is a rendering decision, not a message. No assistant → no Ask-AI affordance; no submit endpoint → no form, or degrade to a `mailto:` the site already carries. Text a visitor reads is site content, authored and localized.

### `services:` in `site.yml`

```yaml
services:
  search: true                                     # on — the host's, or the built-in index
  submit: false                                    # off
  tracking: https://collector.example.com/events   # an address of your own
  backend: { grade: pro }                          # on, with the service's own settings
  records: true                                    # deliver records with a data schema to published pages
  google: { id: G-XXXXXXXXXX }                     # Uniweb Cloud loads Google's tag; a static build ignores it (Tracking)
```

An entry is `true`, `false`, an address (a string, or `endpoint:` in a map), or a map of options (`records` and `google` take no address); anything else stops the build and the push. `yes`/`no`/`on`/`off` are text in YAML — write `true`/`false`. On a site you push or publish it is also what you ask the host for: `true` asks for its service, `false` turns it off, an address asks the host to leave its own off so yours answers. **A hosted site's services are off unless `services:` asks** — list the ones the site uses. Turn `records: true` on before publishing a page that shows schema records (a static build ignores it; `publish` warns). An entry says everything about its service: removing a setting removes it on the next push; removing the entry switches it off. `push`/`publish` send each service listed; one turned on in the app since your last pull is left alone; one changed on both sides stops the push — `uniweb pull`, then push. `uniweb pull` writes what the site has into `services:`. A change that needs payment is settled in the app (`publish` opens it). Everything in an entry is public except `backend`'s settings. A key or token never goes in a file: `uniweb site secret <service> <name>` asks for it at a terminal, and the live site has it from its next publish.

### Declaring what your foundation supports

```json
{ "uniweb": { "supports": ["search", "submit"] } }
```

A service only does something if the foundation renders against it, and a host can't otherwise know. The build derives the set from what the bundle reaches (`resolveService(website, 'search')`, `isSearchEnabled()`), so an undeclared foundation still publishes an accurate set; what you write is a supplement (union), and only needed for a service reached through a computed name (`resolveService(website, name)` — the build warns). `[]` means none, proven by the build; absent means unknown. Never list `tracking`: the runtime reports for every foundation, so the build drops the name with a warning. `uniweb doctor` compares declared with found.

## Search

```yaml
services:
  search:
    provider: index      # default
```

| Provider | Answers with | Trade-off |
|---|---|---|
| `index` | `search-index.json`, ranked in the browser | free, any host, typo-tolerant; only what existed at build time |
| `endpoint` | a server-side search API | covers API-fetched records, re-indexable without rebuild; needs a host that serves one |
| any other name | a foundation-supplied search transport | Typesense, Meilisearch, Pagefind, a vendor API |

With `provider: endpoint`, `endpoint:` is **required** (no default): `_search` resolves against the base path (`/` → `/_search`); an absolute URL points elsewhere. `search: true` asks a host for its own search; an endpoint of your own asks it to leave its off.

**Results have one shape.** Always: `id`, `type` (`page` | `section` | `record`), `route`, `href`, `title`, `pageTitle`, `excerpt`, `snippetHtml`. Provider-optional (`null` when absent): `sectionId`, `anchor`, `description`, `component`, `snippetText`, `matches`, `group`, `item` (a record's fields). Guard optionals (`result.item?.image`). `snippetHtml` is HTML with `<mark>` — render through `SafeHtml`. A failing provider falls back to the local index when one exists, else returns no results with a console warning.

**Follow a result with `<Link to={result.href}>`.** `href` is a route with no language or base path in it, and `Link` adds both. Do the same for Enter by clicking the highlighted link: `window.location.href = result.href` or a bare `navigate(result.href)` sends a French reader to the English page, and the build says nothing. Where no `Link` can go, `resolveHref(href, website)` gives the whole address.

```jsx
const { results, isLoading, query, isEnabled } = useSearch(website)   // `query` is a debounced function
```

Never hardcode a search endpoint in a component.

## Forms

A form's destination, in order: (1) one the host supplies — `submit: true` under `services:` asks for it, naming no address; (2) `submit: <url>` of the site's own (static site, or a host without form handling — on a host that handles forms, it asks the host to turn its off); (3) neither → render no form, or fall back to contact details the site carries. In `uniweb dev` the dev server answers `submit: true`; each submission prints in the terminal and lands in `.uniweb/dev-submissions/`.

```jsx
const { submit, status, error, canSubmit } = useFormSubmit({
  block, context: { formId: 'contact' },
  summary: (v) => ({ title: v.name, subtitle: v.email }),
})
if (!canSubmit) return null       // check at render, not on the button press
```

`status`: `idle → submitting → success | error`; a non-2xx becomes a thrown `Error` carrying the endpoint's `error` message. File fields: pass `files`; the endpoint replies with `uploadUrls`, and bytes never ride inside the JSON. `submitForm()` / `resolveSubmitTarget(website)` are the same without React. A host that protects its address names a `challenge` beside `endpoint`; the hook then solves an ALTCHA v1 puzzle and sends `X-Proof` itself, so a form needs no change (`sendWithProof` + `resolveServiceAddress(website, name, 'challenge')` for any other service). A failed read leaves its key `null`, with the message on `block.dataError[key]`; a write that 404s loses what a person typed, so it gets no silent fallback.

**Rendering an author-designed form** (`yaml:form` at `content.data.form`): you don't declare the fields, you receive them. `useFormValues` owns what's identical in every such component:

```jsx
const { controls, values, setValue, missing, formData, files } = useFormValues(content.data.form)
const { submit, canSubmit, status } = useFormSubmit({ block })
{controls.map((c) => (
  <MyControl key={c.path} control={c} value={valueAt(values, c.path)} onChange={(v) => setValue(c.path, v)} />
))}
<button disabled={!canSubmit || missing.length > 0} onClick={() => submit(formData, { files })}>
```

Use `valueAt(values, path)`, never `values[c.path]`: `values` is nested, so a control at `address.street` lives at `values.address.street` and indexing by path yields `undefined` — a form that renders blank and submits empty. `missing` is the `required` controls still empty, unenforced. **Submit `formData`, not `values`:** a `File` in `formData` would serialize to `{}`, so file controls ride in `files`, each tagged with its control; `values` keeps the `File` for display.

## Tracking

One **tracking destination** per site; everything worth counting is an event on a single stream.

```yaml
services:
  tracking: https://collector.example.com/events        # your own collector
  # or
  tracking: { endpoint: /collect, consent: required }
  # or, on a published site
  tracking: true                                        # the host's
```

The endpoint must accept the framework's batched `{ "events": [ … ] }` POST (`reference/site-configuration.md`) — not a vendor's own API. A vendor script goes under `services.tracking.scripts`, loaded once, after consent when gated, never in a frame or during prerender — a separate path; nothing you `track()` reaches it. On a site you publish, an entry with no endpoint also asks the host for its collector; `enabled: false` beside `scripts` loads the script alone.

### Google Analytics, Tag Manager, Meta's pixel

**A `scripts` entry is a URL and nothing else, so these can't be installed that way.** Each one's install runs inline lines; from a URL alone GA sends nothing and Tag Manager never gets its page-load event. A tag carrying an attribute the vendor reads (`data-domain`, `data-website-id`) has the same problem. What works depends on who builds the pages:

- **The framework builds them** (`uniweb export`, `uniweb deploy --host=<adapter>`): the vendor's snippet goes in `head.html` next to `site.yml`, and the build adds it to every page's `<head>`. A `services.google` entry does nothing here.
- **Uniweb Cloud builds them** (`uniweb publish`, or publishing from the app): `head.html` is kept and synced but **not applied**. For Google's two, name the ID and the host loads the tag from the next publish, free, with no code, on any foundation:

  ```yaml
  services:
    google:
      id: G-XXXXXXXXXX     # or GTM-XXXXXXX, or a list of both
  ```

  Someone who edits only in the app adds it there, with no terminal: the *Google Analytics and Tag Manager* card in the site's Settings, under Features, then a publish. It is this same entry: `uniweb pull` writes what the card holds into `site.yml`, its switch as `enabled: false`. Leave `services.tracking.scripts` unset beside it — a site's own list replaces what the host states, so Google's tag would not load. `tracking: { enabled: false, consent: required }` beside it holds the tag until a visitor answers, and needs a component using `useTrackingConsent()`, or it never loads. Gate that component on the hook's `status`: `isTrackingEnabled()` is false here. Any other such vendor has to run from the foundation's code, so a site whose foundation you can't change can't add one — say so rather than writing a `head.html` that does nothing.

**X and Meta, on Uniweb Cloud, need nothing in a page:** the host sends the site's conversions to the platform from its servers, for a visitor who arrived from one of its ads (`twclid`, `fbclid`). Name the pixel, in quotes, and map each conversion name to the event made for it on the platform:

  ```yaml
  services:
    x: { pixel: 'o1abc', events: { signup: 'tw-o1abc-o2def' } }
    meta: { pixel: '1234567890123456', events: { signup: CompleteRegistration } }
  ```

  Then the person sets each token with `uniweb site secret x token` (or `meta token`) and publishes. The command asks for the token at a prompt and refuses with no terminal, so an agent never handles it: tell the person to run it. A name with no `events` entry, and any engagement, is never sent; a landing address with `utm_campaign=test` marks a test click, never sent. A site's own `tracking.landing` replaces the host's, so keep `twclid` and `fbclid` in it. A static build leaves these rows out.

Either way, tell the person to check Realtime from a browser that doesn't block trackers: a visit from Brave, say, never reaches Google, which looks like a failed install. Google Analytics counts each page a visitor moves to through the browser-history setting, under Enhanced measurement in the data stream's settings, which a new stream has on.

A Tag Manager container needs nothing more, so don't present what follows as limits; use it if it comes up. A tag that doesn't follow page changes on its own, unlike Google Analytics or Meta's pixel, uses Tag Manager's *History Change* trigger, as on any site that changes pages without reloading. Tag Assistant shows the tags that fired, and Google doesn't report a mistyped ID as an error. If a container already sends to a Measurement ID, list only the container, so pages aren't counted twice. Foundation code sends a container its own events with `(window.dataLayer = window.dataLayer || []).push({ event: 'name' })`; `track()` doesn't reach Google.

### Events

**Free events** — reported for you, however the foundation renders, when `emit` includes them:

| Event | When |
|---|---|
| `page_view` | every route change, including the first |
| `outbound_click` | a link off the site — the destination **host** only |
| `section_view` | a section first half-visible, unless `emit` or the page's `trackSections` says no |
| `conversion` | a phone or email tap (`name: phone`, `email`); a link or page listed in `services.tracking.conversions`; a form accepted by a provider of the site's own through `useFormSubmit`; a sign-up through `@uniweb/api` |
| `engagement` | a sign-in through `@uniweb/api` (`name: sign_in`) |

A `services.tracking.conversions` list is public (it is in every page's data), so a listed link must not carry a token. `services.tracking.landing: [utm_source, utm_campaign, …]` makes every `conversion` carry those keys of the address the visitor arrived at, as `landing: { … }`, read once at arrival; name only what the collector needs, since a query can hold a search term or a token. **Don't write your own listener for any of these, and don't report a sign-up, sign-in or accepted form that goes through kit or `@uniweb/api`** — a second report double-counts.

```jsx
block.track('video_milestone', { milestone: 50 })          // in a section type — attaches page path and section type
block.track('conversion', { name: 'quote_requested' })     // what only your foundation can see that a site counts
trackAction(block, 'command_copied', params.copyConverts)  // kit: a conversion if the author says so, else an engagement
const { track } = useTracker()                              // elsewhere
track('brochure_download', { file: 'specs.pdf' })
```

**Let the author choose what counts.** For each act a section can report that isn't a link (a copy, a video watched past halfway, a quote worked out), declare a boolean param in `meta.js` (`copyConverts: { type: 'boolean', label: 'Copying the command is a conversion', default: true }`), on by default only for what the section is for, and report the act with kit's `trackAction`. It sends each name once per page load, and the author names nothing. Name the act, the same in every section offering it (`command_copied`). Never add a param for a link: its address in `conversions` counts it wherever it appears, and both would count one click twice.

Event names are yours; nine are already in use — the five above, `video_milestone` (kit's `<Media>`), `read_depth` (below), and `section_click` and `time_on_page` under `emit: all`. Put the varying part in a field, never in the name. Never guard a `track()` call: with no destination it does nothing and never throws.

**`emit`** chooses what the site sends: `minimal` (`page_view`), `standard` (the default with your own endpoint: `page_view`, `outbound_click`, `section_view`), `all` (a standing yes, future events included), or a list of names. So with your own endpoint, `conversion` and `engagement` take `emit: all` or a list naming them; a `conversions` list turns on what it lists by itself. Needs no endpoint of its own — on a host-supplied collector, saying nothing sends whatever the host declares it collects, and naming `emit` pins it. `emit` never limits your own `track()` calls. **`flushIntervalMs`** widens the batching window (default 5000; `30` is thirty milliseconds).

**`trackSections`** in `page.yml` overrides the site for `section_view` in both directions — the one event with a per-page control, because its cost scales with page length.

**Reading depth** in a long-form section: `useReadingDepth({ ref, block })` reports `read_depth` at 25/50/75/100% of that element, once each. A hook rather than automatic because only you know a section is long-form reading.

**Consent:** with `consent: required`, tracking buffers until the visitor answers — granting sends, denying discards:

```jsx
const { status, grant, deny } = useTrackingConsent()
if (status !== 'pending') return null
return <CookieBanner onAccept={grant} onReject={deny} />
```

Every event carries an opaque `visit` key, generated at page load, in memory only. **Never sent:** visitor id, fingerprint, cross-tab or multi-day session, anything written to the device. A `page_view` carries the path, two booleans about the load (`first_of_load`, `continues`), and the external referrer and `utm_*` captured once at first load.

## Assistant

The service name is `assistant`; a host that runs an agent typically serves it at `/_agent/chat`. Never write that path:

```jsx
const { url } = resolveService(website, 'assistant')
if (!url) return null          // no agent on this site — render nothing or a static fallback
```

No `url` means the site has no agent — never enabled, or this host runs none. Don't retry it, don't hardcode `/_agent/chat` (on a static host that's a 404 indistinguishable from a broken endpoint), and don't tell the visitor. A live agent that errors mid-conversation is ordinary request failure, handled where you make the request. Knowledge pages that feed an assistant: content guide.

In `site.yml`, `assistant: true` asks the host for its agent, and a map asks with options: `system` holds its instructions, and `model` and `maxTokens` are preferences a host may ignore. A map with no address still asks the host, so the address stays the host's to state.
