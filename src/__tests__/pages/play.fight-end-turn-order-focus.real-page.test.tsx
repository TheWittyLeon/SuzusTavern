/**
 * B8c-4 fix round 3 (Kage R2-2; his probe, kept under a behaviour name) — on the REAL page: a fight that ends while focus is on the phone's Turn order button leaves focus on the composer (the page's
 * fight-end rescue), never on <body>. The button is rendered only while the tracker is shown, so it unmounts in the same commit as the tracker and the rescue sees it.
 */
import React from 'react';
import { configure, screen, waitFor } from '@testing-library/react';
import { renderPlay } from '@/test-utils/renderPlay';
import '@testing-library/jest-dom';
import type { CombatState, GroundingData, Participant, Session } from '@/lib/api/types';

jest.mock('next/navigation', () => ({ useParams: () => ({ sessionId: 's1' }) }));
jest.mock('../../components/Toast', () => ({ useToast: () => ({ toast: jest.fn() }) }));
jest.mock('../../lib/auth/AuthProvider', () => ({ useAuth: () => ({ user: { id: 1, username: 'leon', email: null } }) }));
jest.mock('../../lib/useReducedMotion', () => ({ useReducedMotion: () => true }));
jest.mock('../../lib/api/dnd', () => ({
  getSession: jest.fn(),
  getSessionEvents: jest.fn(() => Promise.resolve([])),
  getSessionEventsRaw: jest.fn(() => Promise.resolve(null)),
  getParticipants: jest.fn(),
  getGrounding: jest.fn(),
  getCombatState: jest.fn(() => Promise.resolve(null)),
  getCharacterSheet: jest.fn(() => Promise.resolve(null)),
  getCatalog: jest.fn(() => Promise.resolve({ items: [] })),
  postSessionEvent: jest.fn(() => Promise.resolve({})),
  listMyCharacters: jest.fn(() => Promise.resolve([])),
  getSessionNotes: jest.fn(() => Promise.resolve(null)),
  putSessionNotes: jest.fn(() => Promise.resolve({ body: '', updated_at: '2026-01-01T00:00:00Z' })),
  dodge: jest.fn(),
}));
jest.mock('../../lib/stream', () => ({ streamDmNarration: jest.fn(async function* () { yield { kind: 'done' }; }) }));

import * as dnd from '@/lib/api/dnd';
import PlayPage from '@/app/play/[sessionId]/page';

const SESSION: Session = { session_id: 's1', channel: 'c', name: 'Test Table', status: 'active', dm_username: 'suzu', participant_usernames: ['leon'], player_count: 1, active_combat_id: 'combat-flight', dm_mode: 'ai', ai_assist_level: 'off' };
const PARTY: Participant[] = [{ username: 'leon', is_dm: false, character: { character_id: 'c1', name: 'Anomaly', char_class: 'Ranger', level: 1, current_hp: 10, max_hp: 10, ac: 13 } }];
const GROUNDING: GroundingData = { scene_id: 'e', scene_name: 'Flight', boxed_text: 'x', transitions: [], checks: [], flags: {}, encounter_state: {}, encounter: { kind: 'combat', trigger: 'manual' } };
const fight = (turn: 'p1' | 'w1'): CombatState => ({
  combat_id: 'combat-flight', session_id: 's1', round: 1, state: 'active', turn_index: 0, active_participant_id: turn, initiative: ['p1', 'w1'],
  participants: [
    { participant_id: 'p1', entity_id: 'c1', name: 'Anomaly', is_pc: true, initiative: 15, hp_current: 10, hp_max: 10, ac: 13, conditions: [], is_alive: true, can_be_targeted: false, is_active_turn: turn === 'p1', took_turn: false },
    { participant_id: 'w1', entity_id: 'g1', name: 'Timberwolf', is_pc: false, initiative: 9, hp_current: 19, hp_max: 19, ac: 13, conditions: [], is_alive: true, can_be_targeted: true, is_active_turn: turn === 'w1', took_turn: false },
  ],
}) as unknown as CombatState;

configure({ asyncUtilTimeout: 12000 });
jest.setTimeout(60000);

const real = window.matchMedia;
afterEach(() => { window.matchMedia = real; });
beforeEach(() => {
  jest.clearAllMocks();
  window.localStorage.clear();
  (dnd.getParticipants as jest.Mock).mockResolvedValue(PARTY);
  (dnd.getGrounding as jest.Mock).mockResolvedValue(GROUNDING);
  (dnd.getSession as jest.Mock).mockResolvedValue(SESSION);
});

async function load(turn: 'p1' | 'w1', phone: boolean) {
  const { PLAY_PHONE_QUERY } = jest.requireActual('../../lib/breakpoints') as { PLAY_PHONE_QUERY: string };
  window.matchMedia = jest.fn().mockImplementation((query: string) => ({ matches: phone && query === PLAY_PHONE_QUERY, media: query, onchange: null, addEventListener: jest.fn(), removeEventListener: jest.fn(), dispatchEvent: jest.fn() }));
  (dnd.getCombatState as jest.Mock).mockResolvedValue(fight(turn));
  renderPlay(<PlayPage />);
  await screen.findByText('Test Table');
  await screen.findByText(/In combat · use the action bar/);
  await waitFor(() => expect(document.querySelector('[data-tenant="turnStatus"]')?.textContent).toBeTruthy());
}



const btn = () => document.querySelector('button[data-turn-order]') as HTMLElement | null;
it('the fight ends while focus is on the Turn order button (phone): focus is not on <body>', async () => {
  await load('w1', true);
  expect(btn()).not.toBeNull();
  btn()!.focus();
  expect(document.activeElement).toBe(btn());
  (dnd.getCombatState as jest.Mock).mockResolvedValue({ ...fight('w1'), state: 'ended' });
  await waitFor(() => expect(btn()).toBeNull());
  await new Promise((r) => setTimeout(r, 300));
  expect(document.activeElement).not.toBe(document.body);
});
