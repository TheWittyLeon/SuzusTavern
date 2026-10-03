/**
 * B8c-3 run 2, Miko MF1 — `space.blocked` and `space.features` at the render seam. `isSpaceUsable` guarded only the dimensions and `cell`, so a present-but-malformed list reached the render's
 * `(blocked ?? []).some` / `(features ?? []).find(f => f.at.some(...))` and threw: the whole `/play` page was replaced by "Something went wrong" (Chromium and WebKit). Now such a board is "no usable
 * board" at the same seam as a bad `cell`, and the map renders the BAND (no grid, no throw). An OMITTED or `null` list stays legal (the engine's `space.get("blocked") or []`).
 * Mutation seen red: `isListsValid` gutted to `return true` -> every "is not usable" row and every "renders the band" row goes red (the render throws); the positive rows stay green.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import TacticalMap from '@/components/tactical-map/TacticalMap';
import { isSpaceUsable } from '@/components/tactical-map/reach';
import type { CombatParticipantState, CombatSpace } from '@/lib/api/types';

const BASE = { kind: 'square', width: 6, height: 4, cell: { value: 5, unit: 'ft' } };
const board = (over: Record<string, unknown>) => ({ ...BASE, blocked: [], features: [], ...over }) as unknown as CombatSpace;
const person = { participant_id: 'p1', entity_id: 'c1', name: 'Kestrel', is_pc: true, initiative: 1, hp_current: 5, hp_max: 5, ac: 10, conditions: [], is_alive: true, can_be_targeted: false, is_active_turn: true, took_turn: false, at: [1, 1], movement_remaining: 30 } as unknown as CombatParticipantState;

const BAD: Array<[string, Record<string, unknown>]> = [
  ['blocked: {}', { blocked: {} }],
  ['blocked: "x"', { blocked: 'x' }],
  ['blocked: 5', { blocked: 5 }],
  ['blocked: [null]', { blocked: [null] }],
  ['blocked: a triple', { blocked: [[1, 1, 1]] }],
  ['blocked: a string pair', { blocked: [['1', '2']] }],
  ['blocked: a fractional pair', { blocked: [[1.5, 2]] }],
  ['features: {}', { features: {} }],
  ['features: "x"', { features: 'x' }],
  ['features: [null]', { features: [null] }],
  ['features: [{}]', { features: [{}] }],
  ['features: [{ at: null }]', { features: [{ id: 'a', kind: 'prop', label: 'A', at: null }] }],
  ['features: [{ at: "x" }]', { features: [{ id: 'a', kind: 'prop', label: 'A', at: 'x' }] }],
  ['features: at holds a non-pair', { features: [{ id: 'a', kind: 'prop', label: 'A', at: [[1]] }] }],
  ['features: no label', { features: [{ id: 'a', kind: 'prop', at: [[1, 1]] }] }],
  ['features: a numeric label', { features: [{ id: 'a', kind: 'prop', label: 7, at: [[1, 1]] }] }],
];

describe('isSpaceUsable: blocked and features are lists of what the render reads', () => {
  it.each(BAD)('%s is not usable', (_n, over) => {
    expect(isSpaceUsable(board(over))).toBe(false);
  });

  it('a well-formed board, with and without the lists, is usable; an omitted or null list is legal (the engine\'s `or []`)', () => {
    expect(isSpaceUsable(board({}))).toBe(true);
    expect(isSpaceUsable(board({ blocked: [[2, 2], [3, 3]], features: [{ id: 'b', kind: 'prop', label: 'Brazier', at: [[1, 1], [1, 2]] }] }))).toBe(true);
    expect(isSpaceUsable(board({ blocked: undefined, features: undefined }))).toBe(true);
    expect(isSpaceUsable(board({ blocked: null, features: null }))).toBe(true);
    // out-of-range squares are content the render ignores, not a malformed list
    expect(isSpaceUsable(board({ blocked: [[99, 99]] }))).toBe(true);
  });
});

describe('TacticalMap renders the BAND for such a board and never throws', () => {
  it.each(BAD)('%s', (_n, over) => {
    render(<TacticalMap space={board(over)} participants={[person]} viewerParticipantId="p1" activeParticipantId="p1" moveMode={false} onMove={() => {}} onExitMove={() => {}} />);
    expect(screen.getByRole('list', { name: 'Combatants' })).toBeInTheDocument();
    expect(screen.queryByRole('grid')).toBeNull();
  });

  it('the positive control: a well-formed board draws the grid', () => {
    render(<TacticalMap space={board({ blocked: [[2, 2]], features: [{ id: 'b', kind: 'prop', label: 'Brazier', at: [[1, 1]] }] })} participants={[person]} viewerParticipantId="p1" activeParticipantId="p1" moveMode={false} onMove={() => {}} onExitMove={() => {}} />);
    expect(screen.getByRole('grid')).toBeInTheDocument();
  });
});
