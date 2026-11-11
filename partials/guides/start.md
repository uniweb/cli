# Starting a project

On-demand guide (`uniweb guide start`); AGENTS.md is assumed read.

## Scaffold with the CLI — never by hand

```bash
npx uniweb@latest create my-project --template marketing
cd my-project && pnpm install    # npm install where pnpm isn't installed: create prints which
npx uniweb dev
```

Never hand-write `package.json`, `vite.config.js`, `entry.js`, or `index.html`. The CLI resolves correct versions and structure; hand-written config is the most common way to end up with a project that can't build.

`@latest` matters: a project starts on the packages and templates of the CLI that creates it, and a bare `npx uniweb` runs a globally installed `uniweb` when there is one, however old.

**Templates.** `--template <name>` gives a working site plus a foundation to study and edit. `--template none` gives the same two packages with no content — right for building a foundation from scratch or porting a design. `--blank` gives an empty workspace and assumes you'll add packages with `uniweb add`; use it only if you already know the framework.

Official templates (`uniweb template list` shows all): `marketing` (tokens, insets, grids, multi-line headings), `docs` (sidebar nav, code highlighting), `blog` (records of `@std/article`, a query, a parametric `[slug]` page), `dynamic` (live API data, loading states), `international` (i18n, records, multi-locale routing), `store` (product grids, e-commerce), `academic` (publications, timeline, math), `extensions` (multi-foundation, runtime loading), `conference` (a worked example of the `backend` service).

**npm or pnpm.** Projects include both `pnpm-workspace.yaml` and npm workspaces. Replace `pnpm` with `npm` in any command (`npm run build`, `npm run dev`).

## What you get

```
my-project/
├── src/            # the foundation — component developer's domain
├── site/           # the site — content author's domain
└── pnpm-workspace.yaml
```

A site is pure content. A foundation is the site's source code, which is why it lives in `src/`. The foundation's `package.json::name` is `src`, symmetric with `site` — a **workspace** name, how the site depends on it. What the foundation **registers as** (`@org/<name>`, the name sites pin) is `name` in its `main.js`, which `uniweb create` sets to the project's name. `uniweb register` refuses `src`, `foundation` and anything under `@uniweb`.

- **Foundation** (`src/`): React components. Those in `sections/` and `layouts/` are section types — selectable by authors via `type:`, or used for layout areas. Everything in `components/` and `utils/` is ordinary React and JS, not visible to authors.
- **Site** (`site/`): sections written in markdown, which parse into the content object a section type receives, and configuration, plus optional records and the queries that reach them or an external data source.

## Growing the workspace

```bash
uniweb add project docs                            # co-located pair → docs/src + docs/site
uniweb add foundation [name|path] [--path parent]  # no name → ./src/, bare name → ./name/, slash → that path
uniweb add site [name|path]
uniweb add extension <name> [--site <name>]        # secondary foundation; wired to the site named, or the only one
uniweb add section Hero [--foundation ui]          # sections/Hero/{index.jsx,meta.js}
uniweb add section Banner --library ui             # in a library; each foundation using it offers it
uniweb rename <foundation|site|extension> <old> <new>   # rename across the whole workspace
```

The CLI creates exactly the directory you ask for — no silent nesting under `foundations/` or `sites/`. If the target directory exists or another package of the same kind has the name, it stops with a precise error and suggests alternatives; a name held by the other kind gets a suffix (`add site marketing` beside a foundation named `marketing` makes `marketing-site`). `uniweb add section` scaffolds a starter the dev server picks up with no build or install.

Workspace layouts and their wiring (single, segregated, co-located, projects with several sites): `development/project-structures.md`. The same `@scope/name` shape means different things by position: a `foundation:` value is a catalog ref; a data-schema ref in `meta.js` resolves from an npm package (`@uniweb/schemas`, `@org/schemas`); `@uniweb/kit` in `dependencies` is an ordinary npm package.

## Learn from a working template

When unsure how to implement a pattern — data fetching, i18n, layouts, insets, theming — read a real one instead of guessing:

```bash
uniweb add project marketing --from marketing
pnpm install    # or npm install: the line add prints, by the project's lockfile
```

That creates `marketing/src/` + `marketing/site/` alongside your project. No need to build or run it. Read `marketing/src/sections/` (components with `meta.js`), `marketing/site/pages/` (real content → component mapping), and `marketing/site/theme.yml` + `site.yml`. It downloads the template, and the install needs the network too; reading it afterwards doesn't. Install several if you like. To run one: `cd marketing/site && pnpm dev`.

## The loop

```bash
uniweb dev            # the site you are in; from the workspace root, it picks one for you
pnpm build            # production build (SSG + SPA)
pnpm preview          # preview the production build
```

Markdown, `theme.yml`, and component edits hot-reload. New section types are picked up without a restart.

`uniweb dev` takes a free port and prints `Serving <site> at <url>` once the server listens — read it, never assume a port; the usual port may be another project's server. Run it in the background when you need your shell back: `uniweb dev --status` prints the address later, a second `uniweb dev` points at the running server instead of starting another, and `uniweb dev --stop` stops it. These know the server `uniweb dev` started, not one started with `vite` or `npm run dev` inside the site. Pass `--port <n>` only when a port is required: you get that one or an error, never another.
