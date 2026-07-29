/**
 * Check Retry + Fail-Forward (2026-07-28 design) — Iro-A11y MAJOR-2
 * regression pin (PROMOTED from play.check-retry.iro-a11y.probe.test.tsx
 * on 2026-07-28, after Ren-Dev's fix landed).
 *
 * FINDING A — double announcement. Originally demonstrated that
 * onAttemptCheck's success-payoff block (page.tsx design §7.3, ~L3450-3453)
 * fired BOTH:
 *   - toast({ tone: 'success', message: 'The way forward opens.' })  — lands
 *     in ToastViewport, which is aria-live="polite" (Toast.tsx L217) with
 *     each card ALSO role="status" (implicit aria-live="polite").
 *   - appendLog({ kind: 'system', text: '✦ The way forward opens.' })  —
 *     landed as a new row inside ChatLog's OWN aria-live="polite" role="log"
 *     region (ChatLog.tsx L180-182), and (before this fix) was not marked
 *     `streaming`, so it was NOT `aria-hidden` (ChatLog.tsx ~L246) -- i.e.
 *     it WAS picked up and announced by that second, independent live
 *     region too.
 *   Two independent aria-live="polite" regions, near-duplicate text
 *   ("The way forward opens." / "✦ The way forward opens."), same tick.
 *   This is the exact anti-pattern this file's own codebase has previously
 *   named and avoided elsewhere -- see page.tsx's `turnStatusText` comment
 *   ("ChatLog's own live region already announces each roll's outcome, so
 *   folding the tally into this label too would double-announce the same
 *   event through two separate aria-live regions") and the
 *   `beginEncounterVisibleRef` effect comment ("the toast remains the safe,
 *   out-of-band channel").
 *
 * FIXED (Ren-Dev, 2026-07-28): `LogRow` gained an optional `silent?: boolean`
 * field (mirroring the existing `streaming` convention exactly), set `true`
 * on the payoff row; `ChatLog.tsx`'s aria-hidden condition widened from
 * `r.streaming` to `r.streaming || r.silent`. The row still renders
 * normally for sighted/scrollback readers -- it is only removed from the
 * accessibility tree. The toast remains the one spoken channel for the
 * ACTING client; MAJOR-1's disappearance-explanation row (a DIFFERENT,
 * non-silent row, for spectators/non-acting clients) is the spoken channel
 * for everyone else at the table.
 *
 * FINDING B (documented, not asserted here — see the original audit report)
 * — the mechanics-derived FIRST log row (`result.description`, appended just
 * before the payoff block) can carry the pre-existing "Flag {key} set."
 * leak (design doc §1 wart 1, out of scope for this feature). Not
 * re-litigated as a fresh defect; noted only because it lands in the SAME
 * always-live ChatLog region as Finding A, one row above it.
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
  channel: 'iro_a11y_probe_channel',
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

describe('Iro-A11y MAJOR-2 — success-payoff toast is the one spoken channel', () => {
  it('the payoff toast announces the beat; the matching ChatLog row is hidden from the accessibility tree (no double announcement)', async () => {
    mGetGrounding.mockResolvedValue(grounding([{ skill: 'survival', dc: 13 }]));
    mResolveCheck.mockResolvedValue({
      skill: 'survival',
      dc: 13,
      total: 16,
      success: true,
      flag_set: ['beat_everfree_flight_crossed_forest'],
      mechanics: 'Survival check: rolled 14 + 2 = 16 vs DC 13 — success.',
      description: 'Survival check (DC 13): 16 — success.',
    });
    render(<PlayPage />);

    const btn = await screen.findByRole('button', { name: /Attempt Survival/i });
    await act(async () => {
      fireEvent.click(btn);
    });

    // Channel 1: the toast (ToastViewport, aria-live="polite" per Toast.tsx)
    // is the one spoken announcement for this beat.
    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith({ tone: 'success', message: 'The way forward opens.' }),
    );

    // Channel 2: the SAME beat also lands as a row inside ChatLog's role="log"
    // aria-live="polite" region (for sighted/scrollback readers), but that
    // row is now excluded from the accessibility tree via aria-hidden --
    // FIXED (Ren-Dev): a screen reader observing the log region will NOT
    // re-announce it independently of the toast.
    const logRegion = await screen.findByRole('log');
    const payoffText = await waitFor(() => screen.getByText('✦ The way forward opens.'));
    expect(logRegion).toContainElement(payoffText);

    const payoffRow = payoffText.parentElement; // .what -> .row
    expect(payoffRow).not.toBeNull();
    // THE ASSERTION UNDER TEST: the row is present (sighted/scrollback
    // readers still see it) but hidden from the accessibility tree, exactly
    // mirroring the `streaming` row convention.
    expect(payoffRow).toHaveAttribute('aria-hidden', 'true');
  });
});
