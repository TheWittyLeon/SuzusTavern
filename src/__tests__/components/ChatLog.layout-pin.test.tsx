/**
 * ChatLog — TAV-CHATLOG-REPIN-AFTER-RESIZE (A9d commit 0a).
 *
 * "Stick to the bottom" is decided at COMMIT time. The rows pin runs in a layout
 * effect: after the DOM mutation, before the rendering step's deferred scroll
 * event, so `atBottom` is still the pre-commit truth. A passive (`useEffect`)
 * pin runs after that event and can lose the race (the harness `t3`
 * `begin:bottom` "116px from the end").
 *
 * The probe is a SIBLING AFTER the log with its own layout effect: layout effects
 * run in tree order within one commit, and every passive effect runs after all of
 * them. So the probe sees what a paint-adjacent reader would see: a passive pin
 * has not happened yet, a layout pin has.
 */
import { useLayoutEffect, useRef, type RefObject } from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import ChatLog, { type LogRow } from '../../components/ChatLog';

const SCROLL_HEIGHT = 1000;
const CLIENT_HEIGHT = 200;

/** jsdom has no layout: give the log real-looking metrics and a settable scrollTop. */
function withMetrics(el: HTMLElement, scrollHeight: number): { top: () => number } {
  let top = 0;
  Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => scrollHeight });
  Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => CLIENT_HEIGHT });
  Object.defineProperty(el, 'scrollTop', {
    configurable: true,
    get: () => top,
    set: (v: number) => {
      top = v;
    },
  });
  // ChatLog prefers scrollTo; drive the same setter so either path is observed.
  (el as unknown as { scrollTo: (o: { top: number }) => void }).scrollTo = (o) => {
    top = o.top;
  };
  return { top: () => top };
}

function Probe({ logRef, seen }: { logRef: RefObject<HTMLElement | null>; seen: number[] }) {
  useLayoutEffect(() => {
    if (logRef.current) seen.push(logRef.current.scrollTop);
  });
  return null;
}

function Harness({ rows, seen }: { rows: LogRow[]; seen: number[] }) {
  const holder = useRef<HTMLElement | null>(null);
  // The log is found lazily: ChatLog owns its own ref, the probe only needs the node.
  const logRef = {
    get current() {
      return holder.current ?? (holder.current = document.querySelector('[role="log"]'));
    },
  } as RefObject<HTMLElement | null>;
  return (
    <>
      <ChatLog rows={rows} />
      <Probe logRef={logRef} seen={seen} />
    </>
  );
}

function rows(n: number): LogRow[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `r${i}`,
    who: 'Suzu',
    kind: 'narration' as const,
    text: `Line ${i}`,
    ts: '10:00',
  }));
}

describe('ChatLog pins at commit time (layout effect)', () => {
  it('has already pinned to the end when a later sibling\'s layout effect runs on a rows update', () => {
    const seen: number[] = [];
    const { rerender } = render(<Harness rows={rows(2)} seen={seen} />);
    const log = screen.getByRole('log');
    const m = withMetrics(log, SCROLL_HEIGHT);
    // Pre-commit truth: the reader is at the end (scrollTop + clientHeight == scrollHeight).
    log.scrollTop = SCROLL_HEIGHT - CLIENT_HEIGHT;
    log.dispatchEvent(new Event('scroll'));
    seen.length = 0;

    rerender(<Harness rows={rows(5)} seen={seen} />);

    // The probe's layout effect (after ChatLog's in tree order) read scrollTop in the
    // SAME commit: it must already equal scrollHeight. A passive pin leaves 800.
    expect(seen).toEqual([SCROLL_HEIGHT]);
    expect(m.top()).toBe(SCROLL_HEIGHT);
  });

  it('does not yank a reader who scrolled up to re-read history', () => {
    const seen: number[] = [];
    const { rerender } = render(<Harness rows={rows(2)} seen={seen} />);
    const log = screen.getByRole('log');
    withMetrics(log, SCROLL_HEIGHT);
    log.scrollTop = 100; // 700px from the end, far over the 80px threshold
    log.dispatchEvent(new Event('scroll'));
    seen.length = 0;

    rerender(<Harness rows={rows(5)} seen={seen} />);

    expect(seen).toEqual([100]);
  });
});
