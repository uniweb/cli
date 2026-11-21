# Migrating from another framework

On-demand guide (`uniweb guide migrate`); AGENTS.md is assumed read. Full guide: `development/converting-existing.md`.

Don't port line-by-line. Study the source, then rebuild from first principles. Other frameworks produce far more components than Uniweb needs — expect consolidation, not 1:1 correspondence. A React site with 30+ components typically maps to 8–15 section types.

| React / conventional | Uniweb equivalent |
|---|---|
| Props with typed data | frontmatter params + `meta.js` |
| Component variants via props | `variant` param; Front Desk pattern for complex routing |
| Context / ThemeProvider | `theme:` frontmatter + semantic tokens |
| Wrapper / layout components | section nesting or custom layouts |
| Prop-drilling visuals into containers | insets — `![](@Component)` rendered via `<Visual>` |
| Content in JSX or `.js` data files | markdown → parser → `content` |
| CSS color tokens / design systems | `theme.yml` → palette shades + semantic tokens |
| `isDark ? … : …` | `text-heading` — context classes handle it |
| Per-component backgrounds | `background:` in frontmatter |
| Multiple near-identical components | one section type + `variant` param, or Front Desk |
| i18n wrapping (`t()`, `<Trans>`) | `locales/` beside `pages/` |

**Approach:** scaffold with `--template none` → named layouts for different page groups → dump legacy components under `components/` (not section types; import them from section types during transition) → create section types one at a time.

**A finished prototype** — React made before anyone chose Uniweb, often by another agent — gives each section as one piece: its subject, its words, its picture and its arrangement. Don't carry those pieces over as variants. The arrangements two sections share become a section type and its options; the words become content; a picture drawn in code becomes an inset the author places in a media slot (`uniweb guide foundation` § The Front Desk pattern). Then check twice: against the prototype, for the look, and with a swap, for authors: give a section an unrelated heading and picture, switch each option, and see every field keep its meaning.

**Incremental, not a rewrite.** Level **0** — paste the original as one section type; routing and dev tooling work immediately. Level **1** — decompose into section types, consolidating duplicates via `variant` params or Front Desk. Level **2** — move content from JSX to markdown so authors can edit without code. Level **3** — replace hardcoded colors with semantic tokens so components work in any context. Each level is shippable; stopping at 1 is legitimate.

**The most common mistake** is recreating source colors as CSS custom properties — that bypasses the token system. Primary color → `colors.primary`; neutral tone → `colors.neutral`; context needs → `theme:` frontmatter. Map a source design's subtle surface variations (`--surface-base` vs `--surface-sunken`) to `background:` or token overrides in frontmatter, not to component code.

Name by purpose, not content, a section type and each of its options alike (`TheModel` → `SplitContent`, `WorkModes` → `FeatureColumns`, `variant: entity-model` → `layout: media-right`); UI helpers (buttons, badges, cards) go in `components/` with no `meta.js`. The four styles a ported design brings that break something — global smooth scroll, `filter: blur()` glows, `-webkit-font-smoothing` on `html`, JS entrance animations — are in the theme guide.
