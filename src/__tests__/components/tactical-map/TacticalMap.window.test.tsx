/**
 * TacticalMap — B8c-3 M1 (the map fits a room and reads without a strip of its own; Sora's mount brief 2.3, with Iro's three conditions folded in as M1.1).
 *
 * New cases only: the existing suites are untouched except the three cases the brief names (the inspector strip, T4's centring, T1's `showReach`).
 * What each group pins, and the mutation that reds it (every one was run: see the commit message):
 *   - the room        : CSS pins that the component spends none of its height on chrome, so the window can be the body.      padding back -> red
 *   - focus           : arrows move DOM focus outside Move mode (F-d, read-but-not-run in the brief; red at e78f9de).            gate back to `moveMode` only -> red
 *   - reach           : `showReach` draws the overlay for an observer and sends nothing.                                         overlay tied to `moveMode` again -> red
 *   - keys outside Move: arrows, Enter and Space never call `onMove` or `onExitMove`; one Tab stop and Tab leaves.
 *   - Escape in flight: consumed always, closes nothing while a move is in flight.                                               `canClose` dropped -> red
 *   - the line        : `onInspect` payloads for rest, creature, feature and target; the chosen square drives it with or without focus.  trigger back to "grid holds focus" -> red
 *   - follow          : a turn passing, and focus, scroll the window by the fewest whole squares on the axis that needs it, never else.   centring -> red; preventScroll dropped -> red
 *   - names           : a feature's label is in the cell's accessible name; no "feet remaining" with a null budget.
 */
import React from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { act, render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import TacticalMap, { type TacticalMapProps } from '@/components/tactical-map/TacticalMap';
import type { CombatParticipantState, CombatSpace } from '@/lib/api/types';
import { buildLine, type InspectLine } from '@/components/tactical-map/a11y';
import styles from '@/components/tactical-map/TacticalMap.module.css';

function makeSpace(overrides: Partial<CombatSpace> = {}): CombatSpace {
  return { kind: 'square', width: 5, height: 5, cell: { value: 5, unit: 'ft' }, blocked: [], features: [], ...overrides };
}

function makeParticipant(overrides: Partial<CombatParticipantState> = {}): CombatParticipantState {
  return {
    participant_id: 'p1', entity_id: 'char-1', name: 'Bren', is_pc: true, initiative: 15, hp_current: 20, hp_max: 20, ac: 15, conditions: [],
    is_alive: true, can_be_targeted: true, is_active_turn: false, took_turn: false, at: null, movement_remaining: null, ...overrides,
  };
}

function baseProps(overrides: Partial<TacticalMapProps> = {}): TacticalMapProps {
  return {
    space: makeSpace(), participants: [], viewerParticipantId: 'p1', activeParticipantId: 'p1', moveMode: false, onMove: jest.fn(), onExitMove: jest.fn(), ...overrides,
  };
}

const CSS = fs.readFileSync(path.join(process.cwd(), 'src/components/tactical-map/TacticalMap.module.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ');

/** The declarations of the first `.selector { ... }` rule (brace-balanced). Throws when the rule is gone, so a rename fails loudly. */
function ruleBody(selector: string): string {
  const head = new RegExp(`\\.${selector}(?![\\w-])\\s*\\{`).exec(CSS);
  if (!head) throw new Error(`.${selector} rule not found in TacticalMap.module.css`);
  let depth = 0;
  for (let i = head.index + head[0].length - 1; i < CSS.length; i++) {
    if (CSS[i] === '{') depth++;
    else if (CSS[i] === '}' && --depth === 0) return CSS.slice(head.index + head[0].length, i);
  }
  throw new Error(`.${selector} never closes`);
}
const hasDecl = (body: string, prop: string, value?: RegExp) => new RegExp(`(^|[\\s;])${prop}\\s*:\\s*${value ? value.source : '[^;]+'}\\s*(;|$)`).test(body);

// ── the room ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('TacticalMap — the room: the window is the body, with no chrome of its own (brief 2.3)', () => {
  it('the component as built at e78f9de spent ~100px on its own chrome (24px padding, a 12px gap and a 64px strip): an 8-row room showed 5 rows. None of it is left', () => {
    const wrap = ruleBody('wrap');
    expect(hasDecl(wrap, 'height', /100%/)).toBe(true);
    expect(hasDecl(wrap, 'flex-direction', /column/)).toBe(true);
    expect(hasDecl(wrap, 'gap')).toBe(false); // the 12px between the window and the strip
    const win = ruleBody('boardScroll');
    expect(hasDecl(win, 'padding')).toBe(false); // the 24px, which cost 48px of height and 48px of width
    expect(hasDecl(win, 'flex', /1 1 auto/)).toBe(true);
    expect(hasDecl(win, 'min-height', /0/)).toBe(true);
    expect(hasDecl(win, 'display', /flex/)).toBe(true);
    expect(hasDecl(win, 'overflow', /auto/)).toBe(true);
    expect(hasDecl(win, 'background', /var\(--bg-3\)/)).toBe(true); // the contrast pins read this surface
    expect(CSS).not.toMatch(/\.inspector[A-Za-z]*\s*\{/); // the 64px strip
  });

  it('the board centres when it is smaller than the window and scrolls from its start edge when it is larger (margin: auto on a flex item, never `justify-content: center`)', () => {
    const board = ruleBody('board');
    expect(hasDecl(board, 'margin', /auto/)).toBe(true);
    expect(hasDecl(board, 'flex', /none/)).toBe(true);
    expect(hasDecl(ruleBody('boardScroll'), 'justify-content')).toBe(false);
    expect(hasDecl(ruleBody('boardScroll'), 'align-items')).toBe(false);
  });

  it('the window never asks for smooth scrolling (a follow is at once, with or without reduced motion), and the board is windowed, never scaled', () => {
    expect(CSS).not.toMatch(/scroll-behavior\s*:\s*smooth/);
    expect(CSS).not.toMatch(/transform\s*:\s*scale/);
    expect(CSS).not.toMatch(/\bzoom\s*:/);
  });

  it('the rendered map is one scroller declaring itself the board window, holding the grid, and nothing else: no strip beside it', () => {
    const { container } = render(<TacticalMap {...baseProps({ participants: [makeParticipant({ at: [1, 1], movement_remaining: 10 })] })} />);
    const wrap = container.firstElementChild as HTMLElement;
    expect(wrap.children).toHaveLength(1);
    const windowEl = wrap.firstElementChild as HTMLElement;
    expect(windowEl).toHaveAttribute('data-board-window');
    expect(container.querySelectorAll('[data-board-window]')).toHaveLength(1);
    expect(windowEl.querySelectorAll('[role="grid"]')).toHaveLength(1);
    expect(screen.queryByText('No creature selected.')).not.toBeInTheDocument();
  });

  it('the cue: the shell\'s scroll-shadow technique on all four edges, painted by the window\'s own background, only where there is more board', () => {
    const win = ruleBody('boardScroll');
    expect(hasDecl(win, 'background-attachment', /local, local, local, local, scroll, scroll, scroll, scroll/)).toBe(true);
    expect((win.match(/linear-gradient\(/g) ?? []).length).toBeGreaterThanOrEqual(4);
    expect((win.match(/radial-gradient\(/g) ?? []).length).toBeGreaterThanOrEqual(4);
  });

  it('a right and bottom line as an inset shadow, never a border (a border adds a pixel and makes a board that exactly fits scroll)', () => {
    const board = ruleBody('board');
    expect(hasDecl(board, 'box-shadow', /inset[^;]*/)).toBe(true);
    expect(hasDecl(board, 'border')).toBe(false);
    expect(hasDecl(ruleBody('boardScroll'), 'border')).toBe(false);
  });

  it('forced colours: reach, blocked and pending are drawn by outline, since backgrounds and shadows are dropped there', () => {
    const forced = /@media\s*\(forced-colors:\s*active\)\s*\{([\s\S]*)\}\s*$/m.exec(CSS);
    expect(forced).not.toBeNull();
    const block = forced![1];
    for (const cls of ['cellInRange', 'cellBlocked', 'cellPending', 'cellDestination']) {
      expect(block).toMatch(new RegExp(`\\.${cls}[^{]*\\{[^}]*outline`));
    }
    // blocked and pending differ from each other and from the reach by outline STYLE (the one signal a forced-colours user keeps)
    const style = (cls: string) => new RegExp(`\\.${cls}[^{]*\\{[^}]*outline(?:-style)?\\s*:\\s*[^;]*?(solid|dashed|dotted|double)`).exec(block)?.[1];
    for (const cls of ['cellInRange', 'cellBlocked', 'cellPending', 'cellDestination']) expect(style(cls)).toBeDefined(); // `outline: none` matches the check above and is no style at all
    expect(new Set([style('cellInRange'), style('cellBlocked'), style('cellPending')]).size).toBe(3);
  });

  it('the reach keeps its ring (the tint is never the only signal) and a pointer only where a click can move', () => {
    expect(hasDecl(ruleBody('cellInRange'), 'box-shadow', /inset[^;]*/)).toBe(true);
    expect(hasDecl(ruleBody('cellInRange'), 'cursor')).toBe(false);
    expect(hasDecl(ruleBody('cellMovable'), 'cursor', /pointer/)).toBe(true);
  });
});

// ── focus: F-d ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('TacticalMap — arrow keys move DOM focus outside Move mode (brief F-d: read, not run; this is the run)', () => {
  const observer = () => baseProps({
    participants: [makeParticipant({ participant_id: 'p1', name: 'Bren', at: [2, 2], movement_remaining: 10 })],
    moveMode: false,
  });

  it('with the grid holding focus and moveMode false, ArrowRight moves the roving stop AND real focus (red at e78f9de: the effect returned early when moveMode was false)', () => {
    const { container } = render(<TacticalMap {...observer()} />);
    const start = screen.getByRole('gridcell', { name: /Bren — you\. Current position\./ });
    act(() => start.focus());
    expect(document.activeElement).toBe(start);
    fireEvent.keyDown(start, { key: 'ArrowRight' });
    const next = screen.getByRole('gridcell', { name: /Row 3, column 4\./ });
    expect(next).toHaveAttribute('tabindex', '0');
    expect(document.activeElement).toBe(next);
    fireEvent.keyDown(next, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(screen.getByRole('gridcell', { name: /Row 4, column 4\./ }));
    expect(container.querySelectorAll('[role="gridcell"][tabindex="0"]')).toHaveLength(1);
  });

  it('it never pulls focus into the grid: not on mount, not when focus is elsewhere and a poll moves the active token', () => {
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    outside.focus();
    const { rerender } = render(<TacticalMap {...observer()} />);
    expect(document.activeElement).toBe(outside);
    const moved = baseProps({ participants: [makeParticipant({ participant_id: 'p1', name: 'Bren', at: [3, 3], movement_remaining: 5 })] });
    rerender(<TacticalMap {...moved} />);
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });

  it('the roving stop alone moves when the grid does not hold focus (an arrow key reaches the grid only from inside it)', () => {
    const { container } = render(<TacticalMap {...observer()} />);
    expect(container.querySelectorAll('[role="gridcell"][tabindex="0"]')).toHaveLength(1);
    expect(document.activeElement).toBe(document.body);
  });

  it('focus is taken with `preventScroll` (the follow below is the only thing that scrolls), so a square already in view is never scrolled by being focused', () => {
    const focus = jest.spyOn(HTMLElement.prototype, 'focus');
    render(<TacticalMap {...observer()} />);
    const start = screen.getByRole('gridcell', { name: /Current position/ });
    act(() => start.focus());
    focus.mockClear();
    fireEvent.keyDown(start, { key: 'ArrowRight' });
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(focus.mock.calls.every((c) => c[0] && (c[0] as FocusOptions).preventScroll === true)).toBe(true);
    focus.mockRestore();
  });
});

// ── keys outside Move mode ────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('TacticalMap — outside Move mode nothing is armed or moved by a key (Iro: arrows, Enter and Space only choose)', () => {
  const setup = () => {
    const onMove = jest.fn();
    const onExitMove = jest.fn();
    const props = baseProps({
      participants: [makeParticipant({ participant_id: 'p1', name: 'Bren', at: [2, 2], movement_remaining: 10 }), makeParticipant({ participant_id: 'p2', name: 'Goblin', is_pc: false, at: [3, 2] })],
      onMove, onExitMove,
    });
    const view = render(<TacticalMap {...props} />);
    const start = screen.getByRole('gridcell', { name: /Current position/ });
    act(() => start.focus());
    return { onMove, onExitMove, start, ...view };
  };

  it('arrows, Enter and Space call neither onMove nor onExitMove, however the cursor sits (even on a square that would be a legal move target)', () => {
    const { onMove, onExitMove, start } = setup();
    for (const key of ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Enter', ' ']) fireEvent.keyDown(document.activeElement ?? start, { key });
    fireEvent.keyDown(screen.getByRole('gridcell', { name: /Row 2, column 3\./ }), { key: 'Enter' });
    fireEvent.keyDown(screen.getByRole('gridcell', { name: /Row 2, column 3\./ }), { key: ' ' });
    fireEvent.click(screen.getByRole('gridcell', { name: /Row 2, column 3\./ }));
    expect(onMove).not.toHaveBeenCalled();
    expect(onExitMove).not.toHaveBeenCalled();
  });

  it('Enter and Space only CHOOSE the square for the line; Space is consumed (it would scroll the page), the focus stays', () => {
    const onInspect = jest.fn();
    const props = baseProps({
      participants: [makeParticipant({ participant_id: 'p1', name: 'Bren', at: [2, 2], movement_remaining: 10 }), makeParticipant({ participant_id: 'p2', name: 'Goblin', is_pc: false, at: [3, 2] })],
      onInspect,
    });
    render(<TacticalMap {...props} />);
    const goblin = screen.getByRole('gridcell', { name: /Goblin, hostile/ });
    act(() => goblin.focus());
    onInspect.mockClear();
    const space = fireEvent.keyDown(goblin, { key: ' ' });
    expect(space).toBe(false); // preventDefault was called
    expect(document.activeElement).toBe(goblin);
    expect(onInspect).toHaveBeenCalledTimes(0); // already chosen by the focus that put it there: nothing new to say
    expect(fireEvent.keyDown(goblin, { key: 'Enter' })).toBe(false);
  });

  it('arrows are consumed (the grid sits in a scroller, so an unconsumed arrow would scroll the window natively on top of the follow); a key that is not the grid\'s is not', () => {
    const { start } = setup();
    for (const key of ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp']) expect(fireEvent.keyDown(document.activeElement ?? start, { key })).toBe(false);
    expect(fireEvent.keyDown(document.activeElement ?? start, { key: 'a' })).toBe(true); // the control: the harness can tell a consumed key from a free one
  });

  it('exactly one Tab stop in the grid, and Tab is never consumed: one Tab enters and the next leaves', () => {
    const { container } = setup();
    expect(container.querySelectorAll('[role="gridcell"][tabindex="0"]')).toHaveLength(1);
    const stop = container.querySelector('[role="gridcell"][tabindex="0"]') as HTMLElement;
    expect(fireEvent.keyDown(stop, { key: 'Tab' })).toBe(true); // default not prevented: the browser moves focus out of the grid
    expect(container.querySelectorAll('[tabindex="0"]')).toHaveLength(1);
    expect(container.querySelectorAll('[role="gridcell"][tabindex="-1"]')).toHaveLength(24);
  });
});

// ── showReach ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('TacticalMap — an observer is never offered a move in the line (showReach, no moveMode)', () => {
  it('arrowing over squares that are in the mover\'s reach yields `turn` / `cell` payloads only: no `target` line, which would read "Move to row 6…"', () => {
    const onInspect = jest.fn();
    const people = [
      makeParticipant({ participant_id: 'p1', name: 'Bren', at: [2, 2], movement_remaining: 10 }),
      makeParticipant({ participant_id: 'p2', name: 'Sable', at: [5, 5], movement_remaining: 5 }),
    ];
    render(<TacticalMap {...baseProps({ space: makeSpace({ width: 10, height: 10 }), participants: people, viewerParticipantId: 'p2', activeParticipantId: 'p1', showReach: true, moveMode: false, onInspect })} />);
    expect(screen.getByRole('gridcell', { name: /Row 3, column 4\./ }).className).toContain(styles.cellInRange); // the squares below are in reach: the control for "in reach"
    const start = screen.getByRole('gridcell', { name: /Row 6, column 6\./ });
    act(() => start.focus());
    fireEvent.keyDown(start, { key: 'ArrowLeft' });
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'ArrowUp' });
    const kinds = onInspect.mock.calls.map((c) => (c[0] as InspectLine | null)?.kind);
    expect(kinds.length).toBeGreaterThan(0);
    expect(kinds).not.toContain('target');
  });
});

