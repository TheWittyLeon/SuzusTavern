/**
 * Tora-Gesture CRITICAL-1 — stream-row resurrection race (interaction review,
 * hardening/tavern-ui-2026-07-17).
 *
 * Root cause: `readSSE` (src/lib/stream.ts) only checks `signal.aborted` once
 * per `reader.read()` chunk, not per SSE event — so a STALE beat whose
 * `AbortController` a successor has already `.abort()`-ed can still deliver a
 * buffered trailing event to `narrate()`'s `for await` body. Before the fix,
 * `narrate()` only checked `ctrl.signal.aborted` AFTER its `for await` loop
 * fully exited — never at each individual chunk — so a stale beat's
 * `upsertStreamNarration(full)` call could still run, find
 * `streamRowIdRef.current === null` (a successor had already synchronously
 * cleared it via `clearStreamNarration(true)`), and RE-CREATE a fresh row,
 * re-claiming the ref. A genuine successor beat then adopts that resurrected
 * id via its own `upsertStreamNarration` UPDATE branch (same id, new text) —
 * and when the stale beat's post-loop abort-check finally runs,
 * `shouldClearAbortedStreamRow` sees the ids coincidentally match and deletes
 * the row the live successor is actively streaming into.
 *
 * The fix guards every `upsertStreamNarration(...)` call site on
 * `!ctrl.signal.aborted` (each beat's closure captures its own `ctrl`, and
 * `ctrl.signal.aborted` flips synchronously the instant a successor calls
 * `.abort()`) — a stale beat can then never re-mint/adopt a row after being
 * superseded, regardless of whether its async generator has itself noticed
 * the abort yet.
 *
 * TEST STRATEGY — reproducing "successor supersedes predecessor mid-stream"
 * without going through `talking`-gated UI affordances (Composer's Enter-key
 * path deliberately has NO synchronous double-fire latch — see MINOR-3's own
 * comment in Composer.tsx, "the Enter path is already guarded by canSend" —
 * `canSend` is derived from props/state that have not yet re-rendered within
 * a single batch, so two Enter keydowns dispatched in the SAME `act()` call,
 * with no render in between, invoke `onSend` — and therefore `narrate()` —
 * TWICE with the stale `talking=false` closure). This is a real, reachable
 * race (rapid double-submit / keyboard auto-repeat), not a test-only
 * fabrication, and it exercises the real `narrate()` twice, superseding one
 * `AbortController` with another exactly as production code does.
 *
 * Both mocked SSE generators are gated with manually-resolved promises so the
 * test can force the EXACT interleaving Tora described:
 *   1. beat1 (predecessor) and beat2 (successor) both start; beat2's
 *      `narrationAbort.current?.abort()` fires synchronously, aborting
 *      beat1's ctrl, before either generator has produced a single event.
 *   2. beat1 THEN delivers a "trailing" chunk (its ctrl already aborted) —
 *      asserted to NEVER reach the transcript log.
 *   3. beat2 delivers its own first chunk, creating/claiming the live row.
 *   4. beat1's generator THEN completes (`done`), running its post-loop
 *      `shouldClearAbortedStreamRow` check — asserted to NOT delete beat2's
 *      still-streaming row (the exact "row disappears mid-sentence" window).
 *   5. beat2 completes and finalizes normally.
 */
