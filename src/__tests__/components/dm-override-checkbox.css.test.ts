/**
 * A9d-2 fix round N9 (carry item 5 of the round brief; the harness's s:touchTargets) -- "Show my overrides to players" was a 16x16 native
 * checkbox on a phone (red at 1d7c9fc on the DM shot too). On a phone or a touch screen the INPUT is the 44x44 target (the hit area is the
 * control, not a label around it), with a drawn 20px box inside it. CSS as text (jsdom computes no layout); the measured half is `s:touchTargets`
 * on `y-dm-all-panels`.
 *
 * Control: take the 44px off the input -> this reds, and `s:touchTargets` names the 16x16 box again.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const css = readFileSync(join(process.cwd(), 'src/components/DmNarrationPanel.module.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

describe('the DM override-visibility checkbox is a 44x44 target on a phone or a touch screen', () => {
  const i = css.indexOf('@media (max-width: 880px), (pointer: coarse)');
  const block = i < 0 ? '' : css.slice(i, css.indexOf('\n}\n', i) + 3);

  it('under the phone / coarse query the input is 44px by 44px', () => {
    expect(i).toBeGreaterThan(-1);
    const r = block.match(/\.visibilityCheckbox\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(r).toMatch(/width:\s*44px/);
    expect(r).toMatch(/height:\s*44px/);
    expect(r).toMatch(/appearance:\s*none/);
  });

  it('the drawn box and its checked state are painted by ::before / :checked::before, so state is not colour on the native glyph alone', () => {
    expect(block).toMatch(/\.visibilityCheckbox::before/);
    expect(block).toMatch(/\.visibilityCheckbox:checked::before/);
  });
});
