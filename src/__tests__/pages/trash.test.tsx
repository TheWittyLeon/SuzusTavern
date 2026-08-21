/**
 * Tests for src/app/trash/page.tsx (DEL-8 — trash / restore view; campaigns
 * section added by TAV-CAMPAIGN-TRASH-NO-RESTORE-UI).
 *
 * Characters coverage (DEL-8, pre-existing):
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
 *
 * Campaigns coverage (TAV-CAMPAIGN-TRASH-NO-RESTORE-UI, new):
 *   - empty campaigns section renders its own "No trashed campaigns" note
 *     even while the characters section is populated (independent empty state)
 *   - populated campaigns section → a row per session with an accessible,
 *     campaign-identifying Restore action
 *   - restore success → calls restoreSession(id, username), drops the row
 *   - restore failure → engineErrorMessage-routed copy, row rolls back
 *   - double-submit: a second confirm click while the first is in flight
 *     does not fire a second restoreSession call
 *   - both-empty → the single page-level empty state (not two separate notes)
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
  listTrashedSessions: jest.fn(),
  restoreSession: jest.fn(),
}));

import * as authApi from '../../lib/api/auth';
import * as dnd from '../../lib/api/dnd';
import { AuthProvider } from '../../lib/auth/AuthProvider';
import { ThemeProvider } from '../../lib/theme/ThemeProvider';
import { ToastProvider } from '../../components/Toast';
import TrashPage from '../../app/trash/page';
import type { Character, Session, User } from '../../lib/api/types';

const mockRefresh = authApi.refresh as jest.MockedFunction<typeof authApi.refresh>;
const mockListTrashed = dnd.listTrashedCharacters as jest.MockedFunction<
  typeof dnd.listTrashedCharacters
>;
const mockRestore = dnd.restoreCharacter as jest.MockedFunction<typeof dnd.restoreCharacter>;
const mockListTrashedSessions = dnd.listTrashedSessions as jest.MockedFunction<
  typeof dnd.listTrashedSessions
>;
const mockRestoreSession = dnd.restoreSession as jest.MockedFunction<typeof dnd.restoreSession>;

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

const DRAGONS_HOARD = {
  session_id: 's1',
  channel: 'dragons-hoard',
  name: "The Dragon's Hoard",
  dm_username: 'alice',
  status: 'ended',
  player_count: 3,
} as unknown as Session;

const LOST_MINE = {
  session_id: 's2',
  channel: 'lost-mine',
  name: 'Lost Mine of Phandelver',
  dm_username: 'alice',
  status: 'ended',
  player_count: 2,
} as unknown as Session;

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
  mockListTrashedSessions.mockReset().mockResolvedValue([]);
  mockRestoreSession.mockReset().mockResolvedValue({ message: 'restored' });
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

  it('Tora MINOR-1: double-submit latch — a second confirm click while the first is in flight fires restoreCharacter only once', async () => {
    mockListTrashed.mockResolvedValue([VELKA]);
    let unblock!: () => void;
    mockRestore.mockReturnValueOnce(
      new Promise<{ message: string }>((res) => {
        unblock = () => res({ message: 'restored' });
      }),
    );
    renderTrash(ALICE);
    fireEvent.click(await screen.findByRole('button', { name: /restore velka/i }));
    const confirmBtn = await screen.findByRole('button', { name: 'Restore' });

    // Two rapid clicks on the same trigger, mirroring the campaigns section's
    // own double-submit pin below — the observable contract (one call) holds
    // whether it's the ref latch or the disabled attribute doing the work.
    fireEvent.click(confirmBtn);
    fireEvent.click(confirmBtn);

    await act(async () => {
      unblock();
    });

    await waitFor(() => expect(mockRestore).toHaveBeenCalledTimes(1));
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
    // charSub formats deleted_at as "… · trashed <date>" in the sub-line. The
    // "·" distinguishes this from the campaigns section's unrelated "No
    // trashed campaigns." empty note, which also matches a bare /trashed/i.
    expect(screen.getByText(/·\s*trashed/i)).toBeInTheDocument();
  });
});

function apiError(status: number, reason?: string) {
  const e = new Error(reason ?? 'error') as Error & { status: number; body: unknown };
  e.status = status;
  e.body = reason ? { success: false, data: { reason } } : { success: false, error: 'error' };
  return e;
}

describe('Trash — campaigns (TAV-CAMPAIGN-TRASH-NO-RESTORE-UI)', () => {
  it('both empty → the single page-level empty state, not two section notes', async () => {
    renderTrash(ALICE);
    await waitFor(() =>
      expect(screen.getByText(/your trash is empty/i)).toBeInTheDocument(),
    );
    expect(screen.queryByText(/no trashed characters/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/no trashed campaigns/i)).not.toBeInTheDocument();
  });

  it('campaigns section shows its own empty note while characters section is populated', async () => {
    mockListTrashed.mockResolvedValue([VELKA]);
    mockListTrashedSessions.mockResolvedValue([]);
    renderTrash(ALICE);
    await screen.findByText('Velka');
    expect(screen.getByText(/no trashed campaigns/i)).toBeInTheDocument();
    // the big page-level empty card must NOT also be showing
    expect(screen.queryByText(/^your trash is empty\.?$/i)).not.toBeInTheDocument();
  });

  it('characters section shows its own empty note while campaigns section is populated', async () => {
    mockListTrashedSessions.mockResolvedValue([DRAGONS_HOARD]);
    renderTrash(ALICE);
    await screen.findByText("The Dragon's Hoard");
    expect(screen.getByText(/no trashed characters/i)).toBeInTheDocument();
  });

  it('renders a row per trashed campaign with an accessible name identifying which campaign', async () => {
    mockListTrashedSessions.mockResolvedValue([DRAGONS_HOARD, LOST_MINE]);
    renderTrash(ALICE);
    await waitFor(() => expect(screen.getByText("The Dragon's Hoard")).toBeInTheDocument());
    expect(screen.getByText('Lost Mine of Phandelver')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /restore the dragon's hoard/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /restore lost mine of phandelver/i }),
    ).toBeInTheDocument();
  });

  it('restore → opens a confirm dialog naming the campaign, then calls restoreSession(id, username) and drops the row', async () => {
    mockListTrashedSessions
      .mockResolvedValueOnce([DRAGONS_HOARD, LOST_MINE])
      .mockResolvedValue([LOST_MINE]);
    renderTrash(ALICE);
    const trigger = await screen.findByRole('button', {
      name: /restore the dragon's hoard/i,
    });
    fireEvent.click(trigger);

    expect(
      await screen.findByRole('heading', { name: /restore the dragon's hoard\?/i }),
    ).toBeInTheDocument();
    const confirmBtn = screen.getByRole('button', { name: 'Restore' });
    expect(mockRestoreSession).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(confirmBtn);
    });

    await waitFor(() => expect(mockRestoreSession).toHaveBeenCalledWith('s1', 'alice'));
    await waitFor(() =>
      expect(screen.queryByText("The Dragon's Hoard")).not.toBeInTheDocument(),
    );
    expect(screen.getByText('Lost Mine of Phandelver')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('restore → Cancel leaves the campaign row untouched', async () => {
    mockListTrashedSessions.mockResolvedValue([DRAGONS_HOARD]);
    renderTrash(ALICE);
    fireEvent.click(
      await screen.findByRole('button', { name: /restore the dragon's hoard/i }),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(mockRestoreSession).not.toHaveBeenCalled();
    expect(screen.getByText("The Dragon's Hoard")).toBeInTheDocument();
  });

  it('restore failure → curated engineErrorMessage copy, row rolls back (optimistic undo)', async () => {
    mockListTrashedSessions.mockResolvedValue([DRAGONS_HOARD]);
    mockRestoreSession.mockRejectedValueOnce(apiError(400, 'not_found'));
    renderTrash(ALICE);
    fireEvent.click(
      await screen.findByRole('button', { name: /restore the dragon's hoard/i }),
    );
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'Restore' }));
    });

    await waitFor(() => expect(mockRestoreSession).toHaveBeenCalled());
    // RESTORE_CAMPAIGN_REASON_MAP's curated copy for not_found, not a hand-rolled string
    await waitFor(() =>
      expect(
        screen.getByText(/couldn.t be found — it may already be gone for good/i),
      ).toBeInTheDocument(),
    );
    // rolled back — the row is back in the list
    await waitFor(() =>
      expect(screen.getByText("The Dragon's Hoard")).toBeInTheDocument(),
    );
  });

  it('double-submit latch: a second confirm click while the first is in flight fires restoreSession only once', async () => {
    mockListTrashedSessions.mockResolvedValue([DRAGONS_HOARD]);
    let unblock!: () => void;
    mockRestoreSession.mockReturnValueOnce(
      new Promise<{ message: string }>((res) => {
        unblock = () => res({ message: 'restored' });
      }),
    );
    renderTrash(ALICE);
    fireEvent.click(
      await screen.findByRole('button', { name: /restore the dragon's hoard/i }),
    );
    const confirmBtn = await screen.findByRole('button', { name: 'Restore' });

    // Two rapid clicks on the same trigger — the first starts the in-flight
    // request (synchronously flipping `sessionInFlightRef` AND the dialog's
    // `busy` disable together); the second must not fire a second call
    // whether it's blocked by the ref latch or the disabled attribute — the
    // observable contract (one call) is what matters here.
    fireEvent.click(confirmBtn);
    fireEvent.click(confirmBtn);

    await act(async () => {
      unblock();
    });

    await waitFor(() => expect(mockRestoreSession).toHaveBeenCalledTimes(1));
  });

  // ── Iro MINOR-1 (2026-08-12) ────────────────────────────────────────────
  // Ported from the characters section's own MAJOR-1 (Tora) pins above —
  // `confirmRestoreCampaign` uses the exact same "close the dialog, THEN
  // refocus" shape (`nextBtn ?? backRef`) as `confirmRestore`, and that
  // shape had coverage on the characters path only. Same fixtures/mock
  // shape as the characters version, adapted to sessions/restoreSession.
  it('MAJOR-1 (Tora), ported: focus never escapes the open confirm dialog mid-flight, and lands on the surviving campaign row on close', async () => {
    mockListTrashedSessions
      .mockResolvedValueOnce([DRAGONS_HOARD, LOST_MINE])
      .mockResolvedValue([LOST_MINE]);
    let unblock!: () => void;
    mockRestoreSession.mockReturnValueOnce(
      new Promise<{ message: string }>((res) => {
        unblock = () => res({ message: 'restored' });
      }),
    );
    renderTrash(ALICE);
    fireEvent.click(
      await screen.findByRole('button', { name: /restore the dragon's hoard/i }),
    );
    const confirmBtn = await screen.findByRole('button', { name: 'Restore' });

    await act(async () => {
      fireEvent.click(confirmBtn);
    });

    // While the restore is in flight, the dialog is still open+busy — focus
    // must still be INSIDE it (never escaped to the Lost Mine row behind it).
    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).not.toBe(
      screen.getByRole('button', { name: /restore lost mine of phandelver/i }),
    );

    await act(async () => {
      unblock();
    });

    // Dialog closed; the Dragon's Hoard row is gone; focus landed on the
    // surviving Lost Mine row's Restore button (the "surviving trigger"),
    // not lost to <body> and not stuck on a detached node.
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.queryByText("The Dragon's Hoard")).not.toBeInTheDocument();
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('button', { name: /restore lost mine of phandelver/i }),
      ),
    );
  });

  it('MAJOR-1 (Tora), ported: with no surviving campaign row, focus lands on "Back to dashboard" on close', async () => {
    // Characters section is already empty (the `beforeEach` default), so
    // restoring the last campaign row transitions the WHOLE page to the
    // big page-level empty card — same shape as the characters version's
    // own "no surviving row" pin, whose `backRef` target is that card's
    // own link, not the two-section layout's bottom button.
    mockListTrashedSessions.mockResolvedValueOnce([DRAGONS_HOARD]).mockResolvedValue([]);
    let unblock!: () => void;
    mockRestoreSession.mockReturnValueOnce(
      new Promise<{ message: string }>((res) => {
        unblock = () => res({ message: 'restored' });
      }),
    );
    renderTrash(ALICE);
    fireEvent.click(
      await screen.findByRole('button', { name: /restore the dragon's hoard/i }),
    );
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
});

describe('Trash — campaigns listing unavailable (TAV-TRASH-CAMPAIGNS-404-HIDE)', () => {
  it('404 from the campaigns listing hides the Campaigns section entirely — no "No trashed campaigns." claim', async () => {
    mockListTrashed.mockResolvedValue([VELKA]);
    mockListTrashedSessions.mockRejectedValueOnce(apiError(404));
    renderTrash(ALICE);

    await screen.findByText('Velka');
    // The section, its heading, and its "empty" note must all be absent —
    // not merely the note. Rendering the section with the empty note is the
    // exact defect this fix targets.
    expect(
      screen.queryByRole('heading', { name: /^campaigns$/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/no trashed campaigns/i)).not.toBeInTheDocument();
    // Characters section is fully unaffected by the campaigns failure.
    expect(screen.getByText('Velka')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /restore velka/i })).toBeInTheDocument();
  });

  it('an unreachable/network failure from the campaigns listing also hides the section (not just 404)', async () => {
    mockListTrashed.mockResolvedValue([VELKA]);
    mockListTrashedSessions.mockRejectedValueOnce(apiError(0));
    renderTrash(ALICE);

    await screen.findByText('Velka');
    expect(screen.queryByText(/no trashed campaigns/i)).not.toBeInTheDocument();
  });

  it('campaigns listing fails AND characters trash is also empty → still no page-level "Your trash is empty", since campaigns state is unknown', async () => {
    mockListTrashed.mockResolvedValue([]);
    mockListTrashedSessions.mockRejectedValueOnce(apiError(404));
    renderTrash(ALICE);

    // The characters section resolves to its own honest empty note...
    await waitFor(() =>
      expect(screen.getByText(/no trashed characters/i)).toBeInTheDocument(),
    );
    // ...but the big empty card (which asserts BOTH characters and campaigns
    // are confirmed empty) must never show — campaigns was never confirmed.
    expect(screen.queryByText(/your trash is empty/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/no trashed campaigns/i)).not.toBeInTheDocument();
  });

  it('campaigns listing succeeds with zero results → "No trashed campaigns." still renders (not confused with the failure case)', async () => {
    mockListTrashed.mockResolvedValue([VELKA]);
    mockListTrashedSessions.mockResolvedValueOnce([]);
    renderTrash(ALICE);

    await screen.findByText('Velka');
    expect(screen.getByText(/no trashed campaigns/i)).toBeInTheDocument();
  });

  it('campaigns listing succeeds with results → rows render normally after a prior state', async () => {
    mockListTrashed.mockResolvedValue([VELKA]);
    mockListTrashedSessions.mockResolvedValueOnce([DRAGONS_HOARD]);
    renderTrash(ALICE);

    await screen.findByText("The Dragon's Hoard");
    expect(
      screen.getByRole('button', { name: /restore the dragon's hoard/i }),
    ).toBeInTheDocument();
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
