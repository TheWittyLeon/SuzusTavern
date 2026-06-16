import { render, screen } from '@testing-library/react';
import Stat from '@/components/Stat';

describe('Stat', () => {
  it('renders without throwing', () => {
    const { container } = render(<Stat label="Sessions" value="42" />);
    expect(container.firstChild).not.toBeNull();
  });

  it('carries data-component="Stat" via the Card wrapper', () => {
    const { container } = render(<Stat label="HP" value="120" />);
    expect(container.querySelector('[data-component="Stat"]')).toBeInTheDocument();
  });

  it('renders the label', () => {
    render(<Stat label="Active Players" value="7" />);
    expect(screen.getByText('Active Players')).toBeInTheDocument();
  });

  it('renders the value', () => {
    render(<Stat label="HP" value="120" />);
    expect(screen.getByText('120')).toBeInTheDocument();
  });

  it('renders delta text when provided', () => {
    render(<Stat label="XP" value="2400" delta="+12% this week" />);
    expect(screen.getByText('+12% this week')).toBeInTheDocument();
  });

  it('does NOT render delta when omitted', () => {
    const { container } = render(<Stat label="HP" value="120" />);
    // No delta element — confirm container has no extra text besides label+value
    expect(screen.queryByText(/this week/)).not.toBeInTheDocument();
    // Sanity: value is still present
    expect(screen.getByText('120')).toBeInTheDocument();
    // Suppress unused var warning
    void container;
  });

  describe('deltaTone color', () => {
    it('good tone applies var(--good)', () => {
      const { container } = render(
        <Stat label="HP" value="100" delta="+5" deltaTone="good" />,
      );
      const delta = container.querySelector('[class*="delta"]') as HTMLElement;
      expect(delta.style.color).toBe('var(--good)');
    });

    it('bad tone applies var(--bad)', () => {
      const { container } = render(
        <Stat label="HP" value="100" delta="-5" deltaTone="bad" />,
      );
      const delta = container.querySelector('[class*="delta"]') as HTMLElement;
      expect(delta.style.color).toBe('var(--bad)');
    });

    it('neutral tone applies var(--ink-3)', () => {
      const { container } = render(
        <Stat label="HP" value="100" delta="no change" deltaTone="neutral" />,
      );
      const delta = container.querySelector('[class*="delta"]') as HTMLElement;
      expect(delta.style.color).toBe('var(--ink-3)');
    });

    it('defaults deltaTone to good', () => {
      const { container } = render(<Stat label="HP" value="100" delta="+5" />);
      const delta = container.querySelector('[class*="delta"]') as HTMLElement;
      expect(delta.style.color).toBe('var(--good)');
    });
  });

  describe('icon tile', () => {
    it('renders icon when provided', () => {
      const { container } = render(
        <Stat label="HP" value="100" icon={<span data-testid="icon" />} />,
      );
      expect(container.querySelector('[data-testid="icon"]')).toBeInTheDocument();
    });

    it('does NOT render icon tile when icon is omitted', () => {
      const { container } = render(<Stat label="HP" value="100" />);
      expect(container.querySelector('[class*="iconTile"]')).not.toBeInTheDocument();
    });

    it('applies accentColor to the icon tile', () => {
      const { container } = render(
        <Stat
          label="HP"
          value="100"
          icon={<span />}
          accentColor="var(--good)"
        />,
      );
      const tile = container.querySelector('[class*="iconTile"]') as HTMLElement;
      expect(tile.style.color).toBe('var(--good)');
      expect(tile.style.background).toContain('var(--good)');
    });

    it('defaults icon tile to var(--accent) when accentColor is omitted', () => {
      const { container } = render(
        <Stat label="HP" value="100" icon={<span />} />,
      );
      const tile = container.querySelector('[class*="iconTile"]') as HTMLElement;
      expect(tile.style.color).toBe('var(--accent)');
    });
  });

  it('uses the .glass Card surface', () => {
    const { container } = render(<Stat label="HP" value="100" />);
    expect(container.querySelector('.glass')).toBeInTheDocument();
  });
});
