/**
 * A9d-2 fix round N3 (Sora lever brief 2.2; Tora C1-C3, Iro 4) — `useAnchoredPopover` / `AnchoredPopover`, the contract line by line.
 * jsdom has no layout, so rects are stubbed; the browser harness (popover-* legs) is the real-input pin.
 */
import { useRef, useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import AnchoredPopover from '@/components/AnchoredPopover';
import { computePlacement, revealDelta, useAnchoredPopover } from '@/lib/a11y/useAnchoredPopover';

const R = (o: Partial<DOMRect>) => ({ x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, toJSON() {}, ...o }) as DOMRect;
const rectOf = (el: Element, rect: Partial<DOMRect>) => { el.getBoundingClientRect = () => R(rect); };

function setViewport(w: number, h: number) {
  Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, value: w });
  Object.defineProperty(document.documentElement, 'clientHeight', { configurable: true, value: h });
}
afterEach(() => {
  delete (document.documentElement as unknown as Record<string, unknown>).clientWidth;
  delete (document.documentElement as unknown as Record<string, unknown>).clientHeight;
  delete (window as unknown as Record<string, unknown>).visualViewport;
});

const view = { left: 0, top: 0, width: 400, height: 800 };
const opener = (top: number, left = 20, w = 96, h = 44) => ({ left, right: left + w, top, bottom: top + h });

describe('computePlacement (pure)', () => {
  it('opens ABOVE the opener when the content fits there, in the Attack menu\'s own coordinates (bottom from the layout viewport, left = the opener\'s)', () => {
    const p = computePlacement(opener(700), { width: 200, height: 300 }, view, [], 'auto', 800);
    expect(p).toMatchObject({ side: 'top', left: 20, bottom: 106, maxHeight: 688 }); // 800 - 700 + 6; 700 - 6 - 6
    expect(p.top).toBeUndefined();
  });

  it('opens BELOW when there is no room above and more below, and the height is capped to what is left', () => {
    const p = computePlacement(opener(10), { width: 200, height: 600 }, view, [], 'auto', 800);
    expect(p).toMatchObject({ side: 'bottom', top: 60, maxHeight: 800 - 6 - 60 });
    expect(p.bottom).toBeUndefined();
  });

  it('opens on the side with MORE room when neither fits', () => {
    expect(computePlacement(opener(300), { width: 200, height: 900 }, view, [], 'auto', 800).side).toBe('bottom'); // below 456, above 288
    expect(computePlacement(opener(500), { width: 200, height: 900 }, view, [], 'auto', 800).side).toBe('top'); // above 488, below 244
  });

  it('honours a forced side', () => {
    expect(computePlacement(opener(700), { width: 200, height: 50 }, view, [], 'bottom', 800).side).toBe('bottom');
    expect(computePlacement(opener(10), { width: 200, height: 50 }, view, [], 'top', 800).side).toBe('top');
  });

  it('clamps into the VISUAL viewport: right against the edge, left of it, and inside an offset visual viewport', () => {
    expect(computePlacement(opener(700, 380), { width: 220, height: 100 }, view, [], 'auto', 800).left).toBe(174); // 400 - 220 - 6
    expect(computePlacement(opener(700, -50), { width: 220, height: 100 }, view, [], 'auto', 800).left).toBe(6);
    const pinched = { left: 100, top: 200, width: 200, height: 400 };
    expect(computePlacement(opener(500, 90), { width: 160, height: 100 }, pinched, [], 'auto', 800).left).toBe(106); // clamped to view.left + 6
    expect(computePlacement(opener(500, 290), { width: 160, height: 100 }, pinched, [], 'auto', 800).left).toBe(134); // 100 + 200 - 160 - 6
    // the room above is bounded by the visual viewport's top, not the layout viewport's
    expect(computePlacement(opener(260), { width: 160, height: 900 }, pinched, [], 'top', 800).maxHeight).toBe(260 - 6 - 206);
  });

  it('never covers a passthrough element (the X-card): the room BELOW stops above it; the room ABOVE stops below it; a zone off to the side is ignored', () => {
    const xcard = { left: 300, right: 372, top: 740, bottom: 784 };
    // opener near the top opening down: the card is the floor
    const down = computePlacement(opener(100, 280), { width: 200, height: 900 }, view, [xcard], 'bottom', 800);
    expect(down.maxHeight).toBe(740 - 6 - (144 + 6));
    // the same popover over to the left of it (no horizontal overlap): the screen edge is the floor
    const clear = computePlacement(opener(100, 10), { width: 200, height: 900 }, view, [xcard], 'bottom', 800);
    expect(clear.maxHeight).toBe(800 - 6 - 150);
    // a zone ABOVE the opener bounds a popover opening up
    const header = { left: 0, right: 400, top: 0, bottom: 60 };
    expect(computePlacement(opener(500), { width: 200, height: 900 }, view, [header], 'top', 800).maxHeight).toBe(500 - 6 - 66);
  });
});

