/**
 * Tests for src/app/lobby/page.tsx (Sprint 5).
 *
 * Covers: h1 + "Start a campaign" CTA, empty state (graceful degradation),
 * rendering real session cards, the Suzu/Human filter, and Join wiring.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: jest.fn(), push: jest.fn() }),
}));

jest.mock('../../lib/api/auth', () => ({
  login: jest.fn(),
  verify2FA: jest.fn(),
  logout: jest.fn(),
  refresh: jest.fn(),
  me: jest.fn(),
  register: jest.fn(),
}));

jest.mock('../../lib/api/dnd', () => ({
  listSessions: jest.fn(),
  joinSession: jest.fn(),
  listMyCharacters: jest.fn(),
}));

import * as dnd from '../../lib/api/dnd';
import { makeApiError } from '../../lib/api/client';
import { AuthProvider } from '../../lib/auth/AuthProvider';
import { ThemeProvider } from '../../lib/theme/ThemeProvider';
import { ToastProvider } from '../../components/Toast';
import LobbyPage from '../../app/lobby/page';
import type { Character, Session, User } from '../../lib/api/types';

const mockListSessions = dnd.listSessions as jest.MockedFunction<typeof dnd.listSessions>;
const mockJoin = dnd.joinSession as jest.MockedFunction<typeof dnd.joinSession>;
const mockListChars = dnd.listMyCharacters as jest.MockedFunction<typeof dnd.listMyCharacters>;

const CHAR_A: Character = {
  character_id: '10',
  username: 'leon',
  name: 'Aria',
  race: 'Human',
  char_class: 'Fighter',
  level: 3,
  hp: { current: 28, max: 28 },
  ac: 16,
};
const CHAR_B: Character = {
  character_id: '11',
  username: 'leon',
  name: 'Brax',
  race: 'Dwarf',
  char_class: 'Cleric',
  level: 2,
  hp: { current: 18, max: 18 },
  ac: 14,
};

const LEON: User = { id: 1, username: 'leon', email: null };

const suzuTable: Session = {
  session_id: 's1',
  channel: 'hollow_tide',
  status: 'active',
  dm_username: 'suzu',
  player_count: 2,
};
const humanTable: Session = {
  session_id: 's2',
  channel: 'cinder_quarry',
  status: 'paused',
  dm_username: 'marcus',
  player_count: 1,
};

function renderLobby() {
  return render(
    <ToastProvider>
      <ThemeProvider><AuthProvider initialUser={LEON} initialMaybeAuthed={false}>
        <LobbyPage />
      </AuthProvider></ThemeProvider>
    </ToastProvider>,
  );
}

beforeEach(() => {
  mockListSessions.mockReset().mockResolvedValue([]);
  // DDX-25 R2: joinSession's wire shape is `{message?, session?}`, not a bare
  // Session (see dnd.ts) — the handler discards the resolved value either
  // way, so an empty object (all-optional fields) is a sufficient mock.
  mockJoin.mockReset().mockResolvedValue({});
  // Default: no characters — existing join tests stay unaffected.
  mockListChars.mockReset().mockResolvedValue([]);
});

it('renders the h1 and a Start a campaign CTA', async () => {
  renderLobby();
  expect(screen.getByRole('heading', { level: 1, name: /find a table/i })).toBeInTheDocument();
  expect(screen.getAllByRole('link', { name: /start a campaign/i }).length).toBeGreaterThan(0);
});

it('shows an empty state when there are no tables (graceful)', async () => {
  renderLobby();
  await waitFor(() => expect(screen.getByText(/no tables running yet/i)).toBeInTheDocument());
});

it('falls back to an empty state if the backend route is missing', async () => {
  mockListSessions.mockRejectedValue(new Error('404'));
  renderLobby();
  await waitFor(() => expect(screen.getByText(/no tables running yet/i)).toBeInTheDocument());
});

it('renders a card per session with titleized channel + DM line', async () => {
  mockListSessions.mockResolvedValue([suzuTable, humanTable]);
  renderLobby();
  await waitFor(() => expect(screen.getByText(/hollow tide/i)).toBeInTheDocument());
  expect(screen.getByText(/cinder quarry/i)).toBeInTheDocument();
  expect(screen.getByText(/marcus/i)).toBeInTheDocument();
});

it('filters to Suzu-DM\'d tables', async () => {
  mockListSessions.mockResolvedValue([suzuTable, humanTable]);
  renderLobby();
  await waitFor(() => expect(screen.getByText(/cinder quarry/i)).toBeInTheDocument());
  fireEvent.click(screen.getByRole('button', { name: /suzu dm/i }));
  expect(screen.getByText(/hollow tide/i)).toBeInTheDocument();
  expect(screen.queryByText(/cinder quarry/i)).not.toBeInTheDocument();
});

it('joins a table → calls joinSession with the session channel', async () => {
  mockListSessions.mockResolvedValue([suzuTable]);
  renderLobby();
  await waitFor(() => expect(screen.getByRole('button', { name: /join table: hollow tide/i })).toBeInTheDocument());
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /join table: hollow tide/i }));
  });
  await waitFor(() =>
    expect(mockJoin).toHaveBeenCalledWith('s1', { username: 'leon', channel: 'hollow_tide' }),
  );
});

// ── character binding (bind-character-to-session) ─────────────────────────────

it('join with no characters sends no character_id', async () => {
  mockListSessions.mockResolvedValue([suzuTable]);
  mockListChars.mockResolvedValue([]);
  renderLobby();
  await waitFor(() => expect(screen.getByRole('button', { name: /join table: hollow tide/i })).toBeInTheDocument());
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /join table: hollow tide/i }));
  });
  await waitFor(() => {
    const [, payload] = mockJoin.mock.calls[0];
    expect(payload).not.toHaveProperty('character_id');
  });
});

it('join with one character auto-binds it (sends character_id)', async () => {
  mockListSessions.mockResolvedValue([suzuTable]);
  mockListChars.mockResolvedValue([CHAR_A]);
  renderLobby();
  // Wait for both the character list fetch and the subsequent useEffect that sets
  // selectedCharId to drain — the effect runs after setUserCharacters resolves.
  await waitFor(() => expect(mockListChars).toHaveBeenCalledWith('leon', expect.anything()));
  await act(async () => { /* flush pending state updates and effects */ });
  await waitFor(() => expect(screen.getByRole('button', { name: /join table: hollow tide/i })).toBeInTheDocument());
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /join table: hollow tide/i }));
  });
  await waitFor(() => {
    const [, payload] = mockJoin.mock.calls[0];
    expect(payload).toHaveProperty('character_id', 10);
  });
});

