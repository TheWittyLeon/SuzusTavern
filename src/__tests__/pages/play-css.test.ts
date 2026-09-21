/**
 * CSS-source regression tests for src/app/play/[sessionId]/Play.module.css.
 *
 * Follows the raw-text-assertion pattern established by
 * src/__tests__/globals-css.test.ts / codex-css.test.ts / dashboard-css.test.ts
 * — CSS Modules are identity-mocked under Jest and jsdom computes no real
 * layout, so neither `.grid`'s actual area assignment at a given viewport
 * nor a button's actual rendered box height is observable from an RTL test.
 *
 * TAV-PLAY-SHELL step 0 (plan §5 "Accessibility invariants currently
 * encoded only in comments"): pins A3 and A11 BEFORE step 2 touches
 * anything, per the step-0 job brief.
 */
import fs from 'fs';
import path from 'path';

describe('Play.module.css', () => {
  let css: string;

  beforeAll(() => {
    css = fs.readFileSync(
      path.resolve(process.cwd(), 'src/app/play/[sessionId]/Play.module.css'),
      'utf8',
    );
  });

  /** Every `grid-template-areas: ...;` VALUE in the file, base rule and every @media override alike. */
  function allGridTemplateAreaValues(): string[] {
    const out: string[] = [];
    const re = /grid-template-areas:\s*([^;]+);/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(css))) out.push(m[1]);
    return out;
  }

  /** The full text of a `selector { ... }` block (brace-depth matched, so it
   *  is safe for an @media block whose body contains further nested rules). */
  function blockFrom(headerNeedle: string): string {
    const start = css.indexOf(headerNeedle);
    if (start === -1) throw new Error(`CSS fixture drifted: "${headerNeedle}" not found in Play.module.css`);
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

  describe('A3 — the X-card banner lives in a grid area every layout shows', () => {
    it('.grid declares grid-template-areas at least twice (base + the ≤880px mobile override) and every one includes a "banner" row', () => {
      const values = allGridTemplateAreaValues();
      expect(values.length).toBeGreaterThanOrEqual(2);
      for (const v of values) expect(v).toMatch(/banner/);
    });

    it('.xCardBanner is placed in that area and collapses via :empty, never display:none/visibility:hidden', () => {
      const banner = blockFrom('.xCardBanner {');
      expect(banner).toMatch(/grid-area:\s*banner/);
      const bannerEmpty = blockFrom('.xCardBanner:empty {');
      expect(bannerEmpty).not.toMatch(/display:\s*none/);
      expect(bannerEmpty).not.toMatch(/visibility:\s*hidden/);
    });
  });

  describe('A11 — mobile tab-bar touch targets stay ≥44px; the 400px tightening shrinks padding only', () => {
    it('the ≤880px .mobileTabs button rule sets min-height: 44px', () => {
      const mobileBlock = blockFrom('@media (max-width: 880px) {');
      const idx = mobileBlock.indexOf('.mobileTabs button {');
      expect(idx).toBeGreaterThan(-1);
      const buttonRule = mobileBlock.slice(idx, mobileBlock.indexOf('}', idx) + 1);
      expect(buttonRule).toMatch(/min-height:\s*44px/);
    });

    it('the ≤400px override touches padding/gap only — no min-height (touch target) shrink', () => {
      const narrowBlock = blockFrom('@media (max-width: 400px) {');
      expect(narrowBlock).not.toMatch(/min-height/);
      expect(narrowBlock).toMatch(/padding/);
    });

    it('.mobileTabs keeps overflow-x: auto as the clipping safety net (Iro CRITICAL-2)', () => {
      const mobileBlock = blockFrom('@media (max-width: 880px) {');
      const idx = mobileBlock.indexOf('.mobileTabs {');
      const rule = mobileBlock.slice(idx, mobileBlock.indexOf('}', idx) + 1);
      expect(rule).toMatch(/overflow-x:\s*auto/);
    });
  });
});
