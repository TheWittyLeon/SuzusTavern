/**
 * TacticalMap — tactical map (#12), design pass v1 (Aoi-UI). Standalone
 * component (Lane D, 2026-09-28 runbook) — not mounted anywhere yet.
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import TacticalMap, { type TacticalMapProps } from '@/components/tactical-map/TacticalMap';
import styles from '@/components/tactical-map/TacticalMap.module.css';
import { COMBAT_REFUSAL_REASON_MAP } from '@/lib/dnd/engineReasons';
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
    refusalReason: null,
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
  it('shows the ACTIVE participant\'s reach even when the viewer is a different participant', () => {
    const participants = [
      makeParticipant({ participant_id: 'p1', name: 'Bren', at: [2, 2], movement_remaining: 10 }),
      makeParticipant({ participant_id: 'p2', name: 'Sable', at: [4, 4], movement_remaining: 5 }),
    ];
    // Viewer is p2 (a spectator this turn); the active mover is p1.
    render(
      <TacticalMap
        {...baseProps({ participants, viewerParticipantId: 'p2', activeParticipantId: 'p1', moveMode: true })}
      />,
    );
    // Neighbor of p1's [2,2] within a 1-cell (5ft) budget -> "In range".
    expect(
      screen.getByRole('gridcell', { name: 'Row 2, column 2. Empty. In range — costs 5 feet.' }),
    ).toBeInTheDocument();
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
    expect(
      screen.getByRole('gridcell', { name: 'Row 2, column 4. Goblin, hostile, invisible. Occupied — can\'t stop here.' }),
    ).toBeInTheDocument();
  });
});

describe('TacticalMap — T4: phone board centers on the active token each turn', () => {
  it('calls scrollIntoView on the active participant\'s cell when the active turn changes', () => {
    const participants = [
      makeParticipant({ participant_id: 'p1', name: 'Bren', at: [0, 0] }),
      makeParticipant({ participant_id: 'p2', name: 'Sable', at: [4, 4] }),
    ];
    const scrollSpy = jest.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => {});
    const { rerender } = render(
      <TacticalMap {...baseProps({ participants, activeParticipantId: 'p1' })} />,
    );
    expect(scrollSpy).toHaveBeenCalledWith(expect.objectContaining({ block: 'center' }));
    scrollSpy.mockClear();

    // Same active participant re-renders: no redundant re-center.
    rerender(<TacticalMap {...baseProps({ participants, activeParticipantId: 'p1' })} />);
    expect(scrollSpy).not.toHaveBeenCalled();

    // Turn changes to p2 -> centers again, on p2's cell this time.
    rerender(<TacticalMap {...baseProps({ participants, activeParticipantId: 'p2' })} />);
    expect(scrollSpy).toHaveBeenCalledTimes(1);
    scrollSpy.mockRestore();
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

    fireEvent.keyDown(startCell, { key: 'ArrowRight' });
    const nextCell = screen.getByRole('gridcell', { name: /Row 3, column 4\./ }); // [3,2] -> row3,col4
    expect(nextCell).toHaveAttribute('tabindex', '0');
    expect(startCell).toHaveAttribute('tabindex', '-1');
    expect(container.querySelectorAll('[role="gridcell"][tabindex="0"]')).toHaveLength(1);

    fireEvent.keyDown(nextCell, { key: 'Enter' });
    expect(onMove).toHaveBeenCalledWith([3, 2]);

    fireEvent.keyDown(nextCell, { key: 'Escape' });
    expect(onExitMove).toHaveBeenCalledTimes(1);
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

describe('TacticalMap — refusal copy', () => {
  it('renders the curated COMBAT_REFUSAL_REASON_MAP copy for a known reason code', () => {
    render(<TacticalMap {...baseProps({ refusalReason: 'no_movement_remaining' })} />);
    expect(screen.getByText(COMBAT_REFUSAL_REASON_MAP.no_movement_remaining)).toBeInTheDocument();
  });

  it('renders a generic fallback for an unmapped reason code, never the raw code', () => {
    render(<TacticalMap {...baseProps({ refusalReason: 'some_future_unmapped_code' })} />);
    expect(screen.queryByText('some_future_unmapped_code')).not.toBeInTheDocument();
    expect(screen.getByText('The server refused that move.')).toBeInTheDocument();
  });

  it('renders no banner when refusalReason is absent', () => {
    const { container } = render(<TacticalMap {...baseProps({ refusalReason: null })} />);
    expect(container.querySelector(`.${styles.refusal}`)).not.toBeInTheDocument();
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
