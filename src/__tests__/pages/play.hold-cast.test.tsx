/**
 * TPK-HOLD: the page hands Cast the hold. A held fight on the REAL page (the tenant and the panel are not mounted alone here): Cast's accessible name says the fight is on hold, and the
 * lock notice reads the held words. Kills the mutant that drops `held={fightHeld}` at the page or `held={held}` at the tenant (the panel's own test passes either way).
 */
import React from 'react';
import { screen, waitFor, act } from '@testing-library/react';
import { renderPlay } from '@/test-utils/renderPlay';
import '@testing-library/jest-dom';
import type { Session, Participant, CombatState, CombatParticipantState, CharacterSheet } from '@/lib/api/types';

jest.mock('next/navigation', () => ({
  useParams: () => ({ sessionId: 'sess-hold' }),
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
  getCatalog: jest.fn(() => Promise.resolve({ system: 'dnd5e', content_type: 'class', items: [], total: 0, limit: 100, offset: 0 })),
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
  // DDX-22 Phase 3: JournalPane is now unconditionally mounted on the play
  // page (only its CSS visibility/inert state is gated by journalVisible —
  // see page.tsx's <aside id="play-pane-journal">), so every render of this
  // page fires a getSessionNotes() GET regardless of whether the journal is
  // ever opened. Default to "no note yet" so this suite stays hermetic.
  getSessionNotes: jest.fn(() => Promise.resolve(null)),
  putSessionNotes: jest.fn(() => Promise.resolve({ body: '', updated_at: '2026-01-01T00:00:00Z' })),
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
  session_id: 'sess-hold',
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
    session_id: 'sess-hold',
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


const SPELL = { slug: 'guidance', name: 'Guidance', level: 0, school: 'divination', source: 'class', prepared: true, is_cantrip: true, concentration: false, ritual: false, castable_now: true, heals: false };
const heldFight = (): CombatState => ({
  ...ACTIVE_COMBAT, state: 'held', active_participant_id: null,
  participants: [{ ...ENEMY_PARTICIPANT, is_active_turn: false }, { ...SELF_PARTICIPANT, hp_current: 0, is_alive: false, can_be_targeted: false }],
});

beforeEach(() => {
  jest.clearAllMocks();
  mockUseAuth.mockReturnValue({ user: { id: 1, username: 'leon', email: null } });
  (dnd.getSessionEvents as jest.MockedFunction<typeof dnd.getSessionEvents>).mockResolvedValue([]);
  (dnd.getKnownSpells as jest.MockedFunction<typeof dnd.getKnownSpells>).mockResolvedValue({
    is_spellcaster: true, caster_kind: 'prepared', ability: 'wisdom',
    budget: { cantrips_known: 1, cantrips_max: 1, spells_known: null, spells_max: null, prepared_used: 0, prepared_max: 0 },
    cantrips: [SPELL], spells: [],
  } as never);
});

it('a caster at a held fight: Cast reads "(fight on hold)", never "(not your turn)", with the held notice', async () => {
  mGetSession.mockResolvedValue(sessionFixture({ active_combat_id: 'combat-1' }));
  mGetParticipants.mockResolvedValue(PARTY_WITH_CASTER);
  mGetCharacterSheet.mockResolvedValue(casterSheet());
  mGetCombatState.mockResolvedValue(heldFight());
  renderPlay(<PlayPage />);
  await waitFor(() => expect(screen.getByText('Cast a spell')).toBeInTheDocument());
  const cast = await screen.findByRole('button', { name: /^Cast Guidance \(/ }, { timeout: 3000 });
  expect(cast).toHaveAttribute('aria-label', 'Cast Guidance (fight on hold)');
  expect(cast).not.toHaveAttribute('aria-label', expect.stringMatching(/not your turn/));
  await act(async () => { await Promise.resolve(); });
  expect(screen.getAllByText('The fight is on hold.').length).toBeGreaterThan(0);
});

it('control: the same caster in a running fight on a monster\'s turn reads "(not your turn)"', async () => {
  mGetSession.mockResolvedValue(sessionFixture({ active_combat_id: 'combat-1' }));
  mGetParticipants.mockResolvedValue(PARTY_WITH_CASTER);
  mGetCharacterSheet.mockResolvedValue(casterSheet());
  mGetCombatState.mockResolvedValue(ACTIVE_COMBAT);
  renderPlay(<PlayPage />);
  const cast = await screen.findByRole('button', { name: /^Cast Guidance \(/ }, { timeout: 3000 });
  expect(cast).toHaveAttribute('aria-label', 'Cast Guidance (not your turn)');
});
