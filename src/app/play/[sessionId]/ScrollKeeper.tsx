'use client';

/**
 * TAV-PLAY-SHELL A9c C3 (build brief §3.1, Amendment C.3) — scroll survives a
 * slot move.
 *
 * When the layout row or moment changes, React MOVES keyed slots in the DOM
 * (`insertBefore`), and a browser resets a detached-and-reinserted scroller
 * to 0: the chat log jumped to the top on Auto start and on every breakpoint
 * crossing (Kage A9b IMPORTANT-1, measured 228 -> 0). `ScrollKeeper` snapshots
 * every scroller under the shell BEFORE the commit and restores it after.
 *
 * It names no region: it walks `[data-region-slot]` and everything inside, so
 * it also covers a scroller we haven't met yet (the tenth region, the picker
 * switch). It is a class because `getSnapshotBeforeUpdate` is React's one hook
 * for "capture DOM state before it changes"; no function hook runs before the
 * DOM mutation.
 *
 * `orderKey` is the precise trigger for a move: it changes only when the slot
 * order (or a hosting) changes, so on an ordinary keystroke render the
 * snapshot returns `null` and the DOM walk never runs. The browser harness
 * transitions (`t2-breakpoint`, `t3-auto-combat-start`) are the real pin;
 * `snapshotScroll`/`restoreScroll` are pure and unit-tested in jsdom.
 */
import { Component, type ReactNode, type RefObject } from 'react';

/** Within this many px of the end counts as "at the end" (sub-pixel scroll). */
const AT_END_SLOP = 2;

export interface ScrollSnapshotEntry {
  el: HTMLElement;
  top: number;
  left: number;
  /** Scrolled to the end: restored to the END of the new box, not to `top`. */
  atEnd: boolean;
}

/** Records every scrolled element under a region slot. */
export function snapshotScroll(root: HTMLElement | null): ScrollSnapshotEntry[] {
  if (!root) return [];
  const out: ScrollSnapshotEntry[] = [];
  const els = root.querySelectorAll<HTMLElement>('[data-region-slot], [data-region-slot] *');
  for (const el of els) {
    if (el.scrollTop > 0 || el.scrollLeft > 0) {
      out.push({
        el,
        top: el.scrollTop,
        left: el.scrollLeft,
        atEnd: el.scrollHeight - el.clientHeight - el.scrollTop <= AT_END_SLOP,
      });
    }
  }
  return out;
}

/** Puts a snapshot back. Elements that left the document are skipped. A
 *  changed value fires a real `scroll` event, which is what re-syncs
 *  ChatLog's `atBottom` flag. */
export function restoreScroll(snapshot: ScrollSnapshotEntry[]): void {
  for (const { el, top, left, atEnd } of snapshot) {
    if (!el.isConnected) continue;
    // INSTANT, whatever the element's own `scroll-behavior`. The story log carries `scroll-behavior: smooth`, and assigning `scrollTop` on such an
    // element starts an ANIMATION that the next layout cancels (A9d-2 fix round 4, Kage I-D: part-way 185 -> 0 at a fight's start, a pinned log
    // visiting 0, 69px short at a fight's end; motion allowed only). A restore is a correction of where the user already was, never a scroll.
    const before = el.style.scrollBehavior;
    el.style.scrollBehavior = 'auto';
    el.scrollTop = atEnd ? el.scrollHeight : top;
    el.scrollLeft = left;
    el.style.scrollBehavior = before;
  }
}

interface ScrollKeeperProps {
  /** Changes exactly when a slot moves (the shell passes the joined slot order). */
  orderKey: string;
  rootRef: RefObject<HTMLElement | null>;
  children: ReactNode;
}

export default class ScrollKeeper extends Component<ScrollKeeperProps> {
  getSnapshotBeforeUpdate(prev: ScrollKeeperProps): ScrollSnapshotEntry[] | null {
    return prev.orderKey === this.props.orderKey ? null : snapshotScroll(this.props.rootRef.current);
  }

  componentDidUpdate(_prev: ScrollKeeperProps, _state: unknown, snapshot: ScrollSnapshotEntry[] | null) {
    if (snapshot) restoreScroll(snapshot);
  }

  render() {
    return this.props.children;
  }
}
