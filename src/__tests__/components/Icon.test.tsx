import { render } from '@testing-library/react';
import Icon from '@/components/Icon';

describe('Icon', () => {
  it('renders an <svg> element', () => {
    const { container } = render(<Icon name="Home" />);
    expect(container.querySelector('svg')).toBeInTheDocument();
  });

  it('is aria-hidden by default (decorative)', () => {
    const { container } = render(<Icon name="Home" />);
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it('becomes role="img" with aria-label when title is provided', () => {
    const { container } = render(<Icon name="Home" title="Go home" />);
    const svg = container.querySelector('svg')!;
    expect(svg).toHaveAttribute('role', 'img');
    expect(svg).toHaveAttribute('aria-label', 'Go home');
    expect(svg).not.toHaveAttribute('aria-hidden');
  });

  it('becomes role="img" with aria-label when label is provided', () => {
    const { container } = render(<Icon name="Bell" label="Notifications" />);
    const svg = container.querySelector('svg')!;
    expect(svg).toHaveAttribute('role', 'img');
    expect(svg).toHaveAttribute('aria-label', 'Notifications');
  });

  it('title takes precedence over label', () => {
    const { container } = render(
      <Icon name="Search" title="Primary" label="Secondary" />,
    );
    expect(container.querySelector('svg')).toHaveAttribute('aria-label', 'Primary');
  });

  it('renders correct SVG content for Home icon', () => {
    const { container } = render(<Icon name="Home" />);
    // The Home icon has two <path> elements
    expect(container.querySelectorAll('path').length).toBeGreaterThanOrEqual(2);
  });

  it('renders correct SVG content for D6 icon (has fill circles)', () => {
    const { container } = render(<Icon name="D6" />);
    expect(container.querySelectorAll('circle').length).toBeGreaterThan(0);
  });

  it('applies custom size', () => {
    const { container } = render(<Icon name="Sword" size={32} />);
    const svg = container.querySelector('svg')!;
    expect(svg).toHaveAttribute('width', '32');
    expect(svg).toHaveAttribute('height', '32');
  });

  it('defaults to size 24', () => {
    const { container } = render(<Icon name="Sparkle" />);
    const svg = container.querySelector('svg')!;
    expect(svg).toHaveAttribute('width', '24');
  });

  it('has viewBox 0 0 24 24', () => {
    const { container } = render(<Icon name="Check" />);
    expect(container.querySelector('svg')).toHaveAttribute('viewBox', '0 0 24 24');
  });

  it('renders class glyphs without throwing — Rogue', () => {
    expect(() => render(<Icon name="Rogue" />)).not.toThrow();
  });

  it('renders class glyphs without throwing — Wizard', () => {
    expect(() => render(<Icon name="Wizard" />)).not.toThrow();
  });

  it('renders preview-only icons without throwing — Bot', () => {
    expect(() => render(<Icon name="Bot" />)).not.toThrow();
  });

  it('renders preview-only icons without throwing — Pulse', () => {
    expect(() => render(<Icon name="Pulse" />)).not.toThrow();
  });

  it('renders preview-only icons without throwing — History', () => {
    expect(() => render(<Icon name="History" />)).not.toThrow();
  });

  it('renders preview-only icons without throwing — Sliders', () => {
    expect(() => render(<Icon name="Sliders" />)).not.toThrow();
  });

  it('renders preview-only fantasy icons — Quill', () => {
    expect(() => render(<Icon name="Quill" />)).not.toThrow();
  });

  it('renders preview-only fantasy icons — Pair', () => {
    expect(() => render(<Icon name="Pair" />)).not.toThrow();
  });
});
