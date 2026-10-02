/**
 * follow.ts — the follow rule (B8c-3 M1/M1.1; Sora's mount brief 2.3-2.4, Iro-A11y's condition on keep-in-view):
 *   - a square wholly inside the window scrolls NOTHING (neither offset moves, not even by a pixel);
 *   - otherwise each axis that needs it scrolls by the FEWEST WHOLE SQUARES that bring the square inside it, and an axis that already holds it does not move;
 *   - never centred; a scroll the board's end clamps is not whole.
 * Pure: boxes in, offsets out. The component test (TacticalMap.window.test.tsx) pins that the turn change and focus both call it.
 */
import { followScroll, followAll, followTurn, wholeSquareCap, panningWidthCap, FOLLOW_MARGIN_PROPERTY, FOLLOW_SETTLE_MS, SLIVER_MIN_PX, type WindowMetrics } from '@/components/tactical-map/follow';

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

describe('followScroll — whole squares in a window that is not a whole number of squares (the real one: 980 / 34 = 28.8)', () => {
  // 190 x 110 window over 40px squares: 4.75 x 2.75 squares visible. maxLeft/maxTop generous, so no clamp interferes.
  const w = (o: Partial<WindowMetrics> = {}): WindowMetrics => ({ view: { left: 10, top: 10, width: 190, height: 110 }, scrollLeft: 0, scrollTop: 0, maxLeft: 400, maxTop: 400, ...o });

  it('past the end: the offset is a whole number of squares AND the square is wholly inside afterwards (a cut-off square, or a half-square offset, is red)', () => {
    for (const x of [5, 6, 9]) {
      const m = w();
      const to = followScroll(m, square(x, 0, m))!;
      expect(to.left % 40).toBe(0); // whole squares from the board's start
      expect(to.left + 190).toBeGreaterThanOrEqual((x + 1) * 40); // the square's far edge is inside: not cut
      expect(to.left + 190 - (x + 1) * 40).toBeLessThan(40); // and it is the FEWEST: one square less would cut it
    }
  });

  it('before the start: whole squares, and the square starts inside', () => {
    const m = w({ scrollLeft: 130, scrollTop: 90 }); // arrived by wheel: not whole
    expect(followScroll(m, square(0, 0, m))).toEqual({ left: 0, top: 0 });
    const m2 = w({ scrollLeft: 130, scrollTop: 90 });
    const to2 = followScroll(m2, square(1, 1, m2))!;
    expect(to2.left % 40).toBe(0);
    expect(to2.top % 40).toBe(0);
    expect(to2.left).toBeLessThanOrEqual(40);
    expect(to2.top).toBeLessThanOrEqual(40);
  });
});

