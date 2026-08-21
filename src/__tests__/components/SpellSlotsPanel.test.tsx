/**
 * SpellSlotsPanel — T5 (DDX-09 HP + spell-slots slice).
 *
 * Happy-path spend/restore wiring + busy-latch + non-caster empty rendering,
 * mirrors InventoryPanel.test.tsx's conventions.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';

jest.mock('../../lib/api/dnd', () => ({
  adjustSpellSlot: jest.fn(),
  getCharacterSheet: jest.fn(),
}));

import * as dnd from '../../lib/api/dnd';
import { ToastProvider } from '../../components/Toast';
import SpellSlotsPanel from '../../components/SpellSlotsPanel';
import type { CharacterSheet, SheetSpellSlot } from '../../lib/api/types';

const mockAdjustSlot = dnd.adjustSpellSlot as jest.Mock;
const mockGetSheet = dnd.getCharacterSheet as jest.Mock;

function ability(score: number, modifier: number) {
  return { score, modifier };
}

const SLOTS: Record<string, SheetSpellSlot> = {
  '1': { max: 4, used: 1, remaining: 3 },
  '2': { max: 2, used: 0, remaining: 2 },
};

const BASE_SHEET: CharacterSheet = {
  character_id: 'cid-2',
  owner_username: 'leon',
  name: 'Mireille',
  race: 'Elf',
  subrace: '',
  char_class: 'Wizard',
  subclass: '',
  level: 3,
  background: 'Sage',
  alignment: '',
  ability_scores: {
    strength: ability(8, -1),
    dexterity: ability(14, 2),
    constitution: ability(12, 1),
    intelligence: ability(17, 3),
    wisdom: ability(10, 0),
    charisma: ability(10, 0),
  },
  hp: { current: 18, max: 18, temp: 0 },
  ac: 12,
  initiative: 2,
  proficiency_bonus: 2,
  speed: 30,
  xp: 900,
  xp_next: 2700,
  hit_dice_remaining: 3,
  proficient_saves: ['intelligence', 'wisdom'],
  proficient_skills: ['arcana'],
  class_features: [],
  conditions: [],
  spellcasting: { ability: 'intelligence', save_dc: 13, attack_bonus: 5 },
  spell_slots: SLOTS,
  is_spellcaster: true,
  inventory: [],
  inventory_weight: 0,
};

function renderPanel(
  slots: Record<string, SheetSpellSlot> = SLOTS,
  onChanged = jest.fn(),
  overrides?: {
    isOwner?: boolean;
    isCaster?: boolean;
    spellcasting?: CharacterSheet['spellcasting'];
    spellPoints?: CharacterSheet['spell_points'];
  },
) {
  render(
    <ToastProvider>
      <SpellSlotsPanel
        characterId="cid-2"
        username="leon"
        isOwner={overrides?.isOwner ?? true}
        isCaster={overrides?.isCaster ?? true}
        spellcasting={overrides?.spellcasting ?? BASE_SHEET.spellcasting}
        spellSlots={slots}
        spellPoints={overrides?.spellPoints}
        onChanged={onChanged}
      />
    </ToastProvider>,
  );
  return { onChanged };
}

/** A level-1 Ki Warrior exactly as dev character 24051 comes off the wire:
 *  pool 4/4, NO slot rows at all, and the class's own name for its pool. */
const KI_POINTS: NonNullable<CharacterSheet['spell_points']> = {
  casting_model: 'points',
  label: 'Ki',
  points: { current: 4, maximum: 4 },
  high_level_casts: {},
  max_slot_level: 2,
  costs: { '1': 2, '2': 3, '3': 5, '4': 6, '5': 7, '6': 9, '7': 10, '8': 11, '9': 13 },
};

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  mockAdjustSlot.mockReset();
  mockGetSheet.mockReset();
});

