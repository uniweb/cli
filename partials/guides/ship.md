# Shipping: hosting, Uniweb Cloud, sync, registering, staying current

On-demand guide (`uniweb guide ship`); AGENTS.md is assumed read — in particular §3 step 1: `uniweb status` first, never `--force` past a refusal, going live and spending are the person's decisions. For flags, `uniweb <command> --help` is always current.

## Commands

```bash
uniweb deploy                     # its default target; with none, a wizard (terminal only) picks one, or sets up CI
uniweb deploy --host=<adapter>    # build + upload now, from this machine
uniweb add ci --host=<adapter>    # CI so every push deploys — usually best for a free host
uniweb export                     # build dist/ for any static host (no account)
uniweb publish                    # ship to Uniweb hosting, foundation included (needs login)
uniweb add ci --target foundation # publish a foundation at permanent versioned URLs (GitHub Pages)

uniweb status                     # what changed in the app, in git and in Uniweb — and what to run (--json)
uniweb push / pull / clone        # git-style content sync with the backend
uniweb refresh / sync             # catch up (git + backend, never pushes) / catch up, then push
uniweb login [--server <url>] [--org @acme | --personal] [--token <bearer>] / logout
uniweb org list / create <handle>
uniweb register [--scope @scope]  # register a foundation + its schemas
uniweb forget --all | --server <url>
uniweb content export [dir]       # package a site (or a built foundation's schema) as .uwx
uniweb snapshot [--compare | --share]   # public/preview.webp (--share: public/share-card.png); needs @uniweb/snapshot + Chrome/Edge
uniweb -v                         # CLI version (a global install also says whether newer exists)
npx uniweb@latest update --yes    # align @uniweb/* deps + AGENTS.md; --yes answers the prompt (no tty), --dry-run previews
```

## Where a site can live

No lock-in and no default you're pushed toward:

| Path | Command | Good for |
|---|---|---|
| Free static host, via CI | `uniweb add ci --host=<adapter>` | most self-hosted sites — one command, then every push deploys |
| Free static host, from this machine | `uniweb deploy --host=<adapter>` | one-off or manual deploys |
| Any static host | `uniweb export` | full control; no account |
| Uniweb Cloud | `uniweb publish` | non-technical content authors, client work |

Adapters: `github-pages`, `cloudflare-pages`, `netlify`, `vercel`, plus `s3-cloudfront` for `deploy`. On Cloudflare Pages / Netlify / Vercel, `add ci` also adds per-PR previews. With nothing configured, `deploy` opens a picker and records the choice in `deploy.yml` beside `site.yml` — **the CLI writes it**; later deploys rewrite only `deploys:`; edit `targets:` to change where a site ships. A bare `deploy` goes to the default target, and when that's the `host: uniweb` target a publish recorded, it runs `publish`. Host credentials come from the environment. GitHub runs workflows only from the top of a repository: in a project that is a folder of a larger repo, its own `.github/` never runs — `status` says so and `add ci` refuses to write one there.

**Three independent facts** `status` opens with:

- **Synced** — the project has a site on a backend (`sync.json` names it per backend: `https://uniweb.app` by default, or `uniweb login --server <url>`), so authors can edit in the Uniweb app.
- **Published** — that backend serves it live (Uniweb Cloud). A publish is recorded in `deploy.yml` under a `host: uniweb` target; where visitors go now (a custom domain) is the backend's answer.
- **Deployed** — a build is on another host, by CI or by hand.

A site can be in more than one place. `publish` makes a change live on Cloud, `git push` on a CI-deployed host, `uniweb deploy --target <name>` on a hand-deployed one — each the person's to decide. `status` also lists the services the live site has (`services:` in `site.yml` is the request, not proof).

## Uniweb Cloud and the two-sided workflow

**Authors work visually in the Uniweb app** — same extended markdown, same params, through a visual editor, never touching git or the CLI. Every `meta.js` is registered as the foundation's schema when you publish; `meta.js` is the app's UI.

**One Uniweb workspace at a time.** The app's workspaces — not the pnpm one — are where sites and entities live: personal, an organization's, or a project space inside one (`@studio:acme`) for a customer or a purpose. Every push, pull and publish works in the workspace chosen at `uniweb login`. A site a push or publish *creates* is owned and billed there; moving it to another workspace, or transferring it to a new owner, is done in the app, not from the CLI. A site the backend keeps in another workspace stops the command. Already logged in, `uniweb login --org @other` / `--personal` switches without logging in again; `uniweb push --org @acme` for one command. **Without a terminal, a login with organizations and no workspace named signs you in but exits 2** — `uniweb login --org @acme` finishes it. A process using `UNIWEB_TOKEN` names its workspace with `UNIWEB_WORKSPACE=@acme` (or `personal`). Backend commands and `dev` reject unknown flags (`Unknown flag` — read the suggestion); `update`, `deploy` and `export` ignore them, so check the spelling.

