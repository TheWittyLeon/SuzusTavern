/**
 * HUNT1020-26 -- a turn sent before the mount's history read lands must survive the mount seeding the
 * transcript. The composer is live from setState('ok'); the mount then awaits grounding, participants and the
 * paged history, and used to REPLACE the log with the history rows, wiping the live line and the streamed reply.
 * Drives the REAL /play page (the raw reader is mocked at the dnd.ts seam, as the repo's other /play suites do).
 */
import { screen, act, waitFor, fireEvent } from '@testing-library/react';
import { renderPlay } from '@/test-utils/renderPlay';
import '@testing-library/jest-dom';
import type { EngineSessionEvent, GroundingData, Participant, Session } from '@/lib/api/types';

jest.mock('next/navigation', () => ({ useParams: () => ({ sessionId: 's1' }) }));
jest.mock('../../components/Toast', () => ({ useToast: () => ({ toast: jest.fn() }) }));
jest.mock('../../lib/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 1, username: 'alice', email: null } }),
}));
jest.mock('../../lib/useReducedMotion', () => ({ useReducedMotion: () => true }));

const mockRaw = jest.fn<Promise<EngineSessionEvent[] | null>, unknown[]>();
jest.mock('../../lib/api/dnd', () => ({
  getSession: jest.fn(),
  getSessionEvents: jest.fn(() => Promise.resolve([{ event_type: 'narration', description: 'x' }])),
  getSessionEventsRaw: (...a: unknown[]) => mockRaw(...a),
  getParticipants: jest.fn(),
  getGrounding: jest.fn(() => Promise.resolve(null)),
  getCombatState: jest.fn(() => Promise.resolve(null)),
  getCharacterSheet: jest.fn(() => Promise.resolve(null)),
  postSessionEvent: jest.fn(() => Promise.resolve({})),
  combatFromScene: jest.fn(), startCombat: jest.fn(), spawnMonster: jest.fn(), rollInitiative: jest.fn(),
  monsterTurn: jest.fn(), attack: jest.fn(), dodge: jest.fn(), dash: jest.fn(), endTurn: jest.fn(),
  endCombat: jest.fn(), advanceScene: jest.fn(), setFlag: jest.fn(),
  bindCharacter: jest.fn(() => Promise.resolve({ campaign_id: 's1', username: 'alice', role: 'player', character_id: null })),
  listMyCharacters: jest.fn(() => Promise.resolve([])),
  getSessionNotes: jest.fn(() => Promise.resolve(null)),
  putSessionNotes: jest.fn(() => Promise.resolve({ body: '', updated_at: '2026-01-01T00:00:00Z' })),
}));

jest.mock('../../lib/stream', () => ({
  streamDmNarration: jest.fn(async function* () { yield { kind: 'done' as const }; }),
}));

import * as dnd from '@/lib/api/dnd';
import * as stream from '@/lib/stream';
import PlayPage from '@/app/play/[sessionId]/page';

const mGetSession = dnd.getSession as jest.MockedFunction<typeof dnd.getSession>;
const mGetGrounding = dnd.getGrounding as jest.MockedFunction<typeof dnd.getGrounding>;
const mGetParticipants = dnd.getParticipants as jest.MockedFunction<typeof dnd.getParticipants>;
const mStream = stream.streamDmNarration as jest.MockedFunction<typeof stream.streamDmNarration>;

const SESSION: Session = {
  session_id: 's1', channel: 'the_hollow_tide', status: 'active', dm_username: 'suzu',
  participant_usernames: ['alice'], player_count: 1, active_combat_id: null, dm_mode: 'ai', ai_assist_level: 'full',
};
const PARTY: Participant[] = [{ username: 'alice', is_dm: false, character: null }];
const GROUNDING = {
  scene_id: 'cave-mouth', scene_name: 'The Cave Mouth', boxed_text: 'Damp air rolls out of the darkness.',
  objective: 'Go in.', hook: 'A hook.', adventure_title: 'The Hollow Tide Cave', opening_lines: [], transitions: [], flags: {}, encounter_state: {},
} as unknown as GroundingData;

let campaign: EngineSessionEvent[] = [];
const fakeEngine = (...args: unknown[]) => {
  const since = (args[2] as number | undefined) ?? 0;
  return Promise.resolve(campaign.filter((e) => (e.seq ?? 0) > since).slice(0, 500));
};
const nar = (seq: number, text: string): EngineSessionEvent => ({ seq, kind: 'narration', actor: 'suzu', data: { text } });

const count = (t: string) => screen.queryAllByText(t).length;
async function send(text: string) {
  const input = await screen.findByRole('textbox');
  fireEvent.change(input, { target: { value: text } });
  await act(async () => { fireEvent.keyDown(input, { key: 'Enter' }); });
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  campaign = [];
  mGetSession.mockResolvedValue(SESSION);
  mGetParticipants.mockResolvedValue(PARTY);
  mGetGrounding.mockResolvedValue(null as unknown as GroundingData);
  mockRaw.mockImplementation(fakeEngine);
});
afterEach(() => jest.useRealTimers());


describe('HUNT1020-26: a turn sent while the mount still waits on grounding', () => {
  it('the live turn and its streamed reply survive the mount seeding the transcript, after the history', async () => {
    campaign = [nar(1, 'first line.'), nar(2, 'second line.')];
    let release: (g: GroundingData | null) => void = () => undefined;
    mGetGrounding.mockImplementation(() => new Promise((r) => { release = r as typeof release; }));
    mStream.mockImplementation(async function* () {
      yield { kind: 'chunk' as const, text: 'Suzu answers the quick turn.' };
      yield { kind: 'done' as const };
    });
    renderPlay(<PlayPage />);
    await act(async () => { await Promise.resolve(); });
    await send('I step forward quickly.');
    await waitFor(() => expect(count('Suzu answers the quick turn.')).toBe(1));
    expect(count('I step forward quickly.')).toBe(1);
    await act(async () => { release(GROUNDING); });
    await act(async () => { await Promise.resolve(); });
    await waitFor(() => expect(count('second line.')).toBe(1));
    expect(count('first line.')).toBe(1);
    // History first, the live turn after it.
    const order = screen.getByRole('log').textContent ?? '';
    expect(order.indexOf('second line.')).toBeLessThan(order.indexOf('I step forward quickly.'));
    expect(order.indexOf('I step forward quickly.')).toBeLessThan(order.indexOf('Suzu answers the quick turn.'));
    expect(count('I step forward quickly.')).toBe(1);
    expect(count('Suzu answers the quick turn.')).toBe(1);
  });
});
