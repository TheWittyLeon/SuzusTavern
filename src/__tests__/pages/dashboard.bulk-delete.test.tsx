/**
 * BULK-DEL — multi-select bulk delete on /dashboard, both grids.
 *
 * Client-side loop over the existing single soft-delete calls
 * (Promise.allSettled), reusing the same ConfirmDialog + soft-delete → trash →
 * restore path as the single-item delete buttons. Covers:
 *  - select-mode toggles on/off for both the characters grid and the
 *    campaigns list
 *  - selecting N characters + confirm → deleteCharacter called N times +
 *    summary toast
 *  - selecting N campaigns (DM-only rows) + confirm → deleteSession called N
 *    times; non-DM rows never render a checkbox
 *  - partial failure → toast reports the failure count; the loop still
 *    resolves (no crash) and the successful ones are gone from selection
 *  - Undo loops the restores over the successfully-deleted ids
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
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

import * as authApi from '../../lib/api/auth';
import * as dnd from '../../lib/api/dnd';
import { AuthProvider } from '../../lib/auth/AuthProvider';
import { ThemeProvider } from '../../lib/theme/ThemeProvider';
import { ToastProvider } from '../../components/Toast';
import DashboardPage from '../../app/dashboard/page';
import type { Character, Session, User } from '../../lib/api/types';

const mockRefresh = authApi.refresh as jest.MockedFunction<typeof authApi.refresh>;
const mockListSessions = dnd.listSessions as jest.MockedFunction<typeof dnd.listSessions>;
const mockListChars = dnd.listMyCharacters as jest.MockedFunction<typeof dnd.listMyCharacters>;
const mockDeleteChar = dnd.deleteCharacter as jest.Mock;
const mockRestoreChar = dnd.restoreCharacter as jest.Mock;
const mockDeleteSession = dnd.deleteSession as jest.Mock;
const mockRestoreSession = dnd.restoreSession as jest.Mock;

const ALICE: User = { id: 1, username: 'alice', email: 'alice@example.com' };

const CHARS: Character[] = [
  { character_id: 'c1', name: 'Aria', char_class: 'Rogue', level: 2 } as unknown as Character,
  { character_id: 'c2', name: 'Bram', char_class: 'Fighter', level: 3 } as unknown as Character,
  { character_id: 'c3', name: 'Cael', char_class: 'Wizard', level: 1 } as unknown as Character,
];

/** alice DMs s1 + s2; suzu DMs s3 — s3 must never be bulk-selectable. */
const SESSIONS: Session[] = [
  { session_id: 's1', channel: 'hollow_tide', status: 'active', dm_username: 'alice', player_count: 2 },
  { session_id: 's2', channel: 'the_iron_vault', status: 'active', dm_username: 'alice', player_count: 1 },
  { session_id: 's3', channel: 'suzu_table', status: 'active', dm_username: 'suzu', player_count: 4 },
];

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
  mockRefresh.mockReset();
  mockListSessions.mockReset().mockResolvedValue([]);
  mockListChars.mockReset().mockResolvedValue([]);
  mockDeleteChar.mockReset();
  mockRestoreChar.mockReset();
  mockDeleteSession.mockReset();
  mockRestoreSession.mockReset();
});

// ── Characters grid ──────────────────────────────────────────────────────────

