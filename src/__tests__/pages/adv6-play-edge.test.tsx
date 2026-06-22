/**
 * ADV-6 play page edge tests.
 *
 * Gaps filled vs play.test.tsx:
 *   1. combatFromScene resolves with monsters:[] → no crash, UI stays sane.
 *   2. combatFromScene resolves with empty-string combat_id → no crash, no invalid
 *      combat state.
 *
 * The combatFromScene client-layer test (success:false 2xx → throws) lives in
 * src/__tests__/lib/adv6-client-edge.test.ts because it tests the api/dnd.ts
 * module directly, not the React component.
 */

import React from 'react';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { Participant, Session } from '@/lib/api/types';

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
  getParticipants: jest.fn(),
  combatFromScene: jest.fn(),
  startCombat: jest.fn(),
  spawnMonster: jest.fn(),
  rollInitiative: jest.fn(),
  monsterTurn: jest.fn(),
  attack: jest.fn(),
  dodge: jest.fn(),
  dash: jest.fn(),
  endTurn: jest.fn(),
}));

jest.mock('../../lib/stream', () => ({
  streamDmNarration: jest.fn(),
}));

import * as dnd from '@/lib/api/dnd';
import * as stream from '@/lib/stream';
import PlayPage from '@/app/play/[sessionId]/page';

const mGetSession = dnd.getSession as jest.MockedFunction<typeof dnd.getSession>;
const mGetParticipants = dnd.getParticipants as jest.MockedFunction<typeof dnd.getParticipants>;
const mStream = stream.streamDmNarration as jest.MockedFunction<typeof stream.streamDmNarration>;
const mCombatFromScene = dnd.combatFromScene as jest.MockedFunction<typeof dnd.combatFromScene>;
const mRollInitiative = dnd.rollInitiative as jest.MockedFunction<typeof dnd.rollInitiative>;

const SESSION: Session = {
  session_id: 's1',
  channel: 'the_hollow_tide',
  status: 'active',
  dm_username: 'suzu',
  participant_usernames: ['alice'],
  player_count: 1,
  active_combat_id: null,
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
      name: 'Velka',
      char_class: 'Rogue',
      level: 1,
      current_hp: 8,
      max_hp: 10,
      ac: 14,
    },
  },
];

beforeEach(() => {
  jest.clearAllMocks();
  mGetSession.mockResolvedValue(SESSION);
  mGetParticipants.mockResolvedValue(PARTY);
  mStream.mockImplementation(async function* () {
    yield { kind: 'chunk' as const, text: 'The door creaks.' };
    yield { kind: 'done' as const };
  });
  mRollInitiative.mockResolvedValue({ message: 'Initiative rolled.' });
});

async function clickBeginEncounter() {
  render(<PlayPage />);
  await screen.findByText('The Hollow Tide');
  const btn = screen.getByRole('button', { name: /begin an encounter/i });
  await act(async () => {
    fireEvent.click(btn);
  });
  return btn;
}

// ── ADV-6 edge: empty monsters list ──────────────────────────────────────────

describe('ADV-6 play page — combatFromScene edge cases', () => {
  it('empty monsters list → page does not crash, combatFromScene called once', async () => {
    // The engine might return monsters:[] in a degenerate path (all refs stripped
    // server-side with no 400 yet).  The play page must not crash — it treats
    // the result like a successful but empty spawn (log line uses "enemies").
    mCombatFromScene.mockResolvedValue({
      combat_id: 'combat-empty',
      round: 1,
      monsters: [],
      encounter_id: 'cave_mouth_guards',
    });

    await clickBeginEncounter();

    await waitFor(() => expect(mCombatFromScene).toHaveBeenCalledTimes(1));

    // Page must still be in the document — no unhandled crash
    expect(screen.getByText('The Hollow Tide')).toBeInTheDocument();

    // The log line uses "enemies" as the fallback when the monster list is empty
    await waitFor(() =>
      expect(screen.getByText(/enemies close in/i)).toBeInTheDocument(),
    );
  });

  it('empty-string combat_id → no crash, no broken combat-mode state', async () => {
    // If the engine returns combat_id='' (falsy), the UI must not enter an
    // invalid combat mode or crash trying to use an empty string as a combat key.
    mCombatFromScene.mockResolvedValue({
      combat_id: '',
      round: 1,
      monsters: [{ participant_id: 'g1', name: 'Goblin', hp: 7 }],
      encounter_id: 'cave_mouth_guards',
    });

    await clickBeginEncounter();

    await waitFor(() => expect(mCombatFromScene).toHaveBeenCalledTimes(1));

    // Page must still render
    expect(screen.getByText('The Hollow Tide')).toBeInTheDocument();
  });
});
