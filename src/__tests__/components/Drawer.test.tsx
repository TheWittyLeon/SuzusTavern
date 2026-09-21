/**
 * Drawer — direct regression coverage for the primitive's own contract.
 * Before this file, Drawer had ZERO tests of its own; every property it
 * relies on was only incidentally exercised through PlayPage (Miko-QA
 * finding, 2026-09-21 review round: mutating A6's `aria-hidden` key off
 * `open` instead of `visible` caught 0 of 553 red; mutating `inert` to
 * always `false` left 2,223 green). This file pins each state directly.
 *
 * A6 (open/visible independence) and I1 (open implies presence, so
 * open=true/visible=false can no longer produce a hidden dialog) are two
 * halves of one contract: I1 makes the BAD state unrepresentable in the
 * render; this file pins the GOOD states, including the one A6 exists
 * for — visible=true, open=false, the Journal's mobile-tab presentation
 * (an in-flow pane, not a dialog) — which had no behavioural coverage at
 * all before this file, and is reachable via plain React state with no
 * viewport simulation needed (mobileView is not gated by matchMedia).
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
      visible={false}
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

describe('Drawer — A6: visible=true, open=false (mobile-tab pane, not a dialog)', () => {
  it('is NOT hidden from the accessibility tree', () => {
    renderDrawer({ open: false, visible: true });
    const aside = document.getElementById('test-drawer')!;
    expect(aside).not.toHaveAttribute('aria-hidden');
  });

  it('is not inert', () => {
    renderDrawer({ open: false, visible: true });
    const aside = document.getElementById('test-drawer')!;
    expect(aside).not.toHaveAttribute('inert');
  });

  it('carries no dialog role — it is a plain pane', () => {
    renderDrawer({ open: false, visible: true });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    const aside = document.getElementById('test-drawer')!;
    expect(aside).not.toHaveAttribute('role');
    expect(aside).not.toHaveAttribute('aria-modal');
  });

  it('its accessible name survives — aria-labelledby is unconditional', () => {
    renderDrawer({ open: false, visible: true });
    const aside = document.getElementById('test-drawer')!;
    expect(aside).toHaveAttribute('aria-labelledby', 'test-drawer-heading');
  });

  it('the scrim DOES mount (isVisible alone gates it, matching the original journalScrim/memberSheetScrim behaviour) — for a mobileTabFallback drawer its visual presence is gated by CSS below the breakpoint instead, which jsdom cannot see', () => {
    renderDrawer({ open: false, visible: true });
    expect(screen.getByTestId('test-drawer-scrim')).toBeInTheDocument();
  });
});

describe('Drawer — fully closed (open=false, visible=false)', () => {
  it('is hidden from the accessibility tree and inert', () => {
    renderDrawer({ open: false, visible: false });
    const aside = document.getElementById('test-drawer')!;
    expect(aside).toHaveAttribute('aria-hidden', 'true');
    expect(aside).toHaveAttribute('inert');
  });

  it('stays mounted (A5) — content is in the DOM, just inaccessible', () => {
    renderDrawer({ open: false, visible: false });
    expect(document.getElementById('test-drawer')).toBeInTheDocument();
  });
});

describe('Drawer — open=true, visible=true (the desktop dialog)', () => {
  it('carries dialog semantics', () => {
    renderDrawer({ open: true, visible: true });
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');
  });

  it('is not hidden and not inert', () => {
    renderDrawer({ open: true, visible: true });
    const aside = document.getElementById('test-drawer')!;
    expect(aside).not.toHaveAttribute('aria-hidden');
    expect(aside).not.toHaveAttribute('inert');
  });

  it('renders the scrim, and clicking it calls onClose', () => {
    const { onClose } = renderDrawer({ open: true, visible: true });
    const scrim = screen.getByTestId('test-drawer-scrim');
    scrim.click();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('Drawer — I1: open=true, visible=false (the state that must not produce a hidden dialog)', () => {
  // Kage-CR round-2 re-review (2026-09-21): this state deliberately triggers
  // a dev-only console.warn (see Drawer.tsx). Stub it in EVERY test in this
  // block, not just the one that asserts on it — two of the three used to
  // render this state with the real console.warn still wired up, printing
  // the warning into test output on every run.
  const originalWarn = console.warn;
  beforeEach(() => {
    console.warn = jest.fn();
  });
  afterEach(() => {
    console.warn = originalWarn;
  });

  it('is NOT hidden and NOT inert despite visible=false — open implies presence', () => {
    renderDrawer({ open: true, visible: false });
    const aside = document.getElementById('test-drawer')!;
    expect(aside).not.toHaveAttribute('aria-hidden');
    expect(aside).not.toHaveAttribute('inert');
  });

  it('still carries dialog role — the exact combination that used to strand focus inside an inert subtree is now just a visible dialog', () => {
    renderDrawer({ open: true, visible: false });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('warns in development so the inconsistent call site is visible', () => {
    renderDrawer({ open: true, visible: false });
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('open=true but visible=false'));
  });
});
