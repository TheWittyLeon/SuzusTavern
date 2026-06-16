import { render } from '@testing-library/react';
import Card from '@/components/Card';

describe('Card', () => {
  it('renders without throwing', () => {
    const { container } = render(<Card>content</Card>);
    expect(container.firstChild).not.toBeNull();
  });

  it('carries data-component="Card" sentinel', () => {
    const { container } = render(<Card />);
    expect(container.querySelector('[data-component="Card"]')).toBeInTheDocument();
  });

  it('applies the .glass class', () => {
    const { container } = render(<Card />);
    expect(container.querySelector('.glass')).toBeInTheDocument();
  });

  it('padding=true (default) sets padding via inline style', () => {
    const { container } = render(<Card>x</Card>);
    const el = container.querySelector('[data-component="Card"]') as HTMLElement;
    expect(el.style.padding).toBe('var(--density-pad)');
  });

  it('padding=false sets padding to 0', () => {
    const { container } = render(<Card padding={false}>x</Card>);
    const el = container.querySelector('[data-component="Card"]') as HTMLElement;
    // jsdom normalises the integer 0 to '0px'
    expect(el.style.padding).toMatch(/^0(px)?$/);
  });

  it('pop=false (default) uses --shadow-soft', () => {
    const { container } = render(<Card>x</Card>);
    const el = container.querySelector('[data-component="Card"]') as HTMLElement;
    expect(el.style.boxShadow).toBe('var(--shadow-soft)');
  });

  it('pop=true uses --shadow-pop', () => {
    const { container } = render(<Card pop>x</Card>);
    const el = container.querySelector('[data-component="Card"]') as HTMLElement;
    expect(el.style.boxShadow).toBe('var(--shadow-pop)');
  });

  it('accepts extra className', () => {
    const { container } = render(<Card className="my-card">x</Card>);
    expect(container.querySelector('.my-card')).toBeInTheDocument();
  });

  it('renders as a <section> when as="section"', () => {
    const { container } = render(<Card as="section">x</Card>);
    expect(container.querySelector('section')).toBeInTheDocument();
  });

  it('renders children', () => {
    const { getByText } = render(<Card>Hello Tavern</Card>);
    expect(getByText('Hello Tavern')).toBeInTheDocument();
  });
});
