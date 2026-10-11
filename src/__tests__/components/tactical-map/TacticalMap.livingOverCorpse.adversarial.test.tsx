/**
 * TAV-MAP-LIVING-TOKEN-HIDDEN-UNDER-CORPSE, break-it companion to TacticalMap.livingOverCorpse.test.tsx.
 *
 * The invariant: a corpse adds NOTHING to a square someone living stands on. Asserted as identity
 * (the cell is byte-for-byte the cell without the corpse, in every roster order and in move mode),
 * which cannot pass by naming the right person while drawing or gating the wrong thing.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import TacticalMap, { type TacticalMapProps } from '@/components/tactical-map/TacticalMap';
import type { CombatParticipantState, CombatSpace } from '@/lib/api/types';

const SPACE: CombatSpace = { kind: 'square', width: 5, height: 5, cell: { value: 5, unit: 'ft' }, blocked: [], features: [] };

function p(o: Partial<CombatParticipantState>): CombatParticipantState {
  return {
    participant_id: 'p1', entity_id: 'e1', name: 'Bren', is_pc: true, initiative: 15, hp_current: 20, hp_max: 20, ac: 15,
    conditions: [], is_alive: true, can_be_targeted: true, is_active_turn: false, took_turn: false, at: null, movement_remaining: null,
    ...o,
  };
}

const ALLY = p({ participant_id: 'p2', name: 'Cass', at: [2, 2] });
const FOE = p({ participant_id: 'm1', name: 'Gnoll', is_pc: false, at: [2, 2] });
const DEAD_WOLF = p({ participant_id: 'w1', name: 'Timberwolf', is_pc: false, at: [2, 2], hp_current: 0, is_alive: false });
const DEAD_BOAR = p({ participant_id: 'w2', name: 'Boar', is_pc: false, at: [2, 2], hp_current: 0, is_alive: false });
const MY_CORPSE = p({ participant_id: 'p1', name: 'Bren', at: [2, 2], hp_current: 0, is_alive: false });
const MOVER = p({ participant_id: 'p9', name: 'Mover', at: [0, 2], is_active_turn: true, movement_remaining: 30 });

function map(participants: CombatParticipantState[], viewer: string, extra: Partial<TacticalMapProps> = {}) {
  return render(
    <TacticalMap
      space={SPACE}
      participants={participants}
      viewerParticipantId={viewer}
      activeParticipantId="p9"
      moveMode={false}
      onMove={jest.fn()}
      onExitMove={jest.fn()}
      {...extra}
    />,
  );
}
const cell = () => screen.getByRole('gridcell', { name: /Row 3, column 3\./ });

describe('a corpse adds nothing to a square a living token stands on', () => {
  it.each([
    ['ally, corpse first', [DEAD_WOLF, ALLY], [ALLY]],
    ['ally, corpse last', [ALLY, DEAD_WOLF], [ALLY]],
    ['hostile, corpse first', [DEAD_WOLF, FOE], [FOE]],
    ['ally between two corpses', [DEAD_WOLF, ALLY, DEAD_BOAR], [ALLY]],
    ['hostile after two corpses', [DEAD_WOLF, DEAD_BOAR, FOE], [FOE]],
  ])('%s: the cell is identical to the cell without the corpse', (_n, withCorpse, without) => {
    const a = map(withCorpse, 'viewer');
    const html = cell().outerHTML;
    a.unmount();
    map(without, 'viewer');
    expect(html).toBe(cell().outerHTML);
  });

  it('in move mode the occupied square is not a move target, corpse or no corpse', () => {
    const a = map([MOVER, DEAD_WOLF, ALLY], 'p9', { moveMode: true });
    const html = cell().outerHTML;
    a.unmount();
    map([MOVER, ALLY], 'p9', { moveMode: true });
    expect(html).toBe(cell().outerHTML);
  });

  it('the viewer\'s OWN corpse under a living ally: the ally is drawn, the viewer\'s corpse is not', () => {
    map([MY_CORPSE, ALLY], 'p1');
    expect(cell()).toHaveAccessibleName(/Cass, ally/);
    expect(cell()).not.toHaveAccessibleName(/Bren/);
    expect(cell().textContent).toContain('C');
    expect(cell().textContent).not.toContain('B');
  });
});

describe('squares with only the dead', () => {
  it('a token that dies on a corpse leaves two corpses: exactly one is drawn, named dead, nothing throws', () => {
    map([DEAD_WOLF, { ...FOE, hp_current: 0, is_alive: false }], 'viewer');
    expect(cell()).toHaveAccessibleName(/dead/);
    const initials = (cell().textContent ?? '').replace(/\s/g, '');
    expect(initials.length).toBeLessThanOrEqual(2); // one token initial, not two stacked
  });

  it('negative control: the same two-corpse square is not swallowed by the living-first rule (still drawn)', () => {
    map([DEAD_WOLF, DEAD_BOAR], 'viewer');
    expect(cell()).toHaveAccessibleName(/Timberwolf|Boar/);
  });
});
