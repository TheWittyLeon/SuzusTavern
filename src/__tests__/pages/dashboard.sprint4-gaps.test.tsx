/**
 * Sprint 4 gap-fill, carried into Sprint 5: dashboard edge cases.
 *
 *  1. Skeleton (loading+maybeAuthed) leaks no authed UI (no h1, no account menu)
 *  2. User email is never rendered
 *  3. Empty username → graceful greeting (no dangling comma)
 *  4. Sign out menuitem is reachable + idle by default
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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
  deleteCharacter: jest.fn(),
  restoreCharacter: jest.fn(),
}));

import * as authApi from '../../lib/api/auth';
import * as dnd from '../../lib/api/dnd';
import { AuthProvider } from '../../lib/auth/AuthProvider';
import { ToastProvider } from '../../components/Toast';
import DashboardPage from '../../app/dashboard/page';
import type { User } from '../../lib/api/types';

const mockRefresh = authApi.refresh as jest.MockedFunction<typeof authApi.refresh>;
const mockListSessions = dnd.listSessions as jest.MockedFunction<typeof dnd.listSessions>;
const mockListChars = dnd.listMyCharacters as jest.MockedFunction<typeof dnd.listMyCharacters>;

const ALICE: User = { id: 1, username: 'alice', email: 'alice@example.com' };

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
  mockRefresh.mockReset();
  mockListSessions.mockReset().mockResolvedValue([]);
  mockListChars.mockReset().mockResolvedValue([]);
});

describe('Dashboard — skeleton visibility guard', () => {
  it('renders neither h1 nor the account menu while loading + maybeAuthed', () => {
    mockRefresh.mockReturnValue(new Promise(() => {}));
    renderDashboard(null, true);
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /account menu/i })).not.toBeInTheDocument();
  });
});

describe('Dashboard — PII', () => {
  it('does not render the user email anywhere', async () => {
    renderDashboard(ALICE);
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 2, name: /start a story/i })).toBeInTheDocument(),
    );
    expect(screen.queryByText('alice@example.com')).not.toBeInTheDocument();
    expect(screen.queryByText(/@example\.com/)).not.toBeInTheDocument();
  });
});

describe('Dashboard — username-less user', () => {
  it('greets gracefully with no dangling comma', async () => {
    renderDashboard({ id: 3, username: '', email: null });
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument());
    const h1 = screen.getByRole('heading', { level: 1 });
    expect(h1.textContent).not.toMatch(/,/);
    expect(h1.textContent).toMatch(/welcome/i);
  });
});

describe('Dashboard — sign out reachability', () => {
  it('exposes an idle Sign out menuitem inside the account menu', async () => {
    renderDashboard(ALICE);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /account menu/i })).toBeInTheDocument(),
    );
    // Closed by default — the avatar must NOT log you out on click.
    expect(screen.queryByRole('menuitem', { name: /sign out/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /account menu/i }));
    const signOut = await screen.findByRole('menuitem', { name: /sign out/i });
    expect(signOut).not.toBeDisabled();
  });
});
