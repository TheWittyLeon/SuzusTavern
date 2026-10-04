import { isOwnScroll, markOwnScroll } from '@/lib/ownScroll';
import { restoreScroll } from '@/app/play/[sessionId]/ScrollKeeper';

describe('ownScroll: a scroll the page makes by itself, per element and time-boxed', () => {
  afterEach(() => jest.useRealTimers());
  it('a marked element is the page\'s own for the window; another element, and the same element after the window, are not', () => {
    jest.useFakeTimers();
    const a = document.createElement('div');
    const b = document.createElement('div');
    expect(isOwnScroll(a)).toBe(false);
    markOwnScroll(a, 100);
    expect(isOwnScroll(a)).toBe(true);
    expect(isOwnScroll(b)).toBe(false);
    jest.advanceTimersByTime(101);
    expect(isOwnScroll(a)).toBe(false);
  });
  it('a later, shorter mark never shortens an earlier, longer one (a smooth scroll followed by an instant one)', () => {
    jest.useFakeTimers();
    const a = document.createElement('div');
    markOwnScroll(a, 800);
    markOwnScroll(a, 100);
    jest.advanceTimersByTime(500);
    expect(isOwnScroll(a)).toBe(true);
  });
  it('null and a missing element are nobody\'s', () => {
    expect(isOwnScroll(null)).toBe(false);
    expect(() => markOwnScroll(null)).not.toThrow();
  });
});

describe('the shell\'s scroll restore is the page\'s own scroll too', () => {
  it('restoreScroll marks the element it puts back (the mutation: no mark)', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    expect(isOwnScroll(el)).toBe(false);
    restoreScroll([{ el, top: 5, left: 0, atEnd: false }]);
    expect(isOwnScroll(el)).toBe(true);
    el.remove();
  });
});
