/**
 * A10 step 11, S1 (Sora's build brief 3.1, F-c) — the `roll` composer is ONE row where it fits. (It was two on the phone until A10 step 11 tail S6: the phone is `line` now, pinned below, and the two F6 row values this file used to pin are deleted.)
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
  it('the mode row is a flex box that does not wrap inside and does not force a line of its own (named exception: it read `--play-roll-mode-flex`, which the phone no longer sets)', () => {
    const r = topRule(".composer[data-variant='roll'] .modeRow");
    expect(r).toMatch(/display:\s*flex/);
    expect(r).toMatch(/flex:\s*0 1 auto/);
    expect(r).not.toMatch(/100%/);
  });

  it('the input AND Send are one flex item whose basis is the input\'s minimum (12rem) plus the gap and Send, so a narrow composer wraps them together and never leaves Send alone (A10 fix round 2, Kage Tavern 2; named exception: it read `--play-roll-input-flex`)', () => {
    const r = topRule(".composer[data-variant='roll'] .inputRow");
    expect(r).toMatch(/display:\s*flex/);
    expect(r).toMatch(/flex:\s*1 1 calc\(12rem \+ var\(--play-composer-gap, var\(--density-gap\)\) \+ 44px\)/);
    expect(topRule('.send')).toMatch(/width:\s*44px/);
    expect(css).not.toMatch(/\[data-variant='roll'\]\s*\.input\s*\{/);
  });

  it('the stylesheet carries no copy of the phone breakpoint: no media query touches the `roll` mode row, input or input row, and no 880 appears in this file', () => {
    const mediaBlocks = [...css.matchAll(/@media[^{]*\{((?:[^{}]*\{[^{}]*\})*[^{}]*)\}/g)].map((m) => m[1]);
    expect(mediaBlocks.length).toBeGreaterThan(0); // the file has other media queries (touch targets, the narrow phones' stacked mode tablist); an empty scan would prove nothing
    for (const block of mediaBlocks) expect(block).not.toMatch(/\[data-variant='roll'\]\s*\.(modeRow|input|inputRow)\b/);
    expect(css).not.toMatch(/880\s*px/);
  });

  it('no stylesheet reads, and no row sets, an F6 row value: `--play-roll-mode-flex` and `--play-roll-input-flex` are gone (S6 deleted them with the phone\'s `roll` row)', () => {
    expect(css).not.toMatch(/--play-roll-(mode|input)-flex/);
    for (const id of ['story', 'table', 'phone'] as const) {
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

describe('Composer.module.css — the phone\'s `line` composer (A10 step 11 tail, S6)', () => {
  it('the phone row says `line` in both moments', () => {
    for (const m of ['exploring', 'combat'] as const) expect(LAYOUT_ROWS_BY_ID.phone.regions[m === 'exploring' ? 'composer' : 'composer']).toBeDefined();
    expect(JSON.stringify(LAYOUT_ROWS_BY_ID.phone.regions.composer)).toContain('"variant":"line"');
  });

  it('the row wraps by ITSELF: the mode row grows by 1 and the field + Send unit by 1000 with a basis of 9rem + the gap + Send, so the pair wraps where the field would be under 9rem (no breakpoint, no viewport name)', () => {
    expect(topRule(".composer[data-variant='line'] .row")).toMatch(/flex-wrap:\s*wrap/);
    expect(topRule(".composer[data-variant='line'] .modeRow")).toMatch(/flex:\s*1 1 auto/);
    expect(topRule(".composer[data-variant='line'] .inputRow")).toMatch(/flex:\s*1000 1 calc\(9rem \+ var\(--play-composer-gap, var\(--density-gap\)\) \+ 44px\)/);
    const f = topRule(".composer[data-variant='line'] .field");
    expect(f).toMatch(/flex:\s*1 1 9rem/);
    expect(f).toMatch(/min-width:\s*min\(9rem, calc\(100% - 52px\)\)/);
    expect(css).not.toMatch(/\[data-variant='line'\][^{]*\{[^}]*\d+px[^}]*9rem/);
  });

  it('the field is three lines at most (92px) and OOC dashes it; Send keeps its 44px', () => {
    expect(topRule(".composer[data-variant='line'] .input")).toMatch(/max-height:\s*92px/);
    expect(topRule(".composer[data-variant='line'][data-mode='ooc'] .input")).toMatch(/border-style:\s*dashed/);
    expect(topRule('.send')).toMatch(/width:\s*44px/);
  });
});

describe('RollControl.module.css — the `line` Roll is a fixed box (A10 step 11 tail, S6)', () => {
  const rcss = fs.readFileSync(path.resolve(process.cwd(), 'src/components/RollControl.module.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const rule = (sel: string) => {
    const at = rcss.indexOf(`\n${sel} {`);
    expect(at).toBeGreaterThan(-1);
    return rcss.slice(at, rcss.indexOf('}', at));
  };
  it('48px at 100% text, no width of its own (the tag sits inside the box and never widens it): a min inline size and a grid of the icon, the tag and the word', () => {
    const r = rule("[data-variant='line'] .roll");
    expect(r).toMatch(/min-inline-size:\s*48px/);
    expect(r).toMatch(/min-height:\s*44px/);
    expect(r).toMatch(/display:\s*grid/);
    expect(r).not.toMatch(/(^|[\s;])(inline-size|width):/);
    expect(rule("[data-variant='line'] .label")).toMatch(/display:\s*contents/);
    expect(rule("[data-variant='line'] .sep")).toMatch(/display:\s*none/);
    expect(rule("[data-variant='line'] .tag")).toMatch(/grid-row:\s*1/);
    expect(rule("[data-variant='line'] .word")).toMatch(/grid-row:\s*2/);
  });
});
