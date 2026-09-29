/**
 * contrast.test.ts — D1 CR#1, coordinator decision 5 ("compute every pair
 * across all 5 palettes with a script, committing the numbers in the test").
 *
 * This IS the script: a self-contained WCAG 2.x relative-luminance/contrast
 * calculator, fed by `parseGlobalsPalette` reading the REAL per-`data-vibe`
 * token declarations out of `src/app/globals.css` on disk (same
 * read-the-file-not-the-browser pattern as
 * `src/__tests__/lib/escapeConsume.source-scan.test.ts`), asserting every
 * colored text/icon pair this component renders clears its WCAG threshold
 * in ALL 5 palettes.
 *
 * WHY a text parse, not a live browser resolve: jsdom does not implement
 * `color-mix()`/CSS custom-property resolution in a way this test harness
 * can query (no real layout engine — see the T4 rewrite in
 * TacticalMap.test.tsx for the same limitation), so there is no way to ask
 * a browser "what does `var(--bad)` resolve to under
 * `[data-vibe=candlelit]`" from inside Jest. `parseGlobalsPalette` reads
 * and resolves the same 9 tokens instead of a human hand-copying them — a
 * palette edit that breaks a pair now reds this test without anyone
 * re-syncing a table (the `debt:` this file used to carry is resolved: the
 * table was the debt, and it no longer exists).
 */
import fs from 'node:fs';
import path from 'node:path';
import { parseGlobalsPalette } from '@/components/tactical-map/paletteContrastParser';

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const full = h.length === 3
    ? h.split('').map((c) => c + c).join('')
    : h;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

