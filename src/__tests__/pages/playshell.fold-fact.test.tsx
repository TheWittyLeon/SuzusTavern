/**
 * B8c-4 P0 (Sora's phone-mount brief 2.3, 4.2, 4.3, 4.4; the Coordinator addendum, binding) — the fold as a FACT, zero pixels.
 *
 * Nothing in the real registry emits a body fold yet (P1 declares the phone row's), so every case here mounts a TEST row: the phone row with its stage made collapsible,
 * `foldDefault: 'fits'` and a `fold:sceneStage` table. What is pinned is the mechanism: the fact and its precedence, the measured default and the three events that decide it again, the
 * touch gate, the banner, the scroll step, the automatic scroll, the `hidden` body and the focus hand-over. jsdom has no layout, so each case plants the numbers the shell reads
 * (`scrollHeight`, `clientHeight`, rects, the document's scroller) and names which of them a case moves.
 *
 * The zero-pixel pin is the first block: the REAL registry with its REAL specs renders the same grid style, handle set and region markup whether or not the fold machinery is there.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Profiler, useLayoutEffect, type ProfilerOnRenderCallback, type ReactNode } from 'react';
import PlayShell, { type FoldSpec, type PlayShellProps } from '@/app/play/[sessionId]/PlayShell';
import { FoldHandleSlot, useFoldBody } from '@/components/FoldDock';
import { FOLD_SPECS } from '@/app/play/[sessionId]/foldSpecs';
import { markOwnScroll } from '@/lib/ownScroll';
import { FOLD_MAX_HELD_RETRIES, FOLD_BANNER_REASON, FOLD_NO_ROOM_REASON, FOLD_QUIET_MS, FOLD_REACTIVATE_MS, FOLD_TOUCH_BACKSTOP_MS } from '@/app/play/[sessionId]/hooks/useFoldFacts';
import { LAYOUT_ROWS, LAYOUT_ROWS_BY_ID, REGION_IDS, getPlacement, type LayoutRow, type Moment } from '@/app/play/[sessionId]/presets';

// The registry's foldable set is computed from the real rows, and no real row folds the stage until P1: the test row below does, so the stage joins the set here (and only here).
jest.mock('../../app/play/[sessionId]/presets', () => {
  const actual = jest.requireActual('../../app/play/[sessionId]/presets');
  return { ...actual, FOLDABLE_REGIONS: new Set([...actual.FOLDABLE_REGIONS, 'sceneStage']) };
});

const BODY = 'play-scene-stage-body';
const phone = LAYOUT_ROWS_BY_ID.phone;

/** The phone row with a measured, collapsible stage and a table for `fold:sceneStage`: the vars it answers are what the grid's style shows. */
function foldRow(over: { foldDefault?: 'open' | 'fits'; table?: boolean; everywhere?: boolean } = {}): LayoutRow {
  const place = { ...getPlacement(phone, 'sceneStage', 'combat'), collapsible: true, foldDefault: over.foldDefault ?? 'fits' };
  return {
    ...phone,
    regions: { ...phone.regions, sceneStage: { default: over.everywhere ? { ...place, area: 'sceneStage' } : { ...phone.regions.sceneStage.default, area: 'sceneStage' }, combat: place } }, // collapsible in the fight only, as a real row declares it
    factVars: over.table === false ? phone.factVars : {
      ...phone.factVars,
      'fold:sceneStage': { auto: { '--play-body-floor': 'AUTO' }, open: { '--play-body-floor': 'OPEN' }, folded: { '--play-body-floor': 'FOLDED' } },
    },
  } as LayoutRow;
}

const SPEC: FoldSpec = { label: 'Map', text: 'Map', icon: 'Map', body: BODY, when: { room: 'board' } };

let scrollOnLayout = false; // a scroll event that lands in the very commit that renders the stage (an engine adjusting a shrinking layout)
function Stage({ slot = true }: { slot?: boolean }) {
  const folded = useFoldBody();
  useLayoutEffect(() => { if (scrollOnLayout) window.dispatchEvent(new Event('scroll')); });
  return (
    <div data-region="sceneStage">
      <button type="button">End combat</button>
      {slot && <FoldHandleSlot />}
      <div id={BODY} data-fold-body hidden={folded}>
        <button type="button" data-testid="square">square</button>
      </div>
    </div>
  );
}

type Props = Partial<PlayShellProps>;
function shell(row: LayoutRow, props: Props = {}, extra: { slot?: boolean; banner?: ReactNode; profile?: ProfilerOnRenderCallback } = {}) {
  const tree = (p: Props) => wrap(
    <PlayShell
      row={row}
      moment="combat"
      facts={{ room: 'board' }}
      regions={{ sceneStage: <Stage slot={extra.slot} />, safetyBanner: extra.banner ?? null }}
      tenants={{}}
      foldSpecs={{ sceneStage: SPEC }}
      onFoldChoice={jest.fn()}
      {...props}
      {...p}
    />,
  );
  const wrap = (node: ReactNode) => (extra.profile ? <Profiler id="shell" onRender={extra.profile}>{node}</Profiler> : node);
  const view = render(tree({}));
  return { ...view, again: (p: Props) => view.rerender(tree(p)) };
}

const grid = () => document.querySelector('[data-layout-resolved]') as HTMLElement;
const handle = () => screen.getByRole('button', { name: 'Map' });
const bodyEl = () => document.getElementById(BODY) as HTMLElement;
const floorVar = () => grid().style.getPropertyValue('--play-body-floor');

/** The width the fold watches is the WINDOW's (a classic scrollbar shrinks the root's `clientWidth` on a height-only step). */
const originalInnerWidth = window.innerWidth;
function setWidth(w: number) { Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: w }); }
afterEach(() => setWidth(originalInnerWidth));

