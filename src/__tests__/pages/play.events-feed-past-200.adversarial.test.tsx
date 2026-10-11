/**
 * TAV-EVENTS-FEED-FROZEN-PAST-200, break-it companion to play.events-feed-past-200.test.tsx.
 *
 * The finding named three losses past 200 events: dice rows, safety (X-card) signals and the
 * journal / scene refresh. The first suite proved the safety row and the journal; this one proves
 * the other kinds each arrive past the cap too, then attacks the poll: a proxy that ignores
 * `since_seq`, a page that fails mid-read, a mount that only half-reads the history.
 * Harness copied from the first suite (same fakeEngine contract).
 */
import { screen, act, fireEvent, waitFor } from '@testing-library/react';
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
  await act(async () => {
    await Promise.resolve();
  });
  await act(async () => {
    await Promise.resolve();
  });
}

// +1 on any page holding at least one x_card: the signal is also announced once outside the transcript.
const ANNOUNCED_ONCE = 1;
const safetyRows = () => screen.queryAllByText(/A safety signal was raised/).length;

describe('TAV-EVENTS-FEED-FROZEN-PAST-200: every named loss arrives past the cap', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('a dice roll written past event 1,200 becomes a roll row', async () => {
    renderPlay(<PlayPage />);
    expect(await screen.findByText('story line 1200.')).toBeInTheDocument();
    expect(screen.queryByText('Stealth +3')).not.toBeInTheDocument();

    campaign.push({
      seq: TOTAL + 1, kind: 'dice_roll', actor: 'alice',
      data: { kind: 'skill', skill: 'stealth', modifier: 3, rolls: [14], total: 17, description: 'Stealth check' },
    });
    await tick();

    expect(screen.getByText('Stealth +3')).toBeInTheDocument();
  });

  it('a beat_resolved written past the cap re-fetches grounding (the scene refresh)', async () => {
    renderPlay(<PlayPage />);
    expect(await screen.findByText('story line 1200.')).toBeInTheDocument();
    const before = mGetGrounding.mock.calls.length;

    campaign.push({ seq: TOTAL + 1, kind: 'beat_resolved', actor: 'suzu', data: {} });
    await tick();

    expect(mGetGrounding.mock.calls.length).toBe(before + 1);
  });

  it('a recap written past the cap reaches the journal', async () => {
    renderPlay(<PlayPage />);
    expect(await screen.findByText('story line 1200.')).toBeInTheDocument();

    campaign.push({ seq: TOTAL + 1, kind: 'recap', data: { text: 'Later, the tide fell.', who: 'Suzu' } });
    await tick();

    const toggle = screen.getByRole('button', { name: 'Open journal' });
    toggle.focus();
    fireEvent.click(toggle);
    expect(await screen.findByText(/Later, the tide fell\./)).toBeInTheDocument();
  });
});

