/**
 * Auth-gate coverage for /play/[sessionId] (UIR2-TAV-3) — the single
 * highest-risk retrofit site (2900+ line file, no auth gate existed here at
 * all pre-diff). Every one of the 19 pre-existing play.*.test.tsx files
 * mocks useAuth() with an always-truthy `user`, so useAuthGate short-circuits
 * at `if (user) return null` before ever exercising the new redirect/
 * SessionExpired branches — none of them prove the retrofit itself does
 * anything on this specific page. This file mounts the REAL PlayPage with a
 * null user and proves: no session/party/DM UI ever renders, no crash (hook
 * order survives a genuinely-null user for the first time in this file's own
 * suite), and the auth gate wins even when the session-state machine
 * resolves to 'ok' underneath it.
 */
import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { Participant, Session } from '@/lib/api/types';

const mockReplace = jest.fn();
const mockPathname = jest.fn(() => '/play/s1');
jest.mock('next/navigation', () => ({
  useParams: () => ({ sessionId: 's1' }),
  useRouter: () => ({ replace: mockReplace }),
  usePathname: () => mockPathname(),
}));

const mockToast = jest.fn();
jest.mock('../../components/Toast', () => ({
  useToast: () => ({ toast: mockToast }),
}));

const mockUseAuth = jest.fn();
jest.mock('../../lib/auth/AuthProvider', () => ({
  useAuth: () => mockUseAuth(),
}));

jest.mock('../../lib/useReducedMotion', () => ({
  useReducedMotion: () => true,
}));

