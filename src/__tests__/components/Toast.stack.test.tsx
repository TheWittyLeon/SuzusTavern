/**
 * A9d-2 round 6 (Kage round-5 points 1, 2 and the suggestions; Tora MINOR-B; Iro minor): the toast host's STACK and its CALM.
 *   - the safety block is its OWN first tier, ahead of the banner and the composer (the X-card rule is never exemptable);
 *   - with several cards the stack is capped BY FIT: the most that stand clear of the never-cover marks, never fewer than one; the rest are HELD (hidden, timers not
 *     started) and show as the earlier ones leave: not dropped;
 *   - it does not HOP: it keeps its place unless that place got worse (safety, never-cover, controls), not re-placing while the page scrolls (150 ms settle, but at
 *     once if it touched a never-cover mark), and at once when a card is added or removed;
 *   - a control scrolled out of its own scroller's box is not on screen;
 *   - a keyboard Dismiss does not leave focus on <body>.
 * The browser pins are the harness's toast-stack and toast-hops legs (red at eddd1a5: the stack on the X-card's centre with 4 cards at 320x256 and 6 at 844x390; 9 and 16
 * changes of place in one scroll). Geometry here is mocked from `data-box`; the host's box is computed from its placement and how many cards are shown.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ToastProvider, useToast } from '@/components/Toast';

type Box = [left: number, top: number, right: number, bottom: number];
const domRect = ([left, top, right, bottom]: Box) => ({ left, top, right, bottom, width: right - left, height: bottom - top, x: left, y: top, toJSON() {} }) as DOMRect;

function Fire({ n = 1 }: { n?: number }) {
  const { toast } = useToast();
  return <button onClick={() => { for (let i = 0; i < n; i++) toast({ message: `Toast ${i + 1}`, tone: 'error' }); }}>fire</button>;
}

const CARD_H = 80;

/** Marks come from a mutable list so a test can MOVE one (a scroll). */
function setup({ width = 390, height = 844, safety = [] as Box[], never = [] as Box[], controls = [] as Box[], clear = [] as Box[], cards = 1 } = {}) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: height });
  const shown = (host: HTMLElement) => [...host.querySelectorAll('[data-component="Toast"]')].filter((c) => !c.hasAttribute('hidden')).length;
  jest.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const el = this as HTMLElement;
    if (el.getAttribute('data-component') === 'ToastViewport') {
      const h = shown(el) * CARD_H;
      if (el.getAttribute('data-placement') === 'top') {
        const top = Number.parseFloat(el.style.getPropertyValue('--toast-top') || '0') + 8;
        return domRect([12, top, width - 12, top + h]);
      }
      return domRect([12, height - 24 - h, width - 12, height - 24]);
    }
    const m = el.dataset?.box;
    return domRect(m ? (m.split(',').map(Number) as Box) : [0, 0, 0, 0]);
  });
  jest.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return this.getAttribute('data-component') === 'ToastViewport' ? shown(this) * CARD_H : 0;
  });
  const view = render(
    <ToastProvider>
      <div id="marks">
        {safety.map((b, i) => <div key={`s${i}`} data-toast-avoid="safety" data-box={b.join(',')} />)}
        {never.map((b, i) => <div key={`n${i}`} data-toast-avoid="" data-box={b.join(',')} />)}
        {clear.map((b, i) => <div key={`c${i}`} data-toast-clear="" data-box={b.join(',')} />)}
        {controls.map((b, i) => <button key={`k${i}`} type="button" data-box={b.join(',')}>c{i}</button>)}
      </div>
      <Fire n={cards} />
    </ToastProvider>,
  );
  fireEvent.click(screen.getByText('fire'));
  const host = document.querySelector('[data-component="ToastViewport"]') as HTMLElement;
  const place = () => `${host.getAttribute('data-placement')}/${host.style.getPropertyValue('--toast-top')}`;
  const move = (selector: string, index: number, box: Box) => document.querySelectorAll(selector)[index].setAttribute('data-box', box.join(','));
  /** let the observers and the frame run */
  const flush = async (ms = 30) => { await act(async () => { await Promise.resolve(); }); act(() => { jest.advanceTimersByTime(ms); }); };
  return { view, host, place, shown: () => shown(host), held: () => host.querySelectorAll('[data-component="Toast"][hidden]').length, move, flush };
}

