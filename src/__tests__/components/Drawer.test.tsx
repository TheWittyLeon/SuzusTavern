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

// ── A9d-2 gate 7 (Iro A9d-1 IMPORTANT-3): the WebKit shape ────────────────────────────────────────
import { act, fireEvent } from '@testing-library/react';
import { useEffect, useState } from 'react';

/** A page with a toggle that opens the drawer from a CLICK. jsdom, like WebKit, does not focus a button on click. */
function Page({ withNotes = true }: { withNotes?: boolean }) {
  const [open, setOpen] = useState(false);
  const closeButtonRef = createRef<HTMLButtonElement>();
  // a PROGRAMMATIC open (no click opened it): a `page:open` window event, as the journal opens from a state change
  useEffect(() => {
    const h = () => setOpen(true);
    window.addEventListener('page:open', h);
    return () => window.removeEventListener('page:open', h);
  }, []);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Open it</button>
      <button type="button">Other control</button>
      <Drawer id="d" open={open} labelledBy="h" onClose={() => setOpen(false)} closeButtonRef={closeButtonRef}>
        <h2 id="h">Drawer</h2>
        <button type="button" ref={closeButtonRef} onClick={() => setOpen(false)}>Close</button>
        <button type="button" tabIndex={-1}>Roving, not a stop</button>
        {withNotes && <textarea aria-label="Notes" />}
      </Drawer>
    </>
  );
}

describe('Drawer restores focus to the control the OPENING CLICK landed on, when the browser did not focus it (WebKit)', () => {
  it('click (no focus) -> open -> Escape: the opener has focus again, not <body>', async () => {
    render(<Page />);
    const opener = screen.getByRole('button', { name: 'Open it' });
    expect(document.activeElement).toBe(document.body);
    fireEvent.click(opener); // a WebKit click: the button is NOT focused
    expect(document.activeElement).toBe(document.body);
    await screen.findByRole('dialog');
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(opener).toHaveFocus();
  });

  it('a button inside a child of the opener (an icon span) resolves to the button', async () => {
    render(<Page />);
    const opener = screen.getByRole('button', { name: 'Open it' });
    const icon = document.createElement('span');
    opener.appendChild(icon);
    fireEvent.click(icon);
    await screen.findByRole('dialog');
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(opener).toHaveFocus();
  });

  it('a focused opener still wins (Chromium, keyboard): focus restores to it', async () => {
    render(<Page />);
    const opener = screen.getByRole('button', { name: 'Open it' });
    opener.focus();
    fireEvent.click(opener);
    await screen.findByRole('dialog');
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(opener).toHaveFocus();
  });

  it('control: no click and nothing focused (a drawer opened by state alone) restores nowhere and does not throw', () => {
    expect(() => {
      const { rerender } = renderDrawer({ open: false });
      rerender(
        <Drawer id="test-drawer" open labelledBy="x" onClose={() => {}} closeButtonRef={createRef<HTMLButtonElement>()}>
          <button type="button">c</button>
        </Drawer>,
      );
    }).not.toThrow();
  });
});

