/**
 * Tests for src/app/modules/page.tsx — the way-to-start (Option B).
 *
 * Covers the catalog → starter form flow, the content_rating SFW interlock
 * (mature is private/unlisted only; public forces SFW), and create wiring.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';

const mockPush = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn() }),
}));

jest.mock('../../lib/api/auth', () => ({
  login: jest.fn(),
  verify2FA: jest.fn(),
  logout: jest.fn(),
  refresh: jest.fn(),
  me: jest.fn(),
  register: jest.fn(),
}));

jest.mock('../../lib/api/dnd', () => ({ createSession: jest.fn() }));

import * as dnd from '../../lib/api/dnd';
import { AuthProvider } from '../../lib/auth/AuthProvider';
import { ToastProvider } from '../../components/Toast';
import ModulesPage from '../../app/modules/page';
import type { Session, User } from '../../lib/api/types';

const mockCreate = dnd.createSession as jest.MockedFunction<typeof dnd.createSession>;
const LEON: User = { id: 1, username: 'leon', email: null };

function renderModules() {
  return render(
    <ToastProvider>
      <AuthProvider initialUser={LEON} initialMaybeAuthed={false}>
        <ModulesPage />
      </AuthProvider>
    </ToastProvider>,
  );
}

beforeEach(() => {
  mockPush.mockClear();
  mockCreate.mockReset().mockResolvedValue({ session_id: 's9', channel: 'x' } as Session);
});

function openForm() {
  renderModules();
  fireEvent.click(screen.getByRole('button', { name: /run this/i }));
}

it('renders the catalog with the seeded one-shot', () => {
  renderModules();
  expect(screen.getByRole('heading', { level: 1, name: /start a campaign/i })).toBeInTheDocument();
  expect(screen.getByRole('heading', { level: 2, name: /hollow tide/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /run this/i })).toBeInTheDocument();
});

it('opens the starter form when a module is chosen', () => {
  openForm();
  expect(screen.getByRole('heading', { name: /set the table/i })).toBeInTheDocument();
  expect(screen.getByText(/table name/i)).toBeInTheDocument();
});

describe('content_rating SFW interlock', () => {
  it('allows Mature on a private table (default)', () => {
    openForm();
    expect(screen.getByRole('radio', { name: /mature/i })).not.toBeDisabled();
  });

  it('forces SFW + disables Mature when the table is Public', () => {
    openForm();
    fireEvent.click(screen.getByRole('radio', { name: /^public/i }));
    const mature = screen.getByRole('radio', { name: /mature/i });
    expect(mature).toBeDisabled();
    expect(screen.getByRole('radio', { name: /safe for stream/i })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByText(/always safe-for-stream/i)).toBeInTheDocument();
  });

  it('resets a Mature selection back to SFW when switching to Public', () => {
    openForm();
    fireEvent.click(screen.getByRole('radio', { name: /mature/i }));
    expect(screen.getByRole('radio', { name: /mature/i })).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByRole('radio', { name: /^public/i }));
    expect(screen.getByRole('radio', { name: /safe for stream/i })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });
});

it('Begin creates a session with a slugified channel and routes to the dashboard', async () => {
  openForm();
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /^begin$/i }));
  });
  await waitFor(() =>
    expect(mockCreate).toHaveBeenCalledWith({
      username: 'leon',
      channel: 'the_hollow_tide_cave',
    }),
  );
  await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/dashboard'));
});