describe('Toast host: the stack is capped by fit', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => { act(() => { jest.runAllTimers(); }); jest.useRealTimers(); jest.restoreAllMocks(); });

  it('THE X-CARD IS ITS OWN FIRST TIER: a place on the X-card loses to one on the composer, whatever the areas (summed into one tier, the top edge\'s 11k px2 on a narrow X-card block would beat the composer\'s 29k)', () => {
    // the top edge (8..88) touches only the X-card block (138px wide); every other place touches the full-width composer block
    const { place } = setup({ height: 844, safety: [[0, 0, 150, 100]], never: [[0, 100, 390, 844]] });
    expect(place().startsWith('bottom')).toBe(true);
  });

  it('with one card nothing is held', () => {
    const { shown, held } = setup({ height: 300, cards: 1 });
    expect(shown()).toBe(1);
    expect(held()).toBe(0);
  });

  it('SEVERAL cards: the stack shows as many as stand clear of the safety block, the rest are HELD (hidden), and never fewer than one', () => {
    // 4 cards of 80px on a 300px screen; the X-card block is the bottom 100px: at the top edge 2 cards (8..168) clear it, 3 (8..248) do not
    const { shown, held, host } = setup({ height: 300, safety: [[0, 200, 390, 300]], cards: 4 });
    expect(shown()).toBe(2);
    expect(held()).toBe(2);
    const cards = [...host.querySelectorAll('[data-component="Toast"]')];
    expect(cards.map((c) => c.hasAttribute('hidden'))).toEqual([false, false, true, true]); // the OLDEST are shown: the rest wait their turn
  });

  it('never fewer than one: a screen where even one card touches the safety block still shows one', () => {
    const { shown, held } = setup({ height: 120, safety: [[0, 0, 390, 120]], cards: 3 });
    expect(shown()).toBe(1);
    expect(held()).toBe(2);
  });

  it('held cards are not dropped: when the shown ones leave, the held ones show (and only then do their timers run)', async () => {
    const { shown, held, flush } = setup({ height: 300, safety: [[0, 200, 390, 300]], cards: 4 });
    expect([shown(), held()]).toEqual([2, 2]);
    act(() => { jest.advanceTimersByTime(5000); }); // the two shown expire (5 s); the held two had no timer yet
    act(() => { jest.advanceTimersByTime(300); });
    await flush();
    expect(document.querySelectorAll('[data-component="Toast"]').length).toBe(2); // the held ones are still there, not dropped
    expect(shown()).toBe(2);
    expect(held()).toBe(0);
    act(() => { jest.advanceTimersByTime(4000); });
    expect(document.querySelectorAll('[data-component="Toast"]').length).toBe(2); // ...and now their own 5 s are running
    act(() => { jest.advanceTimersByTime(1500); });
    act(() => { jest.advanceTimersByTime(300); });
    expect(document.querySelectorAll('[data-component="Toast"]').length).toBe(0);
  });

  it('ESCAPE takes only the SHOWN cards: the held ones were never seen or announced and must now take their turn, not vanish (Kage N6-1)', async () => {
    const { shown, held, flush } = setup({ height: 300, safety: [[0, 200, 390, 300]], cards: 4 });
    expect([shown(), held()]).toEqual([2, 2]);
    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); jest.advanceTimersByTime(300); });
    await flush();
    expect(document.querySelectorAll('[data-component="Toast"]').length).toBe(2); // not 0
    expect(shown()).toBe(2); // the two held ones show now
    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); jest.advanceTimersByTime(300); });
    expect(document.querySelectorAll('[data-component="Toast"]').length).toBe(0);
  });

  it('THE CAP\'S NEVER-COVER HALF: a banner / composer block (not the X-card) caps the stack too', () => {
    const { shown, held } = setup({ height: 300, never: [[0, 200, 390, 300]], cards: 4 });
    expect([shown(), held()]).toEqual([2, 2]);
  });

  it('THE CAP\'S NEVER-COVER HALF, one card fewer: two cards touch the block but ONE clears it, so one is shown', () => {
    const { shown } = setup({ height: 300, never: [[0, 100, 390, 300]], cards: 3 });
    expect(shown()).toBe(1);
  });

  it('a card is given a max height: the larger free band around the safety block (never under 72px), so ONE card can always stand clear of it and a long message scrolls inside', () => {
    expect(setup({ height: 300, safety: [[0, 200, 390, 300]] }).host.style.getPropertyValue('--toast-card-max')).toBe('184px'); // above the block: 200 - 16
    jest.restoreAllMocks();
    document.body.innerHTML = '';
    expect(setup({ height: 256, safety: [[0, 20, 390, 240]] }).host.style.getPropertyValue('--toast-card-max')).toBe('72px'); // no band: the floor
  });
});

