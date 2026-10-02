/**
 * A9d-2 fix round N4 (Tora MAJOR-1, Iro 4; Sora lever brief 2.1 / 2.2) — the stage's encounter block and the outcome chooser, all rows.
 *
 * What is pinned: End combat and Wrap up are SIBLINGS of their role="status" text (never inside a live region), under role-less
 * wrappers; the status nodes are stable across the buttons mounting and unmounting; the chooser is an anchored popover (portalled out of
 * the stage's clip, a named non-modal group) whose focus goes to the first enabled option and returns to the control that opened it
 * ("End combat" or "Wrap up"), or to the scene head when the fight ended. The browser harness (popover-end-chooser legs) is the real pin
 * for geometry; jsdom has none.
 */
import { useRef, useState, type ReactNode } from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import SceneStage from '@/app/play/[sessionId]/regions/SceneStage';

interface Opts { combat?: boolean; allDown?: boolean; anyDown?: boolean; busy?: boolean; encounter?: boolean; variant?: 'inline' | 'panel' | 'hero'; round?: number | null; children?: ReactNode }

const endCalls: string[] = [];

function Stage({ combat = true, allDown = false, anyDown = false, busy = false, encounter = false, variant, round, children }: Opts) {
  const headRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<HTMLButtonElement>(null);
  const beginRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [fightOn, setFightOn] = useState(combat);
  return (
    <div>
      <aside data-region-slot="sceneStage" style={{ overflow: 'auto' }}>
        <SceneStage
          sceneName="The Sundered Hollow"
          objective="Find the source of the tremors."
          sceneHeadRef={headRef}
          combatIsActive={fightOn}
          activeEncounterId={null}
          sceneHasEncounter={encounter}
          combatBusy={busy}
          endCombatBtnRef={endRef}
          outcomeChooserOpen={open}
          setOutcomeChooserOpen={setOpen}
          lastOpenerRef={openerRef}
          allHostilesDown={allDown}
          anyMonsterDown={anyDown}
          onEndCombat={(o) => { endCalls.push(o); setFightOn(false); setOpen(false); }}
          beginCombatRef={beginRef}
          onBeginEncounter={() => {}}
          talking={false}
          sessionLocked={false}
          rollBusy={false}
          variant={variant}
          round={round}
        >
          {children}
        </SceneStage>
      </aside>
    </div>
  );
}

const stage = () => document.querySelector('[data-region="sceneStage"]') as HTMLElement;
const endBtn = () => screen.getByRole('button', { name: /End combat/ });
const wrapBtn = () => screen.getByRole('button', { name: /All enemies are down/ });
const chooser = () => screen.getByRole('group', { name: 'Choose combat outcome' });

beforeEach(() => { endCalls.length = 0; });

