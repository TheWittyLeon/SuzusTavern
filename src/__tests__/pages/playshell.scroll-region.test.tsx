/**
 * A10 step 11 round 3 (Iro; Aoi's "Which Band Pays", Leon's #54 = `sheet`): Table's character sheet stops at the story log and scrolls inside itself, so its slot is a BOUNDED
 * SCROLLER, and a scroller with no name and no keyboard stop hides its overflow from a keyboard user (WCAG 2.1.1). A placement says `scrolls`; the shell names the slot (a group, never a
 * landmark: the landmark count is a contract) and makes it a stop. Pinned where it is emitted, on the real rows.
 */
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
    expect(slot).toHaveAttribute('aria-label', 'Character sheet');
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
