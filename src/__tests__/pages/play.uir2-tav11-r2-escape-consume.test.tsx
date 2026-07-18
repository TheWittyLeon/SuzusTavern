/**
 * UIR2-TAV-11 r2 — structural Escape-consume fix (Miko-QA re-gate regression).
 *
 * r1 (bf4331b) fixed the leak by enumerating 3 known Escape-handling overlays
 * (journal, combat outcome chooser, end-session ConfirmDialog) in the
 * document-level Award-XP fallback listener's guard. Miko-QA's re-gate proved
 * the enumeration wasn't exhaustive — 4 MORE Escape-handling
 * overlays/menus in the /play subtree had the identical shape (Escape either
 * never stopPropagation()'d, or only stopPropagation()'d while idle) and
 * leaked the same way:
 *
 *   1. DmNarrationPanel's monster attack-target menu — never stopPropagation()'d.
 *   2. RebindCharacterButton — only stopPropagation()'d while `!busy`.
 *   3. Composer's player attack-target menu — never stopPropagation()'d.
 *   4. DmOverrideModal — only stopPropagation()'d while `!submitting`.
 *
 * The r2 fix is structural: every Escape-handling overlay/menu/modal under
 * /play now calls e.stopPropagation() UNCONDITIONALLY on Escape (gating only
 * the close/state-change on its own busy flag), so an Escape fired inside any
 * of them is consumed at its own DOM node and can never reach the
 * document-level Award-XP fallback — no enumeration required. This file
 * proves that for all 4 leak paths, plus the Finding-2 busy-strand legs
 * (endSessionConfirm / journal / sessionActionBusy==='xp') that Kage-CR noted
 * were untested in r1.
 */
import React from 'react';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { CombatState, Participant, Session, Character } from '@/lib/api/types';

jest.mock('next/navigation', () => ({
  useParams: () => ({ sessionId: 's1' }),
}));

const mockToast = jest.fn();
jest.mock('../../components/Toast', () => ({
  useToast: () => ({ toast: mockToast }),
}));

// dm_alice is both the logged-in user and the session DM throughout this
// file, so the Session controls group (Award XP / End session) is always
// reachable alongside whichever overlay a given test is exercising.
jest.mock('../../lib/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 1, username: 'dm_alice', email: null } }),
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
  getCharacterSheet: jest.fn(() => Promise.resolve(null)),
  postSessionEvent: jest.fn(() => Promise.resolve({ seq: 1 })),
  pauseSession: jest.fn(),
  resumeSession: jest.fn(),
  endSession: jest.fn(),
  awardSessionXp: jest.fn(),
  advanceScene: jest.fn(),
  resolveCheck: jest.fn(),
  npcAction: jest.fn(),
  combatFromScene: jest.fn(),
  rollInitiative: jest.fn(),
  monsterTurn: jest.fn(),
  startCombat: jest.fn(),
  spawnMonster: jest.fn(),
  attack: jest.fn(),
  dodge: jest.fn(),
  dash: jest.fn(),
  endTurn: jest.fn(),
  endCombat: jest.fn(),
  setFlag: jest.fn(),
  submitOverride: jest.fn(),
  bindCharacter: jest.fn(),
  listMyCharacters: jest.fn(() => Promise.resolve([])),
  getSessionNotes: jest.fn(() => Promise.resolve(null)),
  putSessionNotes: jest.fn(() => Promise.resolve({ body: '', updated_at: '2026-01-01T00:00:00Z' })),
}));

jest.mock('../../lib/stream', () => ({
  streamDmNarration: jest.fn(async function* () {
    yield { kind: 'done' };
  }),
}));

import * as dnd from '@/lib/api/dnd';
import PlayPage from '@/app/play/[sessionId]/page';

const mGetSession = dnd.getSession as jest.MockedFunction<typeof dnd.getSession>;
const mGetParticipants = dnd.getParticipants as jest.MockedFunction<typeof dnd.getParticipants>;
const mGetCombatState = dnd.getCombatState as jest.MockedFunction<typeof dnd.getCombatState>;
const mSubmitOverride = dnd.submitOverride as jest.MockedFunction<typeof dnd.submitOverride>;
const mBindCharacter = dnd.bindCharacter as jest.MockedFunction<typeof dnd.bindCharacter>;
const mListMyCharacters = dnd.listMyCharacters as jest.MockedFunction<typeof dnd.listMyCharacters>;
const mAwardSessionXp = dnd.awardSessionXp as jest.MockedFunction<typeof dnd.awardSessionXp>;