describe('TacticalMap — showReach: the overlay without the interaction (T1 for an observer)', () => {
  const participants = [
    makeParticipant({ participant_id: 'p1', name: 'Bren', at: [2, 2], movement_remaining: 10 }),
    makeParticipant({ participant_id: 'p2', name: 'Sable', at: [4, 4], movement_remaining: 5 }),
  ];
  const observer = (o: Partial<TacticalMapProps> = {}) => baseProps({ participants, viewerParticipantId: 'p2', activeParticipantId: 'p1', moveMode: false, ...o });
  const reachCells = (container: HTMLElement) => container.querySelectorAll('[role="gridcell"][class*="cellInRange"]');

  it('draws the ACTIVE mover\'s reach with showReach and moveMode false (24 squares within 10 ft of [2,2] on 5x5, less the creatures\' own)', () => {
    const { container } = render(<TacticalMap {...observer({ showReach: true })} />);
    expect(reachCells(container).length).toBeGreaterThan(0);
    expect(reachCells(container)).toHaveLength(23); // 25 squares, less the mover's own and Sable's
  });

  it('draws nothing without either prop (the overlay is not on by default)', () => {
    const { container } = render(<TacticalMap {...observer()} />);
    expect(reachCells(container)).toHaveLength(0);
  });

  it('a click on a reach square sends nothing, a key sends nothing, the cursor is not a pointer, and the names carry no range language (nobody is choosing)', () => {
    const onMove = jest.fn();
    const { container } = render(<TacticalMap {...observer({ showReach: true, onMove })} />);
    const cell = reachCells(container)[0] as HTMLElement;
    fireEvent.click(cell);
    fireEvent.keyDown(cell, { key: 'Enter' });
    expect(onMove).not.toHaveBeenCalled();
    expect(container.querySelectorAll('[class*="cellMovable"]')).toHaveLength(0);
    expect(cell.getAttribute('aria-label')).not.toMatch(/In range|Out of range|costs/);
  });

  it('with moveMode true the same squares are movable (the pointer) and the cursor, ring, tag and commit stay moveMode\'s', () => {
    const onMove = jest.fn();
    const { container } = render(<TacticalMap {...observer({ showReach: true, moveMode: true, viewerParticipantId: 'p1', onMove })} />);
    expect(container.querySelectorAll('[class*="cellMovable"]').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('gridcell', { name: /Row 2, column 3\./ }));
    expect(onMove).toHaveBeenCalledWith([2, 1]);
  });

  it('showReach never takes focus: an observer\'s focus is not pulled into the grid by someone else\'s move', () => {
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    outside.focus();
    const { rerender } = render(<TacticalMap {...observer({ showReach: true })} />);
    rerender(<TacticalMap {...observer({ showReach: true, participants: [makeParticipant({ participant_id: 'p1', name: 'Bren', at: [3, 2], movement_remaining: 5 }), participants[1]] })} />);
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });
});

// ── Escape in flight ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('TacticalMap — Escape in flight: consumed always, closes only when nothing is in flight (ledger 3)', () => {
  const run = (moveSubmitting: boolean) => {
    const onExitMove = jest.fn();
    const outer = jest.fn();
    render(
      <div onKeyDown={outer}>
        <TacticalMap {...baseProps({ participants: [makeParticipant({ at: [0, 0], movement_remaining: 10 })], moveMode: true, moveSubmitting, onExitMove })} />
      </div>,
    );
    const cell = screen.getByRole('gridcell', { name: /Current position/ });
    const notPrevented = fireEvent.keyDown(cell, { key: 'Escape' });
    return { onExitMove, outer, notPrevented };
  };

  it('in flight: nothing closes, and the event is consumed (it never reaches the document-level Award-XP listener)', () => {
    const { onExitMove, outer, notPrevented } = run(true);
    expect(onExitMove).not.toHaveBeenCalled();
    expect(outer).not.toHaveBeenCalled();
    expect(notPrevented).toBe(false);
  });

  it('idle: it closes once, and is consumed (the control for the case above)', () => {
    const { onExitMove, outer } = run(false);
    expect(onExitMove).toHaveBeenCalledTimes(1);
    expect(outer).not.toHaveBeenCalled();
  });
});

// ── the line ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('TacticalMap — onInspect: the payloads (brief 2.2/2.3) and what drives them', () => {
  const participants = [
    makeParticipant({ participant_id: 'p1', name: 'Bren', at: [0, 0], movement_remaining: 30 }),
    makeParticipant({ participant_id: 'm1', name: 'Goblin Skulker', is_pc: false, at: [2, 0], conditions: ['invisible', 'poisoned', 'prone'] }),
    makeParticipant({ participant_id: 'm2', name: 'Goblin Archer', is_pc: false, at: [4, 4], hp_current: 0 }),
  ];
  const space = makeSpace({ blocked: [[1, 1]], features: [{ id: 'brazier', kind: 'prop', label: 'Brazier', at: [[3, 3], [3, 4]] }] });
  const lastOf = (fn: jest.Mock): InspectLine | null | undefined => (fn.mock.calls.length ? fn.mock.calls[fn.mock.calls.length - 1][0] : undefined);
  const mount = (o: Partial<TacticalMapProps> = {}) => {
    const onInspect = jest.fn();
    const view = render(<TacticalMap {...baseProps({ space, participants, onInspect, ...o })} />);
    return { onInspect, ...view };
  };

  it('at rest, the mover with a budget: a `turn` line with the name and the feet', () => {
    const { onInspect } = mount();
    expect(lastOf(onInspect)).toEqual({ kind: 'turn', name: 'Bren', feetLeft: 30 });
  });

  it('at rest with no budget or no square there is nothing to say (the stage\'s own "In combat · round N" stands): no line', () => {
    const none = mount({ participants: [makeParticipant({ participant_id: 'p1', name: 'Bren', at: [0, 0], movement_remaining: null })] });
    expect(none.onInspect).not.toHaveBeenCalled();
    none.unmount();
    const unplaced = mount({ participants: [makeParticipant({ participant_id: 'p1', name: 'Bren', at: null, movement_remaining: 30 })] });
    expect(unplaced.onInspect).not.toHaveBeenCalled();
  });

  it('a creature\'s square CHOSEN by a click that moves no focus (a tap under VoiceOver or TalkBack): a `cell` line carrying the CellNameInput, not a summary', () => {
    const { onInspect } = mount();
    fireEvent.click(screen.getByRole('gridcell', { name: /Goblin Skulker, hostile/ }));
    expect(document.activeElement).toBe(document.body); // jsdom: a click moves no focus: the case Iro rules on
    const line = lastOf(onInspect) as Extract<InspectLine, { kind: 'cell' }>;
    expect(line.kind).toBe('cell');
    expect(line.input).toMatchObject({ row1: 1, col1: 3, blocked: false, moveModeActive: false, occupant: { name: 'Goblin Skulker', hostile: true, invisible: true, isSelf: false, isAlly: false, otherConditions: ['Poisoned', 'Prone'] } });
  });

  it('a feature\'s square chosen: a `cell` line with the feature\'s label; an empty square chosen: back to the rest line; a blocked one too', () => {
    const { onInspect } = mount();
    fireEvent.click(screen.getByRole('gridcell', { name: /Row 4, column 4\./ }));
    expect(lastOf(onInspect)).toMatchObject({ kind: 'cell', input: { featureLabel: 'Brazier', row1: 4, col1: 4 } });
    fireEvent.click(screen.getByRole('gridcell', { name: /Row 3, column 5\./ }));
    expect(lastOf(onInspect)).toEqual({ kind: 'turn', name: 'Bren', feetLeft: 30 });
  });

  it('a downed creature (0 HP, alive) and the mover\'s own square carry their facts', () => {
    const { onInspect } = mount();
    fireEvent.click(screen.getByRole('gridcell', { name: /Goblin Archer, hostile, downed/ }));
    expect(lastOf(onInspect)).toMatchObject({ kind: 'cell', input: { occupant: { name: 'Goblin Archer', downed: true, dead: false } } });
    fireEvent.click(screen.getByRole('gridcell', { name: /Bren — you/ }));
    expect(lastOf(onInspect)).toMatchObject({ kind: 'cell', input: { occupant: { name: 'Bren', isSelf: true } } });
  });

  it('keyed on content: re-rendering with the same line and a NEW callback does not call again; a changed line calls once', () => {
    const first = jest.fn();
    const second = jest.fn();
    const { rerender } = render(<TacticalMap {...baseProps({ space, participants, onInspect: first })} />);
    expect(first).toHaveBeenCalledTimes(1);
    rerender(<TacticalMap {...baseProps({ space, participants, onInspect: second })} />);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('gridcell', { name: /Goblin Skulker, hostile/ }));
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('the chosen square clears when focus leaves the grid, and at a turn change while the grid does not hold focus', () => {
    const { onInspect, rerender } = mount();
    const goblin = screen.getByRole('gridcell', { name: /Goblin Skulker, hostile/ });
    act(() => goblin.focus());
    expect(lastOf(onInspect)).toMatchObject({ kind: 'cell' });
    fireEvent.blur(goblin, { relatedTarget: null });
    expect(lastOf(onInspect)).toEqual({ kind: 'turn', name: 'Bren', feetLeft: 30 });
    // a tap that moved no focus, then the turn passes: the stale square is not shown against the new mover
    fireEvent.click(screen.getByRole('gridcell', { name: /Goblin Skulker, hostile/ }));
    expect(lastOf(onInspect)).toMatchObject({ kind: 'cell' });
    const next = participants.map((p) => (p.participant_id === 'm1' ? { ...p, movement_remaining: 25 } : p));
    rerender(<TacticalMap {...baseProps({ space, participants: next, activeParticipantId: 'm1', onInspect })} />);
    expect(lastOf(onInspect)).toEqual({ kind: 'turn', name: 'Goblin Skulker', feetLeft: 25 });
  });

  it('the grid holding focus across a turn change keeps the chosen square (only a grid without focus drops it at the turn)', () => {
    const { onInspect, rerender } = mount();
    const goblin = screen.getByRole('gridcell', { name: /Goblin Skulker, hostile/ });
    act(() => goblin.focus());
    expect(lastOf(onInspect)).toMatchObject({ kind: 'cell', input: { occupant: { name: 'Goblin Skulker' } } });
    rerender(<TacticalMap {...baseProps({ space, participants, activeParticipantId: 'm2', onInspect })} />); // the turn passes to the archer; the grid still holds focus
    expect(document.activeElement).toBe(goblin);
    expect(lastOf(onInspect)).toMatchObject({ kind: 'cell', input: { occupant: { name: 'Goblin Skulker' } } });
  });

  it('focus moving between squares of the grid does not clear it; tabbing into the grid chooses its roving stop', () => {
    const { onInspect } = mount();
    const goblin = screen.getByRole('gridcell', { name: /Goblin Skulker, hostile/ });
    act(() => goblin.focus());
    fireEvent.keyDown(goblin, { key: 'ArrowRight' });
    fireEvent.blur(goblin, { relatedTarget: screen.getByRole('gridcell', { name: /Row 1, column 4\./ }) });
    // [3,0] is empty and the keyboard is on it: the line names it in the cell's own words (Iro-A11y condition C; this pin said `turn` before it), and the grid still holds the chosen square
    expect(lastOf(onInspect)).toMatchObject({ kind: 'cell', input: { row1: 1, col1: 4, occupant: undefined } });
    fireEvent.keyDown(screen.getByRole('gridcell', { name: /Row 1, column 4\./ }), { key: 'ArrowLeft' });
    expect(lastOf(onInspect)).toMatchObject({ kind: 'cell', input: { occupant: { name: 'Goblin Skulker' } } });
  });

  it('while choosing a move: a `target` line for the focused square; a hovered square wins; a legal square carries its cost and the budget, an illegal one says why', () => {
    const { onInspect } = mount({ moveMode: true });
    expect(lastOf(onInspect)).toMatchObject({ kind: 'target', legal: false }); // the cursor starts on the mover's own square
    fireEvent.pointerEnter(screen.getByRole('gridcell', { name: /Row 2, column 1\./ }));
    expect(lastOf(onInspect)).toMatchObject({ kind: 'target', legal: true, costFt: 5, budgetFt: 30, input: { row1: 2, col1: 1, inRange: true, moveModeActive: true } });
    fireEvent.pointerEnter(screen.getByRole('gridcell', { name: /Row 2, column 2\./ })); // blocked
    expect(lastOf(onInspect)).toMatchObject({ kind: 'target', legal: false, input: { blocked: true } });
    fireEvent.pointerLeave(screen.getByRole('gridcell', { name: /Row 2, column 2\./ }));
    expect(lastOf(onInspect)).toMatchObject({ kind: 'target', legal: false }); // back to the focused (own) square
  });

  it('one legality for the line, the ring and the tag: on every square the line says "legal" exactly when the square carries the ring and the tag, and an Occupied square is never offered (T3)', () => {
    const { onInspect } = mount({ moveMode: true });
    let offered = 0;
    let occupied = 0;
    for (const cell of screen.getAllByRole('gridcell')) {
      fireEvent.pointerEnter(cell);
      const line = lastOf(onInspect);
      expect(line).toMatchObject({ kind: 'target' });
      const legal = (line as Extract<InspectLine, { kind: 'target' }>).legal;
      expect(legal).toBe(cell.className.includes(styles.cellDestination));
      expect(legal).toBe(/\d+ ft/.test(cell.textContent ?? ''));
      if (/Occupied/.test(cell.getAttribute('aria-label') ?? '')) { occupied++; expect(legal).toBe(false); }
      if (legal) offered++;
    }
    expect(offered).toBeGreaterThan(0); // the control: some square is offered, so the loop can fail for the other reason
    expect(occupied).toBeGreaterThan(0); // and some square is Occupied, so the other half is exercised
  });
});