// Every ResizeObserver the page makes (the shell's fit measurement and the fold's width watch): a report is delivered to all of them.
const observers: Array<() => void> = [];
const ro = { cb: () => observers.forEach((f) => f()) };
beforeEach(() => {
  observers.length = 0;
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
    cb: () => void;
    constructor(cb: () => void) { this.cb = cb; observers.push(cb); }
    observe() {}
    disconnect() {}
    unobserve() {}
  };
});
afterEach(() => {
  jest.useRealTimers();
  delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
});

// jsdom reads 0 and 0 for the page; "fits" is 0 <= 0 + 1. A scrolling page is planted on the grid BEFORE the commit that measures, via a getter on the prototype.
const restores: Array<() => void> = [];
afterEach(() => { while (restores.length) restores.pop()!(); });
function pageScrolls(on: boolean) {
  const proto = HTMLElement.prototype;
  const sh = Object.getOwnPropertyDescriptor(proto, 'scrollHeight');
  const ch = Object.getOwnPropertyDescriptor(proto, 'clientHeight');
  Object.defineProperty(proto, 'scrollHeight', { configurable: true, get() { return on && (this as HTMLElement).hasAttribute('data-layout-resolved') ? 900 : 0; } });
  Object.defineProperty(proto, 'clientHeight', { configurable: true, get() { return on && (this as HTMLElement).hasAttribute('data-layout-resolved') ? 844 : 0; } });
  // Undone in afterEach whatever a case does, so a red case cannot leak a scrolling page into the next one.
  const restore = () => {
    if (sh) Object.defineProperty(proto, 'scrollHeight', sh); else delete (proto as unknown as Record<string, unknown>).scrollHeight;
    if (ch) Object.defineProperty(proto, 'clientHeight', ch); else delete (proto as unknown as Record<string, unknown>).clientHeight;
  };
  restores.push(restore);
  return restore;
}

describe('zero pixels: the real registry is the same page with or without a fold fact', () => {
  const combos = LAYOUT_ROWS.flatMap((row) => (['exploring', 'combat'] as Moment[]).map((m): [string, LayoutRow, Moment] => [`${row.id}/${m}`, row, m]));
  const regions = () => Object.fromEntries(REGION_IDS.map((id) => [id, <span key={id} data-probe-region={id}>{id}</span>]));
  it.each(combos)('%s: the grid style, the handles and the slots carry no fold fact and no fold var', (_n, row, moment) => {
    const { container } = render(<PlayShell row={row} moment={moment} facts={{ room: 'board' }} regions={regions()} tenants={{}} foldSpecs={FOLD_SPECS} />);
    const style = container.querySelector<HTMLElement>('[data-layout-resolved]')!.getAttribute('style') ?? '';
    expect(style).not.toMatch(/fold/i);
    // No row declares a measured fold: no `auto`-floor var, nothing hidden, no body handle.
    expect(container.querySelectorAll('[hidden]:not(span)')).toHaveLength(0);
    expect(container.querySelector('[aria-controls="play-scene-stage-body"]')).toBeNull();
  });

  it('no registry row declares a measured fold or a fold table yet (P1 does): the registry is where the zero-pixel claim lives', () => {
    for (const row of LAYOUT_ROWS) {
      expect(Object.keys(row.factVars ?? {}).filter((k) => k.startsWith('fold:'))).toEqual([]);
      for (const id of REGION_IDS) for (const m of ['exploring', 'combat'] as Moment[]) expect(getPlacement(row, id, m).foldDefault).toBeUndefined();
    }
  });
});

describe('the fact: `fold:<regionId>` is reported by the shell, last, and a row answers it like any fact', () => {
  it('a row with a table gets the values: auto while the default is measured and nothing is decided (a page that never gets a measurement stays auto)', () => {
    jest.useFakeTimers();
    shell(foldRow());
    // The test page fits (0 <= 0 + 1): the measurement ran in the same commit and decided open.
    expect(floorVar()).toBe('OPEN');
  });

  it('a row with NO table for the fold is unaffected (the zero-pixel half): no var, and the handle still works', () => {
    shell(foldRow({ table: false }));
    expect(grid().getAttribute('style') ?? '').not.toMatch(/OPEN|AUTO|FOLDED/);
    expect(handle()).toHaveAttribute('aria-expanded', 'true');
  });

  it('a fold that does not exist (its `when` does not hold) reports no fact and its dock is inert: no handle, never hidden', () => {
    shell(foldRow(), { facts: { room: 'band' } });
    expect(screen.queryByRole('button', { name: 'Map' })).toBeNull();
    expect(floorVar()).toBe('');
    expect(bodyEl()).not.toHaveAttribute('hidden');
  });

  it('the vocabulary: a fold fact outside auto / open / folded throws, naming the row (a typo is not "no values")', () => {
    const { factVarsFor } = jest.requireActual('../../app/play/[sessionId]/presets') as typeof import('../../app/play/[sessionId]/presets');
    expect(() => factVarsFor(foldRow(), { 'fold:sceneStage': 'sideways' as never })).toThrow(/not a declared value of fact "fold:sceneStage"/);
    expect(() => factVarsFor(foldRow(), { 'fold:nowhere': 'open' } as never)).toThrow(/not a declared fact/);
    expect(factVarsFor(foldRow(), { room: 'board', 'fold:sceneStage': 'folded' })).toMatchObject({ '--play-body-floor': 'FOLDED' });
  });
});

