/**
 * A9d-2 fix round N9 (Sora lever brief 2.4; Tora MAJOR-3, C4; Iro Major-2) -- the party band's TRAILING column.
 *
 * The roster's non-tile controls sit BESIDE the tile row, never inside the row that scrolls sideways (with six or more tiles a control inside
 * it leaves the screen with them, so it is no longer "at rest"): a player's own "Change character", and the DM's "Session", which opens a
 * popover holding the Session card AND every member's rebind row (they used to be a 542px block ahead of the tiles in a 91px scroller, the DM
 * tiles at y 646 under a band that ended at 180). The browser half (the first tile row whole, the controls 44x44 and whole, at 5, 6 and 8
 * members) is the harness's `u:partyTiles`; the layout rule's text is pinned in party-trailing.css.test.ts.
 *
 * Controls: render the trailing node inside the <ul> -> the first case reds; drop `close` from the session render prop -> the close case reds;
 * return early on an empty roster without the trailing node -> the empty-roster case reds.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import PartyStrip from '@/app/play/[sessionId]/regions/PartyStrip';
import type { Participant } from '@/lib/api/types';

jest.mock('../../components/Toast', () => ({ useToast: () => ({ toast: jest.fn() }) }));
jest.mock('../../lib/api/dnd', () => ({ bindCharacter: jest.fn(), listMyCharacters: jest.fn(() => Promise.resolve([])) }));

const member = (username: string, name: string | null, over: Partial<Participant> = {}): Participant => ({
  username,
  is_dm: false,
  character: name ? { character_id: `c_${username}`, name, char_class: 'Ranger', level: 4, current_hp: 27, max_hp: 34, ac: 16 } : null,
  ...over,
});
const PARTY = [member('kes', 'Kestrel Ashwood'), member('sable', 'Sable Voss'), member('suzu', null, { is_dm: true })];

function strip(over: { isDm?: boolean; participants?: Participant[]; session?: Parameters<typeof PartyStrip>[0]['session'] } = {}) {
  return render(
    <PartyStrip
      participants={over.participants ?? PARTY}
      selfUsername="kes"
      combatState={null}
      onSelectMember={jest.fn()}
      isDm={over.isDm ?? false}
      sessionId="s1"
      combatIsActive={false}
      sessionLocked={false}
      onRebindChanged={jest.fn()}
      round={null}
      selfPcId={null}
      variant="strip"
      session={over.session}
    />,
  );
}
const rebinds = () => screen.getAllByRole('button').filter((b) => /character/i.test(b.getAttribute('aria-label') ?? ''));

describe('a player: their own "Change character" is in the trailing column, outside the tile row', () => {
  it('the button is inside [data-party-trailing], a sibling of the tile <ul> and never inside it', () => {
    const { container } = strip();
    const trailing = container.querySelector('[data-party-trailing]') as HTMLElement;
    const list = container.querySelector('ul[aria-labelledby="party-panel-label"]') as HTMLElement;
    expect(trailing).not.toBeNull();
    expect(list.contains(trailing)).toBe(false);
    expect(trailing.parentElement).toBe(list.parentElement);
    const own = rebinds();
    expect(own).toHaveLength(1);
    expect(trailing.contains(own[0])).toBe(true);
    expect(list.contains(own[0])).toBe(false);
  });

  it('a player has no Session button', () => {
    strip();
    expect(screen.queryByRole('button', { name: /^Session/ })).toBeNull();
  });
});

describe('the DM: a Session button in the trailing column opens a popover with the Session card and every rebind row', () => {
  const session = ({ close }: { close: () => void }) => (
    <div>
      <button type="button" onClick={close}>End session</button>
    </div>
  );

  it('"Session" is a dialog opener in the trailing column; closed, the popover carries no role (jsdom has no stylesheet to hide it)', () => {
    const { container } = strip({ isDm: true, session });
    const btn = screen.getByRole('button', { name: 'Session' });
    expect(container.querySelector('[data-party-trailing]')).toContainElement(btn);
    expect(btn).toHaveAttribute('aria-haspopup', 'dialog');
    expect(btn).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opened, it is a dialog named "Session controls", portalled out of the band, holding the card and one rebind button per member', () => {
    const { container } = strip({ isDm: true, session });
    fireEvent.click(screen.getByRole('button', { name: 'Session' }));
    const dlg = screen.getByRole('dialog', { name: 'Session controls' });
    expect(container.contains(dlg)).toBe(false);
    expect(dlg).not.toHaveAttribute('aria-modal');
    expect(dlg).toContainElement(screen.getByRole('button', { name: 'End session' }));
    expect(rebinds()).toHaveLength(3);
    for (const b of rebinds()) expect(dlg.contains(b)).toBe(true);
  });

  it('the DM has NO rebind button in the band itself: the tiles are the only thing in the row, the Session button the only trailing control', () => {
    const { container } = strip({ isDm: true, session });
    const trailing = container.querySelector('[data-party-trailing]') as HTMLElement;
    expect(trailing.querySelectorAll('button')).toHaveLength(1);
  });

  it('the card can close the popover (End session opens a confirm dialog: a popover left open would swallow its clicks) and focus returns to Session', () => {
    strip({ isDm: true, session });
    fireEvent.click(screen.getByRole('button', { name: 'Session' }));
    fireEvent.click(screen.getByRole('button', { name: 'End session' }));
    expect(screen.getByRole('button', { name: 'Session' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: 'Session' })).toHaveFocus();
  });

  it('the Session button outlives an empty roster: a DM at a table nobody has joined still has the way to the tools', () => {
    strip({ isDm: true, participants: [], session });
    expect(screen.getByRole('button', { name: 'Session' })).toBeInTheDocument();
  });
});