// ── names ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('TacticalMap — names: a feature\'s label is on the cell, and the grid says nothing about feet it does not know', () => {
  it('a feature\'s label joins the cell\'s accessible name (today it is a hover `title`, inert to keyboard and touch)', () => {
    render(<TacticalMap {...baseProps({ space: makeSpace({ features: [{ id: 'b', kind: 'prop', label: 'Brazier', at: [[1, 1]] }] }) })} />);
    expect(screen.getByRole('gridcell', { name: 'Row 2, column 2. Feature: Brazier. Empty.' })).toBeInTheDocument();
    expect(screen.getByRole('gridcell', { name: 'Row 1, column 1. Empty.' })).toBeInTheDocument();
  });

  it('with a null budget the grid\'s label says nothing about feet (it said "0 feet remaining")', () => {
    render(<TacticalMap {...baseProps({ participants: [makeParticipant({ name: 'Bren', at: [0, 0], movement_remaining: null })] })} />);
    expect(screen.getByRole('grid')).toHaveAttribute('aria-label', "Battle map, 5 columns by 5 rows. Bren's turn");
  });

  it('with a budget it still says so, and an unplaced mover\'s zero is a zero', () => {
    const { unmount } = render(<TacticalMap {...baseProps({ participants: [makeParticipant({ name: 'Bren', at: [0, 0], movement_remaining: 30 })] })} />);
    expect(screen.getByRole('grid')).toHaveAttribute('aria-label', "Battle map, 5 columns by 5 rows. Bren's turn, 30 feet remaining");
    unmount();
    render(<TacticalMap {...baseProps({ participants: [makeParticipant({ name: 'Bren', at: [0, 0], movement_remaining: 0 })] })} />);
    expect(screen.getByRole('grid')).toHaveAttribute('aria-label', "Battle map, 5 columns by 5 rows. Bren's turn, 0 feet remaining");
  });
});

// ── follow ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('TacticalMap — the follow rule: the fewest whole squares on the axis that needs it; never centred; a square in view never scrolls (Iro, brief 2.3)', () => {
  function mockRect(el: Element, r: { left: number; top: number; width: number; height: number }) {
    jest.spyOn(el, 'getBoundingClientRect').mockReturnValue({ ...r, right: r.left + r.width, bottom: r.top + r.height, x: r.left, y: r.top, toJSON: () => r } as DOMRect);
  }
  /** A 10x10 board of 40px squares in a 200x120 window (5 columns x 3 rows visible), laid out the way a browser would at the given scroll offsets. */
  function layout(container: HTMLElement, scroll: { left: number; top: number }, view = { width: 200, height: 120 }) {
    const win = container.querySelector('[data-board-window]') as HTMLElement;
    Object.defineProperty(win, 'clientWidth', { configurable: true, value: view.width });
    Object.defineProperty(win, 'clientHeight', { configurable: true, value: view.height });
    Object.defineProperty(win, 'scrollWidth', { configurable: true, value: 400 });
    Object.defineProperty(win, 'scrollHeight', { configurable: true, value: 400 });
    win.scrollLeft = scroll.left;
    win.scrollTop = scroll.top;
    mockRect(win, { left: 10, top: 10, width: view.width, height: view.height });
    container.querySelectorAll('[role="gridcell"]').forEach((cell, i) => {
      const x = i % 10; const y = Math.floor(i / 10);
      mockRect(cell, { left: 10 + x * 40 - scroll.left, top: 10 + y * 40 - scroll.top, width: 40, height: 40 });
    });
    return win;
  }
  const people = [
    makeParticipant({ participant_id: 'a', name: 'Aldo', at: [0, 0], movement_remaining: 30 }),
    makeParticipant({ participant_id: 'b', name: 'Bea', at: [2, 1], movement_remaining: 30 }),
    makeParticipant({ participant_id: 'c', name: 'Cal', is_pc: false, at: [7, 1], movement_remaining: 30 }),
    makeParticipant({ participant_id: 'd', name: 'Dov', is_pc: false, at: [2, 6], movement_remaining: 30 }),
    makeParticipant({ participant_id: 'e', name: 'Eli', is_pc: false, at: [8, 8], movement_remaining: 30 }),
  ];
  const props = (active: string, o: Partial<TacticalMapProps> = {}) => baseProps({ space: makeSpace({ width: 10, height: 10 }), participants: people, viewerParticipantId: 'a', activeParticipantId: active, ...o });

  it('a turn passing to a creature already wholly in view scrolls NOTHING (both offsets unchanged, no scrollIntoView)', () => {
    const intoView = jest.spyOn(Element.prototype, 'scrollIntoView');
    const { container, rerender } = render(<TacticalMap {...props('a')} />);
    const win = layout(container, { left: 40, top: 40 });
    rerender(<TacticalMap {...props('b')} />); // Bea at [2,1]: x 80..120, y 40..80 in a window showing x 40..240, y 40..160: wholly in
    expect(win.scrollLeft).toBe(40);
    expect(win.scrollTop).toBe(40);
    expect(intoView).not.toHaveBeenCalled();
    intoView.mockRestore();
  });

  it('a creature past the right edge moves the window sideways by the fewest whole squares, and not up or down', () => {
    const { container, rerender } = render(<TacticalMap {...props('a')} />);
    const win = layout(container, { left: 0, top: 0 });
    rerender(<TacticalMap {...props('c')} />); // Cal at [7,1]: x 280..320 in a window of x 0..200: needs 120 more, which is 3 squares
    expect(win.scrollLeft).toBe(120);
    expect(win.scrollTop).toBe(0);
  });

  it('a creature below the window moves it down only: [2,6] is y 240..280 in a window of y 0..120: 160 more, 4 squares', () => {
    const { container, rerender } = render(<TacticalMap {...props('a')} />);
    const win = layout(container, { left: 0, top: 0 });
    rerender(<TacticalMap {...props('d')} />);
    expect(win.scrollTop).toBe(160);
    expect(win.scrollLeft).toBe(0);
  });

  it('a creature past a corner moves both axes, each by what it needs; the end of the board clamps (never past it)', () => {
    const { container, rerender } = render(<TacticalMap {...props('a')} />);
    const win = layout(container, { left: 0, top: 0 });
    rerender(<TacticalMap {...props('e')} />); // [8,8]: x 320..360, y 320..360: needs 160 and 240, and 400-200 = 200 / 400-120 = 280 are the ends
    expect(win.scrollLeft).toBe(160);
    expect(win.scrollTop).toBe(240);
  });

  it('a creature before the start edge moves the window back by whole squares: scrolled to 120, a creature at x 40 needs 80 back', () => {
    const { container, rerender } = render(<TacticalMap {...props('c')} />);
    const win = layout(container, { left: 120, top: 0 });
    rerender(<TacticalMap {...props('a')} />); // Aldo at [0,0]: x -110..-70 on screen, which is 0..40 in the board: needs 120 back
    expect(win.scrollLeft).toBe(0);
  });

  it('it is NEVER centred: a creature that needs one square more than the window shows lands at the edge, not in the middle', () => {
    const { container, rerender } = render(<TacticalMap {...props('a')} />);
    const win = layout(container, { left: 0, top: 0 });
    rerender(<TacticalMap {...props('c')} />);
    const centred = 280 + 20 - 100; // what the old rule did: 200
    expect(win.scrollLeft).not.toBe(centred);
  });

  it('a turn change never scrolls the page', () => {
    const page = jest.spyOn(window, 'scrollTo').mockImplementation(() => {});
    const intoView = jest.spyOn(Element.prototype, 'scrollIntoView');
    const { container, rerender } = render(<TacticalMap {...props('a')} />);
    layout(container, { left: 0, top: 0 });
    rerender(<TacticalMap {...props('e')} />);
    expect(page).not.toHaveBeenCalled();
    expect(intoView).not.toHaveBeenCalled();
    page.mockRestore();
    intoView.mockRestore();
  });

  it('focus uses the same function: an arrow key into a square already in view leaves both offsets alone; one onto a hidden square moves the window by the fewest whole squares', () => {
    const { container } = render(<TacticalMap {...props('a')} />);
    const win = layout(container, { left: 0, top: 0 });
    const start = screen.getByRole('gridcell', { name: /Aldo — you/ });
    act(() => start.focus());
    fireEvent.keyDown(start, { key: 'ArrowRight' });
    expect(win.scrollLeft).toBe(0);
    expect(win.scrollTop).toBe(0);
    // walk right to the last visible column (index 4), then one more: index 5 is x 200..240, 40px past the window's end
    for (let i = 0; i < 3; i++) fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'ArrowRight' });
    expect(win.scrollLeft).toBe(0);
    layout(container, { left: 0, top: 0 });
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'ArrowRight' });
    expect(win.scrollLeft).toBe(40);
    expect(win.scrollTop).toBe(0);
  });

  it('the page may scroll only for the user\'s own focus move, and only when the square is STILL outside the viewport after the window has scrolled', () => {
    const intoView = jest.spyOn(Element.prototype, 'scrollIntoView');
    const { container } = render(<TacticalMap {...props('a')} />);
    layout(container, { left: 0, top: 0 });
    const start = screen.getByRole('gridcell', { name: /Aldo — you/ });
    act(() => start.focus());
    fireEvent.keyDown(start, { key: 'ArrowRight' });
    expect(intoView).not.toHaveBeenCalled(); // in the viewport: the window follow was enough
    const after = screen.getByRole('gridcell', { name: /Row 1, column 3\./ });
    mockRect(after, { left: 10, top: window.innerHeight + 500, width: 40, height: 40 }); // below the viewport, whatever the window did
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(after);
    expect(intoView).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' });
    intoView.mockRestore();
  });

  // A 220px window over 40px squares: columns 0-4 are whole and column 5 (x 200..240) shows 20 of its 40px. The real case is 980 / 34 = 28.8 columns (QA item 1, Kage T1).
  const NARROW = { width: 220, height: 120 };

  describe('a pointer on a partly visible square does not move the board under itself (T1)', () => {
    it('Move mode: the browser focuses the cut-off square on mousedown; the window does not scroll, and the click that follows commits the move', () => {
      const onMove = jest.fn();
      const { container } = render(<TacticalMap {...props('a', { moveMode: true, onMove })} />);
      const win = layout(container, { left: 0, top: 0 }, NARROW);
      const sliver = screen.getByRole('gridcell', { name: /Row 1, column 6\./ });
      fireEvent.mouseDown(sliver);
      act(() => sliver.focus()); // what the browser does on mousedown
      expect(win.scrollLeft).toBe(0);
      fireEvent.click(sliver);
      expect(onMove).toHaveBeenCalledWith([5, 0]);
      expect(win.scrollLeft).toBe(0);
    });

    it('observer: the same pointer chooses the square for the line and takes the roving stop, and scrolls nothing', () => {
      const onInspect = jest.fn();
      const withFoe = [people[0], makeParticipant({ participant_id: 'g', name: 'Gob', is_pc: false, at: [5, 0] })];
      const { container } = render(<TacticalMap {...props('a', { participants: withFoe, showReach: true, onInspect })} />);
      const win = layout(container, { left: 0, top: 0 }, NARROW);
      const sliver = screen.getByRole('gridcell', { name: /Gob, hostile/ });
      act(() => sliver.focus());
      fireEvent.click(sliver);
      expect(win.scrollLeft).toBe(0);
      expect(sliver).toHaveAttribute('tabindex', '0');
      expect(onInspect.mock.calls[onInspect.mock.calls.length - 1][0]).toMatchObject({ kind: 'cell', input: { occupant: { name: 'Gob' } } });
    });

    it('THE CONTROL: an arrow key onto the same cut-off square DOES follow, by one whole square (the mocks are live and the keyboard still follows)', () => {
      const { container } = render(<TacticalMap {...props('a')} />);
      const win = layout(container, { left: 0, top: 0 }, NARROW);
      const start = screen.getByRole('gridcell', { name: /Aldo — you/ });
      act(() => start.focus());
      for (let i = 0; i < 4; i++) fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'ArrowRight' });
      expect(win.scrollLeft).toBe(0); // column 4 is whole
      fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'ArrowRight' });
      expect(document.activeElement).toBe(screen.getByRole('gridcell', { name: /Row 1, column 6\./ }));
      expect(win.scrollLeft).toBe(40);
    });

    it('a pointer on a square, then an arrow from it: the follow resumes from the clicked square', () => {
      const { container } = render(<TacticalMap {...props('a')} />);
      const win = layout(container, { left: 0, top: 0 }, NARROW);
      const sliver = screen.getByRole('gridcell', { name: /Row 1, column 6\./ });
      act(() => sliver.focus());
      expect(win.scrollLeft).toBe(0);
      fireEvent.keyDown(sliver, { key: 'ArrowRight' }); // column 7: x 240..280, wholly out
      expect(win.scrollLeft).toBe(80);
    });

    it('Move engaged still takes focus into the grid at the mover and follows it (the map\'s own focus move)', () => {
      const { container, rerender } = render(<TacticalMap {...props('e')} />);
      const win = layout(container, { left: 0, top: 0 });
      rerender(<TacticalMap {...props('e', { moveMode: true })} />);
      expect(document.activeElement).toBe(screen.getByRole('gridcell', { name: /Row 9, column 9\./ }));
      expect(win.scrollLeft).toBe(160); // [8,8]: x 320..360 over a 200 window
    });
  });

  describe('the turn follow runs once per turn, not once per poll (T2)', () => {
    const poll = (ps: CombatParticipantState[]) => ps.map((p) => ({ ...p })); // every poll is a fresh parse: new space object, new participant objects

    it('the same turn, a NEW space object, and a window the user scrolled by hand so the mover is out of view: the window stays where the user left it', () => {
      const { container, rerender } = render(<TacticalMap {...props('a')} />);
      const win = layout(container, { left: 160, top: 160 }); // Aldo at [0,0] is far out of view
      rerender(<TacticalMap {...props('a', { space: makeSpace({ width: 10, height: 10 }), participants: poll(people) })} />);
      expect(win.scrollLeft).toBe(160);
      expect(win.scrollTop).toBe(160);
    });

    it('the same turn, the mover steps one square (its `at` changes) while the window is scrolled elsewhere by hand: still no follow (the once-per-turn guard, which the deps alone do not give)', () => {
      const { container, rerender } = render(<TacticalMap {...props('a')} />);
      const win = layout(container, { left: 160, top: 160 });
      const stepped = people.map((p) => (p.participant_id === 'a' ? { ...p, at: [1, 0] as [number, number] } : { ...p }));
      rerender(<TacticalMap {...props('a', { participants: stepped })} />);
      expect(win.scrollLeft).toBe(160);
      expect(win.scrollTop).toBe(160);
    });

    it('THE CONTROL: under the same mocks a real turn change to a creature out of view DOES scroll (so the case above is not green because nothing could scroll)', () => {
      const { container, rerender } = render(<TacticalMap {...props('a')} />);
      const win = layout(container, { left: 160, top: 160 });
      rerender(<TacticalMap {...props('b', { space: makeSpace({ width: 10, height: 10 }), participants: poll(people) })} />); // Bea at [2,1]: x 80..120, y 40..80
      expect(win.scrollLeft).toBe(80);
      expect(win.scrollTop).toBe(40);
    });

    it.each([
      ['an unplaced creature', 'u'],
      ['a placed creature (the control)', 'b'],
    ])('turn a, then %s, then a again: a\'s new turn follows (the turn is recorded before the placement check)', (_label, between) => {
      const everyone = [...people, makeParticipant({ participant_id: 'u', name: 'Ula', is_pc: false, at: null })];
      const { container, rerender } = render(<TacticalMap {...props('a', { participants: everyone })} />);
      const win = layout(container, { left: 0, top: 0 });
      rerender(<TacticalMap {...props(between, { participants: poll(everyone) })} />);
      win.scrollLeft = 160; win.scrollTop = 160; // the window sits somewhere Aldo cannot be seen
      layout(container, { left: 160, top: 160 });
      rerender(<TacticalMap {...props('a', { participants: poll(everyone) })} />);
      expect(win.scrollLeft).toBe(0);
      expect(win.scrollTop).toBe(0);
    });
  });
});

