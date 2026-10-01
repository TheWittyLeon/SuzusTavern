/**
 * Drawer — direct regression coverage for the primitive's own contract.
 * Before this file, Drawer had ZERO tests of its own; every property it
 * relies on was only incidentally exercised through PlayPage (Miko-QA
 * finding, 2026-09-21 review round: mutating `aria-hidden` off `open` caught 0
 * of 553 red; mutating `inert` to always `false` left 2,223 green). This file
 * pins each state directly.
 *
 * A9d E4: `open` is the ONLY presence prop. The A6 "visible=true, open=false"
 * in-flow mobile-tab pane and Kage I1's "open=true, visible=false" guard were
 * two halves of a contract that existed only because there was a second,
 * non-dialog presentation; both are deleted with it (the bad state is no
 * longer representable, so there is nothing to warn about). What pins the
 * invariant now: the two states below, and play.journal.test.tsx's phone-width
 * case (the Journal opens as a dialog on a phone, there is no tab).
 */
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { createRef } from 'react';
import Drawer from '../../components/Drawer';

function renderDrawer(props: Partial<React.ComponentProps<typeof Drawer>> = {}) {
  const closeButtonRef = createRef<HTMLButtonElement>();
  const onClose = jest.fn();
  const utils = render(
    <Drawer
      id="test-drawer"
      open={false}
      labelledBy="test-drawer-heading"
      onClose={onClose}
      closeButtonRef={closeButtonRef}
      {...props}
    >
      <h2 id="test-drawer-heading">Test Drawer</h2>
      <button type="button" ref={closeButtonRef}>
        Close
      </button>
    </Drawer>,
  );
  return { ...utils, onClose, closeButtonRef };
}

describe('Drawer — fully closed (open=false)', () => {
  it('is hidden from the accessibility tree and inert', () => {
    renderDrawer({ open: false });
    const aside = document.getElementById('test-drawer')!;
    expect(aside).toHaveAttribute('aria-hidden', 'true');
    expect(aside).toHaveAttribute('inert');
  });

  it('stays mounted (A5) — content is in the DOM, just inaccessible', () => {
    renderDrawer({ open: false });
    expect(document.getElementById('test-drawer')).toBeInTheDocument();
  });

  it('carries no dialog role, and renders no scrim (the scrim exists only while the drawer is a dialog)', () => {
    renderDrawer({ open: false });
    const aside = document.getElementById('test-drawer')!;
    expect(aside).not.toHaveAttribute('role');
    expect(aside).not.toHaveAttribute('aria-modal');
    expect(screen.queryByTestId('test-drawer-scrim')).not.toBeInTheDocument();
  });

  it('its accessible name survives — aria-labelledby is unconditional', () => {
    renderDrawer({ open: false });
    expect(document.getElementById('test-drawer')).toHaveAttribute('aria-labelledby', 'test-drawer-heading');
  });
});

describe('Drawer — open=true (the desktop dialog)', () => {
  it('carries dialog semantics', () => {
    renderDrawer({ open: true });
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');
  });

  it('is not hidden and not inert', () => {
    renderDrawer({ open: true });
    const aside = document.getElementById('test-drawer')!;
    expect(aside).not.toHaveAttribute('aria-hidden');
    expect(aside).not.toHaveAttribute('inert');
  });

  it('renders the scrim, and clicking it calls onClose', () => {
    const { onClose } = renderDrawer({ open: true });
    const scrim = screen.getByTestId('test-drawer-scrim');
    scrim.click();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
