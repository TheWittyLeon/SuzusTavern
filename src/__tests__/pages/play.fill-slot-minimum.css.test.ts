/**
 * The play stage's fill slot keeps its automatic minimum height (R51 F3, choice (a); WebKit stale stage height).
 * Two pins:
 *   1. source pin: BOTH fill rules in Play.module.css carry `min-height: auto` (the direct one and the one through a body dock). Each is dead code on one side of a later merge,
 *      so the harness check `stage-height-steps` alone does not hold both.
 *   2. registry guard, derived from the layout rows: a region placed across several row lines with no flexible line among them is a fill slot's tenant, and a fill slot's
 *      lines never have an automatic minimum (so `auto` stays zero by the standard: "no other engine changes"). The tenth row is covered without an edit.
 * Clause 2 keys on the variant name because a data test cannot render; the rendered half is the `data-slot-fill` attribute in the real-page matrix.
 * Control: delete either `min-height: auto` -> reds; give a fill region's row line `auto`, `fit-content()`, a bare `fr` or `minmax(auto, ..)` -> reds.
 */
import fs from 'fs';
import path from 'path';
import { LAYOUT_ROWS, REGION_IDS, getPlacement, type Moment } from '@/app/play/[sessionId]/presets';

const MOMENTS: Moment[] = ['exploring', 'combat'];
const css = fs.readFileSync(path.resolve(process.cwd(), 'src/app/play/[sessionId]/Play.module.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const rule = (selector: string) => css.match(new RegExp(`${selector.replace(/[.[\]()>~'=^$*+?{}|\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`))?.[1] ?? '';

/** Split a track list on top-level spaces (parentheses nest: `minmax(var(--a,calc(1px + 2px)),1fr)` is one track). */
function tracks(list: string): string[] {
  const out: string[] = []; let depth = 0; let cur = '';
  for (const ch of list.trim()) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (/\s/.test(ch) && depth === 0) { if (cur) out.push(cur); cur = ''; } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}
/** The first top-level argument of `minmax(a, b)`, or null. */
function minmaxMin(track: string): string | null {
  if (!track.startsWith('minmax(')) return null;
  let depth = 0; let cur = '';
  for (const ch of track.slice('minmax('.length)) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) return cur.trim();
    cur += ch;
  }
  return null;
}
const flexible = (t: string) => /(^|[\s,(])\d*\.?\d+fr\b/.test(t);
/** CSS Grid 7.2.3 / 6.6: a track whose MIN sizing function is `auto`: `auto`, `fit-content()`, a bare `<flex>`, or `minmax(auto, ...)`. */
const automaticMinimum = (t: string) => t === 'auto' || t.startsWith('fit-content(') || /^\d*\.?\d+fr$/.test(t) || minmaxMin(t) === 'auto';
const areaLines = (areas: string) => [...areas.matchAll(/"([^"]*)"/g)].map((m) => m[1].trim().split(/\s+/));

describe('the fill slot keeps its automatic minimum (WebKit stale stage height)', () => {
  it('BOTH fill rules carry `min-height: auto`: the direct one and the one through a body dock', () => {
    expect(rule('.slot:has(> [data-slot-fill])')).toMatch(/min-height:\s*auto/);
    expect(rule('.slot:has(> [data-has-body] > * > [data-slot-fill])')).toMatch(/min-height:\s*auto/);
    // and the base rule still writes the zero they undo (if it goes, so does the reason for both)
    expect(rule('.slot')).toMatch(/min-height:\s*0/);
  });

  const census: string[] = [];
  for (const row of LAYOUT_ROWS) for (const moment of MOMENTS) {
    const lines = areaLines(row.areas[moment]);
    const rowTracks = tracks(row.rows[moment]);
    it(`${row.id} / ${moment}: one track per area line`, () => { expect(rowTracks).toHaveLength(lines.length); });
    for (const region of REGION_IDS) {
      const p = getPlacement(row, region, moment);
      if (p.area == null || p.anchor != null) continue; // unplaced, or an anchored overlay (content-sized, not stretched)
      const spanned = lines.map((cells, i) => (cells.includes(p.area as string) ? i : -1)).filter((i) => i >= 0).map((i) => rowTracks[i]);
      if (spanned.length < 2) continue;
      const anyFlexible = spanned.some(flexible);
      const fill = region === 'sceneStage' && p.variant === 'hero';
      census.push(`${row.id}/${moment}/${region}: ${spanned.length} lines, ${anyFlexible ? 'flexible' : 'NONE flexible'}${fill ? ', fill' : ''}`);
      it(`${row.id} / ${moment} / ${region}: across ${spanned.length} lines; with no flexible line among them it must be a fill slot`, () => {
        if (!anyFlexible) expect(fill).toBe(true);
      });
      if (fill) it(`${row.id} / ${moment} / ${region}: a fill slot's lines never have an automatic minimum (${spanned.join(' | ')})`, () => {
        expect(spanned.filter(automaticMinimum)).toEqual([]);
      });
    }
  }
  it('the guard looked at fill placements (never green over nothing)', () => {
    expect(census.filter((c) => c.endsWith(', fill')).length).toBeGreaterThan(0);
  });
});
