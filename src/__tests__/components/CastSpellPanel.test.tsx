/**
 * CastSpellPanel — T6 (DDX-12 cast-in-combat UI).
 *
 * Castable-only picker, DDX-04 upcast slot-level range, target picker
 * (excludes self, except TAV-CAST-SELF-HEAL-UI's healing-spell exception),
 * cast wiring (spell_name/slot_level/target shape), busy-latch, success
 * toast, and refetch-after-mutate (sheet + combat state) — mirrors
 * SpellbookPanel/SpellSlotsPanel's test conventions.
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
import { makeApiError } from '../../lib/api/client';
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
      heals: false,
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
      heals: true,
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
      heals: false,
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

  it('A11Y-PANEL-SEMANTICS: exposes a group landmark labelled by its own visible kicker (not a duplicated aria-label string)', async () => {
    renderPanel();
    await flush();
    const group = screen.getByRole('group', { name: 'Cast a spell' });
    const label = screen.getByText('Cast a spell');
    expect(group.getAttribute('aria-labelledby')).toBe(label.id);
    expect(label.id).toBeTruthy();
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

  it('F2/CAST-DEAD-TARGET: NEVER offers a downed/dead (is_alive: false, can_be_targeted: false) ENEMY, heal or no heal', async () => {
    // Supersedes the old "still offers a downed participant" test — that
    // stance predates F2 (WF-TAV-AUDIT-BATCH-2026-07-22 Pass P). A downed
    // enemy is, by construction, always genuinely dead (a monster killed at
    // 0 HP goes is_alive:false immediately — see engine/combat.py's
    // apply_damage, it never lingers at 0 HP with is_alive still true), so
    // it's excluded from every spell, non-heal AND heal alike.
    const DOWNED_ENEMY = participant({
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
          participants={[SELF, ALLY, ENEMY, DOWNED_ENEMY]}
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
    let names = Array.from(targetSelect.querySelectorAll('option')).map((o) => o.textContent);
    expect(names.some((t) => t?.includes('Fallen Goblin'))).toBe(false);

    // Still excluded even with a healing spell selected (never a downed enemy).
    selectSpell('Cure Wounds');
    names = Array.from(
      screen.getByLabelText('Target').querySelectorAll('option'),
    ).map((o) => o.textContent);
    expect(names.some((t) => t?.includes('Fallen Goblin'))).toBe(false);
  });

  it('F2/CAST-DEAD-TARGET: a downed (0 HP, is_alive: true, can_be_targeted: false) ALLY is offered ONLY when the selected spell heals', async () => {
    const DOWNED_ALLY = participant({
      participant_id: 'p-downed-ally',
      entity_id: 'cid-3',
      name: 'Fallen Twilight',
      is_pc: true,
      is_alive: true,
      can_be_targeted: false,
      hp_current: 0,
      death_saves: { successes: 0, failures: 0, is_downed: true, is_dying: true, is_stable: false, is_dead: false },
    });
    render(
      <ToastProvider>
        <CastSpellPanel
          combatId="combat-1"
          characterId="cid-1"
          username="leon"
          participants={[SELF, ALLY, ENEMY, DOWNED_ALLY]}
          spellSlots={SLOTS}
          isPlayerTurn
          onCast={jest.fn()}
          onSheetChanged={jest.fn()}
          onStateRefresh={jest.fn()}
        />
      </ToastProvider>,
    );
    await flush();

    // Sacred Flame (heals: false) — the downed ally is NOT offered.
    let names = Array.from(
      screen.getByLabelText('Target').querySelectorAll('option'),
    ).map((o) => o.textContent);
    expect(names.some((t) => t?.includes('Fallen Twilight'))).toBe(false);

    // Cure Wounds (heals: true) — the downed ally IS offered.
    selectSpell('Cure Wounds');
    names = Array.from(
      screen.getByLabelText('Target').querySelectorAll('option'),
    ).map((o) => o.textContent);
    expect(names.some((t) => t?.includes('Fallen Twilight'))).toBe(true);
  });

  it('F2/CAST-DEAD-TARGET: a genuinely-dead PC (is_alive: false) is excluded from EVERY spell, healing included', async () => {
    const DEAD_PC = participant({
      participant_id: 'p-dead-pc',
      entity_id: 'cid-4',
      name: 'Late Twilight',
      is_pc: true,
      is_alive: false,
      can_be_targeted: false,
      hp_current: 0,
      death_saves: { successes: 0, failures: 3, is_downed: false, is_dying: false, is_stable: false, is_dead: true },
    });
    render(
      <ToastProvider>
        <CastSpellPanel
          combatId="combat-1"
          characterId="cid-1"
          username="leon"
          participants={[SELF, ALLY, ENEMY, DEAD_PC]}
          spellSlots={SLOTS}
          isPlayerTurn
          onCast={jest.fn()}
          onSheetChanged={jest.fn()}
          onStateRefresh={jest.fn()}
        />
      </ToastProvider>,
    );
    await flush();

    selectSpell('Cure Wounds'); // heals: true — still must not resurrect a corpse.
    const names = Array.from(
      screen.getByLabelText('Target').querySelectorAll('option'),
    ).map((o) => o.textContent);
    expect(names.some((t) => t?.includes('Late Twilight'))).toBe(false);
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

describe('CastSpellPanel — TAV-CAST-SELF-HEAL-UI (self as a heal target)', () => {
  it('offers the caster as a target, labeled as self, when a healing spell is selected', async () => {
    renderPanel();
    await flush();
    selectSpell('Cure Wounds'); // heals: true

    const targetSelect = await screen.findByLabelText('Target');
    const names = Array.from(targetSelect.querySelectorAll('option')).map((o) => o.textContent);
    expect(names.some((t) => t?.includes('Me') && t?.includes('yourself'))).toBe(true);
  });

  it('does NOT offer the caster as a target when a non-healing spell is selected', async () => {
    renderPanel();
    await flush();
    selectSpell('Sacred Flame'); // heals: false

    const targetSelect = await screen.findByLabelText('Target');
    const names = Array.from(targetSelect.querySelectorAll('option')).map((o) => o.textContent);
    expect(names.some((t) => t?.includes('Me'))).toBe(false);
  });

  it('selecting self and casting a heal sends target_id = the caster\'s own participant_id', async () => {
    mockCastSpell.mockResolvedValue({ message: 'You heal yourself for 8 HP.' });
    mockGetSheet.mockResolvedValue(SHEET);
    renderPanel();
    await flush();

    selectSpell('Cure Wounds');
    fireEvent.change(await screen.findByLabelText('Target'), { target: { value: 'p-self' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cast Cure Wounds' }));
    await flush();

    expect(mockCastSpell).toHaveBeenCalledWith({
      username: 'leon',
      combat_id: 'combat-1',
      spell_name: 'cure-wounds',
      slot_level: 1,
      target_id: 'p-self',
      target: 'Me',
    });
  });

  it('clears a stale self-target when switching from a heal (self chosen) to a non-healing spell', async () => {
    renderPanel();
    await flush();

    selectSpell('Cure Wounds');
    fireEvent.change(await screen.findByLabelText('Target'), { target: { value: 'p-self' } });
    expect((screen.getByLabelText('Target') as HTMLSelectElement).value).toBe('p-self');

    selectSpell('Sacred Flame');

    const targetSelect = screen.getByLabelText('Target') as HTMLSelectElement;
    expect(targetSelect.value).toBe('');
    const names = Array.from(targetSelect.querySelectorAll('option')).map((o) => o.textContent);
    expect(names.some((t) => t?.includes('Me'))).toBe(false);
  });

  // -- Adversarial (Miko-QA, TAV-CAST-SELF-HEAL-UI verification pass) -------

  it('ADVERSARIAL: switching from one healing spell to ANOTHER healing spell keeps the self-target selected (not wiped)', async () => {
    const HEALING_WORD: SheetSpellEntry = {
      slug: 'healing-word',
      name: 'Healing Word',
      level: 1,
      school: 'evocation',
      source: 'class',
      prepared: true,
      is_cantrip: false,
      concentration: false,
      ritual: false,
      castable_now: true,
      min_slot_level: 1,
      heals: true,
    };
    mockGetKnown.mockResolvedValue({
      ...SPELL_LIST,
      spells: [...SPELL_LIST.spells, HEALING_WORD],
    });
    renderPanel();
    await flush();

    selectSpell('Cure Wounds');
    fireEvent.change(await screen.findByLabelText('Target'), { target: { value: 'p-self' } });
    expect((screen.getByLabelText('Target') as HTMLSelectElement).value).toBe('p-self');

    fireEvent.change(screen.getByLabelText('Spell'), { target: { value: 'healing-word' } });

    const targetSelect = screen.getByLabelText('Target') as HTMLSelectElement;
    // The reset effect keys off array-identity change of `targets`, not just
    // whether the OLD selection is still valid for the OLD spell — this
    // proves it doesn't over-fire and wipe a target that is still legal
    // under the NEWLY selected (also-healing) spell.
    expect(targetSelect.value).toBe('p-self');
    const names = Array.from(targetSelect.querySelectorAll('option')).map((o) => o.textContent);
    expect(names.some((t) => t?.includes('Me') && t?.includes('yourself'))).toBe(true);
  });

  it('ADVERSARIAL: a spell list refresh after a cast that drops the previously-selected healing spell clears the stale self-target AND resets selectedSlug without either reset fighting the other', async () => {
    // Simulates: pick Cure Wounds, target self, cast it (spends the last
    // level-1 slot server-side) -> the post-cast silent loadCastable refetch
    // comes back WITHOUT cure-wounds (no longer castable_now) -- the
    // selectedSlug-reset effect (pre-existing, DDX-04 lineage) and the
    // targets/self-target-reset effect (this ticket) both fire off the SAME
    // `spells` array change in the SAME render pass.
    mockCastSpell.mockResolvedValue({ message: 'You heal yourself for 8 HP.' });
    mockGetSheet.mockResolvedValue(SHEET);
    mockGetKnown
      .mockResolvedValueOnce(SPELL_LIST) // initial mount
      .mockResolvedValueOnce({
        ...SPELL_LIST,
        spells: [], // cure-wounds no longer castable_now (slot spent)
      });
    renderPanel();
    await flush();

    selectSpell('Cure Wounds');
    fireEvent.change(await screen.findByLabelText('Target'), { target: { value: 'p-self' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cast Cure Wounds' }));
    await flush();

    // Only Sacred Flame (a cantrip) survives the refreshed list -> selectedSlug
    // must land there, and the target picker must not retain a self option or
    // a stale participant_id from the spell that just disappeared.
    const spellSelect = screen.getByLabelText('Spell') as HTMLSelectElement;
    expect(spellSelect.value).toBe('sacred-flame');
    const targetSelect = screen.getByLabelText('Target') as HTMLSelectElement;
    expect(targetSelect.value).toBe('');
    const names = Array.from(targetSelect.querySelectorAll('option')).map((o) => o.textContent);
    expect(names.some((t) => t?.includes('Me'))).toBe(false);
  });

  it('ADVERSARIAL: heals=undefined (engine field not yet live / safe-rollout default) never offers self, never crashes', async () => {
    const NO_HEALS_FIELD: SheetSpellEntry = {
      slug: 'mystery-spell',
      name: 'Mystery Spell',
      level: 1,
      school: 'evocation',
      source: 'class',
      prepared: true,
      is_cantrip: false,
      concentration: false,
      ritual: false,
      castable_now: true,
      min_slot_level: 1,
      // `heals` intentionally omitted -- exercises `selectedSpell?.heals`
      // resolving to `undefined` -> `Boolean(undefined)` -> false.
    };
    mockGetKnown.mockResolvedValue({ ...SPELL_LIST, spells: [NO_HEALS_FIELD] });
    renderPanel();
    await flush();

    fireEvent.change(await screen.findByLabelText('Spell'), { target: { value: 'mystery-spell' } });

    const targetSelect = await screen.findByLabelText('Target');
    const names = Array.from(targetSelect.querySelectorAll('option')).map((o) => o.textContent);
    expect(names.some((t) => t?.includes('Me'))).toBe(false);
    expect(names.some((t) => t?.includes('Twilight'))).toBe(true);
    expect(names.some((t) => t?.includes('Goblin'))).toBe(true);
  });

  it('ADVERSARIAL: a solo caster not seated as a participant (edge case) never offers self, no crash', async () => {
    render(
      <ToastProvider>
        <CastSpellPanel
          combatId="combat-1"
          characterId="cid-1"
          username="leon"
          participants={[ALLY, ENEMY]} // caster's own participant row absent
          spellSlots={SLOTS}
          isPlayerTurn
          onCast={jest.fn()}
          onSheetChanged={jest.fn()}
          onStateRefresh={jest.fn()}
        />
      </ToastProvider>,
    );
    await flush();

    selectSpell('Cure Wounds'); // heals: true
    const targetSelect = await screen.findByLabelText('Target');
    const names = Array.from(targetSelect.querySelectorAll('option')).map((o) => o.textContent);
    expect(names.some((t) => t?.includes('Twilight'))).toBe(true);
    expect(names.some((t) => t?.includes('Goblin'))).toBe(true);
    expect(names.some((t) => t?.includes('yourself'))).toBe(false);
  });

  it('ADVERSARIAL: rapid heal <-> non-heal <-> heal spell switching does not loop, throw, or leave a stale self-target', async () => {
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      renderPanel();
      await flush();

      selectSpell('Cure Wounds');
      fireEvent.change(await screen.findByLabelText('Target'), { target: { value: 'p-self' } });
      selectSpell('Sacred Flame');
      selectSpell('Cure Wounds');
      selectSpell('Sacred Flame');
      selectSpell('Cure Wounds');

      // Each switch back to Cure Wounds re-offers self as an option (heals:
      // true) but does NOT resurrect the earlier self selection -- the
      // reset effect already cleared it the first time targets excluded it,
      // and nothing re-applies a stale value.
      const targetSelect = screen.getByLabelText('Target') as HTMLSelectElement;
      expect(targetSelect.value).toBe('');
      const names = Array.from(targetSelect.querySelectorAll('option')).map((o) => o.textContent);
      expect(names.some((t) => t?.includes('Me') && t?.includes('yourself'))).toBe(true);

      // The React "Maximum update depth exceeded" error throws synchronously
      // during render/commit -- if the added `selectedSpell` dep on `targets`
      // (or the new adjust-during-render reset) looped, this test would have
      // already thrown or hung above. This assertion is a belt-and-suspenders
      // check that no such error was swallowed by an act() boundary.
      const loopErrors = errSpy.mock.calls.filter((args) =>
        String(args[0]).includes('Maximum update depth'),
      );
      expect(loopErrors).toHaveLength(0);
    } finally {
      errSpy.mockRestore();
    }
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

  it('TAV-COMBAT-NO-ACTION-REMAINING-UNMAPPED: no_action_remaining, REAL proxy shape (message ABSENT), surfaces curated action-economy copy', async () => {
    // api/routes/dnd_combat.py::_handle_dnd_error's actual output: `message`
    // is renamed to `error` and dropped from the top level; `data` is
    // forwarded whole. engine/spells.py's `_err()` never sets `data.state`
    // (unlike combat's), so this body deliberately carries no state either.
    // Building this via makeApiError (not a hand-rolled object) so the shape
    // matches src/lib/api/client.ts's own non-2xx construction exactly.
    const body = {
      success: false,
      error: '[Spell] No action remaining to cast Fire Bolt this turn.',
      data: { reason: 'no_action_remaining' },
    };
    const err = makeApiError(400, body.error, body);
    expect(err.body).not.toHaveProperty('message');
    mockCastSpell.mockRejectedValue(err);
    renderPanel();
    await flush();

    fireEvent.click(screen.getByRole('button', { name: /^Cast /i }));
    await flush();

    expect(
      await screen.findByText("You've already used your action this turn — end your turn."),
    ).toBeInTheDocument();
    // The old silent-fallthrough failure mode this ticket fixes.
    expect(screen.queryByText(/did not land/i)).not.toBeInTheDocument();
  });

  it('TAV-401-ACTOR-REQUIRED-UNMAPPED: actor_required 401, REAL proxy shape (no `state`, message ABSENT), surfaces the curated identity copy', async () => {
    // Byte-for-byte core/dnd_actor.py::require_actor_or_401's dict literal.
    const body = {
      success: false,
      error: 'Actor identity required.',
      data: { reason: 'actor_required' },
    };
    const err = makeApiError(401, body.error, body);
    mockCastSpell.mockRejectedValue(err);
    renderPanel();
    await flush();

    fireEvent.click(screen.getByRole('button', { name: /^Cast /i }));
    await flush();

    expect(
      await screen.findByText("Couldn't verify who you are. Try reloading — if it keeps happening, the sign-in service may be down."),
    ).toBeInTheDocument();
  });

  it('F1/CAST-FAIL-SILENT (D1): an UNMAPPED 4xx reason surfaces the engine\'s own body.message verbatim — supersedes the old conservative stance', async () => {
    // WF-TAV-AUDIT-BATCH-2026-07-22 Pass P, D1 (Riku-resolved): this test
    // used to assert the OPPOSITE — that an unmapped reason "never surfaces
    // a raw engine string" and falls back to the generic copy. Leon's
    // explicit instruction widened that: curated copy still wins when
    // present, but an unmapped 4xx BUSINESS reason (400/403/404/409) with a
    // real `err.body.message` now surfaces that message — it's the engine's
    // own ready-to-show text, not a leaked internal trace. 5xx/network still
    // never surface `body.message` (see the two adjacent tests below).
    //
    // Miko-QA note (TAV-REASON-CODES gate, 2026-08-06): this scenario's
    // premise — a D&D route response body carrying a `message` key — cannot
    // actually happen against the real proxy. api/routes/dnd_combat.py::
    // _handle_dnd_error renames `message` to `error` and never forwards the
    // original key (confirmed by source read; see engineReasons.ts's own
    // header comment, filed as NEKONOVA-PROXY-DROPS-MESSAGE). This test is
    // still a legitimate, non-vacuous unit test of engineErrorMessage's
    // tier-2 precedence logic in isolation — just not a reachable production
    // path for THIS component. `CAST_REFUSAL_REASON_MAP` is now complete
    // over the engine's cast vocabulary specifically because this branch is
    // dead in practice on D&D routes.
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
      message: "You're already concentrating on another spell.",
    };
    mockCastSpell.mockRejectedValue(err);
    renderPanel();
    await flush();

    fireEvent.click(screen.getByRole('button', { name: /^Cast /i }));
    await flush();

    expect(
      await screen.findByText("You're already concentrating on another spell."),
    ).toBeInTheDocument();
    expect(
      screen.queryByText('Could not cast Sacred Flame. Try again in a moment.'),
    ).not.toBeInTheDocument();
  });

  it('F1/CAST-FAIL-SILENT (D1): a 5xx NEVER surfaces body.message (would leak "Internal server error" internals) — falls back to the generic copy', async () => {
    const err = new Error('API error 500: internal') as Error & {
      status: number;
      code: string;
      body: unknown;
    };
    err.status = 500;
    err.code = '500';
    err.body = { success: false, message: 'Internal server error' };
    mockCastSpell.mockRejectedValue(err);
    renderPanel();
    await flush();

    fireEvent.click(screen.getByRole('button', { name: /^Cast /i }));
    await flush();

    expect(
      await screen.findByText('Could not cast Sacred Flame. Try again in a moment.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Internal server error')).not.toBeInTheDocument();
  });

  it('F1/CAST-FAIL-SILENT (D1): a network/status-0 failure NEVER surfaces a body message — falls back to the generic copy', async () => {
    const err = new Error('API error 0: network') as Error & {
      status: number;
      code: string;
      body?: unknown;
    };
    err.status = 0;
    err.code = 'network';
    mockCastSpell.mockRejectedValue(err);
    renderPanel();
    await flush();

    fireEvent.click(screen.getByRole('button', { name: /^Cast /i }));
    await flush();

    expect(
      await screen.findByText('Could not cast Sacred Flame. Try again in a moment.'),
    ).toBeInTheDocument();
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
