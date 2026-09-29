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
import { rendersKitProse } from '../src/commands/doctor.js'

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