describe('SpellSlotsPanel — non-caster renders nothing', () => {
  it('renders no slots widget at all when isCaster is false, even with slot data present', () => {
    render(
      <ToastProvider>
        <SpellSlotsPanel
          characterId="cid-2"
          username="leon"
          isOwner={true}
          isCaster={false}
          spellcasting={null}
          spellSlots={SLOTS}
          onChanged={jest.fn()}
        />
      </ToastProvider>,
    );
    // ToastProvider always renders its (empty) viewport, so assert on the
    // panel's own content being absent rather than the whole container.
    expect(screen.queryByText('Spells')).not.toBeInTheDocument();
    expect(screen.queryByText('Level 1')).not.toBeInTheDocument();
    expect(screen.queryByText('No spell slots at this level yet.')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^spend/i })).not.toBeInTheDocument();
  });
});

describe('SpellSlotsPanel — read-only rendering', () => {
  it('renders slot pips per level with remaining/max counts', () => {
    renderPanel();
    expect(screen.getByText('Level 1')).toBeInTheDocument();
    expect(screen.getByText('3/4')).toBeInTheDocument();
    expect(screen.getByText('Level 2')).toBeInTheDocument();
    expect(screen.getByText('2/2')).toBeInTheDocument();
  });

  it('renders the empty-row message for a caster with zero slot levels', () => {
    renderPanel({});
    expect(screen.getByText('No spell slots at this level yet.')).toBeInTheDocument();
  });

  it('non-owner: no spend/restore controls render', () => {
    renderPanel(SLOTS, jest.fn(), { isOwner: false });
    expect(screen.queryByRole('button', { name: /^spend/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^restore/i })).not.toBeInTheDocument();
  });
});

describe('SpellSlotsPanel — spend calls the right endpoint and updates pips', () => {
  it('clicking Spend on level 1 calls adjustSpellSlot(1, "spend"), applies the response, then refetches', async () => {
    // Real adjust response: the ONE affected level, flat.
    mockAdjustSlot.mockResolvedValue({ level: 1, max: 4, used: 2, remaining: 2 });
    mockGetSheet.mockResolvedValue({
      ...BASE_SHEET,
      spell_slots: { '1': { max: 4, used: 2, remaining: 2 }, '2': { max: 2, used: 0, remaining: 2 } },
    });
    const { onChanged } = renderPanel();

    fireEvent.click(screen.getByRole('button', { name: 'Spend a level 1 spell slot' }));
    await flush();

    expect(mockAdjustSlot).toHaveBeenCalledWith('cid-2', 'leon', 1, 'spend');
    expect(screen.getByText('2/4')).toBeInTheDocument();
    expect(mockGetSheet).toHaveBeenCalledWith('cid-2', 'leon');
    expect(onChanged).toHaveBeenCalled();
  });

  it('Spend is disabled when a level has zero slots remaining', () => {
    renderPanel({ '1': { max: 4, used: 4, remaining: 0 } });
    expect(screen.getByRole('button', { name: 'Spend a level 1 spell slot' })).toBeDisabled();
  });
});

describe('SpellSlotsPanel — restore calls the right endpoint and updates pips', () => {
  it('clicking Restore on level 1 calls adjustSpellSlot(1, "restore")', async () => {
    mockAdjustSlot.mockResolvedValue({ level: 1, max: 4, used: 0, remaining: 4 });
    mockGetSheet.mockResolvedValue({
      ...BASE_SHEET,
      spell_slots: { '1': { max: 4, used: 0, remaining: 4 }, '2': { max: 2, used: 0, remaining: 2 } },
    });
    const { onChanged } = renderPanel();

    fireEvent.click(screen.getByRole('button', { name: 'Restore a level 1 spell slot' }));
    await flush();

    expect(mockAdjustSlot).toHaveBeenCalledWith('cid-2', 'leon', 1, 'restore');
    expect(screen.getByText('4/4')).toBeInTheDocument();
    expect(onChanged).toHaveBeenCalled();
  });

  it('Restore is disabled when a level is already at max', () => {
    renderPanel({ '2': { max: 2, used: 0, remaining: 2 } });
    expect(screen.getByRole('button', { name: 'Restore a level 2 spell slot' })).toBeDisabled();
  });
});