// ── P2: the margin (Iro-A11y ruling 3, accepted in its narrow form) ───────────────────────────────────────────────────────────────────
describe('followScroll — the margin: one square around the followed one stays in view; the square whole outranks it', () => {
  it('named values live in one place: the property the mount sets, the settle delay and the sliver threshold', () => {
    expect(FOLLOW_MARGIN_PROPERTY).toBe('--tm-follow-margin');
    expect(FOLLOW_SETTLE_MS).toBe(150);
    expect(SLIVER_MIN_PX).toBe(8);
  });

  it('margin 0 is the default and is byte-for-byte today: every case above, asked with an explicit 0', () => {
    const cases: [WindowMetrics, number, number][] = [[win(), 5, 1], [win(), 7, 1], [win(), 2, 6], [win(), 8, 7], [win({ scrollLeft: 80, scrollTop: 40 }), 4, 2], [win({ maxLeft: 100 }), 7, 1]];
    for (const [w, x, y] of cases) expect(followScroll(w, square(x, y, w), 0)).toEqual(followScroll(w, square(x, y, w)));
  });

  it('a square in view but touching the edge is brought one square in from it (the window shows columns 0-4: a mover at column 4 wants column 5 too)', () => {
    expect(followScroll(win(), square(4, 1), 1)).toEqual({ left: 40, top: 0 });
    expect(followScroll(win(), square(4, 1))).toBeNull(); // margin 0: wholly in view, nothing moves
  });

  it('a square with its margin in view scrolls nothing', () => {
    expect(followScroll(win(), square(2, 1), 1)).toBeNull();
  });

  it('works on both axes and at both edges', () => {
    const w = win({ scrollLeft: 80, scrollTop: 80 });
    expect(followScroll(w, square(2, 2, w), 1)).toEqual({ left: 40, top: 40 }); // the first visible column and row: back one square each
    expect(followScroll(win(), square(4, 2), 1)).toEqual({ left: 40, top: 40 }); // the last visible column and row: on one square each
  });

  it('the board\'s own end is not a reason to move: at scroll 0 a mover in column 0 has no board before it to show', () => {
    expect(followScroll(win(), square(0, 0), 1)).toBeNull();
    expect(followScroll(win({ scrollLeft: 200, scrollTop: 280 }), square(9, 9, win({ scrollLeft: 200, scrollTop: 280 })), 1)).toBeNull();
  });

  it('THE SQUARE WHOLE OUTRANKS THE MARGIN: a 3-square window holds the margin; a 2-square one cannot, so the margin drops and the answer is margin 0\'s', () => {
    const three = win({ view: { left: 10, top: 10, width: 200, height: 120 } });
    expect(followScroll(three, square(1, 2, three), 1)).toEqual({ left: 0, top: 40 }); // row 2 is the window's last row: one square on
    const two = win({ view: { left: 10, top: 10, width: 200, height: 80 } });
    expect(followScroll(two, square(1, 4, two), 1)).toEqual(followScroll(two, square(1, 4, two), 0));
    const narrow = win({ view: { left: 10, top: 10, width: 70, height: 120 } }); // 1.75 squares across
    for (const x of [1, 4, 5]) {
      const to = followScroll(narrow, square(x, 0, narrow), 1)!;
      expect(to.left).toBe(followScroll(narrow, square(x, 0, narrow), 0)!.left);
      expect(to.left <= x * 40 && x * 40 + 40 <= to.left + 70).toBe(true); // wholly in the window
    }
  });

  it('a window under 3 squares never leaves the square cut, whatever the margin asked', () => {
    for (const size of [41, 60, 79, 80, 100]) {
      const w = win({ view: { left: 10, top: 10, width: 200, height: size } });
      for (let y = 0; y <= 6; y++) { // the board's end (maxTop 280) clamps the rest
        const top = followScroll(w, square(0, y, w), 5)?.top ?? 0;
        expect(top <= y * 40 && y * 40 + 40 <= top + size).toBe(true);
      }
    }
  });

  it('followAll: the first target wins a conflict (a focused square, then the mover): a later follow that would cut an earlier square is not taken', () => {
    const w = win();
    const focused = { box: square(0, 0, w), margin: 0 };
    const mover = { box: square(7, 0, w), margin: 0 }; // needs left 120, which would hide column 0
    expect(followAll(w, [focused, mover])).toBeNull();
    expect(followAll(w, [mover, focused])).toEqual({ left: 120, top: 0 }); // the order is the priority: the mover first is taken, and the focused square, asked second, cannot take it back
  });

  it('followAll: with no conflict both are taken, and the second is measured from where the first left the window', () => {
    const w = win();
    const a = { box: square(5, 0, w), margin: 0 }; // wants left 40
    const b = { box: square(6, 0, w), margin: 0 }; // from 40 it wants 80 and keeps a (column 5 is at x 200..240, the window shows 80..280)
    expect(followAll(w, [a, b])).toEqual({ left: 80, top: 0 });
  });
});

describe('wholeSquareCap — the sliver rule: a cut square under 8 px ends the window on the whole one (Aoi-UI section 15)', () => {
  it('a remainder of 1 px ends on the whole row (the 430x740 phone: "3 + 1 px"); one of 15 does not', () => {
    expect(wholeSquareCap(91, 30, 210)).toBe(90);
    expect(wholeSquareCap(195, 30, 210)).toBeNull(); // 6 rows and a 15 px sliver: kept (it is the cue)
  });

  it('the boundary: 7.9 px is cut, 8 px is not', () => {
    expect(wholeSquareCap(97.9, 30, 210)).toBe(90);
    expect(wholeSquareCap(98, 30, 210)).toBeNull();
  });

  it('a whole number of squares, a board that fits, and a room under one square are used as they are', () => {
    expect(wholeSquareCap(90, 30, 210)).toBeNull();
    expect(wholeSquareCap(121, 40, 120)).toBeNull(); // the board is shorter than the room: nothing is cut
    expect(wholeSquareCap(121, 40, 121)).toBeNull(); // the board exactly fills it
    expect(wholeSquareCap(33, 40, 400)).toBeNull(); // 33 px of a 40 px square: a cap would be 0
    expect(wholeSquareCap(5, 40, 400)).toBeNull();
  });

  it('no layout (a zero square or room) never caps', () => {
    expect(wholeSquareCap(100, 0, 400)).toBeNull();
    expect(wholeSquareCap(0, 30, 400)).toBeNull();
  });
});

