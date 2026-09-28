/**
 * STRUCT-006 (2026-07-24) — flag-OFF / SSE mirror.
 *
 * On the flag-OFF path (`DURABLE_GENERATION_ENABLED=false`) the client polls
 * `getSessionEventsRaw` instead of the durable `getSessionEventsPage`. The beat
 * classifier still runs post-delivery (narration.py background thread +
 * buffered) and writes `beat_resolved`, so a classifier-opened gate has the
 * same "invisible until reload" gap here. This pins that the flag-OFF poll
 * branch re-fetches grounding on a beat-ledger event, mirroring the durable
 * path (page.tsx flag-OFF branch of `poll`).
 *
 * The durable (prod) path is pinned in play.struct006-gate-refetch.test.tsx.
 */
import React from 'react';
import { render, screen, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import type {
  EngineSessionEvent,
  GroundingData,
  Participant,
  SceneCheck,
  Session,
} from '@/lib/api/types';

jest.mock('next/navigation', () => ({
  useParams: () => ({ sessionId: 's1' }),
}));

jest.mock('../../components/Toast', () => ({
  useToast: () => ({ toast: jest.fn() }),
}));

jest.mock('../../lib/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 1, username: 'leon', email: null } }),
}));

jest.mock('../../lib/useReducedMotion', () => ({
  useReducedMotion: () => true,
}));

