# Backend: when the site is also a web app

On-demand guide (`uniweb guide backend`); AGENTS.md is assumed read. For a site that is also a web app. Its own Application Engine, the `backend` service, gives it accounts, per-visitor data, the records its members create and edit, roles and a store, and components reach it through `@uniweb/api`, the SDK. Ask `isBackendEnabled()` before drawing anything that needs it, so the same foundation also serves a site without an engine. A web app starts from `starter`, as any site does.

```bash
npm install @uniweb/api      # in the FOUNDATION, beside @uniweb/kit — and in the site, if it has a $devBackend mock
```

**Two places hold a site's data, and they share nothing.** *The engine*, which this guide means by the backend, is the site's own: its members, the entries they and the site's staff create, its store. *Where the site is published*, the backend you are logged in to, keeps the site's content: its pages and its `records/` files. A `records/` file never reaches the engine, whatever its type and whatever `uniweb publish` reports: `@uniweb/api` never lists it, no member can edit it, and the store can't sell it. Anything the engine works with is an entry created through `@uniweb/api` (Writing, below) or by the owner.

## Ask before you draw

```jsx
import { isBackendEnabled } from '@uniweb/kit'
import { useSession, SignedIn, SignedOut } from '@uniweb/api'
if (!isBackendEnabled()) return <StaticVersion />   // synchronous
```

When the site has no backend, draw nothing — not a disabled control, not "sign-in unavailable". Render the version that never needed one.

## Reading

```jsx
const { status, records } = useRecords({ schema: '@/track' })   // summaries: record.brief, no items
const { entity } = useEntity({ schema: '@/track', uuid: record.uuid })
const sessions = entity?.hydrated?.items.filter((item) => item.section === 'sessions')
```

- Name your foundation's own types `@/track`, as `meta.js` and `queries.yml` do; a built foundation sends them in its registered scope (`@acme/track`), `uniweb dev` as written. Any other type in full (`@std/person`). Outside a Uniweb build `@/track` is refused (`kind: 'invalid'`).
- **What a member wrote is text.** `{record.brief.name}` or `<PlainText>`, never `<P text>`, `<H1>`–`<H6>`, `SafeHtml` — a member who typed `<img onerror=…>` would run it as whoever views the page. A rich-text field renders through kit's `Render`.
- **A listed record is a summary, not the entity.** `record.brief.name`, not `record.name`; no items — read one entity for them. Each item carries `section` (the word a write takes) and `id` (what update/move/remove take). `scope: 'mine'` lists only the viewer's own; without it, also what was shared with them and what a role reaches.
- **A person's name is on their account, never a type of yours.** Show `viewer.display_name` (then `handle`) for the person signed in, and `brief.display_name` for each person a roster lists (holders, teams, share lists). Ask for it at sign-up (`signUp({ …, display_name })`), or set it later with `useSession().setName(name)`, which works however they signed up and is what a "my account" screen calls. A profile type made to hold a name duplicates it.
- **`absent` ≠ empty `ready`.** `absent` = no live source (no backend, or nobody signed in) → render authored content. `ready` with `records: []` = the service answered, nothing there → your empty state. Confusing them tells a visitor their content is gone when it was never requested.

## Writing

```jsx
const writer = useEntityWriter({ schema: '@/track', uuid: track.uuid })
await writer.create({ title: 'Keynote' }, { section: 'sessions', position: 'last' })
await writer.update(itemId, { ...item.data, room: 'Hall A' })   // whole-data replace — spread what you aren't editing
await writer.move(itemId, { after: previousItemId })            // 'first', 'last' or { after } — never an index
await writer.remove(itemId)
```

- `section` is required on `create`: an entity has several, and a rule declared on one (insert-only) doesn't reach an item that landed in another. A schema written with flat `fields:` has one section, named `brief`: `create(data, { section: 'brief' })`.
- Ordering is the server's; never compute an order number.
- `writer.conflict` is reported, not retried — a retry would overwrite a change nobody looked at. Tell the person.

## Rich text a member writes

```jsx
import { useRichTextEditor, RichTextContent } from '@uniweb/api/rich-text'   // TipTap 3.x, an optional peer: install it, load the editor lazily
const editor = useRichTextEditor({ value, onChange })                         // onChange(doc): each change as a backend stores it
<RichTextContent editor={editor} />                                           // your toolbar: editor.chain().focus().toggleBold().run()
```

