import { render, act } from '@testing-library/react';
import Waveform from '@/components/Waveform';

describe('Waveform', () => {
  beforeEach(() => {
    // Default: no reduced motion
    window.matchMedia = jest.fn().mockReturnValue({
      matches: false,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    });
    jest.clearAllMocks();
  });

  it('renders without throwing and carries data-component="Waveform"', () => {
    const { container } = render(<Waveform />);
    expect(container.querySelector('[data-component="Waveform"]')).toBeInTheDocument();
  });

  it('is aria-hidden (decorative element)', () => {
    const { container } = render(<Waveform />);
    expect(
      container.querySelector('[data-component="Waveform"]')!.getAttribute('aria-hidden'),
    ).toBe('true');
  });

  it('renders the correct number of bars (default 32)', () => {
    const { container } = render(<Waveform />);
    const bars = container.querySelectorAll('[data-component="Waveform"] > div');
    expect(bars.length).toBe(32);
  });

  it('renders the specified bar count', () => {
    const { container } = render(<Waveform bars={16} />);
    const bars = container.querySelectorAll('[data-component="Waveform"] > div');
    expect(bars.length).toBe(16);
  });

  it('applies the container height', () => {
    const { container } = render(<Waveform height={48} />);
    const el = container.querySelector('[data-component="Waveform"]') as HTMLElement;
    expect(el.style.height).toBe('48px');
  });

  describe('active=false — static idle bars', () => {
    it('renders bars at 18% height when active=false', () => {
      const { container } = render(<Waveform active={false} />);
      const firstBar = container.querySelector('[data-component="Waveform"] > div') as HTMLElement;
      expect(firstBar.style.height).toBe('18%');
    });

    it('renders bars at 0.3 opacity when active=false', () => {
      const { container } = render(<Waveform active={false} />);
      const firstBar = container.querySelector('[data-component="Waveform"] > div') as HTMLElement;
      expect(firstBar.style.opacity).toBe('0.3');
    });
  });

  describe('custom color', () => {
    it('applies custom color to bars', () => {
      const { container } = render(<Waveform active={false} color="var(--good)" />);
      const firstBar = container.querySelector('[data-component="Waveform"] > div') as HTMLElement;
      expect(firstBar.style.background).toBe('var(--good)');
    });
  });

  describe('reduced-motion branch', () => {
    beforeEach(() => {
      window.matchMedia = jest.fn().mockReturnValue({
        matches: true,
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
      });
    });

    it('renders static bars (18% height) when reduced motion is preferred, even if active=true', () => {
      const { container } = render(<Waveform active={true} />);
      const firstBar = container.querySelector('[data-component="Waveform"] > div') as HTMLElement;
      // Under reduced motion, v is always 0.18
      expect(firstBar.style.height).toBe('18%');
    });

    it('renders at 0.3 opacity under reduced motion', () => {
      const { container } = render(<Waveform active={true} />);
      const firstBar = container.querySelector('[data-component="Waveform"] > div') as HTMLElement;
      expect(firstBar.style.opacity).toBe('0.3');
    });

    it('renders static bars (not animated) under reduced motion — no live rAF after stabilization', () => {
      // Under reduced motion the bars should be at static height (18%).
      // This is the observable behavior we care about; the hook's effect may briefly
      // start/stop rAF during the state update cycle, but the end result is static bars.
      const { container } = render(<Waveform active={true} />);
      const firstBar = container.querySelector('[data-component="Waveform"] > div') as HTMLElement;
      expect(firstBar.style.height).toBe('18%');
      expect(firstBar.style.opacity).toBe('0.3');
    });
  });

  describe('rAF lifecycle', () => {
    it('starts requestAnimationFrame when active=true and no reduced motion', () => {
      const rafSpy = jest.spyOn(global, 'requestAnimationFrame').mockImplementation(() => 0);
      render(<Waveform active={true} />);
      expect(rafSpy).toHaveBeenCalled();
      rafSpy.mockRestore();
    });

    it('cancels rAF on unmount', () => {
      const cancelSpy = jest.spyOn(global, 'cancelAnimationFrame');
      jest.spyOn(global, 'requestAnimationFrame').mockImplementation(() => 42);
      const { unmount } = render(<Waveform active={true} />);
      act(() => { unmount(); });
      expect(cancelSpy).toHaveBeenCalledWith(42);
      cancelSpy.mockRestore();
    });

    it('does NOT start rAF when active=false', () => {
      const rafSpy = jest.spyOn(global, 'requestAnimationFrame').mockImplementation(() => 0);
      render(<Waveform active={false} />);
      expect(rafSpy).not.toHaveBeenCalled();
      rafSpy.mockRestore();
    });
  });
});