describe('the measured default (4.2): the page renders once at the `auto` floor, and fits decides', () => {
  it('fits -> open; scrolls -> folded; and the measurement is READ while the fold is auto (the floor var is AUTO at the read)', () => {
    for (const [scrolls, want, expanded] of [[false, 'OPEN', 'true'], [true, 'FOLDED', 'false']] as const) {
      const reads: string[] = [];
      const restore = pageScrolls(scrolls);
      const proto = HTMLElement.prototype;
      const get = Object.getOwnPropertyDescriptor(proto, 'scrollHeight')!.get!;
      Object.defineProperty(proto, 'scrollHeight', { configurable: true, get() { if ((this as HTMLElement).hasAttribute('data-layout-resolved')) reads.push((this as HTMLElement).style.getPropertyValue('--play-body-floor')); return get.call(this); } });
      const { unmount } = shell(foldRow());
      expect(reads).toContain('AUTO');
      expect(floorVar()).toBe(want);
      expect(handle()).toHaveAttribute('aria-expanded', expanded);
      unmount();
      restore();
    }
  });

  it('a stored choice is never overridden: stored folded stays folded on a page that fits, stored open stays open on a page that scrolls', () => {
    shell(foldRow(), { foldedRegions: new Set(['sceneStage']) });
    expect(floorVar()).toBe('FOLDED');
    const restore = pageScrolls(true);
    document.body.innerHTML = '';
    shell(foldRow(), { openedRegions: new Set(['sceneStage']) });
    expect(floorVar()).toBe('OPEN');
    expect(handle()).toHaveAttribute('aria-expanded', 'true');
    restore();
  });

  it('a reveal opens a fold the user stored folded (Move on a folded map), and writes nothing', () => {
    const onFoldChoice = jest.fn();
    shell(foldRow(), { foldedRegions: new Set(['sceneStage']), revealedRegions: new Set(['sceneStage']), onFoldChoice });
    expect(floorVar()).toBe('OPEN');
    expect(bodyEl()).not.toHaveAttribute('hidden');
    expect(onFoldChoice).not.toHaveBeenCalled();
  });

  it('a fold whose default is not measured is open and is never decided (`foldDefault: open`)', () => {
    const restore = pageScrolls(true);
    shell(foldRow({ foldDefault: 'open' }));
    expect(floorVar()).toBe('OPEN');
    restore();
  });
});

describe('the decision is made again on exactly three events', () => {
  it('1. a fight starting: the moment changes', () => {
    const restore = pageScrolls(false);
    const s = shell(foldRow({ everywhere: true }), { moment: 'exploring' });
    // exploring: the fold is live here (this row declares it in every moment); decided open on the fitting page
    expect(floorVar()).toBe('OPEN');
    restore();
    const restore2 = pageScrolls(true);
    s.again({ moment: 'combat' });
    expect(floorVar()).toBe('FOLDED');
    restore2();
  });

  it('2. the fold\'s `when` starting to hold: a room that becomes a board', () => {
    const s = shell(foldRow(), { facts: { room: 'none' } });
    expect(screen.queryByRole('button', { name: 'Map' })).toBeNull();
    const restore = pageScrolls(true);
    s.again({ facts: { room: 'board' } });
    expect(floorVar()).toBe('FOLDED');
    restore();
  });

  it('3. the shell root\'s WIDTH changing: decided again; a pure HEIGHT step decides nothing (the mutation: re-deciding on any resize turns the second half red)', () => {
    const restore = pageScrolls(false);
    shell(foldRow());
    setWidth(390);
    act(() => ro.cb()); // first report: the baseline width
    expect(floorVar()).toBe('OPEN');
    restore();
    const restore2 = pageScrolls(true);
    // a height-only change: the observer fires, the width is the same
    act(() => ro.cb());
    act(() => { window.dispatchEvent(new Event('resize')); });
    expect(floorVar()).toBe('OPEN');
    // a width change: decided again, and the page now scrolls
    setWidth(430);
    act(() => ro.cb());
    expect(floorVar()).toBe('FOLDED');
    restore2();
  });

  it('a classic scrollbar is not a width change: the ROOT\'s clientWidth shrinks when the page starts to scroll, the window\'s innerWidth does not (WebKit, a narrow desktop window)', () => {
    const restore = pageScrolls(false);
    shell(foldRow());
    const g = grid();
    setWidth(390);
    Object.defineProperty(g, 'clientWidth', { configurable: true, value: 390 });
    act(() => ro.cb());
    expect(floorVar()).toBe('OPEN');
    restore();
    const restore2 = pageScrolls(true);
    Object.defineProperty(g, 'clientWidth', { configurable: true, value: 375 }); // 15px of scrollbar
    act(() => ro.cb());
    expect(floorVar()).toBe('OPEN'); // the mutation (compare the root's clientWidth) folds it
    restore2();
  });

  it('a turn change, a poll or a rerender decides nothing: three rerenders with the page scrolling leave an open map open', () => {
    const restore = pageScrolls(false);
    const s = shell(foldRow());
    restore();
    const restore2 = pageScrolls(true);
    for (let i = 0; i < 3; i++) s.again({ facts: { room: 'board' } });
    expect(floorVar()).toBe('OPEN');
    restore2();
  });
});