describe('Toast host: it does not hop', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => { act(() => { jest.runAllTimers(); }); jest.useRealTimers(); jest.restoreAllMocks(); });

  it('HYSTERESIS: a place that is merely not the best is kept (a clear mark appearing under it does not move it: only the clear tier would improve)', async () => {
    const { place, move, flush } = setup({ clear: [[0, 0, 390, 200], [0, 780, 390, 800]], never: [[0, 700, 390, 844]] });
    const first = place();
    expect(first).toBe('top/200px');
    move('[data-toast-clear]', 1, [0, 200, 390, 300]); // a clear mark now stands under the toast; "under it" (300) would cover none of them
    await flush();
    expect(place()).toBe(first);
  });

  it('...but a place that got WORSE is left: a control scrolls under it', async () => {
    const { place, move, flush } = setup({ clear: [[0, 0, 390, 200]], never: [[0, 700, 390, 844]], controls: [[0, 600, 390, 640]] });
    const first = place();
    move('button', 0, [0, 210, 390, 250]); // the control is now under the toast (208..288)
    await flush();
    expect(place()).not.toBe(first);
  });

  it('while the page SCROLLS it does not re-place (a control passing under it waits for the settle, 150 ms)', async () => {
    const { place, move, flush } = setup({ clear: [[0, 0, 390, 200]], never: [[0, 700, 390, 844]], controls: [[0, 600, 390, 640]] });
    const first = place();
    fireEvent.scroll(window);
    move('button', 0, [0, 210, 390, 250]);
    await flush(30);
    expect(place()).toBe(first); // mid-scroll: unchanged
    await flush(200);
    expect(place()).not.toBe(first); // settled: now it moves
  });

  it('...but at ONCE if its place has touched a never-cover mark mid-scroll (safety outranks calm)', async () => {
    const { place, move, flush } = setup({ clear: [[0, 0, 390, 200]], never: [[0, 700, 390, 844]] });
    const first = place();
    fireEvent.scroll(window);
    move('[data-toast-avoid]', 0, [0, 200, 390, 400]); // the composer scrolls under the toast
    await flush(30);
    expect(place()).not.toBe(first);
  });

  it('a card added or removed re-places AT ONCE, not after a settle', async () => {
    const { host, place, flush } = setup({ clear: [[0, 0, 390, 200]], never: [[0, 700, 390, 844]], cards: 1 });
    const first = place();
    fireEvent.scroll(window); // a scroll in progress
    fireEvent.click(screen.getByText('fire')); // a second card
    await flush(30);
    expect(host.querySelectorAll('[data-component="Toast"]').length).toBe(2);
    expect(place()).toBe(first); // same place is still right; the point is the search ran (the held/shown decision was taken) without waiting 150 ms
    expect(host.querySelectorAll('[data-component="Toast"][hidden]').length).toBe(0);
  });
});

