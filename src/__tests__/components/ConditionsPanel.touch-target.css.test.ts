/**
 * A9d-2 fix round 2 (Miko, WebKit-pass note): "Apply Blinded" was 72x38 at 720x450 on the human-DM shot, because the 44px rule at the control layer
 * covers selects only and `.applyBtn` wrote `height: 38px`. The phone row's 44px floor (the other controls of this panel have it already) now
 * includes the button. Text pin; the measured half is the harness's s:touchTargets on y-dm-all-panels / z1-dm-combat-plain at 720x450.
 * Control: take `.applyBtn` out of the 880px block -> reds.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const css = readFileSync(join(process.cwd(), 'src/components/ConditionsPanel.module.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

it('the Apply button has the 44px floor at 880px and under, as the panel\'s select and input do', () => {
  const at = css.indexOf('@media (max-width: 880px)');
  expect(at).toBeGreaterThan(-1);
  const block = css.slice(at, css.indexOf('\n}\n', at));
  expect(block).toMatch(/\.select,\s*\.input,\s*\.applyBtn\s*\{[^}]*min-height:\s*44px/);
});