Its document model is the stored vocabulary: it edits what TipTap's kit does, underline included, plus superscript and subscript (`toggleSuperscript()`, `toggleSubscript()`), with a divider for the rule, and keeps everything else a stored text holds. `richTextLength(doc)` counts a text as a field's `max_length` does (the characters a reader sees; a new line or paragraph is one), for a counter. Don't configure TipTap yourself for a rich-text field: what it makes beyond the vocabulary is left out when saved, which the mock prints.

## Translated fields

A `localized` field holds `{ en: '…', fr: '…' }` or one plain value for every language; a read answers in the page's language. Never write that one value back as the whole field — it becomes every language's value.

```jsx
const { entity } = useEntity({ schema: '@/profile', uuid, languages: 'all' })        // every language, as stored
await writer.update(item.id, { ...item.data, bio: 'Bonjour' }, { language: 'fr' })   // one language, merged
```

`update` with `{ language }` merges the translated fields you name and keeps the ones you leave out. On a multilingual site, an update without it that writes a plain value over a translated field read in the page's language is refused. `languagesOf`, `inLanguage`, `withLanguage` read and set one language of a value, `@` metadata kept.

## Permissions are the server's; your UI is a courtesy

Gate controls on what the viewer may do — `mayDo(entry, 'edit' | 'delete' | 'share')` on a record or a list row, `useMayCreate({ schemas })` for a type, each `'now'`, `'once-elevated'` (confirm it is them first, then act), `'no'` or `null` (not told: offer it) — but never rely on that for safety: a foundation runs with the viewer's authority, so hiding a button hides a button. Not on `viewer.roles` alone: a session holds its roles as a reader's until elevated, so a gate on `system_admin` shows the operator nothing until then. Draw a role-acting control from `useElevation().rolesInFull` and let the record answer.

What protects content is the **entry**: a member writes their own entries and not another's, enforced by the store. **Every type starts closed**: the operator adds its entries, and anyone else only where the site's `blueprint.yml` opens it (below). A schema protects how an item changes and who reads an entry:

```yaml
# schemas/attendance.yml
sections:
  checkins: { many: true, append_only: true }    # added, never edited or removed, by anyone — holds against the author

# schemas/submission.yml
grantable: false                                 # never shared one at a time
fields:
  course: { ref: '@/course', readable_with: edit }   # the course's editors read it (read only), via: 'rbac'

# schemas/course.yml
fields:
  lessons: { ref: '@/lesson', many: true, sold_with: true }   # a buyer of the course reads its lessons (up to three steps)

# schemas/inquiry.yml
fields:
  email: { type: email, required: true, visitor_fills: true }   # a site's visitor may fill it, with no account
```

`readable_with` (`read` | `edit` | `admin`, only on a reference) is one step; a backend refuses adding it to a field entries already fill. `grantable: false` keeps entries from being shared with a person or team. `sold_with` only on a reference; an unmarked one carries nothing. `visitor_fills: true` marks a field a site's visitor may fill, and a type with one takes visitors' submissions, confirmed by email. Mark it per field, on a top-level section's fields only. The build refuses it on files, on a reference with `readable_with`/`sold_with`, and in a section that leaves a `required` field unmarked.

## Who adds and reads each type: `blueprint.yml`

Beside `site.yml`, in a site whose `services` names `backend`: how a backend started from the site begins.

```yaml
signup: invite_only          # or open, the default: who may create an account
teams:                       # founded empty; people join them in the backend's administration
  sales: { label: Sales }
  paid-members:              # …or the backend keeps them in: whoever holds a membership, bought or subscribed
    label: Paid members
    joins: { holds: ['@/membership'] }
access:
  '@/vehicle':
    add: [sales]             # who adds entries: open (every signed-in account) · [teams] · [] (the operator alone)
    all: { sales: edit }     # every entry of the type, not only one's own: <team> or members → read | edit
  '@/request': { add: open } # each member keeps their own
publicQueries:               # what visitors who aren't signed in may read
  '@/vehicle': { whole: true, where: { status: { in: [available, pending] } } }   # whole is required; false = briefs
integrations:                # by a mapping the foundation declares in src/mappings/<name>.yml
  meta-catalog: { mapping: '@/vehicle-to-meta', channel: feed, trigger: on_fetch, enabled: true }
```

