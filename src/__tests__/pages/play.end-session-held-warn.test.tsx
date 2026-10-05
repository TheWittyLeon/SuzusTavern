/**
 * TPK-HOLD W5 — ending the session while a fight is held WARNS (the owner's ruling). The engine's session end touches no combat, so a held fight
 * is left live, and its characters stay undeletable until it ends. The End session confirm names the fight; the confirm's label stays "End it".
 */
import React from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderPlay } from '@/test-utils/renderPlay';
import '@testing-library/jest-dom';
import type { CombatState, Participant, Session } from '@/lib/api/types';

jest.mock('next/navigation', () => ({ useParams: () => ({ sessionId: 's1' }) }));
jest.mock('../../components/Toast', () => ({ useToast: () => ({ toast: jest.fn() }) }));
jest.mock('../../lib/auth/AuthProvider', () => ({ useAuth: () => ({ user: { id: 1, username: 'dm_alice', email: null } }) }));
jest.mock('../../lib/useReducedMotion', () => ({ useReducedMotion: () => true }));
jest.mock('../../lib/api/dnd', () => ({
  getSession: jest.fn(),
  getSessionEvents: jest.fn(() => Promise.resolve([])),
  getSessionEventsRaw: jest.fn(() => Promise.resolve(null)),
  getParticipants: jest.fn(),
  getGrounding: jest.fn(() => Promise.resolve(null)),
  getCombatState: jest.fn(),
  getCharacterSheet: jest.fn(() => Promise.resolve(null)),
  postSessionEvent: jest.fn(() => Promise.resolve({})),
  getSessionNotes: jest.fn(() => Promise.resolve(null)),
  putSessionNotes: jest.fn(() => Promise.resolve({ body: '', updated_at: '2026-01-01T00:00:00Z' })),
}));
jest.mock('../../lib/stream', () => ({ streamDmNarration: jest.fn() }));

import * as dnd from '@/lib/api/dnd';
import PlayPage from '@/app/play/[sessionId]/page';
import { endSessionBody } from '@/app/play/[sessionId]/format';

const SESSION: Session = {
  session_id: 's1', channel: 'c', status: 'active', dm_username: 'dm_alice', participant_usernames: ['dm_alice'],
  player_count: 1, active_combat_id: 'combat-1', dm_mode: 'human', ai_assist_level: 'full',
};
const PARTY: Participant[] = [{ username: 'dm_alice', is_dm: true, character: null }];
const fight = (state: CombatState['state']): CombatState => ({
  combat_id: 'combat-1', session_id: 's1', round: 2, state, turn_index: 0, active_participant_id: null, initiative: [],
  participants: [{
    participant_id: 'p1', entity_id: 'c1', name: 'Anomaly', is_pc: true, initiative: 15, hp_current: 0, hp_max: 9, ac: 12, conditions: [],
    is_alive: false, can_be_targeted: false, is_active_turn: false, took_turn: false,
  }],
});

async function openConfirm(state: CombatState['state']) {
  (dnd.getSession as jest.Mock).mockResolvedValue(SESSION);
  (dnd.getParticipants as jest.Mock).mockResolvedValue(PARTY);
  (dnd.getCombatState as jest.Mock).mockResolvedValue(fight(state));
  renderPlay(<PlayPage />);
  // The fight's state has landed once the stage's status node has its words.
  await screen.findByText(state === 'held' ? /Every character has fallen\./ : /In combat · use the action bar/);
  fireEvent.click(await screen.findByRole('button', { name: /^End session$/i }));
  return screen.findByRole('dialog', { name: /End this session/i });
}

describe('End session while a fight is held', () => {
  it('names the held fight, keeps the ordinary words, and the confirm stays "End it"', async () => {
    const dialog = await openConfirm('held');
    expect(dialog).toHaveTextContent('A fight is waiting for your ruling: every character has fallen.');
    expect(dialog).toHaveTextContent("Ending the session leaves it unresolved, and the characters in it can't be deleted until it ends.");
    expect(dialog).toHaveTextContent('This ends the table for everyone at it.');
    expect(screen.getByRole('button', { name: /^End it$/ })).toBeInTheDocument();
  });

  it('control: a running fight gets the ordinary confirm, unchanged', async () => {
    const dialog = await openConfirm('active');
    expect(dialog).not.toHaveTextContent(/waiting for your ruling/);
    await waitFor(() => expect(dialog).toHaveTextContent('This ends the table for everyone at it.'));
  });
});

describe('endSessionBody', () => {
  it.each([
    ['idle', false], ['rolling_initiative', false], ['active', false], ['between_turns', false], ['held', true], ['ended', false],
  ] as const)("state '%s' warns: %s", (state, warns) => {
    expect(/waiting for your ruling/.test(endSessionBody(fight(state)))).toBe(warns);
  });
  it('no fight loaded: the ordinary body', () => {
    expect(endSessionBody(null)).not.toMatch(/waiting for your ruling/);
  });
});
