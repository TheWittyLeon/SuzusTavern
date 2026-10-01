/**
 * A9c-2 D6 (Miko QA) — the X-card beside the cast-spell tenant.
 *
 * `castSpellPanel` and `safetyControls` are BOTH tenants of `actionBar` since
 * D6. `play.xcard-independence.test.tsx` renders a non-caster only (its
 * `getCharacterSheet` resolves null), so the cast group never mounts and the
 * `closest('[role="group"]')` pin there proves nothing about the shared host.
 * These render a bound CASTER mid-combat: the X-card must sit outside the
 * cast group, stay un-gated, and still post while a cast is in flight.
 */
import React from 'react';
import { screen, waitFor, act, fireEvent, within } from '@testing-library/react';
import { renderPlay } from '@/test-utils/renderPlay';
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
  getCatalog: jest.fn(() => Promise.resolve({ system: 'dnd5e', content_type: 'class', items: [], total: 0, limit: 100, offset: 0 })),
  getSession: jest.fn(),
  getSessionEvents: jest.fn(() => Promise.resolve([])),
  getSessionEventsRaw: jest.fn(() => Promise.resolve(null)),
  getParticipants: jest.fn(),
  getGrounding: jest.fn(() => Promise.resolve(null)),
  getCombatState: jest.fn(),
  getCharacterSheet: jest.fn(),
  postSessionEvent: jest.fn(() => Promise.resolve({})),
  postXCard: jest.fn(),
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
const mPostXCard = dnd.postXCard as jest.MockedFunction<typeof dnd.postXCard>;
const mCastSpell = dnd.castSpell as jest.MockedFunction<typeof dnd.castSpell>;
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


const SPELLS = {
  is_spellcaster: true,
  caster_kind: 'prepared' as const,
  ability: 'wisdom',
  budget: { cantrips_known: 1, cantrips_max: 3, spells_known: null, spells_max: null, prepared_used: 0, prepared_max: 4 },
  cantrips: [
    {
      slug: 'sacred-flame', name: 'Sacred Flame', level: 0, school: 'evocation', source: 'class',
      prepared: true, is_cantrip: true, concentration: false, ritual: false, castable_now: true, heals: false,
    },
  ],
  spells: [],
};

function combatWithTurn(selfActive: boolean): CombatState {
  return {
    ...ACTIVE_COMBAT,
    turn_index: selfActive ? 1 : 0,
    active_participant_id: selfActive ? 'p-self' : 'p-enemy',
    participants: [
      { ...ENEMY_PARTICIPANT, is_active_turn: !selfActive },
      { ...SELF_PARTICIPANT, is_active_turn: selfActive },
    ],
  };
}

function seed(selfActive: boolean) {
  mGetSession.mockResolvedValue(sessionFixture({ active_combat_id: 'combat-1' }));
  mGetParticipants.mockResolvedValue(PARTY_WITH_CASTER);
  mGetCharacterSheet.mockResolvedValue(casterSheet());
  mGetCombatState.mockResolvedValue(combatWithTurn(selfActive));
  (dnd.getKnownSpells as jest.Mock).mockResolvedValue(SPELLS);
  mPostXCard.mockResolvedValue({ event: { seq: 5, kind: 'x_card', actor: 'leon' } } as never);
}

const xCard = () => screen.findByRole('button', { name: /^X-card$/i });

describe('A9c-2 D6 - X-card is independent of the cast tenant that now shares its host', () => {
  it('caster, NOT my turn: the cast group is mounted (control); X-card is outside it and reachable', async () => {
    seed(false);
    renderPlay(<PlayPage />);
    const castGroup = (await screen.findByText('Cast a spell')).closest('[role="group"]') as HTMLElement;
    expect(castGroup).not.toBeNull(); // control: the shared-host neighbour really mounted
    const btn = await xCard();
    expect(btn).toBeEnabled();
    expect(btn).not.toHaveAttribute('aria-disabled');
    expect(btn.closest('[role="group"]')).toBeNull();
    expect(within(castGroup).queryByRole('button', { name: /^X-card$/i })).toBeNull();
  });

  it('caster, my turn, Cast IN FLIGHT: Attack is latched shut (control), X-card is reachable and posts', async () => {
    seed(true);
    mCastSpell.mockImplementation(() => new Promise(() => {})); // never settles: shared combat latch stays held
    renderPlay(<PlayPage />);
    fireEvent.click(await screen.findByRole('button', { name: /Cast a spell/ })); // unfold
    const cast = await screen.findByRole('button', { name: /^Cast Sacred Flame$/ });
    await waitFor(() => expect(cast).toBeEnabled());
    await act(async () => {
      fireEvent.click(cast);
    });
    expect(mCastSpell).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByRole('button', { name: /^Attack/ })).toBeDisabled());

    const btn = await xCard();
    expect(btn).toBeEnabled();
    expect(btn).not.toHaveAttribute('aria-disabled');
    expect(btn.closest('[role="group"]')).toBeNull();
    await act(async () => {
      fireEvent.click(btn);
    });
    expect(mPostXCard).toHaveBeenCalledTimes(1);
  });

  it('caster, session PAUSED: Cast is locked (control) while the X-card stays reachable', async () => {
    seed(true);
    mGetSession.mockResolvedValue(sessionFixture({ active_combat_id: 'combat-1', status: 'paused' } as never));
    renderPlay(<PlayPage />);
    const btn = await xCard();
    expect(btn).toBeEnabled();
    expect(btn.closest('[role="group"]')).toBeNull();
    fireEvent.click(await screen.findByRole('button', { name: /Cast a spell/ }));
    expect(await screen.findByRole('button', { name: /^Cast Sacred Flame/ })).toBeDisabled();
  });
});
