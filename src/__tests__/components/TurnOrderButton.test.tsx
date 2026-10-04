/**
 * B8c-4 P1c (Sora's phone-mount brief 7.3; Iro C6; Aoi A section 13) — turn order within reach on a phone.
 *   1. the tracker's ACTIVE row is a tab stop (the party band is a scroller; WebKit gives a scroller with nothing focusable no keyboard path), in the strip and the rail alike;
 *   2. the band has a 44px "Turn order" button, only where the tracker is off screen at rest (the phone's strip, a live fight): it scrolls the band to the tracker (instantly) and puts focus on the
 *      active row; pressed again it scrolls back to the tiles. `aria-expanded` is read from the scroll position, so a hand scroll keeps it true. It is DOM-after the tiles, before the tracker.
 * jsdom has no layout: each case plants the band's and the tracker's rects and the band's `scrollTo`; the geometry (44 x 44, five tiles at 390) is the harness's.
 * Controls: tabIndex 0 on every row -> the "only the active row" case reds; the button rendered in the rail -> the "only the strip" case reds; smooth scrolling -> the instant case reds; focus left on the
 * button -> the focus case reds; aria-expanded fixed -> the hand-scroll case reds.
 */
import React from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { act, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import PartyStrip from '@/app/play/[sessionId]/regions/PartyStrip';
import InitiativeTracker, { INITIATIVE_TRACKER_ID } from '@/components/InitiativeTracker';
import type { CombatState, Participant } from '@/lib/api/types';

jest.mock('../../components/Toast', () => ({ useToast: () => ({ toast: jest.fn() }) }));
jest.mock('../../lib/api/dnd', () => ({ bindCharacter: jest.fn(), listMyCharacters: jest.fn(() => Promise.resolve([])) }));

const party: Participant[] = [{ username: 'leon', is_dm: false, character: { character_id: 'c1', name: 'Anomaly', char_class: 'Ranger', level: 1, current_hp: 10, max_hp: 10, ac: 13 } }];
const fight = (active: 'p1' | 'w1' | null = 'w1'): CombatState => ({
  combat_id: 'cb', session_id: 's1', round: 2, state: 'active', turn_index: 0, active_participant_id: active, initiative: ['p1', 'w1'],
  participants: [
    { participant_id: 'p1', entity_id: 'c1', name: 'Anomaly', is_pc: true, initiative: 15, hp_current: 10, hp_max: 10, ac: 13, conditions: [], is_alive: true, can_be_targeted: false, is_active_turn: active === 'p1', took_turn: false },
    { participant_id: 'w1', entity_id: 'g1', name: 'Timberwolf', is_pc: false, initiative: 9, hp_current: 19, hp_max: 19, ac: 13, conditions: [], is_alive: true, can_be_targeted: true, is_active_turn: active === 'w1', took_turn: false },
  ],
}) as unknown as CombatState;

describe('the tracker\'s active row is the band\'s tab stop', () => {
  const rows = (container: HTMLElement) => Array.from(container.querySelectorAll('ol > li'));
  it.each(['rail', 'strip', undefined] as const)('%s: exactly the row with aria-current has tabindex 0', (variant) => {
    const { container } = render(<InitiativeTracker participants={fight('w1').participants} round={2} selfParticipantId="p1" variant={variant} />);
    const r = rows(container);
    expect(r).toHaveLength(2);
    expect(r.filter((li) => li.getAttribute('tabindex') === '0').map((li) => li.getAttribute('aria-current'))).toEqual(['true']);
    // every other row is -1, never absent: a turn change then changes only the value, and a focused row keeps focus (Miko M1; InitiativeTracker.focus-retention.test)
    expect(r.filter((li) => li.getAttribute('aria-current') !== 'true').map((li) => li.getAttribute('tabindex'))).toEqual(['-1']);
  });

  it('no one acting: the FIRST row is the stop (the scroller always has a keyboard path); the legacy shim follows the same rule', () => {
    const { container, rerender } = render(<InitiativeTracker participants={fight(null).participants} round={2} variant="strip" />);
    expect(Array.from(container.querySelectorAll('li')).map((li) => li.getAttribute('tabindex'))).toEqual(['0', '-1']);
    rerender(<InitiativeTracker entries={[{ id: 'a', name: 'A', initiative: 1, kind: 'pc' }, { id: 'b', name: 'B', initiative: 2, kind: 'monster' }]} currentIndex={1} round={1} variant="strip" />);
    expect(Array.from(container.querySelectorAll('li')).map((li) => li.getAttribute('tabindex'))).toEqual(['-1', '0']);
  });

  it('only the phone\'s strip carries the wrapper id the button controls (the desktop rail\'s markup gains the tab stop and nothing else)', () => {
    const strip = render(<InitiativeTracker participants={fight().participants} round={2} variant="strip" />);
    expect(strip.container.querySelector(`#${INITIATIVE_TRACKER_ID}`)).not.toBeNull();
    strip.unmount();
    const rail = render(<InitiativeTracker participants={fight().participants} round={2} variant="rail" />);
    expect(rail.container.querySelector(`#${INITIATIVE_TRACKER_ID}`)).toBeNull();
  });
});

/**
 * jsdom has no layout. The band's own geometry (what `useTurnOrderCue` reads) is planted on the prototype, keyed by the band's test id, BEFORE the commit that measures: `scrolls` is whether the
 * band's content is taller than the band; `framedExtra` is how much taller the content gets while the region carries the frame class (the button's column narrows the tracker).
 */
const band = { scrolls: true, framedExtra: 0 };
const protoScrollHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight');
const protoClientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight');
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
    configurable: true,
    get(this: HTMLElement) {
      if (this.dataset.testid !== 'band') return 0;
      const framed = !!this.querySelector('[data-region="partyStrip"]')?.className.includes('frame');
      return (band.scrolls ? 300 : 91) + (framed ? band.framedExtra : 0);
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get(this: HTMLElement) { return this.dataset.testid === 'band' ? 91 : 0; } });
});
afterAll(() => {
  if (protoScrollHeight) Object.defineProperty(HTMLElement.prototype, 'scrollHeight', protoScrollHeight); else delete (HTMLElement.prototype as unknown as Record<string, unknown>).scrollHeight;
  if (protoClientHeight) Object.defineProperty(HTMLElement.prototype, 'clientHeight', protoClientHeight); else delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientHeight;
});
// The button reads its state from the band's scroll position when it MOUNTS: jsdom's rects are all 0 (a tracker at the band's top), so the tracker starts 120px down unless a case plants otherwise.
const trackerOffset = { current: 120 };
let trackerTop = () => trackerOffset.current;
beforeEach(() => {
  band.scrolls = true; band.framedExtra = 0; trackerOffset.current = 120; trackerTop = () => trackerOffset.current;
  jest.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const top = this.id === INITIATIVE_TRACKER_ID ? trackerTop() : 0;
    return { top, bottom: top + 10, left: 0, right: 10, width: 10, height: 10, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
  });
});
afterEach(() => jest.restoreAllMocks());

