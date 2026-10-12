import { screen, act, waitFor } from '@testing-library/react';
import { renderPlay } from '@/test-utils/renderPlay';
import '@testing-library/jest-dom';
import type { EngineSessionEvent, Participant, Session } from '@/lib/api/types';

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

const mockGetSessionEventsRaw = jest.fn<Promise<EngineSessionEvent[] | null>, unknown[]>();
// SessionRecap (mounted unconditionally by the play page) fetches this once
// at mount via its own effect — used below purely as a settle signal for
// baselining, same role play.ddx25-r3-recap-poll-churn.test.tsx uses
// mockStreamDmNarration for.
const mockGetSessionEvents = jest.fn<Promise<unknown[] | null>, unknown[]>(() =>
  Promise.resolve([]),
);

jest.mock('../../lib/api/dnd', () => ({
  getSession: jest.fn(),
  getSessionEvents: (...args: unknown[]) => mockGetSessionEvents(...args),
  getSessionEventsRaw: (...args: unknown[]) => mockGetSessionEventsRaw(...args),
  getParticipants: jest.fn(),
  getGrounding: jest.fn(() => Promise.resolve(null)),
  getCombatState: jest.fn(() => Promise.resolve(null)),
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
  endCombat: jest.fn(),
  advanceScene: jest.fn(),
  setFlag: jest.fn(),
  bindCharacter: jest.fn(() =>
    Promise.resolve({ campaign_id: 's1', username: 'alice', role: 'player', character_id: null }),
  ),
  listMyCharacters: jest.fn(() => Promise.resolve([])),
  // DDX-22 Phase 3: JournalPane mounts (drawer open / mobile tab active) and
  // GETs the caller's own note — a one-shot fetch on open, NOT a new poll (see
  // the second test below, which opens the drawer and confirms no additional
  // 4s-poll commits are introduced by it).
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
const mGetGrounding = dnd.getGrounding as jest.MockedFunction<typeof dnd.getGrounding>;
const mGetParticipants = dnd.getParticipants as jest.MockedFunction<typeof dnd.getParticipants>;

// Same object REFERENCE resolved on every call (mockResolvedValue, not a
// factory) — isolates this test to the events/journal poll: the sibling
// session-status poll's own sessionsEqual gate trivially passes on an
// identical reference, so it never contributes an extra commit here.
const SESSION: Session = {
  session_id: 's1',
  channel: 'the_hollow_tide',
  status: 'active',
  dm_username: 'suzu',
  participant_usernames: ['alice'],
  player_count: 1,
  active_combat_id: null,
  dm_mode: 'ai',
};
const PARTY: Participant[] = [{ username: 'alice', is_dm: false, character: null }];

const TOTAL = 1200; // > 200 (the engine default) and > 2 pages of 500
let campaign: EngineSessionEvent[] = [];

const fakeEngine = (...args: unknown[]) => {
  const sinceSeq = args[2] as number | undefined;
  const limit = sinceSeq === undefined ? 200 : 500;
  return Promise.resolve(
    campaign.filter((e) => (e.seq ?? 0) > (sinceSeq ?? 0)).slice(0, limit),
  );
};

beforeEach(() => {
  jest.clearAllMocks();
  campaign = Array.from({ length: TOTAL }, (_, i) => ({
    seq: i + 1,
    kind: 'narration',
    actor: 'suzu',
    data: { text: `story line ${i + 1}.` },
  }));
  mGetSession.mockResolvedValue(SESSION);
  mGetParticipants.mockResolvedValue(PARTY);
  mockGetSessionEvents.mockResolvedValue([]);
  mockGetSessionEventsRaw.mockImplementation(fakeEngine);
});



async function tick() {
  await act(async () => {
    jest.advanceTimersByTime(4000);
  });
  for (let i = 0; i < 4; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

const GROUNDING = {
  scene_id: 'cave-mouth',
  scene_name: 'The Cave Mouth',
  boxed_text: 'Damp air rolls out of the darkness.',
  objective: 'Go in.',
  hook: 'A hook.',
  adventure_title: 'The Hollow Tide Cave',
  opening_lines: [],
  transitions: [],
  flags: {},
  encounter_state: {},
} as unknown as Awaited<ReturnType<typeof dnd.getGrounding>>;

const count = (text: string) => screen.queryAllByText(text).length;

// TAV-HEAL-SHARES-MOUNT-ROW-BUILDER: the heal that finishes a cut-off mount read draws what the
// mount would have drawn, and the flag that says "unread history" lands with the watermark.
describe('TAV-HEAL-SHARES-MOUNT-ROW-BUILDER', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('a first history page that fails heals on the poll tick instead of drawing dice rows into an empty story', async () => {
    campaign = [
      { seq: 1, kind: 'narration', data: { text: 'first line.' } },
      { seq: 2, kind: 'dice_roll', actor: 'alice', data: { kind: 'skill', skill: 'stealth', modifier: 3, rolls: [14], total: 17, description: 'Stealth check' } },
      { seq: 3, kind: 'narration', data: { text: 'third line.' } },
    ];
    let calls = 0;
    mockGetSessionEventsRaw.mockImplementation((...args: unknown[]) => {
      calls += 1;
      return calls === 1 ? Promise.resolve(null) : fakeEngine(...args);
    });
    renderPlay(<PlayPage />);
    await screen.findByText('The Hollow Tide');
    expect(count('first line.')).toBe(0);
    await tick();
    await waitFor(() => expect(count('third line.')).toBe(1));
    expect(count('first line.')).toBe(1);
    expect(count('Stealth +3')).toBe(1);
    await tick();
    expect(count('third line.')).toBe(1);
  });

  it('an opening_narrated the mount never read is drawn by the heal, as the mount would draw it', async () => {
    mGetGrounding.mockResolvedValue(GROUNDING);
    campaign = [
      ...Array.from({ length: 500 }, (_, i) => ({ seq: i + 1, kind: 'narration', data: { text: `old ${i + 1}.` } })),
      { seq: 501, kind: 'opening_narrated', data: { scene_id: 'approach' } },
      { seq: 502, kind: 'narration', data: { text: 'tail line.' } },
    ];
    mockGetSessionEvents.mockResolvedValue([{ event_type: 'narration', description: 'x' }]);
    let calls = 0;
    mockGetSessionEventsRaw.mockImplementation((...args: unknown[]) => {
      calls += 1;
      return calls === 2 ? Promise.resolve(null) : fakeEngine(...args);
    });
    renderPlay(<PlayPage />);
    expect(await screen.findByText('old 500.')).toBeInTheDocument();
    await tick();
    await waitFor(() => expect(count('tail line.')).toBe(1));
    expect(screen.getByText(/The Hollow Tide Cave.*opening/i)).toBeInTheDocument();
  });

  it('a poll tick between the history read and the mount seeding the watermark does not consume the heal', async () => {
    let release: (g: typeof GROUNDING) => void = () => {};
    mGetGrounding.mockImplementation(() => new Promise((r) => { release = r; }));
    let calls = 0;
    mockGetSessionEventsRaw.mockImplementation((...args: unknown[]) => {
      calls += 1;
      return calls === 2 ? Promise.resolve(null) : fakeEngine(...args);
    });
    renderPlay(<PlayPage />);
    await act(async () => { await Promise.resolve(); });
    await tick(); // the history read is in; grounding is still pending
    await act(async () => { release(null); });
    await tick();
    await tick();
    await waitFor(() => expect(count('story line 1200.')).toBe(1));
    for (const n of [1, 500, 501, 1000]) expect(count(`story line ${n}.`)).toBe(1);
  });
});