// ── the Move sync's cause ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Kept from Kage-CR's B8c-3 re-verify: the one write site of the focus state whose cause no other case distinguishes. Mutation: the sync writes `native` -> red.
describe('TacticalMap — Move engaged and the grid holding focus: the mover\'s own move landing takes DOM focus to the token\'s new square (the `sync` cause)', () => {
  const sixBySix = () => makeSpace({ width: 6, height: 6 });
  const bren = (o: Partial<CombatParticipantState> = {}) => makeParticipant({ name: 'Bren', at: [1, 1], movement_remaining: 30, ...o });
  const engaged = (o: Partial<TacticalMapProps> = {}) => baseProps({ space: sixBySix(), participants: [bren()], moveMode: true, ...o });

  it('focus and the roving stop are on the token\'s new square, and there is exactly one stop', () => {
    const { rerender, container } = render(<TacticalMap {...engaged()} />);
    const start = screen.getByRole('gridcell', { name: /Bren — you/ });
    expect(document.activeElement).toBe(start); // Move engaged took focus in
    fireEvent.keyDown(start, { key: 'ArrowRight' });
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'ArrowRight' }); // the cursor is on [3,1]; the move lands on [2,1]
    rerender(<TacticalMap {...engaged({ participants: [bren({ at: [2, 1], movement_remaining: 25 })], movedSeq: 1 })} />); // the viewer's own move landed: the mount bumps movedSeq with the new state
    const token = screen.getByRole('gridcell', { name: /Bren — you/ });
    expect(token).toHaveAttribute('tabindex', '0');
    expect(container.querySelectorAll('[role="gridcell"][tabindex="0"]')).toHaveLength(1);
    expect(document.activeElement).toBe(token);
  });
});

// ══ P2 — the map's window (B8c-4, Sora's brief section 5; Revision 2) ═══════════════════════════════════════════════════════════════════
// jsdom has no layout and no touch: every box below is a mock and every "scroll" is an assignment. What each case pins is MECHANISM (the arithmetic and the wiring of the rule);
// what a finger or a real scroller does is the harness's and a device's (brief section 14 items 8, 9, 11, 14).
function mockBox(el: Element, r: { left: number; top: number; width: number; height: number }) {
  jest.spyOn(el, 'getBoundingClientRect').mockReturnValue({ ...r, right: r.left + r.width, bottom: r.top + r.height, x: r.left, y: r.top, toJSON: () => r } as DOMRect);
}
/** A 10x10 board of 40px squares in a window of `view` at (10,10), laid out at the given scroll. */
function layoutP2(container: HTMLElement, scroll: { left: number; top: number }, view = { width: 200, height: 120 }) {
  const win = container.querySelector('[data-board-window]') as HTMLElement;
  Object.defineProperty(win, 'clientWidth', { configurable: true, value: view.width });
  Object.defineProperty(win, 'clientHeight', { configurable: true, value: view.height });
  Object.defineProperty(win, 'scrollWidth', { configurable: true, value: 400 });
  Object.defineProperty(win, 'scrollHeight', { configurable: true, value: 400 });
  win.scrollLeft = scroll.left;
  win.scrollTop = scroll.top;
  mockBox(win, { left: 10, top: 10, width: view.width, height: view.height });
  container.querySelectorAll('[role="gridcell"]').forEach((cell, i) => mockBox(cell, { left: 10 + (i % 10) * 40 - scroll.left, top: 10 + Math.floor(i / 10) * 40 - scroll.top, width: 40, height: 40 }));
  return win;
}
const crew = [
  makeParticipant({ participant_id: 'a', name: 'Aldo', at: [0, 0], movement_remaining: 30 }),
  makeParticipant({ participant_id: 'e4', name: 'Edge4', is_pc: false, at: [4, 1], movement_remaining: 30 }), // the last visible column of a 5-column window
  makeParticipant({ participant_id: 'r3', name: 'Row3', is_pc: false, at: [1, 3], movement_remaining: 30 }), // the first row below a 3-row window
  makeParticipant({ participant_id: 'mid', name: 'Mid', is_pc: false, at: [2, 1], movement_remaining: 30 }),
];
const crewProps = (active: string, o: Partial<TacticalMapProps> = {}) => baseProps({ space: makeSpace({ width: 10, height: 10 }), participants: crew, viewerParticipantId: 'a', activeParticipantId: active, ...o });
const withMargin = (win: HTMLElement, squares: number) => win.style.setProperty('--tm-follow-margin', String(squares));

describe('TacticalMap — P2: the follow margin applies to the map\'s OWN follows only; the square whole outranks it', () => {
  it('margin 0 (the default; nothing sets the property) is today\'s behaviour: a turn passing to the last visible column scrolls nothing', () => {
    const { container, rerender } = render(<TacticalMap {...crewProps('a')} />);
    const win = layoutP2(container, { left: 0, top: 0 });
    rerender(<TacticalMap {...crewProps('e4')} />);
    expect(win.scrollLeft).toBe(0);
    expect(win.scrollTop).toBe(0);
  });

  it('with the property at 1, the same turn change brings one more column in (the mover and one square around it stay in view): by one whole square', () => {
    const { container, rerender } = render(<TacticalMap {...crewProps('a')} />);
    const win = layoutP2(container, { left: 0, top: 0 });
    withMargin(win, 1);
    rerender(<TacticalMap {...crewProps('e4')} />);
    expect(win.scrollLeft).toBe(40);
    expect(win.scrollTop).toBe(0); // row 1 of a window of rows 0-2 has its margin: the vertical axis does not move
  });

  it('a turn to a creature whose margin is already in view moves nothing, with the property at 1', () => {
    const { container, rerender } = render(<TacticalMap {...crewProps('a')} />);
    const win = layoutP2(container, { left: 0, top: 0 });
    withMargin(win, 1);
    rerender(<TacticalMap {...crewProps('mid')} />);
    expect(win.scrollLeft).toBe(0);
    expect(win.scrollTop).toBe(0);
  });

  it('THE SQUARE WHOLE OUTRANKS THE MARGIN: in a 2-row window (it cannot hold a square and a margin either side) the turn lands the square whole, exactly where margin 0 puts it', () => {
    const { container, rerender } = render(<TacticalMap {...crewProps('a')} />);
    const win = layoutP2(container, { left: 0, top: 0 }, { width: 200, height: 80 });
    withMargin(win, 1);
    rerender(<TacticalMap {...crewProps('r3')} />); // row 3: y 120..160 of 0..80: margin 0 -> 80 (rows 2-3); a margin kept would have left 120
    expect(win.scrollTop).toBe(80);
  });

  it('a user\'s focus move NEVER takes the margin: an arrow onto the last visible column scrolls nothing with the property at 1 (Iro\'s desktop cases)', () => {
    const { container } = render(<TacticalMap {...crewProps('a')} />);
    const win = layoutP2(container, { left: 0, top: 0 });
    withMargin(win, 1);
    const start = screen.getByRole('gridcell', { name: /Aldo — you/ });
    act(() => start.focus());
    for (let i = 0; i < 4; i++) fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(screen.getByRole('gridcell', { name: /Row 1, column 5\./ }));
    expect(win.scrollLeft).toBe(0);
  });

  it('arming Move takes margin 0 too: the mover in the last visible column is focused and the window stays; the move LANDING one square on (the map\'s own follow) takes the margin', () => {
    const where = (at: [number, number]) => crew.map((p) => (p.participant_id === 'e4' ? { ...p, at } : p));
    const { container, rerender } = render(<TacticalMap {...crewProps('e4', { participants: where([4, 1]) })} />);
    const win = layoutP2(container, { left: 0, top: 0 });
    withMargin(win, 1);
    rerender(<TacticalMap {...crewProps('e4', { participants: where([4, 1]), moveMode: true })} />); // arming
    expect(document.activeElement).toBe(screen.getByRole('gridcell', { name: /Row 2, column 5\./ }));
    expect(win.scrollLeft).toBe(0);
    layoutP2(container, { left: 0, top: 0 });
    withMargin(win, 1);
    rerender(<TacticalMap {...crewProps('e4', { participants: where([4, 2]), moveMode: true, movedSeq: 1 })} />); // landing, Move still engaged
    expect(win.scrollLeft).toBe(40);
  });
});