describe('Drawer: the trap owns EVERY Tab and Shift+Tab (Safari skips buttons in the Tab order)', () => {
  const open = async () => {
    render(<Page />);
    fireEvent.click(screen.getByRole('button', { name: 'Open it' }));
    await screen.findByRole('dialog');
    return { close: screen.getByRole('button', { name: 'Close' }), notes: screen.getByLabelText('Notes') };
  };

  it('Shift+Tab from the LAST field (the notes textarea) goes to the previous stop and never leaves the dialog, default prevented', async () => {
    const { close, notes } = await open();
    notes.focus();
    const ok = fireEvent.keyDown(notes, { key: 'Tab', shiftKey: true });
    expect(ok).toBe(false); // preventDefault: the browser never gets to move focus out
    expect(close).toHaveFocus(); // the roving tabindex=-1 button is not a stop
  });

  it('Shift+Tab from the first stop wraps to the last; Tab from the last wraps to the first; Tab steps one', async () => {
    const { close, notes } = await open();
    close.focus();
    fireEvent.keyDown(close, { key: 'Tab', shiftKey: true });
    expect(notes).toHaveFocus();
    fireEvent.keyDown(notes, { key: 'Tab' });
    expect(close).toHaveFocus();
    fireEvent.keyDown(close, { key: 'Tab' });
    expect(notes).toHaveFocus();
  });

  it('every Tab is consumed, including one made with focus on the dialog itself (not a stop): Tab -> first, Shift+Tab -> last', async () => {
    const { close, notes } = await open();
    const dialog = screen.getByRole('dialog');
    dialog.focus();
    expect(fireEvent.keyDown(dialog, { key: 'Tab' })).toBe(false);
    expect(close).toHaveFocus();
    dialog.focus();
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(notes).toHaveFocus();
  });

  it('a drawer with a single stop keeps focus on it', async () => {
    render(<Page withNotes={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open it' }));
    await screen.findByRole('dialog');
    const close = screen.getByRole('button', { name: 'Close' });
    close.focus();
    fireEvent.keyDown(close, { key: 'Tab' });
    expect(close).toHaveFocus();
    fireEvent.keyDown(close, { key: 'Tab', shiftKey: true });
    expect(close).toHaveFocus();
  });
});

describe('Drawer: an opener is the click that OPENED it (A9d-2 N10; Tora MINOR-5, Kage S5)', () => {
  afterEach(() => jest.restoreAllMocks());

  const openByState = () => act(() => { window.dispatchEvent(new Event('page:open')); });

  it('a click older than a second opened nothing: a programmatic open after it restores focus to NOTHING, not to the old target', async () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
    render(<Page />);
    fireEvent.click(screen.getByRole('button', { name: 'Other control' })); // an earlier click, unrelated
    now.mockReturnValue(1_000_000 + 5_000);
    openByState(); // nothing focused (WebKit, or a programmatic open)
    await screen.findByRole('dialog');
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.getByRole('button', { name: 'Other control' })).not.toHaveFocus(); // (jsdom has no inert: focus stays on the hidden Close, which a browser blurs)
  });

  it('control: the same click a few milliseconds before the open IS the opener', async () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
    render(<Page />);
    fireEvent.click(screen.getByRole('button', { name: 'Other control' }));
    now.mockReturnValue(1_000_000 + 20);
    openByState();
    await screen.findByRole('dialog');
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.getByRole('button', { name: 'Other control' })).toHaveFocus();
  });

  it('a click inside a tabindex="-1" container (the scene head, main) records nothing: it is not a control the user pressed', async () => {
    render(
      <>
        <div tabIndex={-1} data-testid="head"><p>Scene: the Hollow</p></div>
        <Page />
      </>,
    );
    fireEvent.click(screen.getByText('Scene: the Hollow'));
    openByState(); // a moment later, by state: the container must not be what focus returns to
    await screen.findByRole('dialog');
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.getByTestId('head')).not.toHaveFocus();
  });

  it('restoring focus asks for preventScroll: the opener can be in a scroller or off screen', async () => {
    render(<Page />);
    const opener = screen.getByRole('button', { name: 'Open it' });
    opener.focus();
    const focus = jest.spyOn(opener, 'focus');
    fireEvent.click(opener);
    await screen.findByRole('dialog');
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  });
});

describe('Drawer: a Tab stop that refuses focus does not wedge the trap (Kage S5)', () => {
  it('Tab skips a stop whose focus() does nothing and lands on the next; Shift+Tab does the same the other way', async () => {
    render(<Page />);
    fireEvent.click(screen.getByRole('button', { name: 'Open it' }));
    await screen.findByRole('dialog');
    const close = screen.getByRole('button', { name: 'Close' });
    const notes = screen.getByLabelText('Notes');
    // a stop between them that will not take focus
    const stuck = document.createElement('button');
    stuck.textContent = 'Stuck';
    stuck.focus = () => {};
    close.after(stuck);
    close.focus();
    fireEvent.keyDown(close, { key: 'Tab' });
    expect(notes).toHaveFocus(); // not stuck on Close, forever
    notes.focus();
    fireEvent.keyDown(notes, { key: 'Tab', shiftKey: true });
    expect(close).toHaveFocus();
  });

  it('when NO stop takes focus the dialog itself does, and nothing throws', async () => {
    render(<Page withNotes={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open it' }));
    await screen.findByRole('dialog');
    const close = screen.getByRole('button', { name: 'Close' });
    const dialog = screen.getByRole('dialog');
    close.focus = () => {};
    dialog.focus();
    expect(() => fireEvent.keyDown(dialog, { key: 'Tab' })).not.toThrow();
    expect(dialog).toHaveFocus();
  });
});
