# Developer Guides

These guides are for developers building foundations and components with Uniweb's Component Content Architecture. They're not reference docs — they teach patterns through worked examples and honest reflection on why things work the way they do.

If you're looking for content authoring (markdown, frontmatter, site configuration), see the [content author guides](../authors/).

---

## Guides

### [Building with Uniweb](./building-with-uniweb.md)

What a Uniweb project looks like and why almost everything in it is standard React and Vite. The project structure defines the architecture — `sections/` is the component catalog, `pages/` is the routing table, and markdown frontmatter connects them. Start here if you're new to the framework.

### [Thinking in Contexts](./thinking-in-contexts.md)

How semantic theming replaces hardcoded color maps. Why you write less code and get a more portable foundation. When the rules apply — and the two cases where they don't.

### [Converting Existing Designs](./converting-existing-designs.md)

You have an AI-generated landing page or an existing React project. How to bring it into a Uniweb project gradually — from "paste and route" to full content separation and semantic theming. Four natural stopping points, each independently useful.

### [CCA Component Patterns](./component-patterns.md)

How to organize a foundation's `src/` directory — `sections/` for content interfaces, `components/` for your React code (shadcn-compatible), `hooks/` for hooks. Plus the patterns that emerge from CCA's content/component separation: the Dispatcher, Building Blocks, Multi-Source Rendering, and the constraints that produce tighter components.

### [Custom Layouts](./custom-layouts.md)

How to build a Layout component that controls page structure — sticky headers, sidebars, mobile drawers, responsive panels. When you need one, what the runtime gives you, and why Layout components are responsible for semantic HTML wrappers.

---

## What's Coming

These guides will grow as we convert more foundations and discover more patterns. Future topics may include:

- **The Content Contract** — How `meta.js` declares what a component needs, and why `prepare-props` means you never write null checks
- **Data and Collections** — Working with fetched data, collection items, and the boundary between static and dynamic content
- **Portability in Practice** — Shipping a foundation that works across organizations with different branding, content, and locales

---

## The Philosophy

Less code, not more abstraction. A typical CCA component drops from ~50 lines to ~30 when you remove the theme maps, the null checks, and the color decisions that the system handles for you. The separation of content, theming, and code isn't overhead — it eliminates work that traditional components duplicate.

CCA separates concerns that most frameworks tangle together. Content lives in markdown. Brand identity lives in `theme.yml`. Components adapt to both — without knowing what the content says or what the colors are. The result is components that are shorter, more portable, and more reusable. The guides in this series show how to lean into that separation and what to do in the cases where you can't.