describe('Bulk delete — characters grid, select mode', () => {
  it('toggles select mode on and off via the Select/Cancel control', async () => {
    mockListChars.mockResolvedValue(CHARS);
    renderDashboard();

    await screen.findByText('Aria');
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^select$/i }));
    expect(screen.getAllByRole('checkbox', { name: /select (aria|bram|cael)/i })).toHaveLength(3);

    // The single-delete buttons are hidden while in select mode.
    expect(screen.queryByRole('button', { name: /delete aria/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }));
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    // Single-delete buttons come back once select mode exits.
    expect(await screen.findByRole('button', { name: /delete aria/i })).toBeInTheDocument();
  });

  it('selecting N characters and confirming calls deleteCharacter N times + summary toast', async () => {
    mockListChars.mockResolvedValue(CHARS);
    mockDeleteChar.mockResolvedValue({ message: 'trashed' });
    renderDashboard();

    await screen.findByText('Aria');
    fireEvent.click(screen.getByRole('button', { name: /^select$/i }));

    fireEvent.click(screen.getByRole('checkbox', { name: /select aria/i }));
    fireEvent.click(screen.getByRole('checkbox', { name: /select bram/i }));

    expect(await screen.findByText('2 characters selected')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /delete selected/i }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/delete 2 characters\?/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /move to trash/i }));

    await waitFor(() => expect(mockDeleteChar).toHaveBeenCalledTimes(2));
    expect(mockDeleteChar).toHaveBeenCalledWith('c1', 'alice');
    expect(mockDeleteChar).toHaveBeenCalledWith('c2', 'alice');
    expect(await screen.findByText(/moved 2 to trash/i)).toBeInTheDocument();
    // Select mode exits after the run.
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('partial failure: one delete rejects → toast reports the failure count, loop does not throw', async () => {
    mockListChars.mockResolvedValue(CHARS);
    mockDeleteChar.mockImplementation((id: string) =>
      id === 'c2' ? Promise.reject(new Error('network')) : Promise.resolve({ message: 'trashed' }),
    );
    renderDashboard();

    await screen.findByText('Aria');
    fireEvent.click(screen.getByRole('button', { name: /^select$/i }));
    fireEvent.click(screen.getByRole('checkbox', { name: /select aria/i }));
    fireEvent.click(screen.getByRole('checkbox', { name: /select bram/i }));
    fireEvent.click(screen.getByRole('button', { name: /delete selected/i }));
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('button', { name: /move to trash/i }));

    await waitFor(() => expect(mockDeleteChar).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(/deleted 1, 1 failed/i)).toBeInTheDocument();
  });

  it('Undo loops restoreCharacter over the successfully-deleted ids', async () => {
    mockListChars.mockResolvedValue(CHARS);
    mockDeleteChar.mockResolvedValue({ message: 'trashed' });
    mockRestoreChar.mockResolvedValue({ message: 'restored' });
    renderDashboard();

    await screen.findByText('Aria');
    fireEvent.click(screen.getByRole('button', { name: /^select$/i }));
    fireEvent.click(screen.getByRole('checkbox', { name: /select aria/i }));
    fireEvent.click(screen.getByRole('checkbox', { name: /select bram/i }));
    fireEvent.click(screen.getByRole('button', { name: /delete selected/i }));
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('button', { name: /move to trash/i }));

    const undo = await screen.findByRole('button', { name: /undo/i });
    fireEvent.click(undo);

    await waitFor(() => expect(mockRestoreChar).toHaveBeenCalledTimes(2));
    expect(mockRestoreChar).toHaveBeenCalledWith('c1', 'alice');
    expect(mockRestoreChar).toHaveBeenCalledWith('c2', 'alice');
    expect(await screen.findByText(/2 characters restored/i)).toBeInTheDocument();
  });

  it('Undo partial failure surfaces a restored-X-of-Y message', async () => {
    mockListChars.mockResolvedValue(CHARS);
    mockDeleteChar.mockResolvedValue({ message: 'trashed' });
    mockRestoreChar.mockImplementation((id: string) =>
      id === 'c2' ? Promise.reject(new Error('network')) : Promise.resolve({ message: 'restored' }),
    );
    renderDashboard();

    await screen.findByText('Aria');
    fireEvent.click(screen.getByRole('button', { name: /^select$/i }));
    fireEvent.click(screen.getByRole('checkbox', { name: /select aria/i }));
    fireEvent.click(screen.getByRole('checkbox', { name: /select bram/i }));
    fireEvent.click(screen.getByRole('button', { name: /delete selected/i }));
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('button', { name: /move to trash/i }));

    const undo = await screen.findByRole('button', { name: /undo/i });
    fireEvent.click(undo);

    await waitFor(() => expect(mockRestoreChar).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(/restored 1 of 2 characters/i)).toBeInTheDocument();
  });

  it('Select all selects every character; Clear empties the selection', async () => {
    mockListChars.mockResolvedValue(CHARS);
    renderDashboard();

    await screen.findByText('Aria');
    fireEvent.click(screen.getByRole('button', { name: /^select$/i }));
    fireEvent.click(screen.getByRole('checkbox', { name: /select aria/i }));
    fireEvent.click(screen.getByRole('button', { name: /select all/i }));
    expect(await screen.findByText('3 characters selected')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^clear$/i }));
    // Selecting to 0 hides the bar entirely (per design: bar shows at >=1).
    expect(screen.queryByText(/selected$/)).not.toBeInTheDocument();
  });
});

// ── Campaigns list ───────────────────────────────────────────────────────────