describe('the encounter block: buttons are siblings of the live regions, never inside them', () => {
  it('no button lives inside any role="status" node of the stage, with and without all enemies down', () => {
    const { rerender } = render(<Stage />);
    const check = () => {
      const statuses = Array.from(stage().querySelectorAll('[role="status"]'));
      expect(statuses.length).toBeGreaterThan(0);
      for (const st of statuses) expect(st.querySelector('button')).toBeNull();
    };
    check();
    rerender(<Stage allDown anyDown />);
    check();
    expect(stage().querySelectorAll('[role="status"]')).toHaveLength(2);
  });

  it('End combat and the status text share ONE role-less wrapper (no role, no name, no tabindex), the status first; Wrap up and its status likewise', () => {
    render(<Stage allDown anyDown />);
    const wrapperOf = (btn: HTMLElement) => btn.parentElement as HTMLElement;
    for (const [btn, text] of [[endBtn(), /In combat · use the action bar/], [wrapBtn(), /All enemies are down\./]] as const) {
      const w = wrapperOf(btn);
      expect(w).not.toHaveAttribute('role');
      expect(w).not.toHaveAttribute('aria-label');
      expect(w).not.toHaveAttribute('tabindex');
      const status = within(w).getByRole('status');
      expect(status).toHaveTextContent(text);
      expect(status.compareDocumentPosition(btn) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });

  it('copy: the button reads "End combat" and still names itself so; the status text points at the action bar (not the rail in the composer)', () => {
    render(<Stage />);
    expect(endBtn()).toHaveTextContent('End combat');
    expect(endBtn()).toHaveAccessibleName('End combat — choose outcome'); // label-in-name: the name contains the visible text
    expect(screen.getByText(/In combat · use the action bar/)).toBeInTheDocument();
    expect(screen.queryByText(/action rail in the composer/)).toBeNull();
  });

  it('the status node is the SAME DOM node when Wrap up mounts and unmounts, and when the chooser opens and closes (no re-announcement)', () => {
    const { rerender } = render(<Stage />);
    const status = screen.getByText(/In combat · use the action bar/).closest('[role="status"]');
    expect(status).not.toBeNull();
    rerender(<Stage allDown anyDown />);
    expect(screen.getByText(/In combat · use the action bar/).closest('[role="status"]')).toBe(status);
    fireEvent.click(endBtn());
    fireEvent.keyDown(document.activeElement as Element, { key: 'Escape' });
    expect(screen.getByText(/In combat · use the action bar/).closest('[role="status"]')).toBe(status);
    rerender(<Stage />);
    expect(screen.getByText(/In combat · use the action bar/).closest('[role="status"]')).toBe(status);
    rerender(<Stage busy />);
    expect(screen.getByText(/In combat · use the action bar/).closest('[role="status"]')).toBe(status);
  });
});

describe('the outcome chooser: an anchored popover', () => {
  it('is out of the stage\'s clip (portalled to <body>), a named non-modal group, and the opener says so', () => {
    render(<Stage />);
    expect(screen.queryByRole('group', { name: 'Choose combat outcome' })).toBeNull();
    fireEvent.click(endBtn());
    const c = chooser();
    expect(document.querySelector('[data-region="sceneStage"]')?.contains(c)).toBe(false);
    expect(c.parentElement).toBe(document.body);
    expect(c).not.toHaveAttribute('aria-modal');
    expect(c).toHaveAttribute('data-anchored-popover');
    expect(endBtn()).toHaveAttribute('aria-haspopup', 'dialog');
    expect(endBtn()).toHaveAttribute('aria-expanded', 'true');
    expect(endBtn()).toHaveAttribute('aria-controls', c.id);
  });

  it('focus goes to the first ENABLED option: Retreat while Victory is disabled, Victory once an enemy is down', () => {
    const { unmount } = render(<Stage />);
    fireEvent.click(endBtn());
    expect(within(chooser()).getByRole('button', { name: /Victory/ })).toBeDisabled();
    expect(within(chooser()).getByRole('button', { name: /Retreat/ })).toHaveFocus();
    unmount();
    render(<Stage anyDown />);
    fireEvent.click(endBtn());
    expect(within(chooser()).getByRole('button', { name: /Victory/ })).toHaveFocus();
  });

  it('Escape closes it and returns focus to End combat; Cancel does the same; Escape is not delivered to the page', () => {
    render(<Stage />);
    fireEvent.click(endBtn());
    const seen = jest.fn();
    document.addEventListener('keydown', seen);
    fireEvent.keyDown(document.activeElement as Element, { key: 'Escape' });
    document.removeEventListener('keydown', seen);
    expect(screen.queryByRole('group', { name: 'Choose combat outcome' })).toBeNull();
    expect(endBtn()).toHaveFocus();
    fireEvent.click(endBtn());
    fireEvent.click(within(chooser()).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('group', { name: 'Choose combat outcome' })).toBeNull();
    expect(endBtn()).toHaveFocus();
  });

  it('Wrap up opens the SAME chooser and focus returns to Wrap up, not End combat (the opener comes from the activating click)', () => {
    render(<Stage allDown anyDown />);
    fireEvent.click(wrapBtn());
    expect(chooser()).toBeInTheDocument();
    fireEvent.keyDown(document.activeElement as Element, { key: 'Escape' });
    expect(wrapBtn()).toHaveFocus();
    expect(endBtn()).not.toHaveFocus();
  });

  it('while the end-the-fight request is in flight the chooser cannot be dismissed (Escape, an outside click)', () => {
    const { rerender } = render(<Stage />);
    fireEvent.click(endBtn());
    rerender(<Stage busy />);
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    fireEvent.click(document.body);
    expect(chooser()).toBeInTheDocument();
  });

  it('a click outside closes it and is consumed; a click on the X-card style passthrough closes it and is delivered', () => {
    render(<Stage />);
    const delivered = jest.fn();
    const consumed = jest.fn();
    const outside = document.createElement('button');
    outside.textContent = 'Dodge';
    outside.addEventListener('click', consumed);
    const xcard = document.createElement('div');
    xcard.setAttribute('data-popover-passthrough', '');
    const xb = document.createElement('button');
    xb.textContent = 'X-card';
    xb.addEventListener('click', delivered);
    xcard.appendChild(xb);
    document.body.append(outside, xcard);
    fireEvent.click(endBtn());
    fireEvent.click(outside);
    expect(consumed).not.toHaveBeenCalled();
    expect(screen.queryByRole('group', { name: 'Choose combat outcome' })).toBeNull();
    fireEvent.click(endBtn());
    fireEvent.click(xb);
    expect(delivered).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('group', { name: 'Choose combat outcome' })).toBeNull();
    outside.remove();
    xcard.remove();
  });

  it('picking an outcome ends the fight: End combat unmounts, and focus lands on the scene head, never <body>', () => {
    render(<Stage anyDown />);
    fireEvent.click(endBtn());
    act(() => { fireEvent.click(within(chooser()).getByRole('button', { name: /Retreat/ })); });
    expect(endCalls).toEqual(['retreat']);
    expect(screen.queryByRole('button', { name: /End combat/ })).toBeNull();
    expect(document.querySelector('[aria-label^="Scene:"]')).toHaveFocus();
    expect(document.body).not.toHaveFocus();
  });
});

// ── the phone's scene strip (N5, Amendment E.1) ───────────────────────────────────────────────────────────────────────────────────
describe('the scene strip (variant inline)', () => {
  const stage = () => document.querySelector('[data-region="sceneStage"]') as HTMLElement;

  it('stamps its variant; renders no picture, no fold body and no kicker; the head stays the visible, focusable first line', () => {
    render(<Stage variant="inline" combat={false} />);
    expect(stage()).toHaveAttribute('data-variant', 'inline');
    expect(stage().querySelector('[data-fold-body]')).toBeNull();
    expect(stage().textContent).not.toMatch(/tactical map arrives/);
    const head = stage().querySelector('[aria-label^="Scene:"]') as HTMLElement;
    expect(head).toHaveAttribute('tabindex', '-1');
    expect(head).toHaveTextContent('The Sundered Hollow');
    expect(head.querySelector('[aria-hidden]')).toBeNull(); // the "Scene" kicker is not painted in the strip
  });

  it('exploring: the second line is the objective, and there is no status text yet', () => {
    render(<Stage variant="inline" combat={false} />);
    expect(screen.getByText('Find the source of the tremors.')).toBeInTheDocument();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('combat: the status line says the round in an aria-hidden span (the tracker stays the one region that announces it); no round, no span', () => {
    const { unmount } = render(<Stage variant="inline" round={3} />);
    expect(screen.queryByText('Find the source of the tremors.')).toBeNull();
    const status = screen.getByText(/In combat · use the action bar/).closest('[role="status"]') as HTMLElement;
    const round = within(status).getByText(/round 3/);
    expect(round).toHaveAttribute('aria-hidden', 'true');
    unmount();
    render(<Stage variant="inline" round={null} />);
    expect(screen.queryByText(/round/)).toBeNull();
  });

  it('the round is the strip\'s alone: panel and hero do not paint it', () => {
    for (const variant of ['panel', 'hero'] as const) {
      const { unmount } = render(<Stage variant={variant} round={3} />);
      expect(screen.queryByText(/round 3/)).toBeNull();
      unmount();
    }
  });

  it('every encounter button the state calls for is in the strip: "Stand and fight" exploring; "End combat" and "Wrap up" with every enemy down', () => {
    const a = render(<Stage variant="inline" combat={false} encounter />);
    expect(screen.getByRole('button', { name: /Stand and fight/ })).toBeInTheDocument();
    a.unmount();
    render(<Stage variant="inline" allDown anyDown />);
    expect(endBtn()).toBeInTheDocument();
    expect(wrapBtn()).toBeInTheDocument();
  });

  it('with every enemy down the generic "In combat" status is clipped on screen but stays in the tree, unchanged and live, beside the prompt\'s own', () => {
    render(<Stage variant="inline" allDown anyDown />);
    const generic = screen.getByText(/In combat · use the action bar/).closest('[role="status"]') as HTMLElement;
    expect(generic).toHaveAttribute('aria-live', 'polite');
    expect(generic.className).toMatch(/noteClipped/);
    const prompt = screen.getByText(/All enemies are down\./).closest('[role="status"]') as HTMLElement;
    expect(prompt.className).not.toMatch(/noteClipped/);
  });

  // A10 step 11 S2b (named exception: `panel` loses its body and `hero` becomes the scene line plus a body): what each form renders now. The status and
  // button invariants of the file's other tests are asserted again in a `hero` below.
  it('a `panel` renders as it did, minus the body: the kicker and the objective in combat too, and no picture stand-in', () => {
    render(<Stage variant="panel" />);
    expect(stage()).toHaveAttribute('data-variant', 'panel');
    expect(stage()).not.toHaveAttribute('data-slot-fill');
    expect(stage().querySelector('[data-fold-body]')).toBeNull();
    expect(stage().textContent).not.toMatch(/tactical map arrives/);
    expect(stage().textContent).toMatch(/Scene/);
    expect(screen.getByText('Find the source of the tremors.')).toBeInTheDocument();
  });

  // A10 fix round F2 (Kage Tavern 9, third item): "`inline` is unchanged" had no jest pin. Giving the phone's strip `data-slot-fill` passed jest and the 390x844 gate and moved two budget
  // lines by 3px (the slot drops its padding and stops being a scroller): the strip is a whole band that keeps its slot's edges.
  it('an `inline` strip (the phone) does not own its slot\'s edges and has no body: no `data-slot-fill`, no `[data-fold-body]`, no stand-in', () => {
    render(<Stage variant="inline" />);
    expect(stage()).toHaveAttribute('data-variant', 'inline');
    expect(stage()).not.toHaveAttribute('data-slot-fill');
    expect(stage().querySelector('[data-fold-body]')).toBeNull();
    expect(stage().textContent).not.toMatch(/tactical map arrives/);
  });

  it('a `hero` is the scene line, then a body: no kicker, the objective gives way to the status in a fight, the body owns its slot\'s edges', () => {
    render(<Stage variant="hero" />);
    expect(stage()).toHaveAttribute('data-variant', 'hero');
    expect(stage()).toHaveAttribute('data-slot-fill');
    expect(stage().querySelector('[aria-hidden]')?.textContent).not.toBe('Scene');
    expect(screen.queryByText('Find the source of the tremors.')).toBeNull();
    expect(stage().querySelectorAll('[data-fold-body]')).toHaveLength(1);
  });

  it('a `hero` in a fight with no children shows the stand-in, whole, in its body; exploring renders nothing there; children replace it', () => {
    const { unmount } = render(<Stage variant="hero" />);
    expect(stage().querySelector('[data-fold-body]')).toHaveTextContent(/tactical map arrives/);
    unmount();
    const exploring = render(<Stage variant="hero" combat={false} />);
    expect(stage().querySelector('[data-fold-body]')).toBeEmptyDOMElement();
    exploring.unmount();
    render(<Stage variant="hero"><p>the map</p></Stage>);
    expect(stage().querySelector('[data-fold-body]')).toHaveTextContent('the map');
    expect(stage().textContent).not.toMatch(/tactical map arrives/);
  });

  it('the body comes AFTER the encounter block in the DOM, so Tab goes End combat, then the board', () => {
    render(<Stage variant="hero" allDown anyDown />);
    const body = stage().querySelector('[data-fold-body]') as HTMLElement;
    for (const btn of [endBtn(), wrapBtn()]) expect(btn.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('a `hero` keeps the encounter invariants: no button inside a live region, one role-less wrapper per status and button, the status node stable', () => {
    const { rerender } = render(<Stage variant="hero" />);
    for (const st of Array.from(stage().querySelectorAll('[role="status"]'))) expect(st.querySelector('button')).toBeNull();
    const status = screen.getByText(/In combat · use the action bar/).closest('[role="status"]');
    const w = endBtn().parentElement as HTMLElement;
    expect(w).not.toHaveAttribute('role');
    expect(within(w).getByRole('status')).toBe(status);
    rerender(<Stage variant="hero" allDown anyDown />);
    expect(screen.getByText(/In combat · use the action bar/).closest('[role="status"]')).toBe(status);
    expect(stage().querySelectorAll('[role="status"]')).toHaveLength(2);
    expect(wrapBtn().parentElement).not.toHaveAttribute('role');
  });
});