import React from 'react';
import { render, screen, within, waitFor, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { GroundingData, NarrationEvent, Participant, Session } from '@/lib/api/types';

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

jest.mock('../../lib/useReducedMotion', () => ({
  useReducedMotion: () => false,
}));

jest.mock('../../lib/api/dnd', () => ({
  getSession: jest.fn(),
  getSessionEvents: jest.fn(() => Promise.resolve([])),
  getSessionEventsRaw: jest.fn(() => Promise.resolve(null)),
  getParticipants: jest.fn(),
  getGrounding: jest.fn(),
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
  bindCharacter: jest.fn(() =>
    Promise.resolve({ campaign_id: 's1', username: 'leon', role: 'player', character_id: 1 }),
  ),
  getSessionNotes: jest.fn(() => Promise.resolve(null)),
  putSessionNotes: jest.fn(() => Promise.resolve({ body: '', updated_at: '2026-01-01T00:00:00Z' })),
}));

jest.mock('../../lib/stream', () => ({
  streamDmNarration: jest.fn(),
}));

import * as dnd from '@/lib/api/dnd';
import * as stream from '@/lib/stream';
import PlayPage from '@/app/play/[sessionId]/page';

const mGetSession = dnd.getSession as jest.MockedFunction<typeof dnd.getSession>;
const mGetParticipants = dnd.getParticipants as jest.MockedFunction<typeof dnd.getParticipants>;
const mGetGrounding = dnd.getGrounding as jest.MockedFunction<typeof dnd.getGrounding>;
const mStream = stream.streamDmNarration as jest.MockedFunction<typeof stream.streamDmNarration>;

const SESSION: Session = {
  session_id: 's1',
  channel: 'mlp_everfree_leon',
  status: 'active',
  dm_username: 'suzu',
  participant_usernames: ['leon'],
  player_count: 1,
  active_combat_id: null,
  dm_mode: 'ai',
  ai_assist_level: 'full',
};

const PARTY: Participant[] = [
  {
    username: 'leon',
    is_dm: false,
    character: {
      character_id: 'c1',
      name: 'Anomaly',
      char_class: 'Ranger',
      level: 1,
      current_hp: 10,
      max_hp: 10,
      ac: 13,
    },
  },
];

const GROUNDING_SINGLE_EDGE: GroundingData = {
  scene_id: 'slice_everfree_navigate',
  scene_name: 'Into the Everfree',
  boxed_text: 'The path narrows ahead.',
  objective: 'Press onward.',
  transitions: [{ to: 'slice_everfree_timberwolf', label: 'Get moving' }],
  checks: [{ skill: 'survival', dc: 12 }],
  flags: {},
  encounter_state: {},
};

/** A manually-resolvable gate for controlling async generator interleaving. */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/** Yield to a full macrotask so every currently-pending microtask (generator
 * resumption, `for await` continuation, React state commit) has drained
 * before the next assertion runs. */
const flush = () => new Promise<void>((r) => setTimeout(r, 0));

beforeEach(() => {
  jest.clearAllMocks();
  mGetSession.mockResolvedValue(SESSION);
  mGetParticipants.mockResolvedValue(PARTY);
  mGetGrounding.mockResolvedValue(GROUNDING_SINGLE_EDGE);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('Tora CRITICAL-1 — stream-row resurrection race (TAV-S1-ABORT-CLEAR)', () => {
  it('a superseded (aborted) beat never resurrects a row, and the live successor row survives the stale beat finishing', async () => {
    const gate1 = deferred(); // predecessor: pause before its trailing chunk
    const gate2 = deferred(); // predecessor: pause between trailing chunk and `done`
    const gate3 = deferred(); // successor: pause before its own first chunk
    const gate4 = deferred(); // successor: pause between its first and final chunk

    async function* predecessorGen(): AsyncGenerator<NarrationEvent> {
      await gate1.promise;
      // The stale/aborted beat's trailing event — must NEVER reach the log.
      yield { kind: 'chunk', text: 'STALE RESURRECTION TEXT', streamMode: true };
      await gate2.promise;
      yield { kind: 'done' };
    }

    async function* successorGen(): AsyncGenerator<NarrationEvent> {
      await gate3.promise;
      yield { kind: 'chunk', text: 'Successor is live', streamMode: true };
      await gate4.promise;
      yield { kind: 'chunk', text: 'Successor is live and finished.', streamMode: true };
      yield { kind: 'done' };
    }

    mStream.mockImplementationOnce(predecessorGen).mockImplementationOnce(successorGen);

    render(<PlayPage />);
    const input = await screen.findByRole('textbox');
    const log = await screen.findByRole('log');

    fireEvent.change(input, { target: { value: 'I glance around, twice.' } });

    // ── Double-fire within a SINGLE batch: no render commits between the two
    // dispatches, so both invoke the same `onSend` closure (talking=false)
    // and both call `narrate()`. The second call's `narrationAbort.current
    // ?.abort()` supersedes the first's controller before either generator
    // has produced a single event. ──────────────────────────────────────────
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' });
      fireEvent.keyDown(input, { key: 'Enter' });
    });

    expect(mStream).toHaveBeenCalledTimes(2);

    // ── Step: predecessor (already aborted) delivers its trailing chunk ────
    await act(async () => {
      gate1.resolve();
      await flush();
    });
    // The gated fix (`!ctrl.signal.aborted` before `upsertStreamNarration`)
    // means this NEVER reaches the transcript log. Without the fix this
    // resurrects a fresh row carrying exactly this text.
    expect(within(log).queryByText('STALE RESURRECTION TEXT')).not.toBeInTheDocument();

    // ── Step: successor delivers its own first chunk — establishes (or,
    // pre-fix, silently adopts the resurrected) live row. ───────────────────
    await act(async () => {
      gate3.resolve();
      await flush();
    });
    await waitFor(() => {
      expect(within(log).getByText('Successor is live')).toBeInTheDocument();
    });
    const liveRow = within(log).getByText('Successor is live').parentElement as HTMLElement;
    expect(liveRow.getAttribute('aria-hidden')).toBe('true');

    // ── Step: predecessor now completes (`done`) and runs its post-loop
    // `shouldClearAbortedStreamRow` check. THIS is the exact window Tora
    // flagged — pre-fix, the predecessor's stale `ownStreamRowId` coincides
    // with the ref the successor just adopted, and it deletes the row the
    // successor is actively streaming into. ────────────────────────────────
    await act(async () => {
      gate2.resolve();
      await flush();
    });

    // Non-vacuity proof: the successor's still-live row MUST survive the
    // stale predecessor's cleanup. This assertion fails without the
    // `!ctrl.signal.aborted` gate (the row is deleted here) and passes with
    // it.
    expect(within(log).getByText('Successor is live')).toBeInTheDocument();
    expect(within(log).queryByText('STALE RESURRECTION TEXT')).not.toBeInTheDocument();

    // ── Step: successor finishes and finalizes normally ─────────────────────
    await act(async () => {
      gate4.resolve();
      await flush();
    });

    await waitFor(() => {
      const finalEl = within(log).getByText('Successor is live and finished.');
      expect(finalEl.parentElement?.getAttribute('aria-hidden')).toBeNull();
    });
    // Exactly one row carries the finalized text — no duplicate/orphan from
    // the resurrection race.
    expect(within(log).getAllByText('Successor is live and finished.')).toHaveLength(1);
    expect(within(log).queryByText('STALE RESURRECTION TEXT')).not.toBeInTheDocument();
  });
});
