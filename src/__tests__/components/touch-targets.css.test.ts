/**
 * Tora A9d-1 MINOR-1: controls on the phone measured under the 44x44 target the project holds: the composer's Say / Act /
 * OOC / roll toggles (37-41px wide), End combat (42px wide), the advantage / disadvantage pills (41 / 38px), and the
 * composer textarea (~42px tall). The browser half is capture-play's (s) check on every phone cell; this pins the rules.
 */
import fs from 'node:fs';
import path from 'node:path';

const read = (rel: string) => fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
/** The body of the first `selector { ... }` at the top level or inside the first @media block that contains it. */
const rule = (css: string, selector: string, from = 0): string => {
  const i = css.indexOf(`${selector} {`, from);
  if (i === -1) throw new Error(`no ${selector} rule`);
  return css.slice(css.indexOf('{', i) + 1, css.indexOf('}', i));
};

describe('44px touch targets (phone)', () => {
  it('Composer: the mode toggles are 44 wide AND tall on a phone (inside the 480px query; desktop stays compact)', () => {
    const css = read('src/components/Composer.module.css');
    // a narrow phone OR any touch device (a landscape phone / a zoomed phone row is wider than 480px)
    const media = css.slice(css.indexOf('@media (max-width: 480px), (pointer: coarse) {'));
    expect(media.length).toBeLessThan(css.length);
    expect(rule(media, '.mode')).toMatch(/min-height:\s*44px/);
    expect(rule(media, '.mode')).toMatch(/min-inline-size:\s*44px/);
    expect(rule(css, '.mode')).not.toMatch(/min-inline-size/); // the desktop toggle is unchanged
  });

  it('Composer: the textarea is at least 44px tall', () => {
    expect(rule(read('src/components/Composer.module.css'), '.input')).toMatch(/min-height:\s*44px/);
  });

  it('End combat is a border-box 44x44 target', () => {
    const r = rule(read('src/app/play/[sessionId]/Play.module.css'), '.endCombatBtn');
    expect(r).toMatch(/box-sizing:\s*border-box/);
    expect(r).toMatch(/min-height:\s*44px/);
    expect(r).toMatch(/min-inline-size:\s*44px/);
  });

  it('the advantage / disadvantage pills are at least 44 wide and tall', () => {
    const r = rule(read('src/components/DiceTray.module.css'), '.advPill');
    expect(r).toMatch(/min-height:\s*44px/);
    expect(r).toMatch(/min-inline-size:\s*44px/);
  });
});
