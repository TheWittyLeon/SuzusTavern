// src/components/tactical-map/follow.ts
//
// The follow rule (B8c-3, Sora's mount brief 2.3/2.4, Iro-A11y's ruling on keep-in-view): where the board window must scroll for one square to be seen. ONE function, used by the
// turn change (the active creature) and by focus (an arrow key onto a square), so the two can never disagree about what "in view" means.
//
//   - A square wholly inside the window scrolls nothing. Neither offset moves: a turn that passes between two creatures in view is not a reason to move the board.
//   - Otherwise each axis that needs it scrolls by the FEWEST WHOLE SQUARES that bring the square inside it; an axis that already holds the square does not move.
//   - Never centred (T4 was ruled for the phone: centring every turn would hop board 1110 a row each time the turn passes between row 0 and row 4).
//   - A scroll the board's end clamps is not whole, and is not asked to be.
//   - A MARGIN (Iro-A11y, accepted in a narrow form): the map's own follows (a turn, a landed move, a window that gets a box) keep `margin` squares around the square in view too.
//     The square wholly in the window outranks the margin: on an axis too small to hold the square and both margins, the margin is 0. Focus, arrows and taps ask for margin 0.
//
// Pure: boxes in, a target offset out. The caller sets the window's own `scrollLeft` / `scrollTop` (at once: the stylesheet never asks for smooth scrolling) and never
// `scrollIntoView`, which walks every scrollable ancestor including the page (Tora-Gesture MAJOR-1).

/** The custom property the mount sets, in whole squares (default 0): how many squares around the followed one stay in view on the map's OWN follows. */
export const FOLLOW_MARGIN_PROPERTY = '--tm-follow-margin';
/** The custom property the mount sets: how far in from the start edge a board that PANS sideways starts (default 0). */
export const EDGE_GUARD_PROPERTY = '--tm-edge-guard';
/** A follow waits for a touch to lift and for this long after the window's last scroll event, then runs once (Tora-Gesture C-1). */
export const FOLLOW_SETTLE_MS = 150;
/** A touch that never reports its end (its target was removed under the finger, the browser lost it) releases the follow gate after this long (Tora-Gesture 1a). A real pan keeps the scroll settle busy on its own. */
export const TOUCH_BACKSTOP_MS = 5000;
/** A cut row or column that would show fewer pixels than this is not shown: the window ends on the whole one (Aoi-UI's sliver rule). */
export const SLIVER_MIN_PX = 8;

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface WindowMetrics {
  /** The window's visible box in the viewport: its rect's origin and its CLIENT size (a classic scrollbar is not part of what is visible). */
  view: Box;
  scrollLeft: number;
  scrollTop: number;
  /** `scrollWidth - clientWidth` and `scrollHeight - clientHeight`: how far each axis can go. */
  maxLeft: number;
  maxTop: number;
}

/** One axis. `start`/`end` are the square's edges and `viewStart`/`viewEnd` the window's, in the same (viewport) coordinates. Returns the new offset. */
// debt: snaps to whole squares counted from the board's start, not from the edge guard's origin (the guard is the board's inline-start margin, so a guarded board may scroll up to one square further than the fewest). ceiling: a board that pans sideways with a guard stamped. until: a guarded board is seen to jump a whole extra square in the harness's board-pan leg or on a device.
function followAxis(scroll: number, max: number, start: number, end: number, size: number, viewStart: number, viewEnd: number, margin: number): number {
  // the margin only where the window can hold the square AND a margin on both sides; otherwise the square whole wins and the margin is 0
  const pad = size > 0 && margin > 0 && size * (1 + 2 * margin) <= viewEnd - viewStart ? margin * size : 0;
  start -= pad;
  end += pad;
  if (start >= viewStart && end <= viewEnd) return scroll;
  // the square's offset on the board is `scroll + (start - viewStart)`; snap to a whole square when the square has a size (jsdom has none)
  if (start < viewStart) {
    const want = scroll + (start - viewStart);
    return Math.max(0, size > 0 ? Math.floor(want / size) * size : want);
  }
  const want = scroll + (end - viewEnd);
  return Math.min(Math.max(0, max), size > 0 ? Math.ceil(want / size) * size : want);
}

/**
 * The offsets that bring `cell` (and `margin` squares around it) into view, or null when nothing needs to move. Whole squares are of the cell's own size on each axis.
 */
export function followScroll(win: WindowMetrics, cell: Box, margin = 0): { left: number; top: number } | null {
  const left = followAxis(win.scrollLeft, win.maxLeft, cell.left, cell.left + cell.width, cell.width, win.view.left, win.view.left + win.view.width, margin);
  const top = followAxis(win.scrollTop, win.maxTop, cell.top, cell.top + cell.height, cell.height, win.view.top, win.view.top + win.view.height, margin);
  return left === win.scrollLeft && top === win.scrollTop ? null : { left, top };
}

