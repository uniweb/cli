# uniweb

The CLI for [Uniweb](https://uniweb.io): an open-source React framework and a connected visual authoring platform.

**Developers define the vocabulary. Authors compose with it. Uniweb keeps both sides in sync.**

Developers build real React components, schemas and content structures in a normal codebase. Those definitions become the vocabulary authors use in the Uniweb app to create pages, manage content and work with structured data. Your project and the authors' workspace are two interfaces to the same website, and the CLI keeps them in sync, so both sides keep working.

```text
Traditional:   developer builds → hands off → CMS users edit

Uniweb:        developer project ⇄ Uniweb ⇄ author workspace
                      ↑                          ↑
                      └──── both keep working ───┘
```

## Quick Start

```bash
npx uniweb@latest create my-site
cd my-site
pnpm install    # or npm install
pnpm dev        # or npm run dev — prints the address it serves the site at
```

At a terminal, `create` asks which template to start from (`npm create uniweb` does the same). Edit the pages in `site/pages/` and the section types in `src/sections/`, and the page updates as you save.

Start with a normal project, and connect the authoring app when you want it:

```bash
pnpm uniweb login    # sign in to your Uniweb account
pnpm uniweb sync     # the first sync brings the site and its foundation into the app
```

> **pnpm ready** — `pnpm create uniweb` works out of the box. Projects include both `pnpm-workspace.yaml` and npm workspaces.

### With an AI agent

Building a site with an AI coding agent? Ask it to run `npx uniweb@latest start` first. It prints a short guide written for the agent: how to create the project, where its manual is (`AGENTS.md`), how to run it, and how to bring the site into the Uniweb app. The agent runs every command; you only use your browser, to sign in and to pay when the site goes live.

## Two Interfaces to One Website

| Developers | Authors |
| --- | --- |
| React components | Visual components |
| Schemas and configuration | Forms and structured records |
| Vite and local development | Live visual editing |
| Files and Git | Content and composition |
| `push` · `pull` · `sync` · `publish` | Changes appear live |

**For developers, it's a normal project.** Section types are React components, content is markdown in the repository, Vite builds it, and git holds the history. You keep your editor, terminal and deployment workflow.

**For authors, it's the Uniweb app.** Your section types become their building blocks: they compose pages from them, set the options each one declares in its `meta.js`, and manage records through your schemas, with live previews. They never see JSX, markdown, YAML or git, and you never build an editing UI. You build the components; Uniweb builds the authoring experience.

### The CLI is the bridge

| Command | What it does |
| --- | --- |
| `uniweb push` | Sends your section types, schemas and content to the app: a draft, not live |
| `uniweb pull` | Brings authors' edits into your files, as a git merge |
| `uniweb sync` | Takes your teammates' commits and the authors' edits, then pushes yours |
| `uniweb publish` | Pushes, then takes the site live on Uniweb hosting (paid) |
| `uniweb clone <site-uuid>` | Starts a local project from a site made in the app (`uniweb site list` shows its uuid) |

Edits to different sections combine. When the same section changed on both sides, `pull` stops at a git conflict for you to settle, and a push stops rather than overwrite what an author changed (only `--force` goes past it), so neither edit is lost. Like git, a push sends what you have committed; `--commit` commits the site's content first.

## What You Get

Every project starts as a workspace with two packages:

- **`site/`** — Content, pages, entry point (package name: `site`)
- **`src/`** — React components, the site's source code (package name: `src`)

A site is pure content. A foundation is the site's source code — that's why it lives in `src/`. Content lives in markdown and component code in React, so neither can break the other. As your project grows, use `uniweb add` to add more foundations, sites, and extensions.

```
my-project/
├── site/                     # Content + configuration
│   ├── pages/                # File-based routing
│   │   └── home/
│   │       ├── page.yml      # Page metadata
│   │       └── 1-welcome.md  # A section
│   ├── site.yml              # Site configuration
│   ├── theme.yml             # Colors, fonts, appearance
│   ├── entry.js              # Entry point (~6 lines)
│   ├── vite.config.js        # One-line config
│   └── public/               # Static assets
│
├── src/                      # Foundation package (the site's source)
│   ├── sections/             # Section types (addressable from markdown)
│   │   ├── Hero.jsx          # Bare file → section type (no meta.js needed)
│   │   └── Features/
│   │       ├── index.jsx
│   │       └── meta.js       # Content interface (params, presets)
│   ├── components/           # Regular React components
│   ├── main.js               # Foundation declarations (name, theme variables, default layout)
│   ├── styles.css            # Tailwind v4 + CSS tokens
│   ├── package.json          # name: "src"
│   └── vite.config.js        # 3-line config
│
└── AGENTS.md                 # The project's manual, for developers and AI agents
```

**Pages are folders.** Create `pages/about/` with markdown files inside → visit `/about`. That's the whole routing model.

**Batteries included:** File-based routing, pre-rendering, localization, dynamic routes, media processing, search indexing, and more. See [Building with Uniweb](https://github.com/uniweb/docs/blob/main/development/building-with-uniweb.md) for the full list.

### Content as Markdown

```markdown
---
type: Hero
theme: dark
---

# Welcome

Build something great.

[Get Started](#)
```

Frontmatter names the section type and its configuration — `theme: dark` sets the section's color context. The body contains the actual content—headings, paragraphs, links, images—which gets semantically parsed into structured data your component receives.

### Beyond Markdown

For content that doesn't fit markdown patterns—products, team members, events—use tagged data blocks:

````markdown
```yaml:team-member
name: Sarah Chen
role: Lead Architect
```
````

Access the parsed data via `content.data`:

```jsx
function TeamCard({ content }) {
  const member = content.data['team-member']
  return (
    <div>
      {member.name} — {member.role}
    </div>
  )
}
```

Natural content stays in markdown; structured data goes in tagged blocks (YAML or JSON). Content that many pages share — people, publications, events — can live as records instead, typed by your foundation's schemas, which is what authors then manage as forms in the app.

### Components as React

```jsx
import { H1, P, Link } from '@uniweb/kit'

export default function Hero({ content }) {
  const { title, paragraphs, links } = content

  return (
    <div className="py-20 text-center">
      <H1 text={title} className="text-4xl font-bold text-heading" />
      <P text={paragraphs[0]} className="mt-4 text-xl text-body" />
      {links[0] && (
        <Link
          to={links[0].href}
          className="mt-8 inline-block rounded bg-primary px-6 py-3 text-primary-foreground"
        >
          {links[0].label}
        </Link>
      )}
    </div>
  )
}
```

Standard React. Standard Tailwind. Classes like `text-heading` and `bg-primary` are theme tokens, so one component adapts to light and dark sections and to every site's colors; the runtime wraps each section in its `<section>` and paints its background. The `{ content, params }` interface is only for _section types_ — components that content creators select in markdown frontmatter. Everything else uses regular React props.

### Composition

Sections aren't limited to flat content. Content authors can embed interactive React components using markdown image syntax:

```markdown
---
type: SplitContent
---

# See it in action

The architecture handles the hard parts so you can focus on what matters.

![Live metrics](@PerformanceChart){period=30d}
```

`@PerformanceChart` is a full React component — a ThreeJS animation, an interactive diagram, a live data visualization — placed by the content author, rendered in the component's visual slot via `<Visual>`. It looks like an image reference, but it can be anything.

Authors can also compose layouts from reusable section types using child sections:

```
pages/home/
├── page.yml                 # nest: { highlights: [stats, testimonial, demo] }
├── highlights.md            # type: Grid
├── @stats.md                # type: StatCard
├── @testimonial.md          # type: Testimonial
└── @demo.md                 # type: SplitContent (with an embedded @LiveDemo inset)
```

Three different section types, arranged in a grid, one with an interactive component inside it — all authored in markdown. An `@` file is a child section, and `nest:` in `page.yml` says whose. The developer builds reusable pieces; the content author composes them. See the [Component Patterns guide](https://github.com/uniweb/docs/blob/main/development/component-patterns.md) for the full composition model.

## Templates

| Template | Description |
| --- | --- |
| **Starter** | Foundation + site + sample content (default) |
| **None** | Foundation + site with no content |
| **Blank** (`--blank`) | An empty workspace — grow it with `uniweb add` |

**Official templates** — marketing sites, documentation, blogs, academic sites and more — each come with a working foundation and sample content. `uniweb template list` shows the ones your CLI scaffolds, and you can [see them live](https://uniweb.github.io/templates/).

**Two starting points.** Either let the CLI create a new directory:

```bash
pnpm create uniweb my-site --template docs
```

…or scaffold inside an existing directory (e.g., a freshly-cloned GitHub repo):

```bash
pnpm create uniweb . --template docs
```

### Local Scripts

Run these from the **project root**:

```bash
pnpm dev        # Start development server
pnpm build      # Build foundation + site for production
pnpm preview    # Preview the production build
```

The `build` command outputs to `site/dist/`. With pre-rendering enabled (the default for official templates), you get static HTML files ready to deploy anywhere.

## Next Steps

After creating your project:

1. **Explore the structure** — Browse `site/pages/` to see how content is organized. Each page folder contains `page.yml` (metadata) and `.md` files (sections).

2. **Generate component docs** — Run `uniweb docs` to create `COMPONENTS.md` with all available components, their parameters, and presets.

3. **Learn the configuration** — Run `uniweb docs site` or `uniweb docs page` for quick reference on configuration options.

4. **Create a section type** — `uniweb add section Banner` scaffolds one, or add a file to `src/sections/` (e.g., `Banner.jsx`): the dev server picks it up. Bare files at the root are discovered automatically — no `meta.js` needed. Add `meta.js` when you want to declare params or presets. See the [Component Metadata Reference](https://github.com/uniweb/docs/blob/main/reference/component-metadata.md) for the full schema.

`meta.js` declares what content and parameters a section type accepts. The runtime fills each param from its default there, and hands every section the full content shape, so your components need no defensive null checks.

### Your First Content Change

Open a section of the home page (in the starter, `site/pages/home/1-welcome.md`) and edit the headline:

```markdown
---
type: Section
---

# Your New Headline Here

Updated description text.

[Get Started](/about)
```

Save and see the change instantly in your browser.

### Your First Component Change

Open the section type that renders it (in the starter, `src/sections/Section/index.jsx`). The component receives parsed content:

```jsx
export default function Section({ content, params }) {
  const { title, paragraphs, links, images, items } = content
  // Edit the JSX below...
}
```

The parser extracts semantic elements from markdown—`title` from the first heading, `paragraphs` from body text, `links` from `[text](url)`, and so on. The `items` array contains child groups created when headings appear after content (useful for features, pricing tiers, team members, etc.).

## Foundations Are Portable

The `src/` folder (your project's foundation) ships with your project as a convenience, but sites reference a foundation by configuration, not by folder proximity.

**Two ways to use a foundation:**

| Mode             | How it works                       | Best for                                           |
| ---------------- | ---------------------------------- | -------------------------------------------------- |
| **Local folder** | Foundation lives in your workspace | Developing site and components together            |
| **Runtime link** | Foundation loads from a URL        | Independent release cycles, platform-managed sites |

Develop a foundation locally, then register it for other sites to use. A site can also name a registered foundation instead of a local one — a project made by `uniweb clone` does — and `uniweb dev` runs it, while Uniweb hosting builds and serves it. The site doesn't care where its components come from.

**This enables two development patterns:**

_Site-first_ — You're building a website. The foundation is your component library, co-developed with the site. This is the common case.

_Foundation-first_ — You're building a component system. The site is a test harness with sample content. The real sites live elsewhere—other repositories, other teams, or managed on [uniweb.app](https://uniweb.app). Use `uniweb add site` to add multiple test sites exercising a shared foundation.

## Growing Your Project

> **Install the CLI globally** with `npm i -g uniweb` for the best experience — inside a project it runs the project's own copy. Keep it current: `create` and `clone` start a project on the CLI that runs them, so a global install stops them when a newer release is out. Without a global install, use `npx uniweb@latest create` to start a project and `pnpm uniweb` inside one.

Start simple. Add what you need, when you need it:

```bash
# Create a blank workspace
uniweb create my-workspace --blank

cd my-workspace

# Add a co-located foundation + site pair
uniweb add project blog

# Add a second foundation at root
uniweb add foundation doc-kit

# Add a site wired to a specific foundation
uniweb add site docs --foundation doc-kit

# Add an extension (auto-wired to the only site)
uniweb add extension effects

# Scaffold + apply content from an official template
uniweb add project marketing --from marketing

# Install dependencies and run in dev mode
pnpm install # or npm install
pnpm dev     # or npm run dev
```

The workspace grows organically. `add` handles placement, wires dependencies, updates workspace globs, and generates root scripts. The name you provide becomes both the directory name and the package name. Use `--path` to override default placement, or `--project` for explicit co-located layouts.

## Other Ways to Ship

A Uniweb project produces two artifacts — a **site** (content) and a **foundation** (code). Connected to the app, both sides edit one site, as above. The framework also works on its own, and **who manages the content** decides what you ship.

### You manage the content, in files

You (or your dev team) write the markdown. Deploy site + foundation together. The shortest path to a live site is free, on GitHub Pages, with a custom domain:

```bash
uniweb create .   # from within a freshly-cloned GitHub repo
uniweb add ci --host=github-pages
# Commit, push to GitHub, enable Pages in repo settings → live site
```

`uniweb add ci` scaffolds a GitHub Actions workflow that runs `uniweb build` on each push. Pre-rendering is on by default — static HTML, fast first paint, SEO out of the box. Use `--domain=<domain>` for a custom domain.

**Other free static hosts.** Cloudflare Pages, Netlify, and Vercel work three ways: `uniweb add ci --host=<adapter>` scaffolds a workflow (and a per-PR preview that comments the URL), connecting the repo through their dashboard lets the host build it with no config at all, or `uniweb deploy --host=<adapter>` uploads from your machine.

**When to choose Uniweb hosting instead** (paid): when you need dynamic-page prerender at the edge (for collections fetched at runtime, not just at build time), foundation/runtime version propagation without redeploying every site, or edge SSR. If your site's content lives in markdown and updates ship via git, free CI is the right call.

### Your clients manage the content, in the app

You're building a foundation for clients, content authors, or any team that won't write markdown. The foundation is your product; the repo's `site/` is a test harness for the code (run `pnpm dev` to preview your components against sample content). You don't deploy a site — you register a foundation:

```bash
cd src
uniweb register --scope @your-org
```

Real sites built on your foundation are managed in the **Uniweb app** — a visual editor designed for non-technical authors. They never see git, markdown, yaml, or React. They see *your* components, with live previews and visual controls for the params you defined. The foundation becomes the editor's native vocabulary for that site: you keep creative control of the design system, they get an editor that feels custom-built for them.

This is the best path when site content has a life independent of the foundation's release cycle — agencies, design studios, multi-client teams, or any project where content authors aren't the same people as the developers.

### Commands at a glance

| Command | What it does |
| --- | --- |
| `uniweb deploy` | Ask where the site should go, then do it. Remembers the answer in `deploy.yml`. |
| `uniweb add ci --host=<adapter>` | Scaffold a CI workflow (+ PR previews) so every push deploys. `github-pages`, `cloudflare-pages`, `netlify`, `vercel`. |
| `uniweb add ci --target foundation` | Publish foundations at permanent versioned GitHub Pages URLs — the free alternative to the catalog. |
| `uniweb publish` | Go live on Uniweb hosting (paid) — brings the site's foundation along, pushes the content, and serves the site dynamically. The canonical verb for Uniweb hosting. |
| `uniweb deploy --host=<adapter>` | Ship to a third-party static host in one step — builds `dist/`, uploads, invalidates. Drives that host's own CLI. |
| `uniweb export` | Produce a self-contained `dist/` for any static host. You upload it yourself. `--host=<adapter>` adds host-specific helper files. |
| `uniweb register --scope @org` | Register a foundation to the registry, for sites managed in the app. |
| `uniweb build` | Inspect a build locally. For shipping, use `publish` (Uniweb hosting) or `deploy`/`export` (static hosts). |
| `uniweb update` | Align this project with the CLI you're running: bump `@uniweb/*` deps in every `package.json` to the CLI's matrix (then install), and refresh `AGENTS.md`. Pins to *this* CLI's matrix — run `npx uniweb@latest update` to align to the latest release. Updating the CLI itself is your package manager's job (`npm i -g uniweb@latest`). |

`--host=<adapter>` is the same option across `deploy`, `export`, and `add ci`. Built-in adapters: `github-pages`, `cloudflare-pages`, `netlify`, `vercel`, `s3-cloudfront`, and `generic-static` (an artifact shape for `export`, not a deploy target). Each adapter implements only the operations it supports, and the CLI never offers one it can't perform: `add ci` lists only hosts that can scaffold a workflow, and `deploy`'s picker lists only destinations with a working deploy hook.

For the deeper menu — standalone vs cataloged foundations, S3+CloudFront, manual exports, per-host recipes, foundation propagation — see → **[Deploying](https://github.com/uniweb/docs/blob/main/development/deploying.md)**.

---

## Keeping a Project Current

Uniweb projects pin to specific `@uniweb/*` versions in their `package.json` files and ship an `AGENTS.md` stamped with the CLI version that wrote it. As the framework releases, both can drift from what the CLI you're running expects.

Two paired verbs cover the drift:

- **`uniweb doctor`** — diagnoses only. Flags `@uniweb/*` / `uniweb` declarations that lag the running CLI, plus `AGENTS.md` staleness, plus a small set of safely auto-fixable structural issues.
- **`uniweb update`** — the mutator. Rewrites `@uniweb/*` + `uniweb` version keys in every workspace `package.json` to the CLI's bundled matrix (deps that are *ahead* are left alone — never downgraded), runs your workspace's package manager, and refreshes `AGENTS.md`. Each file's existing indentation is preserved.

```bash
npx uniweb@latest update          # canonical: pin to the latest release (no install)
npx uniweb@latest update --yes    # same, non-interactive (CI, agents, automation)
uniweb update --dry-run           # preview the plan without touching files
```

`update` aligns your project to *the CLI that's running it*. `npx uniweb@latest update` is the "pin to the newest release" path. A project-local copy (`node_modules/.bin/uniweb`) deliberately pins to your committed `uniweb` version — bump it in `package.json` and re-install, or use the npx form, to go further.

**Updating the CLI itself is separate**, and it's your package manager's job:

```bash
npm i -g uniweb@latest        # npm
pnpm add -g uniweb@latest     # pnpm
yarn global add uniweb@latest # yarn
```

`uniweb update` prints the right command for your install when a newer release exists. It will *not* update the CLI itself — running it twice was never the intent.

---

## Documentation

Full documentation is at **[uniweb.io/docs](https://uniweb.io/docs)**, written in the public [uniweb/docs](https://github.com/uniweb/docs) repository:

| Section | Topics |
| ------- | ------ |
| [Getting Started](https://github.com/uniweb/docs/tree/main/getting-started) | Introduction, quickstart, templates |
| [Authoring](https://github.com/uniweb/docs/tree/main/authoring) | Writing content, site setup, theming, collections, translations |
| [Development](https://github.com/uniweb/docs/tree/main/development) | Building foundations, component patterns, data fetching, layouts |
| [Reference](https://github.com/uniweb/docs/tree/main/reference) | Configuration files, kit API, CLI commands, deployment |

For AI agents, the documentation's index is [uniweb.io/llms.txt](https://uniweb.io/llms.txt).

### Quick Reference

| Topic              | Guide                                                               |
| ------------------ | ------------------------------------------------------------------- |
| Content Structure  | [How markdown becomes component props](https://github.com/uniweb/docs/blob/main/reference/content-structure.md) |
| Component Metadata | [The meta.js schema](https://github.com/uniweb/docs/blob/main/reference/component-metadata.md) |
| Site Configuration | [site.yml reference](https://github.com/uniweb/docs/blob/main/reference/site-configuration.md) |
| CLI Commands       | [All CLI commands and flags](https://github.com/uniweb/docs/blob/main/reference/cli-commands.md) |
| Templates          | [Built-in, official, and external templates](https://github.com/uniweb/docs/blob/main/getting-started/templates.md) |
| Deployment         | [Two artifacts, two verbs — bundled, linked, and per-host recipes](https://github.com/uniweb/docs/blob/main/development/deploying.md) |

---

## Configuration

### Site Configuration

The `defineSiteConfig()` function handles all Vite configuration for sites:

```javascript
import { defineSiteConfig } from '@uniweb/build/site'

export default defineSiteConfig({
  // All options are optional
  tailwind: true, // Enable Tailwind CSS v4 (default: true)
  plugins: [], // Additional Vite plugins
  // ...any other Vite config options
})
```

### Foundation Configuration

The `defineFoundationConfig()` function handles all Vite configuration for foundations:

```javascript
import { defineFoundationConfig } from '@uniweb/build'

export default defineFoundationConfig({
  // All options are optional - entry is auto-generated
  externals: [], // Additional packages to externalize
  includeDefaultExternals: true, // Include react, @uniweb/core, etc.
  tailwind: true, // Enable Tailwind CSS v4 Vite plugin
  sourcemap: true, // Generate sourcemaps
  plugins: [], // Additional Vite plugins
  build: {}, // Additional Vite build options
  // ...any other Vite config options
})
```

For Tailwind CSS v3 projects, set `tailwind: false` and use PostCSS:

```javascript
export default defineFoundationConfig({
  tailwind: false, // Uses PostCSS instead of Vite plugin
})
```

### Workspace Configuration

A default project has two packages, listed in both `pnpm-workspace.yaml` and `package.json`:

```yaml
# pnpm-workspace.yaml
packages:
  - src
  - site
```

In `package.json` (for npm compatibility):

```json
{
  "workspaces": ["src", "site"]
}
```

When you `add` more packages, the CLI adds the appropriate workspaces automatically:

```yaml
# After: uniweb add site marketing/blog
# After: uniweb add foundation marketing/blogger
packages:
  - src
  - site
  - marketing/blog
  - marketing/blogger
```

## FAQ

**Do I need the Uniweb app?**

No. The framework works on its own: content in markdown, built and deployed like any Vite project, to any static host. Connect the app when people who don't write code need to edit the site — or when you'd rather not build an editing interface for them.

**Is the app a CMS?**

It's where authors work: they compose pages from your section types and manage records through your schemas, with live previews. There's no admin interface or editing UI for you to build, and a site's content isn't locked in it: `uniweb clone` or `uniweb pull` brings it into a project as files in git, kept in sync both ways.

**How is this different from MDX?**

MDX blends markdown and JSX—content authors write code. Uniweb keeps them separate: content stays in markdown, components stay in React. Authors can still embed interactive components (via `![](@Component)` syntax), but they never see JSX. Component updates don't require content changes, and content changes can't break components.

**How is this different from Astro and other site frameworks?**

They build sites from code and content files, and so does Uniweb. Uniweb adds the other interface: a visual authoring app, kept in sync with your project, where your components are the authors' building blocks. The foundation model also makes components portable across sites, with any deployment — static, SSR, or platform-managed.

**Can I use an existing component library?**

Yes. Foundations are standard React. Import any library into your foundation components. The `{ content, params }` interface only applies to section types (the components authors pick from markdown) — everything else uses regular React props.

**Is this SEO-friendly?**

Yes. Content is pre-embedded in the initial HTML—no fetch waterfalls, no layout shifts. Meta tags are generated per page. SSG is supported by default.

**What about dynamic routes?**

Pages can define data sources that auto-generate subroutes. A `/blog` page can have an index and a `[slug]` template that renders each post.

**Is Uniweb good for documentation sites?**

Yes — documentation is a natural fit. Content stays in markdown (easy to version, review, and contribute to), while the foundation handles navigation, search, and rendering. [Uniweb's own docs](https://github.com/uniweb/docs) use this pattern: pure markdown in a public repo, rendered by a separate foundation.

## Related Packages

- [`@uniweb/build`](https://github.com/uniweb/build) — Foundation build tooling
- [`@uniweb/runtime`](https://github.com/uniweb/runtime) — Foundation loader and orchestrator for sites
- [`@uniweb/templates`](https://github.com/uniweb/templates) — Official project templates (content only, CLI provides structure)

## License

Apache 2.0
