import { render } from '@testing-library/react';
import Pill from '@/components/Pill';
import styles from '@/components/Pill.module.css';

describe('Pill', () => {
  it('renders without throwing', () => {
    const { container } = render(<Pill>Label</Pill>);
    expect(container.firstChild).not.toBeNull();
  });

  it('carries data-component="Pill" sentinel', () => {
    const { container } = render(<Pill>x</Pill>);
    expect(container.querySelector('[data-component="Pill"]')).toBeInTheDocument();
  });

  it('renders children', () => {
    const { getByText } = render(<Pill>Online</Pill>);
    expect(getByText('Online')).toBeInTheDocument();
  });

  describe('tone styling', () => {
    it('accent (default) uses --accent color', () => {
      const { container } = render(<Pill>x</Pill>);
      const el = container.querySelector('[data-component="Pill"]') as HTMLElement;
      expect(el.style.color).toContain('var(--accent)');
    });

    it('good tone uses --good color', () => {
      const { container } = render(<Pill tone="good">x</Pill>);
      const el = container.querySelector('[data-component="Pill"]') as HTMLElement;
      expect(el.style.color).toContain('var(--good)');
    });

    it('warn tone uses --warn color', () => {
      const { container } = render(<Pill tone="warn">x</Pill>);
      const el = container.querySelector('[data-component="Pill"]') as HTMLElement;
      expect(el.style.color).toContain('var(--warn)');
    });

    it('bad tone uses --bad color', () => {
      const { container } = render(<Pill tone="bad">x</Pill>);
      const el = container.querySelector('[data-component="Pill"]') as HTMLElement;
      expect(el.style.color).toContain('var(--bad)');
    });

    it('crit tone uses --crit color', () => {
      const { container } = render(<Pill tone="crit">x</Pill>);
      const el = container.querySelector('[data-component="Pill"]') as HTMLElement;
      expect(el.style.color).toContain('var(--crit)');
    });

    it('muted tone uses --ink-2 color (a11y: ≥4.5:1 on the muted surface)', () => {
      const { container } = render(<Pill tone="muted">x</Pill>);
      const el = container.querySelector('[data-component="Pill"]') as HTMLElement;
      expect(el.style.color).toContain('var(--ink-2)');
    });

    it('lav tone uses --accent-2 color', () => {
      const { container } = render(<Pill tone="lav">x</Pill>);
      const el = container.querySelector('[data-component="Pill"]') as HTMLElement;
      expect(el.style.color).toContain('var(--accent-2)');
    });
  });

  describe('dot indicator', () => {
    it('does not render a dot by default', () => {
      const { container } = render(<Pill>x</Pill>);
      // dot is a nested <span> — there should be none if dot=false
      const spans = container.querySelectorAll('[data-component="Pill"] span');
      expect(spans).toHaveLength(0);
    });

    it('renders a dot span when dot=true', () => {
      const { container } = render(<Pill dot>x</Pill>);
      const spans = container.querySelectorAll('[data-component="Pill"] span');
      expect(spans.length).toBeGreaterThan(0);
    });

    it('dot span has correct dimensions in inline style', () => {
      const { container } = render(<Pill dot>x</Pill>);
      const dot = container.querySelector('[data-component="Pill"] span') as HTMLElement;
      expect(dot.style.width).toBe('6px');
      expect(dot.style.height).toBe('6px');
    });

    it('dot span uses the animated class when reduced motion is false', () => {
      window.matchMedia = jest.fn().mockReturnValue({
        matches: false,
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
      });
      const { container } = render(<Pill dot>x</Pill>);
      const dot = container.querySelector('[data-component="Pill"] span')!;
      // Split on whitespace to get exact tokens (avoids "dot" matching inside "dotStatic")
      const tokens = dot.className.split(/\s+/);
      expect(tokens).toContain(styles.dot);
      expect(tokens).not.toContain(styles.dotStatic);
    });

    it('dot span uses the static class when reduced motion is true (covers dotStatic branch)', () => {
      // This covers the branch at Pill.tsx line 113:
      // className={reduced ? styles.dotStatic : styles.dot}
      window.matchMedia = jest.fn().mockReturnValue({
        matches: true,
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
      });
      const { container } = render(<Pill dot>x</Pill>);
      const dot = container.querySelector('[data-component="Pill"] span')!;
      // Split on whitespace to get exact tokens (avoids "dot" matching inside "dotStatic")
      const tokens = dot.className.split(/\s+/);
      expect(tokens).toContain(styles.dotStatic);
      expect(tokens).not.toContain(styles.dot);
    });
  });

  describe('remaining tones', () => {
    it('cool tone uses --cool color', () => {
      const { container } = render(<Pill tone="cool">x</Pill>);
      const el = container.querySelector('[data-component="Pill"]') as HTMLElement;
      expect(el.style.color).toContain('var(--cool)');
    });

    it('warm tone uses --warm color', () => {
      const { container } = render(<Pill tone="warm">x</Pill>);
      const el = container.querySelector('[data-component="Pill"]') as HTMLElement;
      expect(el.style.color).toContain('var(--warm)');
    });
  });
});
