/**
 * Miko-QA drive-by finding, discovered while re-verifying the DDX-20
 * F9+Recap fold (70721c3) — NOT about that fold and NOT about
 * `journalSeenSeqsRef` (see play.ddx20-f9-recap-fold.miko-reqa.adversarial.test.tsx
 * for that verification). This is a SEPARATE, PRE-EXISTING defect in
 * `rehydratedRef` (PLAY-PERSIST §7, page.tsx ~L421, predates DDX-20
 * entirely) surfaced by the SAME same-instance-session-switch construction.
 *
 * FINDING: `rehydratedRef.current` is set `true` once and NEVER reset. The
 * transcript rehydration block (`if (rawEvents && !rehydratedRef.current)`,
 * page.tsx ~L949) — which owns `setLog(rows)`, `lastEventSeqRef`, the X-card
 * scan, AND the sibling `renderedSeqsRef` ledger's own mount-seed — is gated
 * on this ref. On a same-instance sessionId change (mount effect deps
 * `[username, sessionId]`, so the effect DOES re-run), `rehydratedRef.current`
 * is already `true` from the FIRST session, so this entire block is skipped
 * for the second session: the visible transcript (role="log") silently
 * freezes on the FIRST session's content and never rehydrates the second
 * session's.
 *
 * Contrast with `journalSeenSeqsRef` (this fold's new ref): its own reseed
 * sits OUTSIDE the `rehydratedRef` gate (a different, unguarded `if
 * (rawEvents)` block just above), so it does NOT share this defect — that
 * asymmetry is what led here. `journalSeenSeqsRef` reseeding correctly is
 * VERIFIED, not assumed, in the sibling file above.
 *
 * SCOPE / WHY THIS IS NOT BLOCKING THIS FOLD'S GATE:
 *   - `rehydratedRef`'s gating logic is unchanged by 6e027cf and 70721c3 —
 *     git blame predates DDX-20. Not introduced by, or touched by, the fold
 *     under review.
 *   - Currently UNREACHABLE via any in-app navigation: `grep -rn
 *     "useRouter|router.push|router.replace" src/app/play` (excluding
 *     __tests__) returns nothing, and every `/play/` reference elsewhere in
 *     the repo is an inbound Link from a genuinely different top-level route
 *     (dashboard, modules, LevelUpButton), which forces a real unmount, not
 *     a same-instance switch. This test's precondition (same PlayPage
 *     instance reused across two different sessionIds) requires either a
 *     future in-app "switch table" feature or reliance on React/Next's
 *     documented same-instance-reuse behavior for a dynamic-segment-only
 *     change — neither is live today.
 *   - Not one of the explicitly carried items for this gate (F3 turnKeyRef,
 *     T2, T3, G1 whitespace) — a genuinely new, separate observation, not a
 *     reopened one.
 *
 * Filed here as a durable, re-runnable characterization lock instead of
 * only a prose note. Locked via Jest's `it.failing()` (Ren-Dev, DDX-20
 * fold-pass polish) rather than left RED — matches this repo's existing
 * convention for a known, accepted-but-not-yet-fixed defect (see
 * JournalPane.test.tsx's own `it.failing` stale-save-race lock). The test
 * body below is UNCHANGED from the original repro: it still asserts the
 * CORRECT (desired) behavior, not the buggy one — `it.failing()` just
 * expects that assertion to keep failing, so the suite reports it as green
 * while the defect exists. The day someone fixes `rehydratedRef`'s reset,
 * this test flips to an unexpected PASS, which Jest fails the suite on —
 * that's the trigger to drop `.failing()` and promote it into a real
 * regression test. The sibling reachability tripwire below is a SEPARATE
 * concern (whether the bug is reachable, not whether it's fixed) and is
 * unaffected by this — do not remove or weaken it.
 *
 * Recommend a follow-up ticket to reset `rehydratedRef.current = false`
 * (and re-seed `renderedSeqsRef`/`lastEventSeqRef` accordingly) whenever
 * `sessionId` itself changes, mirroring how `journalSeenSeqsRef`'s own
 * reseed already behaves correctly — Ren-Dev's call on the exact fix shape,
 * not built here (out of scope for this pass).
 */