describe('computePlacement: a passthrough zone BESIDE the opener (A9d-2 N8: the Cast button and the X-card block share a row)', () => {
  // the opener (Cast) at 12..108 x, 758..802 y; the X-card block beside it at 124..378 x, 755..805 y, overlapping the popover's x range
  const cast = { left: 12, right: 108, top: 758, bottom: 802 };
  const block = { left: 124, right: 378, top: 755, bottom: 805 };
  const wide = { width: 252, height: 300 };

  it('opening ABOVE, the popover\'s bottom edge clears the zone\'s TOP, not the opener\'s: it never covers the X-card block', () => {
    const p = computePlacement(cast, wide, view, [block], 'auto', 800);
    expect(p.side).toBe('top');
    // bottom = viewport height - (the zone's top, 755) + 6 gap, where the opener-only rule gave 800 - 758 + 6
    expect(p.bottom).toBe(800 - 755 + 6);
    expect(800 - (p.bottom as number)).toBeLessThanOrEqual(block.top - 6);
  });

  it('control: with no zone the popover stands on the OPENER\'s top (the old edge), so the zone is what moved it', () => {
    expect(computePlacement(cast, wide, view, [], 'auto', 800).bottom).toBe(800 - 758 + 6);
  });

  it('opening BELOW, its top edge clears the zone\'s BOTTOM', () => {
    const p = computePlacement({ left: 12, right: 108, top: 20, bottom: 64 }, wide, view, [{ left: 124, right: 378, top: 18, bottom: 70 }], 'bottom', 800);
    expect(p.top).toBe(70 + 6);
  });

  it('a zone beside the opener whose x range the popover does not reach is ignored', () => {
    const narrow = { width: 100, height: 300 };
    expect(computePlacement(cast, narrow, view, [{ left: 200, right: 378, top: 755, bottom: 805 }], 'auto', 800).bottom).toBe(800 - 758 + 6);
  });
});

describe('computePlacement: a cap on the popover\'s height (the Session card must not run over the composer and the verbs)', () => {
  it('maxHeight is the room, or the cap when the cap is smaller; the side is chosen for the height it will be', () => {
    const below = computePlacement(opener(100), { width: 200, height: 900 }, view, [], 'auto', 800, 360);
    expect(below.side).toBe('bottom');
    expect(below.maxHeight).toBe(360);
    // uncapped, the same popover takes all the room under the opener
    expect(computePlacement(opener(100), { width: 200, height: 900 }, view, [], 'auto', 800).maxHeight).toBe(800 - 6 - 150);
    // a 900px popover capped to 120px fits above an opener with 200px of room above: it opens ABOVE (uncapped it would not fit there)
    expect(computePlacement(opener(220), { width: 200, height: 900 }, view, [], 'auto', 800, 120).side).toBe('top');
  });

  it('a cap larger than the room changes nothing', () => {
    expect(computePlacement(opener(700), { width: 200, height: 900 }, view, [], 'auto', 800, 5000).maxHeight).toBe(700 - 6 - 6);
  });
});

// ── the hook through a real component ───────────────────────────────────────────────────────────────────────────────────────────
const log = { verb: jest.fn(), xcard: jest.fn(), parentKey: jest.fn() };

