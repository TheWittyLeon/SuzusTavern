/**
 * CampaignFloorPanel — LVL-1 (design §14 gap: no test file existed for this
 * component before this pass). DM-only floor display/edit (setStartingLevel,
 * D3 — saving never levels anyone) + "Apply floor now" (applyCampaignFloor)
 * behind a per-member preview confirm, mirrors GrantCurrencyPanel.test.tsx's
 * conventions (mock dnd.ts, ToastProvider wrapper, `flush()` idiom).
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';

jest.mock('../../lib/api/dnd', () => ({
  setStartingLevel: jest.fn(),
  applyCampaignFloor: jest.fn(),
}));

import * as dnd from '../../lib/api/dnd';
import { ToastProvider } from '../../components/Toast';
import CampaignFloorPanel from '../../components/CampaignFloorPanel';
import type { Participant } from '../../lib/api/types';

const mockSet = dnd.setStartingLevel as jest.Mock;
const mockApply = dnd.applyCampaignFloor as jest.Mock;

const PARTICIPANTS: Participant[] = [
  { username: 'leon', is_dm: true, character: null },
  {
    username: 'alex',
    is_dm: false,
    character: {
      character_id: '42',
      name: 'Ashwin',
      char_class: 'Fighter',
      level: 2,
      current_hp: 18,
      max_hp: 18,
      ac: 15,
    },
  },
  {
    username: 'sam',
    is_dm: false,
    character: null, // no bound character — must not appear in the preview
  },
  {
    username: 'jo',
    is_dm: false,
    character: {
      character_id: '43',
      name: 'Rilla',
      char_class: 'Cleric',
      level: 5,
      current_hp: 30,
      max_hp: 30,
      ac: 14,
    },
  },
];

function renderPanel(overrides: Partial<React.ComponentProps<typeof CampaignFloorPanel>> = {}) {
  render(
    <ToastProvider>
      <CampaignFloorPanel
        sessionId="sess-1"
        username="leon"
        participants={PARTICIPANTS}
        startingLevel={5}
        {...overrides}
      />
    </ToastProvider>,
  );
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  mockSet.mockReset();
  mockApply.mockReset();
});

describe('CampaignFloorPanel — display + edit', () => {
  it('renders the current floor and an Edit control', () => {
    renderPanel();
    expect(screen.getByText('Level 5')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit starting level' })).toBeInTheDocument();
  });

  it('Save is disabled for out-of-range or non-numeric drafts, enabled for a valid one', () => {
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Edit starting level' }));
    const input = screen.getByLabelText('Starting level');

    for (const bad of ['0', '21', '-1', 'five', '3.5', '']) {
      fireEvent.change(input, { target: { value: bad } });
      expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    }
    fireEvent.change(input, { target: { value: '8' } });
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
  });

  it('Cancel closes the editor without calling setStartingLevel', () => {
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Edit starting level' }));
    fireEvent.change(screen.getByLabelText('Starting level'), { target: { value: '9' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByText('Level 5')).toBeInTheDocument();
    expect(mockSet).not.toHaveBeenCalled();
  });

  it('Save calls setStartingLevel(sessionId, username, draft) and NEVER calls applyCampaignFloor (D3)', async () => {
    mockSet.mockResolvedValue({ starting_level: 8, previous_starting_level: 5 });
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Edit starting level' }));
    fireEvent.change(screen.getByLabelText('Starting level'), { target: { value: '8' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await flush();

    expect(mockSet).toHaveBeenCalledWith('sess-1', 'leon', 8);
    expect(mockApply).not.toHaveBeenCalled();
  });

  it('a failed save keeps the editor open (edit is not silently abandoned)', async () => {
    mockSet.mockRejectedValue(new Error('network blip'));
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Edit starting level' }));
    fireEvent.change(screen.getByLabelText('Starting level'), { target: { value: '8' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await flush();

    expect(
      await screen.findByText('Could not update the starting level. Try again in a moment.'),
    ).toBeInTheDocument();
    // Still editing — the draft input is present, the old value never displayed as saved.
    expect(screen.getByLabelText('Starting level')).toBeInTheDocument();
  });

  it('maps invalid_starting_level to specific copy', async () => {
    const err = new Error('API error 400: 400') as Error & { status: number; body: unknown };
    err.status = 400;
    err.body = { success: false, message: 'bad', data: { reason: 'invalid_starting_level' } };
    mockSet.mockRejectedValue(err);
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Edit starting level' }));
    fireEvent.change(screen.getByLabelText('Starting level'), { target: { value: '8' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await flush();

    expect(
      await screen.findByText('Starting level must be a whole number from 1 to 20.'),
    ).toBeInTheDocument();
  });
});

describe('CampaignFloorPanel — Apply floor now gating', () => {
  it('is disabled when every seated member is already at/above the floor', () => {
    renderPanel({
      startingLevel: 1,
      participants: [
        { username: 'leon', is_dm: true, character: null },
        {
          username: 'alex',
          is_dm: false,
          character: {
            character_id: '42',
            name: 'Ashwin',
            char_class: 'Fighter',
            level: 3,
            current_hp: 1,
            max_hp: 1,
            ac: 1,
          },
        },
      ],
    });
    expect(screen.getByRole('button', { name: 'Apply floor now' })).toBeDisabled();
    expect(
      screen.getByText('Every seated member is already at level 1 or above.'),
    ).toBeInTheDocument();
  });

  it('is enabled when at least one seated member is below the floor, and the confirm preview lists only below-floor bound members', () => {
    renderPanel(); // startingLevel=5: alex(2) below, jo(5) at floor, sam unbound
    const applyBtn = screen.getByRole('button', { name: 'Apply floor now' });
    expect(applyBtn).toBeEnabled();

    fireEvent.click(applyBtn);
    expect(screen.getByText(/Apply the level 5 floor now\?/)).toBeInTheDocument();
    expect(screen.getByText(/Ashwin: level 2 → 5/)).toBeInTheDocument();
    expect(screen.queryByText(/Rilla:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/sam/)).not.toBeInTheDocument();
  });

  it('disabled prop disables both the Edit and Apply controls', () => {
    renderPanel({ disabled: true });
    expect(screen.getByRole('button', { name: 'Edit starting level' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Apply floor now' })).toBeDisabled();
  });
});

describe('CampaignFloorPanel — confirmed apply', () => {
  it('confirming calls applyCampaignFloor(sessionId, username) and reports the result in the live region + a success toast', async () => {
    mockApply.mockResolvedValue({
      starting_level: 5,
      checked: 2,
      leveled: [{ username: 'alex', character_id: 42, from_level: 2, to_level: 5, pending_added: 2 }],
      skipped: [],
      failures: [],
    });
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Apply floor now' }));
    fireEvent.click(screen.getByRole('button', { name: 'Level them up now' }));
    await flush();

    expect(mockApply).toHaveBeenCalledWith('sess-1', 'leon');
    // Two role="status" regions exist (the panel's own live region AND the
    // toast) — both must carry the summary, so assert on all of them.
    for (const region of screen.getAllByRole('status')) {
      expect(region).toHaveTextContent('Floor applied — 1 member leveled to 5.');
    }
    // Dialog closes on success.
    expect(screen.queryByText(/Apply the level 5 floor now\?/)).not.toBeInTheDocument();
  });

  it('a partial success (non-empty failures) reports the failed count and stays a warn tone, not an error', async () => {
    mockApply.mockResolvedValue({
      starting_level: 5,
      checked: 2,
      leveled: [{ username: 'alex', character_id: 42, from_level: 2, to_level: 5, pending_added: 1 }],
      skipped: [],
      failures: [{ username: 'jo', character_id: 43, from_level: 1, to_level: 3, reason: 'save_failed' }],
    });
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Apply floor now' }));
    fireEvent.click(screen.getByRole('button', { name: 'Level them up now' }));
    await flush();

    for (const region of screen.getAllByRole('status')) {
      expect(region).toHaveTextContent(
        'Floor applied — 1 member leveled to 5, 1 failed (safe to retry — Apply floor now resumes them).',
      );
    }
  });

  it('an API failure keeps the dialog open and shows the mapped refusal copy', async () => {
    const err = new Error('API error 400: 400') as Error & { status: number; body: unknown };
    err.status = 400;
    err.body = { success: false, message: 'no floor', data: { reason: 'no_floor' } };
    mockApply.mockRejectedValue(err);
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Apply floor now' }));
    fireEvent.click(screen.getByRole('button', { name: 'Level them up now' }));
    await flush();

    expect(
      await screen.findByText('This table has no starting-level floor set.'),
    ).toBeInTheDocument();
    // Dialog is still open — the DM can see the failure without losing context.
    expect(screen.getByText(/Apply the level 5 floor now\?/)).toBeInTheDocument();
  });

  it('back-to-back confirm clicks in the same batch call applyCampaignFloor only once (busy-latch)', async () => {
    mockApply.mockResolvedValue({
      starting_level: 5,
      checked: 1,
      leveled: [{ username: 'alex', character_id: 42, from_level: 2, to_level: 5, pending_added: 0 }],
      skipped: [],
      failures: [],
    });
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Apply floor now' }));
    const confirmBtn = screen.getByRole('button', { name: 'Level them up now' });
    await act(async () => {
      fireEvent.click(confirmBtn);
      fireEvent.click(confirmBtn);
    });
    await flush();

    expect(mockApply).toHaveBeenCalledTimes(1);
  });
});
