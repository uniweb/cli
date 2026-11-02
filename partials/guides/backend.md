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

What protects content is the **entry**: a member writes their own entries and not another's, enforced by the store. **Models are open** — anyone signed in may create entries of any Model. A schema protects how an item changes and who reads an entry:

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
```

`readable_with` (`read` | `edit` | `admin`, only on a reference) is one step; a backend refuses adding it to a field entries already fill. `grantable: false` keeps entries from being shared with a person or team. `sold_with` only on a reference; an unmarked one carries nothing.

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
import { createMockBackend } from '@uniweb/api/mock'
export default createMockBackend({ seed }).fetch
```

`uniweb dev` answers the `backend` service with it at an address on its own origin (cookies behave as in production). Write no address of your own: under `services:` an address means a backend you run. The mock **enforces** entry ownership and `append_only`; it doesn't model `readable_with`, `sold_with`, second factors or password rules. Mail it would send prints in the terminal with its link on the site's root. Seed `offers: [{ email, invitations: 1 }]` to try an invitation; a seeded entity takes `grants: { member: 'read' }`; `units: [{ handle, parent?, members, floor? }]` gives a create somewhere to land. The seed names your own types `@/track`. State is in memory; restart to reset. `uniweb create my-event --template conference` is a worked example.