function Harness({ side, keepMounted = false, role = 'dialog' as 'dialog' | 'group' }: { side?: 'auto' | 'top' | 'bottom'; keepMounted?: boolean; role?: 'dialog' | 'group' }) {
  const [open, setOpen] = useState(false);
  const [showOpener, setShowOpener] = useState(true);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const pop = useAnchoredPopover({
    open,
    onClose: () => setOpen(false),
    anchorRef,
    openerRef,
    role,
    initialFocus: '#second',
    fallbackFocus: () => headRef.current,
    keepMounted,
    side,
  });
  return (
    <div onKeyDown={log.parentKey}>
      <div ref={headRef} tabIndex={-1}>head</div>
      {showOpener && (
        <button ref={anchorRef} type="button" {...pop.anchorProps} onClick={(e) => { pop.recordOpener(e); setOpen((o) => !o); }}>
          Open A
        </button>
      )}
      <button type="button" {...pop.anchorProps} onClick={(e) => { pop.recordOpener(e); setOpen(true); }}>Open B</button>
      <button type="button" onClick={log.verb}>Verb</button>
      <div data-popover-passthrough><button type="button" onClick={log.xcard}>X-card</button></div>
      <AnchoredPopover pop={pop} role={role} label="Test popover" keepMounted={keepMounted}>
        <button type="button" id="first">One</button>
        <button type="button" id="second">Two</button>
        <button type="button" id="third">Three</button>
        <button type="button" onClick={() => { setShowOpener(false); setOpen(false); }}>Finish</button>
      </AnchoredPopover>
    </div>
  );
}

function setup(props: Parameters<typeof Harness>[0] = {}) {
  setViewport(400, 800);
  const utils = render(<Harness {...props} />);
  rectOf(screen.getByRole('button', { name: 'Open A' }), { top: 700, bottom: 744, left: 20, right: 116, width: 96, height: 44 });
  rectOf(screen.getByRole('button', { name: 'Open B' }), { top: 700, bottom: 744, left: 150, right: 246, width: 96, height: 44 });
  rectOf(screen.getByRole('button', { name: 'X-card' }).parentElement as Element, { top: 750, bottom: 794, left: 300, right: 372, width: 72, height: 44 });
  return utils;
}
const openA = () => fireEvent.click(screen.getByRole('button', { name: 'Open A' }));
const dialog = () => screen.getByRole('dialog', { name: 'Test popover' });
const closed = () => expect(screen.queryByRole('dialog', { name: 'Test popover' })).toBeNull();

beforeEach(() => { jest.clearAllMocks(); });