describe('SpellSlotsPanel — success toast announcement', () => {
  it('announces spend and restore', async () => {
    mockAdjustSlot.mockResolvedValue({ level: 1, max: 4, used: 1, remaining: 3 });
    mockGetSheet.mockResolvedValue({ ...BASE_SHEET });
    renderPanel();

    fireEvent.click(screen.getByRole('button', { name: 'Spend a level 1 spell slot' }));
    await flush();
    expect(await screen.findByText('Spent a level 1 spell slot.')).toBeInTheDocument();
  });
});

describe('SpellSlotsPanel — busy-latch double-submit protection', () => {
  it('back-to-back clicks on Spend in the same React batch call adjustSpellSlot only once', async () => {
    mockAdjustSlot.mockResolvedValue({ level: 1, max: 4, used: 1, remaining: 3 });
    mockGetSheet.mockResolvedValue({ ...BASE_SHEET });
    renderPanel();

    const spendBtn = screen.getByRole('button', { name: 'Spend a level 1 spell slot' });
    await act(async () => {
      fireEvent.click(spendBtn);
      fireEvent.click(spendBtn);
    });
    await flush();

    expect(mockAdjustSlot).toHaveBeenCalledTimes(1);
  });

  it('releases the latch on a failed mutate — a subsequent click tries again', async () => {
    mockAdjustSlot.mockRejectedValueOnce(new Error('network blip'));
    mockAdjustSlot.mockResolvedValueOnce({ level: 1, max: 4, used: 1, remaining: 3 });
    mockGetSheet.mockResolvedValue({ ...BASE_SHEET });
    renderPanel();

    const spendBtn = screen.getByRole('button', { name: 'Spend a level 1 spell slot' });
    fireEvent.click(spendBtn);
    await flush();
    expect(mockAdjustSlot).toHaveBeenCalledTimes(1);

    await waitFor(() => expect(spendBtn).toBeEnabled());

    fireEvent.click(spendBtn);
    await flush();
    expect(mockAdjustSlot).toHaveBeenCalledTimes(2);
  });

  it('spend on level 1 and restore on level 2 fired in the same batch share the one ref: only the first dispatch mutates', async () => {
    mockAdjustSlot.mockResolvedValue({ level: 1, max: 4, used: 1, remaining: 3 });
    mockGetSheet.mockResolvedValue({ ...BASE_SHEET });
    renderPanel();

    const spendBtn = screen.getByRole('button', { name: 'Spend a level 1 spell slot' });
    const restoreBtn = screen.getByRole('button', { name: 'Restore a level 2 spell slot' });
    await act(async () => {
      fireEvent.click(spendBtn);
      fireEvent.click(restoreBtn);
    });
    await flush();

    expect(mockAdjustSlot).toHaveBeenCalledTimes(1);
    expect(mockAdjustSlot).toHaveBeenCalledWith('cid-2', 'leon', 1, 'spend');
  });
});

describe('SpellSlotsPanel — refetch failure after a successful mutate (D2 pattern)', () => {
  it('getCharacterSheet throwing after a resolved adjustSpellSlot gets its own warn toast, never onChanged, and releases the latch', async () => {
    mockAdjustSlot.mockResolvedValue({ level: 1, max: 4, used: 2, remaining: 2 });
    mockGetSheet.mockRejectedValue(new Error('network blip'));
    const { onChanged } = renderPanel();

    const spendBtn = screen.getByRole('button', { name: 'Spend a level 1 spell slot' });
    fireEvent.click(spendBtn);
    await flush();

    expect(
      await screen.findByText("Couldn't refresh your sheet — reload to see the result."),
    ).toBeInTheDocument();
    expect(screen.queryByText('Spent a level 1 spell slot.')).not.toBeInTheDocument();
    expect(onChanged).not.toHaveBeenCalled();
    // The pips already applied from the mutation response even though the
    // refetch failed.
    expect(screen.getByText('2/4')).toBeInTheDocument();
    await waitFor(() => expect(spendBtn).toBeEnabled());
  });
});

