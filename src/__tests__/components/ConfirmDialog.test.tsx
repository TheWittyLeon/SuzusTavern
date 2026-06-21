/**
 * DEL-7 — ConfirmDialog accessibility + behaviour.
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';

import ConfirmDialog from '../../components/ConfirmDialog';

test('renders nothing when closed', () => {
  const { container } = render(
    <ConfirmDialog open={false} title="X" onConfirm={() => {}} onCancel={() => {}} />,
  );
  expect(container).toBeEmptyDOMElement();
});

test('is a labelled modal and focuses Cancel on open', async () => {
  render(
    <ConfirmDialog
      open
      title="Delete Aria?"
      body="This moves it to trash."
      cancelLabel="Keep"
      onConfirm={() => {}}
      onCancel={() => {}}
    />,
  );
  const dialog = screen.getByRole('dialog');
  expect(dialog).toHaveAttribute('aria-modal', 'true');
  expect(dialog).toHaveAccessibleName('Delete Aria?');
  // Cancel receives focus on open (after the post-paint timeout).
  await screen.findByRole('button', { name: 'Keep' });
  await new Promise((r) => setTimeout(r, 5));
  expect(screen.getByRole('button', { name: 'Keep' })).toHaveFocus();
});

test('Escape cancels; confirm/cancel buttons fire; busy disables', () => {
  const onCancel = jest.fn();
  const onConfirm = jest.fn();
  const { rerender } = render(
    <ConfirmDialog open title="X" onConfirm={onConfirm} onCancel={onCancel} />,
  );

  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
  expect(onCancel).toHaveBeenCalledTimes(1);

  fireEvent.click(screen.getByRole('button', { name: /confirm/i }));
  expect(onConfirm).toHaveBeenCalledTimes(1);

  rerender(
    <ConfirmDialog open busy title="X" onConfirm={onConfirm} onCancel={onCancel} />,
  );
  expect(screen.getByRole('button', { name: /cancel/i })).toBeDisabled();
});

test('backdrop click cancels', () => {
  const onCancel = jest.fn();
  render(<ConfirmDialog open title="X" onConfirm={() => {}} onCancel={onCancel} />);
  // The backdrop is the dialog's parent (the outermost element).
  const backdrop = screen.getByRole('dialog').parentElement as HTMLElement;
  fireEvent.click(backdrop);
  expect(onCancel).toHaveBeenCalledTimes(1);
});
