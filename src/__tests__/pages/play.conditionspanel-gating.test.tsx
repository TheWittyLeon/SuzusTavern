/**
 * T7 (DDX-17e) — ConditionsPanel mount-gate coverage.
 *
 * ConditionsPanel has no internal DM guard of its own (same design as
 * CastSpellPanel/DmNarrationPanel) — the gate lives entirely in the parent
 * page's JSX conditional (`src/app/play/[sessionId]/page.tsx`):
 *   isHumanDM && combatIsActive && combatState && combatId
 * So "a human DM sees apply/remove controls" / "a non-DM player does not" can
 * only be proven by mounting the real page. Mirrors
 * play.castspellpanel-gating.test.tsx's harness (its inverse condition).
 */
import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { Session, Participant, CombatState, CombatParticipantState, CharacterSheet } from '@/lib/api/types';

jest.mock('next/navigation', () => ({
  useParams: () => ({ sessionId: 'sess-t7' }),
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
  getKnownSpells: jest.fn(() =>
    Promise.resolve({
      is_spellcaster: false,
      caster_kind: null,
      ability: null,
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
  // T7 — ConditionsPanel's own direct imports (same mocked module).
  applyCondition: jest.fn(),
  removeCondition: jest.fn(),
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
const mGetCombatState = dnd.getCombatState as jest.MockedFunction<typeof dnd.getCombatState>;
const mGetCharacterSheet = dnd.getCharacterSheet as jest.MockedFunction<typeof dnd.getCharacterSheet>;

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
  conditions: ['poisoned'],
  condition_durations: { poisoned: 2 },
  is_alive: true,
  can_be_targeted: true,
  is_active_turn: true,
  took_turn: false,
};

const ACTIVE_COMBAT: CombatState = {
  combat_id: 'combat-1',
  session_id: 'sess-t7',
  round: 1,
  state: 'active',
  turn_index: 0,
  active_participant_id: 'p-enemy',
  initiative: ['p-enemy', 'p-self'],
  participants: [ENEMY_PARTICIPANT, SELF_PARTICIPANT],
};

const PARTY_WITH_PC: Participant[] = [
  {
    username: 'leon',
    is_dm: false,
    character: {
      character_id: 'c1',
      name: 'Velka',
      char_class: 'Fighter',
      level: 3,
      current_hp: 18,
      max_hp: 20,
      ac: 14,
    },
  },
];

function nonCasterSheet(): CharacterSheet {
  return {
    character_id: 'c1',
    owner_username: 'leon',
    name: 'Velka',
    race: 'Human',
    subrace: '',
    char_class: 'Fighter',
    subclass: '',
    level: 3,
    background: 'Soldier',
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
    spellcasting: null,
    spell_slots: {},
    is_spellcaster: false,
    inventory: [],
    inventory_weight: 0,
  } as CharacterSheet;
}

function sessionFixture(overrides?: Partial<Session>): Session {
  return {
    session_id: 'sess-t7',
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
});

describe('T7 — ConditionsPanel mount gate (page-level)', () => {
  it('renders apply/remove controls for a human DM during active combat (positive control)', async () => {
    mGetSession.mockResolvedValue(
      sessionFixture({ dm_username: 'leon', dm_mode: 'human', active_combat_id: 'combat-1' }),
    );
    mGetParticipants.mockResolvedValue([{ username: 'leon', is_dm: true, character: null }]);
    mGetCombatState.mockResolvedValue(ACTIVE_COMBAT);

    render(<PlayPage />);
    await waitFor(() => expect(screen.getByText('Conditions')).toBeInTheDocument());
    // Apply form + at least one DM-only remove control on the already-poisoned Goblin.
    expect(screen.getByLabelText('Condition')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /remove poisoned from goblin/i })).toBeInTheDocument();
  });

  it('hides the panel entirely for a non-DM player during the same active combat', async () => {
    mGetSession.mockResolvedValue(sessionFixture({ active_combat_id: 'combat-1' }));
    mGetParticipants.mockResolvedValue(PARTY_WITH_PC);
    mGetCharacterSheet.mockResolvedValue(nonCasterSheet());
    mGetCombatState.mockResolvedValue(ACTIVE_COMBAT);

    render(<PlayPage />);
    await waitFor(() => expect(mGetCombatState).toHaveBeenCalled());
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByText('Conditions')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /remove poisoned from goblin/i }),
    ).not.toBeInTheDocument();
    // The all-clients chip is still visible via InitiativeTracker even though
    // the mutate panel is hidden — proves chips are NOT gated behind isHumanDM.
    expect(screen.getByText('Poisoned · 2')).toBeInTheDocument();
  });
});