describe('Toast host: a control clipped away by its own scroller is not on screen', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => { act(() => { jest.runAllTimers(); }); jest.useRealTimers(); jest.restoreAllMocks(); });

  function withScroller(box: Box, controlBox: Box) {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 844 });
    jest.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      const el = this as HTMLElement;
      if (el.getAttribute('data-component') === 'ToastViewport') {
        if (el.getAttribute('data-placement') === 'top') { const t = Number.parseFloat(el.style.getPropertyValue('--toast-top') || '0') + 8; return domRect([12, t, 378, t + 80]); }
        return domRect([12, 740, 378, 820]);
      }
      const m = el.dataset?.box;
      return domRect(m ? (m.split(',').map(Number) as Box) : [0, 0, 0, 0]);
    });
    jest.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) { return this.getAttribute('data-component') === 'ToastViewport' ? 80 : 0; });
    render(
      <ToastProvider>
        <div style={{ overflowY: 'auto' }} data-box={box.join(',')}>
          <a href="#x" data-box={controlBox.join(',')}>link in the log</a>
        </div>
        <Fire />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByText('fire'));
    return document.querySelector('[data-component="ToastViewport"]') as HTMLElement;
  }

  it('a link scrolled out of the log\'s own box (its rect lies where the bottom place stands, the log\'s box does not) is not in the way: the host stays at the bottom', () => {
    const host = withScroller([0, 100, 390, 400], [0, 740, 390, 780]);
    expect(host.getAttribute('data-placement')).toBe('bottom');
  });

  it('a link scrolled out of a HORIZONTAL scroller (the party tile row) is not in the way either: clipping on X', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 844 });
    jest.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      const el = this as HTMLElement;
      if (el.getAttribute('data-component') === 'ToastViewport') return el.getAttribute('data-placement') === 'top' ? domRect([12, 8 + Number.parseFloat(el.style.getPropertyValue('--toast-top') || '0'), 378, 88 + Number.parseFloat(el.style.getPropertyValue('--toast-top') || '0')]) : domRect([12, 740, 378, 820]);
      const m = el.dataset?.box;
      return domRect(m ? (m.split(',').map(Number) as Box) : [0, 0, 0, 0]);
    });
    jest.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) { return this.getAttribute('data-component') === 'ToastViewport' ? 80 : 0; });
    render(<ToastProvider><div style={{ overflowX: 'auto' }} data-box="0,700,100,840"><button data-box="150,740,250,780">tile 5</button></div><Fire /></ToastProvider>);
    fireEvent.click(screen.getByText('fire'));
    expect(document.querySelector('[data-component="ToastViewport"]')?.getAttribute('data-placement')).toBe('bottom');
  });

  it('a `position: fixed` control inside a scroller is NOT clipped by it (the Attack menu\'s items, a dialog\'s buttons are painted and hittable): it is in the way (Kage N6-2)', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 844 });
    jest.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      const el = this as HTMLElement;
      if (el.getAttribute('data-component') === 'ToastViewport') return el.getAttribute('data-placement') === 'top' ? domRect([12, 8 + Number.parseFloat(el.style.getPropertyValue('--toast-top') || '0'), 378, 88 + Number.parseFloat(el.style.getPropertyValue('--toast-top') || '0')]) : domRect([12, 740, 378, 820]);
      const m = el.dataset?.box;
      return domRect(m ? (m.split(',').map(Number) as Box) : [0, 0, 0, 0]);
    });
    jest.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) { return this.getAttribute('data-component') === 'ToastViewport' ? 80 : 0; });
    render(<ToastProvider><div style={{ overflowY: 'auto' }} data-box="0,100,390,400"><button style={{ position: 'fixed' }} data-box="0,740,390,780">fixed item</button></div><Fire /></ToastProvider>);
    fireEvent.click(screen.getByText('fire'));
    expect(document.querySelector('[data-component="ToastViewport"]')?.getAttribute('data-placement')).toBe('top');
  });

  it('...and a fixed box is where the clip walk STOPS: a control in a fixed dialog inside a scroller is not clipped by that scroller either', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 844 });
    jest.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      const el = this as HTMLElement;
      if (el.getAttribute('data-component') === 'ToastViewport') return el.getAttribute('data-placement') === 'top' ? domRect([12, 8 + Number.parseFloat(el.style.getPropertyValue('--toast-top') || '0'), 378, 88 + Number.parseFloat(el.style.getPropertyValue('--toast-top') || '0')]) : domRect([12, 740, 378, 820]);
      const m = el.dataset?.box;
      return domRect(m ? (m.split(',').map(Number) as Box) : [0, 0, 0, 0]);
    });
    jest.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) { return this.getAttribute('data-component') === 'ToastViewport' ? 80 : 0; });
    render(<ToastProvider><div style={{ overflowY: 'auto' }} data-box="0,100,390,400"><div style={{ position: 'fixed' }} data-box="0,730,390,830"><button data-box="0,740,390,780">dialog button</button></div></div><Fire /></ToastProvider>);
    fireEvent.click(screen.getByText('fire'));
    expect(document.querySelector('[data-component="ToastViewport"]')?.getAttribute('data-placement')).toBe('top');
  });

  it('...including a fixed box that has an overflow of its OWN: its own clip applies, the scroller outside it does not', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 844 });
    jest.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      const el = this as HTMLElement;
      if (el.getAttribute('data-component') === 'ToastViewport') return el.getAttribute('data-placement') === 'top' ? domRect([12, 8 + Number.parseFloat(el.style.getPropertyValue('--toast-top') || '0'), 378, 88 + Number.parseFloat(el.style.getPropertyValue('--toast-top') || '0')]) : domRect([12, 740, 378, 820]);
      const m = el.dataset?.box;
      return domRect(m ? (m.split(',').map(Number) as Box) : [0, 0, 0, 0]);
    });
    jest.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) { return this.getAttribute('data-component') === 'ToastViewport' ? 80 : 0; });
    render(<ToastProvider><div style={{ overflowY: 'auto' }} data-box="0,100,390,400"><div style={{ position: 'fixed', overflowY: 'auto' }} data-box="0,730,390,830"><button data-box="0,740,390,780">dialog button</button></div></div><Fire /></ToastProvider>);
    fireEvent.click(screen.getByText('fire'));
    expect(document.querySelector('[data-component="ToastViewport"]')?.getAttribute('data-placement')).toBe('top');
  });

  it('control: the same link INSIDE the log\'s box is in the way and moves the host', () => {
    const host = withScroller([0, 100, 390, 800], [0, 740, 390, 780]);
    expect(host.getAttribute('data-placement')).toBe('top');
  });
});

