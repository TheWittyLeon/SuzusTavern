/**
 * A10 step 11, S1 (Sora's build brief 3.1, F-c) — the `roll` composer is ONE row where it fits and two on the phone. A10 fix round F6 (Sora K2, Kage Tavern 5) — the ROW says which.
 *
 * `roll` was two rows at every width (the mode row forced a full line), which is right on the phone and costs a desktop composer about 55px of the log. The mode row shares the
 * line with the input, which takes a minimum basis so a narrow composer wraps by itself. The phone is two rows at every phone width: its mode row takes a line of its own and its
 * input keeps its old `flex: 1`. S1 did that with `@media (max-width: 880px)` in the stylesheet, a COPY of the shell's phone breakpoint (CSS cannot read it) that this test pinned to
 * lib/breakpoints.ts; F6 deletes the copy: the phone row carries two values (`--play-roll-mode-flex`, `--play-roll-input-flex`), the same channel as `--play-composer-gap`, and the
 * stylesheet reads them with the desktop's behaviour as the fallbacks.
 * jsdom applies no CSS: this pins the stylesheet text and the rows; the geometry is the harness's z:modeRow (two rows at 320 / 360 / 390, one row at 1440 within 1px of a `full`
 * composer) and every phone budget line, which F6 leaves identical.
 */
import fs from 'node:fs';
import path from 'node:path';
import { LAYOUT_ROWS_BY_ID } from '@/app/play/[sessionId]/presets';

const css = fs.readFileSync(path.resolve(process.cwd(), 'src/components/Composer.module.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** the declarations of the rule `sel` that stands at the top level (not inside an @media block) */
const topRule = (sel: string) => {
  const outside = css.replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '');
  const at = outside.indexOf(`\n${sel} {`);
  expect(at).toBeGreaterThan(-1);
  return outside.slice(at, outside.indexOf('}', at));
};

describe('Composer.module.css — the `roll` row shares the line where there is room, and the ROW says when it does not', () => {
  it('the mode row is a flex box that does not wrap inside; its `flex` is the row\'s `--play-roll-mode-flex`, and absent it does not force a line of its own', () => {
    const r = topRule(".composer[data-variant='roll'] .modeRow");
    expect(r).toMatch(/display:\s*flex/);
    expect(r).toMatch(/flex:\s*var\(--play-roll-mode-flex,\s*0 1 auto\)/);
    expect(r).not.toMatch(/100%/);
  });

  it('the input AND Send are one flex item, whose `flex` is the row\'s `--play-roll-input-flex`; absent it takes the input\'s minimum basis plus the gap and Send, so a narrow composer wraps them together and never leaves Send alone (A10 fix round 2, Kage Tavern 2)', () => {
    const r = topRule(".composer[data-variant='roll'] .inputRow");
    expect(r).toMatch(/display:\s*flex/);
    expect(r).toMatch(/flex:\s*var\(--play-roll-input-flex,\s*1 1 calc\(12rem \+ var\(--play-composer-gap, var\(--density-gap\)\) \+ 44px\)\)/);
    // the basis is the old input's 12rem + the gap + Send's own width: `.send` is that wide
    expect(topRule('.send')).toMatch(/width:\s*44px/);
    // the input no longer carries the row's flex: it fills the unit
    expect(css).not.toMatch(/\[data-variant='roll'\]\s*\.input\s*\{/);
  });

  it('the stylesheet carries no copy of the phone breakpoint: no media query touches the `roll` mode row, input or input row, and no 880 appears in this file', () => {
    const mediaBlocks = [...css.matchAll(/@media[^{]*\{((?:[^{}]*\{[^{}]*\})*[^{}]*)\}/g)].map((m) => m[1]);
    expect(mediaBlocks.length).toBeGreaterThan(0); // the file has other media queries (touch targets, the narrow phones' stacked mode tablist); an empty scan would prove nothing
    for (const block of mediaBlocks) expect(block).not.toMatch(/\[data-variant='roll'\]\s*\.(modeRow|input|inputRow)\b/);
    expect(css).not.toMatch(/880\s*px/);
  });

  it('the PHONE row says two rows: the mode row takes a line of its own and the input keeps `flex: 1`; no desktop row sets either (so they take the fallbacks)', () => {
    expect(LAYOUT_ROWS_BY_ID.phone.vars).toMatchObject({ '--play-roll-mode-flex': '1 0 100%', '--play-roll-input-flex': '1 1 0%' });
    for (const id of ['story', 'table'] as const) {
      expect(Object.keys(LAYOUT_ROWS_BY_ID[id].vars ?? {}).filter((k) => k.startsWith('--play-roll-'))).toEqual([]);
      for (const m of ['exploring', 'combat'] as const) {
        expect(Object.keys(LAYOUT_ROWS_BY_ID[id].momentVars?.[m] ?? {}).filter((k) => k.startsWith('--play-roll-'))).toEqual([]);
      }
    }
  });

  it('only `roll` is affected: the default composer keeps its mode row and its input row `display: contents`, and its input `flex: 1`', () => {
    expect(topRule('.modeRow')).toMatch(/display:\s*contents/);
    expect(topRule('.inputRow')).toMatch(/display:\s*contents/);
    expect(topRule('.input')).toMatch(/\n\s*flex:\s*1;/);
  });
});
