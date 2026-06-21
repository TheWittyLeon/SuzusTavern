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
}));

import * as dnd from '../../lib/api/dnd';
import { AuthProvider } from '../../lib/auth/AuthProvider';
import { ThemeProvider } from '../../lib/theme/ThemeProvider';
import { ToastProvider } from '../../components/Toast';
import LobbyPage from '../../app/lobby/page';
import type { Session, User } from '../../lib/api/types';

const mockListSessions = dnd.listSessions as jest.MockedFunction<typeof dnd.listSessions>;
const mockJoin = dnd.joinSession as jest.MockedFunction<typeof dnd.joinSession>;

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
  mockJoin.mockReset().mockResolvedValue({} as Session);
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
  await waitFor(() => expect(screen.getByRole('button', { name: /join table/i })).toBeInTheDocument());
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /join table/i }));
  });
  await waitFor(() =>
    expect(mockJoin).toHaveBeenCalledWith('s1', { username: 'leon', channel: 'hollow_tide' }),
  );
});