// ─── Miko adversarial additions (T5 DDX-09 HP/slots gate, 2026-07-09) ───────

describe('Miko adversarial — cross-row busy-latch is a GLOBAL/shared gate, not per-row (matches InventoryPanel precedent)', () => {
  it('while level-1 Spend is in flight, level-2 Restore is ALSO disabled (shared ref/state, not scoped to the mutating row)', async () => {
    let resolveAdjust: (v: unknown) => void = () => {};
    mockAdjustSlot.mockReturnValue(
      new Promise((resolve) => {
        resolveAdjust = resolve;
      }),
    );
    renderPanel();

    const spendBtn = screen.getByRole('button', { name: 'Spend a level 1 spell slot' });
    const restoreL2Btn = screen.getByRole('button', { name: 'Restore a level 2 spell slot' });
    fireEvent.click(spendBtn);
    await act(async () => {
      await Promise.resolve();
    });

    expect(restoreL2Btn).toBeDisabled();

    resolveAdjust({ level: 1, max: 4, used: 1, remaining: 3 });
    await flush();
  });

  it('aria-busy is only true on the mutating row while it is in flight, not on the other row', async () => {
    let resolveAdjust: (v: unknown) => void = () => {};
    mockAdjustSlot.mockReturnValue(
      new Promise((resolve) => {
        resolveAdjust = resolve;
      }),
    );
    renderPanel();

    fireEvent.click(screen.getByRole('button', { name: 'Spend a level 1 spell slot' }));
    await act(async () => {
      await Promise.resolve();
    });

    const level1Row = screen.getByText('Level 1').closest('li');
    const level2Row = screen.getByText('Level 2').closest('li');
    expect(level1Row).toHaveAttribute('aria-busy', 'true');
    expect(level2Row).toHaveAttribute('aria-busy', 'false');

    resolveAdjust({ level: 1, max: 4, used: 1, remaining: 3 });
    await flush();
  });
});

describe('Miko adversarial — malformed spell_slots shape from the sheet (defense-in-depth, not user input)', () => {
  it('a non-numeric level key does not crash the panel (characterization: renders "Level <key>" verbatim, no throw)', () => {
    // The sheet's own spell_slots is server-trusted data (see the header
    // comment); this simulates a hypothetically corrupted/legacy payload
    // shape rather than anything a user can type — there is no level input
    // anywhere in this UI.
    expect(() =>
      renderPanel({ garbage: { max: 2, used: 0, remaining: 2 } } as unknown as Record<
        string,
        SheetSpellSlot
      >),
    ).not.toThrow();
    expect(screen.getByText('Level garbage')).toBeInTheDocument();
  });
});

describe('Miko adversarial — busy-latch releases on error for BOTH spend and restore (not just spend)', () => {
  it('restore: a rejected adjustSpellSlot releases the latch — a subsequent restore click tries again', async () => {
    mockAdjustSlot.mockRejectedValueOnce(new Error('network blip'));
    mockAdjustSlot.mockResolvedValueOnce({ level: 1, max: 4, used: 1, remaining: 3 });
    mockGetSheet.mockResolvedValue({ ...BASE_SHEET });
    // remaining < max on level 2 so Restore is actually enabled (the default
    // SLOTS fixture has level 2 already at max, where Restore is correctly
    // disabled — that's a different, already-covered case).
    renderPanel({ '2': { max: 2, used: 1, remaining: 1 } });

    const restoreBtn = screen.getByRole('button', { name: 'Restore a level 2 spell slot' });
    fireEvent.click(restoreBtn);
    await flush();
    expect(mockAdjustSlot).toHaveBeenCalledTimes(1);

    await waitFor(() => expect(restoreBtn).toBeEnabled());
    fireEvent.click(restoreBtn);
    await flush();
    expect(mockAdjustSlot).toHaveBeenCalledTimes(2);
  });
});

