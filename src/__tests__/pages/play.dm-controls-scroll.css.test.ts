/**
 * Round 7 (Tatsu-Dep's post-deploy test of 55c5e26, a P1 on prod): the human DM's combat panel (monster Attack / Skip / Move, conditions, the override and Speak-as
 * controls) is a ~700px child of the story column's `.slotStack`, which is `overflow: hidden`. With the page no longer scrolling it was CLIPPED: at 1440x900, 1440x780
 * and 1280x650 the hit at each button was something else and the wheel did not scroll the column. While the DM panel is in the stack, the stack scrolls. The proof is
 * the harness's dm-reach legs (a hit test at every control, red at 2e73945); these are the text halves: the rule, its bound to the panel, and the unchanged clip.
 * Controls: drop the `:has(...)` rule, or its overflow-y, or the data-region on the panel -> reds; make the base stack scroll -> reds.
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

  it('while the DM panel is in it, the stack SCROLLS (overflow-y: auto, contained): every control is reachable by the wheel, by touch and by keyboard', () => {
    const r = rule('.slotStack:has(> [data-region="tableControlsDm"])');
    expect(r).toMatch(/overflow-y:\s*auto/);
    expect(r).toMatch(/overscroll-behavior:\s*contain/);
  });

  it('it paints the shell\'s scroll cue (a fade only while there is more to scroll)', () => {
    const r = rule('.slotStack:has(> [data-region="tableControlsDm"])');
    expect(r).toMatch(/background-attachment:\s*local,\s*local,\s*scroll,\s*scroll/);
  });

  it('the selector\'s attribute is the one DmCombatControls puts on its root (a renamed region would silently turn the scroll off)', () => {
    expect(tsx).toMatch(/data-region="tableControlsDm"/);
  });
});
