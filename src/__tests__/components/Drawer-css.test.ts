/**
 * CSS-source regression tests for src/components/Drawer.module.css.
 *
 * Same raw-text-assertion pattern as globals-css.test.ts / codex-css.test.ts
 * / play-css.test.ts — CSS Modules are identity-mocked under Jest and jsdom
 * computes no real cascade, so the C1 defect (2026-09-21 review round:
 * `.drawerMobileFallback`'s `transform: translateX(100%)`, declared inside
 * `@media (min-width: 881px)`, outranked the unconditional `.drawerOpen`
 * reset by SOURCE ORDER at equal specificity — the Journal drawer was
 * permanently off-screen at desktop widths) was invisible to every jest
 * test that existed at the time. Real-browser evidence for the fix itself
 * lives in this session's report (Chromium, computed `transform`, both
 * viewports, pre-fix reproduced / post-fix resolved); these tests are the
 * jsdom-visible, CI-durable half: they pin the TEXT shape the fix depends
 * on, so a future edit that separates the pieces again fails a fast test
 * instead of shipping invisibly.
 *
 * What this file CANNOT see (Kage-CR round-2 re-review, 2026-09-21): it is
 * a text-shape guard, not a cascade evaluator. It checks that the reset is
 * the COMPOUND selector `.drawerMobileFallback.drawerOpen`, but it cannot
 * tell that a DIFFERENT rule with the SAME specificity would re-break C1 —
 * e.g. `.drawerMobileFallback.journalPane { transform: translateX(100%) }`
 * is also (0,2,0) and, added after the fix, puts the drawer back off-screen
 * at x=1440 in a real browser while every assertion here stays green
 * (Kage measured this). The real defence against a same-specificity
 * re-break is the real-browser capture (I6), not this file — this file
 * only catches the narrower, already-observed shape (the reset missing or
 * reverting to a non-compound selector).
 */
import fs from 'fs';
import path from 'path';

describe('Drawer.module.css', () => {
  let css: string;

  beforeAll(() => {
    css = fs.readFileSync(
      path.resolve(process.cwd(), 'src/components/Drawer.module.css'),
      'utf8',
    );
  });

  /** The full text of a `selector { ... }` block (brace-depth matched, so
   *  it's safe for an @media block whose body has further nested rules). */
  function blockFrom(headerNeedle: string): string {
    const start = css.indexOf(headerNeedle);
    if (start === -1) throw new Error(`CSS fixture drifted: "${headerNeedle}" not found in Drawer.module.css`);
    const braceStart = css.indexOf('{', start);
    let depth = 0;
    for (let i = braceStart; i < css.length; i++) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}') {
        depth--;
        if (depth === 0) return css.slice(start, i + 1);
      }
    }
    throw new Error(`unbalanced braces reading "${headerNeedle}"`);
  }

  /** Every `property: value;` pair inside a block, as a sorted array —
   *  order-independent so declaration reordering isn't a false positive. */
  function declarations(block: string): string[] {
    const body = block.slice(block.indexOf('{') + 1, block.lastIndexOf('}'));
    return body
      .split(';')
      .map((d) => d.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .sort();
  }

  describe('C1 regression — every closed-state transform has a reachable open-state reset in the same cascade scope', () => {
    it('.drawer (unconditional) pairs with .drawerOpen (unconditional, equal specificity, later source order — valid because nothing else contests it)', () => {
      const drawerBlock = blockFrom('.drawer {');
      expect(drawerBlock).toMatch(/transform:\s*translateX\(100%\)/);
      const openBlock = blockFrom('.drawerOpen {');
      expect(openBlock).toMatch(/transform:\s*none/);
      // .drawerOpen must appear AFTER .drawer for source order to work at
      // equal (0,1,0) specificity.
      expect(css.indexOf('.drawerOpen {')).toBeGreaterThan(css.indexOf('.drawer {'));
    });

    it('.drawerMobileFallback (media-gated) pairs with a compound .drawerMobileFallback.drawerOpen reset in the SAME media block — a bare .drawerOpen would tie on specificity and lose on source order, which is exactly what C1 was', () => {
      const mediaBlock = blockFrom('@media (min-width: 881px) {');
      expect(mediaBlock).toMatch(/\.drawerMobileFallback\s*\{[^}]*transform:\s*translateX\(100%\)/);
      // The reset must be the COMPOUND selector, inside this same block —
      // not a bare `.drawerOpen` (which is what broke) and not outside it.
      expect(mediaBlock).toMatch(/\.drawerMobileFallback\.drawerOpen\s*\{\s*transform:\s*none;?\s*\}/);
    });
  });

  describe('mobileTabFallback duplication stays declaration-identical (commit message\'s own claim, now enforced rather than asserted in prose)', () => {
    it('.drawer and .drawerMobileFallback share the exact same geometry declarations', () => {
      expect(declarations(blockFrom('.drawerMobileFallback {'))).toEqual(
        declarations(blockFrom('.drawer {')),
      );
    });

    it('.scrim and .scrimMobileFallback share the exact same declarations', () => {
      expect(declarations(blockFrom('.scrimMobileFallback {'))).toEqual(
        declarations(blockFrom('.scrim {')),
      );
    });
  });
});
