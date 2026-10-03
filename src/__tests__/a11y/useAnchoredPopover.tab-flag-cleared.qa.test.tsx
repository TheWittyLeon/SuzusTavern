/**
 * Miko-QA, A9d-2 round 5/6 review (2e73945): the TAB flag must be cleared when the popover OPENS.
 * eddd1a5 pinned the PRESS flag (the fake-timer test goes red without its reset), but deleting only `tabbedRef.current = false` at the top of the effect still survives
 * every popover suite at 2e73945. This test is red under that mutation and green at the tip.
 * Browser proof of the user-visible effect (Cast popover, keyboard re-open, the focused button disabled while a cast is in flight): the mutant closes the popover, the tip does not.
 */
import { useRef, useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import AnchoredPopover from '@/components/AnchoredPopover';
import { useAnchoredPopover } from '@/lib/a11y/useAnchoredPopover';

function Harness() {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const pop = useAnchoredPopover({ open, onClose: () => setOpen(false), anchorRef, openerRef, role: 'dialog', initialFocus: '#first' });
  return (
    <div>
      <button ref={anchorRef} type="button" {...pop.anchorProps} onClick={(e) => { pop.recordOpener(e); setOpen((o) => !o); }}>Open A</button>
      <button type="button">Verb</button>
      <AnchoredPopover pop={pop} role="dialog" label="Test popover">
        <button type="button" id="first">One</button>
      </AnchoredPopover>
    </div>
  );
}
const openA = () => fireEvent.click(screen.getByRole('button', { name: 'Open A' }));
const isOpen = () => screen.queryByRole('dialog', { name: 'Test popover' }) !== null;

describe('flags left by the previous open do not outlive it (mutation 2b)', () => {
  it('a Tab key in the first open does not make a later focus-out-to-nothing (a control disabled while focused) close the second open', () => {
    render(<Harness />);
    jest.spyOn(document, 'hasFocus').mockReturnValue(true);
    openA();
    fireEvent.keyDown(document.getElementById('first') as HTMLElement, { key: 'Tab' }); // Tab past the last control: the Tab flag is set and it closes
    expect(isOpen()).toBe(false);
    openA(); // re-opened by the opener's click: no key between, so nothing but the open itself can clear the flag
    expect(isOpen()).toBe(true);
    const first = document.getElementById('first') as HTMLElement;
    act(() => { first.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: null })); }); // what the browser sends when the focused control becomes disabled
    expect(isOpen()).toBe(true); // no Tab in THIS open: that is not the user leaving
    jest.restoreAllMocks();
  });
});
