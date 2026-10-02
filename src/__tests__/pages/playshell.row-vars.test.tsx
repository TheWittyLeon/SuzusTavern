/**
 * Kage A9d-1 S1: nothing in jest pinned PlayShell emitting `row.vars` on `.grid` (removing the spread
 * left 7,867 tests green; only harness geometry noticed). A9d-2 adds `row.momentVars` beside it. Both are
 * how a row hands numbers to Play.module.css, so both are pinned at the emitter.
 */
import { render } from '@testing-library/react';
import PlayShell from '@/app/play/[sessionId]/PlayShell';
import { LAYOUT_ROWS, type LayoutRow, type Moment } from '@/app/play/[sessionId]/presets';

const grid = (row: LayoutRow, moment: Moment) => {
  const { container } = render(<PlayShell row={row} moment={moment} regions={{}} tenants={{}} />);
  return container.querySelector('[data-layout-resolved]') as HTMLElement;
};

describe('PlayShell emits a row\'s custom properties on .grid', () => {
  const phone = LAYOUT_ROWS.find((r) => r.id === 'phone')!;

  it('row.vars: every entry is a custom property on the grid element', () => {
    const el = grid(phone, 'exploring');
    for (const [k, v] of Object.entries(phone.vars!)) expect(el.style.getPropertyValue(k)).toBe(v);
  });

  it('row.momentVars: the moment\'s own value is emitted, and it changes with the moment', () => {
    // A9d-2 N5 (named exception): the exploring floor is re-derived (169 -> 152: the recap measures 46, not 63); the stage's
    // `--play-foldable-reflow-min` is deleted with its fold, so it is emitted by no row any more.
    expect(grid(phone, 'exploring').style.getPropertyValue('--play-banner-floor')).toBe('152px');
    expect(grid(phone, 'combat').style.getPropertyValue('--play-banner-floor')).toBe('136px');
    expect(grid(phone, 'exploring').style.getPropertyValue('--play-foldable-reflow-min')).toBe('');
    expect(grid(phone, 'combat').style.getPropertyValue('--play-foldable-reflow-min')).toBe('');
  });

  it('a row with neither emits only the three track lists', () => {
    // A10 step 11 S2b (re-aimed): the desktop rows now carry `--play-cell` and answer `room`; the claim (no vars, no facts: only the lists) is
    // the same, asserted on Story with both taken away.
    const story = { ...LAYOUT_ROWS.find((r) => r.id === 'story')!, vars: undefined, factVars: undefined, momentVars: undefined } as LayoutRow;
    const el = grid(story, 'exploring');
    const props = Array.from({ length: el.style.length }, (_, i) => el.style.item(i)).sort();
    expect(props).toEqual(['--play-areas', '--play-columns', '--play-rows']);
  });

  it('a moment value wins over the row-wide one of the same name', () => {
    const row = { ...phone, vars: { '--play-x': 'row' }, momentVars: { combat: { '--play-x': 'combat' } } } as LayoutRow;
    expect(grid(row, 'exploring').style.getPropertyValue('--play-x')).toBe('row');
    expect(grid(row, 'combat').style.getPropertyValue('--play-x')).toBe('combat');
  });
});
