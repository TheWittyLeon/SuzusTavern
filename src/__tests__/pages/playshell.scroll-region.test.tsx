/**
 * A10 step 11 round 3 (Iro; Aoi's "Which Band Pays", Leon's #54 = `sheet`): Table's character sheet stops at the story log and scrolls inside itself, so its slot is a BOUNDED
 * SCROLLER, and a scroller with no name and no keyboard stop hides its overflow from a keyboard user (WCAG 2.1.1). A placement says `scrolls`; the shell names the slot (a group, never a
 * landmark: the landmark count is a contract) and makes it a stop. Pinned where it is emitted, on the real rows.
 */
import fs from 'node:fs';
import path from 'node:path';
import { render } from '@testing-library/react';
import PlayShell, { SCROLL_REGION_NAMES } from '@/app/play/[sessionId]/PlayShell';
import { LAYOUT_ROWS, LAYOUT_ROWS_BY_ID, REGION_IDS, getPlacement, type LayoutRow, type Moment } from '@/app/play/[sessionId]/presets';

const slotOf = (row: LayoutRow, moment: Moment, region: string) => {
  const regions = Object.fromEntries(REGION_IDS.map((id) => [id, <p key={id}>{id}</p>]));
  const { container } = render(<PlayShell row={row} moment={moment} regions={regions} tenants={{}} />);
  return container.querySelector(`[data-region-slot="${region}"]`) as HTMLElement;
};

describe('a placement that scrolls gives its slot a name and a keyboard stop', () => {
  it.each(['exploring', 'combat'] as const)('Table %s: the character sheet slot is a named group and a tab stop, and not a landmark', (moment) => {
    expect(getPlacement(LAYOUT_ROWS_BY_ID.table, 'characterBlock', moment).scrolls).toBe(true);
    const slot = slotOf(LAYOUT_ROWS_BY_ID.table, moment, 'characterBlock');
    expect(slot).toHaveAttribute('role', 'group');
    expect(slot).toHaveAttribute('aria-label', SCROLL_REGION_NAMES.characterBlock);
    expect(slot).toHaveAttribute('tabindex', '0');
    expect(slot.tagName).toBe('DIV'); // a landmark element would change the page's landmark count
  });

  it('no other placement scrolls, every region that says so has a name, and no slot without the flag gets a stop or a role', () => {
    for (const row of LAYOUT_ROWS) {
      for (const moment of ['exploring', 'combat'] as const) {
        for (const id of REGION_IDS) {
          const p = getPlacement(row, id, moment);
          if (p.scrolls === true) {
            expect(SCROLL_REGION_NAMES[id]).toBeTruthy();
            expect(`${row.id}/${id}`).toBe('table/characterBlock');
          }
        }
      }
    }
    const story = slotOf(LAYOUT_ROWS_BY_ID.story, 'exploring', 'storyLog');
    expect(story).not.toHaveAttribute('role');
    const party = slotOf(LAYOUT_ROWS_BY_ID.table, 'exploring', 'partyStrip');
    expect(party).not.toHaveAttribute('tabindex');
  });
});

describe('round 5: the sheet stop applies in Table COMBAT as well as exploring; the ring is drawn inside the box; the DM-panel story scroller is named', () => {
  it.each(['exploring', 'combat'] as const)('Table %s: the sheet slot says it is a scroll stop (data-scroll-stop), the hook the ring rule reads', (moment) => {
    expect(slotOf(LAYOUT_ROWS_BY_ID.table, moment, 'characterBlock')).toHaveAttribute('data-scroll-stop');
  });

  it('the stylesheet draws a scroll stop\'s ring INSIDE its box (a ring outside it was shaved by the viewport and the grid\'s clip)', () => {
    const css = fs.readFileSync(path.resolve(process.cwd(), 'src/app/play/[sessionId]/Play.module.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const at = css.indexOf(".slot[data-scroll-stop]:focus-visible {");
    expect(at).toBeGreaterThan(-1);
    expect(css.slice(at, css.indexOf('}', at))).toMatch(/outline-offset:\s*calc\(-1 \* var\(--focus-ring-width\)\)/);
  });

  const withDm = (dm: boolean) => {
    const regions = Object.fromEntries(REGION_IDS.map((id) => [id, <p key={id}>{id}</p>]));
    regions.storyLog = <>{dm ? <div data-region="tableControlsDm">dm</div> : null}<p>log</p></>;
    const { container } = render(<PlayShell row={LAYOUT_ROWS_BY_ID.story} moment="combat" regions={regions} tenants={{}} />);
    return container.querySelector('[data-region-slot="storyLog"]') as HTMLElement;
  };
  it('the story slot is a named keyboard stop only while the human DM\'s panel is in it (the one case it scrolls)', () => {
    const on = withDm(true);
    expect(on).toHaveAttribute('tabindex', '0');
    expect(on).toHaveAttribute('aria-label', 'Story and DM controls');
    expect(on).toHaveAttribute('data-scroll-stop');
    expect(on.tagName).toBe('MAIN'); // still the one main landmark
    const off = withDm(false);
    expect(off).toHaveAttribute('tabindex', '-1');
    expect(off).not.toHaveAttribute('aria-label');
    expect(off).not.toHaveAttribute('data-scroll-stop');
  });

  it('one name per role: the scroller is not named like the dock handle ("Character sheet") or the region ("Character sheet: <name>")', () => {
    expect(SCROLL_REGION_NAMES.characterBlock).not.toBe('Character sheet');
    expect(SCROLL_REGION_NAMES.characterBlock?.startsWith('Character sheet:')).toBe(false);
  });
});
