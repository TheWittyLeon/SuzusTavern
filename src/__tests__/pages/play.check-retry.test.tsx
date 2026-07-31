/**
 * Check Retry + Fail-Forward (2026-07-28 design) — Tavern client coverage.
 *
 * Maps to the design doc's §10 "Tavern —
 * src/__tests__/pages/play.check-retry.test.tsx" list, items 20-27:
 *   20. resolved -> absent from BOTH render surfaces.
 *   21. locked -> present, disabled, aria-disabled, lock reason sr-only span.
 *   22. last-attempt label at attempts_used=1/max_attempts=2; absent at 0.
 *   23. success + non-empty flag_set -> payoff toast + log row; failure -> neither.
 *   24. 409 check_locked/check_resolved -> curated toast copy, no unhandled rejection.
 *   25. check_resolved in the events poll triggers refreshGrounding() on BOTH
 *       the durable and SSE paths -- NOT re-tested here. It reuses the exact
 *       same generalized "invalidating kind" mechanism `beat_resolved`/
 *       `scene_advance` already prove out in play.struct006-gate-refetch
 *       .test.tsx (durable) and its .flag-off.test.tsx companion (SSE), so
 *       item 25 is covered by extending THOSE two files' existing harnesses
 *       (`check_resolved` added to the durable `it.each` list and a new
 *       companion test on the flag-off file) rather than duplicated here.
 *   26. flag-off dormancy: a check with no `state` field renders exactly as
 *       today.
 *   27. focus: resolving a check whose OWN resolution hides it lands focus
 *       on the scene head, not <body> (the NEW hide-resolved code path,
 *       distinct from the pre-existing scene-change-driven unmount already
 *       covered in play.checks-and-fork.test.tsx's CRITICAL-1 block).
 */
import React from 'react';
import { render, screen, waitFor, fireEvent, act, within } from '@testing-library/react';
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
  putSessionNotes: jest.fn(() => Promise.resolve({ body: '', updated_at: '2026-01-01T00:00:00Z' })),
}));

jest.mock('../../lib/stream', () => ({
  streamDmNarration: jest.fn(async function* () {
    yield { kind: 'done' as const };
  }),
}));

import * as dnd from '@/lib/api/dnd';
import * as stream from '@/lib/stream';
import PlayPage from '@/app/play/[sessionId]/page';

const mGetSession = dnd.getSession as jest.MockedFunction<typeof dnd.getSession>;
const mGetParticipants = dnd.getParticipants as jest.MockedFunction<typeof dnd.getParticipants>;
const mGetGrounding = dnd.getGrounding as jest.MockedFunction<typeof dnd.getGrounding>;
const mGetSessionEvents = dnd.getSessionEvents as jest.MockedFunction<typeof dnd.getSessionEvents>;
const mGetSessionEventsRaw = dnd.getSessionEventsRaw as jest.MockedFunction<
  typeof dnd.getSessionEventsRaw
>;
const mResolveCheck = dnd.resolveCheck as jest.MockedFunction<typeof dnd.resolveCheck>;
const mStream = stream.streamDmNarration as jest.MockedFunction<typeof stream.streamDmNarration>;

// ── Fixtures ──────────────────────────────────────────────────────────────────

const SESSION: Session = {
  session_id: 's1',
  channel: 'checkretry_channel',
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

function streamOnce() {
  mStream.mockImplementation(async function* () {
    yield { kind: 'chunk' as const, text: 'Suzu narrates.' };
    yield { kind: 'done' as const };
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mGetSession.mockResolvedValue(SESSION);
  mGetParticipants.mockResolvedValue(PARTY);
  mGetSessionEvents.mockResolvedValue([]);
  mGetSessionEventsRaw.mockResolvedValue(null);
  streamOnce();
});

// ── item 20: resolved -> absent from BOTH render surfaces ───────────────────

describe('item 20 — a resolved check is fully hidden', () => {
  it('is absent from both the canonical .checkWrap group and the composer chip row', async () => {
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
    const { container } = render(<PlayPage />);
    await screen.findByRole('textbox');

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /Survival/i })).not.toBeInTheDocument();
    });
    // The composer chip row is aria-hidden -- queryByRole above already
    // proves the canonical group is gone; this proves the WHOLE chip
    // wrapper never mounted either (both surfaces derive from the same
    // filtered availableChecks memo).
    expect(container.querySelector('[class*="checkChipsWrap"]')).toBeNull();
  });
});

// ── item 21: locked -> present, disabled, aria-disabled, sr-only reason ─────

