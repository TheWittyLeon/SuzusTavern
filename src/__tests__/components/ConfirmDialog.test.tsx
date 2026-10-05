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

test('a press and release on the backdrop, after the arm window, cancels', async () => {
  const onCancel = jest.fn();
  render(<ConfirmDialog open title="X" onConfirm={() => {}} onCancel={onCancel} />);
  // The backdrop is the dialog's parent (the outermost element).
  const backdrop = screen.getByRole('dialog').parentElement as HTMLElement;
  await new Promise((r) => setTimeout(r, 350));
  fireEvent.pointerDown(backdrop);
  fireEvent.click(backdrop);
  expect(onCancel).toHaveBeenCalledTimes(1);
});

test('a click within the arm window after open is ignored (the second click of a double press on the opener)', () => {
  const onCancel = jest.fn();
  render(<ConfirmDialog open title="X" onConfirm={() => {}} onCancel={onCancel} />);
  const backdrop = screen.getByRole('dialog').parentElement as HTMLElement;
  fireEvent.pointerDown(backdrop);
  fireEvent.click(backdrop);
  expect(onCancel).not.toHaveBeenCalled();
});

test('a press that began inside the dialog and was released on the backdrop does not cancel; nor does a click with no press on it', async () => {
  const onCancel = jest.fn();
  render(<ConfirmDialog open title="X" onConfirm={() => {}} onCancel={onCancel} />);
  const dialog = screen.getByRole('dialog');
  const backdrop = dialog.parentElement as HTMLElement;
  await new Promise((r) => setTimeout(r, 350));
  fireEvent.pointerDown(dialog);
  fireEvent.click(backdrop);
  expect(onCancel).not.toHaveBeenCalled();
  fireEvent.click(backdrop);
  expect(onCancel).not.toHaveBeenCalled();
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

test('a press on the scrim never moves focus: mousedown on it is default-prevented, whether or not the click that follows dismisses (Kage N-1)', async () => {
  render(<><button>opener</button><ConfirmDialog open title="X" onConfirm={() => {}} onCancel={() => {}} /></>);
  const dialog = screen.getByRole('dialog');
  const scrim = dialog.parentElement as HTMLElement;
  await new Promise((r) => setTimeout(r, 5));
  // fireEvent returns false when the event's default was prevented
  expect(fireEvent.mouseDown(scrim)).toBe(false);
  // inside the dialog a press is NOT prevented (its fields and buttons take focus as usual)
  expect(fireEvent.mouseDown(dialog)).toBe(true);
  expect(screen.getByRole('button', { name: /cancel/i })).toHaveFocus();
});

test('a failed request (busy falls back with the dialog still open) puts focus on Cancel, not on the dialog box; a success that closes it does not (Iro MINOR-7)', async () => {
  const { rerender } = render(<ConfirmDialog open title="X" onConfirm={() => {}} onCancel={() => {}} />);
  await new Promise((r) => setTimeout(r, 5));
  rerender(<ConfirmDialog open busy title="X" onConfirm={() => {}} onCancel={() => {}} />);
  expect(screen.getByRole('dialog')).toHaveFocus();
  rerender(<ConfirmDialog open title="X" onConfirm={() => {}} onCancel={() => {}} />);
  expect(screen.getByRole('button', { name: /cancel/i })).toHaveFocus();
});

test('busy, then closed (a success): the dialog is gone and nothing is focused on its behalf', async () => {
  const { rerender } = render(<><button>opener</button><ConfirmDialog open title="X" onConfirm={() => {}} onCancel={() => {}} /></>);
  await new Promise((r) => setTimeout(r, 5));
  rerender(<><button>opener</button><ConfirmDialog open busy title="X" onConfirm={() => {}} onCancel={() => {}} /></>);
  rerender(<><button>opener</button><ConfirmDialog open={false} title="X" onConfirm={() => {}} onCancel={() => {}} /></>);
  expect(screen.queryByRole('dialog')).toBeNull();
});
