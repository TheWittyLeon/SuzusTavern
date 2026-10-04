/**
 * B8c-4 P1c fix round 2 (Kage I-1, Tora MAJOR-1 and MINOR-6): the Turn order cue's measurement.
 *   - the answer does not depend on the answer: the button is `display: none` without the frame class, so lifting the class measures a band with NO button in it (stylesheet pin);
 *   - measuring never moves the band: at the framed maximum, a commit that makes the engine clamp `scrollTop` at the forced layout gets the offset handed back;
 *   - it never measures or flips under a finger or in a band that is moving, and does it 150ms after both are quiet;
 *   - a button that is focused when the cue turns off hands focus to the tracker's active row (it would fall to <body>).
 * jsdom has no layout: the band's geometry is planted on the prototype keyed by the band's test id, and the engine's clamp is simulated (reading `scrollHeight` while unframed clamps `scrollTop`).
 */
import fs from 'node:fs';
import path from 'node:path';
import { act, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import PartyStrip from '@/app/play/[sessionId]/regions/PartyStrip';
import { INITIATIVE_TRACKER_ID } from '@/components/InitiativeTracker';
import type { CombatState, Participant } from '@/lib/api/types';

jest.mock('../../components/Toast', () => ({ useToast: () => ({ toast: jest.fn() }) }));
jest.mock('../../lib/api/dnd', () => ({ bindCharacter: jest.fn(), listMyCharacters: jest.fn(() => Promise.resolve([])) }));

const party: Participant[] = [{ username: 'leon', is_dm: false, character: { character_id: 'c1', name: 'Anomaly', char_class: 'Ranger', level: 1, current_hp: 10, max_hp: 10, ac: 13 } }];
const fight = (): CombatState => ({
  combat_id: 'cb', session_id: 's1', round: 2, state: 'active', turn_index: 0, active_participant_id: 'w1', initiative: ['p1', 'w1'],
  participants: [
    { participant_id: 'p1', entity_id: 'c1', name: 'Anomaly', is_pc: true, initiative: 15, hp_current: 10, hp_max: 10, ac: 13, conditions: [], is_alive: true, can_be_targeted: false, is_active_turn: false, took_turn: false },
    { participant_id: 'w1', entity_id: 'g1', name: 'Timberwolf', is_pc: false, initiative: 9, hp_current: 19, hp_max: 19, ac: 13, conditions: [], is_alive: true, can_be_targeted: true, is_active_turn: true, took_turn: false },
  ],
}) as unknown as CombatState;

/** What the band is: content (framed / unframed) against its 91px box; `st` is the engine's scroll offset, clamped to the current maximum. */
const geo = { framed: 300, unframed: 260, st: 0, simulate: false };
const ownSH = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight');
const ownCH = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight');
const ownST = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop');
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
    configurable: true,
    get(this: HTMLElement) {
      if (this.dataset.testid !== 'band') return 0;
      const framed = !!this.querySelector('[data-region="partyStrip"]')?.className.includes('frame');
      const h = framed ? geo.framed : geo.unframed;
      if (geo.simulate) geo.st = Math.min(geo.st, h - 91); // the engine clamps the offset at a layout that has less content
      return h;
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get(this: HTMLElement) { return this.dataset.testid === 'band' ? 91 : 0; } });
  Object.defineProperty(Element.prototype, 'scrollTop', {
    configurable: true,
    get(this: HTMLElement) { return this.dataset?.testid === 'band' && geo.simulate ? geo.st : 0; },
    set(this: HTMLElement, v: number) { if (this.dataset?.testid === 'band' && geo.simulate) geo.st = Math.min(Math.max(0, v), (this.scrollHeight as number) - 91); },
  });
});
afterAll(() => {
  if (ownSH) Object.defineProperty(HTMLElement.prototype, 'scrollHeight', ownSH); else delete (HTMLElement.prototype as unknown as Record<string, unknown>).scrollHeight;
  if (ownCH) Object.defineProperty(HTMLElement.prototype, 'clientHeight', ownCH); else delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientHeight;
  if (ownST) Object.defineProperty(Element.prototype, 'scrollTop', ownST); else delete (Element.prototype as unknown as Record<string, unknown>).scrollTop;
});
beforeEach(() => { geo.framed = 300; geo.unframed = 260; geo.st = 0; geo.simulate = false; });
afterEach(() => { jest.useRealTimers(); });

