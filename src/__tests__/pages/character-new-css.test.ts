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
 * Iro-A11y live-pass CRITICAL-1 (2026-09-07, dev Tavern @ 375×812, 100% zoom,
 * screenshots in the scratchpad `iro-live-wizard/zoom/`): `.rail { position:
 * sticky; top: 16px }` (the base rule) is correct at 2/3-column widths, where
 * the rail sits BESIDE scrolling step content — but the `@media (max-width:
 * 720px)` block collapses `.layout` to a single column (the rail becomes the
 * first STACKED block above `.main`, not a sidebar), and never reset
 * `.rail`'s position there. Sticky pinned the rail over scrolled step content
 * at every narrow width the new Subclass/Rung steps are exercised at. Fixed
 * with a one-line `.rail { position: static; }` inside that media block.
 */
import fs from 'fs';
import path from 'path';

describe('CharacterCreate.module.css — .rail position (Iro-A11y live-pass CRITICAL-1)', () => {
  let cssContent: string;

  beforeAll(() => {
    cssContent = fs.readFileSync(
      path.resolve(process.cwd(), 'src/app/character/new/CharacterCreate.module.css'),
      'utf8',
    );
  });

  /** The base (unconditional) `.rail { ... }` rule block, as raw text. */
  function baseRailBlock(): string {
    const start = cssContent.indexOf('.rail {');
    expect(start).toBeGreaterThan(-1);
    const end = cssContent.indexOf('\n}', start);
    return cssContent.slice(start, end);
  }

  /** The `@media (max-width: 720px) { ... }` block, as raw text — the ONE
   *  breakpoint where `.layout` collapses to a single column. */
  function narrowMediaBlock(): string {
    const start = cssContent.indexOf('@media (max-width: 720px)');
    expect(start).toBeGreaterThan(-1);
    // Balanced-brace scan: the block's own nested rules each open/close a
    // brace too, so a naive indexOf('\n}') would stop at the FIRST nested
    // rule's closing brace, not the media block's own.
    let depth = 0;
    let i = cssContent.indexOf('{', start);
    const blockStart = i;
    for (; i < cssContent.length; i += 1) {
      if (cssContent[i] === '{') depth += 1;
      else if (cssContent[i] === '}') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    return cssContent.slice(blockStart, i + 1);
  }

  it('the base .rail rule is sticky — correct at 2/3-column widths', () => {
    const railBlock = baseRailBlock();
    expect(railBlock).toContain('position: sticky');
  });

  it('the ≤720px single-column media block resets .rail to a non-sticky position', () => {
    const narrow = narrowMediaBlock();
    // The collapsed one-column layout stacks .rail above .main (order: 1/2)
    // — sticky there pins the rail over scrolled step content, which is
    // exactly the live-pass CRITICAL-1 finding. Accepts static OR relative
    // (either un-pins it); the fix landed as static.
    const railInMedia = narrow.slice(narrow.indexOf('.rail {'), narrow.indexOf('.main {'));
    expect(railInMedia).toMatch(/position:\s*(static|relative);/);
  });

  it('the ≥721px layout is untouched — sticky still applies outside the ≤720px block', () => {
    // Regression guard for the fix: the reset must live ONLY inside the
    // ≤720px block, never leak into the base rule or the 1080px breakpoint
    // (which keeps the 2-column layout, where sticky is still correct).
    const start1080 = cssContent.indexOf('@media (max-width: 1080px)');
    const end1080 = cssContent.indexOf('@media (max-width: 720px)');
    const block1080 = cssContent.slice(start1080, end1080);
    expect(block1080).not.toMatch(/\.rail\s*\{[^}]*position:\s*(static|relative)/);
  });
});
