/**
 * A5 (Miko-QA review, 2026-09-28) — `revealText`'s prefers-reduced-motion
 * short-circuit (`hooks/useNarration.ts`), pinned for the first time.
 *
 * The near-miss: A5's extraction of `useNarration` almost dropped the
 * `if (reduced) { ... return; }` branch entirely (caught and restored before
 * commit, byte-identical to `ec49f36`). But the branch itself — present on
 * `main` since TAV-NARRATION-DECOUPLE — has NEVER been mutation-proof: every
 * existing suite that mocks `useReducedMotion → true` (arrival-narration,
 * attack-button-stale, combat-ui-adv78*, check-retry.adversarial, etc.) only
 * asserts the FINAL revealed text via `findByText`/`waitFor`'s default
 * ~1000ms polling window. A short buffered beat's fake-typewriter (26ms per
 * token) fully completes well inside that window, so those suites cannot
 * tell "revealed synchronously because prefers-reduced-motion skipped the
 * typewriter" apart from "revealed via the typewriter, just fast enough to
 * sneak under the polling timeout" — deleting the `if (reduced)` branch
 * entirely (M: `if (false) { ... }`) leaves the full 238-suite/3487-test
 * repo green.
 *
 * This suite closes that gap the same way `play.dm-stream.test.tsx`'s own
 * Kage-CR CRITICAL case does for the non-reduced typewriter path: fake
 * timers, settle the async generator's microtask chain, then assert BEFORE
 * advancing any timer at all. The two assertions are:
 *   (1) the full beat text is already on screen — provable only if
 *       `upsertStreamNarration(full)` ran synchronously inside the chunk
 *       handler, never via a scheduled interval tick;
 *   (2) `window.setInterval` was never called with `revealText`'s exact
 *       26ms cadence — the code's own `DELAY_MS`-shaped literal — which
 *       isolates the claim from the session/combat/dice-roll polls that are
 *       always running in the background at other intervals.
 */
import React from 'react';
import { render, screen, act, fireEvent, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { GroundingData, Participant, Session } from '@/lib/api/types';

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

// The subject under test: prefers-reduced-motion IS set.
jest.mock('../../lib/useReducedMotion', () => ({
  useReducedMotion: () => true,
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
  getSessionNotes: jest.fn(() => Promise.resolve(null)),
  putSessionNotes: jest.fn(() =>
    Promise.resolve({ body: '', updated_at: '2026-01-01T00:00:00Z' }),
  ),
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

const SCENE: GroundingData = {
  scene_id: 'everfree_flight',
  scene_name: 'The Flight',
  boxed_text: 'Something is pacing you through the trees.',
  objective: 'Get clear.',
  transitions: [],
  checks: [],
  flags: {},
  encounter_state: {},
};

// Multiple tokens: if even ONE fake-typewriter tick fired, this would render
// as a strict PREFIX ("The" or "The trees"), never the whole sentence — so
// "full text present, zero timers advanced" cannot pass by accident.
const FULL_BEAT = 'The trees thin out and the firelight of the tavern comes into view.';

beforeEach(() => {
  jest.clearAllMocks();
  mGetSession.mockResolvedValue(SESSION);
  mGetParticipants.mockResolvedValue(PARTY);
  mGetGrounding.mockResolvedValue(SCENE);
});

describe('A5 — revealText prefers-reduced-motion short-circuit (hooks/useNarration.ts)', () => {
  it('shows the WHOLE buffered beat the instant the chunk arrives, before `done` finalizes it and before any fake-timer tick, when prefers-reduced-motion is set', async () => {
    // Root-cause note (Miko-QA, 2026-09-28): a naive version of this test
    // (yield chunk THEN done in the same mock generator, settle once, assert
    // the final log content) is VACUOUS -- `finalizeStreamNarration(full)`
    // runs synchronously off the `done` event and sets the row to the FULL
    // text regardless of how it got revealed, so the reduced and
    // non-reduced paths converge on the identical final DOM either way. The
    // only place the two paths actually differ is the MID-STREAM state,
    // between the chunk landing and `done` arriving -- so `done` is gated
    // behind a manually-released promise to hold the generator open long
    // enough to inspect it.
    let releaseDone: () => void = () => {};
    const doneGate = new Promise<void>((resolve) => {
      releaseDone = resolve;
    });
    mStream.mockImplementation(async function* () {
      yield { kind: 'chunk', text: FULL_BEAT };
      await doneGate;
      yield { kind: 'done' };
    });

    jest.useFakeTimers();
    // Spied AFTER useFakeTimers() installs its own window.setInterval --
    // spying first would wrap the REAL setInterval, which fake timers then
    // replaces wholesale, silently orphaning the spy.
    const setIntervalSpy = jest.spyOn(window, 'setInterval');
    try {
      render(<PlayPage />);
      await screen.findByRole('textbox');

      const input = screen.getByRole('textbox');
      fireEvent.change(input, { target: { value: 'I look around.' } });
      await act(async () => {
        fireEvent.keyDown(input, { key: 'Enter' });
      });

      // Settle only the CHUNK event's synchronous handling. The generator
      // is now parked on `doneGate`, so `done`/finalizeStreamNarration
      // cannot have run yet -- and zero fake-timer ticks have occurred.
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });

      // (1) Mid-stream, the FULL beat must already be visible -- provable
      // only if upsertStreamNarration(full) ran synchronously inside
      // revealText's `if (reduced)` branch. The typewriter's alternative
      // (upsertStreamNarration(''), then a 26ms-interval reveal) would show
      // NOTHING here, since no timer has ticked and `done` hasn't landed.
      const log = screen.getByRole('log');
      expect(within(log).getByText(FULL_BEAT)).toBeInTheDocument();

      // (2) revealText's own 26ms fake-typewriter interval (the literal
      // this branch exists to skip) was never scheduled at all. Filters out
      // the session/combat/dice-roll polls, which run on their own longer
      // intervals and are always present in the background.
      const typewriterIntervalCalls = setIntervalSpy.mock.calls.filter(
        ([, delay]) => delay === 26,
      );
      expect(typewriterIntervalCalls).toHaveLength(0);

      // Release the gate so the beat completes cleanly (no dangling
      // generator / unhandled rejection at teardown).
      releaseDone();
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });
    } finally {
      jest.useRealTimers();
    }
  });
});
