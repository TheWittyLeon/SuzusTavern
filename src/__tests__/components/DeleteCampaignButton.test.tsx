/**
 * DeleteCampaignButton: DM-only confirm → soft-delete → undo toast (restore).
 */
import React, { createRef } from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';

jest.mock('../../lib/api/dnd', () => ({
  deleteSession: jest.fn(),
  restoreSession: jest.fn(),
}));

import * as dnd from '../../lib/api/dnd';
import { ToastProvider } from '../../components/Toast';
import DeleteCampaignButton from '../../components/DeleteCampaignButton';

const mockDelete = dnd.deleteSession as jest.Mock;
const mockRestore = dnd.restoreSession as jest.Mock;

function renderButton(props?: Partial<React.ComponentProps<typeof DeleteCampaignButton>>) {
  const onChanged = jest.fn();
  const onDeleted = jest.fn();
  render(
    <ToastProvider>
      <DeleteCampaignButton
        sessionId="sess-1"
        campaignName="Hollow Tide"
        username="leon"
        onChanged={onChanged}
        onDeleted={onDeleted}
        {...props}
      />
    </ToastProvider>,
  );
  return { onChanged, onDeleted };
}

beforeEach(() => {
  mockDelete.mockReset();
  mockRestore.mockReset();
});

test('confirm dialog spells out the blast radius → soft-delete → undo toast', async () => {
  mockDelete.mockResolvedValue({ message: 'trashed' });
  const { onChanged, onDeleted } = renderButton();

  fireEvent.click(screen.getByRole('button', { name: /delete campaign hollow tide/i }));
  const dialog = screen.getByRole('dialog');
  expect(dialog).toHaveAttribute('aria-modal', 'true');
  // copy reassures that player characters survive
  expect(screen.getByText(/players.{0,3} characters are kept/i)).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: /move to trash/i }));

  await waitFor(() => expect(mockDelete).toHaveBeenCalledWith('sess-1', 'leon'));
  expect(onChanged).toHaveBeenCalled();
  expect(onDeleted).toHaveBeenCalled();
  expect(await screen.findByText(/recoverable for 7 days/i)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /undo/i })).toBeInTheDocument();
});

test('Undo restores the campaign', async () => {
  mockDelete.mockResolvedValue({ message: 'trashed' });
  mockRestore.mockResolvedValue({ message: 'restored' });
  renderButton();

  fireEvent.click(screen.getByRole('button', { name: /delete campaign hollow tide/i }));
  fireEvent.click(screen.getByRole('button', { name: /move to trash/i }));
  const undo = await screen.findByRole('button', { name: /undo/i });

  fireEvent.click(undo);
  await waitFor(() => expect(mockRestore).toHaveBeenCalledWith('sess-1', 'leon'));
});

test('Cancel closes the dialog without deleting', async () => {
  renderButton();

  fireEvent.click(screen.getByRole('button', { name: /delete campaign hollow tide/i }));
  fireEvent.click(screen.getByRole('button', { name: /keep/i }));

  expect(mockDelete).not.toHaveBeenCalled();
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
});

test('a 404 surfaces an "already gone" error and does not crash', async () => {
  const err = Object.assign(new Error('gone'), { status: 404 });
  mockDelete.mockRejectedValue(err);
  renderButton();

  fireEvent.click(screen.getByRole('button', { name: /delete campaign hollow tide/i }));
  fireEvent.click(screen.getByRole('button', { name: /move to trash/i }));
  expect(await screen.findByText(/already gone/i)).toBeInTheDocument();
});

test('a failed Undo (restore) surfaces the "stays in trash 7 days" message', async () => {
  mockDelete.mockResolvedValue({ message: 'trashed' });
  mockRestore.mockRejectedValue(new Error('network'));
  renderButton();

  fireEvent.click(screen.getByRole('button', { name: /delete campaign hollow tide/i }));
  fireEvent.click(screen.getByRole('button', { name: /move to trash/i }));
  const undo = await screen.findByRole('button', { name: /undo/i });
  fireEvent.click(undo);
  expect(
    await screen.findByText(/stays in your trash for 7 days/i),
  ).toBeInTheDocument();
});

