/**
 * A10 step 11, S1 (Sora's build brief 3.1, F-c) — the `roll` composer is ONE row where it fits and two at the phone's width.
 *
 * `roll` was two rows at every width (the mode row forced a full line), which is right on the phone and costs a desktop composer about 55px of the
 * log. Now the mode row shares the line with the input, which takes a minimum basis so a narrow composer wraps by itself; the shell's phone width puts
 * the mode row back on a line of its own, so every phone cell keeps the two rows A9d-2 measured. CSS cannot read `PLAY_PHONE_MAX_WIDTH` in a media
 * query (lib/breakpoints.ts says why), so the copy is pinned HERE to its source. jsdom applies no CSS: this pins the stylesheet text; the geometry is the
 * harness's z:modeRow (two rows at 320 / 360 / 390, one row at 1440 within 1px of a `full` composer).
 */
import fs from 'node:fs';
import path from 'node:path';
import { PLAY_PHONE_MAX_WIDTH } from '@/lib/breakpoints';

const css = fs.readFileSync(path.resolve(process.cwd(), 'src/components/Composer.module.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** the declarations of the rule `sel` that stands at the top level (not inside an @media block) */
const topRule = (sel: string) => {
  const outside = css.replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '');
  const at = outside.indexOf(`\n${sel} {`);
  expect(at).toBeGreaterThan(-1);
  return outside.slice(at, outside.indexOf('}', at));
};
/** the body of the `@media (max-width: <PLAY_PHONE_MAX_WIDTH>px)` block that holds the roll mode row */
const phoneBlock = () => {
  const m = [...css.matchAll(/@media \(max-width:\s*(\d+)px\)\s*\{((?:[^{}]*\{[^{}]*\})*[^{}]*)\}/g)].find((b) => b[2].includes("[data-variant='roll'] .modeRow"));
  expect(m).toBeDefined();
  return { width: Number(m![1]), body: m![2] };
};

describe('Composer.module.css — the `roll` row shares the line where there is room', () => {
  it('the mode row does not force a line of its own by default, and does not wrap inside', () => {
    const r = topRule(".composer[data-variant='roll'] .modeRow");
    expect(r).toMatch(/display:\s*flex/);
    expect(r).toMatch(/flex:\s*0 1 auto/);
    expect(r).not.toMatch(/100%/);
  });

  it('the input takes a minimum basis, so a narrow composer wraps by itself instead of crushing it', () => {
    expect(topRule(".composer[data-variant='roll'] .input")).toMatch(/flex:\s*1 1 12rem/);
  });

  it("the phone's width forces the mode row onto its own line and gives the input back its old `flex: 1`", () => {
    const { body } = phoneBlock();
    expect(body).toMatch(/\.modeRow\s*\{[^}]*flex:\s*1 0 100%/);
    expect(body).toMatch(/\.input\s*\{[^}]*flex:\s*1 1 0%/);
  });

  it("that width IS the shell's phone breakpoint (the copy is pinned to lib/breakpoints.ts)", () => {
    expect(phoneBlock().width).toBe(PLAY_PHONE_MAX_WIDTH);
  });

  it('only `roll` is affected: the default composer keeps its mode row `display: contents` and its input `flex: 1`', () => {
    expect(topRule('.modeRow')).toMatch(/display:\s*contents/);
    expect(topRule('.input')).toMatch(/\n\s*flex:\s*1;/);
  });
});
