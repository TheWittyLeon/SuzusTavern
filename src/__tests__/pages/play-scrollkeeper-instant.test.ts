/**
 * TAV-STORY-LOG-JUMPS-TOP-AT-FIGHT-START (characterisation).
 *
 * The defect (motion allowed, Story log scrolled part-way, a fight starts: 185 -> 0) was a restore
 * assigned as an ANIMATION. The story log carries `scroll-behavior: smooth`, so `el.scrollTop = n`
 * started a smooth scroll that the next layout cancelled. It was fixed in b25ed0c (A9d-2 round 4) and
 * is on main; the browser legs `t3-*-combat-start-motion` judge it, but jsdom applies no CSS, so
 * nothing in `npx jest` pinned the mechanism. This does: at the moment of the assignment the element's
 * inline `scroll-behavior` must be `auto`, and the author's value must be back afterwards.
 */
import { restoreScroll } from '@/app/play/[sessionId]/ScrollKeeper';

function smoothScroller() {
  const el = document.createElement('div');
  document.body.appendChild(el);
  el.style.scrollBehavior = 'smooth';
  const seen: string[] = [];
  let top = 0;
  Object.defineProperty(el, 'scrollTop', {
    configurable: true,
    get: () => top,
    set: (v: number) => {
      seen.push(el.style.scrollBehavior);
      top = v;
    },
  });
  Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => 900 });
  return { el, seen };
}

describe('restoreScroll assigns instantly whatever the element\'s scroll-behavior', () => {
  it('part-way: scrollTop is assigned while scroll-behavior is auto, then smooth is put back', () => {
    const { el, seen } = smoothScroller();
    restoreScroll([{ el, top: 185, left: 0, atEnd: false }]);
    expect(seen).toEqual(['auto']);
    expect(el.scrollTop).toBe(185);
    expect(el.style.scrollBehavior).toBe('smooth');
  });

  it('pinned to the end: same, and lands on the new scrollHeight', () => {
    const { el, seen } = smoothScroller();
    restoreScroll([{ el, top: 100, left: 0, atEnd: true }]);
    expect(seen).toEqual(['auto']);
    expect(el.scrollTop).toBe(900);
    expect(el.style.scrollBehavior).toBe('smooth');
  });
});
