/**
 * contrast.test.ts — D1 CR#1, coordinator decision 5 ("compute every pair
 * across all 5 palettes with a script, committing the numbers in the test").
 *
 * This IS the script: a self-contained WCAG 2.x relative-luminance/contrast
 * calculator plus the exact token hex values TacticalMap.module.css resolves
 * to under each `data-vibe` palette, asserting every colored text/icon pair
 * this component renders clears its WCAG threshold in ALL 5 palettes.
 *
 * WHY hand-mirrored hex, not a live read of globals.css: jsdom does not
 * implement `color-mix()`/CSS custom-property resolution in a way this test
 * harness can query (no real layout engine — see the T4 rewrite in
 * TacticalMap.test.tsx for the same limitation), so there is no way to ask
 * a browser "what does `var(--bad)` resolve to under
 * `[data-vibe=candlelit]`" from inside Jest. The values below are read
 * directly from `src/app/globals.css` as of this commit.
 *
 * debt: this table hand-copies globals.css's per-palette hex values instead of reading them live. ceiling: exactly the tokens this file uses (on-fill/bad/good/cool/cool-ink/warm/warm-ink/bg-3) across the 5 data-vibe palettes; a 6th palette or a new pair is not covered until added here.
 * until: a jsdom-compatible CSS engine resolves computed color-mix() in tests, or globals.css exposes its palette table as a module this test imports instead of mirroring.
 */

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

interface Palette {
  bg3: string;
  onFill: string;
  onAccent: string;
  bad: string;
  good: string;
  cool: string;
  coolInk: string;
  warm: string;
  warmInk: string;
}

// Mirrored from src/app/globals.css, 2026-09-28 (see the `debt:` marker
// above for the re-sync obligation this creates).
const PALETTES: Record<string, Palette> = {
  'dusk-tavern': {
    bg3: '#221a3a', onFill: '#15101e', onAccent: '#15101e',
    bad: '#c25353', good: '#6db48a',
    cool: '#a7c5ec', coolInk: '#a7c5ec',
    warm: '#f5cba8', warmInk: '#f5cba8',
  },
  candlelit: {
    bg3: '#e0d4be', onFill: '#ffffff', onAccent: '#ffffff',
    bad: '#a83a3a', good: '#2d6032',
    cool: '#6b8aaa', coolInk: '#35597a',
    warm: '#d4a64b', warmInk: '#7a5300',
  },
  aetheric: {
    bg3: '#1a2244', onFill: '#0c0f1e', onAccent: '#0c0f1e',
    bad: '#ff7a8a', good: '#6dd49a',
    cool: '#7ee8e2', coolInk: '#7ee8e2',
    warm: '#ffc792', warmInk: '#ffc792',
  },
  'moonlit-grove': {
    bg3: '#1d2825', onFill: '#0f1614', onAccent: '#0f1614',
    bad: '#d07a7a', good: '#88c890',
    cool: '#9cc8e0', coolInk: '#9cc8e0',
    warm: '#e8c89a', warmInk: '#e8c89a',
  },
  hearthlight: {
    bg3: '#251a33', onFill: '#170f1c', onAccent: '#170f1c',
    bad: '#d6635f', good: '#63b17f',
    cool: '#93b8ea', coolInk: '#93b8ea',
    warm: '#f0b57e', warmInk: '#f0b57e',
  },
};

const PALETTE_NAMES = Object.keys(PALETTES);

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
});