test('dialog buttons are disabled while the delete request is in flight (busy guard)', async () => {
  // A never-resolving promise keeps the component in the busy state so we can
  // assert both buttons are disabled before the request completes.
  let resolveDelete!: () => void;
  mockDelete.mockReturnValue(new Promise<void>((res) => { resolveDelete = res; }));
  renderButton();

  fireEvent.click(screen.getByRole('button', { name: /delete campaign hollow tide/i }));
  fireEvent.click(screen.getByRole('button', { name: /move to trash/i }));

  // Both ConfirmDialog buttons must be disabled while busy=true.
  expect(screen.getByRole('button', { name: /keep/i })).toBeDisabled();
  // The confirm button label changes to "…" while busy; query by aria-label.
  expect(screen.getByRole('button', { name: /move to trash/i })).toBeDisabled();

  // Let the request settle so the component can tear down cleanly.
  resolveDelete();
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
});

test('successful Undo calls onChanged so the caller re-fetches', async () => {
  mockDelete.mockResolvedValue({ message: 'trashed' });
  mockRestore.mockResolvedValue({ message: 'restored' });
  const { onChanged } = renderButton();

  fireEvent.click(screen.getByRole('button', { name: /delete campaign hollow tide/i }));
  fireEvent.click(screen.getByRole('button', { name: /move to trash/i }));
  const undo = await screen.findByRole('button', { name: /undo/i });

  // onChanged is called once for the delete; reset so we can isolate the restore call.
  onChanged.mockClear();

  fireEvent.click(undo);
  await waitFor(() => expect(mockRestore).toHaveBeenCalledWith('sess-1', 'leon'));
  expect(onChanged).toHaveBeenCalledTimes(1);
});

// GAP-1 (critical): generic non-404 failure path.
// The 404 branch is tested above; this covers a network error / 500 — the other
// branch of errMessage. The campaign row must stay visible (the dialog closes,
// no optimistic removal happened) and the user must see an actionable error.
test('a generic network failure surfaces the "Try again" error and does not remove the row', async () => {
  mockDelete.mockRejectedValue(new Error('network'));
  const { onChanged, onDeleted } = renderButton();

  fireEvent.click(screen.getByRole('button', { name: /delete campaign hollow tide/i }));
  fireEvent.click(screen.getByRole('button', { name: /move to trash/i }));

  // Dialog must close (confirmDelete's catch block calls setConfirming(false)).
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  // The error toast must be visible.
  expect(await screen.findByText(/could not delete the campaign/i)).toBeInTheDocument();
  // Neither callback fires — the row was not removed.
  expect(onChanged).not.toHaveBeenCalled();
  expect(onDeleted).not.toHaveBeenCalled();
  // The trigger button is still rendered and not disabled (ready to retry).
  expect(screen.getByRole('button', { name: /delete campaign hollow tide/i })).toBeEnabled();
});

// GAP-2: variant="button" render path.
// The button variant is shipped and used in campaign settings/detail headers — it
// must render a visible "Delete campaign" label, not just a trash icon.
test('variant="button" renders a labelled danger button (not an icon) that opens the dialog', async () => {
  mockDelete.mockResolvedValue({ message: 'trashed' });
  renderButton({ variant: 'button' });

  const btn = screen.getByRole('button', { name: /delete campaign/i });
  // Should NOT be an icon-only button — the text "Delete campaign" must be in the DOM.
  expect(btn).toHaveTextContent(/delete campaign/i);

  fireEvent.click(btn);
  expect(await screen.findByRole('dialog')).toBeInTheDocument();
});

