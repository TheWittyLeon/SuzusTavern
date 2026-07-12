/**
 * DDX-25 — Session controls: ADVERSARIAL pass (Miko-QA, break-it).
 *
 * Sibling to play.ddx25-session-controls.test.tsx (Ren's happy/AC-path suite).
 * This file exists to answer one question the AC suite never asks: once a
 * session is (already) paused, what ELSE, besides the Composer and the combat
 * action rail, still lets a player act? And does anyone OTHER than the DM who
 * clicked Pause ever find out?
 *
 * DDX-25 R2 (Ren-Dev fix pass): every defect below is now fixed. The
 * `it.failing` tests were flipped to plain `it` (they now hard-fail if the
 * fix ever regresses, per the project's `it.failing` convention); the
 * lock-in tests that documented the OLD (buggy) behavior were rewritten to
 * assert the NEW (fixed) behavior, so they still serve as regression locks —
 * just for the opposite outcome.
 *
 *   ADV-1  FIXED. "Move on" (scene transition) is now gated by sessionLocked
 *          (button `disabled`, plus a defense-in-depth check inside onMoveOn
 *          itself).
 *   ADV-2  FIXED. DiceTray quick-checks (which auto-fire narrate()) are now
 *          gated by sessionLocked, both on the DiceTray `disabled` prop and
 *          inside onRoll's own auto-narrate condition.
 *   ADV-3  FIXED. RebindCharacterButton now accepts a `sessionLocked` prop
 *          (mirrors `combatActive`) and the play page passes it through.
 *   ADV-4  FIXED (HEADLINE). A session-status poll (mirrors the existing 4s
 *          combat-state poll: same cadence, same document.hidden gate, same
 *          cleanup-on-unmount) now refetches getSession every ~4-5s, so a
 *          non-acting viewer's tab (or a 2nd DM tab) converges on a
 *          pause/resume/end within one poll cycle instead of needing a
 *          manual reload.
 *   ADV-5  FIXED. Pause/Resume, End session, and Award XP all now go through
 *          a synchronous `sessionActionBusyRef` latch (mirrors
 *          combatBusyRef/checkBusyRef/sceneAdvanceBusyRef elsewhere in the
 *          play page) that closes the same-tick double-click window
 *          `sessionActionBusy` (React state) can't.
 *   ADV-5b Same fix as ADV-5 — Award XP's double-fire was the highest-
 *          priority instance (engine `xp_pool += amount` has no idempotency
 *          guard, so a double-fire there ALWAYS double-awarded XP).
 *   ADV-6  FIXED (D7). An engine-rejected pause/resume now refetches session
 *          state in the catch path too, so the button label self-corrects
 *          instead of staying stuck on the pre-click label.
 *   ADV-7  UNCHANGED BY DESIGN (D8). A successful mutation whose own
 *          refetch fails still shows a success toast without updating the
 *          banner/composer in this tab — `refreshSessionAfterAction`
 *          deliberately swallows its own failure (the mutation already
 *          succeeded server-side; surfacing an error toast for it would be
 *          wrong). The ADV-4 session-status poll now corrects this within
 *          one cycle (~4-5s) without needing extra retry logic here — see
 *          refreshSessionAfterAction's own comment in the play page.
 */
import React from 'react';
import { render, screen, waitFor, fireEvent, act, within } from '@testing-library/react';
import '@testing-library/jest-dom';

jest.mock('next/navigation', () => ({
  useParams: () => ({ sessionId: 's1' }),
}));

const mockToast = jest.fn();
jest.mock('../../components/Toast', () => ({
  useToast: () => ({ toast: mockToast }),
}));

let mockUsername = 'dm_alice';
jest.mock('../../lib/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 1, username: mockUsername, email: null } }),
}));

