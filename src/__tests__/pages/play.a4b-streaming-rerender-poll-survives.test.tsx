/**
 * A4b item 3 (Miko-QA independent verification, 2026-09-28) — Kage-CR A4
 * IMPORTANT-1's own hazard, reproduced end to end on the REAL `page.tsx`
 * composition (not the synthetic `Harness` the render-independence pin
 * uses), under REAL streaming re-render pressure.
 *
 * `play.a4b-usesessionevents-handlers-render-independence.test.tsx` proves
 * the HOOK's mechanism is sound: a fresh `handlers` object literal every
 * render, wrapping hand-fabricated stable stubs, does not tear down the
 * poll's `setInterval`. That test fabricates all 26 field values itself —
 * it cannot catch a case where `page.tsx`'s REAL call site hands the hook a
 * field that ISN'T actually stable (a non-memoised callback, a value
 * recomputed every render). This test closes that gap by driving the whole
 * page through a real DM-STREAM-paced narration turn — the exact scenario
 * Kage's IMPORTANT-1 named ("every chunk sets talking/thinking/log") — and
 * checking the poll's own observable effect (a `getSessionEventsRaw` call
 * beyond the one-time mount-rehydration call) survives it, rather than
 * trusting that stable-by-construction stubs are representative of the
 * real hooks.
 *
 * Root-cause note on this test's own first draft: `getSessionEventsRaw` is
 * ALSO called once at mount, outside the poll entirely (`page.tsx`'s
 * rehydration effect, `:565`) — a first version of this test asserted only
 * `>= 1` total call and passed even under the IMPORTANT-1 mutant, because
 * that one mount-time call satisfied it regardless of whether the PERIODIC
 * poll ever fired again. Caught by an explicit debug probe (setInterval was
 * churning: 20+ create/clear pairs, all delay=4000) before trusting the
 * green run. Fixed by capturing the call count right after mount settles
 * (before the streaming burst) and asserting it INCREASES during the burst
 * — a claim only the periodic poll, not the one-shot rehydration, can
 * satisfy.
 *
 * Each of 20 chunks is delivered as its own, separately-awaited async-
 * generator resumption (a genuinely separate JS continuation, not a batch
 * of synchronous state updates inside one `act()`), exactly like real SSE
 * chunks arriving over the network one at a time — so each one drives its
 * own React commit and its own re-run of every effect whose deps changed
 * identity. 200ms of fake time separates each chunk (20 * 200ms = 4000ms,
 * matching `POLL_INTERVAL_MS`), so by the last chunk the poll's 4s countdown
 * would have elapsed under undisturbed code, but would have been reset on
 * every one of the 20 re-renders under a churning-interval regression.
 *
 * Mutation-verified (applied and reverted): re-adding `handlers` to
 * `useSessionEvents`'s effect deps array (Kage IMPORTANT-1's own near-miss,
 * re-closed structurally at A4b) reds this test — `getSessionEventsRaw`'s
 * call count never exceeds the one mount-time rehydration call across the
 * whole streaming burst, matching the production symptom (no cross-client
 * dice rolls / x-card convergence / resume while Suzu is talking).
 *
 * `useToast` is mocked with a STABLE, module-level `toast` reference
 * (matching the codebase's own established pattern, e.g.
 * `adv6-play-edge.test.tsx`'s `mockToast`) rather than
 * `() => ({ toast: jest.fn() })` — an inline mock allocates a NEW jest.fn()
 * on every render, which breaks `applyOfferedCheckSignal`'s own real
 * `[toast]` dependency and manufactures exactly the churn this test is
 * trying to detect, as a pure test-harness artifact rather than a real
 * regression. Caught by an explicit per-render dependency-identity diff
 * probe on the real hook body (temporary, not shipped) before trusting a
 * red run as a real finding — the diff isolated the change to
 * `applyOfferedCheckSignal` on 26/27 renders, and `toast`'s instability
 * traced directly to this file's own first-draft mock, not to
 * `useSceneState.ts` or `Toast.tsx` (both confirmed `[]`-stable by
 * inspection).
 */
import React from 'react';
import { render, screen, act, fireEvent } from '@testing-library/react';
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
  useAuth: () => ({ user: { id: 1, username: 'leon', email: null } }),
}));

// Flag OFF — the LIVE prod path (src/lib/config.ts:63), same convention as
// the seq-ordering-fault-injection.flag-off pin.
jest.mock('../../lib/config', () => ({
  DURABLE_GENERATION_ENABLED: false,
  OAUTH_ENABLED: false,
  CODEX_ENABLED: false,
}));