- **Applied once**, when a backend is started from the site: its own, a clone's of a template, or one started again after it was destroyed. Then the operator changes these in the backend's administration. An edited file is pushed and pulled with the site, and reaches no backend already running: once the site's has started, a push or publish that sends a change says so, and so does `uniweb status`.
- A type not listed stays closed. Name types as `queries.yml` does: `@/vehicle` for the foundation's own, sent in its scope.
- A build, a push and `uniweb doctor` refuse a malformed file, naming the key; a push refuses whole. A type none of the site's foundations declares only warns: a backend started from the site leaves that line out, and the publish says so. `where`, `sort` and `limit` are the backend's to judge, and one it refuses is left out the same way.
- An integration's `channel`/`trigger` pairs: `file`+`manual`, `feed`+`on_fetch`, `email` or `http` + `on_create`/`on_match`/`on_change`/`manual`. `enabled: true` only on `file` or `feed` (or an `http` line naming a `vendor`); an address, URL or key is never the file's (the owner gives it in the administration). An `http` line may name a `reply` mapping (named as `mapping` is) and, with it, `reply_about: section.field`. A mapping (`src/mappings/`, one per file, `model: '@/vehicle'` plus its rules) registers with the foundation; the build refuses one naming no `model`, or an `@/x` type (its `model`, or a `follow` line's `model`) or `keys_from` the foundation does not define. Its body, which `register` checks against the type: **in every rule the left side is written and the right side read**, so inbound `- listing.vin: VIN` (your field: their path) and outbound `- vin: listing.vin`. `fields` is a list of one-entry maps for `single` Sections only. A `multi` Section goes under `sections: [{ section, path, key, fields }]`, its fields by bare key, and inbound it needs `key`. An inbound `list` needs `key`, the path that identifies an entry. CSV and XML values are text, so an `int`/`decimal` field takes `number: {}` and a boolean takes a `lookup`. Outbound, `follow` reaches other entries: forward along a reference (`- quiz: { field: identity.quiz_ref }`), or in reverse to the one entry of a type whose field names one above (`- key: { model: '@/quiz-key', field: identity.quiz, names: quiz }`). A rule reads a followed entry as `quiz:identity.slug`. `reference/mappings.md` in the docs holds every key, conversion and refusal: read it before writing one. A library's mappings (its `mappings/`, named in its scope) are carried by `mappings: ['@acme/x']` in the foundation's `main.js`; `register` sends them from the library first, and the site names them in full. An `http` line may name `vendor: '@/courses#grade'` in place of an address: a function in a compute file (`src/compute/<name>.js`, or a library's `compute/` carried by `compute: ['@acme/x']` in `main.js`), run by the platform; only such a line may also take `enabled: true`. A compute file is one plain module of named function exports with no imports, sent as written; a call takes `input` (what `mapping` wrote), returns a JSON object read by `reply`, and changes nothing outside itself. `uniweb compute run courses#grade --input in.json` runs one under the rules it runs by (no Node globals, no network, frozen built-ins), which a test in Node doesn't. The full rules are in `web-apps/compute-functions.md`.
- A team's `all: edit` reaches the entries once the member confirms it is them (below); a team's `add` and `members: edit` need no confirming. Who is put in a team, and roles, are never the file's.
- **`members` is everyone with an account, never the people who paid.** A paying group is a team that `joins: { holds: [types] }`: the backend puts in whoever holds a record of a type listed, bought or by a live subscription, and takes them out when it lapses or is refunded (a gift doesn't count; the owner adds that person by hand, and either reason keeps them in). The file names types only; a condition on one record, and which teams may buy an offering, are set in the Admin App. Name the team in `access` like any other: `'@/photo': { add: [paid-members] }`.
- **A site never learns which teams the viewer is in.** Show a member-only screen by what they may do: `useMayCreate`, `mayDo`, and for buying `offeringState`.
- A static build carries none of it. A pull writes it back here, never into `site.yml`.

## Your admin area, and the Solution Owner Console

A site with an engine is a solution: public pages, a members' area for each role, and an **admin area** for the people who run it — its staff, its instructors. You build the admin area: section types of your foundation, branded, in the solution's own words, with what follows. The **Solution Owner Console** is the engine's own administration, the same for every solution: the payment account, the teams and who is in them, roles, an integration's address and keys, the store's offerings and coupons. Never rebuild those; link to it (`adminHref`, below). `web-apps/building-a-solution.md` in the docs walks the whole path.

From a terminal, once the site is published and its engine is running, `uniweb site admin` opens the Solution Owner Console in the browser, signed in as the site's owner, and `uniweb site visit` opens the site signed in the same way. Only the owner can use them. The address they open signs the person in, so they never print it: where no browser can open, they say so and stop, and the person runs the command where one can.

## Selling

```jsx
import { useStore, offeringState, useCoupon, couponReason, useEntitlements, useHolders } from '@uniweb/api'
const { status, store, offerings, checkout, checking } = useStore({ entity: course.uuid })   // 'none': the site sells nothing
offeringState(offering, store)   // 'owned' · 'not-eligible' (sold to some teams, not this person's) · 'take' (a free one-off) · 'not-ready' (payments not connected) · 'buy'
await checkout(offering)         // sends the buyer to pay; a free one-off is held at once: { url: null, held: true }
```

- **What the store sells is an entry of the engine**: a course or a membership your admin area creates with `useEntityWriter` or `useEntityForm`, or one the owner adds. Never a `records/` file: that is the site's content, which the engine never holds, so the owner finds nothing to put on sale.
- The owner sets prices in the Solution Owner Console, under **Store catalog**: create a catalog first, then add each entry with its price. They also connect their own Stripe account there. `price` is in the currency's smallest unit. Nobody signed in → `absent`: the store is a signed-in member's to read.
- After paying, the buyer lands on `successUrl` (this page by default). The purchase is written when the payment's notice arrives, so the page there calls `refresh()` until the offering reads `owned`.
- A purchase lets the buyer read the record, and through it what its `sold_with` references point to: `useEntity({ schema: '@/lesson', uuid, via: course.uuid })`.
- **Only buyers act on what's inside a sold thing** when the engine checks it, not your UI. An entry can point only at records its creator can read or reach through a purchase, so: (1) don't open the sold type to `members` in `blueprint.yml` (signed-in people see its card in the store, and visitors through a public query); (2) the sold type lists its parts with `sold_with: true`; (3) what a buyer creates points at a part through a **`required`** reference (a submission's `quiz: { ref: '@/quiz', required: true }`). Then a non-buyer's create is `403`. A reference that isn't required, or that names the sold type itself, lets anyone create one. The store shows the sold thing's card and the cards its card lists, so keep private data out of briefs.
- A member cancels a subscription on the site, never by writing to the owner: `const { entitlements, cancelSubscription, resumeSubscription } = useEntitlements()`. A row held by subscription carries `subscriptions` (`{ id, status, current_period_end, cancel_at_period_end }`), and `ends_at` once every way it is held is ending, the date to show ("ends on …"). `cancelSubscription(id)` ends it when the period paid for ends, and access stays until then; `resumeSubscription(id)` takes that back while the period runs.
- `useEntitlements()` — what the viewer holds, for "My courses". `useHolders({ schema, uuid })` — who holds a record, for a roster: its owner's or an `admin`'s to read, `forbidden` for anyone else, so draw nothing.
- Why a checkout was refused: `error.extensions.reason` — `payments_not_ready`, `coupon_not_applicable` (with `cause`), `not_for_sale`, `not_eligible`.
- **An offering the owner sells only to some teams** reads `can_buy: false` for anyone in none of them, and `offeringState` answers `'not-eligible'`: draw no Buy button, and show `offering.who_may_buy` when the owner wrote one ("Members only"). It never says which team. The same words reach visitors on the public catalog's offering.
- A coupon code: `const { check, coupon, applied, checking, clear } = useCoupon()`. `check(code)` previews it with the checkout's rules: `coupon.discount` (`{ type: 'percent'|'amount', value, currency?, duration }`), or `valid: false` with `coupon.reason`, one of `COUPON_CAUSE` from `@uniweb/api/wire`. `couponReason(coupon, offering)` adds `wrong_currency` (an amount off in another currency); a free offering ignores a code. Word each reason in your foundation, with a fallback for a new one. Then `checkout(offering, { coupon: applied })`. It checks again, and a refusal's `cause` is the same set.
- Paying in the page: `const { payment } = await checkout(offering, { coupon, inPage: true })`, then `<Overlay open onClose={payment.cancel}><div ref={payment.mount} /></Overlay>` and `await payment.done` (`'paid'`/`'cancelled'`; after `'paid'`, `refresh()` until `owned`). The provider's form shows the total and discount itself. Where the backend can't, `checkout` navigates to the payment page as usual.

**Prices for visitors who aren't signed in** come as records, so the first page a visit lands on already shows them, to people and to search engines. A section type declares the store's catalog, a site query reads it, the section (or its page) asks for that query, and the site's `blueprint.yml` opens it to visitors. All four are needed. Without `query: store` nothing fetches it, and the section gets no data, with no warning. The engine leaves the `publicQueries` line out (`not_a_site_type`) while no section's `data:` reads `@uniweb/catalog`.

```yaml
# queries.yml
store: { schema: '@uniweb/catalog' }
# the section's frontmatter, or its page.yml
query: store
# blueprint.yml
publicQueries:
  '@uniweb/catalog': { whole: true }
```

```jsx
// meta.js: data: { store: { schema: '@uniweb/catalog', whole: true } }
const catalogs = content.data.store   // [{ info: { name, currency }, offering: [{ entry: { schema, entity, brief }, price, currency?, charge_kind }] }]
```

- Join each record to the offering whose `entry.entity` is its uuid. `price` is in the currency's smallest unit, and `currency` is the offering's own or else `info.currency`.
- More than one catalog means none is the store, and a buyer can't pay: show no price.
- It needs the site's backend and Live Records (`records: true`). Buying, and anything that is one member's own, is `useStore()` after sign-in.
- A price the owner changes reaches visitors within about five minutes: the host keeps each answer that long, by design.
- The catalog is the backend's, written by the owner in the app, so a build and a push refuse `records/uniweb/catalog/` files.

## The inbox

```jsx
const { unread } = useNotifications({ every: 60_000, list: false })              // a badge, polled lightly
const { notifications, markRead, dismiss, markAllRead } = useNotifications()   // the rows, when opened
```

Each row is as the backend sends it (`kind`, `payload`, `read_at`, …). For `kind: 'entity_shared'`, `payload` is `{ entity_uuid, entity_model, permission, actor_handle }`. The kinds grow: draw those you know, pass over the rest. There is no push: poll the count, and read the list when it is opened.

## Signing in and up

```jsx
const { options } = useSignInOptions()   // providers, signup, email_sign_in; password: { min_length } and email_code: { length, lifetime_minutes }, each present only while offered
const { signIn, completeChallenge, resendVerification } = useSignIn()   // username, @handle or address
const code = useEmailSignIn()            // where options.email_code: request({ email }) → confirm(code); one door for new and returning members
```

Draw each way only where `options` states it. After a provider, `useSignIn().returned` says what came back (`signed-in`, `link`, `error` with its `reason`); after signing in, go to `signInReturnPath()` — the `?next=` path, never another site — or your default. `useFeedback().send({ message, kind, rating })` sends a member's feedback to the site's administrators. The backend answers an emailed code's request alike for every address, and the confirming code makes the account of an address that has none. Every refusal names `error.extensions.reason` with the values a message needs (`password_too_short` and `min_length`, `email_code_wrong` and `tries_left`, `email_code_throttled` and `retry_after_seconds`, …): `ACCOUNT_REASON` in `@uniweb/api/wire` lists them. The words are the foundation's, from content.

## Acting as an administrator

An administrator's session reads what their role reaches and changes nothing through the role until they confirm it is them; their own records they edit as always.

```jsx
const { available, elevated, until, elevate, lower, error } = useElevation()
// available: the account holds a role that does more than read — offer it only then
// elevate({ password, code }) — code when the account has a second factor; refusal: error.kind === 'auth'
// elevated turns false at `until`; lower() ends early; elevateWithProvider(provider) for a passwordless account
// ways: { password, emailCode } — an account made by an emailed code: requestCode(), then elevateWithCode({ code })
```

While elevated, `viewer.roles` names the role and every record read before is read again. Nothing says whether the account has a second factor — offer the code field. It does not open the backend's administration — the Admin link does:

```jsx
const { adminHref } = useSession()
{adminHref && <a href={adminHref}>Admin</a>}    // navigate, never fetch: the answer is a redirect with a one-time credential
```

`adminHref` is set only for an account the backend's administration admits; `null` otherwise.

## Mailed links, invitations, access, units

**Mailed links** (sign-up confirmation `?verify=`, password reset `?reset=`, invitation `?offer=`, an emailed code's sign-in `?signin=`) arrive at the site's root; the landing page finishes the step:

```jsx
const { step, status, result, error, confirm } = useMailedLink()
// step: null | 'verify' | 'reset' | 'offer' | 'signin'   status: 'idle' | 'working' | 'done' | 'error'
```

`verify` finishes by itself, and confirms the address without signing the person in (`/auth/me` stays signed out), so its next step is a sign-in. `reset` waits for `confirm({ new_password })` (`error.extensions.reason === 'password_too_short'`; the link works again). `offer` waits for a sign-in then claims; `result` is counts `{ invitations, grants }`; `error.kind === 'absent'` means unknown, revoked or used, alike — one sentence, no cause. `signin` waits for a click: `confirm()` signs in — never on load, which a mail scanner's prefetch would spend. Render it where the root renders (a header or layout). Never copy the token anywhere.

**Invitations** wait for the member's answer, mailed link or not:

```jsx
const { status, invitations, accept, decline, answering } = useInvitations()
// invitations: [{ id, unit_uuid, unit_handle, unit_name, invited_by_account_id, created_at }]
```

Draw it wherever a signed-in member lands. One that no longer waits is refused with `kind: 'rule'` and leaves the list.

**Access to an entry** — whoever administers it gives `read` | `edit` | `admin` and takes it back:

```jsx
const { status, grants, grant, revoke, working } = useAccess({ schema: '@/course', uuid: course.uuid })
// status 'ready' for whoever administers it; 'forbidden' → draw nothing
await grant({ handle: 'sam' }, 'read')     // or an account id; many ids → { results }
await revoke(grants[0])
```

Giving access is a person's decision through your UI — not a grant per entry from code; for "the course's staff read every submission" declare `readable_with` on the schema. Giving again replaces (`read` after `edit` lowers). An entry given to the viewer lists with `via: 'grant'`; `leaveAccess({ schema, uuid })` gives it up.

**Where a create lands:** the root of the organization the backend is founded with, unless the create names a unit the viewer is placed in:

```jsx
const { units } = useUnits()   // [{ unit, id, handle?, name?, parent?, depth, primary }]
await createEntity({ schema: '@/submission', unit: course.unit, items: [...] })
```

**A unit's staff**, for its administrator on an elevated session (`absent` before): `useUnitStaff({ unit })` lists the roles and `give({ account, role })` / `take(…)` them (`content_reader`, `content_editor`, `unit_admin` — the last only to someone placed in the unit, with a second factor), and `archive()` / `restore()` the unit, whose content then reads and changes for no one (`unit_archived`). `useUnitEntryGrants({ unit, schema })` gives a type's entries there to `{ account }`, `{ team }` or `{ members: true }`.

Nested items in one create: give an item `uuid: uuidv7()` and a later item names it as `parent` (`{ section: 'degrees/thesis', parent: degree, data }`); those uuids serve the write alone.

**Sent twice, made once:** give a create the new entry's own `uuid`, made once when the person starts adding it (`const [uuid] = useState(uuidv7)`), and a second click or a retry answers with the entry the first one made. Without it, each call makes an entry.

**A member's form for an entry** comes from its type: `const { form, save, errors } = useEntityForm({ schema: '@/course', uuid })` (no `uuid`: a new entry), held by kit's `useFormValues(form)` and drawn with the component that draws every `@std/form`; `save(values)`. Each control carries its field's kind and rules; `save` checks them first, and `errors` holds each problem by control path (`head.title` → `{ rule: 'max_length', max_length: 20 }`) for the foundation to word. A `File` in a `file` control is uploaded on save. List sections are written with `useEntityWriter`.

**A member's uploads:** `const { upload } = useUpload({ entity })`, then `await upload(input.files)` → `[{ url, assetId, assetExt, name, type, size, prepared, note? }]`; store `url` in the entry. Each file is prepared in the browser first, by the rule for uploaded media: a picture becomes a WebP when that makes it 10% smaller or turns it upright, and whatever is kept in its own format loses its location and camera data. Tell the member a `note`: `unconverted` (a TIFF or HEIC the browser couldn't convert) or `unreduced` (a video over the rule's bitrate). Upload through `useUpload`: it is what keeps a photo's location from going up with it.

## A backend on your machine

```yaml
# site.yml
services:
  backend: true              # ask the host for it when you publish
$devBackend: ./mock/api.js   # what answers in `uniweb dev`; `$` keys are never published
```

```js
// site/mock/api.js
import { fileURLToPath } from 'node:url'
import { createMockBackend } from '@uniweb/api/mock'
import { readBlueprint } from '@uniweb/build/blueprint'
const blueprint = readBlueprint(fileURLToPath(new URL('..', import.meta.url)))   // the site's blueprint.yml
export default createMockBackend({ seed, blueprint }).fetch
```

`uniweb dev` answers the `backend` service with it at an address on its own origin (cookies behave as in production). Write no address of your own: under `services:` an address means a backend you run. The mock begins as a backend started from the site does: every type closed until the blueprint opens it, its `signup`, its teams (a seeded account names its own, `teams: ['sales']`). It **enforces** those, entry ownership and `append_only`, and lets a buyer read through what they hold to what its `sold_with` references point to. It gives the backend's refusal reasons, holds passwords to 8 characters, signs in by emailed code, keeps rich text to the stored vocabulary, and staffs and archives units; it doesn't model public queries, `readable_with` or second factors (a seeded `twoFactor: true` stands for one). Mail it would send prints in the terminal with its link on the site's root. Seed `offers: [{ email, invitations: 1 }]` to try an invitation; a seeded entity takes `grants: { member: 'read' }`; `units: [{ handle, parent?, members, floor? }]` gives a create somewhere to land. `store: { info, offerings: [{ entry: <a seeded uuid>, price }] }`, `coupons`, `entitlements: [{ username, entity }]` and `notifications: [{ to, from?, payload }]` try selling and the inbox: a priced checkout opens a payment page of the mock's own, which takes no payment, and giving someone access adds a row to their inbox. The seed names your own types `@/track`. State is in memory; restart to reset, or `getClient().request('POST', '/_mock/reset')` for a demo's "start over" (the mock's own route). `uniweb create my-event --template conference` is a worked example.

## The engine on your machine

A solution template (its site asks for `backend` and has a `blueprint.yml`) gets its own Application Engine at `uniweb create`: Docker runs it from `~/.uniweb/engines/<name>/`, the CLI signs in to it, and `site.yml` names it, `$devBackend: { backend: …/api, records: …/{locale} }`, in place of the mock (`--no-engine` keeps the mock). `uniweb engine setup` does the same for a project that already exists. **Read `uniweb engine guide` before you build on it**: the engine's own guide, printed from the engine running here, says what its members are, how a setting changes, and what exists only once live. The person signs in to Uniweb in their browser and accepts the engine's licence there. Relay the link and wait.

`uniweb dev` then starts the engine if it's stopped and registers the foundation's types on it, again whenever `src/schemas` changes. After the first registration it sends `blueprint.yml` once. While a line names a type, mapping or compute file none of the foundations declares yet, which the engine would leave out for good, it waits and says which lines. It sends the blueprint once they do: a section type that reads `@uniweb/catalog`, for instance, registers again when its `meta.js` is saved. The page talks to the engine through the dev server, so cookies behave as in production, and queries are answered from `records/` and the engine's public entries together. The engine calls the foundation's compute functions from your working copy, so an edited function answers its next call. A setting changed after the blueprint was taken changes in the engine's Admin App (`uniweb engine status` prints where it is, and the owner's sign-in link). `uniweb engine reset --yes` wipes the engine and starts it over, so the next `uniweb dev` registers the types and sends the blueprint again. Run it when the engine refuses a type change its entries can't take (it upgrades a type in place, adding to it), and before going live: the live engine starts from `blueprint.yml` and the types, never from the local one's data. The CLI works with one backend at a time, and after setup that's the engine: going live is `uniweb login` back to Uniweb, then `uniweb publish`.

## Against the site as published

The mock is for working with no backend at hand; where it and the backend differ, the backend is right. Once the site is published to the backend you are logged in to, a local one included, `uniweb dev --published` serves this copy (its foundation and pages, with live reload) against the published site's services. Members sign in to its real backend and may do what it enforces, and pages show the records its visitors see, the entries its public queries open included. The dev server reads the service addresses from the published page and forwards each request, so the page talks to one origin and sign-in cookies behave as on the published site; `$devBackend` is not mounted. Under `--published` the copy sends its own types in full (`@acme/track`), as a build does, so the backend answers for the types it holds: one you add reaches it when you publish again. Record files reach the page through `uniweb push`, which a published site serves at once. It is the published site's real data, members' entries included, and the output says so.
