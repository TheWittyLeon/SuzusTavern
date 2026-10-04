/**
 * B8c-4 P1c, found by Miko-QA and kept under a behaviour name: the Turn order button must come BACK when the band cannot scroll the tracker all the way to its top (a short tracker, or a band whose spare height shows most of it).
 * Real-browser evidence (probe-toggle.mjs at 2ac6dfb, 390x844 with 6 and 5 tracker rows; 360x740 and 430x740 with 3 and 2): press 1 scrolls to the band's end and aria-expanded stays "false"
 * (the tracker is still 39px, not <= 24px, from the band's top); press 2 scrolls nowhere and flips aria-expanded to "true". The second press never returns to the tiles.
 * Red at 2ac6dfb. jsdom has no layout, so the band's scroll range is planted (content 143, box 91: the band can scroll 52px, never the 91 the tracker sits at).
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import PartyStrip from '@/app/play/[sessionId]/regions/PartyStrip';
import { INITIATIVE_TRACKER_ID } from '@/components/InitiativeTracker';
import type { CombatState, Participant } from '@/lib/api/types';

jest.mock('../../components/Toast', () => ({ useToast: () => ({ toast: jest.fn() }) }));
jest.mock('../../lib/api/dnd', () => ({ bindCharacter: jest.fn(), listMyCharacters: jest.fn(() => Promise.resolve([])) }));

const party: Participant[] = [{ username: 'leon', is_dm: false, character: { character_id: 'c1', name: 'Anomaly', char_class: 'Ranger', level: 1, current_hp: 10, max_hp: 10, ac: 13 } }];
const fight = (): CombatState => ({
  combat_id: 'cb', session_id: 's1', round: 2, state: 'active', turn_index: 0, active_participant_id: 'p1', initiative: ['p1', 'w1'],
  participants: [
    { participant_id: 'p1', entity_id: 'c1', name: 'Anomaly', is_pc: true, initiative: 15, hp_current: 10, hp_max: 10, ac: 13, conditions: [], is_alive: true, can_be_targeted: false, is_active_turn: true, took_turn: false },
    { participant_id: 'w1', entity_id: 'g1', name: 'Timberwolf', is_pc: false, initiative: 9, hp_current: 19, hp_max: 19, ac: 13, conditions: [], is_alive: true, can_be_targeted: true, is_active_turn: false, took_turn: false },
  ],
}) as unknown as CombatState;

// Planted before the commit that measures (the cue reads it): the band's content is taller than its box, by 52px.
const sh = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight');
const ch = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight');
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get(this: HTMLElement) { return this.dataset.testid === 'band' ? 143 : 0; } });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get(this: HTMLElement) { return this.dataset.testid === 'band' ? 91 : 0; } });
});
afterAll(() => {
  if (sh) Object.defineProperty(HTMLElement.prototype, 'scrollHeight', sh); else delete (HTMLElement.prototype as unknown as Record<string, unknown>).scrollHeight;
  if (ch) Object.defineProperty(HTMLElement.prototype, 'clientHeight', ch); else delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientHeight;
});

const rect = (top: number) => ({ top, bottom: top + 10, left: 0, right: 10, width: 10, height: 10, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;

describe('a band that can only scroll PART of the way to the tracker', () => {
  it('press 1 reaches the end of the band and says so; press 2 goes back to the tiles', async () => {
    render(
      <div data-testid="band" style={{ overflowY: 'auto' }}>
        <PartyStrip participants={party} selfUsername="leon" combatState={fight()} onSelectMember={() => {}} isDm={false} sessionId="s1" combatIsActive sessionLocked={false} onRebindChanged={() => {}} round={2} selfPcId="p1" variant="strip" />
      </div>,
    );
    const band = screen.getByTestId('band');
    const tracker = document.getElementById(INITIATIVE_TRACKER_ID) as HTMLElement;
    const MAX = 52; // the band's whole scroll range: the tracker (91px down) can only reach 39px from the top
    let st = 0;
    // a browser's scroll event arrives AFTER the click handler returns (async), as here
    const scrollTo = jest.fn((o: ScrollToOptions) => { st = Math.min(MAX, Math.max(0, o.top ?? 0)); setTimeout(() => band.dispatchEvent(new Event('scroll')), 0); });
    const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 5)); });
    Object.defineProperty(band, 'scrollTo', { configurable: true, value: scrollTo });
    Object.defineProperty(band, 'scrollTop', { configurable: true, get: () => st });
    jest.spyOn(band, 'getBoundingClientRect').mockImplementation(() => rect(0));
    jest.spyOn(tracker, 'getBoundingClientRect').mockImplementation(() => rect(91 - st));
    const btn = screen.getByRole('button', { name: 'Turn order' });

    fireEvent.click(btn);
    await settle();
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 91, behavior: 'instant' }); // asked for the tracker; the browser clamps to MAX
    expect(st).toBe(MAX);
    expect(btn).toHaveAttribute('aria-expanded', 'true'); // was "false": the tracker is 39px from the top, not <= 24

    fireEvent.click(btn);
    await settle();
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 0, behavior: 'instant' }); // was: asked for the tracker again
    expect(st).toBe(0);
    expect(btn).toHaveAttribute('aria-expanded', 'false');
  });
});
