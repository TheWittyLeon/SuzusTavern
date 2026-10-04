/**
 * B8c-4 P0 (the fold state machine), two defects Miko-QA found and a fix round closed; written by her, kept under behaviour names. Each case is RED on the defect it names.
 *   - a reveal outranks a stored fold (so Move can open a folded map), so a handle press that only wrote the stored choice was dead while the reveal stood: the press clears that id's reveal;
 *   - a decision queued while a scroll event alone held the gate was never flushed: the queue schedules its own flush.
 * Uses the same test-row technique as playshell.fold-fact.test.tsx (the registry has no body fold until P1). The width the fold watches is the window's (`setWidth`).
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import PlayShell, { type FoldSpec } from '@/app/play/[sessionId]/PlayShell';
import { ThemeProvider } from '@/lib/theme/ThemeProvider';
import { FOLDS_KEY, FOLDS_OPEN_KEY } from '@/lib/theme/theme';
import { FoldHandleSlot, useFoldBody } from '@/components/FoldDock';
import { useRegionFolds } from '@/app/play/[sessionId]/hooks/useRegionFolds';
import { LAYOUT_ROWS_BY_ID, getPlacement, type LayoutRow } from '@/app/play/[sessionId]/presets';
import { FOLD_QUIET_MS } from '@/app/play/[sessionId]/hooks/useFoldFacts';

jest.mock('../../app/play/[sessionId]/presets', () => {
  const actual = jest.requireActual('../../app/play/[sessionId]/presets');
  return { ...actual, FOLDABLE_REGIONS: new Set([...actual.FOLDABLE_REGIONS, 'sceneStage']) };
});

const BODY = 'play-scene-stage-body';
const phone = LAYOUT_ROWS_BY_ID.phone;
function foldRow(): LayoutRow {
  const place = { ...getPlacement(phone, 'sceneStage', 'combat'), collapsible: true, foldDefault: 'fits' as const };
  return {
    ...phone,
    regions: { ...phone.regions, sceneStage: { default: { ...place, area: 'sceneStage' }, combat: place } },
    factVars: { ...phone.factVars, 'fold:sceneStage': { auto: { '--play-body-floor': 'AUTO' }, open: { '--play-body-floor': 'OPEN' }, folded: { '--play-body-floor': 'FOLDED' } } },
  } as LayoutRow;
}
const SPEC: FoldSpec = { label: 'Map', text: 'Map', icon: 'Map', body: BODY, when: { room: 'board' } };
function Stage() {
  const folded = useFoldBody();
  return (
    <div data-region="sceneStage">
      <button type="button">End combat</button>
      <FoldHandleSlot />
      <div id={BODY} data-fold-body hidden={folded}><button type="button">square</button></div>
    </div>
  );
}

const holder: { current: ReturnType<typeof useRegionFolds> | null } = { current: null };
function Page() {
  const f = useRegionFolds('combat');
  holder.current = f; // eslint-disable-line react-hooks/immutability
  return <PlayShell row={foldRow()} moment="combat" facts={{ room: 'board' }} regions={{ sceneStage: <Stage /> }} tenants={{}} foldSpecs={{ sceneStage: SPEC }} {...f.shellProps} />;
}
const grid = () => document.querySelector('[data-layout-resolved]') as HTMLElement;
const floorVar = () => grid().style.getPropertyValue('--play-body-floor');
const handle = () => screen.getByRole('button', { name: 'Map' });
const originalInnerWidth = window.innerWidth;
const setWidth = (w: number) => Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: w });
const observers: Array<() => void> = [];
beforeEach(() => {
  window.localStorage.removeItem(FOLDS_KEY); window.localStorage.removeItem(FOLDS_OPEN_KEY);
  observers.length = 0;
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class { constructor(cb: () => void) { observers.push(cb); } observe() {} disconnect() {} unobserve() {} };
});
afterEach(() => {
  setWidth(originalInnerWidth);
  jest.useRealTimers(); delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
  delete (HTMLElement.prototype as unknown as Record<string, unknown>).scrollHeight; delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientHeight; // a red case must not leak a scrolling page
});

describe('a reveal must not make the handle dead (Move opened a stored-folded map; the player presses Map to fold it)', () => {
  it('stored folded -> reveal -> press the handle: the map FOLDS', () => {
    window.localStorage.setItem(FOLDS_KEY, '["sceneStage"]');
    render(<ThemeProvider><Page /></ThemeProvider>);
    expect(floorVar()).toBe('FOLDED');
    act(() => holder.current!.reveal('sceneStage'));
    expect(floorVar()).toBe('OPEN'); // positive control: the reveal opened it
    fireEvent.click(handle());
    expect(floorVar()).toBe('FOLDED'); // the reveal outranked the stored fold the press just wrote
  });
});

describe('a decision queued behind a scroll event is applied once the page is quiet', () => {
  it('a scroll, then a width change inside 150 ms, then silence: the decision lands (no further event needed)', () => {
    jest.useFakeTimers();
    render(<ThemeProvider><Page /></ThemeProvider>);
    setWidth(390);
    act(() => observers.forEach((f) => f())); // baseline width; the page "fits" (jsdom 0 <= 0)
    expect(floorVar()).toBe('OPEN');
    const proto = HTMLElement.prototype;
    Object.defineProperty(proto, 'scrollHeight', { configurable: true, get() { return (this as HTMLElement).hasAttribute('data-layout-resolved') ? 900 : 0; } });
    Object.defineProperty(proto, 'clientHeight', { configurable: true, get() { return (this as HTMLElement).hasAttribute('data-layout-resolved') ? 844 : 0; } });
    act(() => { window.dispatchEvent(new Event('scroll')); jest.advanceTimersByTime(50); });
    setWidth(430);
    act(() => observers.forEach((f) => f()));
    expect(floorVar()).toBe('OPEN'); // held: correct
    act(() => { jest.advanceTimersByTime(FOLD_QUIET_MS + 1); }); // 150 ms after the last scroll: not 5 s, the flush is SCHEDULED
    expect(floorVar()).toBe('FOLDED'); // red if the queue is never flushed
    delete (proto as unknown as Record<string, unknown>).scrollHeight;
    delete (proto as unknown as Record<string, unknown>).clientHeight;
  });
});

describe('positive control: the same sequence WITH one more scroll event after the width change flushes', () => {
  it('a scroll, then a width change inside 150 ms, then ONE MORE scroll: lands', () => {
    jest.useFakeTimers();
    render(<ThemeProvider><Page /></ThemeProvider>);
    setWidth(390);
    act(() => observers.forEach((f) => f())); // baseline width; the page "fits" (jsdom 0 <= 0)
    expect(floorVar()).toBe('OPEN');
    const proto = HTMLElement.prototype;
    Object.defineProperty(proto, 'scrollHeight', { configurable: true, get() { return (this as HTMLElement).hasAttribute('data-layout-resolved') ? 900 : 0; } });
    Object.defineProperty(proto, 'clientHeight', { configurable: true, get() { return (this as HTMLElement).hasAttribute('data-layout-resolved') ? 844 : 0; } });
    act(() => { window.dispatchEvent(new Event('scroll')); jest.advanceTimersByTime(50); });
    setWidth(430);
    act(() => observers.forEach((f) => f()));
    expect(floorVar()).toBe('OPEN'); // held: correct
    act(() => { window.dispatchEvent(new Event('scroll')); jest.advanceTimersByTime(5000); });
    expect(floorVar()).toBe('FOLDED');
    delete (proto as unknown as Record<string, unknown>).scrollHeight;
    delete (proto as unknown as Record<string, unknown>).clientHeight;
  });
});