describe('TacticalMap — P2: every follow waits while a touch is on the window and for 150 ms after its last scroll event, then runs ONCE (Tora-Gesture C-1)', () => {
  // `Cal` is two columns past a 5-column window; `Dov` is two rows below a 3-row one.
  const folk = [
    makeParticipant({ participant_id: 'a', name: 'Aldo', at: [0, 0], movement_remaining: 30 }),
    makeParticipant({ participant_id: 'c', name: 'Cal', is_pc: false, at: [6, 0], movement_remaining: 30 }),
    makeParticipant({ participant_id: 'd', name: 'Dov', is_pc: false, at: [0, 4], movement_remaining: 30 }),
  ];
  const at = (active: string, o: Partial<TacticalMapProps> = {}) => baseProps({ space: makeSpace({ width: 10, height: 10 }), participants: folk, viewerParticipantId: 'a', activeParticipantId: active, ...o });
  /** The window with a counter on every assignment to its offsets. */
  function counted(container: HTMLElement) {
    const win = layoutP2(container, { left: 0, top: 0 });
    const writes: Array<['left' | 'top', number]> = [];
    let left = 0; let top = 0;
    Object.defineProperty(win, 'scrollLeft', { configurable: true, get: () => left, set: (v: number) => { left = v; writes.push(['left', v]); } });
    Object.defineProperty(win, 'scrollTop', { configurable: true, get: () => top, set: (v: number) => { top = v; writes.push(['top', v]); } });
    return { win, writes };
  }
  // a finger ON THE BOARD (a finger on the page's body would not hold the gate: it counts only fingers on the window)
  const touches = [{ identifier: 1, get target() { return document.querySelector('[data-board-window]'); }, clientX: 5, clientY: 5 }];
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('with a touch on the window a turn change scrolls nothing; the finger lifting runs it once (a quiet window needs no more wait)', () => {
    const { container, rerender } = render(<TacticalMap {...at('a')} />);
    const { win, writes } = counted(container);
    fireEvent.touchStart(win, { touches });
    rerender(<TacticalMap {...at('c')} />);
    act(() => { jest.advanceTimersByTime(1000); });
    expect(writes).toHaveLength(0);
    fireEvent.touchEnd(win, { touches: [] });
    expect(writes.filter(([k]) => k === 'left')).toEqual([['left', 80]]);
  });

  it('a second finger keeps it held: only the last touch lifting releases it', () => {
    const { container, rerender } = render(<TacticalMap {...at('a')} />);
    const { win, writes } = counted(container);
    fireEvent.touchStart(win, { touches: [...touches, { ...touches[0], identifier: 2 }] });
    rerender(<TacticalMap {...at('c')} />);
    fireEvent.touchEnd(win, { touches }); // one finger still down
    expect(writes).toHaveLength(0);
    fireEvent.touchCancel(win, { touches: [] });
    expect(writes.filter(([k]) => k === 'left')).toEqual([['left', 80]]);
  });

  it('after a scroll event a follow waits 150 ms from it, and a later scroll event moves the wait out; it then runs once', () => {
    const { container, rerender } = render(<TacticalMap {...at('a')} />);
    const { win, writes } = counted(container);
    fireEvent.scroll(win); // the user's own scroll (momentum): the window is busy
    rerender(<TacticalMap {...at('c')} />);
    act(() => { jest.advanceTimersByTime(100); });
    fireEvent.scroll(win); // still moving: 150 ms from THIS one
    act(() => { jest.advanceTimersByTime(149); });
    expect(writes).toHaveLength(0);
    act(() => { jest.advanceTimersByTime(1); });
    expect(writes.filter(([k]) => k === 'left')).toEqual([['left', 80]]);
  });

  it('turn changes while it waits collapse to ONE follow, to where the LAST mover is (not a replay of each)', () => {
    const { container, rerender } = render(<TacticalMap {...at('a')} />);
    const { win, writes } = counted(container);
    fireEvent.touchStart(win, { touches });
    rerender(<TacticalMap {...at('c')} />);
    rerender(<TacticalMap {...at('d')} />);
    fireEvent.touchEnd(win, { touches: [] });
    expect(writes).toEqual([['left', 0], ['top', 80]]); // the one follow writes both axes: left stays 0, top goes to the row-4 square's whole-square offset
  });

  it('a scroll event the map\'s own follow caused does not hold the next follow off (two follows 100 ms apart would otherwise block each other)', () => {
    const { container, rerender } = render(<TacticalMap {...at('a')} />);
    const { win, writes } = counted(container);
    rerender(<TacticalMap {...at('c')} />);
    expect(writes.filter(([k]) => k === 'left')).toEqual([['left', 80]]);
    fireEvent.scroll(win); // the event our assignment raised: same offsets
    writes.length = 0;
    rerender(<TacticalMap {...at('d')} />);
    expect(writes.length).toBeGreaterThan(0); // ran at once, no wait
  });

  it('THE CONTROL: with no touch and no scroll the follow is immediate (the gate adds nothing to a quiet window)', () => {
    const { container, rerender } = render(<TacticalMap {...at('a')} />);
    const { writes } = counted(container);
    rerender(<TacticalMap {...at('c')} />);
    expect(writes.filter(([k]) => k === 'left')).toEqual([['left', 80]]);
  });

  it('an arrow key\'s follow waits too (every follow does); focus itself does not wait', () => {
    const { container } = render(<TacticalMap {...at('a')} />);
    const { win, writes } = counted(container);
    const start = screen.getByRole('gridcell', { name: /Aldo — you/ });
    act(() => start.focus());
    for (let i = 0; i < 4; i++) fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'ArrowRight' });
    fireEvent.touchStart(win, { touches });
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'ArrowRight' }); // column 6: a cut-off square
    expect(document.activeElement).toBe(screen.getByRole('gridcell', { name: /Row 1, column 6\./ }));
    expect(writes).toHaveLength(0);
    fireEvent.touchEnd(win, { touches: [] });
    expect(writes.length).toBeGreaterThan(0);
  });

  it('F3 — a touch that ends on a REMOVED window does not leave the gate held: finger down, the board goes (combat ends), the finger lifts unheard, the board returns, a turn passes: it follows', () => {
    const { container, rerender } = render(<TacticalMap {...at('a')} />);
    const win = layoutP2(container, { left: 0, top: 0 });
    fireEvent.touchStart(win, { touches });
    rerender(<TacticalMap {...at('a', { space: null })} />); // the window leaves the tree with the finger on it
    rerender(<TacticalMap {...at('a')} />); // and comes back, a new element
    const back = layoutP2(container, { left: 0, top: 0 });
    rerender(<TacticalMap {...at('c')} />);
    expect(back.scrollLeft).toBe(80);
  });

  describe('the gate counts the fingers on the WINDOW, not every finger on the screen (Kage-CR)', () => {
    /** A touch event as the window hears it: `touches` is every finger on the SCREEN, each with the element it started on. */
    const touchOf = (win: HTMLElement, type: string, targets: Element[]) => {
      const e = new Event(type, { bubbles: true });
      Object.defineProperty(e, 'touches', { value: targets.map((target) => ({ target })) });
      act(() => { win.dispatchEvent(e); });
    };

    it('a second finger resting OFF the board does not hold the gate once the board\'s own finger has lifted: the turn follow runs', () => {
      const log = document.createElement('div');
      document.body.appendChild(log);
      const { container, rerender } = render(<TacticalMap {...at('a')} />);
      const win = layoutP2(container, { left: 0, top: 0 });
      const cell = container.querySelector('[role="gridcell"]') as HTMLElement;
      touchOf(win, 'touchstart', [cell]); // finger 1 on the board (finger 2 then lands on the log: the board does not hear that)
      touchOf(win, 'touchend', [log]); // finger 1 lifts; finger 2 is still on the log
      rerender(<TacticalMap {...at('c')} />);
      act(() => { jest.advanceTimersByTime(1000); });
      expect([win.scrollLeft, win.scrollTop]).toEqual([80, 0]);
      log.remove();
    });

    it('THE CONTROL: a finger still ON the board holds it, and its lift releases it', () => {
      const { container, rerender } = render(<TacticalMap {...at('a')} />);
      const win = layoutP2(container, { left: 0, top: 0 });
      const [c1, c2] = Array.from(container.querySelectorAll('[role="gridcell"]')) as HTMLElement[];
      touchOf(win, 'touchstart', [c1, c2]);
      touchOf(win, 'touchend', [c2]); // one of two board fingers lifts: still touching
      rerender(<TacticalMap {...at('c')} />);
      act(() => { jest.advanceTimersByTime(1000); });
      expect([win.scrollLeft, win.scrollTop]).toEqual([0, 0]);
      touchOf(win, 'touchend', []);
      act(() => { jest.advanceTimersByTime(1000); });
      expect([win.scrollLeft, win.scrollTop]).toEqual([80, 0]);
    });
  });

  describe('a turn passing while the grid holds focus: the mover ends WHOLE; the held square is kept when both fit; DOM focus is never moved', () => {
    const cellAt = (container: HTMLElement, x: number, y = 0) => container.querySelectorAll('[role="gridcell"]')[y * 10 + x] as HTMLElement;

    it('A4 — they cannot both be in the window (focus on column 0, the turn passes to column 6 of a 5-column window): the MOVER wins, and DOM focus is not moved', () => {
      const { container, rerender } = render(<TacticalMap {...at('a')} />);
      const win = layoutP2(container, { left: 0, top: 0 });
      const held = cellAt(container, 0);
      act(() => { held.focus(); });
      rerender(<TacticalMap {...at('c')} />);
      expect(win.scrollLeft).toBe(80);
      expect(document.activeElement).toBe(held);
    });

    it('condition B — after the mover wins, ONE arrow key brings the target square back wholly into the window: the fewest whole squares, margin 0 (a user\'s own move)', () => {
      const { container, rerender } = render(<TacticalMap {...at('a')} />);
      let win = layoutP2(container, { left: 0, top: 0 });
      withMargin(win, 1);
      const held = cellAt(container, 0);
      act(() => { held.focus(); });
      rerender(<TacticalMap {...at('c')} />);
      expect(win.scrollLeft).toBe(120); // the mover wins with its margin: column 0 is out
      win = layoutP2(container, { left: 120, top: 0 }); // the boxes as the browser lays them out at 120
      withMargin(win, 1);
      fireEvent.keyDown(held, { key: 'ArrowRight' }); // column 1: x 40..80, out of a window showing 120..320
      expect(document.activeElement).toBe(cellAt(container, 1));
      expect(win.scrollLeft).toBe(40); // with NO margin: 80 would be a margin square past it
    });

    it('A3 — both fit (focus on column 2): columns 2..6 hold both', () => {
      const { container, rerender } = render(<TacticalMap {...at('a')} />);
      const win = layoutP2(container, { left: 0, top: 0 });
      act(() => { cellAt(container, 2).focus(); });
      rerender(<TacticalMap {...at('c')} />);
      expect(win.scrollLeft).toBe(80);
    });

    it('A3 — the mover\'s MARGIN gives way before the held square does: with margin 1 the mover alone would go to 120 and cut column 2; it goes to 80', () => {
      const { container, rerender } = render(<TacticalMap {...at('a')} />);
      const win = layoutP2(container, { left: 0, top: 0 });
      withMargin(win, 1);
      act(() => { cellAt(container, 2).focus(); });
      rerender(<TacticalMap {...at('c')} />);
      expect(win.scrollLeft).toBe(80);
    });

    it('THE CONTROL for the margin: the same turn with no focus in the grid takes the margin (120)', () => {
      const { container, rerender } = render(<TacticalMap {...at('a')} />);
      const win = layoutP2(container, { left: 0, top: 0 });
      withMargin(win, 1);
      rerender(<TacticalMap {...at('c')} />);
      expect(win.scrollLeft).toBe(120);
    });

    it('A1 — a square a CLICK or a TAP focused (not :focus-visible) is not held: the plain mover follow runs, so a mouse click does not stop the board showing whose turn it is', () => {
      const { container, rerender } = render(<TacticalMap {...at('a')} />);
      const win = layoutP2(container, { left: 0, top: 0 });
      const clicked = cellAt(container, 2);
      const real = clicked.matches.bind(clicked);
      jest.spyOn(clicked, 'matches').mockImplementation((q: string) => (q === ':focus-visible' ? false : real(q)));
      withMargin(win, 1);
      act(() => { clicked.focus(); });
      rerender(<TacticalMap {...at('c')} />);
      expect(win.scrollLeft).toBe(120); // the mover alone, margin and all: column 2 is not protected
      expect(document.activeElement).toBe(clicked);
    });

    it('A1 — THE CONTROL: the same square when it IS :focus-visible (a key put focus there) is held, and the margin gives way (80)', () => {
      const { container, rerender } = render(<TacticalMap {...at('a')} />);
      const win = layoutP2(container, { left: 0, top: 0 });
      withMargin(win, 1);
      act(() => { cellAt(container, 2).focus(); });
      rerender(<TacticalMap {...at('c')} />);
      expect(win.scrollLeft).toBe(80);
    });

    it('two arrows under a held gate end on the LAST square (the focus kind\'s newer request replaces the older)', () => {
      const { container } = render(<TacticalMap {...at('a')} />);
      const win = layoutP2(container, { left: 0, top: 0 });
      act(() => { cellAt(container, 3).focus(); });
      fireEvent.touchStart(win, { touches });
      fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'ArrowRight' }); // column 4: whole
      fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'ArrowRight' }); // column 5: cut at the right edge
      expect(document.activeElement).toBe(cellAt(container, 5));
      expect(win.scrollLeft).toBe(0);
      fireEvent.touchEnd(win, { touches: [] });
      expect(win.scrollLeft).toBe(40); // one square: the LAST square whole
    });
  });

  describe('1a — a touch whose target is removed under the finger does not stick the gate (Tora-Gesture)', () => {
    const touchOn = (target: Element, type: string, targets: Element[]) => {
      const e = new Event(type, { bubbles: true });
      Object.defineProperty(e, 'touches', { value: targets.map((t) => ({ target: t })) });
      act(() => { target.dispatchEvent(e); });
    };

    it('finger down on a token, a poll removes the token, the finger lifts (the end goes to the DETACHED node and never bubbles): the next turn follows', () => {
      const { container, rerender } = render(<TacticalMap {...at('a')} />);
      const win = layoutP2(container, { left: 0, top: 0 });
      const token = document.createElement('span'); // stands for the token span inside a cell
      win.appendChild(token);
      touchOn(token, 'touchstart', [token]);
      token.remove();
      touchOn(token, 'touchend', []); // dispatched on the detached node: the window never hears it
      rerender(<TacticalMap {...at('c')} />);
      expect(win.scrollLeft).toBe(80);
    });

    it('the touch\'s own target hears touchcancel too: a cancel sent to the detached node releases the gate', () => {
      const { container, rerender } = render(<TacticalMap {...at('a')} />);
      const win = layoutP2(container, { left: 0, top: 0 });
      const token = document.createElement('span');
      win.appendChild(token);
      touchOn(token, 'touchstart', [token]);
      token.remove();
      touchOn(token, 'touchcancel', []);
      rerender(<TacticalMap {...at('c')} />);
      expect(win.scrollLeft).toBe(80);
    });

    it('the backstop counts from the finger\'s LAST MOVEMENT: a finger at rest releases 5 s after the window last scrolled, not 5 s after it went down', () => {
      const { container, rerender } = render(<TacticalMap {...at('a')} />);
      const win = layoutP2(container, { left: 0, top: 0 });
      fireEvent.touchStart(win, { touches });
      act(() => { jest.advanceTimersByTime(3000); });
      fireEvent.scroll(win); // the last movement, 3 s in
      rerender(<TacticalMap {...at('c')} />);
      act(() => { jest.advanceTimersByTime(4999); }); // 7999 ms after the touch began, 4999 after the last movement
      expect(win.scrollLeft).toBe(0);
      act(() => { jest.advanceTimersByTime(1); });
      expect(win.scrollLeft).toBe(80);
    });

    it('a slow pan never releases it: a scroll event every second for 12 s keeps the gate held; the follow runs 5 s after the last one', () => {
      const { container, rerender } = render(<TacticalMap {...at('a')} />);
      const win = layoutP2(container, { left: 0, top: 0 });
      fireEvent.touchStart(win, { touches });
      rerender(<TacticalMap {...at('c')} />);
      for (let i = 0; i < 12; i++) {
        act(() => { jest.advanceTimersByTime(1000); });
        fireEvent.scroll(win);
      }
      expect(win.scrollLeft).toBe(0);
      act(() => { jest.advanceTimersByTime(5000); });
      expect(win.scrollLeft).toBe(80);
    });

    it('THE CONTROL: with the finger still down on the token the follow waits', () => {
      const { container, rerender } = render(<TacticalMap {...at('a')} />);
      const win = layoutP2(container, { left: 0, top: 0 });
      const token = document.createElement('span');
      win.appendChild(token);
      touchOn(token, 'touchstart', [token]);
      rerender(<TacticalMap {...at('c')} />);
      expect(win.scrollLeft).toBe(0);
    });

    it('the 5 s BACKSTOP: a touch that never reports its end releases the gate after 5 s, and not before', () => {
      const { container, rerender } = render(<TacticalMap {...at('a')} />);
      const win = layoutP2(container, { left: 0, top: 0 });
      fireEvent.touchStart(win, { touches });
      rerender(<TacticalMap {...at('c')} />);
      act(() => { jest.advanceTimersByTime(4999); });
      expect(win.scrollLeft).toBe(0);
      act(() => { jest.advanceTimersByTime(1); });
      expect(win.scrollLeft).toBe(80);
    });

    it('1b — a touchstart clears the own-scroll mark: the user\'s scroll that lands on the follow\'s own offset is the user\'s, and holds the next follow', () => {
      const { container, rerender } = render(<TacticalMap {...at('a')} />);
      const win = layoutP2(container, { left: 0, top: 0 });
      rerender(<TacticalMap {...at('c')} />); // the follow writes 80 and marks it its own; the browser raised no scroll event for it
      expect(win.scrollLeft).toBe(80);
      fireEvent.touchStart(win, { touches });
      fireEvent.touchEnd(win, { touches: [] });
      layoutP2(container, { left: 80, top: 0 }); // the boxes as the browser lays them out at 80
      fireEvent.scroll(win); // the user's scroll, ending exactly on 80
      rerender(<TacticalMap {...at('a')} />); // the turn passes back: Aldo at column 0 is out of view
      expect(win.scrollLeft).toBe(80); // held by the settle
      act(() => { jest.advanceTimersByTime(150); });
      expect(win.scrollLeft).toBe(0);
    });
  });

  it('the touch listeners are passive: nothing here can cancel a gesture', () => {
    const add = jest.spyOn(EventTarget.prototype, 'addEventListener');
    render(<TacticalMap {...at('a')} />);
    for (const type of ['touchstart', 'touchend', 'touchcancel', 'scroll']) {
      const call = add.mock.calls.find((c) => c[0] === type && typeof c[2] === 'object'); // React's own root listeners pass a boolean
      expect(call?.[2]).toEqual({ passive: true });
    }
    add.mockRestore();
  });
});

