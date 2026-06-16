import { render, screen } from '@testing-library/react';
import Button from '@/components/Button';

describe('Button', () => {
  it('renders a <button> element by default', () => {
    render(<Button>Click me</Button>);
    expect(screen.getByRole('button', { name: 'Click me' })).toBeInTheDocument();
  });

  it('renders an <a> element when href is provided', () => {
    render(<Button href="/dashboard">Go</Button>);
    const link = screen.getByRole('link', { name: 'Go' });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', '/dashboard');
  });

  it('carries data-component="Button" sentinel', () => {
    const { container } = render(<Button>x</Button>);
    expect(container.querySelector('[data-component="Button"]')).toBeInTheDocument();
  });

  describe('variant → class mapping', () => {
    it('default variant has .btn class only (no variant modifier)', () => {
      const { container } = render(<Button>x</Button>);
      const el = container.querySelector('[data-component="Button"]')!;
      expect(el.className).toContain('btn');
      expect(el.className).not.toMatch(/btn-primary|btn-ghost|btn-danger|btn-crit/);
    });

    it('primary variant applies .btn-primary', () => {
      const { container } = render(<Button variant="primary">x</Button>);
      expect(container.querySelector('.btn-primary')).toBeInTheDocument();
    });

    it('ghost variant applies .btn-ghost', () => {
      const { container } = render(<Button variant="ghost">x</Button>);
      expect(container.querySelector('.btn-ghost')).toBeInTheDocument();
    });

    it('danger variant applies .btn-danger', () => {
      const { container } = render(<Button variant="danger">x</Button>);
      expect(container.querySelector('.btn-danger')).toBeInTheDocument();
    });

    it('crit variant applies .btn-crit', () => {
      const { container } = render(<Button variant="crit">x</Button>);
      expect(container.querySelector('.btn-crit')).toBeInTheDocument();
    });
  });

  describe('size → class mapping', () => {
    it('lg size applies .btn-lg', () => {
      const { container } = render(<Button size="lg">x</Button>);
      expect(container.querySelector('.btn-lg')).toBeInTheDocument();
    });

    it('icon size applies .btn-icon', () => {
      const { container } = render(
        <Button size="icon" aria-label="Open menu" />,
      );
      expect(container.querySelector('.btn-icon')).toBeInTheDocument();
    });
  });

  it('disabled button has disabled attribute', () => {
    render(<Button disabled>Disabled</Button>);
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('disabled anchor has aria-disabled and no href', () => {
    const { container } = render(
      <Button href="/somewhere" disabled>
        Disabled link
      </Button>,
    );
    // A disabled <a> (no href) has no accessible link role in jsdom;
    // query the element directly.
    const el = container.querySelector('[data-component="Button"]')!;
    expect(el.tagName).toBe('A');
    expect(el).toHaveAttribute('aria-disabled', 'true');
    expect(el).not.toHaveAttribute('href');
  });

  it('default type is "button" to prevent form submission', () => {
    render(<Button>Submit</Button>);
    expect(screen.getByRole('button')).toHaveAttribute('type', 'button');
  });

  it('accepts type="submit" override', () => {
    render(<Button type="submit">Submit</Button>);
    expect(screen.getByRole('button')).toHaveAttribute('type', 'submit');
  });

  it('renders leadingIcon and trailingIcon alongside children', () => {
    const { container } = render(
      <Button leadingIcon={<span data-testid="lead" />} trailingIcon={<span data-testid="trail" />}>
        Label
      </Button>,
    );
    expect(container.querySelector('[data-testid="lead"]')).toBeInTheDocument();
    expect(container.querySelector('[data-testid="trail"]')).toBeInTheDocument();
    expect(screen.getByText('Label')).toBeInTheDocument();
  });

  it('passes additional className through', () => {
    const { container } = render(<Button className="extra">x</Button>);
    expect(container.querySelector('.extra')).toBeInTheDocument();
  });
});
