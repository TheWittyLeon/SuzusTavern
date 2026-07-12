/**
 * TAV-SOLO-DM-CAST-RAIL — the GM-PC pattern.
 *
 * A solo-table human DM who ALSO has a bound character used to be fully
 * suppressed from the player rail (CastSpellPanel + Composer's combat action
 * rail), because both were gated on `!isHumanDM` alone — a self-DM could
 * never drive their own PC. `isDmPlayingOwnPc` (isHumanDM && a bound
 * character + sheet) lifts that suppression for those two surfaces while
 * leaving the DM-only surfaces (DmNarrationPanel "Monster control",
 * ConditionsPanel "Conditions") gated on `isHumanDM` alone, so a self-DM
 * keeps BOTH sets of controls simultaneously.
 *
 * Turn-gating is unaffected: `isPlayerTurn` still keys off
 * `myCharacterIdStr === activeParticipant.entity_id`, so the player rail is
 * only enabled on the bound PC's own turn — during a monster's turn the
 * Attack button is present but disabled ("not your turn"), exactly like any
 * other player.
 */
import React from 'react';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { Session, Participant, CombatState, CombatParticipantState, CharacterSheet } from '@/lib/api/types';

jest.mock('next/navigation', () => ({
  useParams: () => ({ sessionId: 'sess-solo-dm' }),
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
  applyCondition: jest.fn(),
  removeCondition: jest.fn(),
  npcAction: jest.fn(),
  setSessionPolicy: jest.fn(),
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
const mGetCombatState = dnd.getCombatState as jest.MockedFunction<typeof dnd.getCombatState>;
const mGetCharacterSheet = dnd.getCharacterSheet as jest.MockedFunction<typeof dnd.getCharacterSheet>;
const mNpcAction = dnd.npcAction as jest.MockedFunction<typeof dnd.npcAction>;

// ---------------------------------------------------------------------------
// Fixtures — 'leon' is BOTH the session DM (human) and the bound PC's owner.
// ---------------------------------------------------------------------------

const SELF_PC: CombatParticipantState = {
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

const ENEMY: CombatParticipantState = {
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

/** Combat where it's currently the bound PC's own turn. */
const COMBAT_PC_TURN: CombatState = {
  combat_id: 'combat-1',
  session_id: 'sess-solo-dm',
  round: 1,
  state: 'active',
  turn_index: 0,
  active_participant_id: 'p-self',
  initiative: ['p-self', 'p-enemy'],
  participants: [{ ...SELF_PC, is_active_turn: true }, { ...ENEMY, is_active_turn: false }],
};

/** Combat where it's currently the monster's turn (PC waits). */
const COMBAT_MONSTER_TURN: CombatState = {
  combat_id: 'combat-1',
  session_id: 'sess-solo-dm',
  round: 1,
  state: 'active',
  turn_index: 0,
  active_participant_id: 'p-enemy',
  initiative: ['p-enemy', 'p-self'],
  participants: [ENEMY, SELF_PC],
};

const PARTY_DM_WITH_PC: Participant[] = [
  {
    username: 'leon',
    is_dm: true,
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

const PARTY_DM_ONLY: Participant[] = [
  { username: 'leon', is_dm: true, character: null },
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
    session_id: 'sess-solo-dm',
    channel: 'test_table',
    dm_username: 'leon',
    dm_mode: 'human',
    active_combat_id: 'combat-1',
    ai_assist_level: 'off',
    ...overrides,
  } as Session;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUseAuth.mockReturnValue({ user: { id: 1, username: 'leon', email: null } });
  (dnd.getSessionEvents as jest.MockedFunction<typeof dnd.getSessionEvents>).mockResolvedValue([]);
});

describe('TAV-SOLO-DM-CAST-RAIL — GM-PC coexistence', () => {
  it('shows the player rail (Attack + Cast a spell) AND the DM rail (Monster control + Conditions) together, during the bound PC\'s own turn', async () => {
    mGetSession.mockResolvedValue(sessionFixture());
    mGetParticipants.mockResolvedValue(PARTY_DM_WITH_PC);
    mGetCharacterSheet.mockResolvedValue(casterSheet());
    mGetCombatState.mockResolvedValue(COMBAT_PC_TURN);

    render(<PlayPage />);

    // Player rail: CastSpellPanel + Composer's Attack action. Composer's own
    // Attack toggle button's accessible name is the bare "Attack" (distinct
    // from DmNarrationPanel's monster-attack picker, whose aria-label is
    // "Attack — pick target"/"Monster attack (no valid targets)") — an
    // exact-string match can't false-positive on the DM rail's own Attack
    // control.
    await waitFor(() => expect(screen.getByText('Cast a spell')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Attack' })).toBeInTheDocument();

    // DM rail: monster control + conditions, gated on isHumanDM alone — must
    // STILL be present, proving the two rails coexist rather than one
    // replacing the other.
    expect(screen.getByRole('region', { name: /Monster control/i })).toBeInTheDocument();
    expect(screen.getByText('Conditions')).toBeInTheDocument();
  });

  it('disables (does not hide) the Attack action during the monster\'s turn — existing turn-gating is unaffected by the GM-PC flag', async () => {
    mGetSession.mockResolvedValue(sessionFixture());
    mGetParticipants.mockResolvedValue(PARTY_DM_WITH_PC);
    mGetCharacterSheet.mockResolvedValue(casterSheet());
    mGetCombatState.mockResolvedValue(COMBAT_MONSTER_TURN);

    render(<PlayPage />);

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Attack (not your turn)' })).toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: 'Attack (not your turn)' })).toBeDisabled();
    // DM rail is still available even off the PC's turn (DM can drive the monster).
    expect(screen.getByRole('region', { name: /Monster control/i })).toBeInTheDocument();
  });

  it('hides the player rail for a DM with NO bound character (unaffected regression check)', async () => {
    mGetSession.mockResolvedValue(sessionFixture());
    mGetParticipants.mockResolvedValue(PARTY_DM_ONLY);
    mGetCombatState.mockResolvedValue(COMBAT_MONSTER_TURN);

    render(<PlayPage />);

    await waitFor(() => expect(mGetCombatState).toHaveBeenCalled());
    await act(async () => {
      await Promise.resolve();
    });
    expect(mGetCharacterSheet).not.toHaveBeenCalled();
    expect(screen.queryByText('Cast a spell')).not.toBeInTheDocument();
    // Composer's own action rail is absent entirely (its `combat` prop is
    // null) — neither the enabled nor the "not your turn" disabled label
    // appears. DmNarrationPanel's own "Attack — pick target" monster-picker
    // button is a DIFFERENT control and is expected to still be present.
    expect(screen.queryByRole('button', { name: 'Attack' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Attack (not your turn)' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Dodge' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'End turn' })).not.toBeInTheDocument();
    // DM rail is unaffected either way.
    expect(screen.getByRole('region', { name: /Monster control/i })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Iro CRITICAL-1 — turn-flip refocus effect (~page.tsx 1992-2024) scoping.
// combatState is synced to EVERY client via the 4s poll, so the effect must
// only move focus on (a) the client whose OWN disabling click caused this
// specific turn transition, for (b) the participant that client actually
// controls. Two extra fixtures below model a second, non-DM-owned PC so the
// ownership gate can be exercised against a turn that is NOT this viewer's.
// ---------------------------------------------------------------------------

const PC_MINE: CombatParticipantState = {
  participant_id: 'p-mine',
  entity_id: 'c1',
  name: 'Velka',
  is_pc: true,
  initiative: 10,
  hp_current: 18,
  hp_max: 20,
  ac: 14,
  conditions: [],
  is_alive: true,
  can_be_targeted: true,
  is_active_turn: false,
  took_turn: false,
};

const PC_ALLY: CombatParticipantState = {
  participant_id: 'p-ally',
  entity_id: 'c2',
  name: 'Doran',
  is_pc: true,
  initiative: 14,
  hp_current: 20,
  hp_max: 22,
  ac: 16,
  conditions: [],
  is_alive: true,
  can_be_targeted: true,
  is_active_turn: false,
  took_turn: false,
};

const ENEMY_2: CombatParticipantState = {
  participant_id: 'p-enemy-2',
  entity_id: 'goblin-2',
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

/** Enemy's turn; two PCs (mine + an ally's) both waiting. */
const COMBAT_ENEMY_TURN_TWO_PC: CombatState = {
  combat_id: 'combat-2',
  session_id: 'sess-solo-dm',
  round: 1,
  state: 'active',
  turn_index: 0,
  active_participant_id: 'p-enemy-2',
  initiative: ['p-enemy-2', 'p-mine', 'p-ally'],
  participants: [PC_MINE, PC_ALLY, ENEMY_2],
};

/** Turn has flipped to the ALLY's PC — not this viewer's. */
const COMBAT_ALLY_TURN: CombatState = {
  ...COMBAT_ENEMY_TURN_TWO_PC,
  active_participant_id: 'p-ally',
  participants: [
    PC_MINE,
    { ...PC_ALLY, is_active_turn: true },
    { ...ENEMY_2, is_active_turn: false },
  ],
};

const PARTY_TWO_PLAYERS: Participant[] = [
  {
    username: 'leon',
    is_dm: false,
    character: { character_id: 'c1', name: 'Velka', char_class: 'Cleric', level: 3, current_hp: 18, max_hp: 20, ac: 14 },
  },
  {
    username: 'ally',
    is_dm: false,
    character: { character_id: 'c2', name: 'Doran', char_class: 'Fighter', level: 3, current_hp: 20, max_hp: 22, ac: 16 },
  },
];

describe('Iro CRITICAL-1 — turn-flip refocus is scoped to the local-click provenance + the participant this client controls', () => {
  it('refocuses the composer rail when the DM\'s own Skip click flips the turn onto their bound PC (local click + ownership both satisfied)', async () => {
    mGetSession.mockResolvedValue(sessionFixture());
    mGetParticipants.mockResolvedValue(PARTY_DM_WITH_PC);
    mGetCharacterSheet.mockResolvedValue(casterSheet());
    mGetCombatState.mockResolvedValue(COMBAT_MONSTER_TURN);

    render(<PlayPage />);

    const skipBtn = await screen.findByRole('button', { name: 'Skip monster turn' });
    // Simulate the browser's own synchronous "clicking a button focuses it"
    // behavior — jsdom's fireEvent.click does not do this itself (same
    // pattern as the existing P1-PLAYFIX-2 CRITICAL-1 test in
    // play.intent-fastpath.test.tsx: `act(() => stealthBtn.focus())`).
    act(() => skipBtn.focus());
    expect(skipBtn).toHaveFocus();

    mNpcAction.mockResolvedValue({
      message: 'The goblin skips its turn.',
      state: COMBAT_PC_TURN,
    });

    await act(async () => {
      fireEvent.click(skipBtn);
    });
    await waitFor(() => expect(mNpcAction).toHaveBeenCalledTimes(1));

    // The Skip button's row unmounts once the monster is no longer the
    // active turn, stranding focus on <body> — the effect should then move
    // focus to the ActionRail container ("Your character's actions"),
    // because MonsterRow's fireAction() set the provenance flag from a real
    // local click AND the newly active participant (p-self) is this
    // viewer's own bound PC (entity_id 'c1').
    await waitFor(() => {
      const rail = screen.getByRole('group', { name: "Your character's actions" });
      expect(rail).toHaveFocus();
    });
  });

  it('does NOT refocus when the turn flips to another player\'s PC purely via the 4s poll — no local click occurred on this client', async () => {
    jest.useFakeTimers();
    try {
      mGetSession.mockResolvedValue(sessionFixture({ dm_username: 'suzu', dm_mode: 'ai' }));
      mGetParticipants.mockResolvedValue(PARTY_TWO_PLAYERS);
      mGetCharacterSheet.mockResolvedValue(casterSheet({ character_id: 'c1', name: 'Velka' }));

      // First combat-state fetch (mount) returns the enemy's turn; every
      // subsequent fetch (the 4s poll) returns the ally's turn — modeling
      // another client's action landing on this client purely via the poll.
      let combatCall = 0;
      mGetCombatState.mockImplementation(() =>
        Promise.resolve(++combatCall === 1 ? COMBAT_ENEMY_TURN_TWO_PC : COMBAT_ALLY_TURN),
      );

      render(<PlayPage />);
      await screen.findByRole('textbox');
      await waitFor(() => expect(mGetCombatState).toHaveBeenCalledTimes(1));

      // Nothing was ever clicked or focused locally — activeElement sits at
      // the jsdom default (<body>), the same state Iro flagged as
      // indistinguishable from a real stranding without the provenance gate
      // (idle / never-focused / screen-reader virtual-cursor browsing).
      expect(document.activeElement).toBe(document.body);

      // Advance the poll interval; combatState now reports the ally's turn.
      await act(async () => {
        jest.advanceTimersByTime(4000);
      });
      await waitFor(() => expect(mGetCombatState).toHaveBeenCalledTimes(2));
      // Flush the effect's queued requestAnimationFrame (faked under modern
      // jest timers) so its stranding check actually runs.
      await act(async () => {
        jest.advanceTimersByTime(100);
      });

      // No local click ever set the provenance flag, and the newly active
      // participant (c2) isn't this viewer's bound PC (c1) either way — the
      // composer rail must not steal focus from wherever it already was.
      expect(document.activeElement).toBe(document.body);
    } finally {
      jest.useRealTimers();
    }
  });

  it("does NOT refocus the DM's own composer rail when their own Skip click flips the turn onto an ALLY's PC, not their own (provenance true, ownership false)", async () => {
    // A GM-PC table (leon is DM AND has a bound PC) that ALSO has a second
    // human player's PC — the DM's own local click is provenance-true, but
    // the turn it flips to belongs to the ally, not the DM's own character.
    mGetSession.mockResolvedValue(sessionFixture());
    mGetParticipants.mockResolvedValue([
      ...PARTY_DM_WITH_PC,
      {
        username: 'ally',
        is_dm: false,
        character: { character_id: 'c2', name: 'Doran', char_class: 'Fighter', level: 3, current_hp: 20, max_hp: 22, ac: 16 },
      },
    ]);
    mGetCharacterSheet.mockResolvedValue(casterSheet());
    mGetCombatState.mockResolvedValue(COMBAT_ENEMY_TURN_TWO_PC);

    render(<PlayPage />);

    const skipBtn = await screen.findByRole('button', { name: 'Skip monster turn' });
    act(() => skipBtn.focus());
    expect(skipBtn).toHaveFocus();

    mNpcAction.mockResolvedValue({
      message: 'The goblin skips its turn.',
      state: COMBAT_ALLY_TURN,
    });

    await act(async () => {
      fireEvent.click(skipBtn);
    });
    await waitFor(() => expect(mNpcAction).toHaveBeenCalledTimes(1));
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Skip monster turn' })).not.toBeInTheDocument();
    });

    // Give the effect's requestAnimationFrame (real timers here, not faked)
    // room to actually run before asserting the negative — otherwise the
    // assertion below could pass merely because the rAF callback hasn't
    // fired yet, not because the ownership gate correctly blocked it.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    // The DM's own click set the provenance flag, but the newly active
    // participant (Doran, c2) is NOT the DM's own bound PC (Velka, c1) — the
    // ownership gate must keep the DM's composer rail from being focused
    // just because this DM happens to have a rail at all.
    const rail = screen.getByRole('group', { name: "Your character's actions" });
    expect(rail).not.toHaveFocus();
  });
});
