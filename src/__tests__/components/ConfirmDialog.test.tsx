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

test('busy flip parks focus on the dialog itself (Kage m5 focus park)', async () => {
  // LEVELUP-UX-A11Y-TAIL: in a REAL browser, disabling the focused button
  // blurs focus to <body>, so the keydown-based busy-Tab park can never fire
  // — the EFFECT must park focus the moment busy flips. jsdom lets disabled
  // buttons keep focus (browsers refuse), so this asserts the OUTCOME (the
  // dialog node itself holds focus) — the state real browsers end up needing.
  const { rerender } = render(
    <ConfirmDialog open title="X" onConfirm={() => {}} onCancel={() => {}} />,
  );
  await new Promise((r) => setTimeout(r, 5)); // let the open-focus land
  rerender(
    <ConfirmDialog open busy title="X" onConfirm={() => {}} onCancel={() => {}} />,
  );
  const dialog = screen.getByRole('dialog');
  expect(dialog).toHaveFocus();
  // The park target is focusable-but-not-tabbable (tabIndex=-1) — the trap
  // convention every overlay here uses.
  expect(dialog).toHaveAttribute('tabindex', '-1');
});

// ── TAV-CONFIRMDIALOG-NO-SCROLL-LOCK (1.7 audit, 2026-08-10) ─────────────────
// The backdrop is position:fixed/inset:0, so it blocked CLICKS through to the
// page — but a wheel/trackpad scroll over it still bubbled to <body> and moved
// the content behind the modal (verified live on the Long-rest dialog). Fixed
// in the shared component because none of its ~14 consumers had their own lock.

test('SCROLL-LOCK: locks body scroll while open and releases it on close', () => {
  const { rerender } = render(
    <ConfirmDialog open={false} title="X" onConfirm={() => {}} onCancel={() => {}} />,
  );
  expect(document.body.style.overflow).toBe('');

  rerender(<ConfirmDialog open title="X" onConfirm={() => {}} onCancel={() => {}} />);
  expect(document.body.style.overflow).toBe('hidden');
  expect(document.body.style.overscrollBehavior).toBe('contain');

  rerender(
    <ConfirmDialog open={false} title="X" onConfirm={() => {}} onCancel={() => {}} />,
  );
  expect(document.body.style.overflow).toBe('');
});

test("SCROLL-LOCK: restores the page's OWN previous overflow, not a hardcoded ''", () => {
  // A page that had already set body overflow itself (or a nested dialog) must
  // get its value back — clobbering it to '' would silently re-enable scrolling
  // somewhere that had deliberately disabled it.
  document.body.style.overflow = 'clip';
  const { rerender } = render(
    <ConfirmDialog open title="X" onConfirm={() => {}} onCancel={() => {}} />,
  );
  expect(document.body.style.overflow).toBe('hidden');
  rerender(
    <ConfirmDialog open={false} title="X" onConfirm={() => {}} onCancel={() => {}} />,
  );
  expect(document.body.style.overflow).toBe('clip');
  document.body.style.overflow = '';
});
