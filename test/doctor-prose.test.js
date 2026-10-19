/**
 * `uniweb doctor`'s prose check — does a foundation render kit's <Prose> or <Article>?
 *
 * It matched the JSX tag only, so `import { Article as ArticleBody } from '@uniweb/kit'`
 * went unseen — and two official templates shipped that way, prose unstyled, until
 * 2026-09-29. The import counts now.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rendersKitProse, inertProseModifiers, loadsTypographyPlugin } from '../src/commands/doctor.js'

function foundationWith(source) {
  const dir = mkdtempSync(join(tmpdir(), 'uniweb-prose-'))
  mkdirSync(join(dir, 'sections', 'Post'), { recursive: true })
  writeFileSync(join(dir, 'sections', 'Post', 'index.jsx'), source)
  return dir
}

const cases = [
  ['the tag, as imported', "import { Article } from '@uniweb/kit'\nexport default () => <Article content={c} />", true],
  ['an alias — the case the tag alone missed', "import { useWebsite, Article as ArticleBody } from '@uniweb/kit'\nexport default () => <ArticleBody content={c} />", true],
  ['Prose, among other imports on several lines', "import {\n  Link,\n  Prose as Body,\n} from '@uniweb/kit'\nexport default () => <Body />", true],
  ['CONTROL — a kit name that only starts with Article', "import { ArticleCard } from '@uniweb/kit'\nexport default () => <ArticleCard />", false],
  ['CONTROL — no prose at all', "import { Link } from '@uniweb/kit'\nexport default () => <Link to=\"/\">Home</Link>", false],
]

for (const [name, source, expected] of cases) {
  test(`rendersKitProse — ${name}`, () => {
    const dir = foundationWith(source)
    try {
      assert.equal(rendersKitProse(dir), expected)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
}

// A modifier kit's prose layer does not have — Tailwind Typography's palettes and `prose-invert`,
// inert since kit's own layer replaced the plugin (2026-10-19).
const modifierCases = [
  ['a palette in a class list', "export default () => <div className='prose prose-slate max-w-none'>x</div>", ['prose-slate']],
  ['invert behind a variant', 'export default () => <div className="prose dark:prose-invert lg:prose-base">x</div>', ['prose-invert']],
  ['a color theme', 'export default () => <article className={cn("prose", "prose-blue")} />', ['prose-blue']],
  ['marked important, before or after', 'export default () => <div className="prose !prose-invert prose-slate!">x</div>', ['prose-invert', 'prose-slate']],
  ['CONTROL — a comment warning against one', '// no palette modifier (`prose-gray` and friends) here\nexport default () => <div className="prose">x</div>', []],
  ['CONTROL — the steps and the variants, which the layer has', 'export default () => <div className="prose prose-lg prose-headings:font-display prose-a:text-link">x</div>', []],
]

for (const [name, source, expected] of modifierCases) {
  test(`inertProseModifiers — ${name}`, () => {
    const dir = foundationWith(source)
    try {
      const found = inertProseModifiers(dir)
      assert.deepEqual(found.flatMap((f) => f.modifiers), expected)
      if (expected.length) assert.equal(found[0].file, join('sections', 'Post', 'index.jsx'))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
}

test('loadsTypographyPlugin — either quote, and not kit’s own import', () => {
  assert.equal(loadsTypographyPlugin(`@import "tailwindcss";\n@plugin "@tailwindcss/typography";`), true)
  assert.equal(loadsTypographyPlugin(`@plugin '@tailwindcss/typography';`), true)
  assert.equal(loadsTypographyPlugin(`@import "@uniweb/kit/prose-tokens.css";`), false)
})

test('loadsTypographyPlugin — a line commented out loads nothing', () => {
  assert.equal(loadsTypographyPlugin(`@import "tailwindcss";\n/* @plugin "@tailwindcss/typography"; */`), false)
  assert.equal(loadsTypographyPlugin(`/*\n  removed 2026-10-19:\n  @plugin "@tailwindcss/typography";\n*/`), false)
  // CONTROL — the line itself, after a comment
  assert.equal(loadsTypographyPlugin(`/* typography */\n@plugin "@tailwindcss/typography";`), true)
})
