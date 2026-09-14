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

// ENGINE-PARTICIPANT-FK-CHECK-CONTRADICTION (2026-09-10, NekoNova-DnDEngine
// fix/participant-fk-cascade @ e5b14b5): the engine's new delete refusal
// when the character is seated in an active encounter — reaches the Tavern
// intact through the proxy (dnd_characters.py forwards `message`).
test('a 409 character_in_active_combat surfaces the engine\'s own message via role="alert", and the character stays listed', async () => {
  const err = Object.assign(new Error('conflict'), {
    status: 409,
    code: '409',
    body: {
      success: false,
      message:
        'Character is seated in an active encounter (#42); end the fight before deleting.',
      data: { reason: 'character_in_active_combat' },
    },
  });
  mockDelete.mockRejectedValue(err);
  const { onChanged, onDeleted } = renderButton();

  fireEvent.click(screen.getByRole('button', { name: /delete aria/i }));
  fireEvent.click(screen.getByRole('button', { name: /move to trash/i }));

  // The engine's own message is the source of truth — never a curated
  // paraphrase — and lands in the toast's role="alert" surface (not
  // colour-only).
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent(
    /Character is seated in an active encounter \(#42\); end the fight before deleting\./i,
  );

  // Nothing was mutated — the character was never removed from the caller's
  // list, and no navigate-away fires.
  expect(onChanged).not.toHaveBeenCalled();
  expect(onDeleted).not.toHaveBeenCalled();
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