describe('placement', () => {
  it('is placed before paint from the opener\'s rect, fixed, above it, and the opener says aria-expanded / haspopup / controls', () => {
    setup();
    const a = screen.getByRole('button', { name: 'Open A' });
    expect(a).toHaveAttribute('aria-expanded', 'false');
    expect(a).not.toHaveAttribute('aria-controls');
    openA();
    expect(dialog().style.position).toBe('fixed');
    expect(dialog().style.bottom).toBe('106px');
    expect(dialog().style.left).toBe('20px');
    expect(dialog()).toHaveAttribute('data-placement', 'top');
    expect(a).toHaveAttribute('aria-expanded', 'true');
    expect(a).toHaveAttribute('aria-haspopup', 'dialog');
    expect(a).toHaveAttribute('aria-controls', dialog().id);
  });

  it('is portalled to <body> (outside any clipping slot) and is never aria-modal; nothing else is made inert or hidden', () => {
    const { container } = setup();
    openA();
    expect(dialog().parentElement).toBe(document.body);
    expect(container.contains(dialog())).toBe(false);
    expect(dialog()).not.toHaveAttribute('aria-modal');
    expect(container.querySelector('[inert], [aria-hidden="true"]')).toBeNull();
  });

  it('re-places on window resize and scroll AND on the visual viewport\'s resize and scroll (iOS fires no window resize when the keyboard retracts)', () => {
    const vv = new EventTarget() as unknown as VisualViewport;
    Object.assign(vv, { offsetLeft: 0, offsetTop: 0, width: 400, height: 800 });
    const add = jest.spyOn(vv, 'addEventListener');
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: vv });
    setup();
    openA();
    expect(add.mock.calls.map((c) => c[0]).sort()).toEqual(['resize', 'scroll']);
    expect(dialog().style.bottom).toBe('106px');
    // the keyboard retracts: the opener moves, only the visual viewport says so
    rectOf(screen.getByRole('button', { name: 'Open A' }), { top: 500, bottom: 544, left: 20, right: 116, width: 96, height: 44 });
    act(() => { vv.dispatchEvent(new Event('resize')); });
    expect(dialog().style.bottom).toBe('306px');
    rectOf(screen.getByRole('button', { name: 'Open A' }), { top: 400, bottom: 444, left: 20, right: 116, width: 96, height: 44 });
    act(() => { vv.dispatchEvent(new Event('scroll')); });
    expect(dialog().style.bottom).toBe('406px');
    rectOf(screen.getByRole('button', { name: 'Open A' }), { top: 300, bottom: 344, left: 20, right: 116, width: 96, height: 44 });
    act(() => { window.dispatchEvent(new Event('resize')); });
    expect(dialog().style.bottom).toBe('506px');
  });

  it('keeps clear of a passthrough element: opening below, the height stops above the X-card', () => {
    setup({ side: 'bottom' });
    rectOf(screen.getByRole('button', { name: 'Open A' }), { top: 100, bottom: 144, left: 310, right: 376, width: 66, height: 44 });
    openA();
    expect(dialog().style.top).toBe('150px');
    expect(dialog().style.maxHeight).toBe(`${750 - 6 - 150}px`);
  });
});

describe('dismissal (Tora C1)', () => {
  it('an outside press closes on CLICK; pointerdown, mousedown and touchstart do not', () => {
    setup();
    openA();
    const verb = screen.getByRole('button', { name: 'Verb' });
    fireEvent.pointerDown(verb);
    fireEvent.mouseDown(verb);
    fireEvent.touchStart(verb);
    expect(dialog()).toBeInTheDocument();
    fireEvent.click(verb);
    closed();
  });

  it('the dismissing click is CONSUMED: the verb under it never activates, and the click is default-prevented', () => {
    setup();
    openA();
    const notPrevented = fireEvent.click(screen.getByRole('button', { name: 'Verb' }));
    expect(log.verb).not.toHaveBeenCalled();
    expect(notPrevented).toBe(false);
    closed();
  });

  it('a press inside a passthrough element (the X-card) closes it and is DELIVERED: it fires on the first tap', () => {
    setup();
    openA();
    fireEvent.click(screen.getByRole('button', { name: 'X-card' }));
    expect(log.xcard).toHaveBeenCalledTimes(1);
    closed();
  });

  it('a click on the opener itself is the consumer\'s toggle, not an outside press (it closes, once, and is not swallowed)', () => {
    setup();
    openA();
    openA();
    closed();
  });

  it('the opener\'s own handler RUNS on a click while open (not consumed as an outside press): opened from B, a click on A records A, and focus returns to A', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Open B' }));
    expect(dialog()).toBeInTheDocument();
    openA(); // A's onClick: recordOpener(A) then toggle (closes)
    closed();
    expect(screen.getByRole('button', { name: 'Open A' })).toHaveFocus();
  });

  it('a click inside the popover does not close it', () => {
    setup();
    openA();
    fireEvent.click(screen.getByRole('button', { name: 'One' }));
    expect(dialog()).toBeInTheDocument();
  });

  it('with the popover CLOSED the document listener is gone: a click on a verb reaches it', () => {
    setup();
    openA();
    openA();
    fireEvent.click(screen.getByRole('button', { name: 'Verb' }));
    expect(log.verb).toHaveBeenCalledTimes(1);
  });
});

