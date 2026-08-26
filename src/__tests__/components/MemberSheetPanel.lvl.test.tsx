/**
 * LVL (Aoi gap B / Kage m4) — MemberSheetPanel's self-view pending-choices
 * callout. The drawer is deliberately read-only; for the viewer's OWN row it
 * must point at the character page instead of dead-ending the "↑ level up"
 * badge that opened it. Never rendered for a teammate's sheet.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

jest.mock('../../lib/api/dnd', () => ({
  getCatalog: jest.fn().mockResolvedValue({
    system: 'dnd5e',
    content_type: 'class',
    items: [],
    total: 0,
    limit: 100,
    offset: 0,
  }),
}));

import * as dnd from '../../lib/api/dnd';
import MemberSheetPanel from '../../components/MemberSheetPanel';
import type { CharacterSheet, PendingLevelChoice } from '../../lib/api/types';

const mockGetCatalog = dnd.getCatalog as jest.MockedFunction<typeof dnd.getCatalog>;

function ability(score: number, modifier: number) {
  return { score, modifier };
}

const PENDING: PendingLevelChoice[] = [
  { id: 'subclass:3', type: 'subclass', level: 3, class: 'Fighter', label: 'Choose your Fighter archetype' },
  { id: 'asi:4', type: 'asi', level: 4, class: 'Fighter', label: 'Ability Score Improvement (level 4)' },
];

const SHEET: CharacterSheet = {
  character_id: 'cid-9',
  owner_username: 'leon',
  name: 'Rook',
  race: 'Human',
  subrace: '',
  char_class: 'Fighter',
  subclass: '',
  level: 5,
  background: 'Soldier',
  alignment: '',
  ability_scores: {
    strength: ability(16, 3),
    dexterity: ability(12, 1),
    constitution: ability(14, 2),
    intelligence: ability(10, 0),
    wisdom: ability(10, 0),
    charisma: ability(8, -1),
  },
  hp: { current: 44, max: 44, temp: 0 },
  ac: 16,
  initiative: 1,
  proficiency_bonus: 3,
  speed: 30,
  xp: 6500,
  xp_next: 14000,
  hit_dice_remaining: 5,
  proficient_saves: [],
  proficient_skills: [],
  class_features: [],
  conditions: [],
  spellcasting: null,
  spell_slots: {},
  is_spellcaster: false,
  inventory: [],
  inventory_weight: 0,
  pending_choices: PENDING,
};

function renderPanel(props: Partial<React.ComponentProps<typeof MemberSheetPanel>> = {}) {
  return render(
    <MemberSheetPanel
      sheet={SHEET}
      loading={false}
      error={false}
      memberName="Rook"
      onClose={() => {}}
      {...props}
    />,
  );
}

it('self view with pending choices renders the callout with a resolve link', () => {
  renderPanel({ isSelf: true });
  const note = screen.getByRole('note');
  expect(note).toHaveTextContent(/2 level choices waiting/i);
  const link = screen.getByRole('link', { name: /resolve on your character sheet/i });
  expect(link).toHaveAttribute('href', '/character/cid-9');
});

it('a TEAMMATE with pending choices gets NO callout (read-only philosophy)', () => {
  renderPanel({ isSelf: false });
  expect(screen.queryByRole('note')).not.toBeInTheDocument();
  expect(screen.queryByText(/waiting/i)).not.toBeInTheDocument();
});

it('self view with nothing pending gets no callout', () => {
  renderPanel({ isSelf: true, sheet: { ...SHEET, pending_choices: [] } });
  expect(screen.queryByRole('note')).not.toBeInTheDocument();
});

it('singular copy for exactly one pending choice', () => {
  renderPanel({ isSelf: true, sheet: { ...SHEET, pending_choices: [PENDING[0]] } });
  expect(screen.getByRole('note')).toHaveTextContent(/1 level choice waiting/i);
});

// TAV-CLASS-FEATURE-TEXT — this drawer renders the same Features treatment
// as the full /character/[id] sheet (scaffolding filter, ASI dedupe, rules
// text via the class catalog). Covered separately from the sheet-page test
// because this is a distinct component/hook wiring, not the same code path.
it('TAV-CLASS-FEATURE-TEXT: party drawer hides scaffolding, dedupes ASI with a count, and resolves rules text', async () => {
  mockGetCatalog.mockResolvedValueOnce({
    system: 'dnd5e',
    content_type: 'class',
    items: [
      {
        slug: 'fighter',
        name: 'Fighter',
        content_type: 'class',
        source_type: 'srd',
        data: {
          features: [
            { level: 1, name: 'Fighting Style', description: 'Adopt a particular style of fighting.' },
          ],
        },
      },
    ],
    total: 1,
    limit: 100,
    offset: 0,
  });
  renderPanel({
    sheet: {
      ...SHEET,
      class_features: [
        'Fighting Style',
        'Ki Stat',
        'School',
        'Ability Score Improvement',
        'Ability Score Improvement',
      ],
    },
  });

  expect(screen.queryByText('Ki Stat')).not.toBeInTheDocument();
  expect(screen.queryByText('School')).not.toBeInTheDocument();
  expect(screen.getAllByText('Ability Score Improvement')).toHaveLength(1);
  expect(screen.getByText('×2')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Feature details: Fighting Style' }));
  await waitFor(() =>
    expect(screen.getByText('Adopt a particular style of fighting.')).toBeInTheDocument(),
  );
});
