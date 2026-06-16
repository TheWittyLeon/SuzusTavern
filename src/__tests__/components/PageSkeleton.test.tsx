import { render } from '@testing-library/react';
import PageSkeleton, { Skeleton } from '@/components/PageSkeleton';
import styles from '@/components/PageSkeleton.module.css';

// ---- Helpers to control useReducedMotion ----

function setReducedMotion(reduced: boolean) {
  window.matchMedia = jest.fn().mockReturnValue({
    matches: reduced,
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
  });
}

describe('Skeleton (primitive)', () => {
  beforeEach(() => setReducedMotion(false));

  it('renders with data-component="Skeleton"', () => {
    const { container } = render(<Skeleton />);
    expect(container.querySelector('[data-component="Skeleton"]')).toBeInTheDocument();
  });

  it('is aria-hidden (decorative)', () => {
    const { container } = render(<Skeleton />);
    const el = container.querySelector('[data-component="Skeleton"]')!;
    expect(el.getAttribute('aria-hidden')).toBe('true');
  });

  it('applies width and height as inline styles', () => {
    const { container } = render(<Skeleton width={200} height={32} />);
    const el = container.querySelector('[data-component="Skeleton"]') as HTMLElement;
    expect(el.style.width).toBe('200px');
    expect(el.style.height).toBe('32px');
  });

  it('applies 50% border-radius for circle=true', () => {
    const { container } = render(<Skeleton circle width={40} height={40} />);
    const el = container.querySelector('[data-component="Skeleton"]') as HTMLElement;
    expect(el.style.borderRadius).toBe('50%');
  });

  it('has shimmer class when reduced motion is false', () => {
    const { container } = render(<Skeleton />);
    const el = container.querySelector('[data-component="Skeleton"]')!;
    // CSS Modules hash the class names in test; check the module mapping
    expect(el.className).toContain(styles.shimmer);
  });

  it('has static class (no shimmer) when reduced motion is true', () => {
    setReducedMotion(true);
    const { container } = render(<Skeleton />);
    const el = container.querySelector('[data-component="Skeleton"]')!;
    expect(el.className).toContain(styles.static);
    expect(el.className).not.toContain(styles.shimmer);
  });
});

describe('PageSkeleton', () => {
  beforeEach(() => setReducedMotion(false));

  it('renders with data-component="PageSkeleton"', () => {
    const { container } = render(<PageSkeleton />);
    expect(container.querySelector('[data-component="PageSkeleton"]')).toBeInTheDocument();
  });

  it('has role="status"', () => {
    const { container } = render(<PageSkeleton />);
    const el = container.querySelector('[data-component="PageSkeleton"]')!;
    expect(el.getAttribute('role')).toBe('status');
  });

  it('has aria-busy="true"', () => {
    const { container } = render(<PageSkeleton />);
    const el = container.querySelector('[data-component="PageSkeleton"]')!;
    expect(el.getAttribute('aria-busy')).toBe('true');
  });

  it('has aria-label="Loading…"', () => {
    const { container } = render(<PageSkeleton />);
    const el = container.querySelector('[data-component="PageSkeleton"]')!;
    expect(el.getAttribute('aria-label')).toBe('Loading…');
  });

  it('contains a visually-hidden "Loading…" text for screen readers', () => {
    const { container } = render(<PageSkeleton />);
    // The SR-only span is inside the component — query all text
    const srSpan = container.querySelector('[data-component="PageSkeleton"] span');
    expect(srSpan).not.toBeNull();
    expect(srSpan!.textContent).toBe('Loading…');
  });

  it('renders lines variant by default', () => {
    const { container } = render(<PageSkeleton />);
    // Default 4 lines → 4 Skeleton blocks inside lines layout
    const skeletons = container.querySelectorAll('[data-component="Skeleton"]');
    expect(skeletons.length).toBe(4);
  });

  it('respects the lines count prop', () => {
    const { container } = render(<PageSkeleton lines={6} />);
    const skeletons = container.querySelectorAll('[data-component="Skeleton"]');
    expect(skeletons.length).toBe(6);
  });

  it('renders card variant', () => {
    const { container } = render(<PageSkeleton variant="card" lines={3} />);
    // card = 1 header + 3 body lines
    const skeletons = container.querySelectorAll('[data-component="Skeleton"]');
    expect(skeletons.length).toBe(4);
  });

  it('renders list variant with circle per row', () => {
    const { container } = render(<PageSkeleton variant="list" lines={3} />);
    const circles = container.querySelectorAll('[data-component="Skeleton"][style*="50%"]');
    expect(circles.length).toBe(3);
  });

  it('propagates reduced-motion to all Skeleton children', () => {
    setReducedMotion(true);
    const { container } = render(<PageSkeleton lines={3} />);
    const skeletons = container.querySelectorAll('[data-component="Skeleton"]');
    skeletons.forEach((el) => {
      expect(el.className).toContain(styles.static);
      expect(el.className).not.toContain(styles.shimmer);
    });
  });
});

describe('Skeleton radius prop branches', () => {
  beforeEach(() => setReducedMotion(false));

  it('applies a numeric radius as px value', () => {
    // typeof radius === 'number' branch (PageSkeleton.tsx line 41)
    const { container } = render(<Skeleton radius={8} />);
    const el = container.querySelector('[data-component="Skeleton"]') as HTMLElement;
    expect(el.style.borderRadius).toBe('8px');
  });

  it('applies a string radius value verbatim (covers the string branch at line 41)', () => {
    // typeof radius === 'number' ? `${radius}px` : radius
    // The string side is the uncovered branch — e.g. passing '50%' directly.
    const { container } = render(<Skeleton radius="50%" />);
    const el = container.querySelector('[data-component="Skeleton"]') as HTMLElement;
    expect(el.style.borderRadius).toBe('50%');
  });

  it('falls back to var(--radius-sm) when radius is undefined and circle is false', () => {
    const { container } = render(<Skeleton />);
    const el = container.querySelector('[data-component="Skeleton"]') as HTMLElement;
    expect(el.style.borderRadius).toBe('var(--radius-sm)');
  });

  it('accepts string width and height', () => {
    const { container } = render(<Skeleton width="50%" height="2em" />);
    const el = container.querySelector('[data-component="Skeleton"]') as HTMLElement;
    expect(el.style.width).toBe('50%');
    expect(el.style.height).toBe('2em');
  });
});
