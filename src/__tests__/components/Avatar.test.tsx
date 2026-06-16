import { render } from '@testing-library/react';
import Avatar from '@/components/Avatar';

describe('Avatar', () => {
  it('renders without throwing', () => {
    const { container } = render(<Avatar />);
    expect(container.firstChild).not.toBeNull();
  });

  it('carries data-component="Avatar" sentinel', () => {
    const { container } = render(<Avatar />);
    expect(container.querySelector('[data-component="Avatar"]')).toBeInTheDocument();
  });

  describe('initials mode', () => {
    it('shows first initial uppercased', () => {
      const { getByText } = render(<Avatar name="alice" />);
      expect(getByText('A')).toBeInTheDocument();
    });

    it('uses only the first word initial (not first+last)', () => {
      const { getByText } = render(<Avatar name="Alice Wonderland" />);
      expect(getByText('A')).toBeInTheDocument();
      // "W" from last name should NOT appear
      expect(() => getByText('AW')).toThrow();
    });

    it('defaults to "?" when name is not provided', () => {
      const { getByText } = render(<Avatar />);
      expect(getByText('?')).toBeInTheDocument();
    });

    it('uses gradient background by default', () => {
      const { container } = render(<Avatar name="Bob" />);
      const el = container.querySelector('[data-component="Avatar"]') as HTMLElement;
      expect(el.style.background).toContain('var(--accent)');
    });

    it('uses custom color when provided', () => {
      const { container } = render(<Avatar name="Carol" color="#ff0000" />);
      const el = container.querySelector('[data-component="Avatar"]') as HTMLElement;
      // jsdom normalises #ff0000 → rgb(255, 0, 0) in both .style and getAttribute
      expect(el.style.background).toMatch(/rgb\(255,\s*0,\s*0\)/);
    });
  });

  describe('image mode', () => {
    it('does not render initials when src is provided', () => {
      const { queryByText } = render(
        <Avatar name="Dave" src="https://example.com/avatar.jpg" />,
      );
      // jsdom doesn't evaluate url() in background shorthand — the key check
      // is that the initial letter is NOT rendered when src is provided.
      expect(queryByText('D')).toBeNull();
    });

    it('has role="img" and aria-label in image mode', () => {
      const { container } = render(
        <Avatar name="Eve" src="https://example.com/eve.jpg" />,
      );
      const el = container.querySelector('[data-component="Avatar"]')!;
      expect(el).toHaveAttribute('role', 'img');
      expect(el).toHaveAttribute('aria-label', 'Eve');
    });
  });

  it('applies custom size via inline style', () => {
    const { container } = render(<Avatar name="Frank" size={56} />);
    const el = container.querySelector('[data-component="Avatar"]') as HTMLElement;
    expect(el.style.width).toBe('56px');
    expect(el.style.height).toBe('56px');
  });

  it('defaults to 36px size', () => {
    const { container } = render(<Avatar name="Grace" />);
    const el = container.querySelector('[data-component="Avatar"]') as HTMLElement;
    expect(el.style.width).toBe('36px');
  });
});
