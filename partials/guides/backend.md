# Backend: when the site is also an app

On-demand guide (`uniweb guide backend`); AGENTS.md is assumed read. Only for a site with its own `backend` service — accounts, per-visitor data, records its members create and edit. A site without one is the normal case; a foundation that assumes one breaks everywhere else.

```bash
npm install @uniweb/api      # in the FOUNDATION, beside @uniweb/kit — and in the site, if it has a $devBackend mock
```

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
- **`absent` ≠ empty `ready`.** `absent` = no live source (no backend, or nobody signed in) → render authored content. `ready` with `records: []` = the service answered, nothing there → your empty state. Confusing them tells a visitor their content is gone when it was never requested.

## Writing

```jsx
const writer = useEntityWriter({ schema: '@/track', uuid: track.uuid })
await writer.create({ title: 'Keynote' }, { section: 'sessions', position: 'last' })
await writer.update(itemId, { ...item.data, room: 'Hall A' })   // whole-data replace — spread what you aren't editing
await writer.move(itemId, { after: previousItemId })            // 'first', 'last' or { after } — never an index
await writer.remove(itemId)
```

- `section` is required on `create`: an entity has several, and a rule declared on one (insert-only) doesn't reach an item that landed in another.
- Ordering is the server's; never compute an order number.
- `writer.conflict` is reported, not retried — a retry would overwrite a change nobody looked at. Tell the person.

## Translated fields

A `localized` field holds `{ en: '…', fr: '…' }` or one plain value for every language; a read answers in the page's language. Never write that one value back as the whole field — it becomes every language's value.

```jsx
const { entity } = useEntity({ schema: '@/profile', uuid, languages: 'all' })        // every language, as stored
await writer.update(item.id, { ...item.data, bio: 'Bonjour' }, { language: 'fr' })   // one language, merged
```

`update` with `{ language }` merges the translated fields you name and keeps the ones you leave out. On a multilingual site, an update without it that writes a plain value over a translated field read in the page's language is refused. `languagesOf`, `inLanguage`, `withLanguage` read and set one language of a value, `@` metadata kept.

## Permissions are the server's; your UI is a courtesy

Gate controls on what the viewer may do — a record's `can_edit` from a single-entity read — but never rely on that for safety: a foundation runs with the viewer's authority, so hiding a button hides a button. Not on `viewer.roles` alone: a session holds its roles as a reader's until elevated, so a gate on `system_admin` shows the operator nothing until then. Draw a role-acting control from `useElevation().rolesInFull` and let the record answer.

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
- An integration's `channel`/`trigger` pairs: `file`+`manual`, `feed`+`on_fetch`, `email` or `http` + `on_create`/`on_match`/`on_change`/`manual`. `enabled: true` only on `file` or `feed` (or an `http` line naming a `vendor`); an address, URL or key is never the file's (the owner gives it in the administration). An `http` line may name a `reply` mapping (named as `mapping` is) and, with it, `reply_about: section.field`. A mapping (`src/mappings/`, one per file, `model: '@/vehicle'` plus its rules) registers with the foundation; the build refuses one naming no `model`, or an `@/x` type (its `model`, or a `follow` line's `model`) or `keys_from` the foundation does not define. A library's mappings (its `mappings/`, named in its scope) are carried by `mappings: ['@acme/x']` in the foundation's `main.js`; `register` sends them from the library first, and the site names them in full. An `http` line may name `vendor: '@/courses#grade'` in place of an address: a function in a compute file (`src/compute/<name>.js`, or a library's `compute/` carried by `compute: ['@acme/x']` in `main.js`), run by the platform; only such a line may also take `enabled: true`. A compute file is one plain module of named function exports with no imports, sent as written; a call takes `input` (what `mapping` wrote), returns a JSON object read by `reply`, and changes nothing outside itself. `uniweb compute run courses#grade --input in.json` runs one under the rules it runs by (no Node globals, no network, frozen built-ins), which a test in Node doesn't. The full rules are in the docs' Compute Functions page.
- A team's `all: edit` reaches the entries once the member confirms it is them (below); a team's `add` and `members: edit` need no confirming. Who is in a team, and roles, are never the file's.
- A static build carries none of it. A pull writes it back here, never into `site.yml`.

## Acting as an administrator

An administrator's session reads what their role reaches and changes nothing through the role until they confirm it is them; their own records they edit as always.

```jsx
const { available, elevated, until, elevate, lower, error } = useElevation()
// available: the account holds a role that does more than read — offer it only then
// elevate({ password, code }) — code when the account has a second factor; refusal: error.kind === 'auth'
// elevated turns false at `until`; lower() ends early; elevateWithProvider(provider) for a passwordless account
```

While elevated, `viewer.roles` names the role and every record read before is read again. Nothing says whether the account has a second factor — offer the code field. It does not open the backend's administration — the Admin link does:

```jsx
const { adminHref } = useSession()
{adminHref && <a href={adminHref}>Admin</a>}    // navigate, never fetch: the answer is a redirect with a one-time credential
```

`adminHref` is set only for an account the backend's administration admits; `null` otherwise.

## Mailed links, invitations, access, units

**Mailed links** (sign-up confirmation `?verify=`, password reset `?reset=`, invitation `?offer=`) arrive at the site's root; the landing page finishes the step:

```jsx
const { step, status, result, error, confirm } = useMailedLink()
// step: null | 'verify' | 'reset' | 'offer'   status: 'idle' | 'working' | 'done' | 'error'
```

`verify` finishes by itself. `reset` waits for `confirm({ new_password })` (`error.extensions.reason === 'password_too_short'`; the link works again). `offer` waits for a sign-in then claims; `result` is counts `{ invitations, grants }`; `error.kind === 'absent'` means unknown, revoked or used, alike — one sentence, no cause. Render it where the root renders (a header or layout). Never copy the token anywhere.

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

Nested items in one create: give an item `uuid: uuidv7()` and a later item names it as `parent` (`{ section: 'degrees/thesis', parent: degree, data }`); those uuids serve the write alone.

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

`uniweb dev` answers the `backend` service with it at an address on its own origin (cookies behave as in production). Write no address of your own: under `services:` an address means a backend you run. The mock begins as a backend started from the site does: every type closed until the blueprint opens it, its `signup`, its teams (a seeded account names its own, `teams: ['sales']`). It **enforces** those, entry ownership and `append_only`; it doesn't model public queries, `readable_with`, `sold_with`, second factors or password rules. Mail it would send prints in the terminal with its link on the site's root. Seed `offers: [{ email, invitations: 1 }]` to try an invitation; a seeded entity takes `grants: { member: 'read' }`; `units: [{ handle, parent?, members, floor? }]` gives a create somewhere to land. The seed names your own types `@/track`. State is in memory; restart to reset. `uniweb create my-event --template conference` is a worked example.
