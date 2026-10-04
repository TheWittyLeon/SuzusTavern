/**
 * ENGINE E0 (ruling 48 B): a scene move while a fight is not ended is a 409 `combat_live`. The Tavern hides Move on and the checks while a fight is live, so only a STALE tab
 * (the fight began after it last read the session) can send one; it says the engine's sentence instead of "Could not advance the scene.".
 */
import React from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderPlay } from '@/test-utils/renderPlay';
import '@testing-library/jest-dom';
import type { GroundingData, Participant, Session } from '@/lib/api/types';
import { SCENE_MOVE_REASON_COPY } from '@/lib/dnd/engineReasons';

const mockToast = jest.fn();
jest.mock('next/navigation', () => ({ useParams: () => ({ sessionId: 's1' }) }));
jest.mock('../../components/Toast', () => ({ useToast: () => ({ toast: mockToast }) }));
jest.mock('../../lib/auth/AuthProvider', () => ({ useAuth: () => ({ user: { id: 1, username: 'leon', email: null } }) }));
jest.mock('../../lib/useReducedMotion', () => ({ useReducedMotion: () => true }));
jest.mock('../../lib/api/dnd', () => ({
  getSession: jest.fn(), getSessionEvents: jest.fn(() => Promise.resolve([])), getSessionEventsRaw: jest.fn(() => Promise.resolve(null)),
  getParticipants: jest.fn(), getGrounding: jest.fn(), getCombatState: jest.fn(() => Promise.resolve(null)),
  getCharacterSheet: jest.fn(() => Promise.resolve(null)), postSessionEvent: jest.fn(() => Promise.resolve({})),
  getSessionNotes: jest.fn(() => Promise.resolve(null)), putSessionNotes: jest.fn(() => Promise.resolve({ body: '', updated_at: '2026-01-01T00:00:00Z' })),
  advanceScene: jest.fn(), resolveCheck: jest.fn(),
}));
jest.mock('../../lib/stream', () => ({ streamDmNarration: jest.fn() }));

import * as dnd from '@/lib/api/dnd';
import PlayPage from '@/app/play/[sessionId]/page';

const SENTENCE = 'A fight is still live. End it before moving the scene.';
const SESSION: Session = { session_id: 's1', channel: 'c', status: 'active', dm_username: 'suzu', participant_usernames: ['leon'], player_count: 1, active_combat_id: null, dm_mode: 'ai', ai_assist_level: 'full' };
const PARTY: Participant[] = [{ username: 'leon', is_dm: false, character: { character_id: 'c1', name: 'Anomaly', char_class: 'Warlock', level: 1, current_hp: 9, max_hp: 9, ac: 12 } }];
const GROUNDING: GroundingData = { scene_id: 'a', scene_name: 'The Flight', boxed_text: 'x', objective: 'y', transitions: [{ to: 'b', label: 'Press forward' }], checks: [{ skill: 'Perception', dc: 10, state: 'available' } as never], flags: {}, encounter_state: {}, encounter: null };
const refusal = () => Object.assign(new Error('409'), { status: 409, body: { success: false, data: { reason: 'combat_live', message: SENTENCE } } });

beforeEach(() => {
  jest.clearAllMocks();
  (dnd.getSession as jest.Mock).mockResolvedValue(SESSION);
  (dnd.getParticipants as jest.Mock).mockResolvedValue(PARTY);
  (dnd.getGrounding as jest.Mock).mockResolvedValue(GROUNDING);
});

it('the scene-move reason map carries the engine\'s sentence', () => {
  expect(SCENE_MOVE_REASON_COPY.combat_live).toBe(SENTENCE);
});

it('Move on refused with combat_live says so, and does not say it could not advance', async () => {
  (dnd.advanceScene as jest.Mock).mockRejectedValue(refusal());
  renderPlay(<PlayPage />);
  fireEvent.click(await screen.findByText('Press forward'));
  await waitFor(() => expect(mockToast).toHaveBeenCalledWith({ tone: 'info', message: SENTENCE }));
  expect(mockToast).not.toHaveBeenCalledWith(expect.objectContaining({ message: 'Could not advance the scene.' }));
});

it('control: any other advance failure keeps its own copy', async () => {
  (dnd.advanceScene as jest.Mock).mockRejectedValue(Object.assign(new Error('500'), { status: 500, body: {} }));
  renderPlay(<PlayPage />);
  fireEvent.click(await screen.findByText('Press forward'));
  await waitFor(() => expect(mockToast).toHaveBeenCalledWith({ tone: 'error', message: 'Could not advance the scene.' }));
});

it('a check refused with combat_live says the same sentence', async () => {
  (dnd.resolveCheck as jest.Mock).mockRejectedValue(refusal());
  renderPlay(<PlayPage />);
  fireEvent.click(await screen.findByRole('button', { name: /perception/i }));
  await waitFor(() => expect(mockToast).toHaveBeenCalledWith({ tone: 'info', message: SENTENCE }));
});