describe('TAV-EVENTS-FEED-FROZEN-PAST-200: break-it', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('a proxy that ignores since_seq and limit (the pre-be4db8a wire) never doubles a row', async () => {
    campaign = [
      { seq: 1, kind: 'narration', data: { text: 'opening.' } },
      { seq: 2, kind: 'x_card', data: {} },
      { seq: 3, kind: 'x_card', data: {} },
    ];
    // Always the whole (short) log, whatever the caller asked for.
    mockGetSessionEventsRaw.mockImplementation(() => Promise.resolve(campaign.slice()));
    renderPlay(<PlayPage />);
    expect(await screen.findByText('opening.')).toBeInTheDocument();
    const mounted = safetyRows();
    expect(mounted).toBe(2 + ANNOUNCED_ONCE);

    await tick();
    await tick();
    await tick();

    expect(safetyRows()).toBe(mounted);
  });

  it('a campaign larger than one page, against a wire that ignores since_seq, draws each row once with no duplicate-key error', async () => {
    campaign = Array.from({ length: 600 }, (_, i) => ({ seq: i + 1, kind: 'narration', data: { text: `w${i + 1}.` } }));
    // Always the same full page (the oldest 500), whatever the caller asked for.
    mockGetSessionEventsRaw.mockImplementation(() => Promise.resolve(campaign.slice(0, 500)));
    const errors = jest.spyOn(console, 'error').mockImplementation(() => {});
    renderPlay(<PlayPage />);
    expect(await screen.findByText('w500.')).toBeInTheDocument();
    await tick();
    for (const n of [1, 250, 500]) expect(screen.queryAllByText(`w${n}.`)).toHaveLength(1);
    expect(screen.getAllByText(/^w\d+\.$/)).toHaveLength(500);
    const duplicateKey = errors.mock.calls.filter((c) => /same key|unique "key"/.test(String(c[0])));
    errors.mockRestore();
    expect(duplicateKey).toHaveLength(0);
  });

  it('a later page that fails during a poll does not lose or double the rows, and the next tick finishes the job', async () => {
    campaign = Array.from({ length: 10 }, (_, i) => ({ seq: i + 1, kind: 'narration', data: { text: `s${i + 1}.` } }));
    renderPlay(<PlayPage />);
    expect(await screen.findByText('s10.')).toBeInTheDocument();
    expect(safetyRows()).toBe(0);

    // 700 safety rows land at once: the poll needs two pages (500 + 200).
    for (let i = 0; i < 700; i += 1) campaign.push({ seq: 11 + i, kind: 'x_card', data: {} });
    let fail = true;
    mockGetSessionEventsRaw.mockImplementation((...args: unknown[]) => {
      const since = args[2] as number;
      if (fail && since > 10) { fail = false; return Promise.resolve(null); } // page 2 fails once
      return fakeEngine(...args);
    });
    await tick();
    expect(safetyRows()).toBe(500 + ANNOUNCED_ONCE); // the contiguous prefix, no hole
    await tick();
    expect(safetyRows()).toBe(700 + ANNOUNCED_ONCE); // resumed from the prefix: nothing lost, nothing doubled
  });

  it('exactly 500 and exactly 1,000 events at mount are rebuilt whole (no off-by-one on the page boundary)', async () => {
    for (const total of [500, 1000]) {
      campaign = Array.from({ length: total }, (_, i) => ({ seq: i + 1, kind: 'narration', data: { text: `n${total}-${i + 1}.` } }));
      const { unmount } = renderPlay(<PlayPage />);
      expect(await screen.findByText(`n${total}-${total}.`)).toBeInTheDocument();
      expect(screen.getByText(`n${total}-1.`)).toBeInTheDocument();
      unmount();
    }
  });

  // The mount keeps the pages it read when a later page fails and seeds the watermark from them.
  // The poll normally renders ONLY dice_roll / x_card (POLL_RENDERED_KINDS), so the unread tail's
  // narration would never be drawn; while the mount's read was partial the poll draws every kind
  // until a read reaches the end. Needs a mount whose second page fails once.
  it('a mount whose second history page fails still shows the narration of the rows it never read', async () => {
    let calls = 0;
    mockGetSessionEventsRaw.mockImplementation((...args: unknown[]) => {
      calls += 1;
      if (calls === 2) return Promise.resolve(null); // page 2 of the mount read
      return fakeEngine(...args);
    });
    renderPlay(<PlayPage />);
    expect(await screen.findByText('story line 500.')).toBeInTheDocument();
    await tick();
    await tick();
    await waitFor(() => expect(screen.getByText('story line 1200.')).toBeInTheDocument());
  });

  const lineCount = (text: string) => screen.queryAllByText(text).length;

  it('a healed mount shows the whole story once, in order', async () => {
    let calls = 0;
    mockGetSessionEventsRaw.mockImplementation((...args: unknown[]) => {
      calls += 1;
      if (calls === 2) return Promise.resolve(null);
      return fakeEngine(...args);
    });
    renderPlay(<PlayPage />);
    expect(await screen.findByText('story line 500.')).toBeInTheDocument();
    await tick();
    await tick();
    await waitFor(() => expect(screen.getByText('story line 1200.')).toBeInTheDocument());
    for (const n of [1, 500, 501, 1000, 1200]) expect(lineCount(`story line ${n}.`)).toBe(1);
    const shown = screen
      .getAllByText(/^story line \d+\.$/)
      .map((el) => Number(/\d+/.exec(el.textContent ?? '')![0]));
    expect(shown).toHaveLength(1200);
    expect(shown).toEqual([...shown].sort((a, b) => a - b));
  });

  it('while the server keeps failing the heal retries once per poll tick, then stops asking once healed', async () => {
    let fail = true;
    mockGetSessionEventsRaw.mockImplementation((...args: unknown[]) => {
      const since = args[2] as number;
      if (since > 0 && fail) return Promise.resolve(null);
      return fakeEngine(...args);
    });
    renderPlay(<PlayPage />);
    expect(await screen.findByText('story line 500.')).toBeInTheDocument();
    const afterMount = mockGetSessionEventsRaw.mock.calls.length;
    await tick();
    await tick();
    expect(mockGetSessionEventsRaw.mock.calls.length).toBe(afterMount + 2); // one request per tick
    expect(screen.queryByText('story line 501.')).not.toBeInTheDocument();
    fail = false;
    await tick();
    await waitFor(() => expect(screen.getByText('story line 1200.')).toBeInTheDocument());
    const healed = mockGetSessionEventsRaw.mock.calls.length;
    campaign.push({ seq: TOTAL + 1, kind: 'narration', actor: 'suzu', data: { text: 'live line.' } });
    await tick();
    // healed: a live narration row is the composer's to draw, not the poll's
    expect(screen.queryByText('live line.')).not.toBeInTheDocument();
    expect(mockGetSessionEventsRaw.mock.calls.length).toBe(healed + 1);
  });
});
