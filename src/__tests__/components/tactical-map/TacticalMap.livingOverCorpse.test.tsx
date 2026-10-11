/**
 * TAV-MAP-LIVING-TOKEN-HIDDEN-UNDER-CORPSE — a corpse's square is walkable (engine parity: only the
 * living occupy), so a living token can end its move on one. The square then holds two placed
 * participants and a first-match lookup drew whichever came first in the roster. A living occupant
 * always wins the square, in either roster order. The corpse is not drawn while someone stands on it,
 * and the square's accessible name describes the one that is drawn.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import TacticalMap, { type TacticalMapProps } from '@/components/tactical-map/TacticalMap';
import type { CombatParticipantState, CombatSpace } from '@/lib/api/types';

const SPACE: CombatSpace = {
  kind: 'square',
  width: 5,
  height: 5,
  cell: { value: 5, unit: 'ft' },
  blocked: [],
  features: [],
};

function p(overrides: Partial<CombatParticipantState>): CombatParticipantState {
  return {
    participant_id: 'p1',
    entity_id: 'e1',
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

const LIVING = p({ participant_id: 'p1', name: 'Bren', at: [2, 2] });
const CORPSE = p({ participant_id: 'w1', name: 'Timberwolf', is_pc: false, at: [2, 2], hp_current: 0, is_alive: false });

function props(participants: CombatParticipantState[], viewer: string): TacticalMapProps {
  return {
    space: SPACE,
    participants,
    viewerParticipantId: viewer,
    activeParticipantId: 'p9', // nobody the viewer controls is mid-move
    moveMode: false,
    onMove: jest.fn(),
    onExitMove: jest.fn(),
  };
}

describe.each([
  ['corpse first', [CORPSE, LIVING]],
  ['living first', [LIVING, CORPSE]],
])('a living token on a corpse\'s square (%s in the roster)', (_label, roster) => {
  it('draws the living token and names the square for it', () => {
    render(<TacticalMap {...props(roster, 'someone-else')} />);
    const cell = screen.getByRole('gridcell', { name: /Row 3, column 3\./ });
    expect(cell).toHaveAccessibleName(/Bren, ally/);
    expect(cell).not.toHaveAccessibleName(/Timberwolf/);
    expect(cell).not.toHaveAccessibleName(/dead/);
    expect(cell.textContent).toContain('B');
    expect(cell.textContent).not.toContain('T');
  });

  it('names the viewer\'s own living token as "you", not the corpse', () => {
    render(<TacticalMap {...props(roster, 'p1')} />);
    const cell = screen.getByRole('gridcell', { name: /Row 3, column 3\./ });
    expect(cell).toHaveAccessibleName(/Bren — you/);
    expect(cell).not.toHaveAccessibleName(/Timberwolf/);
  });
});

it('negative control: a lone corpse is still drawn and named dead', () => {
  render(<TacticalMap {...props([CORPSE], 'someone-else')} />);
  const cell = screen.getByRole('gridcell', { name: /Row 3, column 3\./ });
  expect(cell).toHaveAccessibleName(/Timberwolf, hostile, dead\./);
  expect(cell.textContent).toContain('T');
});