describe('focus (Iro 4, Tora C3)', () => {
  it('on open focus moves to the consumer\'s declared target', () => {
    setup();
    openA();
    expect(document.getElementById('second')).toHaveFocus();
  });

  it('Escape closes it, is consumed (the page never sees it) and returns focus to the opener', () => {
    setup();
    openA();
    fireEvent.keyDown(document.activeElement as Element, { key: 'Escape' });
    closed();
    expect(screen.getByRole('button', { name: 'Open A' })).toHaveFocus();
    expect(log.parentKey).not.toHaveBeenCalled();
  });

  it('Tab past the LAST control closes it and returns focus to the opener (default prevented: it neither traps nor strands)', () => {
    setup();
    openA();
    const finish = screen.getByRole('button', { name: 'Finish' });
    act(() => finish.focus());
    const notPrevented = fireEvent.keyDown(finish, { key: 'Tab' });
    expect(notPrevented).toBe(false);
    closed();
    expect(screen.getByRole('button', { name: 'Open A' })).toHaveFocus();
  });

  it('Shift+Tab past the FIRST control does the same; Tab or Shift+Tab inside the popover leaves it open and untouched', () => {
    setup();
    openA();
    const first = document.getElementById('first') as HTMLElement;
    act(() => first.focus());
    expect(fireEvent.keyDown(first, { key: 'Tab' })).toBe(true); // forward from the first: not past an end
    expect(dialog()).toBeInTheDocument();
    const second = document.getElementById('second') as HTMLElement;
    act(() => second.focus());
    expect(fireEvent.keyDown(second, { key: 'Tab', shiftKey: true })).toBe(true);
    act(() => first.focus());
    expect(dialog()).toBeInTheDocument();
    expect(fireEvent.keyDown(first, { key: 'Tab', shiftKey: true })).toBe(false);
    closed();
    expect(screen.getByRole('button', { name: 'Open A' })).toHaveFocus();
  });

  it('the opener comes from the ACTIVATING EVENT: opened from B (never focused: a tapped button is not focused in WebKit), focus returns to B, not to A', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Open B' })); // fireEvent.click does not focus, like a tap in Safari
    expect(document.activeElement).not.toBe(screen.getByRole('button', { name: 'Open B' }));
    fireEvent.keyDown(document.activeElement as Element, { key: 'Escape' });
    expect(screen.getByRole('button', { name: 'Open B' })).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Open A' })).not.toHaveFocus();
  });

  it('when the opener is GONE (the fight ended and End combat unmounted) focus lands on the fallback (the scene head), never <body>', () => {
    setup();
    openA();
    fireEvent.click(screen.getByRole('button', { name: 'Finish' }));
    closed();
    expect(screen.queryByRole('button', { name: 'Open A' })).toBeNull();
    expect(screen.getByText('head')).toHaveFocus();
    expect(document.body).not.toHaveFocus();
  });

  it('focus the user already moved on to (the X-card took the press) is left where it is', () => {
    setup();
    openA();
    const x = screen.getByRole('button', { name: 'X-card' });
    act(() => x.focus());
    fireEvent.click(x);
    closed();
    expect(x).toHaveFocus();
  });
});

