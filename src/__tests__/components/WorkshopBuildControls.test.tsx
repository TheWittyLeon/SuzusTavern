/**
 * LVLDN — WorkshopBuildControls: workshop-only level down / reset.
 *
 * Contract under test: fail-closed render gate (server verdict only),
 * confirm-then-rebuild-then-refetch flow, target routing (level-1 vs 1),
 * refusal copy with the dialog staying open, the walk_incomplete special
 * case (close + refetch + point at Level up), and the double-submit latch.
 */
import React from 'react';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';

jest.mock('../../lib/api/dnd', () => ({
  rebuildCharacter: jest.fn(),
  getCharacterSheet: jest.fn(),
}));

import * as dnd from '../../lib/api/dnd';
import { ToastProvider } from '../../components/Toast';
import WorkshopBuildControls from '../../components/WorkshopBuildControls';
import type { CharacterSheet } from '../../lib/api/types';

const mockRebuild = dnd.rebuildCharacter as jest.Mock;
const mockGetSheet = dnd.getCharacterSheet as jest.Mock;

function ability(score: number, modifier: number) {
  return { score, modifier };
}

const BASE: CharacterSheet = {
  character_id: 'cid-1',
  owner_username: 'leon',
  name: 'Aria',
  race: 'Human',
  subrace: '',
  char_class: 'Fighter',
  subclass: '',
  level: 4,
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
  hp: { current: 38, max: 38, temp: 0 },
  ac: 16,
  initiative: 1,
  proficiency_bonus: 2,
  speed: 30,
  xp: 2700,
  xp_next: 6500,
  hit_dice_remaining: 4,
  proficient_saves: ['strength', 'constitution'],
  proficient_skills: ['athletics'],
  class_features: ['Second Wind', 'Fighting Style'],
  conditions: [],
  spellcasting: null,
  spell_slots: {},
  is_spellcaster: false,
  inventory: [],
  inventory_weight: 0,
  levelup_policy: {
    outcome: 'allowed_workshop',
    mode: 'workshop',
    can_level: true,
    xp_short: null,
    floor: null,
    next_level: 5,
  },
};

function renderControls(overrides?: Partial<CharacterSheet>, onRebuilt = jest.fn()) {
  render(
    <ToastProvider>
      <WorkshopBuildControls
        characterId="cid-1"
        username="leon"
        sheet={{ ...BASE, ...overrides }}
        onRebuilt={onRebuilt}
      />
    </ToastProvider>,
  );
  return { onRebuilt };
}

function apiError(status: number, reason: string) {
  const e = new Error(reason) as Error & { status: number; body: unknown };
  e.status = status;
  e.body = { success: false, data: { reason } };
  return e;
}

beforeEach(() => {
  mockRebuild.mockReset();
  mockGetSheet.mockReset();
});

describe('WorkshopBuildControls — render gate (fail-closed)', () => {
  it('renders nothing without a policy (pre-upgrade backend)', () => {
    renderControls({ levelup_policy: undefined });
    expect(screen.queryByRole('button', { name: /level down/i })).not.toBeInTheDocument();
  });

  it('renders nothing when bound (xp mode) or floor mode', () => {
    renderControls({
      levelup_policy: { ...BASE.levelup_policy!, mode: 'xp' },
    });
    expect(screen.queryByRole('button', { name: /level down/i })).not.toBeInTheDocument();
  });

  it('renders nothing in floor mode (Miko P3 — the sibling non-workshop mode)', () => {
    renderControls({
      levelup_policy: { ...BASE.levelup_policy!, mode: 'floor', outcome: 'allowed_floor' },
    });
    expect(screen.queryByRole('button', { name: /level down/i })).not.toBeInTheDocument();
  });

  it('renders nothing at level 1', () => {
    renderControls({ level: 1 });
    expect(screen.queryByRole('button', { name: /level down/i })).not.toBeInTheDocument();
  });

  it('level 2: only Level down (reset would be the same op)', () => {
    renderControls({ level: 2 });
    expect(screen.getByRole('button', { name: /level down/i })).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /reset to level 1/i }),
    ).not.toBeInTheDocument();
  });

  it('level 3+: both buttons', () => {
    renderControls();
    expect(screen.getByRole('button', { name: /level down/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reset to level 1/i })).toBeInTheDocument();
  });
});