**Sync is developer-only and one-sided.** The app is the live source of truth for content; git is the reviewed, durable record. Authors never push or pull.

**Nobody's work is overwritten without asking.** `push` is refused if the site changed on the backend since your last pull, and reports what changed. In a git repository `pull` merges like `git pull`: it commits the backend's content (*"The site's content on …"*) and merges into your branch against the last shared state. Your work and a teammate's are kept; a file the backend never had is never deleted; only a genuine overlap leaves conflict markers and a non-zero exit — settle it as in any merge, then `git commit` (where your uncommitted changes overlap, settle, `git add`, then `git stash drop`). A push or publish is refused while a file is in conflict. **In a repository a push sends what you have committed**: uncommitted site content is refused before anything is sent — commit, or `uniweb push --commit -m "…"` (commits the site's content only; `publish` and `sync` take `--commit` too). The ids the backend assigns are committed by the push itself, as `uniweb`. A push is also refused when your branch doesn't hold what this copy last took from the backend (after `git merge --abort`, or a fresh clone) — pull, then push. Outside git (including a folder the surrounding repo ignores), `pull` takes the backend's version over your files, asking first. `--force` is the deliberate overwrite in either direction. `sync` is `refresh` then `push`; neither publishes.

**Working on a site others edit:** `status` when you begin, when you come back, before push/publish/deploy, after any refusal. It reads the backend without taking anything: what changed file by file, what you hold that it lacks, who has a page open in the app right now, what in the project is uncommitted (an update, foundation source — a push neither sends nor waits for that, but a push or publish releases a changed foundation from the files). Take what changed (`pull` or `refresh`) before you edit; when someone has a page open in the app, tell the person before changing that page.

