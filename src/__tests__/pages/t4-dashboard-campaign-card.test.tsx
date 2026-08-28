/**
 * T4p1 — dashboard campaign card (design doc migration-cost note: "the
 * campaign row is currently a plain list row, not a card").
 *
 * Covers the NEW content the card adds over the old row — party avatars
 * from participant_usernames and a started-at caption — both real fields
 * the engine already returns, gated to render only when present. Existing
 * dashboard.test.tsx / dashboard.bulk-delete.test.tsx cover the unchanged
 * interactive surface (Open link, select/delete) with fixtures that don't
 * set these fields, so this file is additive, not a duplicate.
 */
import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
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
  getSessionEvents: jest.fn(() => Promise.resolve([])),
  listMyCharacters: jest.fn(),
  deleteCharacter: jest.fn(),
  restoreCharacter: jest.fn(),
  deleteSession: jest.fn(),
  restoreSession: jest.fn(),
}));

import * as dnd from '../../lib/api/dnd';
import { AuthProvider } from '../../lib/auth/AuthProvider';
import { ThemeProvider } from '../../lib/theme/ThemeProvider';
import { ToastProvider } from '../../components/Toast';
import DashboardPage from '../../app/dashboard/page';
import type { Session, User } from '../../lib/api/types';

const mockListSessions = dnd.listSessions as jest.MockedFunction<typeof dnd.listSessions>;
const mockListChars = dnd.listMyCharacters as jest.MockedFunction<typeof dnd.listMyCharacters>;
const ALICE: User = { id: 1, username: 'alice', email: 'alice@example.com' };

function renderDashboard() {
  return render(
    <ToastProvider>
      <ThemeProvider>
        <AuthProvider initialUser={ALICE} initialMaybeAuthed={false}>
          <DashboardPage />
        </AuthProvider>
      </ThemeProvider>
    </ToastProvider>,
  );
}

beforeEach(() => {
  mockListChars.mockReset().mockResolvedValue([]);
});

it('renders party avatars + names from participant_usernames when present', async () => {
  const sessions: Session[] = [
    {
      session_id: 's1',
      channel: 'hollow_tide',
      status: 'active',
      dm_username: 'suzu',
      player_count: 2,
      participant_usernames: ['larkspur', 'cobble'],
    },
  ];
  mockListSessions.mockReset().mockResolvedValue(sessions);
  renderDashboard();

  await waitFor(() => expect(screen.getByText(/larkspur, cobble/i)).toBeInTheDocument());
  expect(screen.getByText('L')).toBeInTheDocument();
  expect(screen.getByText('C')).toBeInTheDocument();
});

it('omits the party row entirely when participant_usernames is absent (no fabricated data)', async () => {
  const sessions: Session[] = [
    { session_id: 's1', channel: 'hollow_tide', status: 'active', dm_username: 'suzu', player_count: 2 },
  ];
  mockListSessions.mockReset().mockResolvedValue(sessions);
  renderDashboard();

  await screen.findByRole('link', { name: /open/i });
  // Scope to the campaign LIST (not the hero card above it, which renders
  // its own independent "N players" pill from the same session).
  const list = screen.getByRole('list', { name: /my campaigns/i });
  expect(within(list).queryByText(/players/i)).not.toBeInTheDocument();
});

it('renders "started <when>" only when started_at is present', async () => {
  const sessions: Session[] = [
    {
      session_id: 's1',
      channel: 'hollow_tide',
      status: 'active',
      dm_username: 'suzu',
      player_count: 1,
      started_at: new Date(Date.now() - 60_000).toISOString(),
    },
  ];
  mockListSessions.mockReset().mockResolvedValue(sessions);
  renderDashboard();

  const list = await screen.findByRole('list', { name: /my campaigns/i });
  await waitFor(() => expect(within(list).getByText(/^started /i)).toBeInTheDocument());
});

it('a non-DM row in select mode gets no corner checkbox (DM-only select, unchanged from the old row)', async () => {
  const sessions: Session[] = [
    { session_id: 's1', channel: 'hollow_tide', status: 'active', dm_username: 'alice', player_count: 1 },
    { session_id: 's2', channel: 'suzu_table', status: 'active', dm_username: 'suzu', player_count: 1 },
  ];
  mockListSessions.mockReset().mockResolvedValue(sessions);
  renderDashboard();

  await screen.findAllByRole('link', { name: /open/i });
  const { fireEvent } = await import('@testing-library/react');
  fireEvent.click(screen.getByRole('button', { name: /^select$/i }));

  expect(screen.getByRole('checkbox', { name: /select campaign hollow tide/i })).toBeInTheDocument();
  expect(screen.queryByRole('checkbox', { name: /select campaign suzu table/i })).not.toBeInTheDocument();
});
