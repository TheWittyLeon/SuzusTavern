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
import { ThemeProvider } from '../../lib/theme/ThemeProvider';
import { ToastProvider } from '../../components/Toast';
import ModulesPage from '../../app/modules/page';
import type { Session, SessionStartRequest, User } from '../../lib/api/types';

const mockCreate = dnd.createSession as jest.MockedFunction<typeof dnd.createSession>;
const LEON: User = { id: 1, username: 'leon', email: null };

function renderModules() {
  return render(
    <ToastProvider>
      <ThemeProvider><AuthProvider initialUser={LEON} initialMaybeAuthed={false}>
        <ModulesPage />
      </AuthProvider></ThemeProvider>
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

describe('RadioGroup keyboard navigation (S3.4)', () => {
  it('groups are radiogroups with roving tabindex (checked=0, others=-1)', () => {
    openForm();
    const groups = screen.getAllByRole('radiogroup');
    expect(groups.length).toBe(3); // DM · visibility · content rating
    // The DM group defaults to "Suzu DMs" checked → tabIndex 0; "Solo" → -1.
    const ai = screen.getByRole('radio', { name: /suzu dms/i });
    const solo = screen.getByRole('radio', { name: /solo/i });
    expect(ai).toHaveAttribute('tabindex', '0');
    expect(solo).toHaveAttribute('tabindex', '-1');
  });

  it('ArrowDown moves the selection within a radiogroup', () => {
    openForm();
    const ai = screen.getByRole('radio', { name: /suzu dms/i });
    fireEvent.keyDown(ai, { key: 'ArrowDown' });
    expect(screen.getByRole('radio', { name: /solo/i })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  it('Arrow navigation skips a disabled option (Mature when Public)', () => {
    openForm();
    fireEvent.click(screen.getByRole('radio', { name: /^public/i }));
    const sfw = screen.getByRole('radio', { name: /safe for stream/i });
    // Mature is disabled on a public table — ArrowDown wraps back to SFW, not Mature.
    fireEvent.keyDown(sfw, { key: 'ArrowDown' });
    expect(screen.getByRole('radio', { name: /mature/i })).toHaveAttribute(
      'aria-checked',
      'false',
    );
  });
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
  // Default selection: Suzu DMs (ai) + private + sfw → dm_mode:'ai', ai_assist_level:'full'
  await waitFor(() =>
    expect(mockCreate).toHaveBeenCalledWith({
      username: 'leon',
      channel: 'the_hollow_tide_cave',
      dm_mode: 'ai',
      ai_assist_level: 'full',
      visibility: 'private',
      content_rating: 'sfw',
    }),
  );
  await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/dashboard'));
});

it('Begin with Suzu DMs selection sends dm_mode:ai + ai_assist_level:full', async () => {
  openForm();
  // Ensure "Suzu DMs" is selected (it is by default)
  fireEvent.click(screen.getByRole('radio', { name: /suzu dms/i }));
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /^begin$/i }));
  });
  await waitFor(() => {
    const call = mockCreate.mock.calls[0][0] as SessionStartRequest;
    expect(call['dm_mode']).toBe('ai');
    expect(call['ai_assist_level']).toBe('full');
  });
});

it('Begin with Solo selection sends dm_mode:human + ai_assist_level:off', async () => {
  openForm();
  fireEvent.click(screen.getByRole('radio', { name: /solo/i }));
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /^begin$/i }));
  });
  await waitFor(() => {
    const call = mockCreate.mock.calls[0][0] as SessionStartRequest;
    expect(call['dm_mode']).toBe('human');
    expect(call['ai_assist_level']).toBe('off');
  });
});

it('Begin sends the visibility and effective content_rating axes', async () => {
  openForm();
  // Switch to unlisted + mature. Anchor /^unlisted/i to avoid matching options
  // whose note text also contains "unlisted".
  fireEvent.click(screen.getByRole('radio', { name: /^unlisted/i }));
  fireEvent.click(screen.getByRole('radio', { name: /mature/i }));
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /^begin$/i }));
  });
  await waitFor(() => {
    const call = mockCreate.mock.calls[0][0] as SessionStartRequest;
    expect(call['visibility']).toBe('unlisted');
    expect(call['content_rating']).toBe('mature');
  });
});

it('Begin on a public table always sends content_rating:sfw regardless of prior selection', async () => {
  openForm();
  // First switch to unlisted to allow mature, then back to public.
  // Use /^unlisted/i (anchored) to avoid matching options whose note mentions "unlisted".
  fireEvent.click(screen.getByRole('radio', { name: /^unlisted/i }));
  fireEvent.click(screen.getByRole('radio', { name: /mature/i }));
  fireEvent.click(screen.getByRole('radio', { name: /^public/i }));
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /^begin$/i }));
  });
  await waitFor(() => {
    const call = mockCreate.mock.calls[0][0] as SessionStartRequest;
    expect(call['visibility']).toBe('public');
    expect(call['content_rating']).toBe('sfw');
  });
});