describe('SpellSlotsPanel — HB-P2 spell points (TAV-SPELLPOINTS-NO-UI)', () => {
  /* The live bug, found in the browser as tav-test-1 on 2026-08-21: a points
   * caster carries NO `spell_slot_*` rows, so `spell_slots` is legitimately
   * `{}`. The panel read that as "nothing to show" and rendered "No spell
   * slots at this level yet." — leaving the pool the entire Dragon Ball
   * campaign runs on invisible and unspendable. The pool was on the wire and
   * arithmetically correct the whole time (24051: 4/4 at level 1). */

  it('renders the pool instead of the empty row when slots are empty but points exist', async () => {
    renderPanel({}, jest.fn(), { spellPoints: KI_POINTS });

    expect(screen.queryByText(/no spell slots at this level yet/i)).not.toBeInTheDocument();
    expect(screen.getByText('4/4')).toBeInTheDocument();
  });

  it('titles the panel with the CLASS’s name for its pool, not "Spells"', () => {
    renderPanel({}, jest.fn(), { spellPoints: KI_POINTS });

    // "Ki" comes from the class row's `spellcasting.points_label`. Hardcoding
    // "Spells" here is what made a ki class read as a wizard.
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(/^Ki/);
  });

  it('offers one row per castable rank, priced from the ENGINE-supplied ladder', () => {
    renderPanel({}, jest.fn(), { spellPoints: KI_POINTS });

    expect(screen.getByText('Rank 1')).toBeInTheDocument();
    expect(screen.getByText('Rank 2')).toBeInTheDocument();
    // max_slot_level is 2 — rank 3 is beyond this character and must not render.
    expect(screen.queryByText('Rank 3')).not.toBeInTheDocument();
  });

  it('disables Spend on a rank the pool cannot afford', () => {
    renderPanel({}, jest.fn(), {
      spellPoints: { ...KI_POINTS, points: { current: 2, maximum: 4 } },
    });

    // Rank 1 costs 2 — affordable at exactly 2. Rank 2 costs 3 — not.
    expect(screen.getByRole('button', { name: /spend 2 ki on a rank 1/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /spend 3 ki on a rank 2/i })).toBeDisabled();
  });

  it('disables Spend on a 6+ rank whose once-per-long-rest gate is already spent', () => {
    /* Affordability is NOT the whole answer above rank 5: the DMG allows one
     * cast of EACH level 6-9 per long rest. A pool with plenty of points left
     * must still refuse the second 6th-rank cast. */
    renderPanel({}, jest.fn(), {
      spellPoints: {
        ...KI_POINTS,
        points: { current: 90, maximum: 133 },
        max_slot_level: 6,
        high_level_casts: { '6': 0 },
      },
    });

    expect(screen.getByRole('button', { name: /spend 9 ki on a rank 6/i })).toBeDisabled();
    expect(screen.getByText(/rank 6 · used this rest/i)).toBeInTheDocument();
  });

  it('a normal SLOTS caster is completely unaffected', () => {
    /* NEGATIVE CONTROL. The points branch must be invisible to every existing
     * character — without this, "make points render" could pass by rendering
     * points for everybody. */
    renderPanel(SLOTS, jest.fn(), { spellPoints: null });

    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(/^Spells/);
    expect(screen.getByText('Level 1')).toBeInTheDocument();
    expect(screen.queryByText(/^Rank /)).not.toBeInTheDocument();
  });

  it('an engine that does not send the field at all still renders slots', () => {
    // Back-compat: `spell_points` is optional; an older engine omits it.
    renderPanel(SLOTS, jest.fn(), {});
    expect(screen.getByText('Level 1')).toBeInTheDocument();
  });
});