function mount(over: { variant?: 'strip' | 'rail'; combatIsActive?: boolean; state?: CombatState | null } = {}) {
  const view = render(
    <div data-testid="band" style={{ overflowY: 'auto' }}>
      <PartyStrip
        participants={party}
        selfUsername="leon"
        combatState={over.state === undefined ? fight() : over.state}
        onSelectMember={() => {}}
        isDm={false}
        sessionId="s1"
        combatIsActive={over.combatIsActive ?? true}
        sessionLocked={false}
        onRebindChanged={() => {}}
        round={2}
        selfPcId="p1"
        variant={over.variant ?? 'strip'}
      />
    </div>,
  );
  return view;
}
const button = () => screen.queryByRole('button', { name: 'Turn order' });

describe('the Turn order button: where it exists', () => {
  it('the phone\'s strip in a live fight: one button, aria-expanded false, controlling the tracker, DOM-after the tiles and before the tracker', () => {
    const { container } = mount();
    const b = button()!;
    expect(b).toBeInTheDocument();
    expect(b).toHaveAttribute('aria-expanded', 'false');
    expect(b).toHaveAttribute('aria-controls', INITIATIVE_TRACKER_ID);
    expect(document.getElementById(INITIATIVE_TRACKER_ID)).not.toBeNull();
    const tile = container.querySelector('ul[aria-labelledby="party-panel-label"] button') as HTMLElement;
    const tracker = document.getElementById(INITIATIVE_TRACKER_ID) as HTMLElement;
    expect(tile.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(b.compareDocumentPosition(tracker) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Turn order' })).toHaveLength(1);
  });

  it.each([
    ['the desktop rail (the tracker is on screen)', { variant: 'rail' as const }],
    ['no fight running', { combatIsActive: false }],
    ['a fight with no combatants', { state: { ...fight(), participants: [] } as CombatState }],
    ['no combat state', { state: null }],
  ])('%s: no button, and the region is not framed', (_n, over) => {
    const { container } = mount(over);
    expect(button()).toBeNull();
    expect(container.querySelector('[data-region="partyStrip"]')?.className ?? '').toBe('');
  });

  it('while it is shown the region root takes the frame class (the 44px column the button owns)', () => {
    const { container } = mount();
    expect(container.querySelector('[data-region="partyStrip"]')?.className).toMatch(/frame/);
  });
});

describe('the Turn order button: only while the band cannot show the tiles and the whole tracker (a button that cannot move anything is not drawn, and its column is not taken)', () => {
  it('a band that does not scroll: no button, no frame class (the tracker keeps its full width)', () => {
    band.scrolls = false;
    const { container } = mount();
    expect(button()).toBeNull();
    expect(container.querySelector('[data-region="partyStrip"]')?.className ?? '').toBe('');
  });

  it('judged on the UNFRAMED band: content that fits unframed but would scroll once the button\'s column narrows the tracker gets no button, whatever came before', () => {
    band.framedExtra = 34; // 412x915: the column grows the tracker 34px
    const view = mount();
    expect(button()).toBeInTheDocument(); // starts scrolling (300 > 91): framed
    band.scrolls = false; // the fight shrinks: unframed it fits (91), framed it would be 125
    view.rerender(
      <div data-testid="band" style={{ overflowY: 'auto' }}>
        <PartyStrip participants={party} selfUsername="leon" combatState={fight('p1')} onSelectMember={() => {}} isDm={false} sessionId="s1" combatIsActive sessionLocked={false} onRebindChanged={() => {}} round={2} selfPcId="p1" variant="strip" />
      </div>,
    );
    expect(button()).toBeNull(); // the mutation (measure the framed band) keeps the button
    expect(view.container.querySelector('[data-region="partyStrip"]')?.className ?? '').toBe('');
  });

  it('a strip with no scroller to measure keeps the button (it never hides on a guess)', () => {
    render(
      <PartyStrip participants={party} selfUsername="leon" combatState={fight()} onSelectMember={() => {}} isDm={false} sessionId="s1" combatIsActive sessionLocked={false} onRebindChanged={() => {}} round={2} selfPcId="p1" variant="strip" />,
    );
    expect(button()).toBeInTheDocument();
  });
});

describe('the Turn order button: its state is the scroll position\'s from the first paint', () => {
  it('a button that mounts on a band already at the tracker says so (aria-expanded true), not the default false', () => {
    trackerOffset.current = 4;
    mount();
    expect(button()).toHaveAttribute('aria-expanded', 'true');
  });
});

describe('the Turn order button: what a press does', () => {
  let scrollTo: jest.Mock;
  /** The band's rect at y 0 and the tracker's at `trackerTop`; the band's own scrollTop. */
  function plant(top: { current: number }) {
    const band = screen.getByTestId('band');
    scrollTo = jest.fn();
    Object.defineProperty(band, 'scrollTo', { configurable: true, value: scrollTo });
    Object.defineProperty(band, 'scrollTop', { configurable: true, value: 0, writable: true });
    trackerTop = () => top.current; // the prototype mock above answers for the tracker only: it is `top.current` down, the band is at 0
    return band;
  }
  afterEach(() => jest.restoreAllMocks());

  it('scrolls the band to the tracker, instantly, and puts focus on the ACTIVE row; aria-expanded becomes true', () => {
    mount();
    const top = { current: 120 };
    plant(top);
    fireEvent.click(button()!);
    expect(scrollTo).toHaveBeenCalledWith({ top: 120, behavior: 'instant' });
    expect(document.activeElement).toBe(document.querySelector('li[aria-current="true"]'));
    expect(button()).toHaveAttribute('aria-expanded', 'true');
  });

  it('pressed again (the tracker at the band\'s top): scrolls back to the tiles and the button keeps focus', () => {
    mount();
    const top = { current: 120 };
    plant(top);
    fireEvent.click(button()!);
    top.current = 0; // the band is now at the tracker
    fireEvent.click(button()!);
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 0, behavior: 'instant' });
    expect(button()).toHaveAttribute('aria-expanded', 'false');
    expect(button()).toHaveFocus();
  });

  it('aria-expanded follows a HAND scroll: true when the tracker is at the band\'s top, false when the tiles are back', () => {
    mount();
    const top = { current: 120 };
    const band = plant(top);
    expect(button()).toHaveAttribute('aria-expanded', 'false');
    top.current = 6;
    act(() => { fireEvent.scroll(band); });
    expect(button()).toHaveAttribute('aria-expanded', 'true');
    top.current = 79;
    act(() => { fireEvent.scroll(band); });
    expect(button()).toHaveAttribute('aria-expanded', 'false');
  });

  it('with no one acting the first row takes focus (never <body>)', () => {
    mount({ state: fight(null) });
    plant({ current: 120 });
    fireEvent.click(button()!);
    expect(document.activeElement).toBe(document.querySelector('#' + INITIATIVE_TRACKER_ID + ' li'));
  });
});

