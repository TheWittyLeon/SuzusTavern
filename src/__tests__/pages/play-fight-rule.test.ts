/**
 * A10 step 11 round 4 (Aoi's "Short Desktop Fights"): in a fight the band you act with comes first. The order down the page is the stage, the story log (at its floor), the action bar (the verbs
 * and the X-card) and the composer LAST; what gives, in order: the empty stage box (the `unserved` room), the board's rows down to three, the composer's padding, and then the page scrolls,
 * taking the composer, never the verbs or the X-card. All of it is ROW DATA and one room value; this pins each piece, on the real rows.
 *
 * Controls: put the composer back above the action bar in either row; give `unserved` a body; drop the composer vars; let the sheet rail run down to the composer; delete the stand-in's zero-height rule.
 */
import fs from 'node:fs';
import path from 'node:path';
import { FACTS, LAYOUT_ROWS_BY_ID, slotOrder, type LayoutId } from '@/app/play/[sessionId]/presets';

const lines = (areas: string) => areas.split('\n').map((l) => l.trim().replace(/^`?"|"`?,?$/g, '').split(/\s+/)).filter((l) => l[0]);
const lineOf = (id: LayoutId, token: string) => lines(LAYOUT_ROWS_BY_ID[id].areas.combat).findIndex((l) => l.includes(token));

describe.each(['story', 'table'] as const)('%s: the fight rule', (id) => {
  it('the action bar comes before the composer, and the composer is the LAST band', () => {
    const l = lines(LAYOUT_ROWS_BY_ID[id].areas.combat);
    expect(lineOf(id, 'actionBar')).toBeLessThan(lineOf(id, 'composer'));
    expect(lineOf(id, 'storyLog')).toBeLessThan(lineOf(id, 'actionBar'));
    expect(lineOf(id, 'composer')).toBe(l.length - 1);
  });

  it('the DOM and Tab order follow: log, verbs and X-card (the action bar), composer', () => {
    const order = slotOrder(LAYOUT_ROWS_BY_ID[id], 'combat').filter((e) => e.kind === 'slot').map((e) => e.id);
    expect(order.indexOf('storyLog')).toBeLessThan(order.indexOf('actionBar'));
    expect(order.indexOf('actionBar')).toBeLessThan(order.indexOf('composer'));
  });

  it('the composer gives its padding: the phone\'s two vars, in the combat moment only', () => {
    const row = LAYOUT_ROWS_BY_ID[id];
    expect(row.momentVars?.combat).toMatchObject({ '--play-composer-pad': 'var(--space-3)', '--play-composer-gap': 'var(--space-4)' });
    expect(Object.keys(row.momentVars?.exploring ?? {})).not.toContain('--play-composer-pad');
  });

  it('positioning off (`unserved`) is a room VALUE with no body and no floor, in the same vocabulary as the rest', () => {
    expect(FACTS.room).toContain('unserved');
    const room = LAYOUT_ROWS_BY_ID[id].factVars!.room as Record<string, Record<string, string>>;
    expect(room.unserved).toEqual({ '--play-body': '0px', '--play-body-floor': '0px' });
    // the board and the band keep their sizes: a fight that authored no board is still a 3-row band
    expect(room.band['--play-body']).toBe('calc(3 * var(--play-cell))');
  });
});

describe('Table: the sheet rail stops at the story log in a fight', () => {
  it('the character sheet is on the stage and log lines only, never beside the action bar or the composer', () => {
    const l = lines(LAYOUT_ROWS_BY_ID.table.areas.combat);
    const sheet = l.map((x, i) => (x.includes('characterBlock') ? i : -1)).filter((i) => i >= 0);
    expect(sheet).toEqual([1, 2, 3]);
    expect(sheet[sheet.length - 1]).toBe(lineOf('table', 'storyLog'));
    expect(l[lineOf('table', 'actionBar')]).toEqual(['partyStrip', 'actionBar', 'actionBar', 'actionBar']);
    expect(l[lineOf('table', 'composer')]).toEqual(['partyStrip', 'composer', 'composer', 'composer']);
  });
});

describe('the stand-in takes no text where the body takes no height', () => {
  const css = fs.readFileSync(path.resolve(process.cwd(), 'src/app/play/[sessionId]/regions/SceneStage.module.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  it('a zero-height body (a size container) removes the stand-in: display none, not a clip (a clipped line is still read aloud)', () => {
    expect(css).toMatch(/@container \(max-height: 0\.5px\)\s*\{\s*\.body \.standIn\s*\{\s*display:\s*none;/);
  });
});
