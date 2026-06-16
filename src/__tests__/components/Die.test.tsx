import { render, act } from '@testing-library/react';
import Die from '@/components/Die';

// Helper: mock useReducedMotion to return a given value
function mockReducedMotion(reduced: boolean) {
  jest.mock('@/lib/useReducedMotion', () => ({
    useReducedMotion: () => reduced,
  }));
}

describe('Die', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  it('renders without throwing and carries data-component="Die"', () => {
    const { container } = render(<Die />);
    expect(container.querySelector('[data-component="Die"]')).toBeInTheDocument();
  });

  it('displays the controlled value', () => {
    const { container } = render(<Die value={17} />);
    expect(container.querySelector('[data-component="Die"]')!.textContent).toBe('17');
  });

  it('defaults to a numeric value when value is null', () => {
    const { container } = render(<Die value={null} sides={6} />);
    const text = container.querySelector('[data-component="Die"]')!.textContent;
    const n = Number(text);
    expect(n).toBeGreaterThanOrEqual(1);
    expect(n).toBeLessThanOrEqual(6);
  });

  it('applies gold gradient color for crit', () => {
    const { container } = render(<Die value={20} crit />);
    const el = container.querySelector('[data-component="Die"]') as HTMLElement;
    expect(el.style.background).toContain('var(--crit)');
    // jsdom normalises #2a1e16 → rgb(42, 30, 22)
    expect(el.style.color).toMatch(/^(#2a1e16|rgb\(42,\s*30,\s*22\))$/);
  });

  it('applies red gradient color for fumble', () => {
    const { container } = render(<Die value={1} fumble />);
    const el = container.querySelector('[data-component="Die"]') as HTMLElement;
    expect(el.style.background).toContain('var(--fumble)');
    // A11Y-3: fumble text color now uses --fumble-ink token (per-palette)
    expect(el.style.color).toBe('var(--fumble-ink)');
  });

  it('crit takes precedence over fumble', () => {
    const { container } = render(<Die value={20} crit fumble />);
    const el = container.querySelector('[data-component="Die"]') as HTMLElement;
    expect(el.style.background).toContain('var(--crit)');
    expect(el.style.color).toMatch(/^(#2a1e16|rgb\(42,\s*30,\s*22\))$/);
  });

  it('resting state uses accent gradient', () => {
    const { container } = render(<Die value={10} />);
    const el = container.querySelector('[data-component="Die"]') as HTMLElement;
    expect(el.style.background).toContain('var(--accent)');
  });

  it('exposes aria-label with value when not rolling', () => {
    const { container } = render(<Die value={17} sides={20} />);
    const el = container.querySelector('[data-component="Die"]')!;
    expect(el.getAttribute('aria-label')).toBe('d20 shows 17');
  });

  it('is aria-hidden while rolling', () => {
    const { container } = render(<Die value={5} rolling />);
    const el = container.querySelector('[data-component="Die"]')!;
    expect(el.getAttribute('aria-hidden')).toBe('true');
  });

  describe('rolling ticker', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      // Drain pending timers inside act() before switching back to real timers.
      // Without this, the Die setInterval callback can fire after the worker
      // moves on, causing the "failed to exit gracefully" warning.
      act(() => { jest.runOnlyPendingTimers(); });
      jest.useRealTimers();
    });

    it('cycles the displayed number while rolling', () => {
      const { container } = render(<Die value={5} rolling sides={20} />);
      const el = container.querySelector('[data-component="Die"]')!;
      const initial = el.textContent;

      // Run enough intervals for a change to be highly likely
      let changed = false;
      for (let tick = 0; tick < 50; tick++) {
        act(() => { jest.advanceTimersByTime(80); });
        if (el.textContent !== initial) { changed = true; break; }
      }
      expect(changed).toBe(true);
    });

    it('stops cycling when rolling becomes false', () => {
      const { container, rerender } = render(<Die value={5} rolling sides={20} />);
      const el = container.querySelector('[data-component="Die"]')!;

      // Stop rolling
      rerender(<Die value={5} rolling={false} sides={20} />);
      const valueAfterStop = el.textContent;

      // Advance timers — number should not change
      act(() => { jest.advanceTimersByTime(800); });
      expect(el.textContent).toBe(valueAfterStop);
    });
  });

  describe('reduced-motion branch', () => {
    beforeEach(() => {
      jest.useFakeTimers();
      // Mock matchMedia to signal reduced motion
      window.matchMedia = jest.fn().mockReturnValue({
        matches: true,
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
      });
    });

    afterEach(() => {
      act(() => { jest.runOnlyPendingTimers(); });
      jest.useRealTimers();
    });

    it('does NOT start the ticker when reduced motion is preferred', () => {
      const { container } = render(<Die value={7} rolling sides={20} />);
      const el = container.querySelector('[data-component="Die"]')!;
      const initial = el.textContent;

      // Advance many intervals — number must stay at 7
      for (let tick = 0; tick < 30; tick++) {
        act(() => { jest.advanceTimersByTime(80); });
      }
      expect(el.textContent).toBe(initial);
    });

    it('still reflects crit styling under reduced motion', () => {
      const { container } = render(<Die value={20} crit rolling />);
      const el = container.querySelector('[data-component="Die"]') as HTMLElement;
      expect(el.style.background).toContain('var(--crit)');
    });
  });
});