describe('Bulk delete — campaigns list, DM-only select', () => {
  it('renders a checkbox only for DM-owned rows once select mode is entered', async () => {
    mockListSessions.mockResolvedValue(SESSIONS);
    renderDashboard();

    await screen.findByRole('link', { name: /resume session/i });
    fireEvent.click(screen.getByRole('button', { name: /^select$/i }));

    // Only the 2 alice-DM'd campaigns get a checkbox; suzu's does not.
    expect(screen.getAllByRole('checkbox')).toHaveLength(2);
    expect(
      screen.queryByRole('checkbox', { name: /select campaign suzu table/i }),
    ).not.toBeInTheDocument();
  });

  it('selecting N campaigns and confirming calls deleteSession N times + summary toast', async () => {
    mockListSessions.mockResolvedValue(SESSIONS);
    mockDeleteSession.mockResolvedValue({ message: 'trashed' });
    renderDashboard();

    await screen.findByRole('link', { name: /resume session/i });
    fireEvent.click(screen.getByRole('button', { name: /^select$/i }));

    fireEvent.click(screen.getByRole('checkbox', { name: /select campaign hollow tide/i }));
    fireEvent.click(screen.getByRole('checkbox', { name: /select campaign the iron vault/i }));
    expect(await screen.findByText('2 campaigns selected')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /delete selected/i }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/delete 2 campaigns\?/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /move to trash/i }));

    await waitFor(() => expect(mockDeleteSession).toHaveBeenCalledTimes(2));
    expect(mockDeleteSession).toHaveBeenCalledWith('s1', 'alice');
    expect(mockDeleteSession).toHaveBeenCalledWith('s2', 'alice');
    expect(await screen.findByText(/moved 2 to trash/i)).toBeInTheDocument();
  });

  it('Select all only selects the DM-owned rows, never the non-DM row', async () => {
    mockListSessions.mockResolvedValue(SESSIONS);
    mockDeleteSession.mockResolvedValue({ message: 'trashed' });
    renderDashboard();

    await screen.findByRole('link', { name: /resume session/i });
    fireEvent.click(screen.getByRole('button', { name: /^select$/i }));
    // The bulk bar (which hosts "Select all") only renders once >=1 row is
    // selected — select one manually first to reveal it.
    fireEvent.click(screen.getByRole('checkbox', { name: /select campaign hollow tide/i }));
    fireEvent.click(screen.getByRole('button', { name: /select all/i }));
    expect(await screen.findByText('2 campaigns selected')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /delete selected/i }));
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('button', { name: /move to trash/i }));

    await waitFor(() => expect(mockDeleteSession).toHaveBeenCalledTimes(2));
    expect(mockDeleteSession).not.toHaveBeenCalledWith('s3', expect.anything());
  });

  it('Undo loops restoreSession over the successfully-deleted campaign ids', async () => {
    mockListSessions.mockResolvedValue(SESSIONS);
    mockDeleteSession.mockResolvedValue({ message: 'trashed' });
    mockRestoreSession.mockResolvedValue({ message: 'restored' });
    renderDashboard();

    await screen.findByRole('link', { name: /resume session/i });
    fireEvent.click(screen.getByRole('button', { name: /^select$/i }));
    fireEvent.click(screen.getByRole('checkbox', { name: /select campaign hollow tide/i }));
    fireEvent.click(screen.getByRole('checkbox', { name: /select campaign the iron vault/i }));
    fireEvent.click(screen.getByRole('button', { name: /delete selected/i }));
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('button', { name: /move to trash/i }));

    const undo = await screen.findByRole('button', { name: /undo/i });
    fireEvent.click(undo);

    await waitFor(() => expect(mockRestoreSession).toHaveBeenCalledTimes(2));
    expect(mockRestoreSession).toHaveBeenCalledWith('s1', 'alice');
    expect(mockRestoreSession).toHaveBeenCalledWith('s2', 'alice');
  });

  it('the campaign Select toggle only appears when the user DMs at least one session', async () => {
    // alice DMs none of these — the toggle for the campaigns list should be absent.
    mockListSessions.mockResolvedValue([
      { session_id: 's9', channel: 'suzu_only', status: 'active', dm_username: 'suzu', player_count: 1 },
    ]);
    renderDashboard();
    await screen.findByRole('link', { name: /resume session/i });
    // Only the characters-grid Select toggle would show if characters exist;
    // with no characters and no DM'd sessions, there is no Select control at all.
    expect(screen.queryByRole('button', { name: /^select$/i })).not.toBeInTheDocument();
  });
});
