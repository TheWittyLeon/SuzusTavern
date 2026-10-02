/**
 * TacticalMap — tactical map (#12), design pass v1 (Aoi-UI). Standalone
 * component (Lane D, 2026-09-28 runbook) — not mounted anywhere yet.
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import TacticalMap, { type TacticalMapProps } from '@/components/tactical-map/TacticalMap';
import styles from '@/components/tactical-map/TacticalMap.module.css';
import type { CombatParticipantState, CombatSpace } from '@/lib/api/types';

function makeSpace(overrides: Partial<CombatSpace> = {}): CombatSpace {
  return {
    kind: 'square',
    width: 5,
    height: 5,
    cell: { value: 5, unit: 'ft' },
    blocked: [],
    features: [],
    ...overrides,
  };
}

function makeParticipant(overrides: Partial<CombatParticipantState> = {}): CombatParticipantState {
  return {
    participant_id: 'p1',
    entity_id: 'char-1',
    name: 'Bren',
    is_pc: true,
    initiative: 15,
    hp_current: 20,
    hp_max: 20,
    ac: 15,
    conditions: [],
    is_alive: true,
    can_be_targeted: true,
    is_active_turn: false,
    took_turn: false,
    at: null,
    movement_remaining: null,
    ...overrides,
  };
}

function baseProps(overrides: Partial<TacticalMapProps> = {}): TacticalMapProps {
  return {
    space: makeSpace(),
    participants: [],
    viewerParticipantId: 'p1',
    activeParticipantId: 'p1',
    moveMode: false,
    onMove: jest.fn(),
    onExitMove: jest.fn(),
    ...overrides,
  };
}

describe('TacticalMap — rendering from space', () => {
  it('renders a gridcell for every space.blocked coordinate as "Blocked"', () => {
    render(<TacticalMap {...baseProps({ space: makeSpace({ blocked: [[1, 1]] }) })} />);
    expect(screen.getByRole('gridcell', { name: 'Row 2, column 2. Blocked. Not reachable.' })).toBeInTheDocument();
  });

  it('renders a decorative marker for every space.features entry, titled with its label', () => {
    const { container } = render(
      <TacticalMap
        {...baseProps({
          space: makeSpace({
            features: [{ id: 'brazier', kind: 'prop', label: 'Brazier', at: [[0, 0]] }],
          }),
        })}
      />,
    );
    expect(container.querySelector('[title="Brazier"]')).toBeInTheDocument();
  });

  it('renders a token at every placed participant\'s `at`, with team-appropriate styling', () => {
    const participants = [
      makeParticipant({ participant_id: 'p1', name: 'Bren', is_pc: true, at: [0, 0] }),
      makeParticipant({ participant_id: 'p2', name: 'Sable', is_pc: true, at: [1, 0] }),
      makeParticipant({ participant_id: 'p3', name: 'Goblin', is_pc: false, at: [2, 0] }),
    ];
    const { container } = render(
      <TacticalMap {...baseProps({ participants, viewerParticipantId: 'p1' })} />,
    );
    const tokens = container.querySelectorAll(`.${styles.token}`);
    expect(tokens).toHaveLength(3);

    const selfToken = container.querySelector(`.${styles.tokenSelf}`);
    expect(selfToken).toHaveTextContent('B');

    const allyToken = container.querySelector(`.${styles.tokenAlly}`);
    expect(allyToken).toHaveTextContent('S');

    const foeToken = container.querySelector(`.${styles.tokenFoe}`);
    expect(foeToken).toHaveTextContent('G');
  });

  it('shows an unplaced participant (`at: null`) nowhere on the board', () => {
    const participants = [
      makeParticipant({ participant_id: 'p1', name: 'Bren', at: [0, 0] }),
      makeParticipant({ participant_id: 'p4', name: 'Waitlisted', at: null }),
    ];
    render(<TacticalMap {...baseProps({ participants })} />);
    expect(screen.queryByText('Waitlisted')).not.toBeInTheDocument();
    // Confirmed the participant contributes no token at all, not merely an
    // invisible one — the roster's own name text never appears anywhere,
    // including inside any aria-label (queryByText covers accessible text
    // nodes; grid cell aria-labels are checked separately in the a11y unit
    // tests since jsdom's accessible-name computation for custom ARIA roles
    // is not exercised by getByText).
  });
});

describe('TacticalMap — no `space`', () => {
  it('renders nothing when there is no space and no participants (not in combat)', () => {
    const { container } = render(<TacticalMap {...baseProps({ space: null, participants: [] })} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the theatre-of-mind band when combat is active but the encounter authored no space', () => {
    const participants = [
      makeParticipant({ participant_id: 'p1', name: 'Bren', hp_current: 18, hp_max: 24 }),
      makeParticipant({ participant_id: 'p2', name: 'Goblin', is_pc: false, hp_current: 7, hp_max: 7 }),
    ];
    render(<TacticalMap {...baseProps({ space: null, participants })} />);
    expect(screen.getByRole('list', { name: 'Combatants' })).toBeInTheDocument();
    expect(screen.getByText('Bren')).toBeInTheDocument();
    expect(screen.getByText('18/24')).toBeInTheDocument();
    expect(screen.getByText('Goblin')).toBeInTheDocument();
    // No grid at all in this state.
    expect(screen.queryByRole('grid')).not.toBeInTheDocument();
  });
});

describe('TacticalMap — reach robustness on the ACTIVE participant', () => {
  it('renders no in-range cells when the active participant\'s movement_remaining is null', () => {
    const participants = [
      makeParticipant({ participant_id: 'p1', name: 'Bren', at: [2, 2], movement_remaining: null }),
    ];
    const { container } = render(
      <TacticalMap
        {...baseProps({ participants, activeParticipantId: 'p1', moveMode: true })}
      />,
    );
    expect(container.querySelectorAll(`.${styles.cellInRange}`)).toHaveLength(0);
    // No crash: the actor's own token still renders normally.
    expect(container.querySelector(`.${styles.tokenSelf}`)).toBeInTheDocument();
  });

  it('does not crash and shows no reach when the active participant is unplaced (`at: null`)', () => {
    const participants = [
      makeParticipant({ participant_id: 'p1', name: 'Bren', at: null, movement_remaining: 30 }),
      makeParticipant({ participant_id: 'p2', name: 'Sable', at: [1, 1] }),
    ];
    const { container } = render(
      <TacticalMap
        {...baseProps({ participants, activeParticipantId: 'p1', moveMode: true })}
      />,
    );
    expect(container.querySelectorAll(`.${styles.cellInRange}`)).toHaveLength(0);
    // The grid itself still renders (this is a robustness case, not a
    // theatre-of-mind fallback — `space` is present).
    expect(screen.getByRole('grid')).toBeInTheDocument();
  });

  it('a participant whose `at` is outside the board bounds never renders a token and never throws', () => {
    const participants = [
      makeParticipant({ participant_id: 'p1', name: 'Bren', at: [0, 0] }),
      makeParticipant({ participant_id: 'p9', name: 'OffGrid', at: [99, 99] }),
    ];
    expect(() =>
      render(<TacticalMap {...baseProps({ participants })} />),
    ).not.toThrow();
    expect(screen.queryByText('OffGrid')).not.toBeInTheDocument();
  });

  it('Kage-CR D1 CRITICAL-1: a space with `blocked`/`features` OMITTED (legal, unstamped content — B3/Miko re-confirmed the validator never backfills `[]`) never throws and renders zero blocked cells', () => {
    // Cast through unknown, mirroring what the wire can actually deliver —
    // the B6 CombatSpace type claims these arrays always-present, but the
    // authoring-time validator accepts the key being absent entirely.
    const rawSpace = {
      kind: 'square',
      width: 3,
      height: 3,
      cell: { value: 5, unit: 'ft' },
      // blocked/features deliberately absent
    } as unknown as CombatSpace;
    const participants = [makeParticipant({ participant_id: 'p1', name: 'Bren', at: [0, 0] })];
    let container!: HTMLElement;
    expect(() => {
      ({ container } = render(
        <TacticalMap {...baseProps({ space: rawSpace, participants })} />,
      ));
    }).not.toThrow();
    expect(container.querySelectorAll(`.${styles.cellBlocked}`)).toHaveLength(0);
    expect(screen.getByRole('grid')).toBeInTheDocument();
  });

  it('Kage-CR D1 IMPORTANT-1: a non-square `space.kind` falls back to the theatre-of-mind band instead of a wrong grid', () => {
    // Cast through unknown — SpaceKind is a 'square'-only literal union
    // today (M6); this simulates the wire actually delivering a future
    // kind before this mirror has learned to draw it.
    const hexSpace = {
      kind: 'hex',
      width: 3,
      height: 3,
      cell: { value: 5, unit: 'ft' },
      blocked: [],
      features: [],
    } as unknown as CombatSpace;
    const participants = [makeParticipant({ participant_id: 'p1', name: 'Bren', hp_current: 10, hp_max: 10 })];
    render(<TacticalMap {...baseProps({ space: hexSpace, participants })} />);
    expect(screen.queryByRole('grid')).not.toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Combatants' })).toBeInTheDocument();
  });
});

describe('TacticalMap — no second aria-live announcer', () => {
  it('the rendered board carries no aria-live attribute anywhere in its tree', () => {
    const participants = [
      makeParticipant({ participant_id: 'p1', name: 'Bren', at: [2, 2], conditions: ['prone'] }),
    ];
    const { container } = render(
      <TacticalMap {...baseProps({ participants, moveMode: true })} />,
    );
    expect(container.querySelectorAll('[aria-live]')).toHaveLength(0);
  });

  it('the theatre-of-mind band also carries no aria-live attribute anywhere', () => {
    const participants = [makeParticipant({ participant_id: 'p1', name: 'Bren' })];
    const { container } = render(
      <TacticalMap {...baseProps({ space: null, participants })} />,
    );
    expect(container.querySelectorAll('[aria-live]')).toHaveLength(0);
  });
});

describe('TacticalMap — T1: reach overlay visible to ALL', () => {
  // B8c-3 M1 (named exception in the brief's commit plan): T1 is carried by `showReach` now (the overlay without the interaction: an observer's seat), not by `moveMode`,
  // which may be true only for the seat that controls the active turn. TacticalMap.window.test.tsx pins the rest of it (what `showReach` does and does not do).
  it('shows the ACTIVE participant\'s reach even when the viewer is a different participant', () => {
    const participants = [
      makeParticipant({ participant_id: 'p1', name: 'Bren', at: [2, 2], movement_remaining: 5 }),
      makeParticipant({ participant_id: 'p2', name: 'Sable', at: [4, 4], movement_remaining: 5 }),
    ];
    // Viewer is p2 (a spectator this turn); the active mover is p1.
    render(
      <TacticalMap
        {...baseProps({ participants, viewerParticipantId: 'p2', activeParticipantId: 'p1', moveMode: false, showReach: true })}
      />,
    );
    // Neighbor of p1's [2,2]: drawn in the overlay (`showReach`), with no range language in its name (nobody is choosing a move).
    expect(
      screen.getByRole('gridcell', { name: 'Row 2, column 2. Empty.' }),
    ).toHaveClass(styles.cellInRange);
    expect(
      screen.getByRole('gridcell', { name: 'Row 1, column 1. Empty.' }),
    ).not.toHaveClass(styles.cellInRange); // two squares away: outside a 5 ft budget
  });
});

describe('TacticalMap — T2: condition badge shows the worst condition only', () => {
  it('the visual badge carries only the worst condition\'s initial; the full list is on the cell name and token title', () => {
    const participants = [
      makeParticipant({
        participant_id: 'p1',
        name: 'Bren',
        at: [0, 0],
        conditions: ['prone', 'unconscious'],
      }),
    ];
    const { container } = render(<TacticalMap {...baseProps({ participants })} />);
    const badge = container.querySelector(`.${styles.conditionBadge}`);
    expect(badge).toHaveTextContent('U'); // "unconscious" outranks "prone"

    const token = container.querySelector(`.${styles.token}`);
    // "full list ... on focus/tap" — invisible is excluded (own disclosure).
    expect(token).toHaveAttribute('title', 'Prone, Unconscious');

    expect(
      screen.getByRole('gridcell', { name: /Conditions: Prone, Unconscious\./ }),
    ).toBeInTheDocument();
  });
});

describe('TacticalMap — T3: invisible-but-shown is distinct', () => {
  it('an invisible participant still renders at its true `at`, with a dashed/eye-badge treatment', () => {
    const participants = [
      makeParticipant({
        participant_id: 'p2',
        name: 'Goblin',
        is_pc: false,
        at: [3, 1],
        conditions: ['invisible'],
      }),
    ];
    const { container } = render(<TacticalMap {...baseProps({ participants })} />);
    const token = container.querySelector(`.${styles.token}`);
    expect(token).toHaveClass(styles.tokenInvisible);
    expect(container.querySelector(`.${styles.eyeBadge}`)).toBeInTheDocument();
    // Kage-CR D1 IMPORTANT-6(b): "invisible" was excluded from
    // `otherConditions` but NOT from the `worstCondition` call, so an
    // invisible-ONLY token got both the eye badge AND a redundant
    // conditionBadge for the same fact. T2 is "one badge per token".
    expect(container.querySelector(`.${styles.conditionBadge}`)).not.toBeInTheDocument();
    expect(
      screen.getByRole('gridcell', { name: 'Row 2, column 4. Goblin, hostile, invisible. Occupied — can\'t stop here.' }),
    ).toBeInTheDocument();
  });
});

describe('TacticalMap — dead creatures (Kage-CR D1 IMPORTANT-8, coordinator decision 3)', () => {
  it('a dead participant (`is_alive: false`) renders with the distinct tokenDead treatment, never as an ordinary live foe', () => {
    const participants = [
      makeParticipant({ participant_id: 'p1', name: 'Bren', at: [0, 0] }),
      makeParticipant({
        participant_id: 'p9',
        name: 'Corpse',
        is_pc: false,
        at: [1, 0],
        hp_current: 0,
        is_alive: false,
      }),
    ];
    const { container } = render(<TacticalMap {...baseProps({ participants })} />);
    const tokens = container.querySelectorAll(`.${styles.token}`);
    const deadToken = Array.from(tokens).find((t) => t.classList.contains(styles.tokenDead));
    expect(deadToken).toBeDefined();
    expect(deadToken).toHaveClass(styles.tokenFoe);
    // Mutually exclusive with "downed" (isDowned requires is_alive).
    expect(deadToken).not.toHaveClass(styles.tokenDowned);
  });

  it('a live, undamaged participant never carries the tokenDead class', () => {
    const participants = [makeParticipant({ participant_id: 'p1', name: 'Bren', at: [0, 0] })];
    const { container } = render(<TacticalMap {...baseProps({ participants })} />);
    expect(container.querySelector(`.${styles.tokenDead}`)).not.toBeInTheDocument();
  });
});

describe('TacticalMap — downed participants (D1b item D, Kage-CR re-verify)', () => {
  it("a downed participant's (`hp_current: 0`, `is_alive: true`) gridcell accessible name discloses \"downed\"", () => {
    // Root cause this pins: describeOccupant computed `downed` but never
    // threaded it into the `cellOccupant` object cellAccessibleName reads —
    // the field existed nowhere on the wire from render to a11y.ts, so no
    // unit test on cellAccessibleName alone could have caught the gap.
    const participants = [
      makeParticipant({
        participant_id: 'p1',
        name: 'Bren',
        at: [0, 0],
        hp_current: 0,
        is_alive: true,
      }),
    ];
    render(<TacticalMap {...baseProps({ participants, viewerParticipantId: 'p9' })} />);
    expect(
      screen.getByRole('gridcell', { name: "Row 1, column 1. Bren, ally, downed. Occupied — can't stop here." }),
    ).toBeInTheDocument();
  });

  it('a downed participant\'s token carries the tokenDowned class (D1b item C: was unpinned — the only prior reference was a `not.toHaveClass` on a DIFFERENT, dead, token)', () => {
    // .tokenDowned's faded/dashed/red-ring treatment (design §5) is ONE
    // class, not a separate ring class (TacticalMap.module.css: the red
    // ring is `.tokenDowned`'s own `box-shadow`, not a second selector) —
    // this single positive assertion covers the whole visual contract.
    const participants = [
      makeParticipant({ participant_id: 'p1', name: 'Bren', at: [0, 0], hp_current: 0, is_alive: true }),
    ];
    const { container } = render(<TacticalMap {...baseProps({ participants })} />);
    const token = container.querySelector(`.${styles.token}`);
    expect(token).toHaveClass(styles.tokenDowned);
  });
});

describe('TacticalMap — T4: the board follows the active token each turn (B8c-3 M1: keep-in-view, not centring)', () => {
  // Named exception in the brief's commit plan (M1: "the T4 centring case, rewritten for keep-in-view"). T4 was ruled for the phone: centre on the active token every
  // turn. On the desktop a centring rule hops board 1110 a row each time the turn passes between row 0 and row 4, and Iro-A11y approved keep-in-view in its place: a token
  // already wholly in the window scrolls nothing, otherwise the fewest whole squares on the axis that needs it. What still holds from Tora-Gesture MAJOR-1: scrollIntoView()
  // walks EVERY scrollable ancestor including the page (the phone vertical-jump trap), so it is NEVER called and the scroll lands on .boardScroll's OWN scrollLeft/scrollTop,
  // computed from getBoundingClientRect (mocked here since jsdom does no real layout). TacticalMap.window.test.tsx and follow.test.ts pin the rule itself (every axis, the
  // clamp, the in-view no-op, the same function for focus); this case keeps T4's own scenario (the once-per-turn guard is pinned in the window suite, with a control: a token already in view cannot show it).
  function mockRect(el: Element, rect: { left: number; top: number; width: number; height: number }) {
    jest.spyOn(el, 'getBoundingClientRect').mockReturnValue({
      ...rect,
      right: rect.left + rect.width,
      bottom: rect.top + rect.height,
      x: rect.left,
      y: rect.top,
      toJSON() {
        return rect;
      },
    } as DOMRect);
  }

  it('scrolls only the boardScroll container (never scrollIntoView) to center the active token', () => {
    const participants = [
      makeParticipant({ participant_id: 'p1', name: 'Bren', at: [0, 0] }),
      makeParticipant({ participant_id: 'p2', name: 'Sable', at: [4, 4] }),
    ];
    const scrollIntoViewSpy = jest.spyOn(Element.prototype, 'scrollIntoView');
    const { container, rerender } = render(
      <TacticalMap {...baseProps({ participants, activeParticipantId: 'p1' })} />,
    );
    const boardScroll = container.querySelector(`.${styles.boardScroll}`) as HTMLElement;
    const cells = container.querySelectorAll('[role="gridcell"]');
    const p1Cell = cells[0] as HTMLElement; // [0,0] — first cell, row-major
    const p2Cell = cells[24] as HTMLElement; // [4,4] — last cell of a 5x5 board

    // A 200x200 window over a 440x440 board; p2's cell (x 400..440) sits well outside it. The fewest whole 40px squares that bring it inside are 240 on each axis (400 + 40
    // - 200), which is also the end of the board (440 - 200): the follow lands at the edge, not at the centre (320) the old rule scrolled to.
    mockRect(boardScroll, { left: 0, top: 0, width: 200, height: 200 });
    for (const [prop, value] of [['clientWidth', 200], ['clientHeight', 200], ['scrollWidth', 440], ['scrollHeight', 440]] as const) {
      Object.defineProperty(boardScroll, prop, { configurable: true, value });
    }
    mockRect(p1Cell, { left: 0, top: 0, width: 40, height: 40 });
    mockRect(p2Cell, { left: 400, top: 400, width: 40, height: 40 });
    boardScroll.scrollLeft = 0;
    boardScroll.scrollTop = 0;

    // Turn changes to p2 -> the window follows by the minimum, scoped to the container only.
    rerender(<TacticalMap {...baseProps({ participants, activeParticipantId: 'p2' })} />);
    expect(boardScroll.scrollLeft).toBe(240);
    expect(boardScroll.scrollTop).toBe(240);
    expect(scrollIntoViewSpy).not.toHaveBeenCalled();
    scrollIntoViewSpy.mockRestore();
  });
});

describe('TacticalMap — click-driven roving focus (Tora MAJOR-2) feeds the scene line', () => {
  // Re-aimed (named exception, brief M1): the inspector strip is gone; the same fact reaches the mount as the `onInspect` payload.
  it('a click on an occupied cell (tap = choose a cell) reports that cell to onInspect, even outside Move mode', () => {
    const onInspect = jest.fn();
    const participants = [
      makeParticipant({ participant_id: 'p1', name: 'Bren', at: [0, 0] }),
      makeParticipant({ participant_id: 'p2', name: 'Goblin', is_pc: false, at: [1, 0] }),
    ];
    render(<TacticalMap {...baseProps({ participants, viewerParticipantId: 'p1', onInspect })} />);
    expect(onInspect).not.toHaveBeenCalled();
    const goblinCell = screen.getByRole('gridcell', { name: /Goblin, hostile\./ });
    fireEvent.click(goblinCell);
    expect(onInspect).toHaveBeenLastCalledWith(
      expect.objectContaining({ kind: 'cell', input: expect.objectContaining({ occupant: expect.objectContaining({ name: 'Goblin', hostile: true }) }) }),
    );
  });
});

describe('TacticalMap — keyboard flow', () => {
  it('arrow keys move the roving tabindex, Enter submits onMove with the focused coordinate, Escape exits', () => {
    const onMove = jest.fn();
    const onExitMove = jest.fn();
    const participants = [makeParticipant({ participant_id: 'p1', name: 'Bren', at: [2, 2], movement_remaining: 10 })];
    const { container } = render(
      <TacticalMap
        {...baseProps({ participants, activeParticipantId: 'p1', moveMode: true, onMove, onExitMove })}
      />,
    );

    // Focus enters the grid at the actor's own cell on Move engage.
    const startCell = screen.getByRole('gridcell', { name: /Bren — you\. Current position\./ });
    expect(startCell).toHaveAttribute('tabindex', '0');
    // Roving tabindex: across the WHOLE 5x5=25-cell board, exactly one
    // cell is tabbable at a time — not just the two named cells below.
    expect(container.querySelectorAll('[role="gridcell"][tabindex="0"]')).toHaveLength(1);
    // Kage-CR D1 IMPORTANT-4: the roving-focus .focus() call was unpinned —
    // deleting it left all 62 pre-existing tests green. Pin actual DOM
    // focus, not just the tabindex model.
    expect(document.activeElement).toBe(startCell);

    fireEvent.keyDown(startCell, { key: 'ArrowRight' });
    const nextCell = screen.getByRole('gridcell', { name: /Row 3, column 4\./ }); // [3,2] -> row3,col4
    expect(nextCell).toHaveAttribute('tabindex', '0');
    expect(startCell).toHaveAttribute('tabindex', '-1');
    expect(container.querySelectorAll('[role="gridcell"][tabindex="0"]')).toHaveLength(1);
    expect(document.activeElement).toBe(nextCell);

    fireEvent.keyDown(nextCell, { key: 'Enter' });
    expect(onMove).toHaveBeenCalledWith([3, 2]);

    fireEvent.keyDown(nextCell, { key: 'Escape' });
    expect(onExitMove).toHaveBeenCalledTimes(1);
  });

  it('Tora-Gesture MAJOR-2: a click syncs the roving-tabindex model to the clicked cell, not just the actor\'s own cell', () => {
    const participants = [makeParticipant({ participant_id: 'p1', name: 'Bren', at: [2, 2], movement_remaining: 10 })];
    const { container } = render(
      <TacticalMap {...baseProps({ participants, activeParticipantId: 'p1', moveMode: true })} />,
    );
    const startCell = screen.getByRole('gridcell', { name: /Current position/ });
    expect(startCell).toHaveAttribute('tabindex', '0');

    const otherCell = screen.getByRole('gridcell', { name: /Row 1, column 1\./ }); // [0,0] — an empty, out-of-range cell
    fireEvent.click(otherCell);

    // Without the fix, focusedCoord (and therefore the tabindex model)
    // never moves off the actor's cell after a click.
    expect(otherCell).toHaveAttribute('tabindex', '0');
    expect(startCell).toHaveAttribute('tabindex', '-1');
    expect(container.querySelectorAll('[role="gridcell"][tabindex="0"]')).toHaveLength(1);
  });

  it('Tora-Gesture CRIT-1 / Kage-CR IMPORTANT-3: Escape in Move mode consumes the event (stopPropagation), so it never reaches an ancestor overlay listener', () => {
    const onExitMove = jest.fn();
    const outerHandler = jest.fn();
    const participants = [makeParticipant({ participant_id: 'p1', name: 'Bren', at: [0, 0] })];
    render(
      // Simulates /play's document-level Award-XP fallback listener — the
      // exact leak escapeConsume.ts's own header documents recurring 4x.
      <div onKeyDown={outerHandler}>
        <TacticalMap {...baseProps({ participants, activeParticipantId: 'p1', moveMode: true, onExitMove })} />
      </div>,
    );
    const cell = screen.getByRole('gridcell', { name: /Current position/ });
    fireEvent.keyDown(cell, { key: 'Escape' });
    expect(onExitMove).toHaveBeenCalledTimes(1);
    expect(outerHandler).not.toHaveBeenCalled();
  });

  it('does not submit a move for an out-of-range or blocked cell', () => {
    const onMove = jest.fn();
    const participants = [makeParticipant({ participant_id: 'p1', name: 'Bren', at: [0, 0], movement_remaining: 5 })];
    render(
      <TacticalMap
        {...baseProps({
          space: makeSpace({ blocked: [[1, 0]] }),
          participants,
          activeParticipantId: 'p1',
          moveMode: true,
          onMove,
        })}
      />,
    );
    const startCell = screen.getByRole('gridcell', { name: /Current position/ });
    // Two cells right: out of the 1-cell (5ft) budget AND behind a blocked
    // cell either way.
    fireEvent.keyDown(startCell, { key: 'ArrowRight' }); // -> [1,0], blocked
    fireEvent.keyDown(screen.getByRole('gridcell', { name: /Row 1, column 2\./ }), { key: 'Enter' });
    expect(onMove).not.toHaveBeenCalled();
  });

  it('Escape is a no-op outside move mode', () => {
    const onExitMove = jest.fn();
    const participants = [makeParticipant({ participant_id: 'p1', name: 'Bren', at: [0, 0] })];
    render(
      <TacticalMap {...baseProps({ participants, activeParticipantId: 'p1', moveMode: false, onExitMove })} />,
    );
    const cell = screen.getByRole('gridcell', { name: /Current position/ });
    fireEvent.keyDown(cell, { key: 'Escape' });
    expect(onExitMove).not.toHaveBeenCalled();
  });
});

describe('TacticalMap — the scene line payload (was: the inspector strip, coordinator decision 4; the strip is gone, B8c-3 M1)', () => {
  // Re-aimed (named exceptions, brief M1): each strip case now asserts the same fact on the `onInspect` payload. TacticalMap.window.test.tsx pins the trigger (the chosen
  // square, with or without focus) and every payload kind; inspectLine.test.ts pins the words (`buildLine`).
  const lastLine = (fn: jest.Mock) => fn.mock.calls[fn.mock.calls.length - 1]?.[0];

  it('reports nothing when no creature is chosen and the active participant has no budget or square (the old "No creature selected." placeholder is not a line)', () => {
    const onInspect = jest.fn();
    // No active participant -> focusedCoord's initial value is [0,0] (activeAt ?? [0,0]), which nobody occupies here.
    const participants = [makeParticipant({ participant_id: 'p1', name: 'Bren', at: [4, 4] })];
    render(<TacticalMap {...baseProps({ participants, activeParticipantId: null, onInspect })} />);
    expect(onInspect).not.toHaveBeenCalled();
    expect(screen.queryByText('No creature selected.')).not.toBeInTheDocument();
  });

  it('carries the focused occupant\'s name, side and FULL condition list — not just the worst badge', () => {
    const onInspect = jest.fn();
    const participants = [
      makeParticipant({
        participant_id: 'p1',
        name: 'Bren',
        at: [0, 0],
        conditions: ['prone', 'unconscious'],
      }),
    ];
    render(<TacticalMap {...baseProps({ participants, activeParticipantId: 'p1', moveMode: true, onInspect })} />);
    // Move mode: the line is the move target, and the cursor starts on Bren's own square, so the payload is its CellNameInput.
    const occupant = lastLine(onInspect).input.occupant;
    expect(occupant).toMatchObject({ name: 'Bren', isSelf: true });
    // Both conditions, not just "worst" — the full-list half Tora-Gesture's MAJOR-3 asked for, unlike the token's own badge.
    expect(occupant.otherConditions).toEqual(['Prone', 'Unconscious']);
  });

  it('carries Downed / Dead state distinctly', () => {
    const onInspect = jest.fn();
    const participants = [
      makeParticipant({ participant_id: 'p1', name: 'Bren', at: [0, 0], hp_current: 0, is_alive: true }),
    ];
    render(<TacticalMap {...baseProps({ participants, activeParticipantId: 'p1', moveMode: true, onInspect })} />);
    expect(lastLine(onInspect).input.occupant).toMatchObject({ downed: true, dead: false });
  });

  it('carries no aria-live attribute — a visual convenience, not a second announcement channel', () => {
    const participants = [makeParticipant({ participant_id: 'p1', name: 'Bren', at: [0, 0] })];
    const { container } = render(
      <TacticalMap {...baseProps({ participants, activeParticipantId: 'p1', moveMode: true })} />,
    );
    expect(container.querySelectorAll('[aria-live]')).toHaveLength(0);
  });
});

describe('TacticalMap — never reads terrain/tactics/position', () => {
  it('a participant carrying DM-only tactics/position text never reaches the DOM in any form', () => {
    const secretTactics = 'DM-SECRET-TACTICS-falls back toward the tunnel';
    const secretPosition = 'DM-SECRET-POSITION-behind the bar';
    const participants: CombatParticipantState[] = [
      {
        ...makeParticipant({ participant_id: 'p2', name: 'Bandit', is_pc: false, at: [0, 0] }),
        tactics: secretTactics,
        position: secretPosition,
      },
    ];
    const { container } = render(<TacticalMap {...baseProps({ participants })} />);
    expect(container.innerHTML).not.toContain(secretTactics);
    expect(container.innerHTML).not.toContain(secretPosition);
  });

  it('TacticalMapProps has no `terrain` field — the component structurally cannot accept CombatState.terrain', () => {
    // Compile-time guarantee, asserted at runtime for the record: the props
    // type only accepts `CombatSpace` (which itself has no `terrain` key),
    // never a full `CombatState`. See TacticalSpace's own type import above.
    const props = baseProps();
    expect('terrain' in props).toBe(false);
    expect(props.space && 'terrain' in props.space).toBe(false);
  });
});

describe('TacticalMap — B8c-1 IMP-5: occupancy excludes the dead (engine parity)', () => {
  // Mover p1 at [2,2], movement_remaining 10 on a 5ft-cell board -> a
  // 2-cell (10ft) Chebyshev budget. [2,1] is one cell away (5ft), always
  // within budget regardless of which fixture below occupies it.
  it("a dead placed participant's cell IS in the reach overlay and a click on it calls onMove", () => {
    const onMove = jest.fn();
    const participants = [
      makeParticipant({ participant_id: 'p1', name: 'Bren', at: [2, 2], movement_remaining: 10 }),
      makeParticipant({
        participant_id: 'p9',
        name: 'Corpse',
        is_pc: false,
        at: [2, 1],
        hp_current: 0,
        is_alive: false,
      }),
    ];
    render(
      <TacticalMap
        {...baseProps({ participants, activeParticipantId: 'p1', moveMode: true, onMove })}
      />,
    );
    const corpseCell = screen.getByRole('gridcell', { name: /Corpse, hostile, dead\./ });
    expect(corpseCell).toHaveClass(styles.cellInRange);
    fireEvent.click(corpseCell);
    expect(onMove).toHaveBeenCalledWith([2, 1]);
  });

  it("a dead placed participant's cell also accepts Enter, not just a click", () => {
    const onMove = jest.fn();
    const participants = [
      makeParticipant({ participant_id: 'p1', name: 'Bren', at: [2, 2], movement_remaining: 10 }),
      makeParticipant({
        participant_id: 'p9',
        name: 'Corpse',
        is_pc: false,
        at: [2, 1],
        hp_current: 0,
        is_alive: false,
      }),
    ];
    render(
      <TacticalMap
        {...baseProps({ participants, activeParticipantId: 'p1', moveMode: true, onMove })}
      />,
    );
    fireEvent.keyDown(screen.getByRole('gridcell', { name: /Current position/ }), {
      key: 'ArrowUp',
    }); // [2,2] -> [2,1], the corpse's cell
    fireEvent.keyDown(screen.getByRole('gridcell', { name: /Corpse, hostile, dead\./ }), {
      key: 'Enter',
    });
    expect(onMove).toHaveBeenCalledWith([2, 1]);
  });

  it('negative control: a LIVING occupant\'s cell is still refused', () => {
    const onMove = jest.fn();
    const participants = [
      makeParticipant({ participant_id: 'p1', name: 'Bren', at: [2, 2], movement_remaining: 10 }),
      makeParticipant({ participant_id: 'p2', name: 'Sable', is_pc: true, at: [2, 1] }),
    ];
    render(
      <TacticalMap
        {...baseProps({ participants, activeParticipantId: 'p1', moveMode: true, onMove })}
      />,
    );
    const allyCell = screen.getByRole('gridcell', { name: /Sable, ally\./ });
    expect(allyCell).not.toHaveClass(styles.cellInRange);
    fireEvent.click(allyCell);
    expect(onMove).not.toHaveBeenCalled();
  });

  it('a downed-but-alive occupant (0 HP, `is_alive: true`) is still refused — the engine keys occupancy on is_active, not HP', () => {
    const onMove = jest.fn();
    const participants = [
      makeParticipant({ participant_id: 'p1', name: 'Bren', at: [2, 2], movement_remaining: 10 }),
      makeParticipant({
        participant_id: 'p2',
        name: 'Sable',
        is_pc: true,
        at: [2, 1],
        hp_current: 0,
        is_alive: true,
      }),
    ];
    render(
      <TacticalMap
        {...baseProps({ participants, activeParticipantId: 'p1', moveMode: true, onMove })}
      />,
    );
    const downedCell = screen.getByRole('gridcell', { name: /Sable, ally, downed\./ });
    expect(downedCell).not.toHaveClass(styles.cellInRange);
    fireEvent.click(downedCell);
    expect(onMove).not.toHaveBeenCalled();
  });

  it('the mover may always occupy (move onto the reach computation from) its own cell — unaffected by the is_alive filter', () => {
    // Regression guard: the mover's own cell is excluded from `placed`'s
    // "others" set by the participant_id check, never by is_alive — a live
    // mover must not accidentally start filtering itself out too.
    const participants = [
      makeParticipant({ participant_id: 'p1', name: 'Bren', at: [2, 2], movement_remaining: 10 }),
    ];
    const { container } = render(
      <TacticalMap {...baseProps({ participants, activeParticipantId: 'p1', moveMode: true })} />,
    );
    // The mover's own token still renders normally (not treated as a stray
    // "occupied" entry that crashes or hides itself).
    expect(container.querySelector(`.${styles.tokenSelf}`)).toBeInTheDocument();
  });
});


describe('TacticalMap — B8c-1 IMP-9b: moveSubmitting gates a second onMove', () => {
  function submittingProps(overrides: Partial<TacticalMapProps> = {}) {
    const participants = [
      makeParticipant({ participant_id: 'p1', name: 'Bren', at: [2, 2], movement_remaining: 10 }),
    ];
    return baseProps({
      participants,
      activeParticipantId: 'p1',
      moveMode: true,
      moveSubmitting: true,
      ...overrides,
    });
  }

  it('a click on an in-range cell does not call onMove while submitting', () => {
    const onMove = jest.fn();
    render(<TacticalMap {...submittingProps({ onMove })} />);
    const target = screen.getByRole('gridcell', { name: /Row 2, column 3\./ }); // [2,1]
    fireEvent.click(target);
    expect(onMove).not.toHaveBeenCalled();
  });

  it('Enter on the focused in-range cell does not call onMove while submitting', () => {
    const onMove = jest.fn();
    render(<TacticalMap {...submittingProps({ onMove })} />);
    const startCell = screen.getByRole('gridcell', { name: /Current position/ });
    fireEvent.keyDown(startCell, { key: 'ArrowUp' }); // focus -> [2,1]
    fireEvent.keyDown(screen.getByRole('gridcell', { name: /Row 2, column 3\./ }), {
      key: 'Enter',
    });
    expect(onMove).not.toHaveBeenCalled();
  });

  it('the same click works again once moveSubmitting flips back to false', () => {
    const onMove = jest.fn();
    const { rerender } = render(<TacticalMap {...submittingProps({ onMove })} />);
    const target = screen.getByRole('gridcell', { name: /Row 2, column 3\./ });
    fireEvent.click(target);
    expect(onMove).not.toHaveBeenCalled();

    rerender(<TacticalMap {...submittingProps({ onMove, moveSubmitting: false })} />);
    fireEvent.click(screen.getByRole('gridcell', { name: /Row 2, column 3\./ }));
    expect(onMove).toHaveBeenCalledWith([2, 1]);
  });

  it('keyboard focus stays on the same cell across the submitting flip (never lost or moved)', () => {
    const { rerender } = render(<TacticalMap {...submittingProps()} />);
    const startCell = screen.getByRole('gridcell', { name: /Current position/ });
    fireEvent.keyDown(startCell, { key: 'ArrowUp' });
    const focused = screen.getByRole('gridcell', { name: /Row 2, column 3\./ });
    expect(document.activeElement).toBe(focused);

    rerender(<TacticalMap {...submittingProps({ moveSubmitting: false })} />);
    expect(document.activeElement).toBe(focused);
    expect(focused).toHaveAttribute('tabindex', '0');

    rerender(<TacticalMap {...submittingProps({ moveSubmitting: true })} />);
    expect(document.activeElement).toBe(focused);
  });

  it('aria-busy is set on the grid while submitting, and absent otherwise', () => {
    const { rerender } = render(<TacticalMap {...submittingProps()} />);
    expect(screen.getByRole('grid')).toHaveAttribute('aria-busy', 'true');

    rerender(<TacticalMap {...submittingProps({ moveSubmitting: false })} />);
    expect(screen.getByRole('grid')).not.toHaveAttribute('aria-busy');
  });

  it('aria-disabled is set on in-range move targets while submitting, and absent otherwise (and never on out-of-range cells)', () => {
    // A 10x10 board (vs. the 5x5 default) so there's a cell genuinely out of
    // the 10ft/2-cell budget from [2,2] — on the default 5x5 board every
    // cell is within 2 Chebyshev cells of the center, so none would qualify.
    const { rerender } = render(
      <TacticalMap {...submittingProps({ space: makeSpace({ width: 10, height: 10 }) })} />,
    );
    const target = screen.getByRole('gridcell', { name: /Row 2, column 3\./ }); // [2,1], in range
    const outOfRange = screen.getByRole('gridcell', { name: /Row 10, column 10\./ }); // [9,9], out of range
    expect(target).toHaveAttribute('aria-disabled', 'true');
    expect(outOfRange).not.toHaveAttribute('aria-disabled');

    rerender(<TacticalMap {...submittingProps({ moveSubmitting: false })} />);
    expect(screen.getByRole('gridcell', { name: /Row 2, column 3\./ })).not.toHaveAttribute(
      'aria-disabled',
    );
  });

  it('an in-range cell carries the visual pending treatment (cellPending) only while submitting', () => {
    const { rerender } = render(<TacticalMap {...submittingProps()} />);
    expect(screen.getByRole('gridcell', { name: /Row 2, column 3\./ })).toHaveClass(
      styles.cellPending,
    );

    rerender(<TacticalMap {...submittingProps({ moveSubmitting: false })} />);
    expect(screen.getByRole('gridcell', { name: /Row 2, column 3\./ })).not.toHaveClass(
      styles.cellPending,
    );
  });

  it('the Space key also submits a legal target (not just Enter)', () => {
    const onMove = jest.fn();
    const participants = [
      makeParticipant({ participant_id: 'p1', name: 'Bren', at: [2, 2], movement_remaining: 10 }),
    ];
    render(
      <TacticalMap
        {...baseProps({ participants, activeParticipantId: 'p1', moveMode: true, onMove })}
      />,
    );
    const startCell = screen.getByRole('gridcell', { name: /Current position/ });
    fireEvent.keyDown(startCell, { key: 'ArrowUp' }); // focus -> [2,1]
    fireEvent.keyDown(screen.getByRole('gridcell', { name: /Row 2, column 3\./ }), { key: ' ' });
    expect(onMove).toHaveBeenCalledWith([2, 1]);
  });

  it('the Space key is also inert while submitting — same guard as Enter/click, proven by pairing with the baseline above', () => {
    // Paired with the previous test on purpose: without a passing baseline
    // showing Space DOES submit outside this state, a "Space is a no-op
    // while submitting" assertion alone can't tell "gated by moveSubmitting"
    // apart from "Space was never wired to attemptMove at all".
    const onMove = jest.fn();
    render(<TacticalMap {...submittingProps({ onMove })} />);
    const startCell = screen.getByRole('gridcell', { name: /Current position/ });
    fireEvent.keyDown(startCell, { key: 'ArrowUp' }); // focus -> [2,1]
    fireEvent.keyDown(screen.getByRole('gridcell', { name: /Row 2, column 3\./ }), { key: ' ' });
    expect(onMove).not.toHaveBeenCalled();
  });

  it('aria-busy stays keyed to moveSubmitting alone, decoupled from moveMode — and no cell is aria-disabled or cellPending when moveMode is false even though moveSubmitting is true', () => {
    // The prop docs are explicit that a caller may exit the Move-picking UI
    // (moveMode: false) before its own in-flight /move settles — pending
    // and picking are two independent flags, not one. This pins the actual
    // decoupled behaviour rather than leaving it an unexercised combination.
    const participants = [
      makeParticipant({ participant_id: 'p1', name: 'Bren', at: [2, 2], movement_remaining: 10 }),
    ];
    const { container } = render(
      <TacticalMap
        {...baseProps({
          participants,
          activeParticipantId: 'p1',
          moveMode: false,
          moveSubmitting: true,
        })}
      />,
    );
    expect(screen.getByRole('grid')).toHaveAttribute('aria-busy', 'true');
    expect(container.querySelectorAll('[aria-disabled]')).toHaveLength(0);
    expect(container.querySelectorAll(`.${styles.cellPending}`)).toHaveLength(0);
  });
});

describe('TacticalMap — B8c-1 Miko-QA break-it pass', () => {
  it('consumer-level pin: a reachable dead occupant\'s cell accessible name reads as a reach destination end-to-end, never "Occupied" (closes a mutation survivor — reverting a11y.ts\'s dead-branch fix left every TacticalMap.test.tsx assertion on this fixture green, because they only regex-match the occupant description, never the full reach-vs-occupied suffix)', () => {
    const onMove = jest.fn();
    const participants = [
      makeParticipant({ participant_id: 'p1', name: 'Bren', at: [2, 2], movement_remaining: 10 }),
      makeParticipant({
        participant_id: 'p9',
        name: 'Corpse',
        is_pc: false,
        at: [2, 1],
        hp_current: 0,
        is_alive: false,
      }),
    ];
    render(
      <TacticalMap
        {...baseProps({ participants, activeParticipantId: 'p1', moveMode: true, onMove })}
      />,
    );
    const corpseCell = screen.getByRole('gridcell', {
      name: 'Row 2, column 3. Corpse, hostile, dead. In range — costs 5 feet.',
    });
    expect(corpseCell.getAttribute('aria-label')).not.toMatch(/Occupied/);
  });

  it('an ACTIVE participant who is themselves dead does not crash reach computation, is excluded from its own reach as a target, and reach still resolves correctly for other cells', () => {
    // Leon's item 1: "does the self/active exclusion still hold when the
    // active participant is itself dead?" Self-exclusion is a
    // participant_id match (never gated on is_alive), so it holds
    // regardless — this pins that as observable behaviour, not just code
    // reading, and proves the rest of reach math tolerates a dead mover
    // without throwing.
    const onMove = jest.fn();
    const participants = [
      makeParticipant({
        participant_id: 'p1',
        name: 'DeadMover',
        is_pc: false,
        at: [2, 2],
        hp_current: 0,
        is_alive: false,
        movement_remaining: 10,
      }),
    ];
    expect(() => {
      render(
        <TacticalMap
          {...baseProps({
            participants,
            viewerParticipantId: 'p9',
            activeParticipantId: 'p1',
            moveMode: true,
            onMove,
          })}
        />,
      );
    }).not.toThrow();
    // A neighboring empty cell is still computed as in-range — reach math
    // did not silently break when the mover itself is dead.
    expect(
      screen.getByRole('gridcell', { name: 'Row 2, column 3. Empty. In range — costs 5 feet.' }),
    ).toHaveClass(styles.cellInRange);
    // The mover's own cell (viewer p9 is a spectator, so this renders via
    // the ordinary occupant branch, not "Current position") is never a
    // legal target for itself, dead or not — `reachableCells` excludes
    // `from` unconditionally, before occupancy is even considered.
    const ownCell = screen.getByRole('gridcell', {
      name: 'Row 3, column 3. DeadMover, hostile, dead. Out of range.',
    });
    expect(ownCell).not.toHaveClass(styles.cellInRange);
    fireEvent.click(ownCell);
    expect(onMove).not.toHaveBeenCalled();
  });

  it('an invisible-but-living occupant still blocks its cell as a move target — invisibility is a rendering/disclosure fact, never an occupancy exemption', () => {
    const onMove = jest.fn();
    const participants = [
      makeParticipant({ participant_id: 'p1', name: 'Bren', at: [2, 2], movement_remaining: 10 }),
      makeParticipant({
        participant_id: 'p2',
        name: 'Ghost',
        is_pc: false,
        at: [2, 1],
        conditions: ['invisible'],
      }),
    ];
    render(
      <TacticalMap
        {...baseProps({ participants, activeParticipantId: 'p1', moveMode: true, onMove })}
      />,
    );
    const ghostCell = screen.getByRole('gridcell', { name: /Ghost, hostile, invisible\./ });
    expect(ghostCell).not.toHaveClass(styles.cellInRange);
    fireEvent.click(ghostCell);
    expect(onMove).not.toHaveBeenCalled();
  });
});

describe('TacticalMap — B8c-1 fix-round-2 (Kage-CR IMPORTANT-3): occupancy encoded once, self cell included', () => {
  it('a dead viewer\'s own cell reads and behaves as a reach destination, not "Current position.", when a DIFFERENT active mover could step there — label and click agree', () => {
    const onMove = jest.fn();
    const participants = [
      makeParticipant({ participant_id: 'p1', name: 'Sable', at: [2, 2], movement_remaining: 10 }),
      makeParticipant({
        participant_id: 'p9',
        name: 'Bren',
        at: [2, 1],
        hp_current: 0,
        is_alive: false,
      }),
    ];
    render(
      <TacticalMap
        {...baseProps({
          participants,
          viewerParticipantId: 'p9',
          activeParticipantId: 'p1',
          moveMode: true,
          onMove,
        })}
      />,
    );
    const ownCell = screen.getByRole('gridcell', {
      name: 'Row 2, column 3. Bren — you, dead. In range — costs 5 feet.',
    });
    expect(ownCell).toHaveClass(styles.cellInRange);
    fireEvent.click(ownCell);
    expect(onMove).toHaveBeenCalledWith([2, 1]);
  });

  it('positive control: a self cell where the viewer IS the active mover stays "Current position." and is never a click target for themselves', () => {
    const onMove = jest.fn();
    const participants = [
      makeParticipant({ participant_id: 'p1', name: 'Bren', at: [2, 2], movement_remaining: 10 }),
    ];
    render(
      <TacticalMap
        {...baseProps({
          participants,
          viewerParticipantId: 'p1',
          activeParticipantId: 'p1',
          moveMode: true,
          onMove,
        })}
      />,
    );
    const ownCell = screen.getByRole('gridcell', {
      name: 'Row 3, column 3. Bren — you. Current position.',
    });
    expect(ownCell).not.toHaveClass(styles.cellInRange);
    fireEvent.click(ownCell);
    expect(onMove).not.toHaveBeenCalled();
  });
});

describe('TacticalMap — B8c-1 Miko-QA re-check after round 2 (occupiesCell enumeration): {self,other} x {alive,downed,dead} x {is/isn\'t active mover} x moveMode x moveSubmitting', () => {
  // Geometry reused from the fix-round-2 fixtures above: p1 at [2,2],
  // movement_remaining 10 on the 5ft-cell default board -> [2,1] (1 cell,
  // 5ft) is always within budget when it isn't excluded by occupancy or by
  // being the mover's own cell. Every test here asserts THREE observable
  // facts together (label, cellInRange membership, click/Enter -> onMove),
  // per the coordinator's ask, so a fix that gets one right and another
  // wrong still reds.

  it('self, ALIVE, NOT the active mover: "Current position." and excluded from reach — the occupiesWhenAlive term alone must carry this, not the isActiveMover carve-out (closes a real gap: the pre-existing T1 "spectator viewer" test never asserted the spectator\'s OWN cell)', () => {
    const onMove = jest.fn();
    const participants = [
      makeParticipant({ participant_id: 'p1', name: 'Bren', at: [2, 2], movement_remaining: 10 }),
      makeParticipant({ participant_id: 'p2', name: 'Sable', at: [2, 1] }),
    ];
    render(
      <TacticalMap
        {...baseProps({ participants, viewerParticipantId: 'p2', activeParticipantId: 'p1', moveMode: true, onMove })}
      />,
    );
    const ownCell = screen.getByRole('gridcell', {
      name: 'Row 2, column 3. Sable — you. Current position.',
    });
    expect(ownCell).not.toHaveClass(styles.cellInRange);
    fireEvent.click(ownCell);
    expect(onMove).not.toHaveBeenCalled();
  });

  it('self, DOWNED (0 HP, is_alive: true), NOT the active mover: still "Current position." and excluded from reach — discriminates against a plausible-but-wrong "downed no longer occupies" rule, on the SELF branch specifically (the engine keys occupancy on is_active/is_alive, never HP)', () => {
    const onMove = jest.fn();
    const participants = [
      makeParticipant({ participant_id: 'p1', name: 'Bren', at: [2, 2], movement_remaining: 10 }),
      makeParticipant({
        participant_id: 'p9',
        name: 'Mira',
        at: [2, 1],
        hp_current: 0,
        is_alive: true,
      }),
    ];
    render(
      <TacticalMap
        {...baseProps({ participants, viewerParticipantId: 'p9', activeParticipantId: 'p1', moveMode: true, onMove })}
      />,
    );
    const ownCell = screen.getByRole('gridcell', {
      name: 'Row 2, column 3. Mira — you, downed. Current position.',
    });
    expect(ownCell).not.toHaveClass(styles.cellInRange);
    fireEvent.click(ownCell);
    expect(onMove).not.toHaveBeenCalled();
  });

  it('OTHER occupant who IS the dead active mover, viewed by a third party: reads the reach phrase ("Out of range."), never "Occupied" — proves the carve-out is scoped to `isSelf && isActiveMover` together, not `isActiveMover` alone (a plausible mutation of the OR\'s second term would flip this cell to "Occupied" even though it is unreachable only because it is the FROM cell, not because it is occupied)', () => {
    const onMove = jest.fn();
    const participants = [
      makeParticipant({
        participant_id: 'p1',
        name: 'Bren',
        at: [2, 2],
        movement_remaining: 10,
        is_alive: false,
        hp_current: 0,
      }),
      makeParticipant({ participant_id: 'p3', name: 'Third', at: [4, 4] }),
    ];
    render(
      <TacticalMap
        {...baseProps({ participants, viewerParticipantId: 'p3', activeParticipantId: 'p1', moveMode: true, onMove })}
      />,
    );
    const brensCell = screen.getByRole('gridcell', {
      name: 'Row 3, column 3. Bren, ally, dead. Out of range.',
    });
    expect(brensCell).not.toHaveClass(styles.cellInRange);
    fireEvent.click(brensCell);
    expect(onMove).not.toHaveBeenCalled();
  });

  it('self, DEAD, IS the active mover (structurally permitted by this component; whether the mount ever produces this state is Kage-CR\'s open question to B8c-2): still "Current position." via the isSelf-&&-isActiveMover carve-out, and never a click target for themselves — the same_cell exclusion in reach.ts, not occupiesCell, is what protects the click half here', () => {
    const onMove = jest.fn();
    const participants = [
      makeParticipant({
        participant_id: 'p1',
        name: 'Bren',
        at: [2, 2],
        movement_remaining: 10,
        is_alive: false,
        hp_current: 0,
      }),
    ];
    render(
      <TacticalMap
        {...baseProps({ participants, viewerParticipantId: 'p1', activeParticipantId: 'p1', moveMode: true, onMove })}
      />,
    );
    const ownCell = screen.getByRole('gridcell', {
      name: 'Row 3, column 3. Bren — you, dead. Current position.',
    });
    expect(ownCell).not.toHaveClass(styles.cellInRange);
    fireEvent.click(ownCell);
    expect(onMove).not.toHaveBeenCalled();
  });

  it('self, DEAD, NOT the active mover, moveMode OFF: reads "you, dead." with no "Current position." and no reach phrase, never highlighted, never a click target — moveMode collapses ALL of the occupiesCell axes at once, not just the ones exercised with moveMode on above', () => {
    const onMove = jest.fn();
    const participants = [
      makeParticipant({ participant_id: 'p1', name: 'Bren', at: [2, 2], movement_remaining: 10 }),
      makeParticipant({
        participant_id: 'p9',
        name: 'Corpse',
        at: [2, 1],
        hp_current: 0,
        is_alive: false,
      }),
    ];
    render(
      <TacticalMap
        {...baseProps({ participants, viewerParticipantId: 'p9', activeParticipantId: 'p1', moveMode: false, onMove })}
      />,
    );
    const ownCell = screen.getByRole('gridcell', {
      name: 'Row 2, column 3. Corpse — you, dead.',
    });
    expect(ownCell).not.toHaveClass(styles.cellInRange);
    fireEvent.click(ownCell);
    expect(onMove).not.toHaveBeenCalled();
  });

  it('self, DEAD, NOT the active mover, cell reachable AND moveSubmitting: the fix-round-2 self-occupancy exclusion and the earlier IMP-9b moveSubmitting guard compose correctly on the SAME cell — cellPending/aria-disabled apply and the click is inert, paired with the fix-round-2 baseline above (same fixture, moveSubmitting omitted) which already proves this exact cell submits when NOT submitting', () => {
    const onMove = jest.fn();
    const participants = [
      makeParticipant({ participant_id: 'p1', name: 'Bren', at: [2, 2], movement_remaining: 10 }),
      makeParticipant({
        participant_id: 'p9',
        name: 'Bren',
        at: [2, 1],
        hp_current: 0,
        is_alive: false,
      }),
    ];
    render(
      <TacticalMap
        {...baseProps({
          participants,
          viewerParticipantId: 'p9',
          activeParticipantId: 'p1',
          moveMode: true,
          moveSubmitting: true,
          onMove,
        })}
      />,
    );
    const ownCell = screen.getByRole('gridcell', {
      name: 'Row 2, column 3. Bren — you, dead. In range — costs 5 feet.',
    });
    expect(ownCell).toHaveClass(styles.cellInRange);
    expect(ownCell).toHaveClass(styles.cellPending);
    expect(ownCell).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(ownCell);
    expect(onMove).not.toHaveBeenCalled();
  });
});
