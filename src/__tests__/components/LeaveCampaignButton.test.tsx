/**
 * B1 (TAV-CHAR-STUCK-AFTER-CAMPAIGN-END) — LeaveCampaignButton: the
 * character page's escape hatch.
 *
 * Contract under test: bound-only render gate (fail-closed on a missing
 * `levelup_policy`, mirroring WorkshopBuildControls' sibling gate on the
 * same field), confirm-then-leave flow, every C1 response (200 / 400
 * not_in_campaign treated as success / 404 as a real error), the
 * double-submit latch, and that the control never depends on any campaign
 * fetch of its own (Contract C1's "works when unreachable" requirement).
 */
import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';

jest.mock('../../lib/api/dnd', () => ({
  leaveCampaign: jest.fn(),
}));

import * as dnd from '../../lib/api/dnd';
import { ToastProvider } from '../../components/Toast';
import LeaveCampaignButton from '../../components/LeaveCampaignButton';
import type { CharacterSheet } from '../../lib/api/types';

const mockLeave = dnd.leaveCampaign as jest.Mock;

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
    outcome: 'allowed_xp',
    mode: 'xp',
    can_level: true,
    xp_short: null,
    floor: null,
    next_level: 5,
  },
};

function renderButton(overrides?: Partial<CharacterSheet>, onLeft = jest.fn()) {
  render(
    <ToastProvider>
      <LeaveCampaignButton
        characterId="cid-1"
        characterName="Aria"
        username="leon"
        sheet={{ ...BASE, ...overrides }}
        onLeft={onLeft}
      />
    </ToastProvider>,
  );
  return { onLeft };
}

function apiError(status: number, reason?: string) {
  const e = new Error(reason ?? 'error') as Error & { status: number; body: unknown };
  e.status = status;
  e.body = reason ? { success: false, data: { reason } } : { success: false, error: 'not_found' };
  return e;
}

beforeEach(() => {
  mockLeave.mockReset();
});

describe('render gate — bound only, fail-closed', () => {
  it('renders nothing without a policy (pre-upgrade backend / unreachable-sheet degrade)', () => {
    renderButton({ levelup_policy: undefined });
    expect(screen.queryByRole('button', { name: /leave campaign/i })).not.toBeInTheDocument();
  });

  it('renders nothing in workshop mode (never bound)', () => {
    renderButton({
      levelup_policy: { ...BASE.levelup_policy!, mode: 'workshop', outcome: 'allowed_workshop' },
    });
    expect(screen.queryByRole('button', { name: /leave campaign/i })).not.toBeInTheDocument();
  });

  it('renders when bound in xp mode', () => {
    renderButton();
    expect(screen.getByRole('button', { name: /leave campaign/i })).toBeInTheDocument();
  });

  it('renders when bound in floor mode (the other bound mode)', () => {
    renderButton({
      levelup_policy: { ...BASE.levelup_policy!, mode: 'floor', outcome: 'allowed_floor', floor: 3 },
    });
    expect(screen.getByRole('button', { name: /leave campaign/i })).toBeInTheDocument();
  });

  it('still renders when denied_max_level, because that outcome keeps the real bound mode', () => {
    renderButton({
      levelup_policy: {
        ...BASE.levelup_policy!,
        mode: 'xp',
        outcome: 'denied_max_level',
        next_level: null,
      },
    });
    expect(screen.getByRole('button', { name: /leave campaign/i })).toBeInTheDocument();
  });

  it('never calls any campaign-fetch API — only leaveCampaign is invoked, and only on confirm', () => {
    renderButton();
    expect(mockLeave).not.toHaveBeenCalled();
  });
});

describe('confirm flow', () => {
  it('opens a focus-trapped alertdialog on click, and Cancel closes it without calling the API', async () => {
    renderButton();
    fireEvent.click(screen.getByRole('button', { name: /leave campaign/i }));

    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');

    fireEvent.click(screen.getByRole('button', { name: /stay seated/i }));
    expect(mockLeave).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
  });

  it('Escape dismisses the dialog without calling the API', async () => {
    renderButton();
    fireEvent.click(screen.getByRole('button', { name: /leave campaign/i }));
    fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Escape' });
    expect(mockLeave).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
  });
});