// Kage round-5 "pins that do not bite": each of these passed with its own filter removed.
describe('Toast host: what is NOT a control in the way', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => { act(() => { jest.runAllTimers(); }); jest.useRealTimers(); jest.restoreAllMocks(); });

  it('the host\'s own controls (its Dismiss buttons) are not in the way of itself', async () => {
    const { host, place, flush } = setup({});
    expect(place()).toBe('bottom/0px');
    const own = document.createElement('button');
    own.setAttribute('data-box', '0,700,390,800'); // lying exactly where the bottom place stands
    host.appendChild(own);
    fireEvent(window, new Event('resize'));
    await flush();
    expect(place()).toBe('bottom/0px');
  });

  it('a 1px sr-only name is not a control in the way', async () => {
    const { place, flush } = setup({ controls: [[100, 740, 102, 742]] });
    await flush();
    expect(place()).toBe('bottom/0px');
  });

  it('a control inside an `inert` (or hidden, or aria-hidden) region is not in the way', async () => {
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 844 });
    for (const attr of ['inert', 'hidden', 'aria-hidden']) {
      const { host, place, flush, view } = setup({});
      const wrap = document.createElement('div');
      wrap.setAttribute(attr, attr === 'aria-hidden' ? 'true' : '');
      const b = document.createElement('button');
      b.setAttribute('data-box', '0,740,390,800');
      wrap.appendChild(b);
      document.body.appendChild(wrap);
      fireEvent(window, new Event('resize'));
      await flush();
      expect([attr, place(), host.isConnected]).toEqual([attr, 'bottom/0px', true]);
      wrap.remove();
      view.unmount();
      jest.restoreAllMocks();
    }
  });
});