describe('followScroll — a board that starts a guard in (16 px) snaps the scroll-back DOWN to a whole square from the board\'s start', () => {
  it('column 1 of a board 16 px in, window 360, offset 60 -> 30: rounding to the nearest would give 60 and leave column 1 cut by 14 px', () => {
    const w = { view: { left: 0, top: 0, width: 360, height: 90 }, scrollLeft: 60, scrollTop: 0, maxLeft: 100, maxTop: 0 };
    expect(followScroll(w, { left: 16 + 30 - 60, top: 0, width: 30, height: 30 })).toEqual({ left: 30, top: 0 });
  });
});

describe('panningWidthCap — both cut columns of a guarded, panning board are 0 or at least 8 px (QA F2b: 393 wide showed a 3 px sliver at the board\'s end)', () => {
  const S = 30;
  const BOARD = 15 * S;
  const cuts = (w: number, guard: number) => ({ far: (((w - guard) % S) + S) % S, near: ((w % S) + S) % S });
  const fine = (r: number) => r === 0 || r >= SLIVER_MIN_PX;

  it('guard 16, cell 30, every room 240..470: both cuts fine after the cap; never shorter than the one-sided cap by more than a column; never longer than the room', () => {
    for (let room = 240; room <= 470; room++) {
      const cap = panningWidthCap(room, S, 20 * S, 16);
      const w = cap ?? room;
      expect(w).toBeLessThanOrEqual(room);
      const { far, near } = cuts(w, 16);
      expect(fine(far)).toBe(true);
      expect(fine(near)).toBe(true);
      const one = wholeSquareCap(room - 16, S, 20 * S);
      const oneW = one === null ? room : one + 16;
      expect(oneW - w).toBeLessThan(S);
    }
  });

  it('393 (the iPhone 15 and 16 width) is capped, because the one-sided cap leaves a 3 px column at the start edge at scroll max', () => {
    const cap = panningWidthCap(393, S, BOARD * 2, 16);
    expect(cap).not.toBeNull();
    expect(cuts(393, 16).near).toBe(3); // the control: the room alone is the defect
    expect(wholeSquareCap(393 - 16, S, BOARD * 2)).toBeNull(); // the one-sided cap sees a 17 px far cut and does nothing
  });

  it('with no guard it is today\'s cap, for every room and both fits and cuts', () => {
    for (let room = 100; room <= 470; room += 0.5) expect(panningWidthCap(room, S, 20 * S, 0)).toBe(wholeSquareCap(room, S, 20 * S));
  });

  it('a board that fits, no layout, and a room under a column are never capped', () => {
    expect(panningWidthCap(400, S, 300, 16)).toBeNull();
    expect(panningWidthCap(400, 0, 600, 16)).toBeNull();
    expect(panningWidthCap(0, S, 600, 16)).toBeNull();
    expect(panningWidthCap(20, S, 600, 16)).toBeNull();
  });
});

describe('followTurn — a turn change ends with the mover whole; the held square is kept when both fit, the margin giving way first; the mover wins when they cannot both fit', () => {
  const w = (o: Partial<WindowMetrics> = {}): WindowMetrics => ({ view: { left: 10, top: 10, width: 200, height: 120 }, scrollLeft: 0, scrollTop: 0, maxLeft: 200, maxTop: 280, ...o });
  it('no held square: the mover\'s own follow, margin and all', () => {
    expect(followTurn(w(), null, square(6, 0), 0)).toEqual({ left: 80, top: 0 });
    expect(followTurn(w(), null, square(6, 0), 1)).toEqual({ left: 120, top: 0 });
    expect(followTurn(w(), null, square(2, 1), 0)).toBeNull();
  });
  it('both fit: the offset holds both', () => {
    expect(followTurn(w(), square(2, 0), square(6, 0), 0)).toEqual({ left: 80, top: 0 });
  });
  it('the margin gives way before the held square: margin 1 alone would go to 120 and cut column 2', () => {
    expect(followTurn(w(), square(2, 0), square(6, 0), 1)).toEqual({ left: 80, top: 0 });
  });
  it('they cannot both fit: the MOVER wins, by its own follow from where the window IS (either axis)', () => {
    expect(followTurn(w(), square(0, 0), square(6, 0), 0)).toEqual({ left: 80, top: 0 });
    expect(followTurn(w(), square(0, 0), square(0, 6), 0)).toEqual({ left: 0, top: 160 });
  });
  it('a held square the user scrolled away from is not a reason to jump to it when the mover cannot be held with it', () => {
    const m = w({ scrollLeft: 120 });
    expect(followTurn(m, square(0, 0, m), square(9, 0, m), 0)).toEqual({ left: 200, top: 0 });
  });
  it('the mover already whole and the held square in view: nothing moves', () => {
    expect(followTurn(w(), square(0, 0), square(3, 1), 0)).toBeNull();
  });
});