describe('item 21 — a locked check stays visible, Tab-reachable, and aria-disabled', () => {
  it('renders aria-disabled (NOT native disabled) with the lock reason in an sr-only span, and a click is a no-op', async () => {
    // SPEC CHANGE (Iro-A11y MAJOR-3/MAJOR-4, 2026-07-28): a purely-locked
    // check (no other transient busy state) is deliberately NOT native
    // `disabled` anymore -- native disabled pulls an element out of the tab
    // order entirely (a keyboard/screen-reader user could never reach it to
    // hear the sr-only close reason), and the generic `.checkBtn:disabled`
    // opacity rule was measured dropping contrast to 2.93:1 in candlelit (a
    // WCAG FAIL). The click itself is guarded in JS instead
    // (`if (isLocked) return;`, page.tsx). This test previously asserted
    // native `disabled`; updated to assert `aria-disabled` + Tab-reachable +
    // click-noop instead.
    mGetGrounding.mockResolvedValue(
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
    render(<PlayPage />);

    const btn = await screen.findByRole('button', { name: /Survival, DC 13 — closed/i });
    expect(btn).not.toBeDisabled();
    expect(btn).toHaveAttribute('aria-disabled', 'true');
    expect(within(btn).getByText('Out of attempts.')).toBeInTheDocument();

    // Tab-reachable: a non-native-disabled button accepts programmatic
    // focus and is in the default tab order (native `disabled` is the only
    // thing that would remove it).
    act(() => btn.focus());
    expect(btn).toHaveFocus();

    // Click-noop: clicking a locked button must not attempt the check.
    await act(async () => {
      fireEvent.click(btn);
    });
    expect(mResolveCheck).not.toHaveBeenCalled();
  });

  it('maps nat1 and fail_by_5 to their own reason copy', async () => {
    mGetGrounding.mockResolvedValue(
      grounding([
        {
          skill: 'survival',
          dc: 13,
          state: 'locked',
          attempts_used: 0,
          max_attempts: 2,
          lock_reason: 'nat1',
        },
      ]),
    );
    render(<PlayPage />);
    const btn = await screen.findByRole('button', { name: /Survival, DC 13 — closed/i });
    expect(within(btn).getByText('A critical failure closed this approach.')).toBeInTheDocument();
  });
});

// ── item 22: last-attempt label ──────────────────────────────────────────────

describe('item 22 — last-attempt label', () => {
  it('carries "last attempt" when exactly one attempt remains', async () => {
    mGetGrounding.mockResolvedValue(
      grounding([
        {
          skill: 'survival',
          dc: 13,
          state: 'available',
          attempts_used: 1,
          max_attempts: 2,
          lock_reason: null,
        },
      ]),
    );
    render(<PlayPage />);
    await screen.findByRole('button', { name: /Attempt Survival, DC 13 — last attempt/i });
  });

  it('does not carry "last attempt" at zero attempts used', async () => {
    mGetGrounding.mockResolvedValue(
      grounding([
        {
          skill: 'survival',
          dc: 13,
          state: 'available',
          attempts_used: 0,
          max_attempts: 2,
          lock_reason: null,
        },
      ]),
    );
    render(<PlayPage />);
    const btn = await screen.findByRole('button', { name: /Attempt Survival, DC 13/i });
    expect(btn).not.toHaveTextContent(/last attempt/i);
  });
});

// ── item 23: success payoff toast + log row; failure gets neither ──────────

describe('item 23 — success payoff signal', () => {
  it('a success with a set flag fires the payoff toast and appends a log row', async () => {
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

    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith({ tone: 'success', message: 'The way forward opens.' }),
    );
    await waitFor(() =>
      expect(screen.getByText('✦ The way forward opens.')).toBeInTheDocument(),
    );
  });

  it('a failed check fires neither the payoff toast nor the payoff log row', async () => {
    mGetGrounding.mockResolvedValue(grounding([{ skill: 'survival', dc: 13 }]));
    mResolveCheck.mockResolvedValue({
      skill: 'survival',
      dc: 13,
      total: 5,
      success: false,
      flag_set: [],
      mechanics: 'Survival check: rolled 2 + 2 = 5 vs DC 13 — failure.',
      description: 'Survival check (DC 13): 5 — failure.',
    });
    render(<PlayPage />);

    const btn = await screen.findByRole('button', { name: /Attempt Survival/i });
    await act(async () => {
      fireEvent.click(btn);
    });

    await waitFor(() =>
      expect(screen.getByText('Survival check (DC 13): 5 — failure.')).toBeInTheDocument(),
    );
    expect(mockToast).not.toHaveBeenCalledWith({
      tone: 'success',
      message: 'The way forward opens.',
    });
    expect(screen.queryByText('✦ The way forward opens.')).not.toBeInTheDocument();
  });

  it('a success with an EMPTY flag_set (no gating flag authored) fires neither payoff signal', async () => {
    mGetGrounding.mockResolvedValue(grounding([{ skill: 'survival', dc: 13 }]));
    mResolveCheck.mockResolvedValue({
      skill: 'survival',
      dc: 13,
      total: 16,
      success: true,
      flag_set: [],
      mechanics: 'Survival check: rolled 14 + 2 = 16 vs DC 13 — success.',
      description: 'Survival check (DC 13): 16 — success.',
    });
    render(<PlayPage />);

    const btn = await screen.findByRole('button', { name: /Attempt Survival/i });
    await act(async () => {
      fireEvent.click(btn);
    });

    await waitFor(() =>
      expect(screen.getByText('Survival check (DC 13): 16 — success.')).toBeInTheDocument(),
    );
    expect(mockToast).not.toHaveBeenCalledWith({
      tone: 'success',
      message: 'The way forward opens.',
    });
    expect(screen.queryByText('✦ The way forward opens.')).not.toBeInTheDocument();
  });
});

