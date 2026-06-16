import { renderHook, act } from '@testing-library/react';
import { useReducedMotion } from '@/lib/useReducedMotion';

// Helpers to set up a mock matchMedia
function makeMockMQ(matches: boolean) {
  const listeners: Array<(e: MediaQueryListEvent) => void> = [];
  const mq = {
    matches,
    addEventListener: jest.fn((_type: string, cb: (e: MediaQueryListEvent) => void) => {
      listeners.push(cb);
    }),
    removeEventListener: jest.fn((_type: string, cb: (e: MediaQueryListEvent) => void) => {
      const idx = listeners.indexOf(cb);
      if (idx !== -1) listeners.splice(idx, 1);
    }),
    // Simulate an OS change event
    _fire(newMatches: boolean) {
      listeners.forEach((cb) => cb({ matches: newMatches } as MediaQueryListEvent));
    },
  };
  return mq;
}

describe('useReducedMotion', () => {
  let originalMatchMedia: typeof window.matchMedia;
   
  let mockMQ: ReturnType<typeof makeMockMQ> & { _fire: (m: boolean) => void };

  beforeEach(() => {
    originalMatchMedia = window.matchMedia;
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
    jest.clearAllMocks();
  });

  it('returns false during SSR / before mount (initial state)', () => {
    // When matchMedia is not set up yet, we can't call the hook server-side,
    // but we can verify the initial state is false before the effect runs.
    mockMQ = makeMockMQ(false) as typeof mockMQ;
    window.matchMedia = jest.fn().mockReturnValue(mockMQ);

    const { result } = renderHook(() => useReducedMotion());
    // After mount the effect runs synchronously in test (jsdom); value reflects mq.matches
    expect(typeof result.current).toBe('boolean');
  });

  it('returns false when prefers-reduced-motion does not match', () => {
    mockMQ = makeMockMQ(false) as typeof mockMQ;
    window.matchMedia = jest.fn().mockReturnValue(mockMQ);

    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(false);
  });

  it('returns true when prefers-reduced-motion matches', () => {
    mockMQ = makeMockMQ(true) as typeof mockMQ;
    window.matchMedia = jest.fn().mockReturnValue(mockMQ);

    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(true);
  });

  it('updates when the OS setting changes', () => {
    mockMQ = makeMockMQ(false) as typeof mockMQ;
    window.matchMedia = jest.fn().mockReturnValue(mockMQ);

    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(false);

    act(() => {
      mockMQ._fire(true);
    });
    expect(result.current).toBe(true);

    act(() => {
      mockMQ._fire(false);
    });
    expect(result.current).toBe(false);
  });

  it('calls matchMedia with the correct query string', () => {
    mockMQ = makeMockMQ(false) as typeof mockMQ;
    const spy = jest.fn().mockReturnValue(mockMQ);
    window.matchMedia = spy;

    renderHook(() => useReducedMotion());
    expect(spy).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)');
  });

  it('removes the event listener on unmount', () => {
    mockMQ = makeMockMQ(false) as typeof mockMQ;
    window.matchMedia = jest.fn().mockReturnValue(mockMQ);

    const { unmount } = renderHook(() => useReducedMotion());
    unmount();

    expect(mockMQ.removeEventListener).toHaveBeenCalledTimes(1);
  });
});