describe('TacticalMap — P2: the window re-follows when it gets a box or its WIDTH changes, or the mover is cut; never on a pure height step; losing its box exits Move', () => {
  class FakeResizeObserver {
    static all: FakeResizeObserver[] = [];
    target!: Element;
    constructor(public cb: () => void) {}
    observe(t: Element) { this.target = t; FakeResizeObserver.all.push(this); }
    unobserve() {}
    disconnect() { FakeResizeObserver.all = FakeResizeObserver.all.filter((o) => o !== this); }
  }
  // A pure height step moves the window's box and neither the room's nor the grid's: this fires the room's and the window's observers, never the grid's.
  const resized = () => act(() => { FakeResizeObserver.all.filter((o) => !o.target.matches('[role="grid"]')).forEach((o) => o.cb()); });
  beforeEach(() => { FakeResizeObserver.all = []; (globalThis as { ResizeObserver?: unknown }).ResizeObserver = FakeResizeObserver; });
  afterEach(() => { delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver; });

  // Cal is two columns past a 5-column window and Edge4 is in its last visible column; both are placed at rest, so the turn follow at mount has nothing laid out to read.
  const folk = [
    makeParticipant({ participant_id: 'a', name: 'Aldo', at: [0, 0], movement_remaining: 30 }),
    makeParticipant({ participant_id: 'c', name: 'Cal', is_pc: false, at: [6, 0], movement_remaining: 30 }),
    makeParticipant({ participant_id: 'e4', name: 'Edge4', is_pc: false, at: [4, 1], movement_remaining: 30 }),
  ];
  const at = (active: string, o: Partial<TacticalMapProps> = {}) => baseProps({ space: makeSpace({ width: 10, height: 10 }), participants: folk, viewerParticipantId: 'a', activeParticipantId: active, ...o });
  const noBox = (win: HTMLElement) => { Object.defineProperty(win, 'clientWidth', { configurable: true, value: 0 }); Object.defineProperty(win, 'clientHeight', { configurable: true, value: 0 }); };

  it('a window that gets a box (a folded body unfolding) follows the mover, which the fold had left out of view', () => {
    const { container } = render(<TacticalMap {...at('c')} />);
    const win = container.querySelector('[data-board-window]') as HTMLElement;
    noBox(win);
    resized(); // still folded: no box, nothing to do
    expect(win.scrollLeft).toBe(0);
    layoutP2(container, { left: 0, top: 0 });
    resized(); // the box arrives
    expect(win.scrollLeft).toBe(80); // Cal at column 6 -> columns 2-6
  });

  it('a gained box follows with the margin (the map\'s own follow)', () => {
    const { container } = render(<TacticalMap {...at('e4')} />);
    const win = layoutP2(container, { left: 0, top: 0 });
    withMargin(win, 1);
    resized();
    expect(win.scrollLeft).toBe(40);
  });

  it('a WIDTH change follows (a rotation), by the margin when only the margin needs it: the mover stays wholly in view, so nothing else would have moved the window', () => {
    const { container } = render(<TacticalMap {...at('e4')} />);
    const win = layoutP2(container, { left: 0, top: 0 }, { width: 240, height: 120 }); // 6 columns
    resized(); // the box (the margin is not set yet: nothing moves)
    expect(win.scrollLeft).toBe(0);
    withMargin(win, 1);
    layoutP2(container, { left: 0, top: 0 }, { width: 200, height: 120 }); // 5 columns: Edge4 (column 4) is wholly in view, and one square short of its margin
    resized();
    expect(win.scrollLeft).toBe(40);
  });

  it('a width change that cuts the mover follows it too', () => {
    const { container } = render(<TacticalMap {...at('c')} />);
    const win = layoutP2(container, { left: 0, top: 0 }, { width: 280, height: 120 }); // Cal at column 6 fits in 7 columns
    resized();
    expect(win.scrollLeft).toBe(0);
    layoutP2(container, { left: 0, top: 0 }, { width: 200, height: 120 });
    resized();
    expect(win.scrollLeft).toBe(80);
  });

  it('a box gained at the SAME width follows too (a body squeezed to 0 high keeps its width: the width trigger alone would miss it)', () => {
    const { container } = render(<TacticalMap {...at('e4')} />);
    const win = layoutP2(container, { left: 0, top: 0 });
    resized(); // the first box: the margin is not set yet, nothing moves
    withMargin(win, 1);
    Object.defineProperty(win, 'clientHeight', { configurable: true, value: 0 });
    resized(); // no box (height 0, width still 200)
    layoutP2(container, { left: 0, top: 0 });
    resized(); // a box again, the same 200 wide; the mover is wholly in view, so only the margin moves the window
    expect(win.scrollLeft).toBe(40);
  });

  it('a PURE HEIGHT STEP follows nothing, even with the margin on and the mover inside its margin (the bar\'s 24 px on a monster\'s turn)', () => {
    const { container } = render(<TacticalMap {...at('e4')} />);
    const win = layoutP2(container, { left: 0, top: 0 });
    resized(); // the box (margin 0 here: nothing moves)
    withMargin(win, 1);
    layoutP2(container, { left: 0, top: 0 }, { width: 200, height: 96 }); // 24 px shorter; Edge4 (row 1: y 40..80) is still wholly in view
    resized();
    expect(win.scrollLeft).toBe(0);
    expect(win.scrollTop).toBe(0);
  });

  it('a height step that CUTS the mover follows it (the mover is no longer wholly in view)', () => {
    const { container } = render(<TacticalMap {...at('e4')} />);
    const win = layoutP2(container, { left: 0, top: 0 });
    resized();
    layoutP2(container, { left: 0, top: 0 }, { width: 200, height: 60 }); // row 1 is y 40..80: cut at 60
    resized();
    expect(win.scrollTop).toBe(40); // one whole square down: rows 1.. (the fewest)
  });

  it('3 — a height step never undoes a HAND SCROLL: the mover was already out of view under the previous height, so the step follows nothing', () => {
    const { container } = render(<TacticalMap {...at('e4')} />);
    const win = layoutP2(container, { left: 0, top: 0 });
    resized(); // the box: Edge4 (column 4) is wholly in view
    layoutP2(container, { left: 200, top: 0 }); // the user scrolled right by hand: Edge4 is out of view
    layoutP2(container, { left: 200, top: 0 }, { width: 200, height: 96 }); // then the bar's 24 px: a pure height step
    resized();
    expect(win.scrollLeft).toBe(200);
  });

  it('3 — THE CONTROL: the same step with the mover wholly in view under the previous height, and cut by the step, follows (the existing cut case, with the previous height measured)', () => {
    const { container } = render(<TacticalMap {...at('e4')} />);
    const win = layoutP2(container, { left: 0, top: 0 });
    resized();
    layoutP2(container, { left: 0, top: 0 }, { width: 200, height: 60 });
    resized();
    expect(win.scrollTop).toBe(40);
  });

  it('a window that LOSES its box while Move is armed calls onExitMove, once; while Move is not armed it calls nothing; gaining a box calls nothing', () => {
    const onExitMove = jest.fn();
    const { container, unmount } = render(<TacticalMap {...at('a', { moveMode: true, onExitMove })} />);
    const win = layoutP2(container, { left: 0, top: 0 });
    resized();
    expect(onExitMove).not.toHaveBeenCalled();
    noBox(win);
    resized();
    resized(); // the observer fires again with the same (absent) box: it is not "losing" it twice
    expect(onExitMove).toHaveBeenCalledTimes(1);
    unmount();
    const idle = jest.fn();
    const second = render(<TacticalMap {...at('a', { moveMode: false, onExitMove: idle })} />);
    const win2 = layoutP2(second.container, { left: 0, top: 0 });
    resized();
    noBox(win2);
    resized();
    expect(idle).not.toHaveBeenCalled();
  });

  it('a RE-FOLLOW with no turn passing keeps the user\'s focused square first: the mover follow that would cut it is not taken (then, with no focus held, the same re-follow is taken: the control)', () => {
    const held = render(<TacticalMap {...at('c')} />);
    const win = layoutP2(held.container, { left: 0, top: 0 });
    resized(); // the box: the turn the map mounted on is followed now (80)
    win.scrollLeft = 0; // the window is somewhere else
    act(() => screen.getByRole('gridcell', { name: /Aldo — you/ }).focus()); // column 0, in view: the user is on it
    layoutP2(held.container, { left: 0, top: 0 }, { width: 190, height: 120 }); // the width changes (a rotation): a re-follow, with no turn passing
    resized();
    expect(win.scrollLeft).toBe(0); // Cal at column 6 needs left 120, which would cut column 0
    held.unmount();
    const free = render(<TacticalMap {...at('c')} />);
    const win2 = layoutP2(free.container, { left: 0, top: 0 });
    resized();
    win2.scrollLeft = 0;
    layoutP2(free.container, { left: 0, top: 0 }, { width: 190, height: 120 });
    resized();
    expect(win2.scrollLeft).toBe(120);
  });

  it('the re-follow waits for a touch to lift, like every follow', () => {
    const { container } = render(<TacticalMap {...at('c')} />);
    const win = layoutP2(container, { left: 0, top: 0 });
    fireEvent.touchStart(win, { touches: [{ identifier: 1, target: win, clientX: 1, clientY: 1 }] });
    resized();
    expect(win.scrollLeft).toBe(0);
    fireEvent.touchEnd(win, { touches: [] });
    expect(win.scrollLeft).toBe(80);
  });

  it('with no ResizeObserver (an old engine, a test) the map renders and follows as before: the observer is an addition', () => {
    delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
    expect(() => render(<TacticalMap {...at('a')} />)).not.toThrow();
  });
});

describe('TacticalMap — P2: the sliver rule: a cut row or column under 8 px ends the window on the whole one (Aoi-UI section 15)', () => {
  class FakeResizeObserver {
    static all: FakeResizeObserver[] = [];
    target!: Element;
    constructor(public cb: () => void) {}
    observe(t: Element) { this.target = t; FakeResizeObserver.all.push(this); }
    unobserve() {}
    disconnect() { FakeResizeObserver.all = FakeResizeObserver.all.filter((o) => o !== this); }
  }
  const resized = () => act(() => { FakeResizeObserver.all.slice().forEach((o) => o.cb()); });
  beforeEach(() => { FakeResizeObserver.all = []; (globalThis as { ResizeObserver?: unknown }).ResizeObserver = FakeResizeObserver; });
  afterEach(() => { delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver; });

  /** The room is the map's own wrapper; the window sits inside it. A 10x10 board of 40 px squares (400 px) in a room of `w` x `h`. */
  function inRoom(w: number, h: number, space = makeSpace({ width: 10, height: 10 })) {
    const view = render(<TacticalMap {...baseProps({ space, participants: [makeParticipant({ at: [0, 0], movement_remaining: 30 })] })} />);
    const room = view.container.firstElementChild as HTMLElement;
    Object.defineProperty(room, 'clientWidth', { configurable: true, value: w });
    Object.defineProperty(room, 'clientHeight', { configurable: true, value: h });
    const win = layoutP2(view.container, { left: 0, top: 0 }, { width: w, height: h });
    resized();
    return { win, room, ...view };
  }

  it('a remainder of 1 px ends on the whole row: a 121 px room shows 3 rows (120), and the window says so', () => {
    const { win } = inRoom(200, 121);
    expect(win.style.maxHeight).toBe('120px');
  });

  it('a remainder of 15 does not: a 135 px room keeps 3 rows and the 15 px sliver (the cue)', () => {
    const { win } = inRoom(200, 135);
    expect(win.style.maxHeight).toBe('');
  });

  it('the boundary: 7 px is cut, 8 px is not', () => {
    expect(inRoom(200, 127).win.style.maxHeight).toBe('120px');
    expect(inRoom(200, 128).win.style.maxHeight).toBe('');
  });

  it('the same sideways: a 201 px room ends on 5 whole columns', () => {
    const { win } = inRoom(201, 120);
    expect(win.style.maxWidth).toBe('200px');
    expect(win.style.maxHeight).toBe(''); // 120 is whole
  });

  it('a board that fits the room is never capped (nothing is cut), and a room under one square is used as it is', () => {
    expect(inRoom(201, 201, makeSpace({ width: 5, height: 5 })).win.style.maxHeight).toBe('');
    expect(inRoom(201, 201, makeSpace({ width: 5, height: 5 })).win.style.maxWidth).toBe('');
    expect(inRoom(200, 33).win.style.maxHeight).toBe('');
  });

  it('it is measured from the ROOM, not the window: re-measuring with the cap in place does not undo it (no loop)', () => {
    const { win, container } = inRoom(200, 121);
    layoutP2(container, { left: 0, top: 0 }, { width: 200, height: 120 }); // the window is now 120 tall, as the cap made it
    resized();
    resized();
    expect(win.style.maxHeight).toBe('120px');
  });

  it('the cap goes when the room grows to a whole row again (the stage gave back its pixel)', () => {
    const { win, room } = inRoom(200, 121);
    Object.defineProperty(room, 'clientHeight', { configurable: true, value: 160 });
    resized();
    expect(win.style.maxHeight).toBe('');
  });

  /** As `inRoom`, with the edge guard set on the window before the first measure (the mount sets it as a custom property). */
  function guardedRoom(w: number, h = 200, guard = '16px') {
    const view = render(<TacticalMap {...baseProps({ space: makeSpace({ width: 10, height: 10 }), participants: [makeParticipant({ at: [0, 0], movement_remaining: 30 })] })} />);
    const room = view.container.firstElementChild as HTMLElement;
    Object.defineProperty(room, 'clientWidth', { configurable: true, value: w });
    Object.defineProperty(room, 'clientHeight', { configurable: true, value: h });
    const win = layoutP2(view.container, { left: 0, top: 0 }, { width: w, height: h });
    win.style.setProperty('--tm-edge-guard', guard);
    resized();
    return { win, room, ...view };
  }

  it('F2 — a PANNING board starts the guard in, so the right-hand cut is (W - 16) mod 40: a 377 px room (361 mod 40 = 1) ends on 9 whole columns after the guard: 16 + 360', () => {
    const { win } = guardedRoom(377);
    expect(win).toHaveAttribute('data-pans-x');
    expect(win.style.maxWidth).toBe('376px');
  });

  it('F2 — measured WITHOUT the guard the same room has a 17 px cut and is left alone (so the cap above is the guard\'s doing), and a guard that is not set changes nothing', () => {
    expect(inRoom(377, 200).win.style.maxWidth).toBe('');
  });

  it('F2 — a guarded room whose cut is real (a 16 + 40n + 20 px room) is left alone; 8 px is not cut, 7 is', () => {
    expect(guardedRoom(16 + 160 + 20).win.style.maxWidth).toBe('');
    expect(guardedRoom(16 + 160 + 8).win.style.maxWidth).toBe('');
    expect(guardedRoom(16 + 160 + 7).win.style.maxWidth).toBe('176px');
  });

  it('F2b — the board\'s END: a 363 px room with the guard has a 3 px column at the START edge at scroll max ((363 mod 40) = 3), so the window ends 3 px short: 360', () => {
    expect(guardedRoom(363).win.style.maxWidth).toBe('360px');
  });

  it('F2 — a board that fits its room has no guard and no width cap from it (the bleed is kept), and the HEIGHT leg is unchanged by the guard', () => {
    expect(guardedRoom(410).win.style.maxWidth).toBe('');
    expect(guardedRoom(377, 121).win.style.maxHeight).toBe('120px');
  });

  it('the cut is not a CSS rule: the stylesheet never sets a height on the window by a literal (the cap is the component\'s, from the measured square)', () => {
    expect(hasDecl(ruleBody('boardScroll'), 'max-height')).toBe(false);
    expect(hasDecl(ruleBody('boardScroll'), 'max-width')).toBe(false);
  });
});

describe('TacticalMap — P2: the grid\'s label states the board, with its total size; the grid carries aria-rowcount and aria-colcount (Iro-A11y ruling 4)', () => {
  const walk = (o: Partial<TacticalMapProps> = {}) => baseProps({ space: makeSpace({ width: 13, height: 7 }), participants: [makeParticipant({ name: 'Kestrel Ashwood', at: [0, 0], movement_remaining: 30 })], ...o });

  it('the first board at 390 wide: "13 columns by 7 rows", then the turn and the feet', () => {
    render(<TacticalMap {...walk()} />);
    expect(screen.getByRole('grid')).toHaveAttribute('aria-label', "Battle map, 13 columns by 7 rows. Kestrel Ashwood's turn, 30 feet remaining");
  });

  it('the counts are the board\'s, on the grid: a screen reader says "row 3 of 7"', () => {
    render(<TacticalMap {...walk()} />);
    const grid = screen.getByRole('grid');
    expect(grid).toHaveAttribute('aria-rowcount', '7');
    expect(grid).toHaveAttribute('aria-colcount', '13');
  });

  it('it states the BOARD, never the window: no "showing", no "of": the label is the same at every window size', () => {
    const { container } = render(<TacticalMap {...walk()} />);
    layoutP2(container, { left: 0, top: 0 }, { width: 120, height: 80 }); // a small window over a 13x7 board
    expect(screen.getByRole('grid').getAttribute('aria-label')).not.toMatch(/showing|\bof\b/i);
    expect(screen.getByRole('grid')).toHaveAttribute('aria-label', "Battle map, 13 columns by 7 rows. Kestrel Ashwood's turn, 30 feet remaining");
  });

  it('with no one up the label is the size alone; one column and one row are singular', () => {
    const { unmount } = render(<TacticalMap {...walk({ participants: [], activeParticipantId: null })} />);
    expect(screen.getByRole('grid')).toHaveAttribute('aria-label', 'Battle map, 13 columns by 7 rows');
    unmount();
    render(<TacticalMap {...walk({ space: makeSpace({ width: 1, height: 1 }), participants: [], activeParticipantId: null })} />);
    expect(screen.getByRole('grid')).toHaveAttribute('aria-label', 'Battle map, 1 column by 1 row');
  });

  it('no row or cell carries an index: every row is in the tree, so the counts are the whole story (aria-rowindex would be a second source of the position)', () => {
    const { container } = render(<TacticalMap {...walk()} />);
    expect(container.querySelectorAll('[aria-rowindex],[aria-colindex]')).toHaveLength(0);
    expect(container.querySelectorAll('[role="row"]')).toHaveLength(7);
    expect(container.querySelectorAll('[role="gridcell"]')).toHaveLength(91);
  });
});

