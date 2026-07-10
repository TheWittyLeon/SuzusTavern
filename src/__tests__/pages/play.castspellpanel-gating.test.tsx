/**
 * T6 (DDX-12) — CastSpellPanel mount-gate coverage.
 *
 * CastSpellPanel itself has NO internal `is_spellcaster`/DM guard (unlike
 * SpellSlotsPanel's own defense-in-depth `if (!isCaster) return null`) — the
 * ENTIRE gate lives in the parent page's JSX conditional
 * (`src/app/play/[sessionId]/page.tsx` ~2564-2591):
 *   !isHumanDM && combatIsActive && combatState && combatId &&
 *   myCharacterIdStr && mySheet?.is_spellcaster
 * That means "DM doesn't see it" / "non-caster doesn't see it" / "caster
 * off-combat doesn't see it" are NOT unit-testable against CastSpellPanel in
 * isolation (it would always render, proving nothing) — they can only be
 * proven by mounting the real page. This file is that proof, one axis at a
 * time, isolating each condition rather than conflating them (in particular:
 * a DM WITH a bound caster-shaped sheet still must not see the panel, so the
 * isHumanDM gate is proven independently of the myCharacterIdStr gate).
 */
import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { Session, Participant, CombatState, CombatParticipantState, CharacterSheet } from '@/lib/api/types';

jest.mock('next/navigation', () => ({
  useParams: () => ({ sessionId: 'sess-t6' }),
}));

jest.mock('../../components/Toast', () => ({
  useToast: () => ({ toast: jest.fn() }),
}));

const mockUseAuth = jest.fn(() => ({ user: { id: 1, username: 'leon', email: null } }));
jest.mock('../../lib/auth/AuthProvider', () => ({
  useAuth: () => mockUseAuth(),
}));

jest.mock('../../lib/useReducedMotion', () => ({
  useReducedMotion: () => true,
}));

jest.mock('../../lib/api/dnd', () => ({
  getSession: jest.fn(),
  getSessionEvents: jest.fn(() => Promise.resolve([])),
  getSessionEventsRaw: jest.fn(() => Promise.resolve(null)),
  getParticipants: jest.fn(),
  getGrounding: jest.fn(() => Promise.resolve(null)),
  getCombatState: jest.fn(),
  getCharacterSheet: jest.fn(),
  postSessionEvent: jest.fn(() => Promise.resolve({})),
  combatFromScene: jest.fn(),
  startCombat: jest.fn(),
  spawnMonster: jest.fn(),
  rollInitiative: jest.fn(),
  monsterTurn: jest.fn(),
  attack: jest.fn(),
  dodge: jest.fn(),
  dash: jest.fn(),
  endTurn: jest.fn(),
  endCombat: jest.fn(),
  advanceScene: jest.fn(),
  setFlag: jest.fn(),
  pauseSession: jest.fn(),
  resumeSession: jest.fn(),
  endSession: jest.fn(),
  awardSessionXp: jest.fn(),
  resolveCheck: jest.fn(),
  postRoll: jest.fn(),
  // T6 — CastSpellPanel's own direct imports (same mocked module).
  getKnownSpells: jest.fn(() =>
    Promise.resolve({
      is_spellcaster: true,
      caster_kind: 'prepared',
      ability: 'wisdom',
      budget: {
        cantrips_known: 0,
        cantrips_max: 0,
        spells_known: null,
        spells_max: null,
        prepared_used: 0,
        prepared_max: 0,
      },
      cantrips: [],
      spells: [],
    }),
  ),
  castSpell: jest.fn(),
}));

jest.mock('../../lib/stream', () => ({
  streamDmNarration: jest.fn(async function* () {
    yield { kind: 'done' as const };
  }),
}));

import * as dnd from '@/lib/api/dnd';
import PlayPage from '@/app/play/[sessionId]/page';

const mGetSession = dnd.getSession as jest.MockedFunction<typeof dnd.getSession>;
const mGetParticipants = dnd.getParticipants as jest.MockedFunction<typeof dnd.getParticipants>;
const mGetCharacterSheet = dnd.getCharacterSheet as jest.MockedFunction<typeof dnd.getCharacterSheet>;
const mGetCombatState = dnd.getCombatState as jest.MockedFunction<typeof dnd.getCombatState>;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SELF_PARTICIPANT: CombatParticipantState = {
  participant_id: 'p-self',
  entity_id: 'c1',
  name: 'Velka',
  is_pc: true,
  initiative: 12,
  hp_current: 18,
  hp_max: 20,
  ac: 14,
  conditions: [],
  is_alive: true,
  can_be_targeted: true,
  is_active_turn: false,
  took_turn: false,
};

const ENEMY_PARTICIPANT: CombatParticipantState = {
  participant_id: 'p-enemy',
  entity_id: 'goblin-1',
  name: 'Goblin',
  is_pc: false,
  initiative: 15,
  hp_current: 7,
  hp_max: 7,
  ac: 13,
  conditions: [],
  is_alive: true,
  can_be_targeted: true,
  is_active_turn: true,
  took_turn: false,
};

const ACTIVE_COMBAT: CombatState = {
  combat_id: 'combat-1',
  session_id: 'sess-t6',
  round: 1,
  state: 'active',
  turn_index: 0,
  active_participant_id: 'p-enemy',
  initiative: ['p-enemy', 'p-self'],
  participants: [ENEMY_PARTICIPANT, SELF_PARTICIPANT],
};

const PARTY_WITH_CASTER: Participant[] = [
  {
    username: 'leon',
    is_dm: false,
    character: {
      character_id: 'c1',
      name: 'Velka',
      char_class: 'Cleric',
      level: 3,
      current_hp: 18,
      max_hp: 20,
      ac: 14,
    },
  },
];