describe('never while a touch is down, nor for 150 ms after the last scroll event: queued, then applied once (4.2, T C-1)', () => {
  const widthChange = (w: number) => { setWidth(w); act(() => ro.cb()); };

  it('a finger on the page holds a width change; the decision is applied 150 ms after the finger lifts', () => {
    jest.useFakeTimers();
    const restore = pageScrolls(false);
    shell(foldRow());
    widthChange(390);
    expect(floorVar()).toBe('OPEN');
    restore();
    const restore2 = pageScrolls(true);
    act(() => { fireEvent.touchStart(document.body, { touches: [{ clientX: 1, clientY: 1 }] }); });
    widthChange(430);
    act(() => { jest.advanceTimersByTime(5000 - 1); });
    expect(floorVar()).toBe('OPEN');
    act(() => { fireEvent.touchEnd(document.body, { touches: [] }); });
    act(() => { jest.advanceTimersByTime(FOLD_QUIET_MS - 1); });
    expect(floorVar()).toBe('OPEN');
    act(() => { jest.advanceTimersByTime(2); });
    expect(floorVar()).toBe('FOLDED');
    restore2();
  });

  it('a scroll event holds it for 150 ms from the LAST scroll event', () => {
    jest.useFakeTimers();
    const restore = pageScrolls(false);
    shell(foldRow());
    widthChange(390);
    restore();
    const restore2 = pageScrolls(true);
    act(() => { window.dispatchEvent(new Event('scroll')); });
    widthChange(430);
    act(() => { jest.advanceTimersByTime(100); window.dispatchEvent(new Event('scroll')); jest.advanceTimersByTime(100); });
    expect(floorVar()).toBe('OPEN');
    act(() => { jest.advanceTimersByTime(60); });
    expect(floorVar()).toBe('FOLDED');
    restore2();
  });

  it('a finger that never reports its end stops holding the gate after the backstop', () => {
    jest.useFakeTimers();
    const restore = pageScrolls(false);
    shell(foldRow());
    widthChange(390);
    restore();
    const restore2 = pageScrolls(true);
    act(() => { fireEvent.touchStart(document.body, { touches: [{ clientX: 1, clientY: 1 }] }); });
    widthChange(430);
    act(() => { jest.advanceTimersByTime(FOLD_TOUCH_BACKSTOP_MS + FOLD_QUIET_MS + 10); });
    expect(floorVar()).toBe('FOLDED');
    restore2();
  });

  it('a safety banner folds at once, under a finger, with no measurement (the one exception to the gate)', () => {
    jest.useFakeTimers();
    const s = shell(foldRow());
    expect(handle()).toHaveAttribute('aria-expanded', 'true');
    act(() => { fireEvent.touchStart(document.body, { touches: [{ clientX: 1, clientY: 1 }] }); });
    s.again({ regions: { sceneStage: <Stage />, safetyBanner: <div>X-card</div> } });
    expect(floorVar()).toBe('FOLDED');
    expect(bodyEl()).toHaveAttribute('hidden');
    // and when the banner goes the map is back as it was (the decision was never touched)
    s.again({ regions: { sceneStage: <Stage />, safetyBanner: null } });
    expect(floorVar()).toBe('OPEN');
  });
});

describe('the banner (4.1): the body folds at once, the handle is disabled, focusable and described, and it outranks a stored open', () => {
  it('a banner up: folded, `hidden`, aria-expanded false, aria-disabled, described by the reason; a press does nothing', () => {
    const onFoldChoice = jest.fn();
    shell(foldRow(), { openedRegions: new Set(['sceneStage']), onFoldChoice }, { banner: <div>X-card</div> });
    expect(floorVar()).toBe('FOLDED');
    expect(bodyEl()).toHaveAttribute('hidden');
    expect(handle()).toHaveAttribute('aria-expanded', 'false');
    expect(handle()).toHaveAttribute('aria-disabled', 'true');
    expect(handle().getAttribute('aria-describedby')).toBeTruthy();
    expect(document.getElementById(handle().getAttribute('aria-describedby')!)).toHaveTextContent(FOLD_BANNER_REASON);
    handle().focus();
    expect(handle()).toHaveFocus();
    fireEvent.click(handle());
    expect(onFoldChoice).not.toHaveBeenCalled();
  });

  it('a fold with no body is not folded by a banner (the character sheet: unchanged)', () => {
    const table = LAYOUT_ROWS_BY_ID.table;
    render(<PlayShell row={table} moment="exploring" regions={{ characterBlock: <span>sheet</span>, safetyBanner: <div>X-card</div> }} tenants={{}} foldSpecs={FOLD_SPECS} />);
    expect(screen.getByRole('button', { name: 'Character sheet' })).toHaveAttribute('aria-expanded', 'true');
  });
});

describe('the body is `hidden`, and focus inside it goes to the handle (4.4)', () => {
  it('folded by the user: the body takes the hidden ATTRIBUTE (not a class alone) and nothing in it is tabbable', () => {
    shell(foldRow(), { foldedRegions: new Set(['sceneStage']) });
    expect(bodyEl()).toHaveAttribute('hidden');
    expect(screen.queryByTestId('square')).not.toBeVisible();
  });

  it('a fold with focus inside the body hands focus to the handle, in the commit that hides it', () => {
    const s = shell(foldRow(), { openedRegions: new Set(['sceneStage']) });
    screen.getByTestId('square').focus();
    expect(screen.getByTestId('square')).toHaveFocus();
    s.again({ foldedRegions: new Set(['sceneStage']), openedRegions: new Set() });
    expect(handle()).toHaveFocus();
    expect(document.activeElement).not.toBe(document.body);
  });

  it('focus anywhere else is NOT touched by a fold (the control: End combat keeps it)', () => {
    const s = shell(foldRow(), { openedRegions: new Set(['sceneStage']) });
    screen.getByRole('button', { name: 'End combat' }).focus();
    s.again({ foldedRegions: new Set(['sceneStage']), openedRegions: new Set() });
    expect(screen.getByRole('button', { name: 'End combat' })).toHaveFocus();
  });
});

