/**
 * TAV-COMBAT-NO-ACTION-REMAINING-UNMAPPED + TAV-401-ACTOR-REQUIRED-UNMAPPED
 * (2026-08-06).
 *
 * A level-5 Fighter who spends both Extra Attack swings gets 400 +
 * data.reason="no_action_remaining". Pre-fix, the Tavern had no map entry
 * for it and showed "That combat action did not land. Try again." — the
 * language of a MISSED attack roll, plus an invitation to retry something
 * that cannot succeed until the turn ends.
 *
 * Unlike src/__tests__/lib/dnd-engineReasons.test.ts (which tests the map +
 * engineErrorMessage in isolation), these tests exercise the ACTUAL wiring:
 * a rejected `attack`/`dodge` call flowing through onCombatAction's two
 * separate catch blocks (attack has its own inline catch; dodge/dash/
 * endturn/deathsave share the outer one) and rendering into the
 * `role="alert"` refusal banner. This is what would catch a regression like
 * "COMBAT_REFUSAL_REASON_MAP imported but the wrong reasonMap prop passed",
 * which a pure map-level test cannot see.
 *
 * Error bodies below use the REAL proxy shape (api/routes/dnd_combat.py::
 * _handle_dnd_error): `{success:false, error:"...", data:{reason, state?}}`,
 * `message` ABSENT. `state` is included on the attack/dodge/etc. refusals
 * (engine's `_err()` sets it whenever a combat exists) and correctly absent
 * on the actor_required 401 (raised before the engine is even reached).
 */
import React from 'react';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { CombatState, GroundingData, NarrationEvent, Participant, Session } from '@/lib/api/types';

jest.mock('next/navigation', () => ({
  useParams: () => ({ sessionId: 's1' }),
}));

const mockToast = jest.fn();
jest.mock('../../components/Toast', () => ({
  useToast: () => ({ toast: mockToast }),
}));

jest.mock('../../lib/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 1, username: 'alice', email: null } }),
}));

jest.mock('../../lib/useReducedMotion', () => ({
  useReducedMotion: () => true,
}));

jest.mock('../../lib/api/dnd', () => ({
  getSession: jest.fn(),
  getSessionEvents: jest.fn(() => Promise.resolve([])),
  getSessionEventsRaw: jest.fn(() => Promise.resolve(null)),
  getParticipants: jest.fn(),
  getGrounding: jest.fn(),
  getCombatState: jest.fn(),
  getCharacterSheet: jest.fn(() => Promise.resolve(null)),
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
  rollDeathSave: jest.fn(),
  endCombat: jest.fn(),
  advanceScene: jest.fn(),
  setFlag: jest.fn(),
  bindCharacter: jest.fn(() =>
    Promise.resolve({ campaign_id: 's1', username: 'alice', role: 'player', character_id: 1 }),
  ),
  listMyCharacters: jest.fn(() => Promise.resolve([])),
  getSessionNotes: jest.fn(() => Promise.resolve(null)),
  putSessionNotes: jest.fn(() => Promise.resolve({ body: '', updated_at: '2026-01-01T00:00:00Z' })),
}));

jest.mock('../../lib/stream', () => ({
  streamDmNarration: jest.fn(),
}));

import * as dnd from '@/lib/api/dnd';
import * as stream from '@/lib/stream';
import PlayPage from '@/app/play/[sessionId]/page';
import { makeApiError } from '@/lib/api/client';

const mGetSession = dnd.getSession as jest.MockedFunction<typeof dnd.getSession>;
const mGetParticipants = dnd.getParticipants as jest.MockedFunction<typeof dnd.getParticipants>;
const mGetGrounding = dnd.getGrounding as jest.MockedFunction<typeof dnd.getGrounding>;
const mGetCombatState = dnd.getCombatState as jest.MockedFunction<typeof dnd.getCombatState>;
const mAttack = dnd.attack as jest.MockedFunction<typeof dnd.attack>;
const mDodge = dnd.dodge as jest.MockedFunction<typeof dnd.dodge>;
const mStream = stream.streamDmNarration as jest.MockedFunction<typeof stream.streamDmNarration>;

const SESSION_WITH_COMBAT: Session = {
  session_id: 's1',
  channel: 'the_hollow_tide',
  status: 'active',
  dm_username: 'suzu',
  participant_usernames: ['alice'],
  player_count: 1,
  active_combat_id: 'combat-42',
  dm_mode: 'ai',
  visibility: 'public',
  content_rating: 'sfw',
};

const PARTY: Participant[] = [
  {
    username: 'alice',
    is_dm: false,
    character: {
      character_id: 'c1',
      name: 'Torvin',
      char_class: 'Fighter',
      level: 5,
      current_hp: 30,
      max_hp: 30,
      ac: 17,
    },
  },
];