describe('TurnOrderButton.module.css: the frame, and a sticky 44 x 44 target', () => {
  const css = fs.readFileSync(path.resolve(process.cwd(), 'src/components/TurnOrderButton.module.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const rule = (sel: string) => { const at = css.indexOf(`${sel} {`); return at < 0 ? '' : css.slice(at, css.indexOf('}', at)); };
  it('the frame is the content column and a 44px column; the button is column 2 over both rows', () => {
    expect(rule('.frame')).toMatch(/grid-template-columns:\s*minmax\(0, 1fr\) 44px/);
    expect(rule('.frame > *')).toMatch(/grid-column:\s*1/);
    expect(rule('.frame > .button')).toMatch(/grid-column:\s*2/);
    expect(rule('.frame > .button')).toMatch(/grid-row:\s*1 \/ span 2/);
  });
  it('the button is 44 x 44, sticky (it stays where the thumb found it while the band scrolls) and touch-action: manipulation', () => {
    const b = rule('.frame > .button');
    expect(b).toMatch(/width:\s*44px/);
    expect(b).toMatch(/height:\s*44px/);
    expect(b).toMatch(/position:\s*sticky/);
    expect(b).toMatch(/touch-action:\s*manipulation/);
  });
  it('a row that hides nothing does not scroll or fade: in the framed band the end padding and the edge fade belong to a row that hides a tile (the "+N" cue is drawn exactly then); the plain strip keeps both', () => {
    const plain = rule(".frame [data-variant='strip'] ul[aria-labelledby='party-panel-label']");
    expect(plain).toMatch(/padding-right:\s*0/);
    expect(plain).toMatch(/mask-image:\s*none/);
    const hides = rule(".frame [data-variant='strip']:has(> [data-party-more]) ul[aria-labelledby='party-panel-label']");
    expect(hides).toMatch(/padding-right:\s*16px/);
    expect(hides).toMatch(/mask-image:\s*linear-gradient\(to right, var\(--ink\) calc\(100% - 16px\), transparent\)/);
    // the plain strip is untouched: PartyPanel's own rule still pads and fades, and the framed rules are the only ones that name `.frame`
    const party = fs.readFileSync(path.resolve(process.cwd(), 'src/components/PartyPanel.module.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const list = party.slice(party.indexOf('.strip .list {'), party.indexOf('}', party.indexOf('.strip .list {')));
    expect(list).toMatch(/padding:\s*var\(--party-label-h\) 16px 0 0/);
    expect(list).toMatch(/mask-image:\s*linear-gradient/);
    expect(party).not.toMatch(/\.frame/);
  });

  it('the active row\'s focus ring is drawn INSIDE the row (the band is a scroller that clips an outward ring)', () => {
    const t = fs.readFileSync(path.resolve(process.cwd(), 'src/components/InitiativeTracker.module.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const at = t.indexOf('.entry:focus-visible {');
    expect(at).toBeGreaterThan(-1);
    expect(t.slice(at, t.indexOf('}', at))).toMatch(/outline-offset:\s*calc\(-1 \* var\(--focus-ring-width\)\)/);
  });
});