jest.mock('../../lib/useReducedMotion', () => ({
  useReducedMotion: () => true,
}));

const mockGetSessionEventsRaw = jest.fn(() => Promise.resolve([]));

jest.mock('../../lib/api/dnd', () => ({
  getSession: jest.fn(),
  getSessionEvents: jest.fn(() => Promise.resolve([])),
  getSessionEventsRaw: (...args: unknown[]) =>
    (mockGetSessionEventsRaw as unknown as (...a: unknown[]) => Promise<unknown[]>)(...args),
  getSessionEventsPage: jest.fn(() =>
    Promise.resolve({ events: [], max_seq: 0, has_more: false, pending_generation: null }),
  ),
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
  resolveCheck: jest.fn(),
  getSessionNotes: jest.fn(() => Promise.resolve(null)),
  putSessionNotes: jest.fn(() =>
    Promise.resolve({ body: '', updated_at: '2026-01-01T00:00:00Z' }),
  ),
}));

let releaseNextChunk: (() => void) | null = null;
let nextChunkGate: Promise<void> = Promise.resolve();
function armGate() {
  nextChunkGate = new Promise((resolve) => {
    releaseNextChunk = resolve;
  });
}

jest.mock('../../lib/stream', () => ({
  streamDmNarration: jest.fn(async function* () {
    for (let i = 1; i <= 20; i++) {
      armGate();
       
      await nextChunkGate;
      yield { kind: 'chunk' as const, text: `beat token ${i} `.repeat(i), streamMode: true };
    }
    yield { kind: 'done' as const };
  }),
  postDmTurn: jest.fn(),
  subscribeDmJob: jest.fn(async function* () {}),
}));

import * as dnd from '@/lib/api/dnd';
import PlayPage from '@/app/play/[sessionId]/page';

const mGetSession = dnd.getSession as jest.MockedFunction<typeof dnd.getSession>;
const mGetParticipants = dnd.getParticipants as jest.MockedFunction<typeof dnd.getParticipants>;

const SESSION: Session = {
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

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  window.localStorage.clear();
  mGetSession.mockResolvedValue(SESSION);
  mGetParticipants.mockResolvedValue(PARTY);
  mockGetSessionEventsRaw.mockResolvedValue([]);
});

afterEach(() => {
  jest.useRealTimers();
});

describe('A4b item 3 — the events poll survives real streaming re-render pressure', () => {
  it('a fresh getSessionEventsRaw call lands mid-stream, beyond the one-time mount rehydration call, despite 20 separate chunk-driven re-renders landing faster than the poll interval', async () => {
    render(<PlayPage />);
    await screen.findByText('Test Table');

    // Baseline AFTER mount settles (the rehydration effect's own one-shot
    // getSessionEventsRaw call has already landed) but BEFORE the streaming
    // burst — isolates the claim to the PERIODIC poll, not the mount fetch.
    const baseline = mockGetSessionEventsRaw.mock.calls.length;
    expect(baseline).toBeGreaterThanOrEqual(1);

    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'I step into the clearing.' } });
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' });
    });
    // Settle the synchronous part of narrate() up to the generator's first
    // gate (beginTurn() has already fired: talking=true, thinking=true).
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // 20 separately-awaited chunk arrivals, 200ms of fake time apart. Each
    // one is its own for-await resumption (its own JS continuation, exactly
    // like a real SSE frame arriving over the network) -> its own setState
    // calls (upsertStreamNarration, firstChunkArrived on the first) -> its
    // own React commit -> its own re-run of every effect whose deps
    // changed identity. Cumulative elapsed time reaches 4000ms exactly at
    // the last chunk, matching POLL_INTERVAL_MS.
    for (let i = 0; i < 20; i++) {
      await act(async () => {
        releaseNextChunk?.();
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });
      await act(async () => {
        jest.advanceTimersByTime(200);
      });
    }

    // A little more real time past the 4000ms mark to give the (undisturbed)
    // poll interval room to actually fire and resolve its promise.
    await act(async () => {
      jest.advanceTimersByTime(200);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // THE ASSERTION UNDER TEST — the PERIODIC poll fired at least once
    // beyond the mount-time rehydration call, mid-stream. Under the
    // IMPORTANT-1 regression (handlers back in the deps array) this stays
    // at `baseline`: the interval is torn down and recreated on every one
    // of the 20 chunk-driven re-renders, so it never accumulates 4000ms of
    // undisturbed time and never fires again after mount.
    expect(mockGetSessionEventsRaw.mock.calls.length).toBeGreaterThan(baseline);
  });
});