function casterSheet(overrides?: Partial<CharacterSheet>): CharacterSheet {
  return {
    character_id: 'c1',
    owner_username: 'leon',
    name: 'Velka',
    race: 'Human',
    subrace: '',
    char_class: 'Cleric',
    subclass: '',
    level: 3,
    background: 'Acolyte',
    alignment: '',
    ability_scores: {},
    hp: { current: 18, max: 20, temp: 0 },
    ac: 14,
    initiative: 1,
    proficiency_bonus: 2,
    speed: 30,
    xp: 900,
    xp_next: 2700,
    hit_dice_remaining: 3,
    proficient_saves: [],
    proficient_skills: [],
    class_features: [],
    conditions: [],
    spellcasting: { ability: 'wisdom', save_dc: 13, attack_bonus: 5 },
    spell_slots: { '1': { max: 4, used: 1, remaining: 3 } },
    is_spellcaster: true,
    inventory: [],
    inventory_weight: 0,
    ...overrides,
  } as CharacterSheet;
}

function sessionFixture(overrides?: Partial<Session>): Session {
  return {
    session_id: 'sess-t6',
    channel: 'test_table',
    dm_username: 'suzu',
    active_combat_id: null,
    ai_assist_level: 'off',
    ...overrides,
  } as Session;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUseAuth.mockReturnValue({ user: { id: 1, username: 'leon', email: null } });
  (dnd.getSessionEvents as jest.MockedFunction<typeof dnd.getSessionEvents>).mockResolvedValue([]);
  (dnd.getKnownSpells as jest.MockedFunction<typeof dnd.getKnownSpells>).mockResolvedValue({
    is_spellcaster: true,
    caster_kind: 'prepared',
    ability: 'wisdom',
    budget: {
      cantrips_known: 0,
      cantrips_max: 0,
      spells_known: null,
      spells_max: null,
      prepared_used: 0,
      prepared_max: 0,
    },
    cantrips: [],
    spells: [],
  });
});

describe('T6 — CastSpellPanel mount gate (page-level, per-axis)', () => {
  it('renders for a bound caster PC during active combat (positive control)', async () => {
    mGetSession.mockResolvedValue(sessionFixture({ active_combat_id: 'combat-1' }));
    mGetParticipants.mockResolvedValue(PARTY_WITH_CASTER);
    mGetCharacterSheet.mockResolvedValue(casterSheet());
    mGetCombatState.mockResolvedValue(ACTIVE_COMBAT);

    render(<PlayPage />);
    await waitFor(() => expect(screen.getByText('Cast a spell')).toBeInTheDocument());
  });

  it('hides the panel for a bound NON-caster PC during active combat', async () => {
    mGetSession.mockResolvedValue(sessionFixture({ active_combat_id: 'combat-1' }));
    mGetParticipants.mockResolvedValue(PARTY_WITH_CASTER);
    mGetCharacterSheet.mockResolvedValue(casterSheet({ is_spellcaster: false, spell_slots: {} }));
    mGetCombatState.mockResolvedValue(ACTIVE_COMBAT);

    render(<PlayPage />);
    // Wait for the sheet fetch to actually land before asserting the negative,
    // so this isn't just "hasn't rendered yet" racing the assertion.
    await waitFor(() => expect(mGetCharacterSheet).toHaveBeenCalled());
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByText('Cast a spell')).not.toBeInTheDocument();
  });

  it('hides the panel for a bound caster PC with NO active combat', async () => {
    mGetSession.mockResolvedValue(sessionFixture({ active_combat_id: null }));
    mGetParticipants.mockResolvedValue(PARTY_WITH_CASTER);
    mGetCharacterSheet.mockResolvedValue(casterSheet());

    render(<PlayPage />);
    await waitFor(() => expect(mGetCharacterSheet).toHaveBeenCalled());
    await act(async () => {
      await Promise.resolve();
    });
    expect(mGetCombatState).not.toHaveBeenCalled();
    expect(screen.queryByText('Cast a spell')).not.toBeInTheDocument();
  });

  it('hides the panel for a human DM even when the DM ALSO has a caster-shaped bound sheet (isolates the isHumanDM gate from the myCharacterIdStr gate)', async () => {
    // dm_username === logged-in username AND dm_mode 'human' => isHumanDM true,
    // regardless of what the sheet/combat state look like.
    mGetSession.mockResolvedValue(
      sessionFixture({ dm_username: 'leon', dm_mode: 'human', active_combat_id: 'combat-1' }),
    );
    mGetParticipants.mockResolvedValue(PARTY_WITH_CASTER);
    mGetCharacterSheet.mockResolvedValue(casterSheet());
    mGetCombatState.mockResolvedValue(ACTIVE_COMBAT);

    render(<PlayPage />);
    await waitFor(() => expect(mGetCharacterSheet).toHaveBeenCalled());
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByText('Cast a spell')).not.toBeInTheDocument();
  });

  it('hides the panel for a DM-only participant (no character bound) during active combat', async () => {
    mGetSession.mockResolvedValue(
      sessionFixture({ dm_username: 'leon', dm_mode: 'human', active_combat_id: 'combat-1' }),
    );
    mGetParticipants.mockResolvedValue([{ username: 'leon', is_dm: true, character: null }]);
    mGetCombatState.mockResolvedValue(ACTIVE_COMBAT);

    render(<PlayPage />);
    await waitFor(() => expect(mGetCombatState).toHaveBeenCalled());
    await act(async () => {
      await Promise.resolve();
    });
    expect(mGetCharacterSheet).not.toHaveBeenCalled();
    expect(screen.queryByText('Cast a spell')).not.toBeInTheDocument();
  });
});