async function openAwardXp() {
  fireEvent.click(await screen.findByRole('button', { name: /Award XP/i }));
  const xpForm = await screen.findByRole('form', { name: /Award session XP/i });
  expect(xpForm).toBeInTheDocument();
  return xpForm;
}

function xpFormPresent() {
  return screen.queryByRole('form', { name: /Award session XP/i }) !== null;
}

// ── Leak #1 + #4: human-DM subtree (DmNarrationPanel target menu, DmOverrideModal) ──

describe('UIR2-TAV-11 r2 — human-DM overlays (DmNarrationPanel / DmOverrideModal)', () => {
  const SESSION_HUMAN: Session = {
    session_id: 's1',
    channel: 'the_hollow_tide',
    status: 'active',
    dm_username: 'dm_alice',
    name: 'The Hollow Tide',
    active_combat_id: 'combat-42',
    dm_mode: 'human',
    ai_assist_level: 'full',
  };

  const PARTY_HUMAN: Participant[] = [
    { username: 'dm_alice', is_dm: true, character: null },
  ];

  const COMBAT_HUMAN: CombatState = {
    combat_id: 'combat-42',
    session_id: 's1',
    round: 1,
    state: 'active',
    turn_index: 0,
    active_participant_id: 'p_gob1',
    initiative: ['p_gob1', 'p_bob1'],
    participants: [
      {
        participant_id: 'p_gob1',
        entity_id: 'm1',
        name: 'Goblin',
        is_pc: false,
        initiative: 10,
        hp_current: 7,
        hp_max: 7,
        ac: 13,
        conditions: [],
        is_alive: true,
        can_be_targeted: true,
        is_active_turn: true,
        took_turn: false,
      },
      {
        participant_id: 'p_bob1',
        entity_id: 'c_bob',
        name: 'Bob',
        is_pc: true,
        initiative: 8,
        hp_current: 12,
        hp_max: 12,
        ac: 14,
        conditions: [],
        is_alive: true,
        can_be_targeted: true,
        is_active_turn: false,
        took_turn: false,
      },
    ],
  };

  function setup() {
    jest.clearAllMocks();
    mGetSession.mockResolvedValue(SESSION_HUMAN);
    mGetParticipants.mockResolvedValue(PARTY_HUMAN);
    mGetCombatState.mockResolvedValue(COMBAT_HUMAN);
  }

  it('[PROVEN leak #1] a monster attack-target menu leaking Escape must not close the Award-XP popover', async () => {
    setup();
    render(<PlayPage />);
    await screen.findByText('The Hollow Tide');

    await openAwardXp();

    // Open the monster (Goblin) attack-target menu — DmNarrationPanel's
    // MonsterRow. This handler has no busy gate at all; pre-fix it never
    // called stopPropagation() on Escape.
    const attackBtn = await screen.findByRole('button', { name: 'Attack — pick target' });
    fireEvent.click(attackBtn);
    const menu = await screen.findByRole('menu', { name: /Goblin — pick target/i });

    fireEvent.keyDown(menu, { key: 'Escape' });

    // Control: the menu's own close behavior is unchanged.
    await waitFor(() =>
      expect(screen.queryByRole('menu', { name: /Goblin — pick target/i })).not.toBeInTheDocument(),
    );
    // The bug: pre-fix, this Escape leaked to the document-level fallback and
    // silently closed the unrelated Award-XP popover.
    expect(xpFormPresent()).toBe(true);
  });

  it('[leak #4, same shape as PROVEN #2] a busy DM Override modal leaking Escape must not close the Award-XP popover', async () => {
    setup();
    mSubmitOverride.mockReturnValue(new Promise(() => {})); // never resolves -> submitting stays true
    render(<PlayPage />);
    await screen.findByText('The Hollow Tide');

    await openAwardXp();

    fireEvent.click(await screen.findByRole('button', { name: 'Open DM override modal' }));
    const dialog = await screen.findByRole('dialog', { name: 'DM Override' });

    // Fill the minimum required fields (reason + target for the default
    // 'attack' kind) and submit — submitOverride never resolves, so
    // `submitting` stays true and the modal's own Escape handler no-ops on
    // the close (pre-fix it also never stopPropagation()'d while busy).
    fireEvent.change(within(dialog).getByLabelText(/^Target/i), { target: { value: 'p_bob1' } });
    fireEvent.change(within(dialog).getByLabelText(/^Reason/i), { target: { value: 'Fiat: crit' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Apply override' }));

    await waitFor(() => expect(mSubmitOverride).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(within(dialog).getByRole('button', { name: 'Submitting override…' })).toBeInTheDocument(),
    );

    fireEvent.keyDown(dialog, { key: 'Escape' });

    // Control: the busy modal must stay open (unchanged behavior).
    expect(screen.getByRole('dialog', { name: 'DM Override' })).toBeInTheDocument();
    // The bug: pre-fix, this Escape leaked to the document-level fallback and
    // silently closed the unrelated Award-XP popover.
    expect(xpFormPresent()).toBe(true);
  });
});

// ── Leak #3: Composer's player attack-target menu (DM playing own PC) ──

describe('UIR2-TAV-11 r2 — Composer player attack-target menu', () => {
  const SESSION_AI: Session = {
    session_id: 's1',
    channel: 'the_hollow_tide',
    status: 'active',
    dm_username: 'dm_alice',
    name: 'The Hollow Tide',
    active_combat_id: 'combat-42',
    dm_mode: 'ai',
    ai_assist_level: 'full',
  };

  // dm_alice is DM AND has a bound PC (TAV-SOLO-DM-CAST-RAIL) — this is what
  // surfaces Composer's own player action rail (Attack/Dodge/...) alongside
  // the isDm-gated Session controls (Award XP) on the same render.
  const PARTY_AI: Participant[] = [
    {
      username: 'dm_alice',
      is_dm: true,
      character: {
        character_id: '55',
        name: 'Ashka',
        char_class: 'Fighter',
        level: 3,
        current_hp: 20,
        max_hp: 20,
        ac: 15,
      },
    },
  ];

  const COMBAT_AI: CombatState = {
    combat_id: 'combat-42',
    session_id: 's1',
    round: 1,
    state: 'active',
    turn_index: 0,
    active_participant_id: 'p_dm1',
    initiative: ['p_dm1', 'p_gob1'],
    participants: [
      {
        participant_id: 'p_dm1',
        entity_id: '55',
        name: 'Ashka',
        is_pc: true,
        initiative: 15,
        hp_current: 20,
        hp_max: 20,
        ac: 15,
        conditions: [],
        is_alive: true,
        can_be_targeted: true,
        is_active_turn: true,
        took_turn: false,
      },
      {
        participant_id: 'p_gob1',
        entity_id: 'm1',
        name: 'Goblin',
        is_pc: false,
        initiative: 10,
        hp_current: 7,
        hp_max: 7,
        ac: 13,
        conditions: [],
        is_alive: true,
        can_be_targeted: true,
        is_active_turn: false,
        took_turn: false,
      },
    ],
  };

  function setup() {
    jest.clearAllMocks();
    mGetSession.mockResolvedValue(SESSION_AI);
    mGetParticipants.mockResolvedValue(PARTY_AI);
    mGetCombatState.mockResolvedValue(COMBAT_AI);
  }

  it('[leak #3, structurally identical to PROVEN #1] a player attack-target menu leaking Escape must not close the Award-XP popover', async () => {
    setup();
    render(<PlayPage />);
    await screen.findByText('The Hollow Tide');

    await openAwardXp();

    // Composer's ActionRail — it's dm_alice's own PC's turn, so Attack is
    // enabled. This handler has no busy gate at all; pre-fix it never called
    // stopPropagation() on Escape.
    const attackBtn = await screen.findByRole('button', { name: 'Attack' });
    fireEvent.click(attackBtn);
    const menu = await screen.findByRole('menu', { name: /Attack — pick a target/i });

    fireEvent.keyDown(menu, { key: 'Escape' });

    await waitFor(() =>
      expect(screen.queryByRole('menu', { name: /Attack — pick a target/i })).not.toBeInTheDocument(),
    );
    expect(xpFormPresent()).toBe(true);
  });
});

// ── Leak #2: RebindCharacterButton busy popover ──

describe('UIR2-TAV-11 r2 — RebindCharacterButton', () => {
  const SESSION_AI: Session = {
    session_id: 's1',
    channel: 'the_hollow_tide',
    status: 'active',
    dm_username: 'dm_alice',
    name: 'The Hollow Tide',
    dm_mode: 'ai',
    ai_assist_level: 'full',
  };

  const PARTY: Participant[] = [
    { username: 'dm_alice', is_dm: true, character: null },
  ];

  const A_CHARACTER: Character = {
    character_id: '9',
    username: 'dm_alice',
    name: 'Zog',
    race: 'Orc',
    char_class: 'Barbarian',
    level: 2,
    hp: { current: 10, max: 10 },
    ac: 12,
  };

  function setup() {
    jest.clearAllMocks();
    mGetSession.mockResolvedValue(SESSION_AI);
    mGetParticipants.mockResolvedValue(PARTY);
    // No active_combat_id on SESSION_AI — getCombatState is never called.
    mListMyCharacters.mockResolvedValue([A_CHARACTER]);
  }

  it('[PROVEN leak #2] a busy rebind popover leaking Escape must not close the Award-XP popover', async () => {
    setup();
    mBindCharacter.mockReturnValue(new Promise(() => {})); // never resolves -> busy stays true
    render(<PlayPage />);
    await screen.findByText('The Hollow Tide');

    await openAwardXp();

    fireEvent.click(await screen.findByRole('button', { name: 'Change your character' }));
    const dialog = await screen.findByRole('dialog', { name: 'Change your character' });

    const zogRadio = await within(dialog).findByRole('radio', { name: /Zog/i });
    fireEvent.click(zogRadio);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }));

    await waitFor(() => expect(mBindCharacter).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(within(dialog).getByRole('button', { name: 'Saving…' })).toBeInTheDocument(),
    );

    fireEvent.keyDown(dialog, { key: 'Escape' });

    // Control: the busy popover must stay open (unchanged behavior).
    expect(screen.getByRole('dialog', { name: 'Change your character' })).toBeInTheDocument();
    // The bug: pre-fix, this Escape leaked to the document-level fallback and
    // silently closed the unrelated Award-XP popover.
    expect(xpFormPresent()).toBe(true);
  });
});

