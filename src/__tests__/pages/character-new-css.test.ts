/**
 * CSS-source regression tests for src/app/character/new/CharacterCreate.module.css.
 *
 * Follows the raw-text-assertion pattern established by
 * src/__tests__/pages/codex-css.test.ts — CSS Modules are identity-mocked
 * under Jest and jsdom does not compute real layout/cascade, so neither the
 * rail's actual `position` at a given viewport width nor whether it visually
 * overlaps scrolled content is observable from a component test. This reads
 * the raw stylesheet text instead.
 *
 * Iro-A11y live-pass CRITICAL-1 (2026-09-07, dev Tavern @ 375×812/640px,
 * 100% zoom): `.rail { position: sticky; top: 16px }` is correct at 2/3-
 * column widths, where the rail sits BESIDE scrolling step content — but the
 * `@media (max-width: 720px)` block collapses `.layout` to a single column
 * (the rail becomes the first STACKED block above `.main`, not a sidebar),
 * and sticky pinned it over scrolled step content there.
 *
 * FIRST ATTEMPT (WRONG — caught by Iro's live RE-CHECK, not this suite):
 * added `.rail { position: static; }` inside the `@media (max-width: 720px)`
 * block, which sits EARLIER in the file than the unconditional base `.rail`
 * rule. CSS cascade order — not media-query nesting — decides the winner
 * between two equal-specificity `.rail` rules: the unconditional base rule,
 * declared LATER in the compiled stylesheet, still won at every width, so
 * computed `position` stayed "sticky" at 375/640px live. The original test
 * only asserted the override's TEXT was present somewhere in the file, never
 * its position relative to the rule it was supposed to override — which is
 * exactly why it passed on the broken fix.
 *
 * ACTUAL FIX: guard the STICKY declaration itself with its own min-width
 * media query (`@media (min-width: 721px)`) instead of trying to reset it
 * from a max-width query. This makes the two conditions (`max-width: 720px`
 * / `min-width: 721px`) mutually exclusive, so file ORDER can never decide
 * the winner — below 721px, `.rail`'s `position` is simply never set
 * anywhere (initial value: static). This suite asserts that structure
 * directly: every `.rail` rule that sets `position: sticky` must be nested
 * inside a `(min-width: …)` media query, and the ≤720px `.rail` rule must
 * never set `position: sticky` at all.
 */
import fs from 'fs';
import path from 'path';

interface CssBlock {
  /** The selector or at-rule text immediately before this block's `{`. */
  selector: string;
  /** Raw text between this block's own `{` and `}` (not recursed into). */
  body: string;
  /** Enclosing selectors/at-rules, outermost first — e.g. a `.rail` block
   *  nested in `@media (min-width: 721px)` has `parents: ['@media (min-width: 721px)']`. */
  parents: string[];
}

/**
 * Generic brace-depth CSS block parser — deliberately NOT regex-based (a
 * regex can't track nesting, which is the entire point here: the bug this
 * suite guards against is a nesting/ordering mistake regex-only assertions
 * missed the first time). Assumes no literal `{`/`}` inside comments or
 * strings, true of this stylesheet.
 */
function parseBlocks(css: string): CssBlock[] {
  const blocks: CssBlock[] = [];
  const stack: { selector: string; bodyStart: number; parents: string[] }[] = [];
  let lastEnd = 0;
  for (let i = 0; i < css.length; i += 1) {
    if (css[i] === '{') {
      const selector = css.slice(lastEnd, i).trim();
      const parents = stack.map((frame) => frame.selector);
      stack.push({ selector, bodyStart: i + 1, parents });
      lastEnd = i + 1;
    } else if (css[i] === '}') {
      const frame = stack.pop();
      if (frame) {
        blocks.push({ selector: frame.selector, body: css.slice(frame.bodyStart, i), parents: frame.parents });
      }
      lastEnd = i + 1;
    }
  }
  return blocks;
}

describe('CharacterCreate.module.css — .rail position guarding (Iro-A11y live-pass CRITICAL-1, re-fixed)', () => {
  let blocks: CssBlock[];

  beforeAll(() => {
    const cssContent = fs.readFileSync(
      path.resolve(process.cwd(), 'src/app/character/new/CharacterCreate.module.css'),
      'utf8',
    );
    // Strip comments FIRST — a selector slice that captures a preceding
    // `/* ... */` block (this file has long ones) would fail a
    // `.startsWith('@media')` check even though the actual rule right
    // after the comment genuinely is an @media block.
    const withoutComments = cssContent.replace(/\/\*[\s\S]*?\*\//g, '');
    blocks = parseBlocks(withoutComments);
  });

  function railBlocks(): CssBlock[] {
    const rails = blocks.filter((b) => b.selector === '.rail');
    expect(rails.length).toBeGreaterThan(0);
    return rails;
  }

  it('every .rail rule setting position:sticky is nested inside a min-width media query — never unconditional, never inside a max-width query', () => {
    const stickyBlocks = railBlocks().filter((b) => /position:\s*sticky/.test(b.body));
    // Sanity: the sticky behavior must still exist SOMEWHERE (this suite
    // guards its placement, not its existence).
    expect(stickyBlocks.length).toBeGreaterThan(0);
    for (const block of stickyBlocks) {
      const enclosingMedia = block.parents.find((p) => p.startsWith('@media'));
      expect(enclosingMedia).toBeDefined();
      expect(enclosingMedia).toMatch(/min-width/);
      expect(enclosingMedia).not.toMatch(/max-width/);
    }
  });

  it('the min-width guard (721px) and the narrow-layout breakpoint (max-width: 720px) are complementary — no gap, no overlap, so file order can never decide the winner', () => {
    const stickyBlocks = railBlocks().filter((b) => /position:\s*sticky/.test(b.body));
    for (const block of stickyBlocks) {
      const media = block.parents.find((p) => p.startsWith('@media'))!;
      const match = media.match(/min-width:\s*(\d+)px/);
      expect(match).not.toBeNull();
      expect(Number(match![1])).toBe(721);
    }
  });

  it('the ≤720px .rail rule never sets position:sticky (regression guard — this is the exact bug the first attempt reintroduced)', () => {
    const narrowRail = railBlocks().find((b) =>
      b.parents.some((p) => p.startsWith('@media') && p.includes('max-width: 720px')),
    );
    expect(narrowRail).toBeDefined();
    expect(narrowRail!.body).not.toMatch(/position:\s*sticky/);
  });

  it('the ≤720px .rail rule still reorders the rail above .main (unrelated to position, unaffected by the fix)', () => {
    const narrowRail = railBlocks().find((b) =>
      b.parents.some((p) => p.startsWith('@media') && p.includes('max-width: 720px')),
    );
    expect(narrowRail!.body).toMatch(/order:\s*1;/);
  });

  it('no OTHER .rail rule (e.g. the 1080px breakpoint) sets position at all', () => {
    const otherRailBlocks = railBlocks().filter(
      (b) =>
        !b.parents.some(
          (p) => p.startsWith('@media') && (p.includes('max-width: 720px') || p.includes('min-width: 721px')),
        ),
    );
    for (const block of otherRailBlocks) {
      expect(block.body).not.toMatch(/position:/);
    }
  });
});
