/**
 * Round 7 (Tatsu-Dep's post-deploy test of 55c5e26, a P1 on prod): the human DM's combat panel (monster Attack / Skip / Move, conditions, the override and Speak-as
 * controls) is a ~700px child of the story column's `.slotStack`, which is `overflow: hidden`. With the page no longer scrolling it was CLIPPED: at 1440x900, 1440x780
 * and 1280x650 the hit at each button was something else and the wheel did not scroll the column. While the DM panel is in the stack, the stack scrolls. The proof is
 * the harness's dm-reach legs (a hit test at every control, red at 2e73945); these are the text halves: the rule, its bound to the panel, and the unchanged clip.
 * Controls: drop the `:has(...)` rule, or its overflow-y, or the data-region on the panel -> reds; make the base stack scroll -> reds; put `contain` back -> reds.
 * What jest CANNOT see: the direct-child `>` (a wrapper around the panel would not match the rule, and these are text pins); only the harness's dm-reach legs (a hit test in
 * the browser) catch that. The drag proof is the harness's dm-drag-xcard leg.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const css = readFileSync(join(process.cwd(), 'src/app/play/[sessionId]/Play.module.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const tsx = readFileSync(join(process.cwd(), 'src/app/play/[sessionId]/regions/TableControls.tsx'), 'utf8');
const rule = (selector: string) => css.match(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`))?.[1] ?? '';

describe('Play.module.css: the story stack and the DM combat panel', () => {
  it('the stack still CLIPS in every other state (overflow hidden): ChatLog scrolls internally and the column never does', () => {
    expect(rule('.slotStack')).toMatch(/overflow:\s*hidden/);
    expect(rule('.slotStack')).not.toMatch(/overflow-y:\s*auto/);
  });

  it('while the DM panel is in it, the stack SCROLLS (overflow-y: auto): every control is reachable by the wheel, by touch and by keyboard', () => {
    expect(rule('.slotStack:has(> [data-region="tableControlsDm"])')).toMatch(/overflow-y:\s*auto/);
  });

  // Round 8 (Kage C-1): the ruled design (Play.module.css, the html rule beside `.grid`, Tora MAJOR-2) keeps NESTED CHAINING so a reflow screen can drag on to the composer
  // and the X-card. `contain` here trapped the drag (375x667 and 360x740: not reached in 12 drags). Pull-to-refresh is blocked by html's own overscroll-behavior-y: none.
  it('the stack does NOT contain its overscroll: a drag at its end chains to the page (a reflow screen reaches the X-card)', () => {
    expect(rule('.slotStack:has(> [data-region="tableControlsDm"])')).not.toMatch(/overscroll-behavior/);
    expect(css).toMatch(/html\)?:has\(\.grid\)\s*\{[^}]*overscroll-behavior-y:\s*none/);
  });

  it('it paints the shell\'s scroll cue (a fade only while there is more to scroll)', () => {
    const r = rule('.slotStack:has(> [data-region="tableControlsDm"])');
    expect(r).toMatch(/background-attachment:\s*local,\s*local,\s*scroll,\s*scroll/);
  });

  it('the selector\'s attribute is the one DmCombatControls puts on its root (a renamed region would silently turn the scroll off)', () => {
    expect(tsx).toMatch(/data-region="tableControlsDm"/);
  });
});