function srgbToLinear(c: number): number {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance([r, g, b]: [number, number, number]): number {
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

/** WCAG contrast ratio between two solid sRGB hex colors. */
function contrast(hex1: string, hex2: string): number {
  const l1 = relativeLuminance(hexToRgb(hex1));
  const l2 = relativeLuminance(hexToRgb(hex2));
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * `color-mix(in oklab, X N%, transparent)` composited over a solid backdrop.
 * Mixing a real color with the keyword `transparent` does not blend hue/
 * lightness (CSS Color 5: interpolating toward "transparent" carries the
 * OTHER color's non-alpha channels forward unchanged) — it is exactly `X`
 * at `alpha = N/100`. Standard "over" alpha compositing then applies for
 * what actually lands on screen once that translucent color sits above
 * `backdropHex`.
 */
function alphaOver(fgHex: string, alpha: number, backdropHex: string): string {
  const fg = hexToRgb(fgHex);
  const bg = hexToRgb(backdropHex);
  const out = fg.map((c, i) => Math.round(c * alpha + bg[i] * (1 - alpha)));
  return `#${out.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

const GLOBALS_CSS_PATH = path.join(process.cwd(), 'src/app/globals.css');
const PALETTES = parseGlobalsPalette(fs.readFileSync(GLOBALS_CSS_PATH, 'utf8'));

const PALETTE_NAMES = Object.keys(PALETTES);

/**
 * B8c-1 / Iro-A11y MAJOR-1 (2026-09-28): `.cellPending`'s reach-ring and
 * destination-tag pins below read `.cellInRange`'s and `.cellPending`'s OWN
 * rules straight out of `TacticalMap.module.css` on disk — same
 * read-the-file-not-a-mirrored-literal pattern `parseGlobalsPalette` uses
 * for `globals.css` — rather than hand-copying the 55% ring alpha or the
 * (now-absent) container opacity as numeric literals in this test. A CSS
 * change to either rule flows straight into the math below with no test
 * edit required; the alternative (a hand-mirrored literal) is the exact
 * failure this file's own header already names as resolved debt for the
 * palette table, and MAJOR-1 is the same class of bug (a container opacity
 * silently changed what these pairs actually render at).
 */
const TACTICAL_MAP_CSS_PATH = path.join(
  process.cwd(),
  'src/components/tactical-map/TacticalMap.module.css',
);
const TACTICAL_MAP_CSS = fs.readFileSync(TACTICAL_MAP_CSS_PATH, 'utf8');

function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, ' ');
}

/** Extracts the `{ ... }` body of the first `.<selector> { ... }` rule found
 *  (flat declarations only, same non-greedy-`[^}]*` assumption
 *  `paletteContrastParser.ts` makes for `[data-vibe]` blocks — true for
 *  every rule in this file today). Throws if the selector itself is gone
 *  (a rename/restructure this parser cannot follow), so a structural
 *  change fails loudly instead of this test silently checking nothing. */
function extractCssRuleBody(css: string, selector: string): string {
  const stripped = stripCssComments(css);
  const re = new RegExp(`\\.${selector}\\s*\\{([^}]*)\\}`);
  const m = re.exec(stripped);
  if (!m) {
    throw new Error(
      `contrast.test.ts: .${selector} rule not found in TacticalMap.module.css`,
    );
  }
  return m[1];
}

/**
 * The reach ring's own alpha, read from `.cellInRange`'s `box-shadow`
 * specifically (NOT its `background` — that's the 20% fill tint, a
 * different `color-mix(--accent)` in the same rule) — not mirrored as a
 * literal `0.55` in this file. Throws if the declaration's shape changes
 * (a different property, a different color function) rather than silently
 * falling back to a stale percentage, or worse, silently matching the
 * wrong declaration.
 */
function extractCellInRangeAccentAlpha(css: string): number {
  const body = extractCssRuleBody(css, 'cellInRange');
  const boxShadowMatch = /box-shadow\s*:\s*([^;]+);/.exec(body);
  if (!boxShadowMatch) {
    throw new Error(
      "contrast.test.ts: .cellInRange has no box-shadow declaration — did the ring move to a different property?",
    );
  }
  const m = /color-mix\(in oklab,\s*var\(--accent\)\s*([0-9.]+)%,\s*transparent\)/.exec(
    boxShadowMatch[1],
  );
  if (!m) {
    throw new Error(
      "contrast.test.ts: .cellInRange's box-shadow has no var(--accent) color-mix() alpha — did the ring's construction change?",
    );
  }
  return parseFloat(m[1]) / 100;
}

/**
 * `.cellPending`'s own container `opacity`, if it has one — 1 (no dimming)
 * when absent, which is the fixed, post-Iro-A11y-MAJOR-1 state. If a
 * container opacity is ever re-added, this picks the new value straight up
 * and the degraded-contrast math below reproduces MAJOR-1's exact failure
 * automatically (mutation-proven below by literally re-adding it and
 * reverting — see the fix-round report, not committed here).
 */
function extractCellPendingContainerOpacity(css: string): number {
  const body = extractCssRuleBody(css, 'cellPending');
  const m = /(?<![\w-])opacity\s*:\s*([0-9.]+)\s*;/.exec(body);
  return m ? parseFloat(m[1]) : 1;
}

const CELL_IN_RANGE_ACCENT_ALPHA = extractCellInRangeAccentAlpha(TACTICAL_MAP_CSS);
const CELL_PENDING_CONTAINER_OPACITY = extractCellPendingContainerOpacity(TACTICAL_MAP_CSS);

describe('parseGlobalsPalette — coverage sanity (protects the loops below from a silent empty parse)', () => {
  const KNOWN_VIBES = ['aetheric', 'candlelit', 'dusk-tavern', 'hearthlight', 'moonlit-grove'];

  it('discovers at least the 5 known data-vibe palettes in globals.css', () => {
    // >= not ===: discovery (D1b IMPORTANT-1 fix) must never regress below
    // the known baseline, but a legitimate 6th palette (Tavern 2.0's ruled
    // "tinted worlds") must not fail this test — it should instead flow
    // into the per-palette loops below via PALETTE_NAMES.
    expect(PALETTE_NAMES.length).toBeGreaterThanOrEqual(KNOWN_VIBES.length);
    expect(PALETTE_NAMES).toEqual(expect.arrayContaining(KNOWN_VIBES));
  });

  it('every [data-vibe="..."] block ahead of the structural-tokens marker is discovered (independent oracle, not the parser\'s own count)', () => {
    const raw = fs.readFileSync(GLOBALS_CSS_PATH, 'utf8');
    const markerIdx = raw.indexOf('Shared structural tokens');
    const head = markerIdx === -1 ? raw : raw.slice(0, markerIdx);
    const blockCount = (head.match(/\[data-vibe=["'][a-z0-9-]+["']\]\s*\{/g) ?? []).length;
    expect(PALETTE_NAMES.length).toBe(blockCount);
  });
});

describe('parseGlobalsPalette — discovers a novel vibe with no hand-maintained list (Kage-CR D1b IMPORTANT-1 regression, M-A5)', () => {
  // Synthetic input, never globals.css itself (out of Lane D's file set) —
  // reproduces Kage's exact M-A5 probe (a 6th [data-vibe] block, every pair
  // ~1.2:1) without editing the real design tokens. Before the fix, a vibe
  // absent from the hardcoded KNOWN_VIBES list was silently unparsed and
  // never reached the contrast loops; this pins that it now is.
  const tenBadTokens = `
    --bg-3: #100f0f;
    --on-fill: #1a1919;
    --on-accent: #1a1919;
    --bad: #120f0f;
    --good: #131010;
    --cool: #141111;
    --cool-ink: #151212;
    --warm: #161313;
    --warm-ink: #171414;
    --accent: #181515;
  `;
  const syntheticCss = `
    [data-vibe="dusk-tavern"] { ${tenBadTokens} }
    [data-vibe="kagetest"] { ${tenBadTokens} }
    /* Shared structural tokens */
  `;

  it('parses an unrecognised vibe name it has never seen before', () => {
    const parsed = parseGlobalsPalette(syntheticCss);
    expect(Object.keys(parsed).sort()).toEqual(['dusk-tavern', 'kagetest']);
    expect(parsed.kagetest.bg3).toBe('#100f0f');
    expect(parsed.kagetest.warmInk).toBe('#171414');
  });
});

describe('TacticalMap contrast — D1 CR#1 coordinator decision 5 (existing tokens only, all 5 palettes)', () => {
  describe('.token glyph (--on-fill) on team fill — large text (>=18.66px bold -> 3:1), TacticalMap.module.css .token font-size: var(--text-xl)', () => {
    for (const name of PALETTE_NAMES) {
      const p = PALETTES[name];
      it(`${name}: on-fill vs --bad (foe) clears 3:1`, () => {
        expect(contrast(p.onFill, p.bad)).toBeGreaterThanOrEqual(3);
      });
      it(`${name}: on-fill vs --good (ally) clears 3:1`, () => {
        expect(contrast(p.onFill, p.good)).toBeGreaterThanOrEqual(3);
      });
    }

    it('dusk-tavern is the pair that actually needed the large-text move (fails 4.5, clears 3)', () => {
      const ratio = contrast(PALETTES['dusk-tavern'].onFill, PALETTES['dusk-tavern'].bad);
      expect(ratio).toBeLessThan(4.5);
      expect(ratio).toBeGreaterThanOrEqual(3);
    });
  });

  describe('.cellDestination outline (--cool-ink on --bg-3) — non-text, 3:1 (D1b item B: was plain --cool, 2.45:1 in candlelit)', () => {
    for (const name of PALETTE_NAMES) {
      const p = PALETTES[name];
      it(`${name}: cool-ink vs --bg-3 clears 3:1`, () => {
        expect(contrast(p.coolInk, p.bg3)).toBeGreaterThanOrEqual(3);
      });
    }

    it('candlelit is the pair that actually needed --cool-ink (plain --cool fails at 2.45:1)', () => {
      const p = PALETTES.candlelit;
      expect(contrast(p.cool, p.bg3)).toBeLessThan(3);
      expect(contrast(p.coolInk, p.bg3)).toBeGreaterThanOrEqual(3);
    });
  });

  describe('.eyeBadge icon (--cool-ink on --bg-3) — non-text, 3:1', () => {
    for (const name of PALETTE_NAMES) {
      const p = PALETTES[name];
      it(`${name}: cool-ink vs --bg-3 clears 3:1`, () => {
        expect(contrast(p.coolInk, p.bg3)).toBeGreaterThanOrEqual(3);
      });
    }

    it('candlelit is the pair that actually needed --cool-ink (plain --cool fails at 2.45:1)', () => {
      const p = PALETTES.candlelit;
      expect(contrast(p.cool, p.bg3)).toBeLessThan(3);
      expect(contrast(p.coolInk, p.bg3)).toBeGreaterThanOrEqual(3);
    });
  });

  describe('.feature glyph (--warm-ink on a 16% --warm tint over --bg-3) — large text (>=18.66px bold -> 3:1)', () => {
    for (const name of PALETTE_NAMES) {
      const p = PALETTES[name];
      it(`${name}: warm-ink vs the 16% warm tint over bg-3 clears 3:1`, () => {
        const composite = alphaOver(p.warm, 0.16, p.bg3);
        expect(contrast(p.warmInk, composite)).toBeGreaterThanOrEqual(3);
      });
    }

    it('candlelit is the pair that actually needed the tint+large-text combo (solid --warm + --on-fill fails even 3:1, at 2.24:1)', () => {
      const p = PALETTES.candlelit;
      expect(contrast(p.onFill, p.warm)).toBeLessThan(3);
      const composite = alphaOver(p.warm, 0.16, p.bg3);
      expect(contrast(p.warmInk, composite)).toBeGreaterThanOrEqual(3);
    });
  });

  describe('.destinationTag text (--cool-ink on a 10% --cool tint over --bg-3) — small text (9px), 4.5:1, NO large-text exemption available', () => {
    for (const name of PALETTE_NAMES) {
      const p = PALETTES[name];
      it(`${name}: cool-ink vs the 10% cool tint over bg-3 clears 4.5:1`, () => {
        const composite = alphaOver(p.cool, 0.10, p.bg3);
        expect(contrast(p.coolInk, composite)).toBeGreaterThanOrEqual(4.5);
      });
    }

    it('the original 80%-opaque --cool fill + --on-accent (pre-fix) fails 4.5:1 in candlelit specifically (Kage-CR D1 IMPORTANT-5: 2.95:1)', () => {
      const p = PALETTES.candlelit;
      const oldComposite = alphaOver(p.cool, 0.80, p.bg3);
      expect(contrast(p.onAccent, oldComposite)).toBeLessThan(4.5);
    });
  });

  describe('.cellInRange reach ring (inset color-mix(--accent) — non-text 3:1) — new baseline pin, B8c-1: this ring had no contrast pin at all before Iro-A11y MAJOR-1', () => {
    // 2 of 5 palettes (candlelit, hearthlight) sit under the 3:1 floor at
    // BASELINE — i.e. with `moveMode` on and no pending state at all. That
    // is a pre-existing gap (Kage-CR's reach-overlay finding, already
    // routed to the SceneStage mount) and explicitly NOT this fix's scope —
    // MAJOR-1 is about `.cellPending` making it WORSE, not about this
    // floor. Only the 3 palettes Iro-A11y's review names as "passed before
    // this diff" are asserted to clear 3:1 here; the other 2 are read but
    // deliberately not asserted against an absolute floor this fix isn't
    // responsible for.
    const KNOWN_PASSING_AT_BASELINE = ['dusk-tavern', 'aetheric', 'moonlit-grove'];
    for (const name of KNOWN_PASSING_AT_BASELINE) {
      const p = PALETTES[name];
      it(`${name}: accent@${Math.round(CELL_IN_RANGE_ACCENT_ALPHA * 100)}% ring vs --bg-3 clears 3:1 at baseline`, () => {
        const ringComposite = alphaOver(p.accent, CELL_IN_RANGE_ACCENT_ALPHA, p.bg3);
        expect(contrast(ringComposite, p.bg3)).toBeGreaterThanOrEqual(3);
      });
    }
  });

  describe('.cellPending must not degrade the reach ring or the destination tag below their own un-pending baseline (Iro-A11y MAJOR-1, 2026-09-28)', () => {
    // A container `opacity` composites the WHOLE cell subtree — ring, tag
    // and every other child alike — to one flattened layer before it lands
    // on the board (that is what a browser's compositor does for `opacity`
    // on a stacking-context-forming element); the translucent result then
    // blends toward whatever sits BEHIND the cell, which is `--bg-3`
    // (`.boardScroll`'s own background). `CELL_PENDING_CONTAINER_OPACITY` is
    // read straight from `.cellPending`'s own rule (see above) — at 1
    // (today's fixed state) every composite below is a no-op and "pending"
    // equals "baseline" exactly; at 0.6 (MAJOR-1's shipped-and-reverted
    // state) pending drops measurably below baseline and these tests catch
    // it with no test edit required. Asserting "no worse than baseline"
    // rather than an absolute floor is deliberate: candlelit/hearthlight's
    // ring already sits under 3:1 at baseline (describe above) for reasons
    // outside this fix's scope, and a floor assertion here would either
    // false-red on those two or have to special-case them — the actual
    // requirement (MAJOR-1: pending must not make it WORSE) doesn't care
    // which side of 3:1 the baseline was already on. `.cellPending`'s fix
    // is a `background-image` layer painted BELOW `.cellInRange`'s
    // box-shadow and below every child element (see the rule's own comment
    // in TacticalMap.module.css) — it paints over neither the ring nor the
    // tag, so nothing needs compositing IN beyond the container-opacity
    // term itself.
    for (const name of PALETTE_NAMES) {
      const p = PALETTES[name];

      it(`${name}: reach ring under .cellPending equals its own un-pending baseline (no degradation)`, () => {
        const ringComposite = alphaOver(p.accent, CELL_IN_RANGE_ACCENT_ALPHA, p.bg3);
        const baselineRatio = contrast(ringComposite, p.bg3);
        const pendingRing = alphaOver(ringComposite, CELL_PENDING_CONTAINER_OPACITY, p.bg3);
        const pendingRatio = contrast(pendingRing, p.bg3);
        expect(pendingRatio).toBeCloseTo(baselineRatio, 2);
      });

      it(`${name}: destinationTag text under .cellPending equals its own un-pending baseline (no degradation), and both clear 4.5:1`, () => {
        const tagComposite = alphaOver(p.cool, 0.10, p.bg3);
        const baselineRatio = contrast(p.coolInk, tagComposite);
        // The tag's fill AND its ink each fade toward `--bg-3`
        // independently under a container opacity — two separate elements
        // inside the same flattened subtree, not one layered atop the
        // other.
        const pendingTagBg = alphaOver(tagComposite, CELL_PENDING_CONTAINER_OPACITY, p.bg3);
        const pendingTagInk = alphaOver(p.coolInk, CELL_PENDING_CONTAINER_OPACITY, p.bg3);
        const pendingRatio = contrast(pendingTagInk, pendingTagBg);
        expect(pendingRatio).toBeCloseTo(baselineRatio, 2);
        // Unlike the ring, the tag's baseline clears 4.5:1 in all 5
        // palettes (see the un-pending `.destinationTag text` describe
        // above) — so an absolute floor is also valid here, not just the
        // no-degradation check.
        expect(pendingRatio).toBeGreaterThanOrEqual(4.5);
      });
    }

    it('.cellPending declares no container opacity today (the MAJOR-1 fix itself) — a cheap, direct pin alongside the ratio math above', () => {
      expect(CELL_PENDING_CONTAINER_OPACITY).toBe(1);
    });

    it("sanity: at the OLD 0.6 container opacity, dusk-tavern's ring and tag actually degrade below their baseline (proves the math above is discriminating, not vacuously true — this is the fix round's mutation proof, kept permanently rather than a one-off manual edit)", () => {
      const p = PALETTES['dusk-tavern'];
      const ringComposite = alphaOver(p.accent, CELL_IN_RANGE_ACCENT_ALPHA, p.bg3);
      const baselineRingRatio = contrast(ringComposite, p.bg3);
      const oldPendingRing = alphaOver(ringComposite, 0.6, p.bg3);
      expect(contrast(oldPendingRing, p.bg3)).toBeLessThan(baselineRingRatio);
      expect(contrast(oldPendingRing, p.bg3)).toBeLessThan(3);

      const tagComposite = alphaOver(p.cool, 0.10, p.bg3);
      const baselineTagRatio = contrast(p.coolInk, tagComposite);
      const oldPendingTagBg = alphaOver(tagComposite, 0.6, p.bg3);
      const oldPendingTagInk = alphaOver(p.coolInk, 0.6, p.bg3);
      const oldPendingTagRatio = contrast(oldPendingTagInk, oldPendingTagBg);
      expect(oldPendingTagRatio).toBeLessThan(baselineTagRatio);
      expect(oldPendingTagRatio).toBeLessThan(4.5);
    });
  });
});