// ── Finding-2 busy-strand legs (Kage-CR: untested in r1) ──

describe('UIR2-TAV-11 r2 — document-level Award-XP fallback busy-strand legs', () => {
  const SESSION: Session = {
    session_id: 's1',
    channel: 'the_hollow_tide',
    status: 'active',
    dm_username: 'dm_alice',
    name: 'The Hollow Tide',
    dm_mode: 'ai',
    ai_assist_level: 'full',
  };

  const PARTY: Participant[] = [
    { username: 'dm_alice', is_dm: true, character: null },
  ];

  function setup() {
    jest.clearAllMocks();
    mGetSession.mockResolvedValue(SESSION);
    mGetParticipants.mockResolvedValue(PARTY);
    // No active_combat_id on SESSION — getCombatState is never called.
  }

  it('endSessionConfirm being open blocks the fallback (idle, no active combat)', async () => {
    setup();
    render(<PlayPage />);
    await screen.findByText('The Hollow Tide');

    await openAwardXp();

    fireEvent.click(await screen.findByRole('button', { name: 'End session' }));
    const confirmDialog = await screen.findByRole('dialog', { name: 'End this session?' });

    // Dispatched directly at `document` — simulates focus being outside both
    // overlays, the exact path the fallback listener is defending.
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(xpFormPresent()).toBe(true);
    expect(screen.getByRole('dialog', { name: 'End this session?' })).toBeInTheDocument();
    expect(confirmDialog).toBeInTheDocument();
  });

  it('journalOpen being true blocks the fallback', async () => {
    setup();
    render(<PlayPage />);
    await screen.findByText('The Hollow Tide');

    await openAwardXp();

    fireEvent.click(await screen.findByRole('button', { name: 'Open journal' }));

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(xpFormPresent()).toBe(true);
  });

  it("sessionActionBusy==='xp' blocks the fallback (no sibling overlay open)", async () => {
    setup();
    mAwardSessionXp.mockReturnValue(new Promise(() => {})); // never resolves -> sessionActionBusy stays 'xp'
    render(<PlayPage />);
    await screen.findByText('The Hollow Tide');

    const xpForm = await openAwardXp();
    fireEvent.change(within(xpForm).getByLabelText('XP amount'), { target: { value: '5' } });
    fireEvent.click(within(xpForm).getByRole('button', { name: 'Award' }));

    await waitFor(() => expect(mAwardSessionXp).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(within(xpForm).getByRole('button', { name: 'Awarding…' })).toBeInTheDocument(),
    );

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(xpFormPresent()).toBe(true);
  });

  it('control: Escape from outside all overlays still closes the Award-XP popover', async () => {
    setup();
    render(<PlayPage />);
    await screen.findByText('The Hollow Tide');

    await openAwardXp();

    fireEvent.keyDown(document, { key: 'Escape' });

    await waitFor(() => expect(xpFormPresent()).toBe(false));
  });
});