export interface FollowTarget {
  /** The square's box in the viewport, at the window's CURRENT scroll. */
  box: Box;
  margin: number;
}

/**
 * Several squares, in priority order (a square the user holds focus on, then the mover). Each is followed from where the window was left by the one before; a follow that would
 * cut a square an EARLIER target already holds is not taken (the earlier one is what the user is on). Null when nothing needs to move.
 */
export function followAll(win: WindowMetrics, targets: FollowTarget[]): { left: number; top: number } | null {
  let at = { left: win.scrollLeft, top: win.scrollTop };
  targets.forEach((t, i) => {
    const shift = (b: Box, from: { left: number; top: number }): Box => ({ ...b, left: b.left + win.scrollLeft - from.left, top: b.top + win.scrollTop - from.top });
    const next = followScroll({ ...win, scrollLeft: at.left, scrollTop: at.top }, shift(t.box, at), t.margin);
    if (!next) return;
    const keepsEarlier = targets.slice(0, i).every((e) => followScroll({ ...win, scrollLeft: next.left, scrollTop: next.top }, shift(e.box, next)) === null);
    if (keepsEarlier) at = next;
  });
  return at.left === win.scrollLeft && at.top === win.scrollTop ? null : at;
}

/**
 * The follow for a TURN CHANGE. The turn is the event, so the mover must end wholly in view; the square the user holds focus on is kept in view WHEN BOTH FIT.
 *   1. the held square first, then the mover with its margin (`followAll`): taken when the mover ends whole;
 *   2. else the same with margin 0 (the margin gives way before the held square does);
 *   3. else the two cannot both be in the window: the MOVER wins, by its own fewest-squares follow from where the window is. DOM focus is not moved; the user's next arrow key
 *      follows the held square back.
 * A re-follow with no turn passing (the window got a box, its width changed) is not this: there the user's square comes first (`followAll`). Null when nothing needs to move.
 */
export function followTurn(win: WindowMetrics, held: Box | null, mover: Box, margin = 0): { left: number; top: number } | null {
  const moverWhole = (to: { left: number; top: number } | null): boolean => {
    const at = to ?? { left: win.scrollLeft, top: win.scrollTop };
    return followScroll({ ...win, scrollLeft: at.left, scrollTop: at.top }, { ...mover, left: mover.left + win.scrollLeft - at.left, top: mover.top + win.scrollTop - at.top }) === null;
  };
  if (held) {
    for (const m of margin > 0 ? [margin, 0] : [0]) {
      const to = followAll(win, [{ box: held, margin: 0 }, { box: mover, margin: m }]);
      if (moverWhole(to)) return to;
    }
  }
  return followScroll(win, mover, margin);
}

/**
 * The sliver rule (Aoi-UI section 15), one axis: where the board is longer than the room and the cut square would show fewer than SLIVER_MIN_PX, the window ends on the whole
 * square before it, and the few pixels left over are the stage's. Returns the window's length on that axis, or null when the room is used as it is (the board fits; the cut
 * square is a real one, a whole number of squares fit exactly, or less than one square fits at all, where a cap would leave nothing to see).
 */
export function wholeSquareCap(room: number, square: number, board: number): number | null {
  if (!(square > 0) || !(room > 0) || board <= room) return null;
  const whole = Math.floor(room / square);
  const cut = room - whole * square;
  return whole >= 1 && cut > 0 && cut < SLIVER_MIN_PX ? whole * square : null;
}

/**
 * The sliver rule for the WIDTH of a board that pans with an edge guard (QA F2/F2b). The window shows the board from `guard` in at scroll 0 and ends flush with its far end at scroll
 * max, so it has two cut columns: at scroll 0 the far edge shows `(W - guard) mod square`, and at scroll max the near edge shows `W mod square` (the board is a whole number of
 * squares). A one-sided cap fixes the first and leaves the second at, say, 3 px (393 wide, guard 16, square 30). This returns the largest width at or below `room` where BOTH cuts
 * are 0 or at least SLIVER_MIN_PX, or null when the room already is one (or the board fits it). With no guard the two cuts are one and this is `wholeSquareCap`.
 * It only ever shortens the window, by under one square in practice (each step removes a cut that was under SLIVER_MIN_PX); where it cannot settle it returns the one-sided answer.
 */
export function panningWidthCap(room: number, square: number, board: number, guard: number): number | null {
  if (!(square > 0) || !(room > 0) || board <= room) return null;
  const EPS = 1e-6;
  const bad = (r: number) => r > EPS && r < SLIVER_MIN_PX - EPS;
  const mod = (v: number) => ((v % square) + square) % square;
  let w = room;
  for (let i = 0; i < 6; i++) {
    const far = mod(w - guard);
    const near = mod(w);
    if (!bad(far) && !bad(near)) return w === room ? null : w;
    w -= bad(far) ? far : near;
    if (w < guard + square) break;
  }
  const one = wholeSquareCap(room - guard, square, board);
  return one === null ? null : one + guard;
}
