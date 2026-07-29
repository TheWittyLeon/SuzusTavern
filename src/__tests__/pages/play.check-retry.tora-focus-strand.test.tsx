/**
 * Check Retry + Fail-Forward (2026-07-28 design) — Tora-Gesture CRITICAL-1
 * regression pin (PROMOTED from play.check-retry.tora-focus-strand.probe.test.tsx
 * on 2026-07-28, after Ren-Dev's fix landed).
 *
 * Originally written to empirically verify Check Retry + Fail-Forward design
 * §7.2's claim that "Focus rescue already exists ... It already runs on the
 * check path — verify it fires, don't rebuild it." — and disproved it for one
 * specific trigger: both existing focus-rescue tests (play.check-retry.test.tsx
 * item 27, and play.checks-and-fork.test.tsx's pre-existing CRITICAL-1 block)
 * drive the removal via `fireEvent.click(btn)` on the SAME button that then
 * unmounts, i.e. the ACTING client's own onAttemptCheck() call. This test
 * instead removes the check via a BACKGROUND POLL — no click on this client at
 * all (mirrors play.check-retry.adversarial.test.tsx's "adversarial 4 —
 * spectator asymmetry" harness, plus a `.focus()` + `document.activeElement`
 * assertion that test never makes). This is how the design's own §7.4 says a
 * second client at the same table (or a STRUCT-006 classifier resolving the
 * gating flag through roleplay, with no check click at all) observes a
 * resolved check disappear.
 *
 * FIXED (Ren-Dev, 2026-07-28): both poll effects (durable, page.tsx
 * ~L1740-1760; SSE/flag-off, page.tsx ~L1980-1993) now capture
 * `checkWrapRef.current?.contains(document.activeElement)` synchronously
 * right before `setGrounding(g)`, and call `refocusSceneHeadIfStranded(...)`
 * after — the same rescue the click-driven paths already used, now also
 * covering other-player/classifier-driven removal and the non-self
 * escalate_dc key-remount.
 */
import React from 'react';
import { render, screen, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import type {
  EngineSessionEvent,
  EventsPage,
  GroundingData,
  Participant,
  SceneCheck,
  Session,
} from '@/lib/api/types';

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
  useReducedMotion: () => true,
}));

// Forced true -- exercises the durable poll (page.tsx ~L1740), the prod path.
jest.mock('../../lib/config', () => ({
  DURABLE_GENERATION_ENABLED: true,
  OAUTH_ENABLED: false,
  CODEX_ENABLED: false,
}));

const EMPTY_PAGE: EventsPage = { events: [], max_seq: 0, has_more: false, pending_generation: null };

const mGetSession = jest.fn<Promise<unknown>, unknown[]>();
const mGetParticipants = jest.fn<Promise<unknown>, unknown[]>();
const mGetGrounding = jest.fn<Promise<unknown>, unknown[]>();
const mGetSessionEvents = jest.fn<Promise<unknown[]>, unknown[]>(() => Promise.resolve([]));
const mGetSessionEventsRaw = jest.fn<Promise<EngineSessionEvent[] | null>, unknown[]>(() =>
  Promise.resolve([]),
);
const mGetSessionEventsPage = jest.fn<Promise<EventsPage>, unknown[]>(() =>
  Promise.resolve(EMPTY_PAGE),
);
const mResolveCheck = jest.fn<Promise<unknown>, unknown[]>();

jest.mock('../../lib/api/dnd', () => ({
  getSession: (...a: unknown[]) => mGetSession(...a),
  getParticipants: (...a: unknown[]) => mGetParticipants(...a),
  getGrounding: (...a: unknown[]) => mGetGrounding(...a),
  getSessionEvents: (...a: unknown[]) => mGetSessionEvents(...a),
  getSessionEventsRaw: (...a: unknown[]) => mGetSessionEventsRaw(...a),
  getSessionEventsPage: (...a: unknown[]) => mGetSessionEventsPage(...a),
  getCombatState: jest.fn(() => Promise.resolve(null)),
  getCharacterSheet: jest.fn(() => Promise.resolve(null)),
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
  resolveCheck: (...a: unknown[]) => mResolveCheck(...a),
  getSessionNotes: jest.fn(() => Promise.resolve(null)),
  putSessionNotes: jest.fn(() =>
    Promise.resolve({ body: '', updated_at: '2026-01-01T00:00:00Z' }),
  ),
}));

jest.mock('../../lib/stream', () => ({
  streamDmNarration: jest.fn(async function* () {
    yield { kind: 'done' as const };
  }),
  postDmTurn: jest.fn(() =>
    Promise.resolve({ job_id: 'j', turn_key: 'tk', status: 'pending', deduped: false }),
  ),
  subscribeDmJob: jest.fn(async function* () {}),
}));

import PlayPage from '@/app/play/[sessionId]/page';

const SESSION: Session = {
  session_id: 's1',
  channel: 'focus_probe_channel',
  name: 'Test Table',
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

function checkResolvedEvent(seq: number): EngineSessionEvent {
  return {
    seq,
    kind: 'check_resolved',
    actor: 'someone_else',
    visibility: 'table',
    created_at: '2026-07-28T10:00:00Z',
    data: { skill: 'survival', dc: 13, total: 16, success: true, flag_set: 'beat_a' },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  mGetSession.mockResolvedValue(SESSION);
  mGetParticipants.mockResolvedValue(PARTY);
  mGetSessionEvents.mockResolvedValue([]);
  mGetSessionEventsRaw.mockResolvedValue([]);
  mGetSessionEventsPage.mockResolvedValue(EMPTY_PAGE);
});

afterEach(() => {
  jest.useRealTimers();
});

describe('Tora-Gesture CRITICAL-1 — poll-driven check removal rescues focus', () => {
  it('focus is not silently stranded on <body> when a background poll resolves the focused check', async () => {
    mGetGrounding.mockResolvedValue(grounding([{ skill: 'survival', dc: 13 }]));
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

    // Nobody on THIS client clicked anything.
    expect(mResolveCheck).not.toHaveBeenCalled();

    // Someone else at the table resolved it; this client's own durable poll
    // observes the check_resolved event and re-fetches grounding.
    mGetGrounding.mockResolvedValue(
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
    mGetSessionEventsPage.mockResolvedValue({
      events: [checkResolvedEvent(7)],
      max_seq: 7,
      has_more: false,
      pending_generation: null,
    });

    await act(async () => {
      jest.advanceTimersByTime(4000);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });
    // refocusSceneHeadIfStranded's rescue runs inside a requestAnimationFrame
    // (page.tsx ~L2321, deliberate -- lets React's commit land first). Jest's
    // modern fake timers (active via this file's beforeEach) mock rAF as a
    // queued callback that only fires on a further timer advance -- the
    // promise-only flushes above settle setGrounding()'s state update but
    // never advance the fake clock again afterward. One more small advance
    // settles it, mirroring how this test already advances the fake clock
    // for the setInterval-driven poll itself.
    await act(async () => {
      jest.advanceTimersByTime(20);
    });

    // Confirms the poll DID land and DID remove the button (i.e. this isn't
    // a test-setup failure) before asserting on where focus ended up.
    expect(screen.queryByRole('button', { name: /Attempt Survival/i })).not.toBeInTheDocument();

    const sceneHead = container.querySelector('[aria-label^="Scene:"]');
    expect(sceneHead).not.toBeNull();

    // THE ASSERTION UNDER TEST: focus lands on the scene head (the design's
    // §7.2 promise), not stranded on <body>.
    expect(document.activeElement).toBe(sceneHead);
  });
});