describe('TacticalMap — P2: the window pans natively (touch-action, overscroll) and is a toast avoid mark', () => {
  // MECHANISM ONLY: jsdom has no touch, no scrolling and no history swipe. These pin the declarations; what a finger does with them is the harness's `board-pan` leg and
  // brief section 14 items 8, 9 and 14 on a device.
  it('touch-action on the window is pan-x pan-y pinch-zoom: a finger pans it, a pinch zooms the page, no double-tap zoom is lost to a custom gesture', () => {
    expect(hasDecl(ruleBody('boardScroll'), 'touch-action', /pan-x pan-y pinch-zoom/)).toBe(true);
  });

  it('the squares keep touch-action: manipulation (it is what takes the double-tap zoom off them; it sits under the window\'s pan-x pan-y)', () => {
    expect(hasDecl(ruleBody('cell'), 'touch-action', /manipulation/)).toBe(true);
  });

  it('overscroll-behavior-x is contain, and the vertical axis is NOT contained: a short phone\'s page must be reachable from a swipe that starts on the board', () => {
    const win = ruleBody('boardScroll');
    expect(hasDecl(win, 'overscroll-behavior-x', /contain/)).toBe(true);
    expect(win).not.toMatch(/overscroll-behavior\s*:/); // the shorthand would contain both axes
    expect(win).not.toMatch(/overscroll-behavior-y/);
  });

  it('the window carries the toast avoid mark, once, on the window and not on the wrapper or the grid', () => {
    const { container } = render(<TacticalMap {...baseProps({ participants: [makeParticipant({ at: [1, 1], movement_remaining: 10 })] })} />);
    const marked = container.querySelectorAll('[data-toast-avoid]');
    expect(marked).toHaveLength(1);
    expect(marked[0]).toBe(container.querySelector('[data-board-window]'));
  });

  it('the mark is on the window of every board, however the room is arranged (it is the map\'s, not a row\'s): with and without a move engaged, with a reach shown', () => {
    for (const o of [{}, { moveMode: true }, { showReach: true }] as Partial<TacticalMapProps>[]) {
      const { container, unmount } = render(<TacticalMap {...baseProps({ participants: [makeParticipant({ at: [1, 1], movement_remaining: 10 })], ...o })} />);
      expect(container.querySelector('[data-board-window]')).toHaveAttribute('data-toast-avoid');
      unmount();
    }
  });

  it('the theatre-of-mind band (no board) is not a window and carries no mark', () => {
    const { container } = render(<TacticalMap {...baseProps({ space: null, participants: [makeParticipant()] })} />);
    expect(container.querySelector('[data-toast-avoid]')).toBeNull();
  });
});

describe('TacticalMap — P2: the edge guard: a window that pans sideways stamps itself, and its board starts --tm-edge-guard in from the start edge', () => {
  class FakeResizeObserver {
    static all: FakeResizeObserver[] = [];
    target!: Element;
    constructor(public cb: () => void) {}
    observe(t: Element) { this.target = t; FakeResizeObserver.all.push(this); }
    unobserve() {}
    disconnect() { FakeResizeObserver.all = FakeResizeObserver.all.filter((o) => o !== this); }
  }
  const resized = () => act(() => { FakeResizeObserver.all.slice().forEach((o) => o.cb()); });
  beforeEach(() => { FakeResizeObserver.all = []; (globalThis as { ResizeObserver?: unknown }).ResizeObserver = FakeResizeObserver; });
  afterEach(() => { delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver; });

  /** A board of `cols` squares of 40 px in a room `w` wide. */
  function inRoom(cols: number, w: number) {
    const view = render(<TacticalMap {...baseProps({ space: makeSpace({ width: cols, height: 5 }), participants: [makeParticipant({ at: [0, 0], movement_remaining: 10 })] })} />);
    const room = view.container.firstElementChild as HTMLElement;
    Object.defineProperty(room, 'clientWidth', { configurable: true, value: w });
    Object.defineProperty(room, 'clientHeight', { configurable: true, value: 200 });
    const win = layoutP2(view.container, { left: 0, top: 0 }, { width: w, height: 200 });
    return { win, room, ...view };
  }

  it('a board wider than its room is stamped; one that fits (or fills the room exactly) is not: it keeps the bleed', () => {
    const wide = inRoom(15, 360);
    resized();
    expect(wide.win).toHaveAttribute('data-pans-x');
    wide.unmount();
    const fits = inRoom(9, 360);
    resized();
    expect(fits.win).not.toHaveAttribute('data-pans-x'); // 360 in 360
    fits.unmount();
    const bigger = inRoom(10, 360);
    resized();
    expect(bigger.win).toHaveAttribute('data-pans-x'); // 400 in 360
  });

  it('the stamp follows the room: a rotation that makes the room wide enough takes it off, one that narrows it puts it on', () => {
    const { win, room } = inRoom(13, 300);
    resized();
    expect(win).toHaveAttribute('data-pans-x');
    Object.defineProperty(room, 'clientWidth', { configurable: true, value: 600 });
    resized();
    expect(win).not.toHaveAttribute('data-pans-x');
    Object.defineProperty(room, 'clientWidth', { configurable: true, value: 300 });
    resized();
    expect(win).toHaveAttribute('data-pans-x');
  });

  it('the stamp is measured from the board and the ROOM, not from the guard: adding the guard cannot flip a board that fits into one that pans', () => {
    const { win } = inRoom(9, 370); // 360 in 370: fits with 10 px to spare, which a 16 px guard would eat
    resized();
    resized();
    expect(win).not.toHaveAttribute('data-pans-x');
  });

  it('the guard is a MARGIN on the board, on the inline start, from --tm-edge-guard (default 0), under the stamp only', () => {
    const rule = /\.boardScroll\[data-pans-x\]\s+\.board\s*\{([^}]*)\}/.exec(CSS);
    expect(rule).not.toBeNull();
    expect(hasDecl(rule![1], 'margin-inline-start', /var\(--tm-edge-guard,\s*0px\)/)).toBe(true);
    expect(rule![1]).not.toMatch(/padding/); // padding would shift the tracks against the gridline background
    expect(hasDecl(ruleBody('board'), 'margin-inline-start')).toBe(false); // no guard on a board that does not pan
  });
});

describe('TacticalMap — what a held follow reads when it runs, and what the observer protects (from QA of P2)', () => {
  class FakeResizeObserver {
    static all: FakeResizeObserver[] = [];
    target!: Element;
    constructor(public cb: () => void) {}
    observe(t: Element) { this.target = t; FakeResizeObserver.all.push(this); }
    unobserve() {}
    disconnect() { FakeResizeObserver.all = FakeResizeObserver.all.filter((o) => o !== this); }
  }
  const resized = () => act(() => { FakeResizeObserver.all.slice().forEach((o) => o.cb()); });
  beforeEach(() => { FakeResizeObserver.all = []; (globalThis as { ResizeObserver?: unknown }).ResizeObserver = FakeResizeObserver; jest.useFakeTimers(); });
  afterEach(() => { delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver; jest.useRealTimers(); });
  const touch = [{ identifier: 1, get target() { return document.querySelector('[data-board-window]'); }, clientX: 5, clientY: 5 }]; // on the board
  const aldo = makeParticipant({ participant_id: 'a', name: 'Aldo', at: [0, 0], movement_remaining: 30 });
  const calAt = (x: number) => makeParticipant({ participant_id: 'c', name: 'Cal', is_pc: false, at: [x, 0], movement_remaining: 30 });
  const at = (active: string, participants: CombatParticipantState[], o: Partial<TacticalMapProps> = {}) => baseProps({ space: makeSpace({ width: 10, height: 10 }), participants, viewerParticipantId: 'a', activeParticipantId: active, ...o });
  const touchDown = (win: HTMLElement) => fireEvent.touchStart(win, { touches: touch });
  /** Fire the observer(s) watching the element that matches `selector`: the room (the wrapper), the window, or the grid. Named, not numbered: a fourth observer cannot shift them. */
  const fireObserverOf = (selector: string) => act(() => { FakeResizeObserver.all.filter((o) => o.target.matches(selector)).forEach((o) => o.cb()); });

  it('a poll that moves the mover while a finger holds the turn follow back: it runs to where the mover IS, not where it was when the turn changed', () => {
    const { container, rerender } = render(<TacticalMap {...at('a', [aldo, calAt(6)])} />);
    const win = layoutP2(container, { left: 0, top: 0 });
    touchDown(win);
    rerender(<TacticalMap {...at('c', [aldo, calAt(6)])} />);
    rerender(<TacticalMap {...at('c', [aldo, calAt(8)])} />);
    expect(win.scrollLeft).toBe(0);
    fireEvent.touchEnd(win, { touches: [] });
    expect(win.scrollLeft).toBe(160); // columns 4-8; a follow that read the square at request time would give 80
  });

  it('a window that gets a box follows the MOVER when the grid does not hold focus, even though a square elsewhere was the last one focused', () => {
    const { container } = render(<TacticalMap {...at('c', [aldo, calAt(6)])} />);
    const win = container.querySelector('[data-board-window]') as HTMLElement;
    const first = container.querySelectorAll('[role="gridcell"]')[0] as HTMLElement;
    act(() => { first.focus(); });
    act(() => { first.blur(); });
    expect(container.querySelector('[role="grid"]')!.contains(document.activeElement)).toBe(false);
    layoutP2(container, { left: 0, top: 0 });
    resized();
    expect(win.scrollLeft).toBe(80); // a stale focus treated as held would refuse the follow (it cuts column 0)
  });

  it('A6 — a turn passed AND the width changed while a finger held the follow: whichever request the gate kept, the run is the TURN\'s (the mover ends whole), because the turn is owed in a ref the replacement cannot drop', () => {
    const { container, rerender } = render(<TacticalMap {...at('a', [aldo, calAt(6)])} />);
    const win = layoutP2(container, { left: 0, top: 0 });
    resized();
    act(() => { (container.querySelectorAll('[role="gridcell"]')[0] as HTMLElement).focus(); });
    touchDown(win);
    rerender(<TacticalMap {...at('c', [aldo, calAt(6)])} />);
    resized();
    fireEvent.touchEnd(win, { touches: [] });
    expect(win.scrollLeft).toBe(80); // Cal whole; the focused column 0 cannot be held with it. A re-follow alone would keep column 0 and stay at 0
  });

  it('the turn stays OWED while the window is hidden, with a HELD square: when the box comes back the run is the turn\'s (the mover wins: 80), not a plain re-follow (which keeps the held square: 0)', () => {
    const { container, rerender } = render(<TacticalMap {...at('a', [aldo, calAt(6)])} />);
    const win = layoutP2(container, { left: 0, top: 0 });
    resized();
    act(() => { (container.querySelectorAll('[role="gridcell"]')[0] as HTMLElement).focus(); }); // column 0, held
    for (const k of ['clientWidth', 'clientHeight']) Object.defineProperty(win, k, { configurable: true, value: 0 });
    resized();
    rerender(<TacticalMap {...at('c', [aldo, calAt(6)])} />); // a turn passes while the window is hidden
    expect(win.scrollLeft).toBe(0);
    layoutP2(container, { left: 0, top: 0 });
    resized();
    expect(win.scrollLeft).toBe(80);
  });

  it('a hidden window (no box) follows nothing, and the turn stays owed until its box comes back (followMover has a hasBox guard)', () => {
    const { container, rerender } = render(<TacticalMap {...at('a', [aldo, calAt(6)])} />);
    const win = layoutP2(container, { left: 0, top: 0 });
    resized();
    for (const k of ['clientWidth', 'clientHeight']) Object.defineProperty(win, k, { configurable: true, value: 0 });
    resized();
    rerender(<TacticalMap {...at('c', [aldo, calAt(6)])} />); // a turn passes while the window is hidden
    expect(win.scrollLeft).toBe(0);
    layoutP2(container, { left: 0, top: 0 });
    resized(); // the box is back
    expect(win.scrollLeft).toBe(80);
  });

  describe('F4 — a window with no box while a move is in flight does NOT exit Move now (Escape is deaf then too: canClose); the exit is owed and paid once when the submit settles', () => {
    // RULED by the coordinator (replaces QA's pin of "the exit is unconditional"): disarming under an in-flight request can clear the page's own guard and let a reopen send a second POST.
    const noBoxNow = (win: HTMLElement) => { for (const k of ['clientWidth', 'clientHeight']) Object.defineProperty(win, k, { configurable: true, value: 0 }); };
    const armed = (o: Partial<TacticalMapProps>) => at('a', [aldo, calAt(6)], { moveMode: true, ...o });

    it('no exit during the submit; one exit when it settles with the window still without a box; never twice', () => {
      const onExitMove = jest.fn();
      const { container, rerender } = render(<TacticalMap {...armed({ moveSubmitting: true, onExitMove })} />);
      const win = layoutP2(container, { left: 0, top: 0 });
      resized();
      noBoxNow(win);
      resized();
      resized();
      expect(onExitMove).not.toHaveBeenCalled();
      rerender(<TacticalMap {...armed({ moveSubmitting: false, onExitMove })} />);
      expect(onExitMove).toHaveBeenCalledTimes(1);
      rerender(<TacticalMap {...armed({ moveSubmitting: true, onExitMove })} />);
      rerender(<TacticalMap {...armed({ moveSubmitting: false, onExitMove })} />);
      expect(onExitMove).toHaveBeenCalledTimes(1);
    });

    it('no exit if the box came back while the submit was in flight', () => {
      const onExitMove = jest.fn();
      const { container, rerender } = render(<TacticalMap {...armed({ moveSubmitting: true, onExitMove })} />);
      const win = layoutP2(container, { left: 0, top: 0 });
      resized();
      noBoxNow(win);
      resized();
      layoutP2(container, { left: 0, top: 0 });
      resized(); // the box is back
      rerender(<TacticalMap {...armed({ moveSubmitting: false, onExitMove })} />);
      expect(onExitMove).not.toHaveBeenCalled();
    });

    it('no exit at the settle if Move was already disarmed (the page cleared it itself)', () => {
      const onExitMove = jest.fn();
      const { container, rerender } = render(<TacticalMap {...armed({ moveSubmitting: true, onExitMove })} />);
      const win = layoutP2(container, { left: 0, top: 0 });
      resized();
      noBoxNow(win);
      resized();
      rerender(<TacticalMap {...armed({ moveMode: false, moveSubmitting: false, onExitMove })} />);
      expect(onExitMove).not.toHaveBeenCalled();
    });

    it('THE CONTROL: with nothing in flight the exit is immediate', () => {
      const onExitMove = jest.fn();
      const { container } = render(<TacticalMap {...armed({ onExitMove })} />);
      const win = layoutP2(container, { left: 0, top: 0 });
      resized();
      noBoxNow(win);
      resized();
      expect(onExitMove).toHaveBeenCalledTimes(1);
    });
  });

  it('a cell-size change with the room and the window UNCHANGED (only the grid\'s own box moves) is measured again: a board that now overflows its room is stamped and the mover followed', () => {
    const { container } = render(<TacticalMap {...at('c', [aldo, calAt(9)], { space: makeSpace({ width: 10, height: 5 }) })} />);
    const win = container.querySelector('[data-board-window]') as HTMLElement;
    const room = container.firstElementChild as HTMLElement;
    Object.defineProperty(room, 'clientWidth', { configurable: true, value: 410 });
    Object.defineProperty(room, 'clientHeight', { configurable: true, value: 200 });
    layoutP2(container, { left: 0, top: 0 }, { width: 410, height: 200 });
    fireObserverOf('[data-board-window]'); // the box: 400 px of board in 410: no pan
    expect(win).not.toHaveAttribute('data-pans-x');
    // the square grows 40 -> 44 (board 440): neither the room nor the window moved
    container.querySelectorAll('[role="gridcell"]').forEach((cell, i) => mockBox(cell, { left: 10 + (i % 10) * 44, top: 10 + Math.floor(i / 10) * 44, width: 44, height: 44 }));
    Object.defineProperty(win, 'scrollWidth', { configurable: true, value: 440 });
    fireObserverOf('[role="grid"]'); // the grid's observer only
    expect(win).toHaveAttribute('data-pans-x');
    expect(win.scrollLeft).toBe(30); // Cal at column 9 (x 396..440) is brought in: the end of the board
  });

  it('F1 — THE FOLLOW RUNS AFTER THE GEOMETRY IS STAMPED: when the window gets a box over a board wider than its room, the scroll is written with data-pans-x already on the window (the guard adds 16 px of scroll width, and a follow clamped to the old maximum leaves the last column cut)', () => {
    // MECHANISM (the order of stamp and follow). The behaviour pin is QA's browser probe (t3c.mjs: the last column wholly visible at 360/390/412 wide).
    const { container } = render(<TacticalMap {...at('c', [aldo, calAt(14)], { space: makeSpace({ width: 15, height: 5 }) })} />);
    const win = container.querySelector('[data-board-window]') as HTMLElement;
    const room = container.firstElementChild as HTMLElement;
    Object.defineProperty(room, 'clientWidth', { configurable: true, value: 360 });
    Object.defineProperty(room, 'clientHeight', { configurable: true, value: 200 });
    layoutP2(container, { left: 0, top: 0 }, { width: 360, height: 200 });
    Object.defineProperty(win, 'scrollWidth', { configurable: true, value: 600 }); // 15 columns of 40 px
    container.querySelectorAll('[role="gridcell"]').forEach((cell, i) => mockBox(cell, { left: 10 + (i % 15) * 40, top: 10 + Math.floor(i / 15) * 40, width: 40, height: 40 }));
    const stampedAtWrite: boolean[] = [];
    let left = 0;
    Object.defineProperty(win, 'scrollLeft', { configurable: true, get: () => left, set: (v: number) => { left = v; stampedAtWrite.push(win.hasAttribute('data-pans-x')); } });
    fireObserverOf('[data-board-window]'); // ONLY the window's observer: it measures the room itself, so the stamp does not depend on the room observer firing in the same frame
    expect(stampedAtWrite.length).toBeGreaterThan(0); // the control: a follow did write
    expect(stampedAtWrite.every(Boolean)).toBe(true);
  });

  it('Escape in flight is deaf with the window in view (the no-box exit during a submit is pinned in the F4 cases)', () => {
    const onExitMove = jest.fn();
    const { container } = render(<TacticalMap {...at('a', [aldo, calAt(6)], { moveMode: true, moveSubmitting: true, onExitMove })} />);
    layoutP2(container, { left: 0, top: 0 });
    fireEvent.keyDown(container.querySelector('[role="grid"]')!, { key: 'Escape' });
    expect(onExitMove).not.toHaveBeenCalled();
  });
});

