/**
 * B8c-4 P1c (Sora's phone-mount brief 7.3) — on the REAL page: the phone's party band has a "Turn order" button in a live fight (and the desktop's rail does not, its tracker being on screen),
 * and the tracker's active row is the band's tab stop on every row. Mutation seen red: the button rendered in the rail -> the desktop case.
 */
import React from 'react';
import { configure, fireEvent, screen, waitFor } from '@testing-library/react';
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

configure({ asyncUtilTimeout: 5000 });
jest.setTimeout(30000);

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


const turnOrder = () => screen.queryByRole('button', { name: 'Turn order' });
const activeRow = () => document.querySelector('[data-region="partyStrip"] li[aria-current="true"]') as HTMLElement;

describe('the phone row: Turn order within reach', () => {
  it('a live fight: the button is there, the tracker is below it, and pressing it puts focus on the active row (the band scrolls to it)', async () => {
    await load('w1', true);
    const btn = turnOrder()!;
    expect(btn).toBeInTheDocument();
    expect(btn).toHaveAttribute('aria-expanded', 'false');
    const band = document.querySelector('[data-region="partyStrip"]') as HTMLElement;
    expect(band.querySelector(`#${btn.getAttribute('aria-controls')}`)).not.toBeNull();
    expect(activeRow()).toHaveAttribute('tabindex', '0');
    // jsdom applies no stylesheet and has no Element.scrollTo: the band's slot is a scroller by its stylesheet in the browser, so the case says so inline and stubs the scroll
    const scroller = document.querySelector<HTMLElement>('[data-region-slot="partyStrip"]')!;
    scroller.style.overflowY = 'auto';
    (scroller as HTMLElement & { scrollTo: unknown }).scrollTo = jest.fn();
    // the tracker is 120px below the band's top (no layout in jsdom: every rect is 0 unless planted)
    const tracker = document.getElementById(btn.getAttribute('aria-controls')!)!;
    jest.spyOn(tracker, 'getBoundingClientRect').mockReturnValue({ top: 120, bottom: 200, left: 0, right: 10, width: 10, height: 80, x: 0, y: 120, toJSON: () => ({}) });
    fireEvent.click(btn);
    expect(document.activeElement).toBe(activeRow());
  });
});

describe('the desktop rows: the tracker is on screen, so no button; the active row is still the tab stop', () => {
  it('no Turn order button, and the active row has tabindex 0', async () => {
    await load('w1', false);
    expect(turnOrder()).toBeNull();
    expect(activeRow()).toHaveAttribute('tabindex', '0');
  });
});
