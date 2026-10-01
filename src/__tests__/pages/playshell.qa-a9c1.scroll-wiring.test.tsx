/**
 * A9c-1 QA (Miko) -- the ScrollKeeper WIRING through the real PlayShell.
 *
 * play-slot-order.test.ts pins the two PURE halves (snapshotScroll /
 * restoreScroll). Nothing in jsdom pinned the part that decides WHEN they run:
 * `PlayShell`'s `orderKey` and `ScrollKeeper.getSnapshotBeforeUpdate`. Measured
 * on the builder's tree: a constant `orderKey`, and a keeper that never
 * snapshots, both left all 135 suites in src/__tests__/pages green. Only the
 * browser harness (t2/t3) would have seen it.
 *
 * jsdom does not reset scrollTop when a node moves; a browser does. So this
 * file installs a FAKE BROWSER: any already-connected node moved by
 * insertBefore/appendChild has scrollTop zeroed on itself and its subtree, and
 * the resets are counted. That counter is the non-vacuity guard: a transition
 * is only asserted on if the fake browser really reset the scroller.
 */
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';
import PlayShell from '@/app/play/[sessionId]/PlayShell';
import {
  LAYOUT_ROWS,
  REGION_IDS,
  type LayoutRow,
  type Moment,
  type RegionId,
} from '@/app/play/[sessionId]/presets';

const MOMENTS: readonly Moment[] = ['exploring', 'combat'];
const COMBOS: Array<{ name: string; row: LayoutRow; moment: Moment }> = LAYOUT_ROWS.flatMap((row) =>
  MOMENTS.map((moment) => ({ name: `${row.id}/${moment}`, row, moment })),
);

function regionNodes(): Partial<Record<RegionId, React.ReactNode>> {
  const out: Partial<Record<RegionId, React.ReactNode>> = {};
  for (const id of REGION_IDS) {
    out[id] = id === 'storyLog' ? <div data-testid="scroller">log</div> : <span>{id}</span>;
  }
  return out;
}

let resets = 0;
const realInsertBefore = Node.prototype.insertBefore;
const realAppendChild = Node.prototype.appendChild;

function zero(node: Node) {
  if (!(node instanceof HTMLElement)) return;
  for (const el of [node, ...Array.from(node.querySelectorAll<HTMLElement>('*'))]) {
    if (el.scrollTop > 0) {
      el.scrollTop = 0;
      resets++;
    }
  }
}

beforeEach(() => {
  resets = 0;
  Node.prototype.insertBefore = function <T extends Node>(this: Node, node: T, ref: Node | null): T {
    const wasConnected = node.isConnected;
    const out = realInsertBefore.call(this, node, ref) as T;
    if (wasConnected) zero(node);
    return out;
  };
  Node.prototype.appendChild = function <T extends Node>(this: Node, node: T): T {
    const wasConnected = node.isConnected;
    const out = realAppendChild.call(this, node) as T;
    if (wasConnected) zero(node);
    return out;
  };
});

afterEach(() => {
  Node.prototype.insertBefore = realInsertBefore;
  Node.prototype.appendChild = realAppendChild;
});

function arm(el: HTMLElement, o: { top: number; sh: number; ch: number }) {
  Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => o.sh });
  Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => o.ch });
  el.scrollTop = o.top;
}

/** Every ordered pair of real (row, moment) combos, A !== B. */
const PAIRS = COMBOS.flatMap((a) => COMBOS.filter((b) => b !== a).map((b) => ({ a, b })));

describe('ScrollKeeper through PlayShell: a slot MOVE keeps the reader where they were', () => {
  it('the fake browser is real: a bare re-parent of a scrolled node zeroes it (positive control)', () => {
    const host = document.createElement('div');
    const a = document.createElement('div');
    const b = document.createElement('div');
    const scroller = document.createElement('div');
    host.append(a, b);
    a.appendChild(scroller);
    document.body.appendChild(host);
    arm(scroller, { top: 90, sh: 500, ch: 100 });
    host.insertBefore(a, null); // move a connected node
    expect(scroller.scrollTop).toBe(0);
    expect(resets).toBe(1);
    document.body.removeChild(host);
  });

  it('at least one real transition actually MOVES the story log (else this file proves nothing)', () => {
    let moved = 0;
    for (const { a, b } of PAIRS) {
      resets = 0;
      const { rerender, getByTestId, unmount } = render(
        <PlayShell row={a.row} moment={a.moment} regions={regionNodes()} tenants={{}} />,
      );
      // Mid-log, NOT at the end, so the restore target is `top`, not the end.
      arm(getByTestId('scroller'), { top: 120, sh: 1000, ch: 300 });
      rerender(<PlayShell row={b.row} moment={b.moment} regions={regionNodes()} tenants={{}} />);
      if (resets > 0) moved++;
      unmount();
    }
    expect(moved).toBeGreaterThanOrEqual(1);
  });

  it.each(PAIRS.map((p) => [`${p.a.name} -> ${p.b.name}`, p] as const))(
    '%s: mid-log scroll survives the move; at-end stays pinned to the new end',
    (_n, { a, b }) => {
      // mid-log
      resets = 0;
      const first = render(<PlayShell row={a.row} moment={a.moment} regions={regionNodes()} tenants={{}} />);
      const mid = first.getByTestId('scroller');
      arm(mid, { top: 120, sh: 1000, ch: 300 });
      first.rerender(<PlayShell row={b.row} moment={b.moment} regions={regionNodes()} tenants={{}} />);
      const movedMid = resets > 0;
      expect(first.getByTestId('scroller')).toBe(mid); // same node: the slot was moved, not remounted
      expect(mid.scrollTop).toBe(120);
      first.unmount();

      // at the end: the new box is taller, "at the end" must follow it
      resets = 0;
      const second = render(<PlayShell row={a.row} moment={a.moment} regions={regionNodes()} tenants={{}} />);
      const tail = second.getByTestId('scroller');
      // 1000-300-700 = 0 -> at end. The box is 1400 tall only AFTER the move
      // (the getter flips when the fake browser resets the node).
      Object.defineProperty(tail, 'scrollHeight', { configurable: true, get: () => (resets > 0 ? 1400 : 1000) });
      Object.defineProperty(tail, 'clientHeight', { configurable: true, get: () => 300 });
      tail.scrollTop = 700;
      second.rerender(<PlayShell row={b.row} moment={b.moment} regions={regionNodes()} tenants={{}} />);
      if (resets > 0) expect(tail.scrollTop).toBe(1400);
      else expect(tail.scrollTop).toBe(1000); // not moved: still at the (unchanged) end
      expect(movedMid).toBe(resets > 0); // both halves saw the same move
      second.unmount();
    },
  );

  it('NO move (same row+moment, new region nodes) takes no snapshot and touches no scroll', () => {
    const { rerender, getByTestId } = render(
      <PlayShell row={COMBOS[0].row} moment={COMBOS[0].moment} regions={regionNodes()} tenants={{}} />,
    );
    const el = getByTestId('scroller');
    arm(el, { top: 120, sh: 1000, ch: 300 });
    el.scrollTop = 120;
    // A consumer that restored on every render would write scrollTop here.
    const writes: number[] = [];
    let held = 120;
    Object.defineProperty(el, 'scrollTop', {
      configurable: true,
      get: () => held,
      set: (v: number) => {
        writes.push(v);
        held = v;
      },
    });
    rerender(<PlayShell row={COMBOS[0].row} moment={COMBOS[0].moment} regions={regionNodes()} tenants={{}} />);
    expect(writes).toEqual([]);
  });
});
