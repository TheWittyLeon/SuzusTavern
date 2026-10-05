/**
 * B8c-4 P1 (the brief's 2.1, 2.2 and the stage's half of 2.4) — the phone's fight row, pinned as literals, and the two places its values are read.
 * The consumers are what these tests mutate: a row value nobody reads, or a reader whose value is gone, is red here (and in the harness, at the pixel).
 */
import fs from 'node:fs';
import path from 'node:path';
import { LAYOUT_ROWS, LAYOUT_ROWS_BY_ID, getPlacement } from '@/app/play/[sessionId]/presets';
import { FOLD_SPECS } from '@/app/play/[sessionId]/foldSpecs';

const phone = LAYOUT_ROWS_BY_ID.phone;
const stageCss = fs.readFileSync(path.join(__dirname, '../../app/play/[sessionId]/regions/SceneStage.module.css'), 'utf8');

/** Every `max(Npx, Mrem)` the phone combat row spells, at the 16px root: the px at 100% text. The brief's own `5.7rem` is 91.2px: the floors must be IDENTICAL at 100% text, so the party minimum is 5.6875rem. */
const px = (v: string, root = 16) => {
  const m = /^max\((\d+(?:\.\d+)?)px,\s*(\d+(?:\.\d+)?)rem\)$/.exec(v);
  if (!m) throw new Error(`not a max(px, rem): ${v}`);
  return Math.max(Number(m[1]), Number(m[2]) * root);
};

describe('the phone fight row: the floors are max(px, rem) and the same px at 100% text', () => {
  const rows = phone.rows.combat;
  it('the party minimum 91, the story floor 208 and the banner floor 136 at the 16px root; larger when the root is', () => {
    expect(px('max(91px, 5.6875rem)')).toBe(91);
    expect(px('max(208px, 13rem)')).toBe(208);
    expect(px('max(136px, 8.5rem)')).toBe(136);
    expect(rows).toContain('max(91px, 5.6875rem)');
    expect(rows).toContain('max(208px, 13rem)');
    expect(phone.momentVars?.combat?.['--play-banner-floor']).toBe('max(136px, 8.5rem)');
    // 200% text: the floors double, the px never shrink
    expect([px('max(91px, 5.6875rem)', 32), px('max(208px, 13rem)', 32), px('max(136px, 8.5rem)', 32)]).toEqual([182, 416, 272]);
  });
  it('exploring is untouched: its literals, its banner floor, its stage', () => {
    expect(phone.rows.exploring).toContain('var(--play-party-min,91px)');
    expect(phone.rows.exploring).toContain('var(--play-floor,224px)');
    expect(phone.rows.exploring).not.toMatch(/rem/);
    expect(phone.momentVars?.exploring).toEqual({ '--play-banner-floor': '152px' });
    expect(getPlacement(phone, 'sceneStage', 'exploring')).toEqual({ area: 'sceneStage', variant: 'inline' });
  });
});

describe('the phone fight row: what each room gives the stage, and what a fold does to it (brief 2.1 table)', () => {
  const room = phone.factVars?.room as Record<string, Record<string, string>>;
  it('a board: 7 rows down to 3, the party band held to its minimum; a band: one 44px row; none and unserved: nothing, the party band free', () => {
    expect(room.board).toEqual({ '--play-body': 'calc(7 * var(--play-cell))', '--play-body-floor': 'calc(3 * var(--play-cell))', '--play-party-max': 'max(91px, 5.6875rem)' });
    expect(room.band).toEqual({ '--play-body': '44px', '--play-body-floor': '44px', '--play-party-max': 'max(91px, 5.6875rem)' });
    expect(room.none).toEqual({ '--play-body': '0px', '--play-body-floor': '0px' });
    expect(room.unserved).toEqual({ '--play-body': '0px', '--play-body-floor': '0px' });
  });
  it('the fold: auto asks for 4 rows, open adds nothing, folded is no height (and keeps the party band at its minimum: the room set that)', () => {
    expect((phone.factVars as Record<string, unknown>)['fold:sceneStage']).toEqual({ auto: { '--play-body-floor': 'calc(4 * var(--play-cell))' }, open: {}, folded: { '--play-body': '0px', '--play-body-floor': '0px' } });
  });
  it('the map\'s sizes are the fight\'s row vars: 30px squares, a follow margin of one square, a 16px edge guard; the exploring grid carries none (the harness prints a map row count wherever a grid has a cell)', () => {
    expect(phone.momentVars?.combat).toMatchObject({ '--play-cell': '30px', '--play-follow-margin': '1', '--play-edge-guard': '16px' });
    for (const k of ['--play-cell', '--play-follow-margin', '--play-edge-guard']) {
      expect(phone.vars).not.toHaveProperty(k);
      expect(phone.momentVars?.exploring).not.toHaveProperty(k);
    }
  });
  it('the fight stage folds only in a board fight, by the stage\'s body, named Map; the flag-off room has no fold', () => {
    expect(FOLD_SPECS.sceneStage).toMatchObject({ label: 'Map', text: 'Map', body: 'play-scene-stage-body', when: { room: 'board' } });
    expect(getPlacement(phone, 'sceneStage', 'combat')).toMatchObject({ variant: 'hero', collapsible: true, foldDefault: 'fits' });
  });
  it('the phone is the one row that says stripLine; no desktop row does', () => {
    expect(phone.stripLine).toBe(true);
    for (const r of LAYOUT_ROWS.filter((x) => x.id !== 'phone')) expect(r.stripLine).toBeUndefined();
  });
});

