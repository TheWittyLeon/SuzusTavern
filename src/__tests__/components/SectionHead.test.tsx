import { render, screen } from '@testing-library/react';
import SectionHead from '@/components/SectionHead';

describe('SectionHead', () => {
  it('renders without throwing', () => {
    const { container } = render(<SectionHead title="Tables" />);
    expect(container.firstChild).not.toBeNull();
  });

  it('carries data-component="SectionHead" sentinel', () => {
    const { container } = render(<SectionHead title="x" />);
    expect(container.querySelector('[data-component="SectionHead"]')).toBeInTheDocument();
  });

  it('renders the title text', () => {
    render(<SectionHead title="Active Tables" />);
    expect(screen.getByText('Active Tables')).toBeInTheDocument();
  });

  it('renders title as an <h2> by default', () => {
    const { container } = render(<SectionHead title="My Header" />);
    expect(container.querySelector('h2')).toBeInTheDocument();
    expect(container.querySelector('h2')!.textContent).toBe('My Header');
  });

  it('renders title as <h3> when level=3', () => {
    const { container } = render(<SectionHead title="Sub Header" level={3} />);
    expect(container.querySelector('h3')).toBeInTheDocument();
  });

  it('renders kicker text when provided', () => {
    render(<SectionHead kicker="Season 1" title="Campaign" />);
    expect(screen.getByText('Season 1')).toBeInTheDocument();
  });

  it('does not render kicker element when omitted', () => {
    const { container } = render(<SectionHead title="No Kicker" />);
    // The kicker div has the .label class
    const kickerCandidates = container.querySelectorAll('.label');
    expect(kickerCandidates).toHaveLength(0);
  });

  it('renders sub text when provided', () => {
    render(<SectionHead title="Title" sub="Supporting description" />);
    expect(screen.getByText('Supporting description')).toBeInTheDocument();
  });

  it('does not render sub element when omitted', () => {
    render(<SectionHead title="No Sub" />);
    expect(screen.queryByRole('paragraph')).toBeNull();
  });

  it('renders action slot when provided', () => {
    render(
      <SectionHead
        title="With Action"
        action={<button data-testid="action-btn">View All</button>}
      />,
    );
    expect(screen.getByTestId('action-btn')).toBeInTheDocument();
  });

  it('does not render action slot when omitted', () => {
    const { container } = render(<SectionHead title="No Action" />);
    // Only the left block should be present; no sibling action wrapper
    const root = container.querySelector('[data-component="SectionHead"]')!;
    // root has exactly 1 child (the left div) when action is absent
    expect(root.children).toHaveLength(1);
  });
});
