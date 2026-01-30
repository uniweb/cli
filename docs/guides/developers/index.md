# Developer Guides

These guides are for developers building foundations and components with Uniweb's Component Content Architecture. They're not reference docs — they teach patterns through worked examples and honest reflection on why things work the way they do.

If you're looking for content authoring (markdown, frontmatter, site configuration), see the [content author guides](../authors/).

---

## Guides

### [Thinking in Contexts](./thinking-in-contexts.md)

How semantic theming replaces hardcoded color maps. Why you write less code and get a more portable foundation. When the rules apply — and the two cases where they don't.

---

## What's Coming

These guides will grow as we convert more foundations and discover more patterns. Future topics may include:

- **The Content Contract** — How `meta.js` declares what a component needs, and why `prepare-props` means you never write null checks
- **Component Anatomy** — What CCA components receive, what they render, and what they leave to the runtime
- **Data and Collections** — Working with fetched data, collection items, and the boundary between static and dynamic content
- **Portability in Practice** — Shipping a foundation that works across organizations with different branding, content, and locales

---

## The Philosophy

CCA separates concerns that traditional frameworks tangle together. Content authors write markdown. Site owners set brand identity in `theme.yml`. Foundation developers build components that adapt to both — without knowing what the content says or what the colors are.

The result is less code, not more abstraction. A typical component drops from 50 lines to 30 when you remove the theme maps, the null checks, and the color decisions that the system handles for you. The guides in this series show how to lean into that separation and what to do in the cases where you can't.
