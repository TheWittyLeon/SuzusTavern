/**
 * A9d-2 fix round 2 (Iro Minor-3, Tora MINOR-5): at 340px and under the strip's status text is not cut. "All enemies are down." was 145px in a 136px box
 * (an ellipsis in Chromium, a hard cut mid-word in WebKit) and is the only visible reason Wrap up appears. The icon (decoration, aria-hidden) goes at
 * 340px and under, which makes it one line (128px); the text may wrap instead of being clipped if it is ever longer. Text pins; the measured halves are
 * the harness's o:statusText (no painted status has scrollWidth > clientWidth) and o:strip (the 75px ceiling).
 * Control: delete either rule -> reds.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const css = readFileSync(join(process.cwd(), 'src/app/play/[sessionId]/regions/SceneStage.module.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const at = css.indexOf('@media (max-width: 340px)');
const block = css.slice(at, css.indexOf('\n}\n', at));

describe('SceneStage.module.css at 340px and under', () => {
  it('the status text wraps instead of ellipsising (white-space normal, overflow visible)', () => {
    expect(at).toBeGreaterThan(-1);
    expect(block).toMatch(/\.strip \.note\s*\{[^}]*white-space:\s*normal/);
    expect(block).toMatch(/\.strip \.note\s*\{[^}]*overflow:\s*visible/);
  });
  it('the status icon is dropped (it is aria-hidden decoration) so the line stays ONE line', () => {
    expect(block).toMatch(/\.strip \.note svg\s*\{[^}]*display:\s*none/);
  });
  it('above 340px the one-line, ellipsised rule is the base (the 360px+ cells are measured and fit)', () => {
    expect(css.slice(0, at)).toMatch(/\.strip \.note\s*\{[^}]*white-space:\s*nowrap/);
  });
});
