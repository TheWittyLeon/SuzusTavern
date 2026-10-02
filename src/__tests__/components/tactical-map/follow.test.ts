/**
 * follow.ts — the follow rule (B8c-3 M1/M1.1; Sora's mount brief 2.3-2.4, Iro-A11y's condition on keep-in-view):
 *   - a square wholly inside the window scrolls NOTHING (neither offset moves, not even by a pixel);
 *   - otherwise each axis that needs it scrolls by the FEWEST WHOLE SQUARES that bring the square inside it, and an axis that already holds it does not move;
 *   - never centred; a scroll the board's end clamps is not whole.
 * Pure: boxes in, offsets out. The component test (TacticalMap.window.test.tsx) pins that the turn change and focus both call it.
 */
import { followScroll, type WindowMetrics } from '@/components/tactical-map/follow';

/** A 200x120 window at (10,10) over a 400x400 board of 40px squares. */
const win = (o: Partial<WindowMetrics> = {}): WindowMetrics => ({
  view: { left: 10, top: 10, width: 200, height: 120 }, scrollLeft: 0, scrollTop: 0, maxLeft: 200, maxTop: 280, ...o,
});
/** The square at board column x, row y, as the browser would lay it out at the window's current scroll. */
const square = (x: number, y: number, w: WindowMetrics = win(), size = 40) => ({ left: w.view.left + x * size - w.scrollLeft, top: w.view.top + y * size - w.scrollTop, width: size, height: size });

describe('followScroll — a square in view scrolls nothing', () => {
  it('wholly inside: null (both offsets are the caller\'s to leave alone)', () => {
    expect(followScroll(win(), square(2, 1))).toBeNull();
    expect(followScroll(win({ scrollLeft: 80, scrollTop: 40 }), square(4, 2, win({ scrollLeft: 80, scrollTop: 40 })))).toBeNull();
  });

  it('flush against every edge is still inside: the first and last visible column and row', () => {
    expect(followScroll(win(), square(0, 0))).toBeNull();
    expect(followScroll(win(), square(4, 2))).toBeNull(); // x 160..200 of 0..200, y 80..120 of 0..120
  });

  it('a partial offset the user scrolled to (wheel, trackpad) is respected when the square is inside', () => {
    const w = win({ scrollLeft: 17, scrollTop: 9 });
    expect(followScroll(w, square(2, 1, w))).toBeNull();
  });
});

describe('followScroll — otherwise the fewest whole squares, on the axis that needs it', () => {
  it('one square past the right edge: one square (40), not centred (which would be 100) and not the whole overflow', () => {
    expect(followScroll(win(), square(5, 1))).toEqual({ left: 40, top: 0 });
  });

  it('a square far past the right edge: exactly enough squares that its far edge is at the window\'s (7 -> x 280..320, 120 over: 3 squares)', () => {
    expect(followScroll(win(), square(7, 1))).toEqual({ left: 120, top: 0 });
  });

  it('below the bottom edge moves the vertical axis only (6 -> y 240..280 over a 120 window: 160 more, 4 squares)', () => {
    expect(followScroll(win(), square(2, 6))).toEqual({ left: 0, top: 160 });
  });

  it('past a corner moves both axes, each by what it needs', () => {
    expect(followScroll(win(), square(8, 7))).toEqual({ left: 160, top: 200 }); // x 320..360 over 200: 160; y 280..320 over 120: 200
  });

  it('before the start edge moves back by whole squares: scrolled to 120, a square at board x 50..90 (a partial scroll) is brought in at 40', () => {
    const w = win({ scrollLeft: 120 });
    expect(followScroll(w, { left: -70, top: 10, width: 40, height: 40 })).toEqual({ left: 40, top: 0 });
  });

  it('before the start edge, on a whole-square scroll: back exactly to the square\'s own column', () => {
    const w = win({ scrollLeft: 120, scrollTop: 80 });
    expect(followScroll(w, square(1, 1, w))).toEqual({ left: 40, top: 40 });
  });

  it('a partial offset snaps to a whole square when it must move (17 + 23 over = 40)', () => {
    const w = win({ scrollLeft: 17 });
    expect(followScroll(w, square(5, 0, w))).toEqual({ left: 40, top: 0 });
  });

  it('an axis that already holds the square does not move, even when the other one does', () => {
    const w = win({ scrollTop: 40 });
    const r = followScroll(w, square(6, 2, w));
    expect(r).toEqual({ left: 80, top: 40 }); // top is the caller's own offset, returned unchanged
  });
});

describe('followScroll — the ends of the board clamp (not whole, and never past the end)', () => {
  it('a clamped scroll is the end of the board', () => {
    expect(followScroll(win({ maxLeft: 100 }), square(7, 1))).toEqual({ left: 100, top: 0 });
    expect(followScroll(win({ maxTop: 150 }), square(2, 6))).toEqual({ left: 0, top: 150 });
  });

  it('never below zero', () => {
    const w = win({ scrollLeft: 20 });
    expect(followScroll(w, { left: -100, top: 10, width: 40, height: 40 })).toEqual({ left: 0, top: 0 });
  });

  it('a board that does not overflow (max 0) never scrolls, whatever the box says', () => {
    expect(followScroll(win({ maxLeft: 0, maxTop: 0 }), square(7, 7))).toBeNull();
  });
});

describe('followScroll — never centred; no size, no snap', () => {
  it('the result is not the centring answer for any of these squares', () => {
    for (const [x, y] of [[5, 1], [7, 1], [2, 6], [8, 7]] as const) {
      const r = followScroll(win(), square(x, y));
      const centre = { left: x * 40 + 20 - 100, top: y * 40 + 20 - 60 };
      expect(r).not.toBeNull();
      expect(r!.left === Math.max(0, centre.left) && r!.top === Math.max(0, centre.top)).toBe(false);
    }
  });

  it('jsdom has no layout (size 0): the raw delta is used and nothing divides by zero', () => {
    const r = followScroll(win(), { left: 300, top: 10, width: 0, height: 0 });
    expect(r).toEqual({ left: 90, top: 0 });
  });
});