const COMBAT_STATE: CombatState = {
  combat_id: 'combat-42',
  session_id: 's1',
  round: 1,
  state: 'active',
  turn_index: 0,
  active_participant_id: 'p_torvin',
  initiative: ['p_torvin', 'p_gob1'],
  participants: [
    {
      participant_id: 'p_torvin',
      entity_id: 'c1',
      name: 'Torvin',
      is_pc: true,
      initiative: 18,
      hp_current: 30,
      hp_max: 30,
      ac: 17,
      conditions: [],
      is_alive: true,
      can_be_targeted: true,
      is_active_turn: true,
      took_turn: false,
      death_saves: {
        successes: 0,
        failures: 0,
        is_downed: false,
        is_dying: false,
        is_stable: false,
        is_dead: false,
      },
    },
    {
      participant_id: 'p_gob1',
      entity_id: 'goblin',
      name: 'Goblin',
      is_pc: false,
      initiative: 12,
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
  terrain: { lighting: 'dim', cover: '', hazards: [] },
  encounter_id: 'cave_mouth_guards',
  scene_id: 'cave_mouth',
  last_action: null,
  scene_advance: null,
};

const GROUNDING_NO_TRANSITION: GroundingData = {
  scene_id: 'cave_mouth',
  scene_name: 'Cave Mouth',
  transitions: [],
};

function streamOnce(events: NarrationEvent[]) {
  mStream.mockImplementation(async function* () {
    for (const e of events) yield e;
  });
}

/** Byte-faithful reconstruction of api/routes/dnd_combat.py::_handle_dnd_error's
 *  output for an httpx.HTTPStatusError carrying the engine's `_err()` body --
 *  `message` renamed to `error`, `data` forwarded whole, NO top-level
 *  `message` key. `code` mirrors client.ts's own non-2xx parsing. */
function realProxyRefusal(status: number, errorText: string, data: Record<string, unknown>) {
  const body = { success: false, error: errorText, data };
  return makeApiError(status, errorText, body);
}

beforeEach(() => {
  jest.clearAllMocks();
  mGetSession.mockResolvedValue(SESSION_WITH_COMBAT);
  mGetParticipants.mockResolvedValue(PARTY);
  mGetGrounding.mockResolvedValue(GROUNDING_NO_TRANSITION);
  mGetCombatState.mockResolvedValue(COMBAT_STATE);
  streamOnce([{ kind: 'chunk', text: 'The fight continues.' }, { kind: 'done' }]);
});

describe('TAV-COMBAT-NO-ACTION-REMAINING-UNMAPPED — attack path (inline catch)', () => {
  it('a second Extra Attack swing (no_action_remaining, real proxy body, message ABSENT) shows the curated action-economy copy, not the miss-language fallback', async () => {
    mAttack.mockRejectedValue(
      realProxyRefusal(400, '[Combat] Torvin has already used their action this turn.', {
        reason: 'no_action_remaining',
        state: COMBAT_STATE,
      }),
    );
    render(<PlayPage />);
    await screen.findByText('The Hollow Tide');
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: /Attack/i }).length).toBeGreaterThan(0),
    );

    const attackBtn = screen.getAllByRole('button', { name: /Attack/i })[0];
    await act(async () => {
      fireEvent.click(attackBtn);
    });
    await waitFor(() => screen.getByRole('menu'));
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: /Goblin/i }));
    });

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("You've already used your action this turn — end your turn.");
    // The exact old broken copy this ticket replaces must never appear.
    expect(screen.queryByText(/did not land/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Try again\.?$/i)).not.toBeInTheDocument();
  });
});

describe('TAV-COMBAT-NO-ACTION-REMAINING-UNMAPPED — dodge/dash/endturn path (outer catch)', () => {
  it('dodge refused with no_action_remaining ALSO gets curated copy — proves BOTH catch sites were fixed, not just attack', async () => {
    mDodge.mockRejectedValue(
      realProxyRefusal(400, '[Combat] Torvin has already used their action this turn.', {
        reason: 'no_action_remaining',
        state: COMBAT_STATE,
      }),
    );
    render(<PlayPage />);
    await screen.findByText('The Hollow Tide');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Dodge' })).toBeInTheDocument());

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Dodge' }));
    });

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("You've already used your action this turn — end your turn.");
  });
});

describe('TAV-401-ACTOR-REQUIRED-UNMAPPED — actor_required 401', () => {
  it('a 401 actor_required refusal (no `state`, message ABSENT) surfaces the curated identity copy, not the generic fallback', async () => {
    mDodge.mockRejectedValue(
      realProxyRefusal(401, 'Actor identity required.', { reason: 'actor_required' }),
    );
    render(<PlayPage />);
    await screen.findByText('The Hollow Tide');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Dodge' })).toBeInTheDocument());

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Dodge' }));
    });

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("Couldn't verify who you are. Try reloading — if it keeps happening, the sign-in service may be down.");
  });
});

describe('TAV-COMBAT reworded fallback — genuinely unmapped refusal (network/abort shape)', () => {
  it('a network-style refusal with NO reason and NO body falls back to the reworded (non-miss-language) copy', async () => {
    const err = makeApiError(0, 'network');
    mDodge.mockRejectedValue(err);
    render(<PlayPage />);
    await screen.findByText('The Hollow Tide');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Dodge' })).toBeInTheDocument());

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Dodge' }));
    });

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("That combat action didn't go through.");
    expect(alert).not.toHaveTextContent(/did not land/i);
  });
});