jest.mock('../../lib/useReducedMotion', () => ({
  useReducedMotion: () => true,
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFn = (...args: any[]) => any;
const mockGetSession = jest.fn<Promise<unknown>, unknown[]>();
const mockGetSessionEvents = jest.fn<Promise<unknown[]>, unknown[]>(() => Promise.resolve([]));
const mockGetSessionEventsRaw = jest.fn<Promise<unknown[] | null>, unknown[]>(() => Promise.resolve(null));
const mockGetParticipants = jest.fn<Promise<unknown>, unknown[]>(() => Promise.resolve([]));
const mockGetGrounding = jest.fn<Promise<unknown>, unknown[]>(() => Promise.resolve(null));
const mockGetCombatState = jest.fn<Promise<unknown>, unknown[]>(() => Promise.resolve(null));
const mockGetCharacterSheet = jest.fn<Promise<unknown>, unknown[]>(() => Promise.resolve(null));
const mockPauseSession = jest.fn<Promise<unknown>, unknown[]>();
const mockResumeSession = jest.fn<Promise<unknown>, unknown[]>();
const mockEndSession = jest.fn<Promise<unknown>, unknown[]>();
const mockAwardSessionXp = jest.fn<Promise<unknown>, unknown[]>();
const mockAdvanceScene = jest.fn<Promise<unknown>, unknown[]>();
const mockResolveCheck = jest.fn<Promise<unknown>, unknown[]>();

jest.mock('../../lib/api/dnd', () => ({
  getSession: (...args: Parameters<AnyFn>) => mockGetSession(...args),
  getSessionEvents: (...args: Parameters<AnyFn>) => mockGetSessionEvents(...args),
  getSessionEventsRaw: (...args: Parameters<AnyFn>) => mockGetSessionEventsRaw(...args),
  getParticipants: (...args: Parameters<AnyFn>) => mockGetParticipants(...args),
  getGrounding: (...args: Parameters<AnyFn>) => mockGetGrounding(...args),
  getCombatState: (...args: Parameters<AnyFn>) => mockGetCombatState(...args),
  getCharacterSheet: (...args: Parameters<AnyFn>) => mockGetCharacterSheet(...args),
  postSessionEvent: jest.fn(() => Promise.resolve({ seq: 1 })),
  pauseSession: (...args: Parameters<AnyFn>) => mockPauseSession(...args),
  resumeSession: (...args: Parameters<AnyFn>) => mockResumeSession(...args),
  endSession: (...args: Parameters<AnyFn>) => mockEndSession(...args),
  awardSessionXp: (...args: Parameters<AnyFn>) => mockAwardSessionXp(...args),
  advanceScene: (...args: Parameters<AnyFn>) => mockAdvanceScene(...args),
  resolveCheck: (...args: Parameters<AnyFn>) => mockResolveCheck(...args),
  npcAction: jest.fn(),
  combatFromScene: jest.fn(),
  rollInitiative: jest.fn(),
  monsterTurn: jest.fn(),
  startCombat: jest.fn(),
  spawnMonster: jest.fn(),
  attack: jest.fn(),
  dodge: jest.fn(),
  dash: jest.fn(),
  endTurn: jest.fn(),
  endCombat: jest.fn(),
  setFlag: jest.fn(),
  bindCharacter: jest.fn(() => Promise.resolve({ campaign_id: 's1', username: 'bob', role: 'player', character_id: 55 })),
  listMyCharacters: jest.fn(() => Promise.resolve([])),
  // DDX-22 Phase 3: JournalPane is now unconditionally mounted on the play
  // page (only its CSS visibility/inert state is gated by journalVisible —
  // see page.tsx's <aside id="play-pane-journal">), so every render of this
  // page fires a getSessionNotes() GET regardless of whether the journal is
  // ever opened. Default to "no note yet" so this suite stays hermetic.
  getSessionNotes: jest.fn(() => Promise.resolve(null)),
  putSessionNotes: jest.fn(() => Promise.resolve({ body: '', updated_at: '2026-01-01T00:00:00Z' })),
}));

const mockStreamDmNarration = jest.fn(
  // Empty async generator by default: narrate() consumes it, sees full === ''
  // and takes its own (harmless) error/fallback branch. Most tests in this
  // file only care whether the function was ever CALLED — i.e. whether
  // narrate() was reached at all — not whether it completes "successfully".
  // Typed as the real NarrationEvent (not a loose local shape) so the one
  // test that DOES need a real payload (D2's offeredCheck coverage) can
  // override this with `.mockImplementation` and yield a proper
  // `{ kind: 'chunk', text, offeredCheck }` event.
  async function* mockStream(..._args: unknown[]): AsyncGenerator<NarrationEvent> {
    // yields nothing
  },
);
jest.mock('../../lib/stream', () => ({
  streamDmNarration: (...args: Parameters<AnyFn>) => mockStreamDmNarration(...args),
}));

import PlayPage from '@/app/play/[sessionId]/page';
import type { Session, Participant, NarrationEvent } from '@/lib/api/types';

const BASE_SESSION: Session = {
  session_id: 's1',
  channel: 'test_channel',
  name: 'The Hollow Tide',
  dm_username: 'dm_alice',
  dm_mode: 'ai',
  ai_assist_level: 'full',
  status: 'active',
  active_combat_id: null,
};

function setup(session: Session, participants: Participant[]) {
  jest.clearAllMocks();
  mockGetSession.mockResolvedValue(session);
  mockGetSessionEvents.mockResolvedValue([]);
  mockGetSessionEventsRaw.mockResolvedValue(null);
  mockGetParticipants.mockResolvedValue(participants);
  mockGetGrounding.mockResolvedValue(null);
  mockGetCombatState.mockResolvedValue(null);
  mockGetCharacterSheet.mockResolvedValue(null);
  mockPauseSession.mockResolvedValue({ message: 'ok' });
  mockResumeSession.mockResolvedValue({ message: 'ok' });
  mockEndSession.mockResolvedValue({ message: 'ok' });
  mockAwardSessionXp.mockResolvedValue({ message: 'ok' });
  mockAdvanceScene.mockResolvedValue({ from_scene: 'start', to_scene: 'forest_clearing' });
  mockResolveCheck.mockResolvedValue({ description: 'ok', mechanics: 'ok' });
}

async function flush() {
  // A few microtask turns — enough for a chain of `await`s inside a mocked
  // (synchronously-resolving) handler to fully settle without resorting to
  // fake timers (which this file deliberately avoids — see ADV-4's comment).
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('DDX-25 adversarial — paused session, same-tab gaps', () => {
  it(
    'ADV-1 (FIXED): "Move on" must not advance the scene while the session is paused',
    async () => {
      mockUsername = 'bob';
      setup(
        { ...BASE_SESSION, status: 'paused' },
        [
          { username: 'dm_alice', is_dm: true, character: null },
          { username: 'bob', is_dm: false, character: null },
        ],
      );
      mockGetGrounding.mockResolvedValue({
        transitions: [{ to: 'forest_clearing', label: 'Head to the clearing' }],
        checks: [],
      });

      render(<PlayPage />);
      const moveOnBtn = await screen.findByRole('button', { name: /Head to the clearing/i });

      // Fixed: `disabled={sceneAdvanceBusy || talking || sessionLocked}` now
      // blocks the click before it ever reaches onMoveOn.
      expect(moveOnBtn).toBeDisabled();

      await act(async () => {
        fireEvent.click(moveOnBtn);
      });
      await flush();

      expect(mockAdvanceScene).not.toHaveBeenCalled();
    },
  );

  it(
    'ADV-2 (FIXED): a dice-tray quick-check must not auto-fire narrate() while the session is paused',
    async () => {
      mockUsername = 'bob';
      setup(
        { ...BASE_SESSION, status: 'paused' },
        [
          { username: 'dm_alice', is_dm: true, character: null },
          {
            username: 'bob',
            is_dm: false,
            character: {
              character_id: '55',
              name: 'Rook',
              char_class: 'Fighter',
              level: 3,
              current_hp: 10,
              max_hp: 10,
              ac: 14,
            },
          },
        ],
      );
      mockGetCharacterSheet.mockResolvedValue({
        skills: [{ name: 'perception', ability: 'wisdom', modifier: 3 }],
      });

      render(<PlayPage />);
      // Quick-checks resolve asynchronously off the bound character's sheet.
      const rollBtn = await screen.findByRole('button', {
        name: /Roll Perception check, modifier \+3/i,
      });

      // Fixed: `DiceTray disabled={talking || combatBusy || sessionLocked}`
      // now blocks the click before it ever reaches onRoll.
      expect(rollBtn).toBeDisabled();

      await act(async () => {
        fireEvent.click(rollBtn);
      });
      await flush();

      expect(mockStreamDmNarration).not.toHaveBeenCalled();
    },
  );

  it(
    'ADV-3 (FIXED): the "Change character" (rebind) trigger must be disabled while the session is paused',
    async () => {
      mockUsername = 'bob';
      setup(
        { ...BASE_SESSION, status: 'paused' },
        [
          { username: 'dm_alice', is_dm: true, character: null },
          {
            username: 'bob',
            is_dm: false,
            character: {
              character_id: '55',
              name: 'Rook',
              char_class: 'Fighter',
              level: 3,
              current_hp: 10,
              max_hp: 10,
              ac: 14,
            },
          },
        ],
      );

      render(<PlayPage />);
      // Fixed: RebindCharacterButtonProps now accepts `sessionLocked`, and
      // the play page passes the render-scope `sessionLocked` const through.
      // The tooltip/accessible name changes to explain why (same convention
      // `combatActive` already used) — so the query targets the new label,
      // not the base "Change your character" name.
      const rebindBtn = await screen.findByRole('button', {
        name: /session is paused or has ended/i,
      });

      expect(rebindBtn).toBeDisabled();
    },
  );

  it(
    'D2 (new coverage): the skill-check "Attempt" button must not resolve a check once the DM pauses mid-invitation',
    async () => {
      // A skill check is only actionable once Suzu has invited it in the
      // fiction (offeredCheckSkill, set from a narrate() beat's offeredCheck
      // signal — grounding.checks alone never renders the button; see the
      // play page's own "DM-driven gating" comment). So the realistic
      // adversarial window here isn't "paused from the start" (a check could
      // never be invited under a pause to begin with, since inviting one
      // requires a narrate() beat, itself already gated by sessionLocked) —
      // it's "offered, THEN the DM pauses before the player clicks Attempt".
      // Single viewer (the DM) so this test can both trigger the offer and
      // pause the table without a second render.
      mockUsername = 'dm_alice';
      setup(BASE_SESSION, [{ username: 'dm_alice', is_dm: true, character: null }]);
      mockGetGrounding.mockResolvedValue({
        transitions: [],
        checks: [{ skill: 'perception', dc: 12 }],
      });

      render(<PlayPage />);
      await screen.findByText('The Hollow Tide');

      mockStreamDmNarration.mockImplementation(async function* () {
        yield {
          kind: 'chunk',
          text: 'Suzu invites a Perception check.',
          offeredCheck: { skill: 'perception', dc: 12 },
        };
        yield { kind: 'done' };
      });
      const input = screen.getByRole('textbox', { name: /Compose/i });
      fireEvent.change(input, { target: { value: 'I consider using my senses.' } });
      await act(async () => {
        fireEvent.keyDown(input, { key: 'Enter' });
      });

      const attemptBtn = await screen.findByRole('button', { name: /Attempt Perception, DC 12/i });
      expect(attemptBtn).not.toBeDisabled();

      // The DM pauses before clicking Attempt.
      mockGetSession.mockResolvedValue({ ...BASE_SESSION, status: 'paused' });
      const pauseBtn = screen.getByRole('button', { name: /^Pause$/i });
      await act(async () => {
        fireEvent.click(pauseBtn);
      });
      await flush();

      // Fixed: `disabled={checkBusy || talking || sessionLocked}` now blocks
      // the click before it ever reaches onAttemptCheck (which also carries
      // its own isSessionLocked(session) defense-in-depth check).
      expect(attemptBtn).toBeDisabled();

      await act(async () => {
        fireEvent.click(attemptBtn);
      });
      await flush();

      expect(mockResolveCheck).not.toHaveBeenCalled();
    },
  );
});

describe('DDX-25 adversarial — cross-tab / non-acting-viewer propagation (HEADLINE)', () => {
  // These two tests need fake timers to advance past a poll cycle; every
  // other test in this file deliberately uses real timers + the `flush()`
  // microtask helper (see its own comment), so fake timers are scoped
  // locally (useFakeTimers/useRealTimers per test) rather than globally.

  it('ADV-4 (FIXED): a non-DM viewer converges on a DM pause within one session-status poll cycle', async () => {
    jest.useFakeTimers();
    try {
      mockUsername = 'bob';
      setup(
        { ...BASE_SESSION, status: 'active' },
        [
          { username: 'dm_alice', is_dm: true, character: null },
          { username: 'bob', is_dm: false, character: null },
        ],
      );
      // D1 fix: the mount fetch sees 'active'; every getSession call after
      // that (i.e. every poll tick) sees 'paused' — simulating the DM's
      // pause landing server-side between poll cycles on this (non-acting)
      // viewer's tab.
      mockGetSession.mockResolvedValueOnce({ ...BASE_SESSION, status: 'active' });
      mockGetSession.mockResolvedValue({ ...BASE_SESSION, status: 'paused' });

      render(<PlayPage />);
      await screen.findByText('The Hollow Tide');
      await waitFor(() => expect(mockGetSession).toHaveBeenCalledTimes(1));
      expect(screen.queryByText(/Session paused by the DM/i)).not.toBeInTheDocument();
      expect(screen.getByRole('textbox', { name: /Compose/i })).not.toBeDisabled();

      // D1: advance past one session-status poll cycle (mirrors the existing
      // 4s combat-state poll's own cadence).
      await act(async () => {
        jest.advanceTimersByTime(4000);
      });

      expect(mockGetSession).toHaveBeenCalledTimes(2);
      expect(screen.getByText(/Session paused by the DM/i)).toBeInTheDocument();
      expect(screen.getByRole('textbox', { name: /Compose/i })).toBeDisabled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('D1 (new coverage): the session-status poll stops once the session has already ended', async () => {
    jest.useFakeTimers();
    try {
      mockUsername = 'bob';
      setup(
        { ...BASE_SESSION, status: 'ended' },
        [
          { username: 'dm_alice', is_dm: true, character: null },
          { username: 'bob', is_dm: false, character: null },
        ],
      );

      render(<PlayPage />);
      await screen.findByText('The Hollow Tide');
      const calls = mockGetSession.mock.calls.length;

      // Several poll cycles' worth of time — no further polling once ended.
      await act(async () => {
        jest.advanceTimersByTime(16000);
      });

      expect(mockGetSession.mock.calls.length).toBe(calls);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('DDX-25 adversarial — double-submit race probe', () => {
  it(
    'ADV-5 (FIXED): back-to-back clicks on Pause in the same React batch must call pauseSession only once',
    async () => {
      mockUsername = 'dm_alice';
      setup(BASE_SESSION, [{ username: 'dm_alice', is_dm: true, character: null }]);

      render(<PlayPage />);
      const pauseBtn = await screen.findByRole('button', { name: /^Pause$/i });

      // Both dispatches inside ONE outer act(): React 18 batches synchronous
      // updates within a single act() callback and only commits (flipping the
      // DOM `disabled` attribute) once the callback settles — the same
      // "two taps, one tick" window that combatBusyRef/checkBusyRef/
      // sceneAdvanceBusyRef exist elsewhere in this file specifically close.
      // Fixed: onTogglePause/onConfirmEndSession/onAwardXp now share a
      // synchronous `sessionActionBusyRef` latch (same shape as those refs)
      // that closes this exact window, rather than relying solely on the
      // `sessionActionBusy` REACT STATE variable.
      await act(async () => {
        fireEvent.click(pauseBtn);
        fireEvent.click(pauseBtn);
      });
      await flush();

      expect(mockPauseSession).toHaveBeenCalledTimes(1);
    },
  );

  it(
    'ADV-5b (FIXED): back-to-back clicks on Award must call awardSessionXp only once (double-fire double-awards XP — engine xp_pool write has no idempotency guard)',
    async () => {
      mockUsername = 'dm_alice';
      setup(BASE_SESSION, [{ username: 'dm_alice', is_dm: true, character: null }]);

      render(<PlayPage />);
      fireEvent.click(await screen.findByRole('button', { name: /Award XP/i }));
      const form = await screen.findByRole('form', { name: /Award session XP/i });
      fireEvent.change(within(form).getByLabelText(/XP amount/i), {
        target: { value: '300' },
      });
      const submitBtn = within(form).getByRole('button', { name: /^Award$/i });

      // Same nested-act double-dispatch as ADV-5. Unlike pause/resume, the
      // engine's award_xp() is `UPDATE game_sessions SET xp_pool = xp_pool +
      // ? WHERE session_id = ?` — unconditionally additive, BY DESIGN (DMs
      // legitimately award XP many times across a session). That design
      // choice means there is NO server-side layer that would catch a
      // same-tick double-submit here — the client-side ref-guard is the only
      // thing standing between one click and two XP awards.
      await act(async () => {
        fireEvent.click(submitBtn);
        fireEvent.click(submitBtn);
      });
      await flush();

      expect(mockAwardSessionXp).toHaveBeenCalledTimes(1);
    },
  );

  it(
    'D5 (new coverage): back-to-back clicks on the End-session confirm button must call endSession only once',
    async () => {
      mockUsername = 'dm_alice';
      setup(BASE_SESSION, [{ username: 'dm_alice', is_dm: true, character: null }]);

      render(<PlayPage />);
      fireEvent.click(await screen.findByRole('button', { name: /^End session$/i }));
      const confirmBtn = await screen.findByRole('button', { name: /^End it$/i });

      // Same shared sessionActionBusyRef latch as ADV-5/ADV-5b — before this
      // fix, onConfirmEndSession had no busy-guard of ANY kind (not even the
      // React-state one onTogglePause at least had).
      await act(async () => {
        fireEvent.click(confirmBtn);
        fireEvent.click(confirmBtn);
      });
      await flush();

      expect(mockEndSession).toHaveBeenCalledTimes(1);
    },
  );
});

describe('DDX-25 adversarial — engine refusal / refetch-failure degradation', () => {
  it('ADV-6 (FIXED, D7): an engine-refused pause (already-paused/not-active) shows an error toast, does not crash, and self-corrects the label via a refetch', async () => {
    mockUsername = 'dm_alice';
    setup(BASE_SESSION, [{ username: 'dm_alice', is_dm: true, character: null }]);
    // Mirrors the engine's real response for "pause an already-paused
    // session" (routes/sessions.py pause_session -> cmd_pausesession ->
    // "Session not found or not active." -> _classify() matches "not found"
    // -> _err(result, 404)).
    mockPauseSession.mockRejectedValueOnce(
      Object.assign(new Error('API error 404'), { status: 404, code: '404' }),
    );
    // D7 fix: the catch path now refetches. The true server state was
    // already 'paused' before we ever clicked — mount sees 'active', the
    // catch-path refetch reveals 'paused'.
    mockGetSession.mockResolvedValueOnce({ ...BASE_SESSION, status: 'active' });
    mockGetSession.mockResolvedValueOnce({ ...BASE_SESSION, status: 'paused' });

    render(<PlayPage />);
    const pauseBtn = await screen.findByRole('button', { name: /^Pause$/i });

    await act(async () => {
      fireEvent.click(pauseBtn);
    });
    await flush();

    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ tone: 'error' }),
    );
    // No crash: the control group is still rendered.
    expect(screen.getByRole('group', { name: /Session controls/i })).toBeInTheDocument();
    // Fixed: the catch path now calls refreshSessionAfterAction, so the
    // button self-corrects to "Resume" instead of staying stuck on "Pause".
    expect(screen.getByRole('button', { name: /^Resume$/i })).toBeInTheDocument();
    expect(mockGetSession).toHaveBeenCalledTimes(2);
  });

  it('ADV-7 (unchanged by design, D8): a successful pause whose refetch fails still shows a success toast, but the composer/banner never update in this tab', async () => {
    mockUsername = 'dm_alice';
    setup(BASE_SESSION, [{ username: 'dm_alice', is_dm: true, character: null }]);
    mockGetSession.mockResolvedValueOnce(BASE_SESSION); // mount
    mockGetSession.mockRejectedValueOnce(new Error('network blip')); // post-pause refetch

    render(<PlayPage />);
    const pauseBtn = await screen.findByRole('button', { name: /^Pause$/i });

    await act(async () => {
      fireEvent.click(pauseBtn);
    });
    await flush();

    expect(mockPauseSession).toHaveBeenCalledTimes(1);
    // Misleading-but-not-crashing: the success toast fires unconditionally
    // right after refreshSessionAfterAction(), whether or not that refetch
    // actually landed. D8: left as-is by design — this tab's own
    // refreshSessionAfterAction swallows its own failure so a genuinely
    // successful mutation never surfaces an error toast; the ADV-4
    // session-status poll (real timers here, so it doesn't fire within this
    // test's lifetime) is what corrects a stale tab like this one for real,
    // within one poll cycle.
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ tone: 'success', message: 'Session paused.' }),
    );
    // But the local `session` state was never updated, so nothing downstream
    // reflects the pause in this tab.
    expect(screen.queryByText(/Session paused by the DM/i)).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /Compose/i })).not.toBeDisabled();
  });
});
