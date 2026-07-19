/**
 * Tests for src/app/trash/page.tsx (DEL-8 — trash / restore view).
 *
 * Covers:
 *   - loading + maybeAuthed → skeleton (no logged-out flash, no h1)
 *   - authed + empty trash → "Your trash is empty"
 *   - authed + trashed characters → a row per character with a Restore action
 *   - restore success → calls restoreCharacter(id, username), drops the row, re-fetches
 *   - restore failure → the row stays (optimistic rollback)
 *   - resolved + no user → redirect to /login
 *   - graceful degradation: listTrashedCharacters throwing → empty trash, not an error
 *   - UIR2-TAV-9 (safe part): Restore now opens a ConfirmDialog first — the
 *     row's own trigger button no longer calls restoreCharacter directly;
 *     Cancel leaves the row untouched, Confirm proceeds exactly as before.
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
  listTrashedCharacters: jest.fn(),
  restoreCharacter: jest.fn(),
}));

import * as authApi from '../../lib/api/auth';
import * as dnd from '../../lib/api/dnd';
import { AuthProvider } from '../../lib/auth/AuthProvider';
import { ThemeProvider } from '../../lib/theme/ThemeProvider';
import { ToastProvider } from '../../components/Toast';
import TrashPage from '../../app/trash/page';
import type { Character, User } from '../../lib/api/types';

const mockRefresh = authApi.refresh as jest.MockedFunction<typeof authApi.refresh>;
const mockListTrashed = dnd.listTrashedCharacters as jest.MockedFunction<
  typeof dnd.listTrashedCharacters
>;
const mockRestore = dnd.restoreCharacter as jest.MockedFunction<typeof dnd.restoreCharacter>;

const ALICE: User = { id: 1, username: 'alice', email: 'alice@example.com' };

const VELKA = {
  character_id: 'c1',
  username: 'alice',
  name: 'Velka',
  race: 'Elf',
  char_class: 'Rogue',
  level: 3,
} as unknown as Character;

const BRENN = {
  character_id: 'c2',
  username: 'alice',
  name: 'Brennan',
  race: 'Human',
  char_class: 'Fighter',
  level: 1,
} as unknown as Character;

function renderTrash(initialUser: User | null, initialMaybeAuthed = false) {
  return render(
    <ToastProvider>
      <ThemeProvider><AuthProvider initialUser={initialUser} initialMaybeAuthed={initialMaybeAuthed}>
        <TrashPage />
      </AuthProvider></ThemeProvider>
    </ToastProvider>,
  );
}

beforeEach(() => {
  mockReplace.mockClear();
  mockPush.mockClear();
  mockRefresh.mockReset();
  mockListTrashed.mockReset().mockResolvedValue([]);
  mockRestore.mockReset().mockResolvedValue({ message: 'restored' });
});

describe('Trash — empty', () => {
  it('shows the empty state when the trash is empty', async () => {
    renderTrash(ALICE);
    await waitFor(() =>
      expect(screen.getByText(/your trash is empty/i)).toBeInTheDocument(),
    );
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/trash/i);
    expect(screen.getByRole('link', { name: /back to dashboard/i })).toBeInTheDocument();
  });

  it('treats a thrown ApiError as empty trash, not an error screen', async () => {
    mockListTrashed.mockRejectedValueOnce(new Error('boom'));
    renderTrash(ALICE);
    await waitFor(() =>
      expect(screen.getByText(/your trash is empty/i)).toBeInTheDocument(),
    );
  });
});

describe('Trash — populated', () => {
  it('renders a row per trashed character with a Restore action', async () => {
    mockListTrashed.mockResolvedValue([VELKA, BRENN]);
    renderTrash(ALICE);
    await waitFor(() => expect(screen.getByText('Velka')).toBeInTheDocument());
    expect(screen.getByText('Brennan')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /restore velka/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /restore brennan/i })).toBeInTheDocument();
    // single h1
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('restore → calls restoreCharacter(id, username) and drops the row', async () => {
    // initial load returns both; the post-restore re-fetch returns just Brennan
    mockListTrashed.mockResolvedValueOnce([VELKA, BRENN]).mockResolvedValue([BRENN]);
    renderTrash(ALICE);
    const restoreVelka = await screen.findByRole('button', { name: /restore velka/i });
    fireEvent.click(restoreVelka);

    // UIR2-TAV-9: the trigger only opens the confirm dialog — no API call yet.
    const confirmBtn = await screen.findByRole('button', { name: 'Restore' });
    expect(mockRestore).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(confirmBtn);
    });
    await waitFor(() =>
      expect(mockRestore).toHaveBeenCalledWith('c1', 'alice'),
    );
    // optimistic removal — Velka is gone, Brennan stays
    await waitFor(() => expect(screen.queryByText('Velka')).not.toBeInTheDocument());
    expect(screen.getByText('Brennan')).toBeInTheDocument();
    // dialog closed itself after the confirmed restore resolved
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('restore → Cancel in the confirm dialog leaves the row untouched', async () => {
    mockListTrashed.mockResolvedValue([VELKA]);
    renderTrash(ALICE);
    const restoreVelka = await screen.findByRole('button', { name: /restore velka/i });
    fireEvent.click(restoreVelka);

    const cancelBtn = await screen.findByRole('button', { name: 'Cancel' });
    fireEvent.click(cancelBtn);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(mockRestore).not.toHaveBeenCalled();
    // row is still there, untouched
    expect(screen.getByText('Velka')).toBeInTheDocument();
  });

  it('restore failure → the row stays (optimistic rollback)', async () => {
    mockListTrashed.mockResolvedValue([VELKA]);
    mockRestore.mockRejectedValueOnce(new Error('network'));
    renderTrash(ALICE);
    const restoreVelka = await screen.findByRole('button', { name: /restore velka/i });
    fireEvent.click(restoreVelka);
    const confirmBtn = await screen.findByRole('button', { name: 'Restore' });
    await act(async () => {
      fireEvent.click(confirmBtn);
    });
    await waitFor(() => expect(mockRestore).toHaveBeenCalled());
    // rolled back — Velka is restored to the list
    await waitFor(() => expect(screen.getByText('Velka')).toBeInTheDocument());
  });

  it('only the clicked row enters the restoring state — sibling button stays enabled', async () => {
    // React 18 automatic batching merges setRestoringId + setCharacters into one
    // render, so the "button disabled, row still mounted" intermediate state is
    // not observable in jsdom. What IS observable: restoringId is scoped to a
    // single character_id, so a sibling row that has NOT been clicked must never
    // be disabled. Keep BRENN's restore paused; VELKA is removed optimistically.
    mockListTrashed.mockResolvedValueOnce([VELKA, BRENN]).mockResolvedValue([BRENN]);
    let unblock!: () => void;
    // First call (Velka) stalls; second call (if Brennan were clicked) would resolve.
    mockRestore
      .mockReturnValueOnce(
        new Promise<{ message: string }>((res) => { unblock = () => res({ message: 'restored' }); }),
      )
      .mockResolvedValue({ message: 'restored' });

    renderTrash(ALICE);
    await screen.findByRole('button', { name: /restore velka/i });

    // Open + confirm Velka's restore — both setRestoringId('c1') and the
    // optimistic filter are batched into one render by React 18.
    fireEvent.click(screen.getByRole('button', { name: /restore velka/i }));
    const confirmBtn = await screen.findByRole('button', { name: 'Restore' });
    await act(async () => {
      fireEvent.click(confirmBtn);
    });

    // Velka's row is gone (optimistic); Brennan is still present and NOT disabled.
    await waitFor(() => expect(screen.queryByText('Velka')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: /restore brennan/i })).not.toBeDisabled();

    // clean up
    await act(async () => { unblock(); });
  });

  it('MAJOR-1 (Tora): focus never escapes the open confirm dialog mid-flight, and lands on the surviving row on close', async () => {
    // Two rows so there's a genuine "surviving sibling" to land on — the bug
    // was `handleRestore` moving focus to that sibling WHILE the dialog was
    // still open+busy (aria-modal escape). Keep restoreCharacter pending so
    // there's an observable window where the dialog is open+busy.
    mockListTrashed.mockResolvedValueOnce([VELKA, BRENN]).mockResolvedValue([BRENN]);
    let unblock!: () => void;
    mockRestore.mockReturnValueOnce(
      new Promise<{ message: string }>((res) => {
        unblock = () => res({ message: 'restored' });
      }),
    );
    renderTrash(ALICE);
    fireEvent.click(await screen.findByRole('button', { name: /restore velka/i }));
    const confirmBtn = await screen.findByRole('button', { name: 'Restore' });

    await act(async () => {
      fireEvent.click(confirmBtn);
    });

    // While the restore is in flight, the dialog is still open+busy — focus
    // must still be INSIDE it (never escaped to the Brennan row behind it).
    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).not.toBe(
      screen.getByRole('button', { name: /restore brennan/i }),
    );

    await act(async () => {
      unblock();
    });

    // Dialog closed; Velka's row is gone; focus landed on the surviving
    // Brennan row's Restore button (the "surviving trigger"), not lost to
    // <body> and not stuck on a detached node.
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.queryByText('Velka')).not.toBeInTheDocument();
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('button', { name: /restore brennan/i }),
      ),
    );
  });

  it('MAJOR-1 (Tora): with no surviving row, focus lands on "Back to dashboard" on close', async () => {
    mockListTrashed.mockResolvedValueOnce([VELKA]).mockResolvedValue([]);
    let unblock!: () => void;
    mockRestore.mockReturnValueOnce(
      new Promise<{ message: string }>((res) => {
        unblock = () => res({ message: 'restored' });
      }),
    );
    renderTrash(ALICE);
    fireEvent.click(await screen.findByRole('button', { name: /restore velka/i }));
    const confirmBtn = await screen.findByRole('button', { name: 'Restore' });
    await act(async () => {
      fireEvent.click(confirmBtn);
    });

    await act(async () => {
      unblock();
    });

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('link', { name: /back to dashboard/i }),
      ),
    );
  });

  it('populated state renders a "Back to dashboard" link', async () => {
    mockListTrashed.mockResolvedValue([VELKA]);
    renderTrash(ALICE);
    await screen.findByText('Velka');
    // The populated branch has its own Back-to-dashboard button distinct from the empty-state one
    expect(screen.getByRole('link', { name: /back to dashboard/i })).toBeInTheDocument();
  });

  it('deleted_at is surfaced in the character sub-line', async () => {
    const trashed = {
      ...VELKA,
      deleted_at: '2026-06-19T10:00:00Z',
    } as unknown as Character;
    mockListTrashed.mockResolvedValue([trashed]);
    renderTrash(ALICE);
    await screen.findByText('Velka');
    // charSub formats deleted_at as "trashed <date>" in the sub-line
    expect(screen.getByText(/trashed/i)).toBeInTheDocument();
  });
});

describe('Trash — skeleton while loading + maybeAuthed', () => {
  it('shows the skeleton (no h1) during silent refresh', () => {
    mockRefresh.mockReturnValue(new Promise(() => {}));
    renderTrash(null, true);
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument();
  });
});

describe('Trash — no user', () => {
  it('redirects to /login when not loading, no user, not maybeAuthed', async () => {
    renderTrash(null, false);
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/login'));
  });
});