it('join with multiple characters shows a picker (aria-label names the table)', async () => {
  mockListSessions.mockResolvedValue([suzuTable]);
  mockListChars.mockResolvedValue([CHAR_A, CHAR_B]);
  renderLobby();
  await waitFor(() => expect(mockListChars).toHaveBeenCalledWith('leon', expect.anything()));
  // Iro MAJOR-1: aria-label now includes the table name for uniqueness across cards.
  // The regex still partial-matches; the full label is "Choose which character to bring to Hollow Tide".
  await waitFor(() =>
    expect(screen.getByRole('combobox', { name: /choose which character to bring to hollow tide/i })).toBeInTheDocument(),
  );
});

it('join with multiple characters sends the selected character_id', async () => {
  mockListSessions.mockResolvedValue([suzuTable]);
  mockListChars.mockResolvedValue([CHAR_A, CHAR_B]);
  renderLobby();
  await waitFor(() =>
    expect(screen.getByRole('combobox', { name: /choose which character to bring to hollow tide/i })).toBeInTheDocument(),
  );
  fireEvent.change(screen.getByRole('combobox', { name: /choose which character to bring to hollow tide/i }), {
    target: { value: '11' },
  });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /join table: hollow tide/i }));
  });
  await waitFor(() => {
    const [, payload] = mockJoin.mock.calls[0];
    expect(payload).toHaveProperty('character_id', 11);
  });
});

