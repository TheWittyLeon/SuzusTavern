/**
 * LEVELUP-UX — SpellInfoPopover: the spell-details toggletip mounted on the
 * level-up spell picker and both SpellbookPanel tabs.
 *
 * Contract under test: hover on the wrapper OR click/focus on the ⓘ trigger
 * opens the panel (data is inline on the entry — no fetch); click-again /
 * blur / Escape / mouseleave close it; Escape is CONSUMED while open (the
 * consumeEscape invariant — it must never fall through to a parent overlay)
 * but left alone while closed; absent fields (pre-upgrade backend) degrade
 * to an explicit "no details" line, never an empty panel.
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';

import SpellInfoPopover, {
  formatComponents,
} from '../../components/SpellInfoPopover';

const FIREBALL = {
  name: 'Fireball',
  level: 3,
  school: 'evocation',
  concentration: false,
  ritual: false,
  casting_time: '1 action',
  range: '150 feet',
  components: { V: true, S: true, M: 'a tiny ball of bat guano and sulfur' },
  duration: 'Instantaneous',
  description: 'A bright streak flashes from your pointing finger.',
  higher_levels: 'The damage increases by 1d6 per slot level above 3rd.',
};

describe('formatComponents', () => {
  it('renders V/S flags and expands a material string', () => {
    expect(formatComponents({ V: true, S: true, M: 'a bit of fur' })).toBe(
      'V, S, M (a bit of fur)',
    );
  });

  it('renders a bare true material as just the letter', () => {
    expect(formatComponents({ V: true, M: true })).toBe('V, M');
  });

  it('drops false/absent flags and handles undefined', () => {
    expect(formatComponents({ V: true, S: false })).toBe('V');
    expect(formatComponents(undefined)).toBe('');
  });
});

describe('SpellInfoPopover', () => {
  it('renders children and a collapsed trigger; no panel in the DOM', () => {
    render(<SpellInfoPopover spell={FIREBALL}>Fireball</SpellInfoPopover>);
    expect(screen.getByText('Fireball')).toBeInTheDocument();
    const trigger = screen.getByRole('button', { name: /spell details: fireball/i });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText(/casting time/i)).not.toBeInTheDocument();
  });

  it('click opens the panel with every detail row, click again closes', () => {
    render(<SpellInfoPopover spell={FIREBALL}>Fireball</SpellInfoPopover>);
    const trigger = screen.getByRole('button', { name: /spell details/i });

    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Casting time')).toBeInTheDocument();
    expect(screen.getByText('1 action')).toBeInTheDocument();
    expect(screen.getByText('Range')).toBeInTheDocument();
    expect(screen.getByText('150 feet')).toBeInTheDocument();
    expect(screen.getByText('Components')).toBeInTheDocument();
    expect(
      screen.getByText('V, S, M (a tiny ball of bat guano and sulfur)'),
    ).toBeInTheDocument();
    expect(screen.getByText('Duration')).toBeInTheDocument();
    expect(screen.getByText('Instantaneous')).toBeInTheDocument();
    expect(screen.getByText(/bright streak flashes/i)).toBeInTheDocument();
    expect(screen.getByText(/1d6 per slot level/i)).toBeInTheDocument();
    // Header meta: level + school.
    expect(screen.getByText(/level 3 · evocation/i)).toBeInTheDocument();

    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Casting time')).not.toBeInTheDocument();
  });

  it('prefixes Concentration onto the duration row', () => {
    render(
      <SpellInfoPopover
        spell={{ ...FIREBALL, concentration: true, duration: 'up to 1 minute' }}
      >
        Fireball
      </SpellInfoPopover>,
    );
    fireEvent.click(screen.getByRole('button', { name: /spell details/i }));
    expect(screen.getByText('Concentration, up to 1 minute')).toBeInTheDocument();
  });

  it('labels a cantrip as Cantrip, not Level 0', () => {
    render(
      <SpellInfoPopover spell={{ ...FIREBALL, name: 'Fire Bolt', level: 0 }}>
        Fire Bolt
      </SpellInfoPopover>,
    );
    fireEvent.click(screen.getByRole('button', { name: /spell details/i }));
    expect(screen.getByText(/cantrip · evocation/i)).toBeInTheDocument();
  });

  it('hover on the wrapper opens; mouseleave closes (and unpins)', () => {
    render(<SpellInfoPopover spell={FIREBALL}>Fireball</SpellInfoPopover>);
    const trigger = screen.getByRole('button', { name: /spell details/i });
    const wrap = trigger.parentElement as HTMLElement;

    fireEvent.mouseEnter(wrap);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    fireEvent.mouseLeave(wrap);
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    // Pinned open by click, then the mouse leaves — must still close.
    fireEvent.mouseEnter(wrap);
    fireEvent.click(trigger);
    fireEvent.mouseLeave(wrap);
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('focus opens, blur closes', () => {
    render(<SpellInfoPopover spell={FIREBALL}>Fireball</SpellInfoPopover>);
    const trigger = screen.getByRole('button', { name: /spell details/i });
    fireEvent.focus(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    fireEvent.blur(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('Escape while open closes AND is consumed; while closed it bubbles', () => {
    const outerKeyDown = jest.fn();
    render(
      <div onKeyDown={outerKeyDown}>
        <SpellInfoPopover spell={FIREBALL}>Fireball</SpellInfoPopover>
      </div>,
    );
    const trigger = screen.getByRole('button', { name: /spell details/i });

    fireEvent.click(trigger);
    fireEvent.keyDown(trigger, { key: 'Escape' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    // consumeEscape stopPropagation — the parent never sees the open-Escape.
    expect(outerKeyDown).not.toHaveBeenCalled();

    // Closed: Escape is NOT ours — it must reach the parent (e.g. a modal
    // that owns the popover's row).
    fireEvent.keyDown(trigger, { key: 'Escape' });
    expect(outerKeyDown).toHaveBeenCalledTimes(1);
  });

  it('pointerdown outside closes a pinned-open panel (iOS no-focus backstop)', () => {
    render(
      <>
        <SpellInfoPopover spell={FIREBALL}>Fireball</SpellInfoPopover>
        <button type="button">elsewhere</button>
      </>,
    );
    const trigger = screen.getByRole('button', { name: /spell details/i });
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    fireEvent.pointerDown(screen.getByRole('button', { name: 'elsewhere' }));
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('degrades to an explicit no-details line when the entry has no info fields', () => {
    render(
      <SpellInfoPopover spell={{ name: 'Mystery', level: 1 }}>
        Mystery
      </SpellInfoPopover>,
    );
    fireEvent.click(screen.getByRole('button', { name: /spell details/i }));
    expect(screen.getByText(/no details available/i)).toBeInTheDocument();
    expect(screen.queryByText('Casting time')).not.toBeInTheDocument();
  });
});
