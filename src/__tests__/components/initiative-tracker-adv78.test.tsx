/**
 * Unit tests for InitiativeTracker — CUI-11 structured (engine-driven) props.
 *
 * Coverage:
 *   - Renders turn order + current-turn indicator from CombatParticipantState[].
 *   - aria-current on the active-turn participant.
 *   - HP bar meters rendered for each participant.
 *   - Dead participant shown with reduced opacity (dead CSS class applied).
 *   - Downed PC shows ↓ indicator + aria-live death-save region.
 *   - Legacy InitEntry prop shape still renders (backward compat).
 */
import React from 'react';
import { render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import InitiativeTracker from '@/components/InitiativeTracker';
import type { CombatParticipantState } from '@/lib/api/types';
import type { InitEntry } from '@/components/InitiativeTracker';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const VELKA: CombatParticipantState = {
  participant_id: 'p_velka',
  entity_id: '1',
  name: 'Velka',
  is_pc: true,
  initiative: 18,
  hp_current: 8,
  hp_max: 10,
  ac: 14,
  conditions: [],
  is_alive: true,
  can_be_targeted: true,
  is_active_turn: true,
  took_turn: false,
  death_saves: { successes: 0, failures: 0, is_downed: false, is_dying: false, is_stable: false, is_dead: false },
};

const GOBLIN: CombatParticipantState = {
  participant_id: 'p_gob1',
  entity_id: 'goblin',
  name: 'Goblin',
  is_pc: false,
  initiative: 12,
  hp_current: 7,
  hp_max: 7,
  ac: 13,
  conditions: [],
  is_alive: true,
  can_be_targeted: true,
  is_active_turn: false,
  took_turn: false,
};

const DEAD_GOBLIN: CombatParticipantState = {
  ...GOBLIN,
  hp_current: 0,
  is_alive: false,
  can_be_targeted: false,
  is_active_turn: false,
};

const DOWNED_VELKA: CombatParticipantState = {
  ...VELKA,
  hp_current: 0,
  death_saves: { successes: 1, failures: 2, is_downed: true, is_dying: true, is_stable: false, is_dead: false },
};

// ── Structured renderer (CUI-11) ─────────────────────────────────────────────

describe('InitiativeTracker — structured (engine-driven) props', () => {
  it('renders all participant names', () => {
    render(<InitiativeTracker participants={[VELKA, GOBLIN]} round={2} />);
    expect(screen.getByText('Velka')).toBeInTheDocument();
    expect(screen.getByText('Goblin')).toBeInTheDocument();
  });

  it('shows the round number', () => {
    render(<InitiativeTracker participants={[VELKA]} round={3} />);
    expect(screen.getByText(/round 3/i)).toBeInTheDocument();
  });

  it('marks the active-turn participant with aria-current="true"', () => {
    render(<InitiativeTracker participants={[VELKA, GOBLIN]} round={1} />);
    const items = screen.getAllByRole('listitem');
    const velkaItem = items.find((el) => el.textContent?.includes('Velka'));
    expect(velkaItem).toBeDefined();
    expect(velkaItem).toHaveAttribute('aria-current', 'true');
    // Goblin is NOT active turn.
    const goblinItem = items.find((el) => el.textContent?.includes('Goblin'));
    expect(goblinItem).not.toHaveAttribute('aria-current');
  });

  it('renders HP meters for each participant', () => {
    render(<InitiativeTracker participants={[VELKA, GOBLIN]} round={1} />);
    const meters = screen.getAllByRole('meter');
    expect(meters.length).toBe(2); // One per participant with hp_max > 0.
  });

  it('shows "you" badge for the self participant', () => {
    render(
      <InitiativeTracker
        participants={[VELKA, GOBLIN]}
        round={1}
        selfParticipantId="p_velka"
      />,
    );
    expect(screen.getByText('you')).toBeInTheDocument();
  });

  it('does not show "you" badge when selfParticipantId is null', () => {
    render(
      <InitiativeTracker
        participants={[VELKA, GOBLIN]}
        round={1}
        selfParticipantId={null}
      />,
    );
    expect(screen.queryByText('you')).not.toBeInTheDocument();
  });

  it('renders nothing when participants array is empty', () => {
    const { container } = render(<InitiativeTracker participants={[]} round={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('dead participant does not have aria-current', () => {
    render(<InitiativeTracker participants={[VELKA, DEAD_GOBLIN]} round={1} />);
    const items = screen.getAllByRole('listitem');
    const goblinItem = items.find((el) => el.textContent?.includes('Goblin'));
    expect(goblinItem).not.toHaveAttribute('aria-current', 'true');
  });

  it('downed PC shows ↓ indicator with aria-label', () => {
    render(<InitiativeTracker participants={[DOWNED_VELKA, GOBLIN]} round={1} />);
    expect(
      // A11Y fix (Iro MINOR-1): aria-label no longer repeats the name (already in .name span).
      screen.getByLabelText(/downed.*death saves/i),
    ).toBeInTheDocument();
  });

  it('downed PC death-save live region has correct text', () => {
    render(<InitiativeTracker participants={[DOWNED_VELKA, GOBLIN]} round={1} />);
    // The assertive live region text includes successes/failures.
    expect(
      screen.getByText(/1 success.*2 failure/i),
    ).toBeInTheDocument();
  });

  it('shows AC for participants', () => {
    render(<InitiativeTracker participants={[VELKA]} round={1} />);
    // TAV-INITIATIVE-PANEL-UNLABELLED-NUMBERS (2026-08-06): AC used to be
    // labelled with `aria-label="AC 14"` on a bare <span>. ARIA 1.2 prohibits
    // aria-label on role=generic, so it is now a visible aria-hidden "AC" key
    // plus a visually-hidden "armor class" word (the EnvBanner pattern). The
    // AC is still shown and still announced — only the mechanism changed.
    // Full labelling coverage lives in InitiativeTracker.test.tsx.
    const row = screen.getByText(VELKA.name).closest('li') as HTMLElement;
    expect(row).toHaveTextContent('AC');
    expect(row).toHaveTextContent('14');
    expect(within(row).getByText('armor class')).toBeInTheDocument();
  });
});

// ── T7 (DDX-17e): condition chips (read-only, all-clients) ──────────────────

describe('InitiativeTracker — T7 condition chips', () => {
  const POISONED_VELKA: CombatParticipantState = {
    ...VELKA,
    conditions: ['poisoned'],
    condition_durations: { poisoned: 3 },
  };

  it('renders a chip with the condition name + duration when the engine tracks one', () => {
    render(<InitiativeTracker participants={[POISONED_VELKA, GOBLIN]} round={1} />);
    expect(screen.getByText('Poisoned · 3')).toBeInTheDocument();
  });

  it('renders a name-only chip when the condition has no tracked duration (indefinite)', () => {
    const PRONE_GOBLIN: CombatParticipantState = { ...GOBLIN, conditions: ['prone'] };
    render(<InitiativeTracker participants={[VELKA, PRONE_GOBLIN]} round={1} />);
    // A11Y follow-up: ConditionChipList now renders a visible (aria-hidden)
    // label alongside an sr-only duration-spelled-out sibling — for a
    // no-duration condition the two are byte-identical text, so scope to
    // the visual span specifically.
    expect(screen.getByText('Prone', { selector: 'span[aria-hidden]' })).toBeInTheDocument();
  });

  it('renders multiple chips for a combatant with more than one active condition', () => {
    const MULTI: CombatParticipantState = {
      ...VELKA,
      conditions: ['poisoned', 'prone'],
      condition_durations: { poisoned: 2 },
    };
    render(<InitiativeTracker participants={[MULTI, GOBLIN]} round={1} />);
    expect(screen.getByText('Poisoned · 2')).toBeInTheDocument();
    // A11Y follow-up: ConditionChipList now renders a visible (aria-hidden)
    // label alongside an sr-only duration-spelled-out sibling — for a
    // no-duration condition the two are byte-identical text, so scope to
    // the visual span specifically.
    expect(screen.getByText('Prone', { selector: 'span[aria-hidden]' })).toBeInTheDocument();
  });

  it('renders no chips when a participant has no active conditions', () => {
    render(<InitiativeTracker participants={[VELKA, GOBLIN]} round={1} />);
    expect(screen.queryByText(/·/)).not.toBeInTheDocument();
  });

  it('never renders a remove control — InitiativeTracker is read-only for every client', () => {
    render(<InitiativeTracker participants={[POISONED_VELKA]} round={1} />);
    expect(screen.queryByRole('button', { name: /remove/i })).not.toBeInTheDocument();
  });
});

// ── Legacy renderer (backward compat) ────────────────────────────────────────

describe('InitiativeTracker — legacy InitEntry props (backward compat)', () => {
  const entries: InitEntry[] = [
    { id: 'pc-alice', name: 'Velka', initiative: 18, kind: 'pc', isYou: true },
    { id: 'g1', name: 'Goblin', initiative: 12, kind: 'monster' },
  ];

  it('renders entries and round with legacy props', () => {
    render(<InitiativeTracker entries={entries} round={3} currentIndex={0} />);
    expect(screen.getByText('round 3')).toBeInTheDocument();
    expect(screen.getByText('Velka')).toBeInTheDocument();
    expect(screen.getByText('Goblin')).toBeInTheDocument();
  });

  it('marks currentIndex entry as aria-current', () => {
    render(<InitiativeTracker entries={entries} round={1} currentIndex={0} />);
    const items = screen.getAllByRole('listitem');
    expect(items[0]).toHaveAttribute('aria-current', 'true');
    expect(items[1]).not.toHaveAttribute('aria-current');
  });

  it('renders nothing with empty entries', () => {
    const { container } = render(<InitiativeTracker entries={[]} round={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