// Flag OFF for this whole file (the SSE / legacy poll path).
jest.mock('../../lib/config', () => ({
  DURABLE_GENERATION_ENABLED: false,
  OAUTH_ENABLED: false,
  CODEX_ENABLED: false,
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFn = (...args: any[]) => any;

const mockGetSession = jest.fn<Promise<unknown>, unknown[]>();
const mockGetSessionEvents = jest.fn<Promise<unknown[]>, unknown[]>(() => Promise.resolve([]));
const mockGetSessionEventsRaw = jest.fn<Promise<EngineSessionEvent[] | null>, unknown[]>(() =>
  Promise.resolve([]),
);
const mockGetParticipants = jest.fn<Promise<Participant[]>, unknown[]>(() => Promise.resolve([]));
const mockGetGrounding = jest.fn<Promise<unknown>, unknown[]>(() => Promise.resolve(null));
const mockGetCombatState = jest.fn<Promise<unknown>, unknown[]>(() => Promise.resolve(null));
const mockGetCharacterSheet = jest.fn<Promise<unknown>, unknown[]>(() => Promise.resolve(null));

jest.mock('../../lib/api/dnd', () => ({
  getSession: (...args: Parameters<AnyFn>) => mockGetSession(...args),
  getSessionEvents: (...args: Parameters<AnyFn>) => mockGetSessionEvents(...args),
  getSessionEventsRaw: (...args: Parameters<AnyFn>) => mockGetSessionEventsRaw(...args),
  getSessionEventsPage: jest.fn(() =>
    Promise.resolve({ events: [], max_seq: 0, has_more: false, pending_generation: null }),
  ),
  getParticipants: (...args: Parameters<AnyFn>) => mockGetParticipants(...args),
  getGrounding: (...args: Parameters<AnyFn>) => mockGetGrounding(...args),
  getCombatState: (...args: Parameters<AnyFn>) => mockGetCombatState(...args),
  getCharacterSheet: (...args: Parameters<AnyFn>) => mockGetCharacterSheet(...args),
  postSessionEvent: jest.fn(() => Promise.resolve({})),
  postRoll: jest.fn(),
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
  resolveCheck: jest.fn(),
  getSessionNotes: jest.fn(() => Promise.resolve(null)),
  putSessionNotes: jest.fn(() => Promise.resolve({ body: '', updated_at: '2026-01-01T00:00:00Z' })),
}));

jest.mock('../../lib/stream', () => ({
  streamDmNarration: jest.fn(),
  postDmTurn: jest.fn(),
  subscribeDmJob: jest.fn(),
}));

import PlayPage from '@/app/play/[sessionId]/page';

const AI_SESSION: Session = {
  session_id: 's1',
  channel: 'test_channel',
  name: 'Test Table',
  status: 'active',
  dm_username: 'suzu',
  dm_mode: 'ai',
  ai_assist_level: 'full',
  active_combat_id: null,
};

const PARTY: Participant[] = [{ username: 'leon', is_dm: false, character: null }];

function beatResolved(seq: number): EngineSessionEvent {
  return {
    seq,
    kind: 'beat_resolved',
    actor: 'leon',
    visibility: 'table',
    created_at: '2026-07-24T10:00:00Z',
    data: { scene: 'anchor_first_contact', beat: 'first_impression', source: 'classifier' },
  };
}

// Check Retry + Fail-Forward (2026-07-28 design §7.4/item 25): the SAME
// generalized re-fetch mechanism, exercised for check_resolved on the
// flag-OFF/SSE poll branch (page.tsx ~L1979).
function checkResolved(seq: number): EngineSessionEvent {
  return {
    seq,
    kind: 'check_resolved',
    actor: 'leon',
    visibility: 'table',
    created_at: '2026-07-24T10:00:00Z',
    data: { skill: 'survival', dc: 13, total: 15, success: true, flag_set: 'beat_a' },
  };
}

// Tora-Gesture CRITICAL-1 focus-rescue pin below reuses this file's own
// dm_username/party wiring, so it needs a real grounding shape (checks are
// keyed by skill/dc, matching Offers.tsx's own read).
function grounding(checks: SceneCheck[]): GroundingData {
  return {
    scene_id: 'scene_a',
    scene_name: 'Scene A',
    boxed_text: 'The wood presses close.',
    objective: 'Find a way through.',
    transitions: [],
    checks,
    flags: {},
    encounter_state: {},
  };
}

async function tick() {
  await act(async () => {
    jest.advanceTimersByTime(4000);
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  window.localStorage.clear();
  mockGetSession.mockResolvedValue(AI_SESSION);
  mockGetSessionEvents.mockResolvedValue([]);
  mockGetSessionEventsRaw.mockResolvedValue([]); // rehydration + first poll: empty
  mockGetParticipants.mockResolvedValue(PARTY);
  mockGetGrounding.mockResolvedValue({ checks: [], transitions: [] });
  mockGetCombatState.mockResolvedValue(null);
  mockGetCharacterSheet.mockResolvedValue(null);
});

describe('STRUCT-006 flag-OFF poll — beat_resolved re-fetches grounding', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('a poll carrying a beat_resolved event triggers a grounding re-fetch', async () => {
    render(<PlayPage />);
    await screen.findByText('Test Table');
    await act(async () => {
      jest.advanceTimersByTime(200);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const baseline = mockGetGrounding.mock.calls.length;

    // The classifier resolves a beat post-delivery; the next legacy poll sees it.
    mockGetSessionEventsRaw.mockResolvedValue([beatResolved(5)]);
    await tick();

    expect(mockGetGrounding.mock.calls.length).toBe(baseline + 1);
  });

  it('a poll carrying a check_resolved event triggers a grounding re-fetch', async () => {
    render(<PlayPage />);
    await screen.findByText('Test Table');
    await act(async () => {
      jest.advanceTimersByTime(200);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const baseline = mockGetGrounding.mock.calls.length;

    mockGetSessionEventsRaw.mockResolvedValue([checkResolved(5)]);
    await tick();

    expect(mockGetGrounding.mock.calls.length).toBe(baseline + 1);
  });
});

/**
 * Kage-CR A4 IMPORTANT-2 (2026-09-28) — the Tora-Gesture CRITICAL-1 focus
 * rescue (capture focus synchronously before `setGrounding`, refocus the
 * scene head after) is written twice in `useSessionEvents.ts`: once on the
 * durable branch (`:474-478`, pinned by play.check-retry.tora-focus-
 * strand.test.tsx, which forces `DURABLE_GENERATION_ENABLED: true`) and once
 * on THIS file's flag-OFF/live branch (`:730-734`) — the copy that actually
 * runs in prod (`src/lib/config.ts:63` ships `false`). Deleting the flag-OFF
 * copy was all-green before this pin (M-C, Kage's mutation). Ported from
 * play.check-retry.tora-focus-strand.test.tsx:189-261 verbatim in shape,
 * onto THIS file's flag-OFF harness (`getSessionEventsRaw`, not
 * `getSessionEventsPage`) rather than a fresh one, per Kage's own routing.
 */
describe('Tora-Gesture CRITICAL-1 — poll-driven check removal rescues focus (flag-OFF)', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('focus is not silently stranded on <body> when a background poll resolves the focused check', async () => {
    mockGetGrounding.mockResolvedValue(grounding([{ skill: 'survival', dc: 13 }]));
    const { container } = render(<PlayPage />);
    await screen.findByText('Test Table');
    await act(async () => {
      jest.advanceTimersByTime(200);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const btn = await screen.findByRole('button', { name: /Attempt Survival/i });
    act(() => btn.focus());
    expect(btn).toHaveFocus();

    // Someone else at the table resolved it; nobody on THIS client clicked
    // anything, so the removal is entirely poll-driven.
    mockGetGrounding.mockResolvedValue(
      grounding([
        {
          skill: 'survival',
          dc: 13,
          state: 'resolved',
          attempts_used: null,
          max_attempts: null,
          lock_reason: 'resolved',
        },
      ]),
    );
    mockGetSessionEventsRaw.mockResolvedValue([checkResolved(7)]);

    await tick();
    // refocusSceneHeadIfStranded's rescue runs inside a requestAnimationFrame
    // (deliberate — lets React's commit land first); one more small advance
    // settles jest's fake-timer rAF queue, mirroring the durable pin's own
    // extra tick.
    await act(async () => {
      jest.advanceTimersByTime(20);
    });

    // Confirms the poll DID land and DID remove the button (i.e. this isn't
    // a test-setup failure) before asserting on where focus ended up.
    expect(screen.queryByRole('button', { name: /Attempt Survival/i })).not.toBeInTheDocument();

    const sceneHead = container.querySelector('[aria-label^="Scene:"]');
    expect(sceneHead).not.toBeNull();

    // THE ASSERTION UNDER TEST: focus lands on the scene head, not stranded
    // on <body> — the flag-OFF mirror of tora-focus-strand's durable pin.
    expect(document.activeElement).toBe(sceneHead);
  });
});