// ── item 24: 409 curated copy, no unhandled rejection ───────────────────────

describe('item 24 — 409 refusals surface curated toast copy', () => {
  it('check_locked surfaces the curated closed-door copy', async () => {
    mGetGrounding.mockResolvedValue(grounding([{ skill: 'survival', dc: 13 }]));
    mResolveCheck.mockRejectedValue(
      Object.assign(new Error('check_locked'), {
        status: 409,
        body: {
          message: 'You have tried this every way you know — find another way.',
          data: { reason: 'check_locked', lock_reason: 'max_attempts', attempts_used: 2, max_attempts: 2 },
        },
      }),
    );
    render(<PlayPage />);

    const btn = await screen.findByRole('button', { name: /Attempt Survival/i });
    await act(async () => {
      fireEvent.click(btn);
    });

    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith({
        tone: 'info',
        message: 'That approach is closed — find another way.',
      }),
    );
  });

  it('check_resolved surfaces the curated already-settled copy, with no unhandled rejection', async () => {
    mGetGrounding.mockResolvedValue(grounding([{ skill: 'survival', dc: 13 }]));
    mResolveCheck.mockRejectedValue(
      Object.assign(new Error('check_resolved'), {
        status: 409,
        body: {
          message: 'This check has already been resolved.',
          data: { reason: 'check_resolved', lock_reason: 'resolved', attempts_used: null, max_attempts: null },
        },
      }),
    );
    render(<PlayPage />);

    const btn = await screen.findByRole('button', { name: /Attempt Survival/i });
    await act(async () => {
      fireEvent.click(btn);
    });

    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith({
        tone: 'info',
        message: "You've already settled that one.",
      }),
    );
  });
});

// ── item 26: flag-off dormancy ───────────────────────────────────────────────

describe('item 26 — flag-off dormancy', () => {
  it('a check with no state/attempts_used/max_attempts/lock_reason field renders exactly as today', async () => {
    mGetGrounding.mockResolvedValue(grounding([{ skill: 'survival', dc: 13 }]));
    render(<PlayPage />);

    const btn = await screen.findByRole('button', { name: /^Attempt Survival, DC 13$/i });
    expect(btn).not.toBeDisabled();
    expect(btn).not.toHaveAttribute('aria-disabled', 'true');
    expect(btn).not.toHaveTextContent(/closed/i);
    expect(btn).not.toHaveTextContent(/last attempt/i);
  });
});

// ── item 27: focus rescue on the NEW hide-resolved path ─────────────────────

describe('item 27 — focus rescue when a check hides itself by resolving', () => {
  it('moves focus to the scene heading when a check unmounts via its OWN resolution (same scene, no advance)', async () => {
    const before = grounding([{ skill: 'survival', dc: 13 }]);
    const after = grounding([
      {
        skill: 'survival',
        dc: 13,
        state: 'resolved',
        attempts_used: null,
        max_attempts: null,
        lock_reason: 'resolved',
      },
    ]);
    mGetGrounding.mockResolvedValueOnce(before).mockResolvedValue(after);
    mResolveCheck.mockResolvedValue({
      skill: 'survival',
      dc: 13,
      total: 16,
      success: true,
      flag_set: ['beat_everfree_flight_crossed_forest'],
      mechanics: 'Survival check: rolled 14 + 2 = 16 vs DC 13 — success.',
      description: 'Survival check (DC 13): 16 — success.',
    });

    const { container } = render(<PlayPage />);
    const btn = await screen.findByRole('button', { name: /Attempt Survival/i });

    act(() => btn.focus());
    expect(btn).toHaveFocus();

    await act(async () => {
      fireEvent.click(btn);
    });

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /Attempt Survival/i })).not.toBeInTheDocument();
    });
    const sceneHead = container.querySelector('[aria-label^="Scene:"]');
    expect(sceneHead).not.toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(sceneHead));
  });
});