describe('a body dock provides its handle and the region places it (H.4)', () => {
  it('the handle is drawn by the slot: after End combat, before the body, 44 x 44 box class, the word under the glyph, the name containing it', () => {
    shell(foldRow());
    const h = handle();
    expect(h).toHaveTextContent('Map');
    expect(h.getAttribute('aria-label')).toContain('Map');
    expect(screen.getByRole('button', { name: 'End combat' }).compareDocumentPosition(h) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(h.compareDocumentPosition(bodyEl()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(h).toHaveAttribute('aria-controls', BODY);
  });

  it('a foldable body dock whose region renders no slot throws in development (the dock paints nothing of its own)', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => shell(foldRow(), {}, { slot: false })).toThrow(/FoldHandleSlot/);
    spy.mockRestore();
  });
});

describe('the scroll step (4.3, addendum): the map opens UPWARD, and the handle stays in view', () => {
  const rect = (top: number, h = 44) => ({ top, bottom: top + h, left: 0, right: 44, width: 44, height: h, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;
  let by: jest.Mock;
  let spies: jest.SpyInstance[];
  beforeEach(() => {
    by = jest.fn();
    window.scrollBy = by as unknown as typeof window.scrollBy;
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 664 });
    Object.defineProperty(document, 'scrollingElement', { configurable: true, value: { scrollHeight: 740, clientHeight: 664 } });
    spies = [];
  });
  afterEach(() => spies.forEach((s) => s.mockRestore()));

  /** The body is `bodyH` high and the handle's rect is `handleTop`: planted for the whole page (jsdom has no layout). */
  function layout(bodyH: () => number, handleTop: number) {
    spies.push(jest.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.id === BODY) return rect(0, bodyH());
      if (this.getAttribute('aria-controls') === BODY) return rect(handleTop);
      return rect(0, 0);
    }));
  }

  it('open: scrolls the page by what the body added, instantly, once the fold has opened (a press on a folded map)', () => {
    jest.useFakeTimers();
    let h = 0;
    layout(() => h, 300);
    const onFoldChoice = jest.fn();
    const s = shell(foldRow(), { foldedRegions: new Set(['sceneStage']), onFoldChoice });
    fireEvent.click(handle());
    expect(onFoldChoice).toHaveBeenCalledWith('sceneStage', 'open');
    h = 90;
    s.again({ foldedRegions: new Set(), openedRegions: new Set(['sceneStage']) });
    expect(by).toHaveBeenCalledWith({ top: 90, behavior: 'instant' });
  });

  it('the handle is never scrolled out of view: the step is clamped to the handle\'s distance from the top edge', () => {
    jest.useFakeTimers();
    let h = 0;
    layout(() => h, 40);
    const s = shell(foldRow(), { foldedRegions: new Set(['sceneStage']) });
    fireEvent.click(handle());
    h = 210;
    s.again({ foldedRegions: new Set(), openedRegions: new Set(['sceneStage']) });
    expect(by).toHaveBeenCalledWith({ top: 40, behavior: 'instant' });
  });

  it('a page that does not scroll is not scrolled', () => {
    jest.useFakeTimers();
    Object.defineProperty(document, 'scrollingElement', { configurable: true, value: { scrollHeight: 664, clientHeight: 664 } });
    let h = 0;
    layout(() => h, 300);
    const s = shell(foldRow(), { foldedRegions: new Set(['sceneStage']) });
    fireEvent.click(handle());
    h = 90;
    s.again({ foldedRegions: new Set(), openedRegions: new Set(['sceneStage']) });
    expect(by).not.toHaveBeenCalled();
  });

  it('folding scrolls back by what the body removed (clamped by the browser)', () => {
    jest.useFakeTimers();
    let h = 90;
    layout(() => h, 300);
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 90 });
    const onFoldChoice = jest.fn();
    const s = shell(foldRow(), { openedRegions: new Set(['sceneStage']), onFoldChoice });
    fireEvent.click(handle());
    expect(onFoldChoice).toHaveBeenCalledWith('sceneStage', 'folded');
    h = 0;
    s.again({ foldedRegions: new Set(['sceneStage']), openedRegions: new Set() });
    expect(by).toHaveBeenCalledWith({ top: -90, behavior: 'instant' });
  });

  it('a second activation inside 400 ms is ignored (the handle leaves from under the thumb); after it, it counts', () => {
    jest.useFakeTimers();
    layout(() => 0, 300);
    const onFoldChoice = jest.fn();
    shell(foldRow(), { foldedRegions: new Set(['sceneStage']), onFoldChoice });
    fireEvent.click(handle());
    fireEvent.click(handle());
    expect(onFoldChoice).toHaveBeenCalledTimes(1);
    act(() => { jest.advanceTimersByTime(FOLD_REACTIVATE_MS + 1); });
    fireEvent.click(handle());
    expect(onFoldChoice).toHaveBeenCalledTimes(2);
  });

  it('a handle that is not wholly in view cannot be opened: the open is refused, the handle is disabled with a reason, until the page scrolls', () => {
    jest.useFakeTimers();
    layout(() => 0, 640); // 640 + 44 > 664
    const onFoldChoice = jest.fn();
    shell(foldRow(), { foldedRegions: new Set(['sceneStage']), onFoldChoice });
    fireEvent.click(handle());
    expect(onFoldChoice).not.toHaveBeenCalled();
    expect(handle()).toHaveAttribute('aria-disabled', 'true');
    expect(document.getElementById(handle().getAttribute('aria-describedby')!)).toHaveTextContent(FOLD_NO_ROOM_REASON);
    act(() => { document.dispatchEvent(new Event('scroll')); }); // the PAGE scrolled: a document scroll
    expect(handle()).not.toHaveAttribute('aria-disabled');
  });

  it('a scroll inside the party band, the log or the board\'s window is NOT the page scrolling: it does not clear a refused open (only the document\'s scroll does; Tora MAJOR-2)', () => {
    jest.useFakeTimers();
    layout(() => 0, 640);
    shell(foldRow(), { foldedRegions: new Set(['sceneStage']), onFoldChoice: jest.fn() });
    fireEvent.click(handle());
    expect(handle()).toHaveAttribute('aria-disabled', 'true');
    const band = document.createElement('div');
    document.body.appendChild(band);
    act(() => { band.dispatchEvent(new Event('scroll')); });
    expect(handle()).toHaveAttribute('aria-disabled', 'true'); // the mutation (any target counts) clears it here
    band.remove();
  });
});

