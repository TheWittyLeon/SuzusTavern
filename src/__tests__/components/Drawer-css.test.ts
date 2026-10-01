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
 * a text-shape guard, not a cascade evaluator. It checks the open reset's
 * shape, but it cannot tell that a DIFFERENT rule with the SAME specificity
 * would re-break C1 (a later `.x.y { transform: translateX(100%) }` at
 * equal specificity puts the drawer back off-screen in a real browser
 * while every assertion here stays green; Kage measured this with the
 * compound `.drawerMobileFallback` selector A9d E4 deleted). The real defence against a same-specificity
 * re-break is the real-browser capture (I6), not this file — this file
 * only catches the narrower, already-observed shape (the reset missing or
 * reverting to a non-compound selector).
 *
 * A9d E4: the media-gated `.drawerMobileFallback` pair is deleted (one
 * presentation at every width), so C1's precondition no longer exists; the
 * last case below pins that absence instead of the compound-selector shape.
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

    it('there is NO width @media in the file: one presentation at every width, so no media-gated transform exists to out-rank the reset (the C1 defect needed a second, media-gated rule at equal specificity)', () => {
      const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');
      expect(bare).not.toMatch(/@media\s*\(\s*(?:min|max)-width/);
      expect(bare).not.toMatch(/mobileFallback/);
    });
  });

  describe('A9d-2 (Tora A9d-1 MAJOR-2) — scroll containment', () => {
    const strip = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '');

    it('the drawer contains its own overscroll, so reaching its end never scrolls the page behind it', () => {
      expect(strip(blockFrom('.drawer {'))).toMatch(/overscroll-behavior:\s*contain/);
    });

    it('the scrim starts no touch pan: touch-action none (a tap still fires onClick)', () => {
      expect(strip(blockFrom('.scrim {'))).toMatch(/touch-action:\s*none/);
    });
  });
});
