/**
 * The desktop combat rows' track CLASSES, pinned per row and per track position (not as one shared literal). Landed from Miko-QA's A10 step 11 fix-round test.
 *
 * Why this exists: mutating Story's body track floor `minmax(var(--play-body-floor,0px),...)` to `minmax(0px,...)` survives all of jest AND the harness (the body element's own
 * `min-height: var(--play-body-floor)` covers it), so nothing said the TRACK carries the floor on Story. The same mutation on Table was red in play-preset-registry. This pins both
 * rows alike, and the floor/size relation of each room value.
 *
 * Classes (presets.ts, "The desktop combat rows' TRACK CLASSES"): WHOLE = max-content, FLOOR = the log, OPTIONAL = the body. The floor is written from the gap token (fix round 2).
 */
import { LAYOUT_ROWS_BY_ID, factVarsFor, type LayoutId } from '@/app/play/[sessionId]/presets';

const WHOLE = 'max-content';
const OPTIONAL = 'minmax(var(--play-body-floor,0px),var(--play-body,0px))';
const FLOOR = /^minmax\(var\(--play-floor,calc\(\d+px \+ 3 \* var\(--density-gap\) \+ \d+px\)\),1fr\)$/;
const BANNER_FLOOR = /^calc\(\d+px \+ 3 \* var\(--density-gap\) \+ \d+px\)$/;

/** Split a grid-template-rows value at top-level spaces (a space inside parentheses is not a track boundary). */
function tracks(value: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of value) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ' ' && depth === 0) { if (cur) out.push(cur); cur = ''; } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

// the combat rows, track by track: [banner, top bar, (Story: scene line,) scene line / body, ...]
const EXPECT: Record<'story' | 'table', string[]> = {
  story: [WHOLE, WHOLE, WHOLE, OPTIONAL, 'FLOOR', WHOLE, WHOLE],
  table: [WHOLE, WHOLE, OPTIONAL, 'FLOOR', WHOLE, WHOLE],
};

describe.each<'story' | 'table'>(['story', 'table'])('%s combat row: every track has its class', (id) => {
  const row = LAYOUT_ROWS_BY_ID[id as LayoutId];
  const got = tracks(row.rows!.combat as string);

  it('has the expected number of tracks', () => {
    expect(got).toHaveLength(EXPECT[id].length);
  });

  it.each(EXPECT[id].map((want, i) => [i, want] as const))('track %i', (i, want) => {
    if (want === 'FLOOR') expect(got[i]).toMatch(FLOOR);
    else expect(got[i]).toBe(want);
  });

  it('gives the combat moment a banner floor the shell yields to (the X-card banner)', () => {
    expect(row.momentVars?.combat?.['--play-banner-floor']).toMatch(BANNER_FLOOR);
  });

  it('each room value: the floor is a whole number of cells, never over the size; a band does not yield; none is 0', () => {
    for (const room of ['board', 'band', 'none'] as const) {
      const v = factVarsFor(row, { room });
      expect(v['--play-body']).toBeDefined();
      expect(v['--play-body-floor']).toBeDefined();
    }
    const board = factVarsFor(row, { room: 'board' });
    const band = factVarsFor(row, { room: 'band' });
    const none = factVarsFor(row, { room: 'none' });
    expect(board['--play-body-floor']).toBe('calc(3 * var(--play-cell))');
    expect(band['--play-body-floor']).toBe(band['--play-body']);
    expect(none['--play-body-floor']).toBe('0px');
    expect(none['--play-body']).toBe('0px');
  });
});
