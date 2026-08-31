/**
 * Miko-QA drive-by finding, discovered while re-verifying the DDX-20
 * F9+Recap fold (70721c3) — NOT about that fold and NOT about
 * `journalSeenSeqsRef` (see play.ddx20-f9-recap-fold.miko-reqa.adversarial.test.tsx
 * for that verification). This was a SEPARATE, PRE-EXISTING defect in
 * `rehydratedRef` (PLAY-PERSIST §7, page.tsx ~L421, predates DDX-20
 * entirely) surfaced by the SAME same-instance-session-switch construction.
 *
 * FIXED 2026-08-31 (TAV-PLAY-CROSS-SESSION-BLEED, Ren-Dev): this ref, along
 * with `narrationAbort`/`subscribedJobIdRef`/`pendingByKeyRef`/`turnKeyRef`/
 * `lastDurableTurnRef`/`pollFailureGraceRef`/`renderedSeqsRef`/
 * `lastEventSeqRef`/`journalSeenSeqsRef`, is now reset in a dedicated
 * `useEffect(() => () => {...}, [sessionId])` cleanup in page.tsx (declared
 * immediately before the "load session + party" effect). The reachability
 * question below turned out to matter for real: an in-flight DM-narration
 * SSE stream kept writing into whatever session the persisted instance was
 * showing (via `narrationAbort` never being aborted on a session switch),
 * observed live as TAV-PLAY-CROSS-SESSION-BLEED — a different campaign's
 * live state bleeding into the open session for ~2 minutes. The narration-
 * stream half of that bug has its own dedicated regression test in
 * play.cross-session-bleed.test.tsx; THIS file locks the transcript-freeze
 * half, which shares the same root cause and the same fix.
 *
 * ORIGINAL FINDING (kept for history): `rehydratedRef.current` was set
 * `true` once and never reset. The transcript rehydration block (`if
 * (rawEvents && !rehydratedRef.current)`, page.tsx ~L949) — which owns
 * `setLog(rows)`, `lastEventSeqRef`, the X-card scan, AND the sibling
 * `renderedSeqsRef` ledger's own mount-seed — is gated on this ref. On a
 * same-instance sessionId change (mount effect deps `[username, sessionId]`,
 * so the effect DOES re-run), `rehydratedRef.current` was already `true`
 * from the FIRST session, so this entire block was skipped for the second
 * session: the visible transcript (role="log") silently froze on the FIRST
 * session's content and never rehydrated the second session's.
 *
 * Contrast with `journalSeenSeqsRef` (this fold's new ref at the time):
 * its own reseed sits OUTSIDE the `rehydratedRef` gate (a different,
 * unguarded `if (rawEvents)` block just above), so it never shared this
 * defect — that asymmetry is what led here originally.
 *
 * Originally promoted via Jest's `it.failing()` while the defect was
 * accepted-but-unfixed (matching JournalPane.test.tsx's own `it.failing`
 * stale-save-race convention). Per that convention's own rule, a fix
 * flips the assertion to an unexpected PASS, which Jest fails the suite
 * on unless `.failing()` is dropped — that happened here, so `.failing()`
 * is now removed and this is a normal regression test.
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

describe('rehydratedRef resets on a same-instance session switch (TAV-PLAY-CROSS-SESSION-BLEED, fixed 2026-08-31 — was: QA drive-by finding, pre-existing, NOT part of the DDX-20 F9+Recap fold)', () => {
  it('FIXED: after switching from session A to session B (same PlayPage instance), the transcript log shows session B\'s narration, not session A\'s', async () => {
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

    // FIXED (TAV-PLAY-CROSS-SESSION-BLEED): the sessionId-keyed cleanup
    // effect in page.tsx resets rehydratedRef.current = false (among other
    // session-scoped refs) BEFORE the load effect re-fires for session B, so
    // `if (rawEvents && !rehydratedRef.current)` runs again and rehydrates
    // the transcript for the new session.
    expect(log).toHaveTextContent('Table B opens the door.');
    expect(log).not.toHaveTextContent('Table A opens the door.');
  });

  it('regression tripwire: no in-app code currently navigates directly from one /play/[sessionId] to another via router.push/router.replace (the same-instance switch this suite exercises is reachable via React/Next\'s documented same-instance-reuse behavior for a dynamic-segment-only change even without one — see TAV-PLAY-CROSS-SESSION-BLEED; this tripwire only flags a SECOND, more direct reachability path if one is ever added)', () => {
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
    // note it in the review, though it no longer changes the fix's
    // correctness: the reset effect above covers same-instance reuse
    // regardless of what triggers it.
    expect(hits.trim()).toBe('');
  });
});