describe('Toast host: a keyboard Dismiss does not leave focus on <body>', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => { act(() => { jest.runAllTimers(); }); jest.useRealTimers(); jest.restoreAllMocks(); });

  it('focus goes back to where it came from; with nowhere to go, to the page\'s fallback (data-focus-fallback)', () => {
    render(
      <ToastProvider>
        <div data-focus-fallback="" tabIndex={-1}>head</div>
        <button>composer</button>
        <Fire />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByText('fire'));
    const composer = screen.getByText('composer');
    act(() => composer.focus());
    const dismiss = screen.getByRole('button', { name: 'Dismiss notification' });
    act(() => dismiss.focus()); // Tab from the composer
    fireEvent.click(dismiss);
    act(() => { jest.advanceTimersByTime(300); });
    expect(composer).toHaveFocus();
  });

  it('...the fallback when where it came from is gone', () => {
    render(
      <ToastProvider>
        <div data-focus-fallback="" tabIndex={-1}>head</div>
        <Fire />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByText('fire'));
    const dismiss = screen.getByRole('button', { name: 'Dismiss notification' });
    act(() => dismiss.focus());
    fireEvent.click(dismiss);
    act(() => { jest.advanceTimersByTime(300); });
    expect(screen.getByText('head')).toHaveFocus();
  });

  it('a MOUSE click on the x moves no focus: with nothing focused, focus stays on <body> (the scene head took it before)', () => {
    render(
      <ToastProvider>
        <div data-focus-fallback="" tabIndex={-1}>head</div>
        <Fire />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByText('fire'));
    const dismiss = screen.getByRole('button', { name: 'Dismiss notification' });
    fireEvent.pointerDown(dismiss);
    act(() => dismiss.focus()); // Chromium focuses the button between pointerdown and click
    fireEvent.click(dismiss);
    act(() => { jest.advanceTimersByTime(300); });
    expect(document.body).toHaveFocus();
  });

  it('where focus came from is forgotten when focus enters the host from NOWHERE: a stale target is never returned to', () => {
    render(
      <ToastProvider>
        <div data-focus-fallback="" tabIndex={-1}>head</div>
        <button>composer</button>
        <Fire />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByText('fire'));
    const composer = screen.getByText('composer');
    const dismiss = screen.getByRole('button', { name: 'Dismiss notification' });
    act(() => composer.focus());
    act(() => dismiss.focus()); // from the composer: remembered
    act(() => (document.activeElement as HTMLElement).blur());
    act(() => dismiss.focus()); // from nowhere: the composer is forgotten
    fireEvent.click(dismiss);
    act(() => { jest.advanceTimersByTime(300); });
    expect(screen.getByText('head')).toHaveFocus();
    expect(composer).not.toHaveFocus();
  });

  it('guard 1: focus that was never in the host is never taken (nothing focused, a card times out: focus stays on <body>, the fallback is not touched)', () => {
    render(
      <ToastProvider>
        <div data-focus-fallback="" tabIndex={-1}>head</div>
        <Fire />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByText('fire'));
    act(() => { jest.advanceTimersByTime(5400); });
    expect(document.body).toHaveFocus();
  });

  it('guard 2: while the card is still there (exiting) focus on its x is left alone; it moves only when the card is gone', () => {
    render(
      <ToastProvider>
        <div data-focus-fallback="" tabIndex={-1}>head</div>
        <Fire />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByText('fire'));
    const dismiss = screen.getByRole('button', { name: 'Dismiss notification' });
    act(() => dismiss.focus());
    fireEvent.click(dismiss); // exiting: 220 ms of exit animation
    act(() => { jest.advanceTimersByTime(100); });
    expect(dismiss).toHaveFocus();
    act(() => { jest.advanceTimersByTime(200); });
    expect(screen.getByText('head')).toHaveFocus();
  });

  it('a card taller than its max height is a tab stop (and named), so a keyboard user can scroll all of it', () => {
    const RO = (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class { constructor(private cb: () => void) { setTimeout(cb, 0); } observe() {} disconnect() {} unobserve() {} };
    const sh = jest.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function (this: HTMLElement) { return this.className.includes('body') ? 400 : 0; });
    const ch = jest.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) { return this.className.includes('body') ? 120 : 0; });
    try {
      render(<ToastProvider><Fire /></ToastProvider>);
      fireEvent.click(screen.getByText('fire'));
      act(() => { jest.advanceTimersByTime(5); });
      const body = document.querySelector('[data-component="Toast"] [aria-label="Notification text, scrollable"]') as HTMLElement;
      expect(body).not.toBeNull();
      expect(body.tabIndex).toBe(0);
    } finally {
      sh.mockRestore();
      ch.mockRestore();
      (globalThis as { ResizeObserver?: unknown }).ResizeObserver = RO;
    }
  });

  it('a card that fits is not a tab stop', () => {
    render(<ToastProvider><Fire /></ToastProvider>);
    fireEvent.click(screen.getByText('fire'));
    expect(document.querySelector('[data-component="Toast"] [tabindex]')).toBeNull();
  });

  it('a press that ENDS is over: click elsewhere, then Tab into the host and Enter on Dismiss: focus goes back to where it came from (a press that never ended would swallow it)', () => {
    render(
      <ToastProvider>
        <div data-focus-fallback="" tabIndex={-1}>head</div>
        <button>composer</button>
        <button>elsewhere</button>
        <Fire />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByText('fire'));
    const elsewhere = screen.getByText('elsewhere');
    const composer = screen.getByText('composer');
    fireEvent.pointerDown(elsewhere);
    fireEvent.click(elsewhere);
    act(() => { jest.advanceTimersByTime(5); }); // a task after the click: the press is over
    act(() => composer.focus());
    const dismiss = screen.getByRole('button', { name: 'Dismiss notification' });
    act(() => dismiss.focus()); // Tab into the host
    fireEvent.click(dismiss); // Enter (a click with no pointerdown)
    act(() => { jest.advanceTimersByTime(300); });
    expect(composer).toHaveFocus();
  });

  it('a pointerdown FORGETS focus already in the host: with the x focused by keyboard, a mouse press on it is a pointer dismiss and moves no focus (body stays body)', () => {
    render(
      <ToastProvider>
        <div data-focus-fallback="" tabIndex={-1}>head</div>
        <Fire />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByText('fire'));
    const dismiss = screen.getByRole('button', { name: 'Dismiss notification' });
    act(() => dismiss.focus()); // by keyboard: the rescue is armed
    fireEvent.pointerDown(dismiss); // ...then the mouse presses it: the rescue stands down
    fireEvent.click(dismiss);
    act(() => { jest.advanceTimersByTime(300); });
    expect(document.body).toHaveFocus();
  });

  // Round 9 (Miko F2): the host follows the X-card in Tab order; a keyboard Dismiss returned focus to the X-card and a held Enter then fired it.
  it('a keyboard Dismiss NEVER returns focus to a safety control: Tab from the X-card into Dismiss, Enter: focus goes to the scene head', () => {
    render(
      <ToastProvider>
        <div data-focus-fallback="" tabIndex={-1}>head</div>
        <div data-toast-avoid="safety"><button>X-card</button></div>
        <Fire />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByText('fire'));
    const xcard = screen.getByText('X-card');
    act(() => xcard.focus());
    const dismiss = screen.getByRole('button', { name: 'Dismiss notification' });
    act(() => dismiss.focus()); // Tab from the X-card
    fireEvent.click(dismiss);
    act(() => { jest.advanceTimersByTime(300); });
    expect(screen.getByText('head')).toHaveFocus();
    expect(xcard).not.toHaveFocus();
  });

  it('...and anything INSIDE the safety block counts, not only the button', () => {
    render(
      <ToastProvider>
        <div data-focus-fallback="" tabIndex={-1}>head</div>
        <div data-toast-avoid="safety"><a href="#hint">Safety hint link</a></div>
        <Fire />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByText('fire'));
    const link = screen.getByText('Safety hint link');
    act(() => link.focus());
    const dismiss = screen.getByRole('button', { name: 'Dismiss notification' });
    act(() => dismiss.focus());
    fireEvent.click(dismiss);
    act(() => { jest.advanceTimersByTime(300); });
    expect(screen.getByText('head')).toHaveFocus();
  });

  // Round 9 (Miko F3): a pointer dismiss leaves a REAL focus where it was (the composer stays focused); with nothing focused it moves no focus.
  it('a MOUSE click on the x while focus is in the composer leaves the composer focused', () => {
    render(
      <ToastProvider>
        <div data-focus-fallback="" tabIndex={-1}>head</div>
        <button>composer</button>
        <Fire />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByText('fire'));
    const composer = screen.getByText('composer');
    act(() => composer.focus());
    const dismiss = screen.getByRole('button', { name: 'Dismiss notification' });
    fireEvent.pointerDown(dismiss);
    act(() => dismiss.focus()); // Chromium focuses the pressed button
    fireEvent.click(dismiss);
    act(() => { jest.advanceTimersByTime(300); });
    expect(composer).toHaveFocus();
  });

  it('...but a pointer dismiss never hands focus BACK to a safety control either (the scene head instead)', () => {
    render(
      <ToastProvider>
        <div data-focus-fallback="" tabIndex={-1}>head</div>
        <div data-toast-avoid="safety"><button>X-card</button></div>
        <Fire />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByText('fire'));
    const xcard = screen.getByText('X-card');
    act(() => xcard.focus());
    const dismiss = screen.getByRole('button', { name: 'Dismiss notification' });
    fireEvent.pointerDown(dismiss);
    act(() => dismiss.focus());
    fireEvent.click(dismiss);
    act(() => { jest.advanceTimersByTime(300); });
    expect(xcard).not.toHaveFocus();
    expect(screen.getByText('head')).toHaveFocus();
  });

  it('focus the user had elsewhere is never taken: a card going away while focus is on the page leaves it', () => {
    render(
      <ToastProvider>
        <div data-focus-fallback="" tabIndex={-1}>head</div>
        <button>composer</button>
        <Fire />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByText('fire'));
    const composer = screen.getByText('composer');
    act(() => composer.focus());
    act(() => { jest.advanceTimersByTime(5400); });
    expect(composer).toHaveFocus();
  });
});
