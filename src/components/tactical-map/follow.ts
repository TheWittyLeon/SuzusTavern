// src/components/tactical-map/follow.ts
//
// The follow rule (B8c-3, Sora's mount brief 2.3/2.4, Iro-A11y's ruling on keep-in-view): where the board window must scroll for one square to be seen. ONE function, used by the
// turn change (the active creature) and by focus (an arrow key onto a square), so the two can never disagree about what "in view" means.
//
//   - A square wholly inside the window scrolls nothing. Neither offset moves: a turn that passes between two creatures in view is not a reason to move the board.
//   - Otherwise each axis that needs it scrolls by the FEWEST WHOLE SQUARES that bring the square inside it; an axis that already holds the square does not move.
//   - Never centred (T4 was ruled for the phone: centring every turn would hop board 1110 a row each time the turn passes between row 0 and row 4).
//   - A scroll the board's end clamps is not whole, and is not asked to be.
//
// Pure: boxes in, a target offset out. The caller sets the window's own `scrollLeft` / `scrollTop` (at once: the stylesheet never asks for smooth scrolling) and never
// `scrollIntoView`, which walks every scrollable ancestor including the page (Tora-Gesture MAJOR-1).

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
function followAxis(scroll: number, max: number, start: number, end: number, size: number, viewStart: number, viewEnd: number): number {
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
 * The offsets that bring `cell` into view, or null when nothing needs to move. Whole squares are of the cell's own size on each axis.
 */
export function followScroll(win: WindowMetrics, cell: Box): { left: number; top: number } | null {
  const left = followAxis(win.scrollLeft, win.maxLeft, cell.left, cell.left + cell.width, cell.width, win.view.left, win.view.left + win.view.width);
  const top = followAxis(win.scrollTop, win.maxTop, cell.top, cell.top + cell.height, cell.height, win.view.top, win.view.top + win.view.height);
  return left === win.scrollLeft && top === win.scrollTop ? null : { left, top };
}