jest.mock('../../lib/api/dnd', () => ({
  getSession: jest.fn(),
  getSessionEvents: jest.fn(() => Promise.resolve([])),
  getSessionEventsRaw: jest.fn(() => Promise.resolve(null)),
  getParticipants: jest.fn(),
  getGrounding: jest.fn(() => Promise.resolve(null)),
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
  pauseSession: jest.fn(),
  resumeSession: jest.fn(),
  endSession: jest.fn(),
  awardSessionXp: jest.fn(),
  resolveCheck: jest.fn(),
  postRoll: jest.fn(),
  bindCharacter: jest.fn(),
  listMyCharacters: jest.fn(() => Promise.resolve([])),
  // DDX-22 Phase 3: JournalPane is now unconditionally mounted on the play
  // page (only its CSS visibility/inert state is gated by journalVisible —
  // see page.tsx's <aside id="play-pane-journal">), so every render of this
  // page fires a getSessionNotes() GET regardless of whether the journal is
  // ever opened. Default to "no note yet" so this suite stays hermetic.
  getSessionNotes: jest.fn(() => Promise.resolve(null)),
  putSessionNotes: jest.fn(() => Promise.resolve({ body: '', updated_at: '2026-01-01T00:00:00Z' })),
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

const SESSION: Session = {
  session_id: 's1',
  channel: 'the_hollow_tide',
  status: 'active',
  dm_username: 'suzu',
  participant_usernames: ['alice'],
  player_count: 1,
  active_combat_id: null,
  dm_mode: 'ai',
  visibility: 'public',
  content_rating: 'sfw',
};

const PARTY: Participant[] = [
  {
    username: 'alice',
    is_dm: false,
    character: {
      character_id: 'c1',
      name: 'Velka',
      char_class: 'Rogue',
      level: 1,
      current_hp: 8,
      max_hp: 10,
      ac: 14,
    },
  },
];

beforeEach(() => {
  mockReplace.mockClear();
  mockPathname.mockClear();
  mockToast.mockClear();
  mockUseAuth.mockReset();
  mGetSession.mockReset();
  mGetParticipants.mockReset();
  // Session data resolves successfully by default in every test here — the
  // point is proving the AUTH gate wins regardless of what the session
  // state machine does underneath it, not that data-loading is broken.
  mGetSession.mockResolvedValue(SESSION);
  mGetParticipants.mockResolvedValue(PARTY);
});

describe('PlayPage — genuinely logged out (no crash, no leaked session UI)', () => {
  it('redirects to /login and never renders party/chat/session chrome, even once session data resolves', async () => {
    mockUseAuth.mockReturnValue({
      user: null,
      loading: false,
      maybeAuthed: false,
      authError: null,
      retryAuth: jest.fn(),
    });

    render(<PlayPage />);

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/login'));

    // Give any pending microtasks a beat, then confirm the session-loading
    // effect (page.tsx ~493-494: `if (!username || !sessionId) return;`)
    // never even STARTS while logged out — a stronger property than "the
    // gate wins over resolved data": there's no wasted/leaked fetch for an
    // unauthenticated visitor to race against in the first place. (Initial
    // draft of this test assumed the fetch fires regardless of auth state
    // and asserted the gate wins anyway — checking the source directly
    // showed that assumption was wrong; asserting the truer, stronger
    // property instead of leaving the disproven one in place.)
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mGetSession).not.toHaveBeenCalled();
    expect(mGetParticipants).not.toHaveBeenCalled();

    // None of the real play UI ever reached the DOM.
    expect(screen.queryByText('Velka')).not.toBeInTheDocument();
    expect(screen.queryByRole('log')).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });
});

describe('PlayPage — failed silent refresh (authError), the never-before-tested branch on this page', () => {
  it('authError="expired" shows SessionExpired instead of the play UI — no crash despite this file`s 100+ hooks running with a null user for the first time', async () => {
    mockUseAuth.mockReturnValue({
      user: null,
      loading: false,
      maybeAuthed: false,
      authError: 'expired',
      retryAuth: jest.fn(),
    });

    render(<PlayPage />);

    expect(
      await screen.findByRole('heading', { name: /your session has ended/i }),
    ).toBeInTheDocument();
    expect(screen.queryByText('Velka')).not.toBeInTheDocument();
    expect(mockReplace).not.toHaveBeenCalled();
    // Exactly one main landmark — no duplicate #main-content id from a shell
    // that (correctly) never mounts alongside SessionExpired.
    expect(document.querySelectorAll('#main-content')).toHaveLength(1);
  });

  it('authError="rate_limited" shows the retry variant wired to retryAuth(), never the play UI', async () => {
    const retryAuth = jest.fn().mockResolvedValue(undefined);
    mockUseAuth.mockReturnValue({
      user: null,
      loading: false,
      maybeAuthed: false,
      authError: 'rate_limited',
      retryAuth,
    });

    render(<PlayPage />);

    const retryButton = await screen.findByRole('button', { name: /try again/i });
    retryButton.click();
    await waitFor(() => expect(retryAuth).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('Velka')).not.toBeInTheDocument();
  });
});

describe('PlayPage — resolving state uses the bounded skeleton, never renders session UI early', () => {
  it('loading/maybeAuthed shows the auth skeleton (not the session skeleton, not real content) while resolving', async () => {
    mockUseAuth.mockReturnValue({
      user: null,
      loading: true,
      maybeAuthed: true,
      authError: null,
      retryAuth: jest.fn(),
    });

    render(<PlayPage />);

    // Iro-A11y MAJOR-1: wrapper is the landmark only (no aria-label) — the
    // loading announcement lives in PageSkeleton's role="status".
    expect(screen.getByRole('main')).toHaveAttribute('id', 'main-content');
    expect(screen.queryByText('Velka')).not.toBeInTheDocument();
    expect(mockReplace).not.toHaveBeenCalled();
  });
});

describe('PlayPage — positive control: a real user still reaches the real session UI', () => {
  it('user present renders the actual play page content (proves the gate is not blocking the legitimate case)', async () => {
    mockUseAuth.mockReturnValue({
      user: { id: 1, username: 'alice', email: null },
      loading: false,
      maybeAuthed: false,
      authError: null,
      retryAuth: jest.fn(),
    });

    render(<PlayPage />);

    // "Velka" legitimately appears more than once once real content mounts
    // (party list + elsewhere) — getAllByText tolerates that; the point is
    // proving real content reached the DOM at all.
    await waitFor(() => expect(screen.getAllByText('Velka').length).toBeGreaterThan(0));
    expect(screen.getByText('The Hollow Tide')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /your session has ended|hold on a moment/i })).not.toBeInTheDocument();
  });
});
