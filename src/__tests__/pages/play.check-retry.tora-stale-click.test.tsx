/**
 * Check Retry + Fail-Forward (2026-07-28 design) — Tora-Gesture MAJOR-1
 * regression pin (PROMOTED from play.check-retry.tora-stale-click.probe.test.tsx
 * on 2026-07-28, after Ren-Dev's fix landed).
 *
 * Originally written to check whether `onAttemptCheck`'s catch block
 * (page.tsx, pre-fix ~L3467-3489) refreshed grounding after a 409
 * `check_locked` / `check_resolved` refusal, the way the success path does.
 * It did not: checkBusyRef genuinely prevents a literal simultaneous
 * double-submit (proven by play.check-retry.adversarial.test.tsx's
 * "adversarial 5"), so this is a DIFFERENT, SEQUENTIAL case: attempt 1
 * completes with a 409 (this client's grounding was stale relative to the
 * server -- another table member's action, or the design's own §7.4 "eats a
 * 409" scenario, in the gap before the next ~4s poll tick corrects it), and
 * the SAME still-clickable, still-"available"-looking button invited attempt
 * 2 before that poll tick landed.
 *
 * FIXED (Ren-Dev, 2026-07-28): the catch block now self-corrects for exactly
 * `check_locked`/`check_resolved` (the two reasons a stale-grounding refusal
 * can signal) -- it captures check-wrap focus, `await refreshGrounding()`s,
 * then `refocusSceneHeadIfStranded(...)`, mirroring the success path. Every
 * other refusal reason (no_such_check/freeform_session/msm_disabled/
 * unmapped) keeps the pre-fix behaviour, since those aren't a per-check
 * staleness signal.
 */
import React from 'react';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { GroundingData, Participant, SceneCheck, Session } from '@/lib/api/types';

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
  streamDmNarration: jest.fn(async function* () {
    yield { kind: 'done' as const };
  }),
}));

import * as dnd from '@/lib/api/dnd';
import PlayPage from '@/app/play/[sessionId]/page';

const mGetSession = dnd.getSession as jest.MockedFunction<typeof dnd.getSession>;
const mGetParticipants = dnd.getParticipants as jest.MockedFunction<typeof dnd.getParticipants>;
const mGetGrounding = dnd.getGrounding as jest.MockedFunction<typeof dnd.getGrounding>;
const mResolveCheck = dnd.resolveCheck as jest.MockedFunction<typeof dnd.resolveCheck>;

const SESSION: Session = {
  session_id: 's1',
  channel: 'stale_click_probe',
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

beforeEach(() => {
  jest.clearAllMocks();
  mGetSession.mockResolvedValue(SESSION);
  mGetParticipants.mockResolvedValue(PARTY);
});

describe('Tora-Gesture MAJOR-1 — a stale-grounding check self-corrects after a 409', () => {
  it('a check_locked 409 triggers a grounding self-correction, so a second click cannot fire an identical refusal off stale data', async () => {
    // Client's grounding is stale: it still thinks this check is
    // "available" (e.g. this client hasn't had its poll tick yet since
    // another participant locked it, or since this table's own last attempt
    // locked it moments ago in a separate tab/request). The 409 itself is
    // proof the SERVER already has it locked -- so a real self-correcting
    // re-fetch observes that server truth. First call (initial mount) stays
    // the stale/available shape; every call after that (i.e. the fix's own
    // self-correction refetch) reflects the server's actual (locked) state
    // -- a mock that returned the same stale shape from every call could
    // never distinguish "the fix refetched" from "the fix did nothing".
    mGetGrounding
      .mockResolvedValueOnce(grounding([{ skill: 'survival', dc: 13 }]))
      .mockResolvedValue(
        grounding([
          {
            skill: 'survival',
            dc: 13,
            state: 'locked',
            attempts_used: 2,
            max_attempts: 2,
            lock_reason: 'max_attempts',
          },
        ]),
      );
    mResolveCheck.mockRejectedValue(
      Object.assign(new Error('check_locked'), {
        status: 409,
        body: {
          message: 'You have tried this every way you know — find another way.',
          data: {
            reason: 'check_locked',
            lock_reason: 'max_attempts',
            attempts_used: 2,
            max_attempts: 2,
          },
        },
      }),
    );
    render(<PlayPage />);

    const btn = await screen.findByRole('button', { name: /Attempt Survival/i });

    // Click 1 -- 409.
    await act(async () => {
      fireEvent.click(btn);
    });
    await waitFor(() => expect(mResolveCheck).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith({
        tone: 'info',
        message: 'That approach is closed — find another way.',
      }),
    );

    const groundingCallsAfterFirst409 = mGetGrounding.mock.calls.length;

    // THE ASSERTION UNDER TEST, part 1: the catch block's self-correction
    // fetch actually happened (more than just the initial mount fetch).
    expect(groundingCallsAfterFirst409).toBeGreaterThan(1);

    // Is the button now disabled/relabelled/removed from that
    // self-correction? Or still the plain, clickable "Attempt Survival,
    // DC 13" from the stale grounding?
    const stillThere = screen.queryByRole('button', { name: /Attempt Survival, DC 13/i });

    if (stillThere && !(stillThere as HTMLButtonElement).disabled) {
      // Pre-fix shape: the button never self-corrected, so a second click
      // fires an IDENTICAL second network call and an IDENTICAL second
      // toast. Kept as a live branch (not deleted) so a future regression
      // that silently drops the self-correction still gets caught here,
      // via the SAME symptom this test was originally written to catch.
      await act(async () => {
        fireEvent.click(stillThere);
      });
      await waitFor(() => expect(mResolveCheck).toHaveBeenCalledTimes(2));

      const identicalToastCalls = mockToast.mock.calls.filter(
        (c) =>
          c[0]?.tone === 'info' && c[0]?.message === 'That approach is closed — find another way.',
      ).length;

      expect(identicalToastCalls).toBe(1);
    } else {
      // THE ASSERTION UNDER TEST, part 2 (the fixed/expected shape): the
      // self-corrected grounding (server truth: this check is now locked,
      // which is WHY the 409 happened) means the button genuinely isn't a
      // plain, re-clickable "Attempt" affordance anymore -- either removed
      // from the rail (accessible name changed to "Survival, DC 13 —
      // closed", no longer matching "Attempt Survival, DC 13") or
      // present-but-aria-disabled, depending on exactly which render path a
      // given payload takes. SPEC CHANGE (Iro-A11y MAJOR-3/MAJOR-4,
      // 2026-07-28): a purely-locked check is aria-disabled, not native
      // disabled (see play.check-retry.test.tsx item 21) -- if this branch
      // is ever reached, `toHaveAttribute('aria-disabled', 'true')` is the
      // correct assertion, not `toBeDisabled()`.
      if (stillThere) {
        expect(stillThere).toHaveAttribute('aria-disabled', 'true');
      } else {
        expect(
          screen.queryByRole('button', { name: /Attempt Survival, DC 13/i }),
        ).not.toBeInTheDocument();
      }
    }
  });
});
