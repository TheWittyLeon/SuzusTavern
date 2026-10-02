/**
 * A9d-2 fix round QA (Miko, 2026-10-02) -- pins for what a consumer of `useAnchoredPopover` must keep doing that no suite pinned.
 * Each case was found by MUTATING THE CONSUMER (not the hook) and watching the whole jest tree stay green:
 *
 *   1. SceneStage's opener memory. `pop.recordOpener(e)` on "End combat" survived deletion: End combat is the hook's default opener (the
 *      anchor), so the one-shot cases cannot tell. The record matters in a SEQUENCE: Wrap up opens the chooser (the shared opener ref now
 *      names Wrap up), it is dismissed, End combat opens it, it is dismissed: focus must return to End combat, not to the stale Wrap up.
 *   2. The Session popover stays MOUNTED while closed (`keepMounted`): the DM's Award XP / gold / campaign-floor forms keep their state and
 *      their live regions across a close. `keepMounted: false` survived.
 *   3. The Session popover's height cap (`maxHeight`, 360px): without it the 540px card opens to the room below the party band and covers
 *      the composer and the verbs, so a tap on a verb (Tora C1's "dismissing press must not activate it") has nothing to land on.
 *      Removing the consumer's `maxHeight` option survived; the browser leg `popover-session:tap-verb` is the other pin.
 */
import { useRef, useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import SceneStage from '@/app/play/[sessionId]/regions/SceneStage';
import PartyStrip from '@/app/play/[sessionId]/regions/PartyStrip';
import type { Participant } from '@/lib/api/types';

jest.mock('../../components/Toast', () => ({ useToast: () => ({ toast: jest.fn() }) }));
jest.mock('../../lib/api/dnd', () => ({ bindCharacter: jest.fn(), listMyCharacters: jest.fn(() => Promise.resolve([])) }));

function Stage() {
  const headRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<HTMLButtonElement>(null);
  const beginRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <aside data-region-slot="sceneStage">
      <SceneStage
        sceneName="The Sundered Hollow"
        objective={null}
        sceneHeadRef={headRef}
        combatIsActive
        activeEncounterId={null}
        sceneHasEncounter={false}
        combatBusy={false}
        endCombatBtnRef={endRef}
        outcomeChooserOpen={open}
        setOutcomeChooserOpen={setOpen}
        lastOpenerRef={openerRef}
        allHostilesDown
        anyMonsterDown
        onEndCombat={() => setOpen(false)}
        beginCombatRef={beginRef}
        onBeginEncounter={() => {}}
        talking={false}
        sessionLocked={false}
        rollBusy={false}
        variant="inline"
      />
    </aside>
  );
}
const endBtn = () => screen.getByRole('button', { name: /End combat/ });
const wrapBtn = () => screen.getByRole('button', { name: /All enemies are down/ });
const escape = () => fireEvent.keyDown(document.activeElement as Element, { key: 'Escape' });

describe('SceneStage: focus returns to the control that opened the chooser, in a SEQUENCE of both openers', () => {
  it('Wrap up opens and is dismissed, then End combat opens and is dismissed: focus is on End combat, not on the stale Wrap up', () => {
    render(<Stage />);
    fireEvent.click(wrapBtn());
    escape();
    expect(wrapBtn()).toHaveFocus(); // control: the first leg returns to Wrap up
    fireEvent.click(endBtn());
    escape();
    expect(endBtn()).toHaveFocus();
    expect(wrapBtn()).not.toHaveFocus();
  });

  it('and the other way round: End combat, then Wrap up', () => {
    render(<Stage />);
    fireEvent.click(endBtn());
    escape();
    expect(endBtn()).toHaveFocus();
    fireEvent.click(wrapBtn());
    escape();
    expect(wrapBtn()).toHaveFocus();
  });
});

const member = (username: string, name: string | null, over: Partial<Participant> = {}): Participant => ({
  username,
  is_dm: false,
  character: name ? { character_id: `c_${username}`, name, char_class: 'Ranger', level: 4, current_hp: 27, max_hp: 34, ac: 16 } : null,
  ...over,
});

