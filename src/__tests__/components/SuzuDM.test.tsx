import { render } from '@testing-library/react';
import SuzuDM from '@/components/SuzuDM';

describe('SuzuDM', () => {
  beforeEach(() => {
    // Default: no reduced motion
    window.matchMedia = jest.fn().mockReturnValue({
      matches: false,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('renders without throwing and carries data-component="SuzuDM"', () => {
    const { container } = render(<SuzuDM />);
    expect(container.querySelector('[data-component="SuzuDM"]')).toBeInTheDocument();
  });

  it('is aria-hidden (decorative element)', () => {
    const { container } = render(<SuzuDM />);
    expect(container.querySelector('[data-component="SuzuDM"]')!.getAttribute('aria-hidden')).toBe('true');
  });

  it('renders an SVG', () => {
    const { container } = render(<SuzuDM />);
    expect(container.querySelector('svg')).toBeInTheDocument();
  });

  it('renders with custom size', () => {
    const { container } = render(<SuzuDM size={160} />);
    const el = container.querySelector('[data-component="SuzuDM"]') as HTMLElement;
    expect(el.style.width).toBe('160px');
    expect(el.style.height).toBe('160px');
  });

  describe('hat prop', () => {
    it('renders the DM hat by default', () => {
      const { container } = render(<SuzuDM />);
      // Hat cone path has "M70 22"
      const paths = container.querySelectorAll('path');
      const hatPaths = Array.from(paths).filter(p =>
        p.getAttribute('d')?.includes('M70 22'),
      );
      expect(hatPaths.length).toBeGreaterThan(0);
    });

    it('omits the DM hat when hat=false', () => {
      const { container } = render(<SuzuDM hat={false} />);
      const paths = container.querySelectorAll('path');
      const hatPaths = Array.from(paths).filter(p =>
        p.getAttribute('d')?.includes('M70 22'),
      );
      expect(hatPaths.length).toBe(0);
    });
  });

  describe('glow prop', () => {
    it('renders the halo glow circle by default', () => {
      const { container } = render(<SuzuDM />);
      // The halo is a <circle> with r="56" initially
      const circles = container.querySelectorAll('circle');
      // There should be at least the halo circle
      expect(circles.length).toBeGreaterThan(0);
    });

    it('omits halo when glow=false', () => {
      // The halo is the only circle with fill containing "m-glow"
      const { container: withGlow } = render(<SuzuDM glow />);
      const { container: noGlow } = render(<SuzuDM glow={false} />);
      // With glow we have more circles (halo + port lights)
      const withCount = withGlow.querySelectorAll('circle').length;
      const noGlowCount = noGlow.querySelectorAll('circle').length;
      expect(noGlowCount).toBeLessThan(withCount);
    });
  });

  describe('talking prop', () => {
    it('idle state shows the smile path', () => {
      const { container } = render(<SuzuDM talking={false} />);
      const paths = container.querySelectorAll('path');
      const smilePaths = Array.from(paths).filter(p =>
        p.getAttribute('d')?.includes('Q70 101'),
      );
      expect(smilePaths.length).toBe(1);
    });

    it('talking state shows the mouth ellipse', () => {
      const { container } = render(<SuzuDM talking />);
      // The talking mouth is an ellipse with cx="70" cy="98"
      const ellipses = container.querySelectorAll('ellipse');
      const mouthEllipses = Array.from(ellipses).filter(
        e => e.getAttribute('cx') === '70' && e.getAttribute('cy') === '98',
      );
      expect(mouthEllipses.length).toBe(1);
    });

    it('talking state does NOT include the smile path', () => {
      const { container } = render(<SuzuDM talking />);
      const paths = container.querySelectorAll('path');
      const smilePaths = Array.from(paths).filter(p =>
        p.getAttribute('d')?.includes('Q70 101'),
      );
      expect(smilePaths.length).toBe(0);
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

    it('renders without throwing under reduced motion', () => {
      const { container } = render(<SuzuDM />);
      expect(container.querySelector('[data-component="SuzuDM"]')).toBeInTheDocument();
    });

    it('omits SVG <animate> elements when reduced motion is preferred', () => {
      const { container } = render(<SuzuDM />);
      const animates = container.querySelectorAll('animate, animateTransform');
      expect(animates.length).toBe(0);
    });

    it('still shows the smile in idle + reduced motion', () => {
      const { container } = render(<SuzuDM talking={false} />);
      const paths = container.querySelectorAll('path');
      const smilePaths = Array.from(paths).filter(p =>
        p.getAttribute('d')?.includes('Q70 101'),
      );
      expect(smilePaths.length).toBe(1);
    });

    it('still shows talking ellipse under reduced motion when talking=true', () => {
      const { container } = render(<SuzuDM talking />);
      const ellipses = container.querySelectorAll('ellipse');
      const mouthEllipses = Array.from(ellipses).filter(
        e => e.getAttribute('cx') === '70' && e.getAttribute('cy') === '98',
      );
      expect(mouthEllipses.length).toBe(1);
    });
  });
});