describe('TacticalMap — P2: the touch declarations on the grid (Tora-Gesture rule 2)', () => {
  // MECHANISM ONLY: jsdom has no long press, no callout and no tap highlight; these pin the declarations. Device checklist item 12 is the behaviour.
  it('the grid is not selectable and raises no callout: user-select, -webkit-user-select and -webkit-touch-callout are none', () => {
    const board = ruleBody('board');
    expect(hasDecl(board, 'user-select', /none/)).toBe(true);
    expect(hasDecl(board, '-webkit-user-select', /none/)).toBe(true);
    expect(hasDecl(board, '-webkit-touch-callout', /none/)).toBe(true);
  });

  it('the prefixed declaration comes BEFORE the unprefixed one (the build keeps the last of a pair)', () => {
    const board = ruleBody('board');
    expect(board.indexOf('-webkit-user-select')).toBeGreaterThanOrEqual(0);
    expect(board.indexOf('-webkit-user-select')).toBeLessThan(board.search(/(^|[\s;])user-select\s*:/));
  });

  it('the squares have a transparent tap highlight', () => {
    expect(hasDecl(ruleBody('cell'), '-webkit-tap-highlight-color', /transparent/)).toBe(true);
  });

  it('only the grid: the window and the wrapper stay selectable (the line and the log are outside, and nothing else in the map is text to select)', () => {
    expect(hasDecl(ruleBody('boardScroll'), 'user-select')).toBe(false);
    expect(hasDecl(ruleBody('wrap'), 'user-select')).toBe(false);
  });
});

describe('TacticalMap — a browser without :focus-visible, and the empty square the keyboard is on', () => {
  const folk = [
    makeParticipant({ participant_id: 'a', name: 'Aldo', at: [0, 0], movement_remaining: 30 }),
    makeParticipant({ participant_id: 'c', name: 'Cal', is_pc: false, at: [6, 0], movement_remaining: 30 }),
  ];
  const at = (active: string, o: Partial<TacticalMapProps> = {}) => baseProps({ space: makeSpace({ width: 10, height: 10 }), participants: folk, viewerParticipantId: 'a', activeParticipantId: active, ...o });

  it('iOS before 15.4 throws a SyntaxError on the selector: the follow still runs, as if nothing were held (the mover is followed whole)', () => {
    const { container, rerender } = render(<TacticalMap {...at('a')} />);
    const win = layoutP2(container, { left: 0, top: 0 });
    withMargin(win, 1);
    // A HELD candidate (Kage, run 3): the square the user is on is column 2, which is what the same test in the previous describe (A1) HOLDS (scroll 80) when :focus-visible answers true. Here the selector
    // THROWS, so it reads as not held, and the plain mover follow runs, margin and all (120). The old case focused the mover's own square, where held and not held scroll the same.
    const cell = container.querySelectorAll('[role="gridcell"]')[2] as HTMLElement;
    act(() => { cell.focus(); });
    const real = Element.prototype.matches;
    const spy = jest.spyOn(Element.prototype, 'matches').mockImplementation(function (this: Element, q: string) {
      if (q === ':focus-visible') throw new SyntaxError(`'${q}' is not a valid selector`);
      return real.call(this, q);
    });
    expect(() => rerender(<TacticalMap {...at('c')} />)).not.toThrow();
    spy.mockRestore();
    expect(win.scrollLeft).toBe(120);
  });

  describe('Iro-A11y condition C: while the grid holds KEYBOARD focus the line names the square the user is on, even when it is empty, in the cell\'s own words', () => {
    const lastOf = (fn: jest.Mock): InspectLine | null | undefined => (fn.mock.calls.length ? fn.mock.calls[fn.mock.calls.length - 1][0] : undefined);

    it('an arrow onto an empty square: a `cell` line carrying that square\'s input, whose text is the cell\'s own accessible name', () => {
      const onInspect = jest.fn();
      render(<TacticalMap {...at('a', { onInspect })} />);
      const start = screen.getByRole('gridcell', { name: /Aldo — you/ });
      act(() => { start.focus(); });
      fireEvent.keyDown(start, { key: 'ArrowRight' });
      const line = lastOf(onInspect) as Extract<InspectLine, { kind: 'cell' }>;
      expect(line.kind).toBe('cell');
      expect(line.input).toMatchObject({ row1: 1, col1: 2 });
      const name = (document.activeElement as HTMLElement).getAttribute('aria-label');
      expect(name).toBe('Row 1, column 2. Empty.');
      expect(buildLine(line, { round: 2 })).toBe(name);
    });

    it('THE CONTROL: a CLICK or a TAP that focused an empty square (not :focus-visible) says nothing new: the rest line', () => {
      const onInspect = jest.fn();
      render(<TacticalMap {...at('a', { onInspect })} />);
      const empty = screen.getByRole('gridcell', { name: /Row 3, column 5\./ });
      const real = empty.matches.bind(empty);
      jest.spyOn(empty, 'matches').mockImplementation((q: string) => (q === ':focus-visible' ? false : real(q)));
      act(() => { empty.focus(); });
      expect(lastOf(onInspect)).toEqual({ kind: 'turn', name: 'Aldo', feetLeft: 30 });
    });

    it('it ends with the keyboard\'s focus: leaving the grid returns the line to rest', () => {
      const onInspect = jest.fn();
      render(<TacticalMap {...at('a', { onInspect })} />);
      const start = screen.getByRole('gridcell', { name: /Aldo — you/ });
      act(() => { start.focus(); });
      fireEvent.keyDown(start, { key: 'ArrowRight' });
      expect(lastOf(onInspect)).toMatchObject({ kind: 'cell' });
      fireEvent.blur(document.activeElement as HTMLElement, { relatedTarget: null });
      expect(lastOf(onInspect)).toEqual({ kind: 'turn', name: 'Aldo', feetLeft: 30 });
    });

    it('a creature or a feature square is unchanged (K2): its line is the creature\'s, not the cell name', () => {
      const onInspect = jest.fn();
      render(<TacticalMap {...at('a', { onInspect })} />);
      const cal = screen.getByRole('gridcell', { name: /Cal, hostile/ });
      act(() => { cal.focus(); });
      expect(buildLine(lastOf(onInspect) as InspectLine, { round: 2 })).toBe('Cal · Foe');
    });
  });
});


describe('TacticalMap — B8c-3 M3: the Move sync follows the viewer\'s OWN landed move (`movedSeq`) and nothing else', () => {
  const six = () => makeSpace({ width: 6, height: 6 });
  const bren = (o: Partial<CombatParticipantState> = {}) => makeParticipant({ name: 'Bren', at: [1, 1], movement_remaining: 30, ...o });
  const engaged = (o: Partial<TacticalMapProps> = {}) => baseProps({ space: six(), participants: [bren()], moveMode: true, ...o });

  it('a token redrawn by a poll or a 409 (its `at` changes, `movedSeq` does not) leaves focus on the square the user was on; the landed move (movedSeq bumped) takes it to the token', () => {
    const { rerender } = render(<TacticalMap {...engaged()} />);
    const start = screen.getByRole('gridcell', { name: /Bren — you/ });
    fireEvent.keyDown(start, { key: 'ArrowRight' });
    const chosen = document.activeElement as HTMLElement; // the user\'s square, one to the right of the token
    expect(chosen).not.toBe(start);
    rerender(<TacticalMap {...engaged({ participants: [bren({ at: [3, 3], movement_remaining: 30 })] })} />); // redrawn elsewhere by the server
    expect(document.activeElement).toBe(chosen);
    rerender(<TacticalMap {...engaged({ participants: [bren({ at: [3, 3], movement_remaining: 25 })], movedSeq: 1 })} />);
    expect(document.activeElement).toBe(screen.getByRole('gridcell', { name: /Bren — you/ }));
  });

  it('re-arming always re-syncs (focus enters at the token); a map that is never armed ignores movedSeq', () => {
    const { rerender } = render(<TacticalMap {...engaged({ moveMode: false })} />);
    rerender(<TacticalMap {...engaged({ moveMode: false, movedSeq: 3 })} />);
    expect(document.activeElement).toBe(document.body);
    rerender(<TacticalMap {...engaged({ moveMode: true, movedSeq: 3 })} />);
    expect(document.activeElement).toBe(screen.getByRole('gridcell', { name: /Bren — you/ }));
  });
});

describe('TacticalMap — B8c-3 M3: hover is a mouse\'s, never a finger\'s (B3: no sticky touch hover); keyFocus is not stale after a tap (Kage)', () => {
  const six = () => makeSpace({ width: 6, height: 6 });
  const bren = makeParticipant({ name: 'Bren', at: [1, 1], movement_remaining: 30 });
  const last = (fn: jest.Mock) => fn.mock.calls[fn.mock.calls.length - 1]?.[0];
  const touchEnter = (el: Element) => { const e = new Event('pointerover', { bubbles: true }); Object.defineProperty(e, 'pointerType', { value: 'touch' }); act(() => { el.dispatchEvent(e); }); };

  it('a mouse pointer entering a square in Move mode sets the destination (the target line); a TOUCH pointer entering one does not, and does not leave one behind', () => {
    const onInspect = jest.fn();
    render(<TacticalMap {...baseProps({ space: six(), participants: [bren], moveMode: true, onInspect })} />);
    const cell = screen.getByRole('gridcell', { name: /Row 4, column 4\./ });
    touchEnter(cell);
    const afterTouch = JSON.stringify(last(onInspect));
    expect(afterTouch).not.toContain('"row1":4,"col1":4');
    fireEvent.pointerEnter(cell, { pointerType: 'mouse' });
    expect(JSON.stringify(last(onInspect))).toContain('"row1":4,"col1":4');
    fireEvent.pointerLeave(cell);
    expect(JSON.stringify(last(onInspect))).not.toContain('"row1":4,"col1":4');
  });

  it('KAGE: keyboard focus on an empty square, focus leaves, then a tap that moves no focus on another empty square reads the rest line, not the cell line', () => {
    const onInspect = jest.fn();
    render(<><button type="button">outside</button><TacticalMap {...baseProps({ space: six(), participants: [bren], moveMode: false, onInspect })} /></>);
    act(() => { screen.getByRole('gridcell', { name: /Row 2, column 2\./ }).focus(); }); // keyboard-style focus (jsdom: :focus-visible)
    expect(last(onInspect)?.kind).toBe('cell');
    act(() => { screen.getByRole('button', { name: 'outside' }).focus(); });
    fireEvent.click(screen.getByRole('gridcell', { name: /Row 3, column 3\./ })); // a tap: no focus move
    expect(last(onInspect)?.kind).toBe('turn');
  });
});