describe('WorkshopBuildControls — rebuild flow', () => {
  it('level down confirms, rebuilds to level-1, refetches, bubbles the sheet up', async () => {
    mockRebuild.mockResolvedValue({ from_level: 4, to_level: 3 });
    const after = { ...BASE, level: 3, pending_choices: [{ id: 'subclass:3' }] };
    mockGetSheet.mockResolvedValue(after);
    const { onRebuilt } = renderControls();

    fireEvent.click(screen.getByRole('button', { name: /level down/i }));
    expect(screen.getByRole('dialog')).toHaveTextContent(/rebuilt at level 3/i);
    fireEvent.click(screen.getByRole('button', { name: /yes, down to 3/i }));

    await waitFor(() =>
      expect(mockRebuild).toHaveBeenCalledWith('cid-1', 'leon', 3),
    );
    expect(mockGetSheet).toHaveBeenCalledWith('cid-1', 'leon');
    await waitFor(() => expect(onRebuilt).toHaveBeenCalledWith(after));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(await screen.findByText(/1 choice is waiting/i)).toBeInTheDocument();
  });

  it('reset targets level 1', async () => {
    mockRebuild.mockResolvedValue({ from_level: 4, to_level: 1 });
    mockGetSheet.mockResolvedValue({ ...BASE, level: 1 });
    renderControls();

    fireEvent.click(screen.getByRole('button', { name: /reset to level 1/i }));
    fireEvent.click(screen.getByRole('button', { name: /yes, reset to 1/i }));
    await waitFor(() =>
      expect(mockRebuild).toHaveBeenCalledWith('cid-1', 'leon', 1),
    );
  });

  it('a refusal shows mapped copy and keeps the dialog open', async () => {
    mockRebuild.mockRejectedValue(apiError(400, 'bound_to_campaign'));
    renderControls();

    fireEvent.click(screen.getByRole('button', { name: /level down/i }));
    fireEvent.click(screen.getByRole('button', { name: /yes, down to 3/i }));

    expect(
      await screen.findByText(/seated at a table — leave the campaign/i),
    ).toBeInTheDocument();
    expect(mockGetSheet).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('walk_incomplete closes the dialog, warns, and STILL refetches (the rebuild happened)', async () => {
    mockRebuild.mockRejectedValue(apiError(500, 'walk_incomplete'));
    const after = { ...BASE, level: 2 };
    mockGetSheet.mockResolvedValue(after);
    const { onRebuilt } = renderControls();

    fireEvent.click(screen.getByRole('button', { name: /level down/i }));
    fireEvent.click(screen.getByRole('button', { name: /yes, down to 3/i }));

    expect(
      await screen.findByText(/stopped partway.*finish the climb/i),
    ).toBeInTheDocument();
    await waitFor(() => expect(onRebuilt).toHaveBeenCalledWith(after));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('two same-tick confirm clicks fire exactly one rebuild (latch)', async () => {
    let resolve: (v: unknown) => void = () => {};
    mockRebuild.mockImplementation(() => new Promise((r) => { resolve = r; }));
    mockGetSheet.mockResolvedValue({ ...BASE, level: 3 });
    renderControls();

    fireEvent.click(screen.getByRole('button', { name: /level down/i }));
    const confirm = screen.getByRole('button', { name: /yes, down to 3/i });
    // Kage S1: sequential fireEvent.clicks flush the busy re-render between
    // them, so ConfirmDialog's disabled prop absorbs the second click and
    // the test passes with the ref latch DELETED. Two raw DOM clicks inside
    // ONE act() batch reach the handler before any re-render commits — only
    // the synchronous ref can stop the second one.
    await act(async () => {
      confirm.click();
      confirm.click();
    });
    expect(mockRebuild).toHaveBeenCalledTimes(1);
    resolve({ from_level: 4, to_level: 3 });
    await waitFor(() => expect(mockGetSheet).toHaveBeenCalled());
  });
});
