/**
 * A9d-2 fix round 2 (Iro Minor-6): the strip's sideways tile row says there are more members with an explicit "+N" that does not depend on how
 * much of the next tile peeks (13px in Chromium, 2px in WebKit for the same row at 390 with 7 members). jsdom has no layout, so the row's box
 * and each tile's are stubbed; the browser half is the harness's `v:sidewaysCue` (>=12px of the next tile painted, or `[data-party-more]`).
 *
 * Controls: take `{strip && more > 0 ...}` out of PartyPanel -> every "+N" case reds; count tiles by `left` instead of `right` -> the
 * "peeking tile counts" case reds; render the cue on a rail -> the rail case reds.
 */
import { act, fireEvent, render } from '@testing-library/react';
import '@testing-library/jest-dom';
import PartyPanel from '@/components/PartyPanel';
import type { Participant } from '@/lib/api/types';

const member = (i: number): Participant => ({
  username: `u${i}`,
  is_dm: false,
  character: { character_id: `c${i}`, name: `Member ${i}`, char_class: 'Ranger', level: 4, current_hp: 27, max_hp: 34, ac: 16 },
});
const party = (n: number) => Array.from({ length: n }, (_, i) => member(i));

const R = (o: { left: number; right: number }) => ({ x: 0, y: 0, top: 0, bottom: 57, width: o.right - o.left, height: 57, toJSON() {}, ...o }) as DOMRect;

/** ResizeObserver whose callback the test fires; the row is 300px wide at left 0, tiles 50px wide + 6px gap, scrolled by `scrollLeft`. */
let fire: () => void = () => {};
class RO {
  constructor(cb: () => void) { fire = cb; }
  observe() {}
  disconnect() {}
}

function renderStrip(n: number, variant: 'strip' | 'rail' = 'strip', scrollLeft = 0) {
  (globalThis as unknown as { ResizeObserver: typeof RO }).ResizeObserver = RO;
  const spy = jest.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    if (this.tagName === 'UL') return R({ left: 0, right: 300 });
    if (this.tagName === 'LI') {
      const i = Array.from(this.parentElement!.children).indexOf(this);
      return R({ left: i * 56 - scrollLeft, right: i * 56 + 50 - scrollLeft });
    }
    return R({ left: 0, right: 0 });
  });
  jest.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
    return this.tagName === 'UL' ? 300 : 0;
  });
  const utils = render(<PartyPanel variant={variant} participants={party(n)} selfUsername="u0" />);
  act(() => fire());
  return { ...utils, spy };
}

afterEach(() => jest.restoreAllMocks());

describe('PartyPanel strip: the explicit "more" cue of the sideways row', () => {
  it('7 tiles in a 300px row: 5 are wholly in view (5*56-6 = 274), the sixth peeks (280..330) and the seventh is out: "+2", aria-hidden', () => {
    const { container } = renderStrip(7);
    const cue = container.querySelector('[data-party-more]');
    expect(cue).toHaveTextContent('+2');
    expect(cue).toHaveAttribute('aria-hidden', 'true');
  });

  it('a tile that only PEEKS counts as not in view (it is cut by the edge): 6 tiles, the sixth at 280..330 -> "+1"', () => {
    expect(renderStrip(6).container.querySelector('[data-party-more]')).toHaveTextContent('+1');
  });

  it('control: tiles that all fit (5 in 300px) show no cue', () => {
    expect(renderStrip(5).container.querySelector('[data-party-more]')).toBeNull();
  });

  it('the cue is gone at the end of the scroll: scrolled 120px the last tile ends at 266 of 300, so none is cut', () => {
    const { container } = renderStrip(7, 'strip', 120);
    expect(container.querySelector('[data-party-more]')).toBeNull();
  });

  it('it follows the row\'s own scroll event', () => {
    const { container } = renderStrip(7);
    expect(container.querySelector('[data-party-more]')).toHaveTextContent('+2');
    jest.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      if (this.tagName === 'UL') return R({ left: 0, right: 300 });
      const i = Array.from(this.parentElement!.children).indexOf(this);
      return R({ left: i * 56 - 112, right: i * 56 + 50 - 112 });
    });
    act(() => { fireEvent.scroll(container.querySelector('ul') as HTMLElement); });
    expect(container.querySelector('[data-party-more]')).toBeNull();
  });

  it('a rail (a column) has no sideways row and shows no cue, whatever the numbers say', () => {
    expect(renderStrip(9, 'rail').container.querySelector('[data-party-more]')).toBeNull();
  });
});