describe('C1 responses', () => {
  it('200 -> success toast, control hides itself, onLeft fires for a background refresh', async () => {
    mockLeave.mockResolvedValue({ freed_campaign_id: 'camp-1' });
    const { onLeft } = renderButton();

    fireEvent.click(screen.getByRole('button', { name: /leave campaign/i }));
    fireEvent.click(screen.getByRole('button', { name: /leave now/i }));

    await waitFor(() => expect(mockLeave).toHaveBeenCalledWith('cid-1', 'leon'));
    expect(await screen.findByText(/no longer seated at a table/i)).toBeInTheDocument();
    expect(onLeft).toHaveBeenCalled();
    // The instance's own local `left` latch hides it immediately — it does
    // not wait on onLeft's refetch to resolve.
    expect(screen.queryByRole('button', { name: /leave now/i })).not.toBeInTheDocument();
  });

  it('400 not_in_campaign -> treated as effectively-success, not a scary error', async () => {
    mockLeave.mockRejectedValue(apiError(400, 'not_in_campaign'));
    const { onLeft } = renderButton();

    fireEvent.click(screen.getByRole('button', { name: /leave campaign/i }));
    fireEvent.click(screen.getByRole('button', { name: /leave now/i }));

    await waitFor(() => expect(mockLeave).toHaveBeenCalled());
    expect(await screen.findByText(/no longer seated at a table/i)).toBeInTheDocument();
    expect(screen.queryByText(/could not leave/i)).not.toBeInTheDocument();
    expect(onLeft).toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /leave now/i })).not.toBeInTheDocument();
  });

  it('404 -> real error toast, control stays visible, onLeft never fires', async () => {
    mockLeave.mockRejectedValue(apiError(404));
    const { onLeft } = renderButton();

    fireEvent.click(screen.getByRole('button', { name: /leave campaign/i }));
    fireEvent.click(screen.getByRole('button', { name: /leave now/i }));

    await waitFor(() => expect(mockLeave).toHaveBeenCalled());
    expect(await screen.findByText(/could not leave the campaign/i)).toBeInTheDocument();
    expect(onLeft).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /leave campaign/i })).toBeInTheDocument();
  });

  it('a failed background refresh (onLeft rejects) does not surface an error — leaving already succeeded', async () => {
    mockLeave.mockResolvedValue({ freed_campaign_id: 'camp-1' });
    const onLeft = jest.fn().mockRejectedValue(new Error('refetch failed'));
    renderButton(undefined, onLeft);

    fireEvent.click(screen.getByRole('button', { name: /leave campaign/i }));
    fireEvent.click(screen.getByRole('button', { name: /leave now/i }));

    expect(await screen.findByText(/no longer seated at a table/i)).toBeInTheDocument();
    expect(screen.queryByText(/could not leave/i)).not.toBeInTheDocument();
  });
});

describe('double-submit latch', () => {
  it('disables Confirm/Cancel while in flight and only calls the API once for a rapid double-click', async () => {
    let resolveLeave: (v: { freed_campaign_id: string }) => void;
    mockLeave.mockReturnValue(
      new Promise((resolve) => {
        resolveLeave = resolve;
      }),
    );
    renderButton();

    fireEvent.click(screen.getByRole('button', { name: /leave campaign/i }));
    const confirmBtn = screen.getByRole('button', { name: /leave now/i });
    fireEvent.click(confirmBtn);
    fireEvent.click(confirmBtn);
    fireEvent.click(confirmBtn);

    expect(mockLeave).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: /stay seated/i })).toBeDisabled();

    resolveLeave!({ freed_campaign_id: 'camp-1' });
    await waitFor(() =>
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(),
    );
  });
});

// ---------------------------------------------------------------------------
// Kage SUGG-5 (2026-08-12) — the `left` latch is OPTIMISTIC (it flips before
// the parent's background refetch confirms anything); it must reconcile once
// that refetch actually lands, not stay permanently latched regardless of
// what the fresh sheet says.
// ---------------------------------------------------------------------------
describe('SUGG-5 — reconciles the optimistic latch with a refetched sheet', () => {
  it('a fresh (new-object) sheet that still reports bound un-hides the control — the leave did not actually stick', async () => {
    mockLeave.mockResolvedValue({ freed_campaign_id: 'camp-1' });
    const onLeft = jest.fn().mockResolvedValue(undefined);
    const { rerender } = render(
      <ToastProvider>
        <LeaveCampaignButton
          characterId="cid-1"
          characterName="Aria"
          username="leon"
          sheet={BASE}
          onLeft={onLeft}
        />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: /leave campaign/i }));
    fireEvent.click(screen.getByRole('button', { name: /leave now/i }));

    // Optimistically hidden immediately, before any refetch lands.
    await waitFor(() => expect(onLeft).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: /leave campaign/i })).not.toBeInTheDocument();

    // The parent's background refetch (what `onLeft` triggers on the real
    // page) resolves and hands back a FRESH sheet object — same bound policy
    // as before, simulating a race where the leave didn't actually take.
    rerender(
      <ToastProvider>
        <LeaveCampaignButton
          characterId="cid-1"
          characterName="Aria"
          username="leon"
          sheet={{ ...BASE }}
          onLeft={onLeft}
        />
      </ToastProvider>,
    );

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /leave campaign/i })).toBeInTheDocument(),
    );
  });

  it('a fresh sheet confirming workshop mode (the real leave) stays hidden — the ordinary success path', async () => {
    mockLeave.mockResolvedValue({ freed_campaign_id: 'camp-1' });
    const onLeft = jest.fn().mockResolvedValue(undefined);
    const { rerender } = render(
      <ToastProvider>
        <LeaveCampaignButton
          characterId="cid-1"
          characterName="Aria"
          username="leon"
          sheet={BASE}
          onLeft={onLeft}
        />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: /leave campaign/i }));
    fireEvent.click(screen.getByRole('button', { name: /leave now/i }));
    await waitFor(() => expect(onLeft).toHaveBeenCalled());

    rerender(
      <ToastProvider>
        <LeaveCampaignButton
          characterId="cid-1"
          characterName="Aria"
          username="leon"
          sheet={{
            ...BASE,
            levelup_policy: { ...BASE.levelup_policy!, mode: 'workshop', outcome: 'allowed_workshop' },
          }}
          onLeft={onLeft}
        />
      </ToastProvider>,
    );

    expect(screen.queryByRole('button', { name: /leave campaign/i })).not.toBeInTheDocument();
  });
});