const tree = () => (
  <div data-testid="band" style={{ overflowY: 'auto' }}>
    <PartyStrip participants={party} selfUsername="leon" combatState={fight()} onSelectMember={() => {}} isDm={false} sessionId="s1" combatIsActive sessionLocked={false} onRebindChanged={() => {}} round={2} selfPcId="p1" variant="strip" />
  </div>
);
const button = () => screen.queryByRole('button', { name: 'Turn order' });

describe('the stylesheet: the button is not in the layout without the frame (the unframed measurement has no button in it)', () => {
  const css = fs.readFileSync(path.resolve(process.cwd(), 'src/components/TurnOrderButton.module.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const rule = (sel: string) => { const at = css.indexOf(`${sel} {`); return at < 0 ? '' : css.slice(at, css.indexOf('}', at)); };
  it('`.button` alone is display: none; `.frame > .button` is what draws it', () => {
    expect(rule('.button')).toMatch(/display:\s*none/);
    expect(rule('.frame > .button')).toMatch(/display:\s*grid/);
  });
  it('forced colours: the pressed state, a tint, gets a 2px border (Iro m-6)', () => {
    const at = css.indexOf('@media (forced-colors: active)');
    expect(at).toBeGreaterThan(-1);
    expect(css.slice(at)).toMatch(/\.frame > \.button\[aria-expanded='true'\]\s*\{[^}]*border-width:\s*2px/);
  });
});

describe('a measurement never moves the band', () => {
  it('at the framed maximum, a commit that makes the engine clamp the offset at the forced layout leaves scrollTop where it was (the mutation: no restore)', () => {
    const view = render(tree());
    expect(button()).toBeInTheDocument();
    geo.simulate = true;
    geo.st = geo.framed - 91; // 209: the band at its framed end, the tracker in view
    view.rerender(tree()); // a poll arrives
    expect(geo.st).toBe(209);
    expect(button()).toBeInTheDocument();
  });
});

describe('under a finger or in a moving band the cue neither measures nor flips; it settles 150 ms after both are quiet', () => {
  it('a finger down: a combatant leaving (the band no longer scrolls) changes nothing until the finger lifts and 150 ms pass', () => {
    jest.useFakeTimers();
    const view = render(tree());
    expect(button()).toBeInTheDocument();
    act(() => { fireEvent.touchStart(document.body, { touches: [{ clientX: 1, clientY: 1 }] }); });
    geo.framed = 91; geo.unframed = 91; // it fits now
    view.rerender(tree());
    expect(button()).toBeInTheDocument();
    act(() => { jest.advanceTimersByTime(1000); });
    expect(button()).toBeInTheDocument();
    act(() => { fireEvent.touchEnd(document.body, { touches: [] }); });
    act(() => { jest.advanceTimersByTime(149); });
    expect(button()).toBeInTheDocument();
    act(() => { jest.advanceTimersByTime(2); });
    expect(button()).toBeNull();
  });

  it('a finger that never reports its end stops holding the gate after the 5 s backstop (the mutation: the count is never reset)', () => {
    jest.useFakeTimers();
    const view = render(tree());
    act(() => { fireEvent.touchStart(document.body, { touches: [{ clientX: 1, clientY: 1 }] }); });
    act(() => { jest.advanceTimersByTime(5001); });
    geo.framed = 91; geo.unframed = 91;
    view.rerender(tree());
    expect(button()).toBeNull();
  });

  it('the band scrolling: a commit inside 150 ms of its last scroll event waits for the quiet (a flick is not cancelled by a lift-and-restore)', () => {
    jest.useFakeTimers();
    const view = render(tree());
    act(() => { fireEvent.scroll(screen.getByTestId('band')); });
    geo.framed = 91; geo.unframed = 91;
    view.rerender(tree());
    expect(button()).toBeInTheDocument();
    act(() => { jest.advanceTimersByTime(151); });
    expect(button()).toBeNull();
  });

  it('a scroll elsewhere on the page (not the band) does not hold it', () => {
    jest.useFakeTimers();
    const view = render(tree());
    act(() => { fireEvent.scroll(document.body); });
    geo.framed = 91; geo.unframed = 91;
    view.rerender(tree());
    expect(button()).toBeNull();
  });
});

describe('the button that is focused when the cue turns off hands focus to the tracker\'s active row', () => {
  it('focus on Turn order, the band stops needing it: focus is on the active row, not <body>', () => {
    const view = render(tree());
    button()!.focus();
    expect(button()).toHaveFocus();
    geo.framed = 91; geo.unframed = 91;
    view.rerender(tree());
    expect(button()).toBeNull();
    expect(document.activeElement).toBe(document.querySelector(`#${INITIATIVE_TRACKER_ID} li[aria-current="true"]`));
  });
});