describe('keepMounted', () => {
  it('closed, the popover stays in the tree with a CSS class that hides it (so a test sees its content, a browser does not); aria-controls is valid while closed', () => {
    setup({ keepMounted: true });
    const a = screen.getByRole('button', { name: 'Open A' });
    const pop = document.querySelector('[data-anchored-popover]') as HTMLElement;
    expect(pop).toBeInTheDocument();
    expect(pop.className).toMatch(/closed/);
    expect(a).toHaveAttribute('aria-controls', pop.id);
    openA();
    expect(pop.className).not.toMatch(/closed/);
  });

  it('a `group` popover (the outcome chooser) keeps its named group role and still says aria-haspopup=dialog', () => {
    setup({ role: 'group' });
    openA();
    expect(screen.getByRole('group', { name: 'Test popover' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open A' })).toHaveAttribute('aria-haspopup', 'dialog');
  });
});

// ── A9d-2 fix round 2: the focused control is inside the popover's own box (Iro MAJOR-1), and focus that leaves closes it (Iro Minor-1) ─────

describe('revealDelta (pure)', () => {
  const box = { top: 100, bottom: 194 }; // the Roll popover at 320x256: 94px
  it('is zero when the target is inside the box', () => {
    expect(revealDelta(box, { top: 110, bottom: 160 })).toBe(0);
    expect(revealDelta(box, { top: 100, bottom: 194 })).toBe(0);
  });
  it('scrolls DOWN by the overshoot when the target is below the box (the first die at y 281..339 in a box ending at 194)', () => {
    expect(revealDelta(box, { top: 281, bottom: 339 })).toBe(145);
  });
  it('scrolls UP by the undershoot when it is above', () => {
    expect(revealDelta(box, { top: 60, bottom: 110 })).toBe(-40);
  });
  it('a target taller than the box is aligned at its top, not its bottom', () => {
    expect(revealDelta(box, { top: 150, bottom: 400 })).toBe(50);
  });
});

describe('focus on open is brought inside the popover\'s own box', () => {
  let rectSpy: jest.SpyInstance;
  beforeEach(() => { rectSpy = jest.spyOn(Element.prototype, 'getBoundingClientRect'); });
  afterEach(() => rectSpy.mockRestore());

  it('a first control below a clamped popover\'s edge scrolls the BOX to it (the page is not touched)', () => {
    setup();
    const pageScroll = jest.spyOn(window, 'scrollTo');
    const intoView = jest.fn();
    Element.prototype.scrollIntoView = intoView;
    const base = rectSpy.getMockImplementation() ?? Element.prototype.getBoundingClientRect;
    rectSpy.mockImplementation(function (this: Element) {
      if (this.hasAttribute('data-anchored-popover')) return R({ top: 100, bottom: 194, left: 0, right: 220, width: 220, height: 94 });
      if (this.id === 'second') return R({ top: 281, bottom: 339, left: 0, right: 100, width: 100, height: 58 });
      return base.call(this);
    });
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get() { return this.hasAttribute('data-anchored-popover') ? 94 : 0; } });
    try {
      openA();
      expect(document.getElementById('second')).toHaveFocus();
      expect((document.querySelector('[data-anchored-popover]') as HTMLElement).scrollTop).toBe(145);
      expect(pageScroll).not.toHaveBeenCalled();
      expect(intoView).not.toHaveBeenCalled();
    } finally {
      delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientHeight;
      delete (Element.prototype as unknown as Record<string, unknown>).scrollIntoView;
    }
  });
});

describe('the reveal runs again when the placement has settled (two frames later)', () => {
  let rectSpy: jest.SpyInstance;
  beforeEach(() => { rectSpy = jest.spyOn(Element.prototype, 'getBoundingClientRect'); });
  afterEach(() => { rectSpy.mockRestore(); jest.useRealTimers(); delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientHeight; });

  it('the clamp is STATE, so the first pass sees the unclamped box (the die is inside it); after two frames the box is 94px and the die is out of it: the box scrolls then', () => {
    jest.useFakeTimers();
    setup();
    let clamped = false;
    const base = rectSpy.getMockImplementation() ?? Element.prototype.getBoundingClientRect;
    rectSpy.mockImplementation(function (this: Element) {
      if (this.hasAttribute('data-anchored-popover')) return R({ top: 100, bottom: clamped ? 194 : 500, left: 0, right: 220, width: 220, height: clamped ? 94 : 400 });
      if (this.id === 'second') return R({ top: 281, bottom: 339, left: 0, right: 100, width: 100, height: 58 });
      return base.call(this);
    });
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get() { return this.hasAttribute('data-anchored-popover') ? (clamped ? 94 : 400) : 0; } });
    openA();
    const pop = document.querySelector('[data-anchored-popover]') as HTMLElement;
    expect(pop.scrollTop).toBe(0); // first pass: inside the unclamped box
    clamped = true;
    act(() => { jest.advanceTimersByTime(40); });
    expect(pop.scrollTop).toBe(145);
  });
});