import React from 'react';
import { execSync } from 'node:child_process';
import { render, screen, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { EngineSessionEvent, GroundingData, Participant, Session } from '@/lib/api/types';

let mockSessionId = 's1';
jest.mock('next/navigation', () => ({
  useParams: () => ({ sessionId: mockSessionId }),
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

// Flag-OFF deliberately — this defect lives in the PLAY-PERSIST rehydration
// path shared by both flag states, and reproducing it flag-OFF proves it has
// nothing to do with DDX-20's durable-generation machinery at all.
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
const mockGetGrounding = jest.fn<Promise<GroundingData | null>, unknown[]>(() =>
  Promise.resolve(null),
);
const mockGetCombatState = jest.fn<Promise<unknown>, unknown[]>(() => Promise.resolve(null));
const mockGetCharacterSheet = jest.fn<Promise<unknown>, unknown[]>(() => Promise.resolve(null));
const mockPostSessionEvent = jest.fn<Promise<unknown>, unknown[]>(() => Promise.resolve({}));

jest.mock('../../lib/api/dnd', () => ({
  getSession: (...args: Parameters<AnyFn>) => mockGetSession(...args),
  getSessionEvents: (...args: Parameters<AnyFn>) => mockGetSessionEvents(...args),
  getSessionEventsRaw: (...args: Parameters<AnyFn>) => mockGetSessionEventsRaw(...args),
  getParticipants: (...args: Parameters<AnyFn>) => mockGetParticipants(...args),
  getGrounding: (...args: Parameters<AnyFn>) => mockGetGrounding(...args),
  getCombatState: (...args: Parameters<AnyFn>) => mockGetCombatState(...args),
  getCharacterSheet: (...args: Parameters<AnyFn>) => mockGetCharacterSheet(...args),
  postSessionEvent: (...args: Parameters<AnyFn>) => mockPostSessionEvent(...args),
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
  putSessionNotes: jest.fn(() =>
    Promise.resolve({ body: '', updated_at: '2026-01-01T00:00:00Z' }),
  ),
}));

jest.mock('../../lib/stream', () => ({
  streamDmNarration: jest.fn(),
  postDmTurn: jest.fn(),
  subscribeDmJob: jest.fn(),
}));

import PlayPage from '@/app/play/[sessionId]/page';

const PARTY: Participant[] = [
  {
    username: 'leon',
    is_dm: false,
    character: {
      character_id: 'c1',
      name: 'Velka',
      char_class: 'Rogue',
      level: 3,
      current_hp: 18,
      max_hp: 20,
      ac: 14,
    },
  },
];

function makeSession(id: string, name: string): Session {
  return {
    session_id: id,
    channel: 'test_channel',
    name,
    status: 'active',
    dm_username: 'suzu',
    dm_mode: 'ai',
    ai_assist_level: 'full',
    active_combat_id: null,
  };
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSessionId = 's1';
  mockGetSessionEvents.mockResolvedValue([]);
  mockGetParticipants.mockResolvedValue(PARTY);
  mockGetGrounding.mockResolvedValue(null);
  mockGetCombatState.mockResolvedValue(null);
  mockGetCharacterSheet.mockResolvedValue(null);
  mockPostSessionEvent.mockResolvedValue({});
});

describe('QA drive-by finding — rehydratedRef never resets, freezing the transcript on a same-instance session switch (pre-existing, NOT part of the DDX-20 F9+Recap fold)', () => {
  // it.failing (Ren-Dev, DDX-20 fold-pass polish): asserts the DESIRED
  // (correct) behavior, which `rehydratedRef` does not currently implement
  // — see the file header above for the full finding. Pre-existing,
  // predates DDX-20, currently UNREACHABLE (header + the tripwire test
  // below explain why). If a future fix makes this pass, Jest fails the
  // suite (test.failing requires the body to keep failing) as a signal to
  // drop `.failing` — same convention as JournalPane.test.tsx's own
  // `it.failing` stale-save-race lock.
  it.failing('FINDING: after switching from session A to session B (same PlayPage instance), the transcript log still shows session A\'s narration, not session B\'s', async () => {
    const SESSION_A = makeSession('s1', 'Table A');
    const SESSION_B = makeSession('s2', 'Table B');
    const EVENTS_A: EngineSessionEvent[] = [
      {
        seq: 1,
        kind: 'narration',
        created_at: '2026-07-14T09:01:05Z',
        data: { who: 'Suzu', text: 'Table A opens the door.' },
      },
    ];
    const EVENTS_B: EngineSessionEvent[] = [
      {
        seq: 1,
        kind: 'narration',
        created_at: '2026-07-15T09:01:05Z',
        data: { who: 'Suzu', text: 'Table B opens the door.' },
      },
    ];

    mockGetSession.mockImplementation((...args: unknown[]) =>
      Promise.resolve(args[0] === 's2' ? SESSION_B : SESSION_A),
    );
    mockGetSessionEventsRaw.mockImplementation((...args: unknown[]) =>
      Promise.resolve(args[0] === 's2' ? [...EVENTS_B] : [...EVENTS_A]),
    );

    const { rerender } = render(<PlayPage />);
    await screen.findByText('Table A');
    await flush();

    const log = await screen.findByRole('log');
    expect(log).toHaveTextContent('Table A opens the door.');

    // ── the switch: SAME component instance, sessionId prop changes ────────
    mockSessionId = 's2';
    rerender(<PlayPage />);
    await screen.findByText('Table B');
    await flush();

    // EXPECTED (correct) behaviour: the transcript rehydrates for session B.
    // ACTUAL (this finding): rehydratedRef.current is already true from
    // session A, so page.tsx's `if (rawEvents && !rehydratedRef.current)`
    // block — which owns setLog(rows) — never runs again. The transcript is
    // frozen on session A's content.
    expect(log).toHaveTextContent('Table B opens the door.');
    expect(log).not.toHaveTextContent('Table A opens the door.');
  });

  it("regression tripwire: no in-app code currently navigates directly from one /play/[sessionId] to another (if this ever changes, the FINDING above stops being 'theoretical' and starts being a live, user-visible defect)", () => {
    const repoRoot = process.cwd();
    let hits = '';
    try {
      hits = execSync(
        'grep -rn "useRouter\\|router\\.push\\|router\\.replace" src/app/play --include="*.tsx" --include="*.ts" | grep -v __tests__ || true',
        { cwd: repoRoot, encoding: 'utf8' },
      );
    } catch {
      hits = '';
    }
    // If this fails, someone added self-navigation inside the play route —
    // re-triage the FINDING above as live, not theoretical, before merging
    // whatever added it.
    expect(hits.trim()).toBe('');
  });
});
