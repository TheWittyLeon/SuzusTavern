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
/** A follow waits for a touch to lift and for this long after the window's last scroll event, then runs once (Tora-Gesture C-1). */
export const FOLLOW_SETTLE_MS = 150;
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