describe('the automatic cases (addendum): the page is left at its end, once, never under a keyboard or a hand', () => {
  let to: jest.Mock;
  beforeEach(() => {
    to = jest.fn();
    window.scrollTo = to as unknown as typeof window.scrollTo;
    Object.defineProperty(document, 'scrollingElement', { configurable: true, value: { scrollHeight: 740, clientHeight: 664 } });
  });
  const stored = { openedRegions: new Set(['sceneStage'] as const) as ReadonlySet<'sceneStage'> };

  it('a fight starting with a stored open on a page that scrolls: parked at its end, instantly', () => {
    const s = shell(foldRow(), { ...stored, moment: 'exploring' });
    to.mockClear();
    s.again({ moment: 'combat' });
    expect(to).toHaveBeenCalledWith({ top: 740, behavior: 'instant' });
  });

  it('not while an editable field has focus (a soft keyboard may be up)', () => {
    const s = shell(foldRow(), { ...stored, moment: 'exploring' });
    const input = document.createElement('textarea');
    document.body.appendChild(input);
    input.focus();
    to.mockClear();
    s.again({ moment: 'combat' });
    expect(to).not.toHaveBeenCalled();
    input.remove();
  });

  it('not if the user has scrolled since the last decision; the viewport getting shorter parks once per decision, never in a loop', () => {
    jest.useFakeTimers();
    const s = shell(foldRow(), { ...stored, moment: 'exploring' });
    s.again({ moment: 'combat' });
    expect(to).toHaveBeenCalledTimes(1);
    act(() => { window.dispatchEvent(new Event('resize')); });
    act(() => { window.dispatchEvent(new Event('resize')); });
    expect(to).toHaveBeenCalledTimes(1); // once per decision
    // a new decision (the fight ends and another starts), the user scrolls in between: nothing
    s.again({ moment: 'exploring' });
    s.again({ moment: 'combat' });
    expect(to).toHaveBeenCalledTimes(2);
    s.again({ moment: 'exploring' });
    act(() => { jest.advanceTimersByTime(1000); document.dispatchEvent(new Event('scroll')); jest.advanceTimersByTime(FOLD_QUIET_MS + 1); });
    s.again({ moment: 'combat' });
    expect(to).toHaveBeenCalledTimes(2);
  });

  it('a scroll the user made in ONE fight does not suppress the park of the NEXT (the reset when the fold is no longer live; the mutation: no reset)', () => {
    jest.useFakeTimers();
    const s = shell(foldRow(), { ...stored, moment: 'exploring' });
    s.again({ moment: 'combat' });
    expect(to).toHaveBeenCalledTimes(1);
    act(() => { jest.advanceTimersByTime(1000); document.dispatchEvent(new Event('scroll')); jest.advanceTimersByTime(FOLD_QUIET_MS + 1); }); // the user scrolls during the fight
    s.again({ moment: 'exploring' }); // the fight is over: no live body fold
    s.again({ moment: 'combat' });
    expect(to).toHaveBeenCalledTimes(2);
  });

  it('not while a finger is down; and a map that is folded is not parked at all', () => {
    jest.useFakeTimers();
    const s = shell(foldRow(), { ...stored, moment: 'exploring' });
    act(() => { fireEvent.touchStart(document.body, { touches: [{ clientX: 1, clientY: 1 }] }); });
    to.mockClear();
    s.again({ moment: 'combat' });
    expect(to).not.toHaveBeenCalled();
    act(() => { fireEvent.touchEnd(document.body, { touches: [] }); });
    const t = shell(foldRow(), { foldedRegions: new Set(['sceneStage']), moment: 'exploring' });
    to.mockClear();
    t.again({ moment: 'combat' });
    expect(to).not.toHaveBeenCalled();
  });
});

describe('a finger that is CANCELLED (a system gesture, a call) lets go of the gate like a lift: the decision lands 150 ms later, not at the 5 s backstop', () => {
  it('touchcancel with no finger left: applied within FOLD_QUIET_MS (the mutation: no touchcancel listener leaves it OPEN until the backstop)', () => {
    jest.useFakeTimers();
    const restore = pageScrolls(false);
    shell(foldRow());
    setWidth(390);
    act(() => ro.cb());
    restore();
    const restore2 = pageScrolls(true);
    act(() => { fireEvent.touchStart(document.body, { touches: [{ clientX: 1, clientY: 1 }] }); });
    setWidth(430);
    act(() => ro.cb());
    expect(floorVar()).toBe('OPEN');
    act(() => { fireEvent.touchCancel(document.body, { touches: [] }); });
    act(() => { jest.advanceTimersByTime(FOLD_QUIET_MS + 10); });
    expect(floorVar()).toBe('FOLDED');
    restore2();
  });
});

