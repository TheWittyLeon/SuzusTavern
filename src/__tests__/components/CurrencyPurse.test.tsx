/**
 * CurrencyPurse — T12 (DDX-23t currency UI).
 *
 * Purse rendering + owner-only Spend wiring + busy-latch + amount validation,
 * mirrors HpControl.test.tsx's conventions.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';

jest.mock('../../lib/api/dnd', () => ({
  spendCurrency: jest.fn(),
  getCharacterSheet: jest.fn(),
}));

import * as dnd from '../../lib/api/dnd';
import { ToastProvider } from '../../components/Toast';
import CurrencyPurse from '../../components/CurrencyPurse';
import type { CharacterSheet } from '../../lib/api/types';

const mockSpend = dnd.spendCurrency as jest.Mock;
const mockGetSheet = dnd.getCharacterSheet as jest.Mock;

function ability(score: number, modifier: number) {
  return { score, modifier };
}

const BASE_SHEET: CharacterSheet = {
  character_id: 'cid-1',
  owner_username: 'leon',
  name: 'Ashwin',
  race: 'Human',
  subrace: '',
  char_class: 'Fighter',
  subclass: '',
  level: 3,
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
  hp: { current: 24, max: 24, temp: 0 },
  ac: 11,
  initiative: 1,
  proficiency_bonus: 2,
  speed: 30,
  xp: 900,
  xp_next: 2700,
  hit_dice_remaining: 3,
  proficient_saves: [],
  proficient_skills: [],
  class_features: [],
  conditions: [],
  spellcasting: null,
  spell_slots: {},
  is_spellcaster: false,
  inventory: [],
  inventory_weight: 0,
  currency_gp: 100,
};

function renderPurse(
  currencyGp = 100,
  onChanged = jest.fn(),
  overrides?: { isOwner?: boolean },
) {
  render(
    <ToastProvider>
      <CurrencyPurse
        characterId="cid-1"
        username="leon"
        isOwner={overrides?.isOwner ?? true}
        currencyGp={currencyGp}
        onChanged={onChanged}
      />
    </ToastProvider>,
  );
  return { onChanged };
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  mockSpend.mockReset();
  mockGetSheet.mockReset();
});

describe('CurrencyPurse — read-only rendering', () => {
  it('renders the current gold balance', () => {
    renderPurse(120);
    expect(screen.getByText('120 gp')).toBeInTheDocument();
  });

  it('formats a large balance with thousands separators', () => {
    renderPurse(12345);
    expect(screen.getByText('12,345 gp')).toBeInTheDocument();
  });

  it('non-owner: no Spend control renders', () => {
    renderPurse(100, jest.fn(), { isOwner: false });
    expect(screen.queryByLabelText('Gold amount')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Spend gold' })).not.toBeInTheDocument();
  });
});

describe('CurrencyPurse — invalid amount disables submit', () => {
  it('Spend is disabled with an empty amount', () => {
    renderPurse();
    expect(screen.getByRole('button', { name: 'Spend gold' })).toBeDisabled();
  });

  it('Spend stays disabled for zero, negative, non-integer, bool-ish, or sci-notation amounts', () => {
    renderPurse();
    const input = screen.getByLabelText('Gold amount');
    for (const bad of ['0', '-3', '2.5', 'abc', 'true', 'false', '3e2']) {
      fireEvent.change(input, { target: { value: bad } });
      expect(screen.getByRole('button', { name: 'Spend gold' })).toBeDisabled();
    }
    expect(mockSpend).not.toHaveBeenCalled();
  });

  it('Spend stays disabled over the 1,000,000 cap, enables at exactly the cap', () => {
    renderPurse();
    const input = screen.getByLabelText('Gold amount');
    fireEvent.change(input, { target: { value: '1000001' } });
    expect(screen.getByRole('button', { name: 'Spend gold' })).toBeDisabled();
    fireEvent.change(input, { target: { value: '1000000' } });
    expect(screen.getByRole('button', { name: 'Spend gold' })).toBeEnabled();
  });

  it('Spend enables for a valid positive integer', () => {
    renderPurse();
    fireEvent.change(screen.getByLabelText('Gold amount'), { target: { value: '25' } });
    expect(screen.getByRole('button', { name: 'Spend gold' })).toBeEnabled();
  });
});

describe('CurrencyPurse — Spend calls the right endpoint and updates live', () => {
  it('clicking Spend calls spendCurrency(id, amount), applies the response immediately, then refetches', async () => {
    mockSpend.mockResolvedValue({ currency_gp: 75, spent: 25 });
    mockGetSheet.mockResolvedValue({ ...BASE_SHEET, currency_gp: 75 });
    const { onChanged } = renderPurse(100);

    fireEvent.change(screen.getByLabelText('Gold amount'), { target: { value: '25' } });
    fireEvent.click(screen.getByRole('button', { name: 'Spend gold' }));
    await flush();

    expect(mockSpend).toHaveBeenCalledWith('cid-1', 25);
    expect(screen.getByText('75 gp')).toBeInTheDocument();
    expect(mockGetSheet).toHaveBeenCalledWith('cid-1', 'leon');
    expect(onChanged).toHaveBeenCalledWith(expect.objectContaining({ currency_gp: 75 }));
    expect((screen.getByLabelText('Gold amount') as HTMLInputElement).value).toBe('');
  });

  it('announces "Spent N gp." on a successful spend + refetch', async () => {
    mockSpend.mockResolvedValue({ currency_gp: 75, spent: 25 });
    mockGetSheet.mockResolvedValue({ ...BASE_SHEET, currency_gp: 75 });
    renderPurse(100);

    fireEvent.change(screen.getByLabelText('Gold amount'), { target: { value: '25' } });
    fireEvent.click(screen.getByRole('button', { name: 'Spend gold' }));
    await flush();

    expect(await screen.findByText(/Spent 25 gp\./)).toBeInTheDocument();
  });
});

describe('CurrencyPurse — insufficient-funds refusal', () => {
  it('surfaces the engine\'s own "has X gp, needs Y gp" message for insufficient_funds', async () => {
    const err = new Error('API error 400: 400') as Error & { status: number; body: unknown };
    err.status = 400;
    err.body = {
      success: false,
      message: 'Insufficient funds: has 10 gp, needs 25 gp.',
      data: { reason: 'insufficient_funds' },
    };
    mockSpend.mockRejectedValue(err);
    renderPurse(10);

    fireEvent.change(screen.getByLabelText('Gold amount'), { target: { value: '25' } });
    fireEvent.click(screen.getByRole('button', { name: 'Spend gold' }));
    await flush();

    expect(
      await screen.findByText('Insufficient funds: has 10 gp, needs 25 gp.'),
    ).toBeInTheDocument();
    // The optimistic balance is untouched — a refusal never changes state.
    expect(screen.getByText('10 gp')).toBeInTheDocument();
  });

  it('a generic network failure gets the transient fallback copy', async () => {
    mockSpend.mockRejectedValue(new Error('network blip'));
    renderPurse(100);

    fireEvent.change(screen.getByLabelText('Gold amount'), { target: { value: '25' } });
    fireEvent.click(screen.getByRole('button', { name: 'Spend gold' }));
    await flush();

    expect(
      await screen.findByText('Could not spend gold. Try again in a moment.'),
    ).toBeInTheDocument();
  });

  it('maps invalid_amount to specific copy (server disagreeing with the client guard, e.g. a stale engine-side rule)', async () => {
    const err = new Error('API error 400: 400') as Error & { status: number; body: unknown };
    err.status = 400;
    err.body = { success: false, message: 'bad amount', data: { reason: 'invalid_amount' } };
    mockSpend.mockRejectedValue(err);
    renderPurse(100);

    fireEvent.change(screen.getByLabelText('Gold amount'), { target: { value: '25' } });
    fireEvent.click(screen.getByRole('button', { name: 'Spend gold' }));
    await flush();

    expect(
      await screen.findByText('Spend amount must be a positive integer.'),
    ).toBeInTheDocument();
  });

  it('insufficient_funds WITHOUT a body.message falls back to the generic fallback copy, not undefined/crash', async () => {
    const err = new Error('API error 400: 400') as Error & { status: number; body: unknown };
    err.status = 400;
    // Deliberately no `message` key alongside the reason — the code's
    // `reason === 'insufficient_funds' && body?.message` guard requires BOTH.
    err.body = { success: false, data: { reason: 'insufficient_funds' } };
    mockSpend.mockRejectedValue(err);
    renderPurse(10);

    fireEvent.change(screen.getByLabelText('Gold amount'), { target: { value: '25' } });
    fireEvent.click(screen.getByRole('button', { name: 'Spend gold' }));
    await flush();

    expect(
      await screen.findByText('Could not spend gold. Try again in a moment.'),
    ).toBeInTheDocument();
  });
});

describe('CurrencyPurse — busy-latch double-submit protection', () => {
  it('back-to-back clicks on Spend in the same React batch call spendCurrency only once', async () => {
    mockSpend.mockResolvedValue({ currency_gp: 75, spent: 25 });
    mockGetSheet.mockResolvedValue({ ...BASE_SHEET, currency_gp: 75 });
    renderPurse(100);

    fireEvent.change(screen.getByLabelText('Gold amount'), { target: { value: '25' } });
    const btn = screen.getByRole('button', { name: 'Spend gold' });
    await act(async () => {
      fireEvent.click(btn);
      fireEvent.click(btn);
    });
    await flush();

    expect(mockSpend).toHaveBeenCalledTimes(1);
  });

  it('releases the latch on a failed mutate — a subsequent click tries again', async () => {
    mockSpend.mockRejectedValueOnce(new Error('network blip'));
    mockSpend.mockResolvedValueOnce({ currency_gp: 75, spent: 25 });
    mockGetSheet.mockResolvedValue({ ...BASE_SHEET, currency_gp: 75 });
    renderPurse(100);

    fireEvent.change(screen.getByLabelText('Gold amount'), { target: { value: '25' } });
    const btn = screen.getByRole('button', { name: 'Spend gold' });
    fireEvent.click(btn);
    await flush();
    expect(mockSpend).toHaveBeenCalledTimes(1);

    await waitFor(() => expect(btn).toBeEnabled());
    fireEvent.change(screen.getByLabelText('Gold amount'), { target: { value: '25' } });
    fireEvent.click(screen.getByRole('button', { name: 'Spend gold' }));
    await flush();
    expect(mockSpend).toHaveBeenCalledTimes(2);
  });

  it('all controls disable while a mutation is in flight', async () => {
    let resolveSpend: (v: unknown) => void = () => {};
    mockSpend.mockReturnValue(
      new Promise((resolve) => {
        resolveSpend = resolve;
      }),
    );
    renderPurse();

    fireEvent.change(screen.getByLabelText('Gold amount'), { target: { value: '25' } });
    fireEvent.click(screen.getByRole('button', { name: 'Spend gold' }));
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByLabelText('Gold amount')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Spend gold' })).toBeDisabled();

    resolveSpend({ currency_gp: 75, spent: 25 });
    await flush();
  });
});

describe('CurrencyPurse — refetch failure after a successful mutate (D2 pattern)', () => {
  it('getCharacterSheet throwing after a resolved spendCurrency gets its own warn toast, never onChanged, and releases the latch', async () => {
    mockSpend.mockResolvedValue({ currency_gp: 75, spent: 25 });
    mockGetSheet.mockRejectedValue(new Error('network blip'));
    const { onChanged } = renderPurse(100);

    fireEvent.change(screen.getByLabelText('Gold amount'), { target: { value: '25' } });
    const btn = screen.getByRole('button', { name: 'Spend gold' });
    fireEvent.click(btn);
    await flush();

    expect(
      await screen.findByText("Couldn't refresh your sheet — reload to see the result."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Spent 25 gp\./)).not.toBeInTheDocument();
    expect(onChanged).not.toHaveBeenCalled();
    // The balance already applied from the mutation response even though
    // the refetch failed.
    expect(screen.getByText('75 gp')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Gold amount'), { target: { value: '10' } });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Spend gold' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Spend gold' }));
    await flush();
    expect(mockSpend).toHaveBeenCalledTimes(2);
  });
});

describe('CurrencyPurse — external currencyGp prop change re-syncs local state (e.g. a DM grant landing on reload)', () => {
  it('a new currencyGp prop updates the displayed balance', () => {
    const { rerender } = render(
      <ToastProvider>
        <CurrencyPurse
          characterId="cid-1"
          username="leon"
          isOwner={true}
          currencyGp={50}
          onChanged={jest.fn()}
        />
      </ToastProvider>,
    );
    expect(screen.getByText('50 gp')).toBeInTheDocument();

    rerender(
      <ToastProvider>
        <CurrencyPurse
          characterId="cid-1"
          username="leon"
          isOwner={true}
          currencyGp={100}
          onChanged={jest.fn()}
        />
      </ToastProvider>,
    );

    expect(screen.getByText('100 gp')).toBeInTheDocument();
  });
});