function Card() {
  // A card with state of its own, as GrantCurrencyPanel / CampaignFloorPanel have: a typed amount and a note announcer.
  const [amount, setAmount] = useState('');
  return (
    <div>
      <input aria-label="Amount" value={amount} onChange={(e) => setAmount(e.target.value)} />
      <div role="status" data-testid="card-announcer">{amount ? `Ready: ${amount}` : ''}</div>
    </div>
  );
}

function strip() {
  return render(
    <PartyStrip
      participants={[member('kes', 'Kestrel Ashwood'), member('suzu', null, { is_dm: true })]}
      selfUsername="suzu"
      combatState={null}
      onSelectMember={jest.fn()}
      isDm
      sessionId="s1"
      combatIsActive={false}
      sessionLocked={false}
      onRebindChanged={jest.fn()}
      round={null}
      selfPcId={null}
      variant="strip"
      session={() => <Card />}
    />,
  );
}

describe('the DM Session popover: kept mounted while closed', () => {
  it('a value typed into the card, and its announcer, survive a close and a reopen (the card is not remounted)', () => {
    strip();
    fireEvent.click(screen.getByRole('button', { name: 'Session' }));
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '250' } });
    expect(screen.getByTestId('card-announcer')).toHaveTextContent('Ready: 250');
    const announcer = screen.getByTestId('card-announcer');
    escape();
    // closed: the popover is hidden by a class in a browser, and still in the tree here (keepMounted), with its state
    expect(screen.getByLabelText('Amount')).toHaveValue('250');
    expect(screen.getByTestId('card-announcer')).toBe(announcer);
    fireEvent.click(screen.getByRole('button', { name: 'Session' }));
    expect(screen.getByLabelText('Amount')).toHaveValue('250');
  });
});

describe('the DM Session popover: no taller than 360px, so it cannot cover the composer and the verbs', () => {
  const proto = HTMLElement.prototype;
  const restore: Array<() => void> = [];
  const patch = (name: string, get: (el: HTMLElement) => number) => {
    const original = Object.getOwnPropertyDescriptor(proto, name);
    Object.defineProperty(proto, name, { configurable: true, get() { return get(this as HTMLElement); } });
    restore.push(() => { if (original) Object.defineProperty(proto, name, original); else delete (proto as unknown as Record<string, unknown>)[name]; });
  };
  const rectSpy = jest.spyOn(Element.prototype, 'getBoundingClientRect');
  afterEach(() => { while (restore.length) restore.pop()!(); rectSpy.mockReset(); });

  it('a 540px card under a 700px-tall room is placed with max-height 360px (the consumer\'s cap), not the 600-odd px of room', () => {
    Object.defineProperty(document.documentElement, 'clientHeight', { configurable: true, value: 844 });
    patch('scrollHeight', (el) => (el.hasAttribute('data-anchored-popover') ? 540 : 0));
    patch('offsetWidth', (el) => (el.hasAttribute('data-anchored-popover') ? 300 : 0));
    rectSpy.mockImplementation(function (this: Element) {
      // the Session button sits at the top of the screen, in the party band; nothing else has a box
      const isSession = this instanceof HTMLButtonElement && /^\s*Session/.test(this.textContent ?? '');
      return (isSession ? { left: 290, right: 380, top: 100, bottom: 144, width: 90, height: 44, x: 290, y: 100, toJSON() {} } : { left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON() {} }) as DOMRect;
    });
    strip();
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Session' })); });
    const pop = document.querySelector('[data-anchored-popover]') as HTMLElement;
    expect(pop).toHaveAttribute('data-placement', 'bottom'); // 688px of room below the button, 540 wanted, 360 allowed
    expect(pop.style.maxHeight).toBe('360px');
    delete (document.documentElement as unknown as Record<string, unknown>).clientHeight;
  });
});