describe('ONE press path: every live fold writes a choice through the same press (so it clears a reveal); only the legacy two-state fold writes "none" for open', () => {
  const NO_BODY: FoldSpec = { label: 'Map', icon: 'Map', when: { room: 'board' } };
  /** Press, then press again with the first choice stored (the shell is rendered from storage, as the page does). */
  function twice(row: LayoutRow, spec: FoldSpec) {
    const onToggleFold = jest.fn();
    const onFoldChoice = jest.fn();
    const s = shell(row, { onToggleFold, onFoldChoice, foldSpecs: { sceneStage: spec } });
    fireEvent.click(handle());
    s.again({ foldedRegions: new Set(['sceneStage']) });
    return { onToggleFold, onFoldChoice, s };
  }
  it('no body, default open (the character sheet\'s fold): folded, then NONE (what it always stored), never the old toggle', () => {
    const r = twice(foldRow({ foldDefault: 'open' }), NO_BODY);
    fireEvent.click(handle());
    expect(r.onFoldChoice.mock.calls).toEqual([['sceneStage', 'folded'], ['sceneStage', 'none']]);
    expect(r.onToggleFold).not.toHaveBeenCalled();
  });
  it('no body, measured default: folded, then OPEN (a measured fold needs the third state); the mutation (the legacy test flipped) writes none here', () => {
    const r = twice(foldRow({ foldDefault: 'fits' }), NO_BODY);
    fireEvent.click(handle());
    expect(r.onFoldChoice.mock.calls).toEqual([['sceneStage', 'folded'], ['sceneStage', 'open']]);
  });
  it('a body: folded, then open (after its 400ms re-activation guard)', () => {
    jest.useFakeTimers();
    const onFoldChoice = jest.fn();
    const s = shell(foldRow({ foldDefault: 'fits' }), { onFoldChoice });
    fireEvent.click(handle());
    s.again({ foldedRegions: new Set(['sceneStage']) });
    act(() => { jest.advanceTimersByTime(FOLD_REACTIVATE_MS + 1); });
    fireEvent.click(handle());
    expect(onFoldChoice.mock.calls).toEqual([['sceneStage', 'folded'], ['sceneStage', 'open']]);
  });
  it('a caller that gives no `onFoldChoice` keeps the old toggle (nothing stores a third state for it)', () => {
    const onToggleFold = jest.fn();
    shell(foldRow({ foldDefault: 'open' }), { onToggleFold, onFoldChoice: undefined, foldSpecs: { sceneStage: NO_BODY } });
    fireEvent.click(handle());
    expect(onToggleFold).toHaveBeenCalledWith('sceneStage');
  });
  it('the 400ms guard is per fold and for a BODY handle only: a body-less fold can be pressed twice at once (a desktop sheet\'s fold was never deafened)', () => {
    const onFoldChoice = jest.fn();
    shell(foldRow({ foldDefault: 'open' }), { onFoldChoice, foldSpecs: { sceneStage: NO_BODY } });
    fireEvent.click(handle());
    fireEvent.click(handle());
    expect(onFoldChoice).toHaveBeenCalledTimes(2);
  });
});

describe('a fold that APPEARS under a finger is not decided until the finger lifts (the decide() gate; Kage I-4)', () => {
  it('event 2 under a finger: a board arrives while a touch is down -> auto (held), then decided 150 ms after the lift (the mutation: no gate in decide() folds it under the finger)', () => {
    jest.useFakeTimers();
    const s = shell(foldRow(), { facts: { room: 'none' } });
    const restore = pageScrolls(true);
    act(() => { fireEvent.touchStart(document.body, { touches: [{ clientX: 1, clientY: 1 }] }); });
    s.again({ facts: { room: 'board' } });
    expect(floorVar()).toBe('AUTO');
    act(() => { fireEvent.touchEnd(document.body, { touches: [] }); });
    act(() => { jest.advanceTimersByTime(FOLD_QUIET_MS + 1); });
    expect(floorVar()).toBe('FOLDED');
    restore();
  });
});

describe('the after-scroll gate hears EVERY scroller (Tora MAJOR-2): a band, a log or a board window gliding after the finger lifted holds a decision for 150 ms after its last scroll', () => {
  it('a scroll event on an ELEMENT (no bubbling) holds a queued width change; it lands 150 ms after that scroll, and the page is not "scrolled by the user" (a park is still allowed)', () => {
    jest.useFakeTimers();
    const restore = pageScrolls(false);
    shell(foldRow());
    setWidth(390);
    act(() => ro.cb());
    restore();
    const restore2 = pageScrolls(true);
    const band = document.createElement('div');
    document.body.appendChild(band);
    act(() => { band.dispatchEvent(new Event('scroll')); }); // does not bubble: only a capture listener on the window hears it
    setWidth(430);
    act(() => ro.cb());
    act(() => { jest.advanceTimersByTime(100); band.dispatchEvent(new Event('scroll')); jest.advanceTimersByTime(100); });
    expect(floorVar()).toBe('OPEN'); // 100 ms after the LAST element scroll
    act(() => { jest.advanceTimersByTime(60); });
    expect(floorVar()).toBe('FOLDED');
    band.remove();
    restore2();
  });
});


describe('the touch gate\'s clock and the flush\'s render (Tora MINOR-2 and MINOR-3)', () => {
  it('every finger down refreshes the backstop\'s clock, not only the first: a second finger at 4 s keeps the gate shut past the first finger\'s 5 s (the mutation: only the first refreshes it)', () => {
    jest.useFakeTimers();
    const restore = pageScrolls(false);
    shell(foldRow());
    setWidth(390);
    act(() => ro.cb());
    restore();
    const restore2 = pageScrolls(true);
    act(() => { fireEvent.touchStart(document.body, { touches: [{ clientX: 1, clientY: 1 }] }); });
    act(() => { jest.advanceTimersByTime(4000); });
    act(() => { fireEvent.touchStart(document.body, { touches: [{ clientX: 1, clientY: 1 }, { clientX: 9, clientY: 9 }] }); }); // a second finger
    setWidth(430);
    act(() => ro.cb());
    act(() => { jest.advanceTimersByTime(1500); }); // 5.5 s since the FIRST finger, 1.5 s since the second
    expect(floorVar()).toBe('OPEN');
    act(() => { jest.advanceTimersByTime(FOLD_TOUCH_BACKSTOP_MS); });
    expect(floorVar()).toBe('FOLDED'); // the backstop of the LAST finger has let go
    restore2();
  });

  it('a flush with nothing queued and no fold waiting for its measurement renders nothing: the 150 ms after every touch is not a render of the whole shell (the mutation: it always ticks)', () => {
    jest.useFakeTimers();
    const commits = jest.fn();
    shell(foldRow(), {}, { profile: commits });
    const before = commits.mock.calls.length;
    act(() => { fireEvent.touchStart(document.body, { touches: [{ clientX: 1, clientY: 1 }] }); });
    act(() => { fireEvent.touchEnd(document.body, { touches: [] }); });
    act(() => { jest.advanceTimersByTime(FOLD_QUIET_MS + 10); });
    expect(commits.mock.calls.length).toBe(before);
  });
});

