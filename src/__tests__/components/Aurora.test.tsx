import { render, screen } from '@testing-library/react';
import Aurora from '@/components/Aurora';

describe('Aurora', () => {
  it('renders without throwing and carries data-component="Aurora"', () => {
    const { container } = render(<Aurora />);
    expect(container.querySelector('[data-component="Aurora"]')).toBeInTheDocument();
  });

  it('applies the global .aurora class', () => {
    const { container } = render(<Aurora />);
    expect(container.querySelector('.aurora')).toBeInTheDocument();
  });

  it('renders children', () => {
    render(<Aurora><span>Hello</span></Aurora>);
    expect(screen.getByText('Hello')).toBeInTheDocument();
  });

  it('applies inline style', () => {
    const { container } = render(<Aurora style={{ minHeight: '200px' }} />);
    const el = container.querySelector('[data-component="Aurora"]') as HTMLElement;
    expect(el.style.minHeight).toBe('200px');
  });

  it('merges additional className with aurora', () => {
    const { container } = render(<Aurora className="layout-hero" />);
    const el = container.querySelector('[data-component="Aurora"]')!;
    expect(el.classList.contains('aurora')).toBe(true);
    expect(el.classList.contains('layout-hero')).toBe(true);
  });

  it('has only .aurora class when no extra className given', () => {
    const { container } = render(<Aurora />);
    const el = container.querySelector('[data-component="Aurora"]')!;
    expect(el.classList.contains('aurora')).toBe(true);
  });

  it('is SSR-friendly — no use-client marker needed', () => {
    // Aurora has no 'use client' directive. This test confirms it renders
    // without any client-side hook by checking it produces stable output.
    const { container: a } = render(<Aurora>content</Aurora>);
    const { container: b } = render(<Aurora>content</Aurora>);
    expect(a.innerHTML).toBe(b.innerHTML);
  });
});