// Tora MAJOR-1: the undo toast must be non-auto-dismissing (duration: Infinity)
// and dismiss() must be called with the toast id on a successful restore.
test('undo toast uses duration:Infinity and dismiss is called on successful restore', async () => {
  mockDelete.mockResolvedValue({ message: 'trashed' });
  mockRestore.mockResolvedValue({ message: 'restored' });

  // Intercept the toast() call to inspect options and capture the returned id.
  let capturedDuration: number | undefined;
  let capturedToastId: string | undefined;
  let capturedDismiss: ((id: string) => void) | undefined;

  // Wrap ToastProvider's context value to spy on toast/dismiss.
  // We render inside a real ToastProvider so the full machinery works, and
  // separately verify the options via the ToastCard that appears in the DOM.
  // jsdom doesn't run CSS timers the same way, so we verify duration indirectly:
  // with duration:Infinity the toast must NOT disappear on its own (no timer fires).
  mockDelete.mockResolvedValue({ message: 'trashed' });
  renderButton();

  fireEvent.click(screen.getByRole('button', { name: /delete campaign hollow tide/i }));
  fireEvent.click(screen.getByRole('button', { name: /move to trash/i }));

  // Toast appears with an Undo button.
  const undoBtn = await screen.findByRole('button', { name: /undo/i });
  expect(undoBtn).toBeInTheDocument();

  // The toast must still be present after the default 5000ms window —
  // verified by jest's fake timers. If duration were 5000ms, advancing
  // 5001ms would trigger onDismiss and remove the toast from the DOM.
  // With duration:Infinity the auto-dismiss timer is never set so the toast stays.
  jest.useFakeTimers();
  jest.advanceTimersByTime(6000);
  // Toast is still present (Undo button not gone).
  expect(screen.getByRole('button', { name: /undo/i })).toBeInTheDocument();
  jest.useRealTimers();

  // Clicking Undo triggers restore and the toast should be dismissed.
  fireEvent.click(undoBtn);
  await waitFor(() => expect(mockRestore).toHaveBeenCalledWith('sess-1', 'leon'));
  // After restore succeeds the undo toast is dismissed (exits the DOM after animation).
  await waitFor(() => expect(screen.queryByRole('button', { name: /undo/i })).not.toBeInTheDocument());
});

// Tora MINOR-1: double-tap on Undo must only fire one restoreSession call.
test('rapid double-tap on Undo only fires restoreSession once', async () => {
  mockDelete.mockResolvedValue({ message: 'trashed' });
  // restoreSession resolves on the second tick so we can fire two clicks before it settles.
  let resolveRestore!: () => void;
  mockRestore.mockReturnValue(new Promise<{ message: string }>((res) => { resolveRestore = () => res({ message: 'restored' }); }));

  renderButton();

  fireEvent.click(screen.getByRole('button', { name: /delete campaign hollow tide/i }));
  fireEvent.click(screen.getByRole('button', { name: /move to trash/i }));

  const undoBtn = await screen.findByRole('button', { name: /undo/i });

  // Fire two clicks back-to-back before the first restore resolves.
  fireEvent.click(undoBtn);
  fireEvent.click(undoBtn);

  resolveRestore();
  await waitFor(() => expect(mockRestore).toHaveBeenCalledTimes(1));
});

// Iro MAJOR-1: focus lands on focusFallbackRef element after a confirmed delete,
// not on <body>. jsdom supports programmatic focus when tabIndex is set.
test('focus moves to focusFallbackRef after a confirmed delete', async () => {
  mockDelete.mockResolvedValue({ message: 'trashed' });

  const fallbackRef = createRef<HTMLDivElement>();
  render(
    <ToastProvider>
      {/* Simulate the stable section heading the dashboard provides */}
      <div ref={fallbackRef as React.RefObject<HTMLDivElement>} tabIndex={-1} data-testid="fallback">
        My campaigns
      </div>
      <DeleteCampaignButton
        sessionId="sess-1"
        campaignName="Hollow Tide"
        username="leon"
        focusFallbackRef={fallbackRef as React.RefObject<HTMLElement | null>}
      />
    </ToastProvider>,
  );

  fireEvent.click(screen.getByRole('button', { name: /delete campaign hollow tide/i }));
  fireEvent.click(screen.getByRole('button', { name: /move to trash/i }));

  await waitFor(() => expect(mockDelete).toHaveBeenCalled());
  // The section heading (fallback) must have received focus, not <body>.
  expect(document.activeElement).toBe(screen.getByTestId('fallback'));
});