describe('a decision that the gate holds IN the commit that would make it is asked for again (found in WebKit: the map never decided)', () => {
  afterEach(() => { scrollOnLayout = false; });
  it('a width change decides at once (gate open), a scroll event lands in that very commit, so the measurement is held: it is retried 150 ms later (the mutation: no retry leaves the fold `auto` for good)', () => {
    jest.useFakeTimers();
    const restore = pageScrolls(false);
    shell(foldRow());
    setWidth(390);
    act(() => ro.cb());
    expect(floorVar()).toBe('OPEN');
    restore();
    const restore2 = pageScrolls(true);
    scrollOnLayout = true;
    setWidth(430);
    act(() => ro.cb());
    expect(floorVar()).toBe('AUTO'); // held
    scrollOnLayout = false;
    act(() => { jest.advanceTimersByTime(FOLD_QUIET_MS * 3); });
    expect(floorVar()).toBe('FOLDED');
    restore2();
  });
});

describe('the page\'s own scrolls do not hold a decision (lib/ownScroll.ts) and a held measurement is bounded (Kage re-review: the decide() retry)', () => {
  afterEach(() => { scrollOnLayout = false; });
  it('a scroll on an element the page itself is scrolling (the log\'s stick-to-bottom) is not counted by the quiet period; an unmarked one still is', () => {
    jest.useFakeTimers();
    const restore = pageScrolls(false);
    shell(foldRow());
    setWidth(390);
    act(() => ro.cb());
    restore();
    const restore2 = pageScrolls(true);
    const log = document.createElement('div');
    document.body.appendChild(log);
    for (let i = 0; i < 5; i++) { markOwnScroll(log); act(() => { log.dispatchEvent(new Event('scroll')); jest.advanceTimersByTime(40); }); } // narration streaming: a pin every 40 ms
    setWidth(430);
    act(() => ro.cb());
    expect(floorVar()).toBe('FOLDED'); // decided at once: the pins did not hold it (the mutation: they count)
    log.remove();
    restore2();
  });

  it('a page that is NEVER quiet (a scroll in every commit) decides after FOLD_MAX_HELD_RETRIES asks, not never, and re-renders a bounded number of times (the mutation: no cap loops for ever)', () => {
    jest.useFakeTimers();
    const commits = jest.fn();
    const restore = pageScrolls(false);
    shell(foldRow(), {}, { profile: commits });
    setWidth(390);
    act(() => ro.cb());
    restore();
    const restore2 = pageScrolls(true);
    scrollOnLayout = true;
    setWidth(430);
    act(() => ro.cb());
    const c0 = commits.mock.calls.length;
    for (let i = 0; i < FOLD_MAX_HELD_RETRIES + 5; i++) act(() => { jest.advanceTimersByTime(FOLD_QUIET_MS); });
    expect(floorVar()).toBe('FOLDED');
    expect(commits.mock.calls.length - c0).toBeLessThan(FOLD_MAX_HELD_RETRIES * 3);
    restore2();
  });
});

describe('the retry cap counts SCROLLS, never a finger (Kage R3: it decided under the finger after 20 commits)', () => {
  afterEach(() => { scrollOnLayout = false; });
  it('a board arrives while a touch is down, then 25 ordinary commits (polls, streamed narration) arrive with the finger still down: the fold stays auto until the lift (the mutation: the cap counts the finger)', () => {
    jest.useFakeTimers();
    const s = shell(foldRow(), { facts: { room: 'none' } });
    const restore = pageScrolls(true);
    act(() => { fireEvent.touchStart(document.body, { touches: [{ clientX: 1, clientY: 1 }] }); });
    s.again({ facts: { room: 'board' } });
    expect(floorVar()).toBe('AUTO');
    for (let i = 0; i < 25; i++) { act(() => { jest.advanceTimersByTime(40); }); s.again({ facts: { room: 'board' } }); }
    expect(floorVar()).toBe('AUTO');
    act(() => { fireEvent.touchEnd(document.body, { touches: [] }); });
    act(() => { jest.advanceTimersByTime(FOLD_QUIET_MS + 1); });
    expect(floorVar()).toBe('FOLDED');
    restore();
  });

  it('a new decision gets the whole allowance: asked again after 15 held retries, it waits its own 20 (the mutation: the count is not reset by a new decision)', () => {
    jest.useFakeTimers();
    const restore = pageScrolls(false);
    shell(foldRow());
    setWidth(390);
    act(() => ro.cb());
    restore();
    const restore2 = pageScrolls(true);
    scrollOnLayout = true;
    setWidth(430);
    act(() => ro.cb());
    for (let i = 0; i < 15; i++) act(() => { jest.advanceTimersByTime(FOLD_QUIET_MS); });
    expect(floorVar()).toBe('AUTO');
    setWidth(390);
    act(() => ro.cb()); // a second width change: a new decision
    for (let i = 0; i < 12; i++) act(() => { jest.advanceTimersByTime(FOLD_QUIET_MS); });
    expect(floorVar()).toBe('AUTO'); // 12 asks into ITS 20 (without the reset it is 27 in, past the cap)
    for (let i = 0; i < 12; i++) act(() => { jest.advanceTimersByTime(FOLD_QUIET_MS); });
    expect(floorVar()).toBe('FOLDED');
    restore2();
  });
});