describe('focus leaving an open popover closes it, without moving focus (Safari\'s Tab skips buttons)', () => {
  it('focus moving by script to a control outside it closes it, and focus STAYS there', () => {
    setup();
    openA();
    const verb = screen.getByRole('button', { name: 'Verb' });
    act(() => verb.focus());
    closed();
    expect(verb).toHaveFocus();
  });

  it('focus inside it, on its opener, or on a passthrough element (the X-card) does not close it', () => {
    setup();
    openA();
    act(() => (document.getElementById('first') as HTMLElement).focus());
    expect(dialog()).toBeInTheDocument();
    act(() => screen.getByRole('button', { name: 'Open A' }).focus());
    expect(dialog()).toBeInTheDocument();
    act(() => screen.getByRole('button', { name: 'X-card' }).focus());
    expect(dialog()).toBeInTheDocument();
  });

  it('control: focus a POINTER put outside it does not close it by focus (the press\'s click does, and consumes it: Tora C1)', () => {
    setup();
    openA();
    const verb = screen.getByRole('button', { name: 'Verb' });
    fireEvent.pointerDown(verb);
    act(() => verb.focus());
    expect(dialog()).toBeInTheDocument();
    fireEvent.click(verb);
    closed();
    expect(log.verb).not.toHaveBeenCalled(); // consumed
  });

  it('a key press after a pointer press hands the decision back to focus: Tab out closes it', () => {
    setup();
    openA();
    const verb = screen.getByRole('button', { name: 'Verb' });
    fireEvent.pointerDown(document.getElementById('first') as HTMLElement); // a press INSIDE it, then the keyboard
    fireEvent.keyDown(document.getElementById('first') as HTMLElement, { key: 'a' });
    act(() => verb.focus());
    closed();
    expect(verb).toHaveFocus();
  });

  it('focus that leaves for NOTHING (WebKit\'s Tab out of the last stop lands on <body>: no focusin) closes it; a pointer press, or a window that lost focus, does not', () => {
    setup();
    openA();
    const first = document.getElementById('first') as HTMLElement;
    jest.spyOn(document, 'hasFocus').mockReturnValue(true);
    act(() => { first.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: null })); });
    expect(dialog()).toBeInTheDocument(); // no Tab before it: a control disabled or hidden while focused is blurred the same way (Cast in flight)
    fireEvent.keyDown(first, { key: 'Tab' });
    act(() => { first.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: null })); });
    closed();
    openA();
    fireEvent.keyDown(document.getElementById('first') as HTMLElement, { key: 'Tab' });
    jest.spyOn(document, 'hasFocus').mockReturnValue(false); // the window lost focus: not the user leaving the popover
    act(() => { (document.getElementById('first') as HTMLElement).dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: null })); });
    expect(dialog()).toBeInTheDocument();
    jest.spyOn(document, 'hasFocus').mockReturnValue(true);
    fireEvent.pointerDown(document.getElementById('first') as HTMLElement);
    act(() => { (document.getElementById('first') as HTMLElement).dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: null })); });
    expect(dialog()).toBeInTheDocument();
    jest.restoreAllMocks();
  });

  // A9d-2 fix round 4 (Kage I-A): every consumer passes an inline `onClose`, so ANY re-render (a combat poll's answer) re-ran the effects that
  // held the press and Tab flags as locals and reset them between a tap's pointerdown and the focus it causes. The browser pin is the harness's
  // popover-*-poll-tap legs (a real touch, the poll released inside it); these are the pure halves, a re-render with a NEW `onClose` between the two.
  it('a re-render between a tap\'s pointerdown and its focus keeps the press: the focus does not close it, and the click is consumed (Send never posts)', () => {
    const { rerender } = setup();
    openA();
    const verb = screen.getByRole('button', { name: 'Verb' });
    fireEvent.pointerDown(verb);
    rerender(<Harness />); // the poll's answer lands: a new inline onClose
    act(() => verb.focus());
    expect(dialog()).toBeInTheDocument();
    fireEvent.click(verb);
    closed();
    expect(log.verb).not.toHaveBeenCalled();
  });

  it('a re-render between a Tab key and the focus-out keeps the Tab flag: leaving for nothing still closes it', () => {
    const { rerender } = setup();
    openA();
    jest.spyOn(document, 'hasFocus').mockReturnValue(true);
    const first = document.getElementById('first') as HTMLElement;
    fireEvent.keyDown(first, { key: 'Tab' });
    rerender(<Harness />);
    act(() => { first.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: null })); });
    closed();
    jest.restoreAllMocks();
  });

  it('the flags are cleared when it opens: a press from the PREVIOUS open does not outlive it', () => {
    setup();
    openA();
    fireEvent.pointerDown(document.getElementById('first') as HTMLElement); // a press while open sets the flag
    fireEvent.keyDown(document.activeElement as Element, { key: 'Escape' });
    closed();
    openA();
    act(() => screen.getByRole('button', { name: 'Verb' }).focus()); // no press in THIS open: focus leaving is the user leaving
    closed();
  });

  // A9d-2 fix round 4 (Kage I-B): a modal layer that is open owns the press and the focus. The browser pin is the harness's popover-session-* legs.
  describe('an open modal layer (a dialog the popover\'s control opened, portalled out of it)', () => {
    const modal = (attrs: Record<string, string> = { 'aria-modal': 'true' }, parent: Element = document.body) => {
      const wrap = document.createElement('div'); // a backdrop
      const dlg = document.createElement('div');
      dlg.setAttribute('role', 'dialog');
      for (const [k, v] of Object.entries(attrs)) dlg.setAttribute(k, v);
      const btn = document.createElement('button');
      btn.textContent = 'Confirm';
      dlg.appendChild(btn);
      wrap.appendChild(dlg);
      parent.appendChild(wrap);
      return { wrap, btn };
    };
    it('a click inside it neither closes the popover nor is consumed; with it gone the same click is an outside press again', () => {
      setup();
      openA();
      const { wrap, btn } = modal();
      const delivered = fireEvent.click(btn);
      expect(delivered).toBe(true);
      expect(dialog()).toBeInTheDocument();
      // its backdrop is the modal layer's too: the dialog's own backdrop-cancel must run
      expect(fireEvent.click(wrap)).toBe(true);
      expect(dialog()).toBeInTheDocument();
      wrap.remove();
      expect(fireEvent.click(screen.getByRole('button', { name: 'Verb' }))).toBe(false); // consumed again
      closed();
    });

    it('focus moving into it is not "leaving": the popover stays open (the dialog focuses its Cancel); focus the user moves elsewhere after it closes is the rule again', () => {
      setup();
      openA();
      const { wrap, btn } = modal();
      act(() => btn.focus());
      expect(dialog()).toBeInTheDocument();
      wrap.remove();
      act(() => screen.getByRole('button', { name: 'Verb' }).focus());
      closed();
    });

    it('does NOT count: a modal inside the popover or around it, an inert or hidden one, or a closed layer that dropped the attribute', () => {
      setup();
      openA();
      const inert = modal({ 'aria-modal': 'true', inert: '' });
      expect(fireEvent.click(screen.getByRole('button', { name: 'Verb' }))).toBe(false); // an inert layer is not open: the press is consumed
      closed();
      inert.wrap.remove();
      openA();
      const hidden = modal({ 'aria-modal': 'true', hidden: '' });
      expect(fireEvent.click(screen.getByRole('button', { name: 'Verb' }))).toBe(false);
      closed();
      hidden.wrap.remove();
      openA();
      const dropped = modal({});
      expect(fireEvent.click(screen.getByRole('button', { name: 'Verb' }))).toBe(false);
      closed();
      dropped.wrap.remove();
      openA();
      const inside = modal({ 'aria-modal': 'true' }, dialog()); // inside the popover's own DOM (a nested layer is the popover's business)
      expect(fireEvent.click(screen.getByRole('button', { name: 'Verb' }))).toBe(false);
      closed();
      inside.wrap.remove();
    });
  });

  it('with it closed the listener is gone: focus anywhere is nobody\'s business', () => {
    setup();
    openA();
    fireEvent.keyDown(document.activeElement as Element, { key: 'Escape' });
    closed();
    const verb = screen.getByRole('button', { name: 'Verb' });
    act(() => verb.focus());
    expect(verb).toHaveFocus();
  });
});
