/**
 * Tests for src/app/dashboard/page.tsx (Sprint 5 — real dashboard).
 *
 * Covers:
 *   - loading + maybeAuthed → skeleton (no logged-out flash, no h1)
 *   - authed + no sessions → "Welcome, <user>" + the way-to-start doors
 *   - authed + has sessions → "Welcome back, <user>" + resume + campaign rows
 *   - single h1; PII (email) not rendered
 *   - Sign out (via the account menu) calls logout() and redirects to /login
 *   - resolved + no user → redirect to /login
 */
import React from 'react';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

const mockReplace = jest.fn();
const mockPush = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace, push: mockPush }),
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
  listMyCharacters: jest.fn(),
}));

import * as authApi from '../../lib/api/auth';
import * as dnd from '../../lib/api/dnd';
import { AuthProvider } from '../../lib/auth/AuthProvider';
import { ToastProvider } from '../../components/Toast';
import DashboardPage from '../../app/dashboard/page';
import type { Session, User } from '../../lib/api/types';

const mockLogout = authApi.logout as jest.MockedFunction<typeof authApi.logout>;
const mockRefresh = authApi.refresh as jest.MockedFunction<typeof authApi.refresh>;
const mockMe = authApi.me as jest.MockedFunction<typeof authApi.me>;
const mockListSessions = dnd.listSessions as jest.MockedFunction<typeof dnd.listSessions>;
const mockListChars = dnd.listMyCharacters as jest.MockedFunction<typeof dnd.listMyCharacters>;

const ALICE: User = { id: 1, username: 'alice', email: 'alice@example.com' };

const SESSION: Session = {
  session_id: 's1',
  channel: 'hollow_tide',
  status: 'active',
  dm_username: 'suzu',
  player_count: 2,
};

function renderDashboard(initialUser: User | null, initialMaybeAuthed = false) {
  return render(
    <ToastProvider>
      <AuthProvider initialUser={initialUser} initialMaybeAuthed={initialMaybeAuthed}>
        <DashboardPage />
      </AuthProvider>
    </ToastProvider>,
  );
}

beforeEach(() => {
  mockReplace.mockClear();
  mockPush.mockClear();
  mockLogout.mockReset();
  mockRefresh.mockReset();
  mockMe.mockReset();
  mockListSessions.mockReset().mockResolvedValue([]);
  mockListChars.mockReset().mockResolvedValue([]);
});

describe('Dashboard — empty (way-to-start)', () => {
  it('greets "Welcome, <user>" and shows the three doors when there are no sessions', async () => {
    renderDashboard(ALICE);
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 2, name: /start a story/i })).toBeInTheDocument(),
    );
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/^welcome, alice\.$/i);
    expect(screen.getByRole('heading', { level: 2, name: /find a table/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: /roll a character/i })).toBeInTheDocument();
  });

  it('exactly one h1', async () => {
    renderDashboard(ALICE);
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 2, name: /start a story/i })).toBeInTheDocument(),
    );
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });
});

describe('Dashboard — active', () => {
  it('greets "Welcome back" and renders a resume action when sessions exist', async () => {
    mockListSessions.mockResolvedValue([SESSION]);
    renderDashboard(ALICE);
    await waitFor(() =>
      expect(screen.getByRole('link', { name: /resume session/i })).toBeInTheDocument(),
    );
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/welcome back, alice/i);
    // channel is titleized into the hero
    expect(screen.getAllByText(/hollow tide/i).length).toBeGreaterThan(0);
    // CR-1 regression: the DM line renders a real apostrophe, not a raw entity.
    expect(screen.getByText(/DM.?d by Suzu/i)).toBeInTheDocument();
    expect(screen.queryByText(/&rsquo;/)).not.toBeInTheDocument();
  });
});

describe('Dashboard — skeleton while loading + maybeAuthed', () => {
  it('shows the skeleton (no h1, no account menu) during silent refresh', () => {
    mockRefresh.mockReturnValue(new Promise(() => {}));
    renderDashboard(null, true);
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /account menu/i })).not.toBeInTheDocument();
  });
});

describe('Dashboard — logout via account menu', () => {
  it('opens the menu and signs out → logout() + redirect to /login', async () => {
    mockLogout.mockResolvedValueOnce({ ok: true });
    renderDashboard(ALICE);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /account menu/i })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole('button', { name: /account menu/i }));
    const signOut = await screen.findByRole('menuitem', { name: /sign out/i });
    await act(async () => {
      fireEvent.click(signOut);
    });
    await waitFor(() => expect(mockLogout).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/login'));
  });

  it('redirects to /login even if logout() throws', async () => {
    mockLogout.mockRejectedValueOnce(new Error('network'));
    renderDashboard(ALICE);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /account menu/i })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole('button', { name: /account menu/i }));
    const signOut = await screen.findByRole('menuitem', { name: /sign out/i });
    await act(async () => {
      fireEvent.click(signOut);
    });
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/login'));
  });
});

describe('Dashboard — no user', () => {
  it('redirects to /login when not loading, no user, not maybeAuthed', async () => {
    renderDashboard(null, false);
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/login'));
  });
});

describe('Dashboard — PII', () => {
  it('never renders the user email', async () => {
    renderDashboard(ALICE);
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 2, name: /start a story/i })).toBeInTheDocument(),
    );
    expect(screen.queryByText(/@example\.com/)).not.toBeInTheDocument();
  });

  it('renders no dangling comma when username is empty', async () => {
    renderDashboard({ id: 9, username: '', email: null });
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument());
    const h1 = screen.getByRole('heading', { level: 1 });
    expect(h1.textContent).toMatch(/welcome/i);
    expect(h1.textContent).not.toMatch(/,/);
  });
});
