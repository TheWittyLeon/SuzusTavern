/**
 * A9d-2 N5 (Kage A9d-1 I-4; Sora lever brief 2.5) — FIT IS MEASURED. `PlayShell` stamps `data-fit="false"` on the grid when the page scrolls
 * (the row's tracks overflow the viewport) with no safety banner raised, after every commit and on resize; the banner yield
 * (`.grid:not([data-fit='false'])`, Play.module.css) reads the stamp. No shell rule names a viewport height.
 *
 * jsdom has no layout (scrollHeight / clientHeight read 0), so each case plants the two numbers on the grid element and lets the shell
 * measure; the stamp is therefore absent in every other suite, which is what keeps them unchanged. The browser half is the harness's
 * y:fitFlag (the stamp agrees with the document, and with the banner-less twin once the banner is up) at 430x740.
 */
import { act, render } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { ReactNode } from 'react';
import PlayShell from '@/app/play/[sessionId]/PlayShell';
import { LAYOUT_ROWS_BY_ID, type LayoutRow } from '@/app/play/[sessionId]/presets';

const phone = LAYOUT_ROWS_BY_ID.phone;

function mount(row: LayoutRow = phone, banner: ReactNode = null) {
  const view = render(<PlayShell row={row} moment="exploring" regions={{ safetyBanner: banner }} tenants={{}} />);
  const grid = () => view.container.querySelector('[data-layout-resolved]') as HTMLElement;
  const measure = (scrollHeight: number, clientHeight: number) => {
    Object.defineProperty(grid(), 'scrollHeight', { configurable: true, value: scrollHeight });
    Object.defineProperty(grid(), 'clientHeight', { configurable: true, value: clientHeight });
  };
  const resize = () => act(() => { window.dispatchEvent(new Event('resize')); });
  const withBanner = (b: ReactNode) => view.rerender(<PlayShell row={row} moment="exploring" regions={{ safetyBanner: b }} tenants={{}} />);
  return { grid, measure, resize, withBanner };
}

describe('PlayShell stamps data-fit="false" when the page scrolls', () => {
  it('jsdom (no layout: 0 and 0): no stamp, so every other suite is unchanged', () => {
    expect(mount().grid()).not.toHaveAttribute('data-fit');
  });

  it('a page that scrolls (the grid\'s content is taller than its box by more than 1px) is stamped on the next resize; one that fits is not', () => {
    const m = mount();
    m.measure(774, 740);
    m.resize();
    expect(m.grid()).toHaveAttribute('data-fit', 'false');
    m.measure(740, 740);
    m.resize();
    expect(m.grid()).not.toHaveAttribute('data-fit');
  });

  it('within 1px is a fit (sub-pixel layout and the scrollbar rounding), 2px is not', () => {
    const m = mount();
    m.measure(741, 740);
    m.resize();
    expect(m.grid()).not.toHaveAttribute('data-fit');
    m.measure(742, 740);
    m.resize();
    expect(m.grid()).toHaveAttribute('data-fit', 'false');
  });

  it('is measured after every COMMIT, not only on resize: a re-render re-reads the grid', () => {
    const m = mount();
    m.measure(900, 844);
    m.withBanner(null); // any commit
    expect(m.grid()).toHaveAttribute('data-fit', 'false');
    m.measure(844, 844);
    m.withBanner(null);
    expect(m.grid()).not.toHaveAttribute('data-fit');
  });

  it('with the banner UP the stamp is not re-measured (the yield changes the answer): the last stamp stands, both ways', () => {
    const m = mount();
    m.measure(774, 740);
    m.resize();
    expect(m.grid()).toHaveAttribute('data-fit', 'false');
    // the banner comes up; the squeezed page now reads as fitting, which must not clear the stamp
    m.measure(740, 740);
    m.withBanner(<div>A safety signal was raised</div>);
    m.resize();
    expect(m.grid()).toHaveAttribute('data-fit', 'false');
    // and a page that FIT before the banner is not stamped by the banner's own overflow
    const n = mount();
    n.measure(740, 740);
    n.resize();
    n.measure(800, 740);
    n.withBanner(<div>A safety signal was raised</div>);
    n.resize();
    expect(n.grid()).not.toHaveAttribute('data-fit');
  });

  it('the banner coming down re-measures at once (the next commit)', () => {
    const m = mount(phone, <div>raised</div>);
    m.measure(800, 740);
    m.resize();
    expect(m.grid()).not.toHaveAttribute('data-fit'); // banner up: not measured
    m.withBanner(null);
    expect(m.grid()).toHaveAttribute('data-fit', 'false');
  });

  it('is the shell\'s own, for every row: the desktop rows stamp too (their yield names no row)', () => {
    const m = mount(LAYOUT_ROWS_BY_ID.table);
    m.measure(1000, 900);
    m.resize();
    expect(m.grid()).toHaveAttribute('data-fit', 'false');
  });
});

describe('PlayShell stamps data-scroll-cue from the row', () => {
  it('the phone row says scrollCue; the desktop rows do not', () => {
    expect(mount(LAYOUT_ROWS_BY_ID.phone).grid()).toHaveAttribute('data-scroll-cue');
    expect(mount(LAYOUT_ROWS_BY_ID.story).grid()).not.toHaveAttribute('data-scroll-cue');
    expect(mount(LAYOUT_ROWS_BY_ID.table).grid()).not.toHaveAttribute('data-scroll-cue');
  });
});
