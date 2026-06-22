/**
 * DeleteCampaignButton: DM-only confirm → soft-delete → undo toast (restore).
 */
import React from 'react';
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
