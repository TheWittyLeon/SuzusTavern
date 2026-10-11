/**
 * CastSpellPanel — the panel's side of ENGINE-CASTABLE-NOW-IGNORES-HIGHER-SLOTS (H3-F5).
 *
 * `castable_now` is the engine's word on whether a spell can be cast at all, and the panel
 * trusts it (it does not re-derive slot or preparation rules). Once the engine reports true
 * for "a slot at or above the spell's level remains", a spell whose own-level slots are spent
 * must be OFFERED, and the request must carry a level that still has a slot. The panel must
 * also behave under the previous engine, which reports true only at the spell's own level.
 */
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';

jest.mock('../../lib/api/dnd', () => ({
  getKnownSpells: jest.fn(),
  castSpell: jest.fn(),
  getCharacterSheet: jest.fn(),
}));

import * as dnd from '../../lib/api/dnd';
import { ToastProvider } from '../../components/Toast';
import CastSpellPanel from '../../components/CastSpellPanel';
import type {
  CombatParticipantState,
  SheetSpellEntry,
  SheetSpellSlot,
  SpellListResult,
} from '../../lib/api/types';

const mockGetKnown = dnd.getKnownSpells as jest.Mock;
const mockCastSpell = dnd.castSpell as jest.Mock;
const mockGetSheet = dnd.getCharacterSheet as jest.Mock;

function spell(overrides: Partial<SheetSpellEntry>): SheetSpellEntry {
  return {
    slug: 'magic-missile',
    name: 'Magic Missile',
    level: 1,
    school: 'evocation',
    source: 'class',
    prepared: true,
    is_cantrip: false,
    concentration: false,
    ritual: false,
    castable_now: true,
    min_slot_level: 1,
    heals: false,
    ...overrides,
  };
}

function listOf(spells: SheetSpellEntry[]): SpellListResult {
  return {
    is_spellcaster: true,
    caster_kind: 'prepared',
    ability: 'intelligence',
    budget: { cantrips_known: 0, cantrips_max: 3, spells_known: null, spells_max: null, prepared_used: 1, prepared_max: 4 },
    cantrips: [],
    spells,
  };
}

const ENEMY: CombatParticipantState = {
  participant_id: 'p-enemy',
  entity_id: 'goblin-1',
  name: 'Goblin',
  is_pc: false,
  initiative: 10,
  hp_current: 7,
  hp_max: 7,
  ac: 12,
  conditions: [],
  is_alive: true,
  can_be_targeted: true,
  is_active_turn: false,
  took_turn: false,
};

function renderPanel(spellSlots: Record<string, SheetSpellSlot>) {
  render(
    <ToastProvider>
      <CastSpellPanel
        combatId="combat-1"
        characterId="cid-1"
        username="leon"
        participants={[ENEMY]}
        spellSlots={spellSlots}
        isPlayerTurn
        onCast={jest.fn()}
        onSheetChanged={jest.fn()}
        onStateRefresh={jest.fn()}
      />
    </ToastProvider>,
  );
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  mockGetKnown.mockReset();
  mockCastSpell.mockReset();
  mockGetSheet.mockReset();
  mockCastSpell.mockResolvedValue({ message: 'Three darts strike the goblin.' });
  mockGetSheet.mockRejectedValue(new Error('not under test'));
});

// A wizard whose level-1 slots are spent and who has one level-2 slot left.
const ONLY_LEVEL_TWO: Record<string, SheetSpellSlot> = {
  '1': { max: 4, used: 4, remaining: 0 },
  '2': { max: 2, used: 1, remaining: 1 },
};

describe('CastSpellPanel — castable only by a higher slot', () => {
  it('offers the spell, defaults the picker to the level that has a slot, and casts at that level', async () => {
    mockGetKnown.mockResolvedValue(listOf([spell({ castable_now: true })]));
    renderPanel(ONLY_LEVEL_TWO);
    await flush();

    const options = Array.from((await screen.findByLabelText('Spell')).querySelectorAll('option')).map((o) => o.textContent);
    expect(options.some((t) => t?.includes('Magic Missile'))).toBe(true);

    const slotSelect = screen.getByLabelText('Slot level') as HTMLSelectElement;
    expect(Array.from(slotSelect.querySelectorAll('option')).map((o) => o.textContent)).toEqual(['Level 2']);
    expect(slotSelect.value).toBe('2');

    fireEvent.change(screen.getByLabelText('Target'), { target: { value: 'p-enemy' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cast Magic Missile' }));
    await flush();

    expect(mockCastSpell).toHaveBeenCalledWith(expect.objectContaining({ spell_name: 'magic-missile', slot_level: 2 }));
  });

  it('with own-level slots too (the previous engine reports true here), defaults to the spell\'s own level and offers the upcast', async () => {
    mockGetKnown.mockResolvedValue(listOf([spell({ castable_now: true })]));
    renderPanel({ '1': { max: 4, used: 1, remaining: 3 }, '2': { max: 2, used: 0, remaining: 2 } });
    await flush();

    const slotSelect = (await screen.findByLabelText('Slot level')) as HTMLSelectElement;
    expect(Array.from(slotSelect.querySelectorAll('option')).map((o) => o.textContent)).toEqual(['Level 1', 'Level 2']);
    expect(slotSelect.value).toBe('1');
  });

  it('a spell the engine reports not castable stays out of the list (the panel does not re-derive castability)', async () => {
    mockGetKnown.mockResolvedValue(listOf([spell({ castable_now: false })]));
    renderPanel(ONLY_LEVEL_TWO);
    await flush();

    expect(await screen.findByText('Nothing castable right now.')).toBeInTheDocument();
  });
});
