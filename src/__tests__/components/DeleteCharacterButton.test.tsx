/**
 * DEL-7 — DeleteCharacterButton: confirm → soft-delete → undo toast (restore).
 */
import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';

jest.mock('../../lib/api/dnd', () => ({
  deleteCharacter: jest.fn(),
  restoreCharacter: jest.fn(),
}));

import * as dnd from '../../lib/api/dnd';
import { ToastProvider } from '../../components/Toast';
import DeleteCharacterButton from '../../components/DeleteCharacterButton';

const mockDelete = dnd.deleteCharacter as jest.Mock;
const mockRestore = dnd.restoreCharacter as jest.Mock;

function renderButton(props?: Partial<React.ComponentProps<typeof DeleteCharacterButton>>) {
  const onChanged = jest.fn();
  const onDeleted = jest.fn();
  render(
    <ToastProvider>
      <DeleteCharacterButton
        characterId="cid-1"
        characterName="Aria"
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

test('confirm dialog → soft-delete on confirm → callbacks + undo toast', async () => {
  mockDelete.mockResolvedValue({ message: 'trashed' });
  const { onChanged, onDeleted } = renderButton();

  fireEvent.click(screen.getByRole('button', { name: /delete aria/i }));
  const dialog = screen.getByRole('dialog');
  expect(dialog).toHaveAttribute('aria-modal', 'true');

  fireEvent.click(screen.getByRole('button', { name: /move to trash/i }));

  await waitFor(() => expect(mockDelete).toHaveBeenCalledWith('cid-1', 'leon'));
  expect(onChanged).toHaveBeenCalled();
  expect(onDeleted).toHaveBeenCalled();
  expect(await screen.findByText(/recoverable for 7 days/i)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /undo/i })).toBeInTheDocument();
});

test('Undo restores the character', async () => {
  mockDelete.mockResolvedValue({ message: 'trashed' });
  mockRestore.mockResolvedValue({ message: 'restored' });
  renderButton();

  fireEvent.click(screen.getByRole('button', { name: /delete aria/i }));
  fireEvent.click(screen.getByRole('button', { name: /move to trash/i }));
  const undo = await screen.findByRole('button', { name: /undo/i });

  fireEvent.click(undo);
  await waitFor(() => expect(mockRestore).toHaveBeenCalledWith('cid-1', 'leon'));
});

test('Cancel closes the dialog without deleting', async () => {
  renderButton();

  fireEvent.click(screen.getByRole('button', { name: /delete aria/i }));
  fireEvent.click(screen.getByRole('button', { name: /keep/i }));

  expect(mockDelete).not.toHaveBeenCalled();
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
});

test('a 404 surfaces an "already gone" error and does not crash', async () => {
  const err = Object.assign(new Error('gone'), { status: 404 });
  mockDelete.mockRejectedValue(err);
  renderButton();

  fireEvent.click(screen.getByRole('button', { name: /delete aria/i }));
  fireEvent.click(screen.getByRole('button', { name: /move to trash/i }));
  expect(await screen.findByText(/already gone/i)).toBeInTheDocument();
});

test('a failed Undo (restore) surfaces the "stays in trash 7 days" message', async () => {
  mockDelete.mockResolvedValue({ message: 'trashed' });
  mockRestore.mockRejectedValue(new Error('network'));
  renderButton();

  fireEvent.click(screen.getByRole('button', { name: /delete aria/i }));
  fireEvent.click(screen.getByRole('button', { name: /move to trash/i }));
  const undo = await screen.findByRole('button', { name: /undo/i });
  fireEvent.click(undo);
  expect(
    await screen.findByText(/stays in your trash for 7 days/i),
  ).toBeInTheDocument();
});
