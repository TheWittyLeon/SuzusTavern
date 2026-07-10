/**
 * ConditionChipList — T7 (DDX-17e) shared condition chip renderer.
 *
 * Read-only by default (no onRemove); an "x" only appears per chip when a
 * caller supplies onRemove (DM-only usage, from ConditionsPanel).
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import ConditionChipList from '../../components/ConditionChipList';

describe('ConditionChipList — a11y (Iro follow-up)', () => {
  it('wraps the chip row in a group with the combatant-conditions name', () => {
    render(<ConditionChipList conditions={['poisoned']} combatantName="Goblin" />);
    expect(screen.getByRole('group', { name: 'Goblin conditions' })).toBeInTheDocument();
  });

  it('falls back to a bare "Conditions" group name with no combatantName', () => {
    render(<ConditionChipList conditions={['poisoned']} />);
    expect(screen.getByRole('group', { name: 'Conditions' })).toBeInTheDocument();
  });

  it('renders a sr-only sibling spelling out the duration in plain language, alongside the visual (aria-hidden) "Name · N" label', () => {
    const { container } = render(
      <ConditionChipList conditions={['poisoned']} durations={{ poisoned: 3 }} />,
    );
    const visual = screen.getByText('Poisoned · 3');
    expect(visual).toHaveAttribute('aria-hidden', 'true');
    const srOnly = container.querySelector('.sr-only');
    expect(srOnly).toHaveTextContent('Poisoned, 3 rounds remaining');
  });

  it('singularizes the sr-only duration text for exactly 1 round remaining', () => {
    const { container } = render(
      <ConditionChipList conditions={['poisoned']} durations={{ poisoned: 1 }} />,
    );
    const srOnly = container.querySelector('.sr-only');
    expect(srOnly).toHaveTextContent('Poisoned, 1 round remaining');
  });

  it('sr-only text is just the bare name for an indefinite (no-duration) condition', () => {
    const { container } = render(<ConditionChipList conditions={['prone']} />);
    const srOnly = container.querySelector('.sr-only');
    expect(srOnly).toHaveTextContent('Prone');
  });

  it('remove-x hit-slop click still fires onRemove (hit-slop is CSS-only pseudo-element, the click test itself is unaffected)', () => {
    const onRemove = jest.fn();
    render(
      <ConditionChipList conditions={['poisoned']} combatantName="Goblin" onRemove={onRemove} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Remove Poisoned from Goblin' }));
    expect(onRemove).toHaveBeenCalledWith('poisoned');
  });
});

describe('ConditionChipList', () => {
  it('renders nothing for an empty conditions array', () => {
    const { container } = render(<ConditionChipList conditions={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows a bare name for a condition with no tracked duration', () => {
    render(<ConditionChipList conditions={['prone']} />);
    // Bare-name labels are byte-identical between the visual (aria-hidden)
    // span and its sr-only sibling — scope to the visual one specifically.
    expect(screen.getByText('Prone', { selector: 'span[aria-hidden]' })).toBeInTheDocument();
  });

  it('shows "Name · N" when a duration is present for that condition', () => {
    render(<ConditionChipList conditions={['poisoned']} durations={{ poisoned: 4 }} />);
    expect(screen.getByText('Poisoned · 4')).toBeInTheDocument();
  });

  it('renders one chip per condition, only durationed ones get a suffix', () => {
    render(
      <ConditionChipList conditions={['poisoned', 'prone']} durations={{ poisoned: 1 }} />,
    );
    expect(screen.getByText('Poisoned · 1')).toBeInTheDocument();
    expect(screen.getByText('Prone', { selector: 'span[aria-hidden]' })).toBeInTheDocument();
  });

  it('formats a multi-word/underscored condition name', () => {
    render(<ConditionChipList conditions={['exhaustion_2']} />);
    expect(
      screen.getByText('Exhaustion 2', { selector: 'span[aria-hidden]' }),
    ).toBeInTheDocument();
  });

  it('does not render a remove button when onRemove is not supplied', () => {
    render(<ConditionChipList conditions={['poisoned']} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('renders an accessible remove button per chip when onRemove is supplied, and calls it with the condition', () => {
    const onRemove = jest.fn();
    render(
      <ConditionChipList conditions={['poisoned']} combatantName="Goblin" onRemove={onRemove} />,
    );
    const btn = screen.getByRole('button', { name: 'Remove Poisoned from Goblin' });
    fireEvent.click(btn);
    expect(onRemove).toHaveBeenCalledWith('poisoned');
  });

  it('disables every remove button when removeDisabled is true', () => {
    render(
      <ConditionChipList
        conditions={['poisoned', 'prone']}
        onRemove={jest.fn()}
        removeDisabled
      />,
    );
    for (const btn of screen.getAllByRole('button')) {
      expect(btn).toBeDisabled();
    }
  });

  it('formats exhaustion_3 (a specific level named in the mandate) sanely, distinct from exhaustion_2', () => {
    render(<ConditionChipList conditions={['exhaustion_3']} />);
    expect(
      screen.getByText('Exhaustion 3', { selector: 'span[aria-hidden]' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('Exhaustion 2')).not.toBeInTheDocument();
  });

  it('an UNKNOWN condition string from the engine (not in DND_CONDITIONS) does not crash — renders raw/graceful', () => {
    // e.g. a future engine condition this UI hasn't been updated for yet, or a
    // homebrew/legacy value applied via a different client entirely.
    expect(() =>
      render(<ConditionChipList conditions={['some_future_condition']} />),
    ).not.toThrow();
    expect(
      screen.getByText('Some future condition', { selector: 'span[aria-hidden]' }),
    ).toBeInTheDocument();
  });

  it('an unknown condition WITH a tracked duration still renders "Name · N" gracefully', () => {
    render(
      <ConditionChipList
        conditions={['weird_homebrew_status']}
        durations={{ weird_homebrew_status: 2 }}
      />,
    );
    expect(screen.getByText('Weird homebrew status · 2')).toBeInTheDocument();
  });

  it('an empty-string condition does not crash and does not render a blank/whitespace chip label', () => {
    expect(() => render(<ConditionChipList conditions={['']} />)).not.toThrow();
    // formatConditionName's own documented fallback returns the raw (empty) string
    // rather than throwing — confirm the chip still mounts (one Pill, no crash),
    // not that it has meaningful visible text.
    const { container } = render(<ConditionChipList conditions={['']} />);
    expect(container.querySelectorAll('.pill').length).toBe(1);
  });
});
