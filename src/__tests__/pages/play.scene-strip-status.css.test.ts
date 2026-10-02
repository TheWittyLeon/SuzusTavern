/**
 * A9d-2 fix round 3: the scene strip's status text wraps wherever it does not fit, at ANY width. Round 2 wrapped it at 340px and under only,
 * and the Safari engine (wider text metrics) cut "In combat · use the action bar · round 2" at 360x740 (248px in a 233px box). No width
 * threshold now: the base rule is the wrap, and no media block restates it. At 340px and under the status icon (decoration, aria-hidden) still
 * goes, which keeps "All enemies are down." (128px) one line beside two buttons. Text pins; the measured halves are the harness's
 * o:statusText (no painted status is cut, in either engine at every viewport) and o:strip.
 * Control: put the nowrap/overflow rule back on the base, or the wrap back inside the media block -> reds.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const css = readFileSync(join(process.cwd(), 'src/app/play/[sessionId]/regions/SceneStage.module.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const at = css.indexOf('@media (max-width: 340px)');
const block = css.slice(at, css.indexOf('\n}\n', at));

describe('SceneStage.module.css: the scene strip status', () => {
  it('the base rule wraps the status (white-space normal), is never ellipsised and never clips (no overflow hidden, no nowrap)', () => {
    const base = css.slice(0, at);
    const rule = base.match(/\.strip \.note\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(rule).toMatch(/white-space:\s*normal/);
    expect(rule).not.toMatch(/white-space:\s*nowrap/);
    expect(rule).not.toMatch(/overflow:\s*hidden/);
    expect(rule).not.toMatch(/text-overflow/);
  });
  it('no media block restates the status wrap: it is a width-free rule', () => {
    expect(at).toBeGreaterThan(-1);
    expect(block).not.toMatch(/\.strip \.note\s*\{[^}]*white-space/);
  });
  it('at 340px and under the status icon is dropped (it is aria-hidden decoration) so "All enemies are down." stays ONE line', () => {
    expect(block).toMatch(/\.strip \.note svg\s*\{[^}]*display:\s*none/);
  });
});
