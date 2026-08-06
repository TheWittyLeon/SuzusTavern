/**
 * InitiativeTracker — TAV-INITIATIVE-PANEL-UNLABELLED-NUMBERS (2026-08-06).
 *
 * Before this diff, AC and initiative rendered as two bare numbers with no
 * visible or accessible distinguishing label ("Goblin #1  15 21" reads as a
 * fraction) and the structured `.init` span had NO accessible label at all.
 * There was no dedicated test file for this component — coverage only existed
 * indirectly via combat-ui-adv78.test.tsx, which never asserted on labelling.
 *
 * WHY THESE ASSERT ON TEXT, NOT `getByLabelText` (Kage-CR #5, 2026-08-06):
 * the first version of both the component and this file used `aria-label` on
 * the wrapping spans. ARIA 1.2 prohibits aria-label on role=generic — a bare
 * `<span>` — so honouring it is inconsistent across AT, and where it is
 * IGNORED the aria-hidden key is still stripped and the accessible name
 * collapses back to "15"/"21": the original bug, in the exact AT this ticket
 * targets. The component now uses a visible abbreviation (aria-hidden) plus a
 * visually-hidden real word, the pattern EnvBanner already uses.
 *
 * `getByLabelText` would not have caught that — it queries the ATTRIBUTE, it
 * does not compute an accessible name. These tests deliberately assert on the
 * rendered text the AT will actually traverse.
 */
import React from 'react';
import { render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import InitiativeTracker, { type InitEntry } from '@/components/InitiativeTracker';
import type { CombatParticipantState } from '@/lib/api/types';

function makeParticipant(overrides: Partial<CombatParticipantState> = {}): CombatParticipantState {
  return {
    participant_id: 'p1',
    entity_id: 'c1',
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
    ...overrides,
  };
}

/** The <li> for a combatant — the unit an AT user actually traverses. */
function rowFor(name: string): HTMLElement {
  return screen.getByText(name).closest('li') as HTMLElement;
}

/** What a screen reader would announce for a row: text content with every
 *  aria-hidden subtree removed. This is the assertion that has teeth — it is
 *  what the AT traversal yields, not what the DOM happens to contain. */
function accessibleText(row: HTMLElement): string {
  const clone = row.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('[aria-hidden="true"]').forEach((n) => n.remove());
  return (clone.textContent ?? '').replace(/\s+/g, ' ').trim();
}

describe('InitiativeTracker — structured renderer — AC/INIT labelling', () => {
  it('announces "armor class 15", not a bare "15"', () => {
    render(<InitiativeTracker participants={[makeParticipant({ ac: 15 })]} round={1} />);
    expect(accessibleText(rowFor('Velka'))).toContain('armor class 15');
  });

  it('announces "initiative 21" — previously this number had NO label at all', () => {
    render(<InitiativeTracker participants={[makeParticipant({ initiative: 21 })]} round={1} />);
    expect(accessibleText(rowFor('Velka'))).toContain('initiative 21');
  });

  it('shows the visible "AC" / "INIT" keys, and hides them from AT so nothing doubles up', () => {
    render(
      <InitiativeTracker participants={[makeParticipant({ ac: 15, initiative: 21 })]} round={1} />,
    );
    const row = rowFor('Velka');

    // Visible: the two numbers are no longer adjacent and unlabelled.
    expect(row).toHaveTextContent('AC');
    expect(row).toHaveTextContent('INIT');
    expect(within(row).getByText('AC')).toHaveAttribute('aria-hidden');
    expect(within(row).getByText('INIT')).toHaveAttribute('aria-hidden');

    // Audible: exactly once each — a naive implementation announces "AC AC 15".
    const spoken = accessibleText(row);
    expect(spoken).toContain('armor class 15');
    expect(spoken).toContain('initiative 21');
    expect(spoken).not.toMatch(/\bAC\b/);
    expect(spoken).not.toMatch(/\bINIT\b/);
  });

  it('initiative 0 is a real roll and is announced as such', () => {
    render(<InitiativeTracker participants={[makeParticipant({ initiative: 0 })]} round={1} />);
    expect(accessibleText(rowFor('Velka'))).toContain('initiative 0');
  });

  it('AC is omitted entirely when ac <= 0, without suppressing initiative', () => {
    render(<InitiativeTracker participants={[makeParticipant({ ac: 0 })]} round={1} />);
    const row = rowFor('Velka');
    expect(within(row).queryByText('AC')).not.toBeInTheDocument();
    expect(accessibleText(row)).not.toContain('armor class');
    expect(within(row).getByText('INIT')).toBeInTheDocument();
    expect(accessibleText(row)).toContain('initiative');
  });

  it('two combatants get independent, non-cross-contaminated labels', () => {
    render(
      <InitiativeTracker
        participants={[
          makeParticipant({ participant_id: 'p1', name: 'Velka', ac: 14, initiative: 18 }),
          makeParticipant({
            participant_id: 'p2',
            name: 'Goblin',
            is_pc: false,
            ac: 13,
            initiative: 9,
            is_active_turn: false,
          }),
        ]}
        round={1}
      />,
    );
    const velka = accessibleText(rowFor('Velka'));
    const goblin = accessibleText(rowFor('Goblin'));

    expect(velka).toContain('armor class 14');
    expect(velka).toContain('initiative 18');
    expect(goblin).toContain('armor class 13');
    expect(goblin).toContain('initiative 9');
    expect(velka).not.toContain('armor class 13');
    expect(goblin).not.toContain('armor class 14');
  });
});

describe('InitiativeTracker — legacy renderer — INIT labelling', () => {
  function renderLegacy(entries: InitEntry[]) {
    return render(<InitiativeTracker entries={entries} round={1} currentIndex={0} />);
  }

  it('a rolled initiative announces "initiative 18"', () => {
    renderLegacy([{ id: 'e1', name: 'Velka', initiative: 18, kind: 'pc' }]);
    expect(accessibleText(rowFor('Velka'))).toContain('initiative 18');
  });

  it('an UNROLLED initiative announces "not rolled" — never "null", and never a bare em-dash', () => {
    renderLegacy([{ id: 'e1', name: 'Velka', initiative: null, kind: 'pc' }]);
    const row = rowFor('Velka');

    expect(accessibleText(row)).toContain('initiative not rolled');
    expect(accessibleText(row)).not.toContain('null');
    // The glyph is still there for sighted users, but hidden from AT: "—" is
    // read as punctuation or skipped, which is how this became a bare number.
    expect(row).toHaveTextContent('—');
    expect(accessibleText(row)).not.toContain('—');
  });

  it('initiative 0 in the legacy shape is a real roll, not "not rolled"', () => {
    renderLegacy([{ id: 'e1', name: 'Velka', initiative: 0, kind: 'pc' }]);
    const spoken = accessibleText(rowFor('Velka'));
    expect(spoken).toContain('initiative 0');
    expect(spoken).not.toContain('not rolled');
  });

  it('legacy renderer never shows AC at all — no stray key or label', () => {
    renderLegacy([{ id: 'e1', name: 'Velka', initiative: 12, kind: 'pc' }]);
    const row = rowFor('Velka');
    expect(within(row).queryByText('AC')).not.toBeInTheDocument();
    expect(accessibleText(row)).not.toContain('armor class');
  });
});
