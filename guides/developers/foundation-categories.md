# Foundation Categories

Every Uniweb foundation is a Vite library project that builds to `foundation.js`. But foundations vary in how much they know about the site they serve. A foundation that hardcodes an API endpoint and a color palette works fine — for one site. A foundation that delegates those decisions to the site works everywhere.

This isn't a quality distinction. It's a trade-off between simplicity and reusability, and the right answer depends on what you're building.

---

## The Spectrum

Foundation portability isn't binary. It's a sliding scale with two clear endpoints and a lot of reasonable middle ground.

**Bundled** — The foundation and site are effectively one unit. Components fetch their own data, hardcode their colors, and assume a specific deployment. Standard React patterns. Nothing new to learn.

**Portable** — The foundation doesn't know which site it serves. Data sources come from `page.yml`. Colors come from `theme.yml`. The same foundation can serve multiple sites with different content, branding, and APIs.

Most foundations land somewhere in between. A foundation might use CCA's semantic theming (portable colors) but fetch data directly from a known API (bundled data). That's fine — you pick up each convention when the trade-off makes sense for you.

---

## What Changes Along the Scale

### Data

| Bundled | Portable |
|---------|----------|
| Component calls `fetch()` in a `useEffect` | Site declares data sources in `page.yml` |
| Component manages loading state, errors, caching | Runtime handles fetch, cache, loading state |
| Component knows the API endpoint | Component reads `content.data`, doesn't know where it came from |
| Works with one backend | Works with any backend the site configures |

The portable approach is genuinely less code per component — no `useEffect`, no `useState` for loading, no cache logic. The runtime handles all of that. The trade-off is learning how fetch configs, auto-wiring, and `data.entity` work. See [Working with Data](./working-with-data.md) for the full picture.

### Theming

| Bundled | Portable |
|---------|----------|
| Component uses Tailwind color classes directly (`bg-blue-600`) | Component uses semantic CSS tokens (`var(--bg)`, `var(--heading)`) |
| Theme changes mean editing component code | Site changes `theme.yml`, components adapt |
| One look per foundation | Same foundation, different look per site |

Semantic theming removes code — no theme maps, no conditional class names, no `themes.light.title` objects. Each component just uses tokens, and the site controls what those tokens resolve to. See [Thinking in Contexts](./thinking-in-contexts.md).

### Configuration

| Bundled | Portable |
|---------|----------|
| Component reads env vars or imported config | Component reads `params` from meta.js |
| Options are code-level (developer changes a constant) | Options are content-level (author picks from a dropdown) |
| Changing behavior requires a code deploy | Changing behavior requires editing frontmatter |

Params force a cleaner interface — you ask "what actually varies?" and expose only that. The constraint produces tighter components, the same way writing testable code produces more modular code. The author-facing dropdown is a consequence, not the goal.

---

## When Each Makes Sense

### Bundled is the right choice when:

- You're building a personal site or a single-purpose project
- The foundation and site will always be the same team, same repo, same deploy
- You already have React components you want to use as-is
- You're prototyping and don't want to learn new conventions yet

A portfolio site, a startup landing page, a weekend project — bundled is fine. You get Uniweb's file-based routing, content parsing, and static generation without adopting the full CCA data/theming layer.

### Portable is the right choice when:

- The foundation might serve more than one site
- You want content authors to change data sources or theming without code changes
- You're building a component library that others will use
- You want the runtime to handle data fetching and caching for you

A design system, a multi-brand marketing site, an agency template — portable pays for itself quickly. The upfront learning (fetch configs, semantic tokens, meta.js) removes ongoing work (loading states, theme maps, cache invalidation).

### The middle is the right choice most of the time:

- Use semantic theming (it's less code even for one site)
- Use CCA data fetching for external APIs (the caching alone is worth it)
- Hardcode things that genuinely won't change (a company logo path, a fixed navigation structure)
- Move things to the site layer when you find yourself editing the foundation for content reasons

You don't have to commit upfront. Start bundled, move things to the site layer when the repetition bothers you. The architecture supports gradual migration.

---

## What You Give Up, What You Get

| Moving toward portable | What you give up | What you get |
|------------------------|------------------|-------------|
| Semantic theming | Direct color control in components | Components that adapt to any brand. No theme maps. Less code. |
| CCA data layer | `useEffect` + `fetch()` in components | Automatic caching, deduplication, loading states. No data-fetching code. |
| Params via meta.js | Hardcoded config or env vars | Constrained, tested interface. Content authors can configure without code. |
| Content from markdown | Text in JSX | Content changes without deploys. i18n support for free. |

Every row is optional. You can use semantic theming without the data layer, or the data layer without params. They compose independently.

---

## A Note About the Guides

The developer guides in this series focus primarily on portable patterns — semantic theming, CCA data fetching, meta.js params — because those are the conventions that need explaining. Standard React patterns don't need a Uniweb guide.

To see these patterns in practice, the [Template Tour](./template-tour.md) maps each official template to its position on the spectrum — what conventions it adopts, what it keeps bundled, and why.

When a guide describes a CCA convention (like declaring data sources in `page.yml` instead of calling `fetch()` directly), it's describing the portable approach. If your foundation is bundled or partially bundled, the standard React way still works. The runtime doesn't enforce portability — it enables it.

---

## See Also

- [Building with Uniweb](./building-with-uniweb.md) — What a Uniweb project looks like, start to finish
- [Working with Data](./working-with-data.md) — The portable data layer: fetch configs, auto-wiring, detail queries
- [Thinking in Contexts](./thinking-in-contexts.md) — Semantic theming and how components adapt to any brand
- [Converting Existing Designs](./converting-existing-designs.md) — Bringing existing React components into a foundation (the gradual migration from bundled to portable)
- [Template Tour](./template-tour.md) — What each official template demonstrates and where it sits on the portability spectrum