**Moving a synced project to another repository.** Where the copy last met the backend lives in git history and `.uniweb/` (not in git); `sync.json` comes along. `uniweb sync` in the old copy, copy the project without `.git/`, commit, sign in to the site's Uniweb workspace, `uniweb pull` once. If the old copy hadn't synced, `status` says the copy shares no history and lists the files that differ; the first pull makes each a conflict — settle by what you know (an app edit since the last push is the backend's side), never `--force`.

**`sync.json`** says which site this is, on each backend; the first push records the ids the backend assigned and commits it. Never edit it. **A copy of a project carries the original's `sync.json`** — `uniweb forget --all` before the copy's first push, or the push updates the original's site. It also deletes `deploy.yml`, whose targets are the original's. A copy inside the same pnpm workspace is refused until then; one outside it isn't noticed. `forget --server <url>` removes one backend's records. A record file's `$uuid` is its own and stays. Backend commands go to the backend you're logged in to (`login --server <url>` switches; a bare `login` is uniweb.app).

**`services:` in `site.yml`** is both the site's declaration and, on a pushed/published site, what you ask the host for — see the services guide for the format. A change that needs payment is settled in the app (`publish` opens it).

**The Cloud also provides a real backend for structured data**: a database per registered schema, and a CMS that edits page content and typed data entities. Either side can publish; the same foundation and site run under `dev`, `export`, or CI with no account.

## Publishing vs registering

Foundations on Cloud live in the catalog as `@org/name@version` (`name` from `main.js`). When a foundation powers one site, **don't run `uniweb register` yourself** — `uniweb publish` from the site releases the local foundation (when its code changed) and goes live in one step. A registered version is immutable, so a changed foundation is released under the next **patch** version, written into its `package.json` and committed by the push in a git repository (`--no-release` sends content only). For a change that isn't backwards compatible, set a higher minor/major yourself first. They stop when the registry holds a newer version released from another copy: pull it, or `--bump` to release above it. Register deliberately only when the foundation is a product for multiple sites; consuming sites pin `foundation: '@org/name@1.2.3'`. **The catalog is private and access-segregated** — people see only foundations licensed to sites they own or edit; the site carries the license. Schemas can be registered on their own from a schemas-only package (`@org/schemas`, or a bare `schemas/*.{yml,json,js}` folder). Auth via `uniweb login` or `UNIWEB_TOKEN`; preview with `--dry-run`.

**Extensions.** An extension is a foundation: register it (`uniweb register` in its directory) and reference it like one. A site-relative URL (`/effects/entry.js`) works only where the site serves its own files (`export`, `deploy --host`); a site published to Uniweb hosting ships no JS, so `publish` rejects it and points to the catalog-ref form. A workspace-local extension is brought along by `publish` exactly as the primary is — released if its code changed, pinned on the published site.

**Scope.** A foundation's name is `name` in `main.js`; the scope is part of it (`'@acme/marketing'`). A name with no scope is unregistered: the first `register` takes `--scope`, else the scope of the Uniweb workspace you're logged in to (an org's, or your personal `@<handle>`), asks at a terminal when you belong to orgs and chose none, refuses without one, and writes it into the name. Its own schemas register under the same scope. Once registered the scope is fixed — and it is independent of the workspace any site using the foundation lives in; sites move, scopes don't.

## Staying current

```bash
uniweb status                         # names a newer Uniweb release than this project runs
uniweb doctor                         # report drift, change nothing
npx uniweb@latest update --dry-run    # preview
npx uniweb@latest update --yes        # align @uniweb/* deps AND refresh AGENTS.md together; --yes because no tty answers the prompt
```

When `status` names a newer release, take it: update, restart any running dev server, build, look at the pages, commit what changed. A foundation is a federated ES module that links to the runtime at load time, like a shared library: the contract between them is stable across releases, and the runtime version a foundation was built against is a floor, not a pin. A hosted site moves forward when it is republished, to a runtime at or above its foundation's floor. The docs describe the latest release; a project that is behind should move, not be documented as it is. A **patch** brings fixes and features; a **minor** is where breaking changes go (`update` lists each package crossing one — build and check before shipping); a **major** is for something big. Dependencies are tilde ranges (`~1.0.1`), so `pnpm install` never crosses a minor on its own.

**Write `@latest`.** In a project, `uniweb` resolves to the copy in your own `node_modules`, pinned by your own `package.json`; it reconciles against the matrix it already has and correctly reports nothing to do. `pnpm uniweb update` and a stale global install are the same. `@latest` makes it a question about the newest release and bumps the pin. Don't `npm update` / `pnpm update` the `@uniweb/*` packages — a matched set, and it won't refresh AGENTS.md, so the guide silently drifts from the code. `update` won't refresh AGENTS.md while declared deps lag the CLI or edited deps aren't installed. Updating the CLI itself is your package manager's job (`npm i -g uniweb@latest`).

`uniweb update` rewrites AGENTS.md each version and keeps only blocks between a `<!-- project-notes:start -->` line and a `<!-- project-notes:end -->` line, which it moves to the end (markers that don't pair leave the file as it is) — keep project conventions in a file of your own (`NOTES.md`) and point to it from that block.

### Retired forms — most stop the build or a push; write the right-hand column

| Retired | Now |
|---|---|
| `data:` in a section's frontmatter (old name for `query:`) | `query:` / `fetch:` |
| `route:` on a query | the record's `$route` |
| `refine: true`, `detail: false` on a fetch | `current: only / exclude / include` |
| `filter:` on a query or fetch | `where:`, a where-object |
| `under`, `like` in a `where:` | `scope:`; `starts_with`, `ends_with`, `contains` |
| `merge:` on a fetch; `sync:` on a query | a fetch fills the key it names; every file in `records/` is pushed, unless its name starts with `_` |
| `deferred:` on a query; `'@std/article/*'` | the schema's brief decides what a list holds; `whole: true` on the data key |
| `path`, `url`, `method`, `body`, `transform`, `detail`, `scope` on a `fetch:`; `detailUrl:` | on the query (`url:`, `record:`, `scope:`) |
| `fetcher.baseUrl / headers / envelope / supports / request.*` | a transport under `fetcher.transports` |
| top-level `search:`, `submit:`, `assistant:`, `tracking:`, `api:`; `services.api`; `$devApi` | `services.<name>`; `services.backend`; `$devBackend` |
| `published: false` on a record | `draft: true` |
| `slug:` key in a record file; a file holding a list | the file name is the record's name; one record per file |
| `[dir]` / `[path]` as parametric folder names; a folder inside `[...path]/` | `[slug]`, `[uuid]`, `[<field>]`, `[...path]` |
| `fonts.mono` | `fonts.code` |
| `seo.baseUrl`; `seo.defaultImage`; `seo.locales`; `url:`, `trailingSlash:` in `site.yml` | `seo.origin` (scheme + host, no path); `seo.image`; `languages:`; `seo.origin` again |
| `creatable_by` in a schema | who adds a type's entries is `blueprint.yml`'s `access.<type>.add`; a schema protects them with `append_only`, `readable_with`, `grantable` |
| `uniweb.id`, `uniweb.scope` in a foundation's `package.json` | `name: '@scope/name'` in `main.js` |
| `main.jsx`, `foundation.js`; JSX in a `.js` component | `main.js` (plain JS); `.jsx` |
| `visuals:` in `meta.js`; `data` as a `content:` element | a `media:` element in `content:`; declare the tag in `data:` |
| `versions:` in a folder | a folder named `v1` (`uniweb add version`) |
| `runtimePolicy: auto-patch / auto-minor` | omit; the framework doesn't read it |
