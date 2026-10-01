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
 *
 * TAV-PLAY-SHELL step 6b, commit C4 (build brief §6.3, §7 C4): A3 and
 * A11's own CSS shape changed as a DIRECT, prescribed consequence of this
 * commit's own instructions, rewritten here in the SAME commit (a third
 * pin-edit alongside the build brief's two named exceptions — C1's
 * mechanical rename and C4's own TopBar/I4 pins — flagged for review,
 * not snuck in):
 *   - A3: `.grid`'s `grid-template-areas` is now `var(--play-areas)` — a
 *     single data-driven declaration, not a hand-maintained literal
 *     repeated per breakpoint. The underlying invariant ("the safety
 *     banner has a mount point on every layout") still holds, pinned at
 *     the DATA layer instead: `safetyBanner` is placed (non-null area) in
 *     every row × moment by `play-preset-registry.test.ts`'s full-row pin
 *     and its own 🟡-3 literal `areas` pins.
 *   - A11: `.mobileTabs` is shell chrome pending A9d (this file's own
 *     `debt:` marker) — permanently `display:none` now (its own
 *     UNCHANGED base rule, no media-query override re-enables it below
 *     880px any more), so there is no visible mobile tab bar for a
 *     44px-touch-target / overflow-x:auto safety-net rule to apply to.
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

  /** Every `grid-template-areas: ...;` VALUE in the file, base rule and every
   *  @media override alike. Comments stripped first (C4: this file's own
   *  header comment now literally contains the string "grid-template-areas:"
   *  as prose, which the un-stripped regex would otherwise also match). */
  function allGridTemplateAreaValues(): string[] {
    const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const out: string[] = [];
    const re = /grid-template-areas:\s*([^;]+);/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(stripped))) out.push(m[1]);
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

  describe('A3 — the X-card banner lives in a grid area every layout shows (C4: data-driven)', () => {
    it('.grid declares exactly one grid-template-areas, sourced from --play-areas (PlayShell sets it per row × moment)', () => {
      const values = allGridTemplateAreaValues();
      expect(values).toEqual(['var(--play-areas)']);
    });

    it('.xCardBanner is placed in that area and collapses via :empty, never display:none/visibility:hidden', () => {
      const banner = blockFrom('.xCardBanner {');
      expect(banner).toMatch(/grid-area:\s*banner/);
      const bannerEmpty = blockFrom('.xCardBanner:empty {');
      expect(bannerEmpty).not.toMatch(/display:\s*none/);
      expect(bannerEmpty).not.toMatch(/visibility:\s*hidden/);
    });
  });

  describe('A11 — the mobile tab bar is shell chrome, hidden pending A9d (C4 rewrite — see this file\'s own header)', () => {
    it('.mobileTabs has no @media (max-width: 880px) override re-enabling it — its own base rule stays display:none at every width', () => {
      const mobileBlock = blockFrom('@media (max-width: 880px) {');
      expect(mobileBlock).not.toMatch(/\.mobileTabs\s*\{/);
      const baseRule = blockFrom('.mobileTabs {');
      expect(baseRule).toMatch(/display:\s*none/);
    });

    it('carries the debt: marker for the hidden-but-mounted state, with a trigger', () => {
      expect(css).toMatch(/debt:[^\n]*mobile tab bar/);
      expect(css).toMatch(/until:[^\n]*A9d/);
    });
  });
});
