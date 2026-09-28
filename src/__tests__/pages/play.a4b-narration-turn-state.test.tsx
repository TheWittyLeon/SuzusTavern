/**
 * A4b item 4 (Kage-CR A4 IMPORTANT-3, 2026-09-28) — `useNarration`'s
 * `talking`/`thinking` pair.
 *
 * Enumerated against every call site in the file (not assumed): the pair
 * only ever reaches THREE of its four possible combinations —
 * `(true, true)` on turn start, `(talking=true, thinking=false)` once the
 * first chunk of a response is visible, and `(false, false)` once the turn
 * settles. `(false, true)` — thinking with no talking — is never reachable.
 * Miko-QA's own mutation proof showed swapping `setThinking`/`setTalking` at
 * a call site was a PROVABLE no-op given the old code, which is exactly
 * that smell.
 *
 * This is a hook-level pin (not a page-render one) because React batches the
 * two `setState` calls inside one synchronous callback into a single
 * render, so a page-level DOM assertion can only ever observe the states
 * AFTER a transition completes, never catch one transition setting only
 * half the pair. Driving `useNarration` directly through a real durable-beat
 * lifecycle (begin -> first chunk -> settle) via a gated `subscribeDmJob`
 * generator lets this test assert the exact (talking, thinking) tuple at
 * each of the three reachable checkpoints, and explicitly reject the
 * unreachable fourth.
 *
 * `narrateDurableBeat`/`subscribeToJob` never read `sceneState` (only
 * `narrate()`'s SSE path does, for the scene-advance branch), so the fake
 * below is a type-satisfying no-op stub, not a full behavioural fake —
 * `useTranscript()` is the REAL hook (self-contained, no params) since
 * `subscribeToJob` does touch transcript state (`pendingByKeyRef`,
 * `streamRowIdRef`, `clearStreamNarration`).
 */
import React from 'react';
import { renderHook, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { Session } from '@/lib/api/types';

jest.mock('../../lib/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 1, username: 'leon', email: null } }),
}));

const mockToast = jest.fn();
jest.mock('../../components/Toast', () => ({
  useToast: () => ({ toast: mockToast }),
}));

jest.mock('../../lib/useReducedMotion', () => ({
  useReducedMotion: () => true,
}));

const mockPostDmTurn = jest.fn();
const mockSubscribeDmJob = jest.fn();
jest.mock('../../lib/stream', () => ({
  streamDmNarration: jest.fn(),
  postDmTurn: (...args: unknown[]) => mockPostDmTurn(...args),
  subscribeDmJob: (...args: unknown[]) => mockSubscribeDmJob(...args),
}));

import { useNarration } from '@/app/play/[sessionId]/hooks/useNarration';
import { useTranscript } from '@/app/play/[sessionId]/hooks/useTranscript';
import type { UseSceneStateResult } from '@/app/play/[sessionId]/hooks/useSceneState';

function makeFakeSceneState(): UseSceneStateResult {
  return {
    grounding: null,
    setGrounding: jest.fn(),
    sceneAdvanceBusy: false,
    adventureComplete: false,
    completionSeries: null,
    checkBusy: false,
    offeredCheckSkill: null,
    setOfferedCheckSkill: jest.fn(),
    freeformOfferedCheck: null,
    setFreeformOfferedCheck: jest.fn(),
    sceneHeadRef: { current: null },
    checkWrapRef: { current: null },
    transitionWrapRef: { current: null },
    freeformCheckRef: { current: null },
    sceneHasEncounter: false,
    availableTransitions: [],
    availableChecks: [],
    diffAndExplainResolvedChecks: jest.fn(),
    refreshGrounding: jest.fn(() => Promise.resolve(null)),
    playArrivalLine: jest.fn(() => false),
    playRescueTransitionLine: jest.fn(() => false),
    playOutcomeLine: jest.fn(() => false),
    refocusSceneHeadIfStranded: jest.fn(),
    onGroundingInvalidated: jest.fn(),
    applyOfferedCheckSignal: jest.fn(),
    openScene: jest.fn(() => Promise.resolve()),
    internals: {
      setAdventureComplete: jest.fn(),
      setCompletionSeries: jest.fn(),
      setSceneAdvanceBusy: jest.fn(),
      setCheckBusy: jest.fn(),
      ownResolvedCheckKeysRef: { current: new Set() },
    },
  };
}

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

function useHarness() {
  const transcript = useTranscript();
  const [sceneState] = React.useState(makeFakeSceneState);
  return useNarration(
    's1',
    SESSION,
    sceneState,
    transcript,
    '',
    jest.fn(),
    false,
    jest.fn(),
    jest.fn(),
  );
}

// THE INVARIANT UNDER TEST — fails loudly (rather than just via a value
// mismatch) if the pair is ever caught in the one combination the reachable
// state machine never produces.
function expectReachableCombo(talking: boolean, thinking: boolean) {
  if (!talking && thinking) {
    throw new Error(
      `Unreachable (talking, thinking) combination observed: (${talking}, ${thinking}). ` +
        `"thinking" must never be true while "talking" is false.`,
    );
  }
}

beforeEach(() => {
  jest.clearAllMocks();
  window.localStorage.clear();
});

describe('useNarration — (talking, thinking) reachable state machine', () => {
  it('a durable beat lifecycle visits exactly (true,true) -> (true,false) -> (false,false), never (false,true)', async () => {
    mockPostDmTurn.mockResolvedValue({
      job_id: 'job-1',
      turn_key: 'tk-1',
      status: 'pending',
      deduped: false,
    });

    let releaseChunk: () => void = () => {};
    const chunkGate = new Promise<void>((resolve) => {
      releaseChunk = resolve;
    });
    let releaseDone: () => void = () => {};
    const doneGate = new Promise<void>((resolve) => {
      releaseDone = resolve;
    });
    mockSubscribeDmJob.mockImplementation(async function* () {
      await chunkGate;
      yield { kind: 'chunk', text: 'Hello.' };
      await doneGate;
      yield { kind: 'done' };
    });

    const { result } = renderHook(() => useHarness());

    // Idle — (false, false).
    expectReachableCombo(result.current.talking, result.current.thinking);
    expect(result.current.talking).toBe(false);
    expect(result.current.thinking).toBe(false);

    // Begin the turn — beginTurn() flips both synchronously, before any await.
    let beatPromise: void | Promise<void>;
    act(() => {
      beatPromise = result.current.narrateDurableBeat('A line.', '', 'say');
    });
    expectReachableCombo(result.current.talking, result.current.thinking);
    expect(result.current.talking).toBe(true);
    expect(result.current.thinking).toBe(true);

    // postDmTurn resolves and subscribeToJob is kicked off (fire-and-forget,
    // not awaited by narrateDurableBeat) — still begin-state, the generator
    // hasn't yielded anything yet.
    await act(async () => {
      await beatPromise;
    });
    expectReachableCombo(result.current.talking, result.current.thinking);
    expect(result.current.talking).toBe(true);
    expect(result.current.thinking).toBe(true);

    // First chunk arrives — firstChunkArrived() clears ONLY thinking.
    await act(async () => {
      releaseChunk();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expectReachableCombo(result.current.talking, result.current.thinking);
    expect(result.current.talking).toBe(true);
    expect(result.current.thinking).toBe(false);

    // Turn settles — onTurnSettled() clears both together.
    await act(async () => {
      releaseDone();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expectReachableCombo(result.current.talking, result.current.thinking);
    expect(result.current.talking).toBe(false);
    expect(result.current.thinking).toBe(false);
  });
});
