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
import type { InspectLine } from '@/components/tactical-map/a11y';

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

  it('focus moving between squares of the grid does not clear it; tabbing into the grid chooses its roving stop', () => {
    const { onInspect } = mount();
    const goblin = screen.getByRole('gridcell', { name: /Goblin Skulker, hostile/ });
    act(() => goblin.focus());
    fireEvent.keyDown(goblin, { key: 'ArrowRight' });
    fireEvent.blur(goblin, { relatedTarget: screen.getByRole('gridcell', { name: /Row 1, column 4\./ }) });
    expect(lastOf(onInspect)).toMatchObject({ kind: 'turn' }); // [3,0] is empty: the rest line, but the grid still holds the chosen square
    fireEvent.keyDown(screen.getByRole('gridcell', { name: /Row 1, column 4\./ }), { key: 'ArrowLeft' });
    expect(lastOf(onInspect)).toMatchObject({ kind: 'cell', input: { occupant: { name: 'Goblin Skulker' } } });
  });

  it('while choosing a move: a `target` line for the focused square; a hovered square wins; a legal square carries its cost and the budget, an illegal one says why', () => {
    const { onInspect } = mount({ moveMode: true });
    expect(lastOf(onInspect)).toMatchObject({ kind: 'target', legal: false }); // the cursor starts on the mover's own square
    fireEvent.mouseEnter(screen.getByRole('gridcell', { name: /Row 2, column 1\./ }));
    expect(lastOf(onInspect)).toMatchObject({ kind: 'target', legal: true, costFt: 5, budgetFt: 30, input: { row1: 2, col1: 1, inRange: true, moveModeActive: true } });
    fireEvent.mouseEnter(screen.getByRole('gridcell', { name: /Row 2, column 2\./ })); // blocked
    expect(lastOf(onInspect)).toMatchObject({ kind: 'target', legal: false, input: { blocked: true } });
    fireEvent.mouseLeave(screen.getByRole('gridcell', { name: /Row 2, column 2\./ }));
    expect(lastOf(onInspect)).toMatchObject({ kind: 'target', legal: false }); // back to the focused (own) square
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
    expect(screen.getByRole('grid')).toHaveAttribute('aria-label', "Battle map — Bren's turn");
  });

  it('with a budget it still says so, and an unplaced mover\'s zero is a zero', () => {
    const { unmount } = render(<TacticalMap {...baseProps({ participants: [makeParticipant({ name: 'Bren', at: [0, 0], movement_remaining: 30 })] })} />);
    expect(screen.getByRole('grid')).toHaveAttribute('aria-label', "Battle map — Bren's turn, 30 feet remaining");
    unmount();
    render(<TacticalMap {...baseProps({ participants: [makeParticipant({ name: 'Bren', at: [0, 0], movement_remaining: 0 })] })} />);
    expect(screen.getByRole('grid')).toHaveAttribute('aria-label', "Battle map — Bren's turn, 0 feet remaining");
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