it('auto-bind still fires when sessions resolve before characters (race fix)', async () => {
  // Simulates the real prod race: listSessions resolves immediately, but
  // listMyCharacters is delayed. The useState initializer used to run before
  // userCharacters was populated → binding silently never sent.
  // The useEffect fix ensures binding happens after the character list arrives.
  let resolveChars!: (v: Character[]) => void;
  const charsPromise = new Promise<Character[]>((res) => { resolveChars = res; });

  mockListSessions.mockResolvedValue([suzuTable]);
  mockListChars.mockReturnValue(charsPromise);

  renderLobby();
  // Sessions loaded, cards rendered — characters not yet
  await waitFor(() => expect(screen.getByRole('button', { name: /join table: hollow tide/i })).toBeInTheDocument());

  // Now deliver the single character (would have been missed by the old initializer)
  await act(async () => { resolveChars([CHAR_A]); });

  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /join table: hollow tide/i }));
  });
  await waitFor(() => {
    expect(mockJoin).toHaveBeenCalled();
    const [, payload] = mockJoin.mock.calls[0];
    expect(payload).toHaveProperty('character_id', 10);
  });
});

// ── LVL-1 (Kage m4): the join floor-echo toast ───────────────────────────────

it('LVL: a floor_applied echo on join fires the auto-leveled toast with the table name + Resolve now', async () => {
  mockListSessions.mockResolvedValue([suzuTable]);
  mockJoin.mockResolvedValue({
    floor_applied: {
      character_id: 7,
      name: 'Rook',
      from_level: 1,
      to_level: 5,
      pending_added: 2,
    },
  });
  renderLobby();
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: /join table: hollow tide/i }),
    ).toBeInTheDocument(),
  );
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /join table: hollow tide/i }));
  });
  expect(await screen.findByText(/rook leveled up!/i)).toBeInTheDocument();
  expect(
    screen.getByText(/joined hollow tide — auto-leveled to match the table: 1 → 5\. 2 choices waiting\./i),
  ).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /resolve now/i })).toBeInTheDocument();
});

it('LVL: a null floor_applied keeps the plain joined toast (no level-up copy)', async () => {
  mockListSessions.mockResolvedValue([suzuTable]);
  mockJoin.mockResolvedValue({ floor_applied: null });
  renderLobby();
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: /join table: hollow tide/i }),
    ).toBeInTheDocument(),
  );
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /join table: hollow tide/i }));
  });
  expect(await screen.findByText(/joined hollow tide\./i)).toBeInTheDocument();
  expect(screen.queryByText(/leveled up!/i)).not.toBeInTheDocument();
});

// ── TAV-LOBBY-JOIN-ERROR-GENERIC (1.7 audit, 2026-08-10) ─────────────────────
// The join path used to be a bare `catch {}` that rendered ONE string for every
// failure: "Could not join that table. Try again." The 1.7 browser pass hit
// that with a real 409 `character_in_use`, where the retry advice can never
// work and the actual cause is hidden. These pin the curated map.

it('JOIN-REASONS: a 409 character_in_use names the cause, and never says "try again"', async () => {
  mockListSessions.mockResolvedValue([suzuTable]);
  mockJoin.mockRejectedValue(
    makeApiError(409, 'conflict', {
      data: { reason: 'character_in_use' },
      error: '[Session] Could not join: That character is already in another campaign.',
    }),
  );
  renderLobby();
  await waitFor(() =>
    expect(screen.getByRole('button', { name: /join table: hollow tide/i })).toBeInTheDocument(),
  );
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /join table: hollow tide/i }));
  });
  expect(await screen.findByText(/already at another table/i)).toBeInTheDocument();
  // The whole point of the ticket: this refusal is permanent, so the copy must
  // not invite a retry that cannot succeed.
  expect(screen.queryByText(/try again/i)).not.toBeInTheDocument();
});

it('JOIN-REASONS: an unmapped/opaque failure still gets honest fallback copy', async () => {
  mockListSessions.mockResolvedValue([suzuTable]);
  mockJoin.mockRejectedValue(new Error('network down'));
  renderLobby();
  await waitFor(() =>
    expect(screen.getByRole('button', { name: /join table: hollow tide/i })).toBeInTheDocument(),
  );
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /join table: hollow tide/i }));
  });
  expect(await screen.findByText(/couldn't join that table/i)).toBeInTheDocument();
});
