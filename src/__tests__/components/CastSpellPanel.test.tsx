/**
 * CastSpellPanel — T6 (DDX-12 cast-in-combat UI).
 *
 * Castable-only picker, DDX-04 upcast slot-level range, target picker
 * (excludes self), cast wiring (spell_name/slot_level/target shape),
 * busy-latch, success toast, and refetch-after-mutate (sheet + combat state)
 * — mirrors SpellbookPanel/SpellSlotsPanel's test conventions.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
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
  CharacterSheet,
  CombatParticipantState,
  SheetSpellEntry,
  SheetSpellSlot,
  SpellListResult,
} from '../../lib/api/types';

const mockGetKnown = dnd.getKnownSpells as jest.Mock;
const mockCastSpell = dnd.castSpell as jest.Mock;
const mockGetSheet = dnd.getCharacterSheet as jest.Mock;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SPELL_LIST: SpellListResult = {
  is_spellcaster: true,
  caster_kind: 'prepared',
  ability: 'wisdom',
  budget: {
    cantrips_known: 1,
    cantrips_max: 3,
    spells_known: null,
    spells_max: null,
    prepared_used: 2,
    prepared_max: 4,
  },
  cantrips: [
    {
      slug: 'sacred-flame',
      name: 'Sacred Flame',
      level: 0,
      school: 'evocation',
      source: 'class',
      prepared: true,
      is_cantrip: true,
      concentration: false,
      ritual: false,
      castable_now: true,
    },
  ],
  spells: [
    {
      slug: 'cure-wounds',
      name: 'Cure Wounds',
      level: 1,
      school: 'evocation',
      source: 'class',
      prepared: true,
      is_cantrip: false,
      concentration: false,
      ritual: false,
      castable_now: true,
      min_slot_level: 1,
    },
    {
      slug: 'guiding-bolt',
      name: 'Guiding Bolt',
      level: 1,
      school: 'evocation',
      source: 'class',
      prepared: false,
      is_cantrip: false,
      concentration: false,
      ritual: false,
      castable_now: false, // not prepared — must be excluded from the picker
      min_slot_level: 1,
    },
  ],
};

// Level 1 and 2 both have slots remaining; level 3 is empty — upcast range
// for Cure Wounds (min_slot_level 1) should be exactly [1, 2].
const SLOTS: Record<string, SheetSpellSlot> = {
  '1': { max: 4, used: 1, remaining: 3 },
  '2': { max: 2, used: 0, remaining: 2 },
  '3': { max: 0, used: 0, remaining: 0 },
};

function participant(overrides: Partial<CombatParticipantState>): CombatParticipantState {
  return {
    participant_id: 'p',
    entity_id: 'e',
    name: 'Participant',
    is_pc: true,
    initiative: 10,
    hp_current: 10,
    hp_max: 10,
    ac: 12,
    conditions: [],
    is_alive: true,
    can_be_targeted: true,
    is_active_turn: false,
    took_turn: false,
    ...overrides,
  };
}

const SELF = participant({ participant_id: 'p-self', entity_id: 'cid-1', name: 'Me' });
const ALLY = participant({
  participant_id: 'p-ally',
  entity_id: 'cid-2',
  name: 'Twilight',
  hp_current: 10,
  hp_max: 20,
});
const ENEMY = participant({
  participant_id: 'p-enemy',
  entity_id: 'goblin-1',
  name: 'Goblin',
  is_pc: false,
  hp_current: 7,
  hp_max: 7,
});

const SHEET: CharacterSheet = {
  character_id: 'cid-1',
  owner_username: 'leon',
  name: 'Suzu Cleric',
  race: 'Human',
  subrace: '',
  char_class: 'Cleric',
  subclass: '',
  level: 3,
  background: 'Acolyte',
  alignment: '',
  ability_scores: {
    strength: { score: 10, modifier: 0 },
    dexterity: { score: 10, modifier: 0 },
    constitution: { score: 12, modifier: 1 },
    intelligence: { score: 10, modifier: 0 },
    wisdom: { score: 16, modifier: 3 },
    charisma: { score: 10, modifier: 0 },
  },
  hp: { current: 20, max: 20, temp: 0 },
  ac: 14,
  initiative: 0,
  proficiency_bonus: 2,
  speed: 30,
  xp: 900,
  xp_next: 2700,
  hit_dice_remaining: 3,
  proficient_saves: ['wisdom', 'charisma'],
  proficient_skills: [],
  class_features: [],
  conditions: [],
  spellcasting: { ability: 'wisdom', save_dc: 13, attack_bonus: 5 },
  spell_slots: SLOTS,
  is_spellcaster: true,
  inventory: [],
  inventory_weight: 0,
};

function renderPanel(overrides?: {
  isPlayerTurn?: boolean;
  disabled?: boolean;
  onCast?: (text: string) => void;
  onSheetChanged?: (sheet: CharacterSheet) => void;
  onStateRefresh?: () => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const onCast = overrides?.onCast ?? jest.fn();
  const onSheetChanged = overrides?.onSheetChanged ?? jest.fn();
  const onStateRefresh = overrides?.onStateRefresh ?? jest.fn();
  const onBusyChange = overrides?.onBusyChange ?? jest.fn();
  render(
    <ToastProvider>
      <CastSpellPanel
        combatId="combat-1"
        characterId="cid-1"
        username="leon"
        participants={[SELF, ALLY, ENEMY]}
        spellSlots={SLOTS}
        isPlayerTurn={overrides?.isPlayerTurn ?? true}
        disabled={overrides?.disabled ?? false}
        onCast={onCast}
        onSheetChanged={onSheetChanged}
        onStateRefresh={onStateRefresh}
        onBusyChange={onBusyChange}
      />
    </ToastProvider>,
  );
  return { onCast, onSheetChanged, onStateRefresh, onBusyChange };
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function selectSpell(name: string) {
  fireEvent.change(screen.getByLabelText('Spell'), { target: { value: spellSlugFor(name) } });
}

function spellSlugFor(name: string): string {
  const all = [...SPELL_LIST.cantrips, ...SPELL_LIST.spells];
  const found = all.find((s) => s.name === name);
  if (!found) throw new Error(`fixture has no spell named ${name}`);
  return found.slug;
}

beforeEach(() => {
  mockGetKnown.mockReset();
  mockCastSpell.mockReset();
  mockGetSheet.mockReset();
  mockGetKnown.mockResolvedValue(SPELL_LIST);
});

describe('CastSpellPanel — castable picker', () => {
  it('lists only castable_now spells (cantrip + leveled), excludes a prepared-but-not-castable one', async () => {
    renderPanel();
    await flush();

    const select = await screen.findByLabelText('Spell');
    const optionNames = Array.from(select.querySelectorAll('option')).map((o) => o.textContent);
    expect(optionNames.some((t) => t?.includes('Sacred Flame'))).toBe(true);
    expect(optionNames.some((t) => t?.includes('Cure Wounds'))).toBe(true);
    expect(optionNames.some((t) => t?.includes('Guiding Bolt'))).toBe(false);
  });

  it('shows the empty state when nothing is castable', async () => {
    mockGetKnown.mockResolvedValue({ ...SPELL_LIST, cantrips: [], spells: [] });
    renderPanel();
    await flush();
    expect(await screen.findByText('Nothing castable right now.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Spell')).not.toBeInTheDocument();
  });
});

describe('CastSpellPanel — DDX-04 upcast slot-level chooser', () => {
  it('offers min_slot_level..highest-with-remaining for a leveled spell (1 and 2, not the empty level 3)', async () => {
    renderPanel();
    await flush();
    selectSpell('Cure Wounds');

    const slotSelect = await screen.findByLabelText('Slot level');
    const levels = Array.from(slotSelect.querySelectorAll('option')).map((o) => o.textContent);
    expect(levels).toEqual(['Level 1', 'Level 2']);
  });

  it('defaults to the LOWEST available slot level', async () => {
    renderPanel();
    await flush();
    selectSpell('Cure Wounds');

    const slotSelect = (await screen.findByLabelText('Slot level')) as HTMLSelectElement;
    expect(slotSelect.value).toBe('1');
  });

  it('hides the slot-level chooser entirely for a cantrip', async () => {
    renderPanel();
    await flush();
    selectSpell('Sacred Flame');
    expect(screen.queryByLabelText('Slot level')).not.toBeInTheDocument();
  });

  it('defensive fallback: castable_now=true but every level from min_slot_level up shows 0 local remaining still offers exactly [min] rather than stranding the picker empty', async () => {
    // Proves the component's own documented fallback (upcastLevels' `return
    // levels.length > 0 ? levels : [min]`) — the two data sources
    // (server-computed castable_now vs the locally-held sheet.spell_slots
    // prop) CAN legitimately disagree for a moment (e.g. a stale sheet
    // snapshot right after another slot-spending action elsewhere). Without
    // this fallback the Cast button would have a selected spell but zero
    // slot options, which downstream reads as `slotLevel === null` ->
    // `selectedSpell.level` on submit — the fallback keeps the UI usable
    // and lets the ENGINE be the final arbiter (no_slots refusal) instead of
    // silently stranding the control.
    const ALL_EMPTY: Record<string, SheetSpellSlot> = {
      '1': { max: 4, used: 4, remaining: 0 },
      '2': { max: 2, used: 2, remaining: 0 },
    };
    render(
      <ToastProvider>
        <CastSpellPanel
          combatId="combat-1"
          characterId="cid-1"
          username="leon"
          participants={[SELF, ALLY, ENEMY]}
          spellSlots={ALL_EMPTY}
          isPlayerTurn
          onCast={jest.fn()}
          onSheetChanged={jest.fn()}
          onStateRefresh={jest.fn()}
        />
      </ToastProvider>,
    );
    await flush();
    selectSpell('Cure Wounds');

    const slotSelect = (await screen.findByLabelText('Slot level')) as HTMLSelectElement;
    const levels = Array.from(slotSelect.querySelectorAll('option')).map((o) => o.textContent);
    expect(levels).toEqual(['Level 1']);
    expect(slotSelect.value).toBe('1');
  });

  it('a spell whose min_slot_level exceeds every level the caster has (not just 0-remaining, genuinely absent from spell_slots) still falls back to offering min rather than crashing', async () => {
    // e.g. a 3rd-level spell reported castable_now=true against a sheet
    // that only tracks levels 1-2 (half-caster edge case / stale snapshot).
    // `slots[String(lvl)]?.remaining ?? 0` handles the missing-key case
    // safely; the fallback still surfaces `[min]` so the control isn't
    // empty — same reasoning as the previous test, different shape of gap
    // (missing key vs present-but-zero).
    const HIGH_MIN_SPELL: SheetSpellEntry = {
      slug: 'fireball',
      name: 'Fireball',
      level: 3,
      school: 'evocation',
      source: 'class',
      prepared: true,
      is_cantrip: false,
      concentration: false,
      ritual: false,
      castable_now: true,
      min_slot_level: 3,
    };
    mockGetKnown.mockResolvedValue({ ...SPELL_LIST, spells: [...SPELL_LIST.spells, HIGH_MIN_SPELL] });
    renderPanel();
    await flush();
    fireEvent.change(await screen.findByLabelText('Spell'), { target: { value: 'fireball' } });

    const slotSelect = (await screen.findByLabelText('Slot level')) as HTMLSelectElement;
    const levels = Array.from(slotSelect.querySelectorAll('option')).map((o) => o.textContent);
    expect(levels).toEqual(['Level 3']);
  });
});

describe('CastSpellPanel — target picker', () => {
  it('lists combatants excluding the caster themselves', async () => {
    renderPanel();
    await flush();

    const targetSelect = await screen.findByLabelText('Target');
    const names = Array.from(targetSelect.querySelectorAll('option')).map((o) => o.textContent);
    expect(names.some((t) => t?.includes('Twilight'))).toBe(true);
    expect(names.some((t) => t?.includes('Goblin'))).toBe(true);
    expect(names.some((t) => t?.includes('Me'))).toBe(false);
  });

  it('still offers a downed (is_alive: false, can_be_targeted: false) participant — the engine, not the UI, refuses an illegal target', async () => {
    // Confirms the header comment's own stated design ("everyone else is
    // offered — the engine validates the actual legality") against a
    // concrete case that comment never names explicitly: a corpse. Nothing
    // in `targets` filters on is_alive/can_be_targeted today — only the
    // caster's own entity_id is excluded.
    const DOWNED = participant({
      participant_id: 'p-downed',
      entity_id: 'goblin-2',
      name: 'Fallen Goblin',
      is_pc: false,
      is_alive: false,
      can_be_targeted: false,
      hp_current: 0,
    });
    render(
      <ToastProvider>
        <CastSpellPanel
          combatId="combat-1"
          characterId="cid-1"
          username="leon"
          participants={[SELF, ALLY, ENEMY, DOWNED]}
          spellSlots={SLOTS}
          isPlayerTurn
          onCast={jest.fn()}
          onSheetChanged={jest.fn()}
          onStateRefresh={jest.fn()}
        />
      </ToastProvider>,
    );
    await flush();

    const targetSelect = await screen.findByLabelText('Target');
    const names = Array.from(targetSelect.querySelectorAll('option')).map((o) => o.textContent);
    expect(names.some((t) => t?.includes('Fallen Goblin'))).toBe(true);
  });

  it('DDX-CAST-TARGETID-PLUMBING (fixed): two participants with the IDENTICAL exact name now send DIFFERENT target_id values, disambiguating the wire request', async () => {
    // Was DEFECT-CLASS: routes/spells.py::CastSpellRequest had no target_id
    // field (unlike /combat/attack, which already preferred an explicit
    // target_id and only fell back to name — see dnd.ts's own `attack()` doc
    // comment). cmd_cast now takes the same target_id kwarg and resolves by
    // participant_id FIRST when supplied (engine/commands/spell_commands.py),
    // mirroring cmd_attack — so two participants sharing an exact name (e.g.
    // two separate count=1 spawns of the same monster slug, no " #2" suffix)
    // are disambiguated by id even though `target` (the name, kept for
    // logs/graceful-degradation) is still identical either way.
    const GOBLIN_A = participant({
      participant_id: 'p-goblin-a',
      entity_id: 'goblin-a',
      name: 'Goblin',
      is_pc: false,
      hp_current: 7,
      hp_max: 7,
    });
    const GOBLIN_B = participant({
      participant_id: 'p-goblin-b',
      entity_id: 'goblin-b',
      name: 'Goblin',
      is_pc: false,
      hp_current: 3,
      hp_max: 7,
    });
    mockCastSpell.mockResolvedValue({ message: 'ok' });
    mockGetSheet.mockResolvedValue(SHEET);
    render(
      <ToastProvider>
        <CastSpellPanel
          combatId="combat-1"
          characterId="cid-1"
          username="leon"
          participants={[SELF, GOBLIN_A, GOBLIN_B]}
          spellSlots={SLOTS}
          isPlayerTurn
          onCast={jest.fn()}
          onSheetChanged={jest.fn()}
          onStateRefresh={jest.fn()}
        />
      </ToastProvider>,
    );
    await flush();

    selectSpell('Sacred Flame');
    fireEvent.change(screen.getByLabelText('Target'), { target: { value: 'p-goblin-a' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cast Sacred Flame' }));
    await flush();
    const firstCall = mockCastSpell.mock.calls[0][0];

    mockCastSpell.mockClear();
    fireEvent.change(screen.getByLabelText('Target'), { target: { value: 'p-goblin-b' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cast Sacred Flame' }));
    await flush();
    const secondCall = mockCastSpell.mock.calls[0][0];

    // `target` (the name) is still identical either way — kept for
    // logs/graceful-degradation, never the disambiguator.
    expect(firstCall.target).toBe('Goblin');
    expect(secondCall.target).toBe('Goblin');
    // `target_id` is what actually disambiguates the two DIFFERENT
    // participant_ids selected — no longer a byte-identical wire request.
    expect(firstCall.target_id).toBe('p-goblin-a');
    expect(secondCall.target_id).toBe('p-goblin-b');
    expect(firstCall.target_id).not.toBe(secondCall.target_id);
  });

  it('a LEVELED (non-cantrip) spell cast with no target selected omits `target` entirely — never sends an empty string, never sends target_id', async () => {
    mockCastSpell.mockResolvedValue({ message: 'ok' });
    mockGetSheet.mockResolvedValue(SHEET);
    renderPanel();
    await flush();

    selectSpell('Cure Wounds');
    fireEvent.click(screen.getByRole('button', { name: 'Cast Cure Wounds' }));
    await flush();

    expect(mockCastSpell).toHaveBeenCalledWith({
      username: 'leon',
      combat_id: 'combat-1',
      spell_name: 'cure-wounds',
      slot_level: 1,
    });
    const sentBody = mockCastSpell.mock.calls[0][0];
    expect(sentBody).not.toHaveProperty('target');
    expect(sentBody).not.toHaveProperty('target_id');
  });
});

describe('CastSpellPanel — cast wiring', () => {
  it('calls castSpell with spell_name, chosen slot_level, and the target name', async () => {
    mockCastSpell.mockResolvedValue({ message: 'You heal Twilight for 8 HP.' });
    mockGetSheet.mockResolvedValue(SHEET);
    const { onCast, onSheetChanged, onStateRefresh } = renderPanel();
    await flush();

    selectSpell('Cure Wounds');
    fireEvent.change(await screen.findByLabelText('Slot level'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('Target'), { target: { value: 'p-ally' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cast Cure Wounds' }));
    await flush();

    expect(mockCastSpell).toHaveBeenCalledWith({
      username: 'leon',
      combat_id: 'combat-1',
      spell_name: 'cure-wounds',
      slot_level: 2,
      target_id: 'p-ally',
      target: 'Twilight',
    });
    expect(onCast).toHaveBeenCalledWith('You heal Twilight for 8 HP.');
    expect(mockGetSheet).toHaveBeenCalledWith('cid-1', 'leon');
    expect(onSheetChanged).toHaveBeenCalledWith(SHEET);
    expect(onStateRefresh).toHaveBeenCalled();
  });

  it('raises then releases the shared combat-busy latch around a cast (attack rail off during a cast)', async () => {
    mockCastSpell.mockResolvedValue({ message: 'ok' });
    mockGetSheet.mockResolvedValue(SHEET);
    const { onBusyChange } = renderPanel();
    await flush();

    selectSpell('Sacred Flame');
    fireEvent.click(screen.getByRole('button', { name: 'Cast Sacred Flame' }));
    await flush();

    // true before the await, false in finally — parent wires this to setCombatBusy.
    expect(onBusyChange).toHaveBeenNthCalledWith(1, true);
    expect(onBusyChange).toHaveBeenNthCalledWith(2, false);
    expect(onBusyChange).toHaveBeenCalledTimes(2);
  });

  it('releases the shared combat-busy latch even when the cast fails', async () => {
    mockCastSpell.mockRejectedValue(new Error('boom'));
    const { onBusyChange } = renderPanel();
    await flush();

    selectSpell('Sacred Flame');
    fireEvent.click(screen.getByRole('button', { name: 'Cast Sacred Flame' }));
    await flush();

    expect(onBusyChange).toHaveBeenLastCalledWith(false);
  });

  it('omits slot_level for a cantrip and target when none is picked', async () => {
    mockCastSpell.mockResolvedValue({ message: 'Sacred flame sears the goblin.' });
    mockGetSheet.mockResolvedValue(SHEET);
    renderPanel();
    await flush();

    selectSpell('Sacred Flame');
    fireEvent.click(screen.getByRole('button', { name: 'Cast Sacred Flame' }));
    await flush();

    expect(mockCastSpell).toHaveBeenCalledWith({
      username: 'leon',
      combat_id: 'combat-1',
      spell_name: 'sacred-flame',
    });
  });

  it('surfaces a mapped refusal reason (not_your_turn) as a toast on cast failure, and never optimistically reports success', async () => {
    const err = new Error('API error 400: not_your_turn') as Error & {
      status: number;
      code: string;
      body: unknown;
    };
    err.status = 400;
    err.code = 'not_your_turn';
    err.body = { success: false, data: { reason: 'not_your_turn' } };
    mockCastSpell.mockRejectedValue(err);
    const { onCast, onSheetChanged, onStateRefresh } = renderPanel();
    await flush();

    fireEvent.click(screen.getByRole('button', { name: /^Cast /i }));
    await flush();

    expect(await screen.findByText("It's not your turn.")).toBeInTheDocument();
    // A refusal must never optimistically surface as a success: no chat-log
    // append, no sheet refetch/apply, no combat-state re-GET.
    expect(onCast).not.toHaveBeenCalled();
    expect(onSheetChanged).not.toHaveBeenCalled();
    expect(onStateRefresh).not.toHaveBeenCalled();
    expect(mockGetSheet).not.toHaveBeenCalled();
  });

  it('an UNMAPPED refusal reason (e.g. a future engine reason code this UI has not been taught yet) falls back to the generic copy, never a raw/leaked engine string', async () => {
    const err = new Error('API error 400: concentration_conflict') as Error & {
      status: number;
      code: string;
      body: unknown;
    };
    err.status = 400;
    err.code = 'concentration_conflict';
    err.body = {
      success: false,
      data: { reason: 'concentration_conflict' },
      message: '[Spell] Internal trace: concentration slot 3 already bound to caster_id=cid-1',
    };
    mockCastSpell.mockRejectedValue(err);
    renderPanel();
    await flush();

    fireEvent.click(screen.getByRole('button', { name: /^Cast /i }));
    await flush();

    expect(
      await screen.findByText('Could not cast Sacred Flame. Try again in a moment.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Internal trace/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/concentration_conflict/i)).not.toBeInTheDocument();
  });
});

describe('CastSpellPanel — turn gating', () => {
  it('disables Cast and shows a waiting note when it is not the caster\'s turn', async () => {
    renderPanel({ isPlayerTurn: false });
    await flush();
    expect(screen.getByRole('button', { name: /not your turn/i })).toBeDisabled();
    expect(screen.getByText('Waiting for your turn…')).toBeInTheDocument();
  });
});

describe('CastSpellPanel — busy-latch double-submit protection', () => {
  it('two fast clicks in the same batch call castSpell only once', async () => {
    let resolveCast: (v: unknown) => void = () => {};
    mockCastSpell.mockReturnValue(
      new Promise((resolve) => {
        resolveCast = resolve;
      }),
    );
    renderPanel();
    await flush();

    const btn = screen.getByRole('button', { name: /^Cast /i });
    await act(async () => {
      fireEvent.click(btn);
      fireEvent.click(btn);
    });
    expect(mockCastSpell).toHaveBeenCalledTimes(1);

    resolveCast({ message: 'ok' });
    mockGetSheet.mockResolvedValue(SHEET);
    await flush();
  });

  it('releases the latch on a failed cast — a subsequent click tries again', async () => {
    mockCastSpell.mockRejectedValueOnce(new Error('network blip'));
    mockCastSpell.mockResolvedValueOnce({ message: 'ok' });
    mockGetSheet.mockResolvedValue(SHEET);
    renderPanel();
    await flush();

    const btn = screen.getByRole('button', { name: /^Cast /i });
    fireEvent.click(btn);
    await flush();
    expect(mockCastSpell).toHaveBeenCalledTimes(1);

    await waitFor(() => expect(btn).toBeEnabled());
    fireEvent.click(btn);
    await flush();
    expect(mockCastSpell).toHaveBeenCalledTimes(2);
  });

  it('is aria-busy while the cast is in flight', async () => {
    let resolveCast: (v: unknown) => void = () => {};
    mockCastSpell.mockReturnValue(
      new Promise((resolve) => {
        resolveCast = resolve;
      }),
    );
    renderPanel();
    await flush();

    fireEvent.click(screen.getByRole('button', { name: /^Cast /i }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByRole('button', { name: /^Cast /i })).toHaveAttribute('aria-busy', 'true');

    resolveCast({ message: 'ok' });
    mockGetSheet.mockResolvedValue(SHEET);
    await flush();
  });
});

describe('CastSpellPanel — success toast', () => {
  it('announces the cast on success', async () => {
    mockCastSpell.mockResolvedValue({ message: 'You heal Twilight for 8 HP.' });
    mockGetSheet.mockResolvedValue(SHEET);
    renderPanel();
    await flush();

    selectSpell('Cure Wounds');
    fireEvent.click(screen.getByRole('button', { name: 'Cast Cure Wounds' }));
    await flush();

    expect(await screen.findByText('Cast Cure Wounds.')).toBeInTheDocument();
  });
});

describe('CastSpellPanel — refetch failure after a successful cast (D2 pattern)', () => {
  it('getCharacterSheet throwing after a resolved castSpell gets its own warn toast, never onSheetChanged', async () => {
    mockCastSpell.mockResolvedValue({ message: 'ok' });
    mockGetSheet.mockRejectedValue(new Error('network blip'));
    const { onSheetChanged, onStateRefresh } = renderPanel();
    await flush();

    fireEvent.click(screen.getByRole('button', { name: /^Cast /i }));
    await flush();

    expect(
      await screen.findByText("Couldn't refresh after casting — reload to see the result."),
    ).toBeInTheDocument();
    expect(onSheetChanged).not.toHaveBeenCalled();
    expect(onStateRefresh).not.toHaveBeenCalled();
  });
});
