/**
 * DDX-25 — DM-only session lifecycle controls (Pause/Resume, End, Award XP).
 *
 * Mirrors the mocking structure of play.sprint5-dm-console.test.tsx (closest
 * sibling: another DM-only-surface suite).
 *
 * AC coverage:
 * DDX25-AC1  DM seat sees the "Session controls" group; non-DM does not.
 * DDX25-AC2  Pause -> Resume toggle: click calls pauseSession, then refetches
 *            getSession; once the refetch reports paused, the button flips to
 *            "Resume" and calls resumeSession on the next click.
 * DDX25-AC3  End session: click opens ConfirmDialog; Cancel never calls the
 *            API; confirming calls endSession + refetches the session.
 * DDX25-AC4  A paused session shows the persistent live-region banner and
 *            disables the composer; an active session leaves it enabled.
 * DDX25-AC5  Award XP: submit is disabled until a valid (>0) amount is
 *            entered, then calls awardSessionXp with the trimmed reason.
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

// mock-prefixed so the jest.mock hoist allow-list permits referencing it.
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
  advanceScene: jest.fn(),
  resolveCheck: jest.fn(),
  setFlag: jest.fn(),
  bindCharacter: jest.fn(() =>
    Promise.resolve({ campaign_id: 's1', username: 'dm_alice', role: 'dm', character_id: null }),
  ),
  listMyCharacters: jest.fn(() => Promise.resolve([])),
}));

jest.mock('../../lib/stream', () => ({
  streamDmNarration: jest.fn(),
}));

import PlayPage from '@/app/play/[sessionId]/page';
import type { Session, Participant } from '@/lib/api/types';

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

const DM_PARTY: Participant[] = [{ username: 'dm_alice', is_dm: true, character: null }];

function setup(session: Session = BASE_SESSION, participants: Participant[] = DM_PARTY) {
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
}

async function renderAndWaitForControls() {
  render(<PlayPage />);
  await waitFor(() =>
    expect(screen.queryByRole('group', { name: /Session controls/i })).toBeInTheDocument(),
  );
  return screen.getByRole('group', { name: /Session controls/i });
}

describe('DDX-25 — Session controls: DM gate', () => {
  it('DDX25-AC1a: DM seat sees Pause / End session / Award XP', async () => {
    mockUsername = 'dm_alice';
    setup();
    const group = await renderAndWaitForControls();
    expect(within(group).getByRole('button', { name: /^Pause$/i })).toBeInTheDocument();
    expect(within(group).getByRole('button', { name: /End session/i })).toBeInTheDocument();
    expect(within(group).getByRole('button', { name: /Award XP/i })).toBeInTheDocument();
  });

  it('DDX25-AC1b: non-DM player never sees the Session controls group', async () => {
    mockUsername = 'bob';
    setup(BASE_SESSION, [{ username: 'bob', is_dm: false, character: null }]);
    render(<PlayPage />);
    await waitFor(() => expect(mockGetSession).toHaveBeenCalled());
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByRole('group', { name: /Session controls/i })).not.toBeInTheDocument();
  });
});

describe('DDX-25 — Pause / Resume toggle', () => {
  it('DDX25-AC2: Pause calls pauseSession + refetches; label flips; Resume calls resumeSession', async () => {
    mockUsername = 'dm_alice';
    setup();
    await renderAndWaitForControls();

    // The DDX-25 post-action refetch reports the session as paused.
    mockGetSession.mockResolvedValueOnce({ ...BASE_SESSION, status: 'paused' });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Pause$/i }));
    });

    await waitFor(() =>
      expect(mockPauseSession).toHaveBeenCalledWith('s1', {
        username: 'dm_alice',
        channel: 'test_channel',
      }),
    );
    // getSession: 1 mount call + 1 post-pause refetch.
    await waitFor(() => expect(mockGetSession).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /^Resume$/i })).toBeInTheDocument(),
    );

    mockGetSession.mockResolvedValueOnce({ ...BASE_SESSION, status: 'active' });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Resume$/i }));
    });

    await waitFor(() =>
      expect(mockResumeSession).toHaveBeenCalledWith('s1', {
        username: 'dm_alice',
        channel: 'test_channel',
      }),
    );
  });
});

describe('DDX-25 — End session', () => {
  it('DDX25-AC3a: Cancel closes the dialog and never calls endSession', async () => {
    mockUsername = 'dm_alice';
    setup();
    await renderAndWaitForControls();

    fireEvent.click(screen.getByRole('button', { name: /End session/i }));
    const dialog = await screen.findByRole('dialog', { name: /End this session\?/i });

    fireEvent.click(within(dialog).getByRole('button', { name: /Keep playing/i }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(mockEndSession).not.toHaveBeenCalled();
  });

  it('DDX25-AC3b: confirming calls endSession, refetches, and reflects the ended state', async () => {
    mockUsername = 'dm_alice';
    setup();
    await renderAndWaitForControls();

    mockGetSession.mockResolvedValueOnce({ ...BASE_SESSION, status: 'ended' });

    fireEvent.click(screen.getByRole('button', { name: /End session/i }));
    const dialog = await screen.findByRole('dialog', { name: /End this session\?/i });

    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: /^End it$/i }));
    });

    await waitFor(() =>
      expect(mockEndSession).toHaveBeenCalledWith('s1', {
        username: 'dm_alice',
        channel: 'test_channel',
      }),
    );
    await waitFor(() => expect(mockGetSession).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/Session ended/i)).toBeInTheDocument());
  });
});

describe('DDX-25 — paused state disables player input', () => {
  it('DDX25-AC4a: a paused session shows the banner and disables the composer', async () => {
    mockUsername = 'dm_alice';
    setup({ ...BASE_SESSION, status: 'paused' });
    render(<PlayPage />);
    await waitFor(() =>
      expect(screen.getByText(/Session paused by the DM/i)).toBeInTheDocument(),
    );
    const textarea = screen.getByRole('textbox', { name: /Compose/i });
    expect(textarea).toBeDisabled();
  });

  it('DDX25-AC4b: an active session leaves the composer enabled and shows no banner', async () => {
    mockUsername = 'dm_alice';
    setup({ ...BASE_SESSION, status: 'active' });
    render(<PlayPage />);
    await waitFor(() => expect(mockGetSession).toHaveBeenCalled());
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByText(/Session paused by the DM/i)).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /Compose/i })).not.toBeDisabled();
  });
});

describe('DDX-25 — Award XP', () => {
  it('DDX25-AC5a: submit is disabled until a valid amount is entered, then calls awardSessionXp', async () => {
    mockUsername = 'dm_alice';
    setup();
    await renderAndWaitForControls();

    fireEvent.click(screen.getByRole('button', { name: /Award XP/i }));
    const form = await screen.findByRole('form', { name: /Award session XP/i });

    const submitBtn = within(form).getByRole('button', { name: /^Award$/i });
    expect(submitBtn).toBeDisabled();

    const amountInput = within(form).getByLabelText(/XP amount/i);
    fireEvent.change(amountInput, { target: { value: '300' } });
    expect(submitBtn).not.toBeDisabled();

    const reasonInput = within(form).getByLabelText(/Reason/i);
    fireEvent.change(reasonInput, { target: { value: 'defeated the goblins' } });

    mockGetSession.mockResolvedValueOnce({ ...BASE_SESSION, xp_pool: 300 });
    await act(async () => {
      fireEvent.click(submitBtn);
    });

    await waitFor(() =>
      expect(mockAwardSessionXp).toHaveBeenCalledWith('s1', {
        username: 'dm_alice',
        channel: 'test_channel',
        amount: 300,
        reason: 'defeated the goblins',
      }),
    );
    await waitFor(() => expect(mockGetSession).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.queryByRole('form', { name: /Award session XP/i })).not.toBeInTheDocument(),
    );
  });

  it('DDX25-AC5b: zero or negative amounts keep submit disabled; wrapper never called', async () => {
    mockUsername = 'dm_alice';
    setup();
    await renderAndWaitForControls();

    fireEvent.click(screen.getByRole('button', { name: /Award XP/i }));
    const form = await screen.findByRole('form', { name: /Award session XP/i });
    const amountInput = within(form).getByLabelText(/XP amount/i);
    const submitBtn = within(form).getByRole('button', { name: /^Award$/i });

    fireEvent.change(amountInput, { target: { value: '0' } });
    expect(submitBtn).toBeDisabled();

    fireEvent.change(amountInput, { target: { value: '-5' } });
    expect(submitBtn).toBeDisabled();

    expect(mockAwardSessionXp).not.toHaveBeenCalled();
  });
});