describe('the two readers of the row\'s map values: the stage\'s body hands them to the map, and the scene line has a cell for the handle', () => {
  it('`.body` hands the follow margin and the edge guard over (the map reads --tm-follow-margin and --tm-edge-guard from its window)', () => {
    const body = /\.body\s*\{[^}]*\}/.exec(stageCss)?.[0] ?? '';
    expect(body).toMatch(/--tm-follow-margin:\s*var\(--play-follow-margin,\s*0\)/);
    expect(body).toMatch(/--tm-edge-guard:\s*var\(--play-edge-guard,\s*0px\)/);
    expect(body).toMatch(/--tm-cell-size:\s*var\(--play-cell\)/);
  });
  it('`.hero` has a sixth column and a `fold` area on both of the scene line\'s rows (the held strip: in the buttons\' row); `.foldSlot` sits in it', () => {
    const hero = /\.hero\s*\{[^}]*\}/.exec(stageCss)?.[0] ?? '';
    const held = /\.hero\.heldDm\s*\{[^}]*\}/.exec(stageCss)?.[0] ?? '';
    expect(hero).toMatch(/'\. head end wrap fold \.'/);
    expect(hero).toMatch(/'\. note end wrap fold \.'/);
    expect(held).toMatch(/'\. head end wrap fold \.'/);
    expect(held).toMatch(/'\. note note note note \.'/); // the held strip's status keeps the whole width: the handle is in the buttons' row only
    expect(/\.foldSlot\s*\{[^}]*\}/.exec(stageCss)?.[0]).toMatch(/grid-area:\s*fold/);
  });
});

describe('the map\'s line: a lead that shrinks, a tail that does not, and a wrap under 11rem (Miko M1; brief M2-4, M2-10)', () => {
  const rule = (sel: string) => new RegExp(`${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{[^}]*\\}`).exec(stageCss)?.[0] ?? '';
  it('the lead takes the ellipsis; the tail is `flex: 0 0 auto`, keeps its leading space (`white-space: pre`) and is clipped only at its OWN end when it alone is wider than the line', () => {
    expect(rule('.strip .lineLead')).toMatch(/text-overflow:\s*ellipsis/);
    expect(rule('.strip .lineLead')).toMatch(/min-width:\s*0/);
    expect(rule('.strip .lineTail')).toMatch(/flex:\s*0 0 auto/);
    expect(rule('.strip .lineTail')).toMatch(/white-space:\s*pre/);
    expect(rule('.strip .lineTail')).toMatch(/max-width:\s*100%/);
  });
  it('the line is a size container and both spans wrap in the block form under 11rem', () => {
    expect(rule('.strip .line')).toMatch(/container-type:\s*inline-size/);
    expect(stageCss).toMatch(/@container \(max-width: 11rem\)\s*\{[\s\S]*\.strip \.lineBox\s*\{[^}]*display:\s*block[\s\S]*white-space:\s*normal/);
  });
});
