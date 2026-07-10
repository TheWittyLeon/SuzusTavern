/**
 * GrantCurrencyPanel — T12 (DDX-23t currency UI, DM-only play-page control).
 *
 * Target-list gating (only bound characters offered) + grantCurrency wiring
 * (`{session_id, character_id, gold}` shape via the wrapper's positional
 * args) + busy-latch + amount validation + refusal copy, mirrors
 * ConditionsPanel.test.tsx's conventions.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';

jest.mock('../../lib/api/dnd', () => ({
  grantCurrency: jest.fn(),
}));

import * as dnd from '../../lib/api/dnd';
import { ToastProvider } from '../../components/Toast';
import GrantCurrencyPanel from '../../components/GrantCurrencyPanel';
import type { Participant } from '../../lib/api/types';

const mockGrant = dnd.grantCurrency as jest.Mock;

const PARTICIPANTS: Participant[] = [
  {
    username: 'leon',
    is_dm: true,
    character: null,
  },
  {
    username: 'alex',
    is_dm: false,
    character: {
      character_id: '42',
      name: 'Ashwin',
      char_class: 'Fighter',
      level: 3,
      current_hp: 24,
      max_hp: 24,
      ac: 16,
    },
  },
  {
    username: 'sam',
    is_dm: false,
    character: null, // no character bound yet — must not offer as a target
  },
  {
    username: 'jo',
    is_dm: false,
    character: {
      character_id: '43',
      name: 'Rilla',
      char_class: 'Cleric',
      level: 2,
      current_hp: 18,
      max_hp: 18,
      ac: 14,
    },
  },
];

function renderPanel(
  participants: Participant[] = PARTICIPANTS,
  disabled = false,
) {
  render(
    <ToastProvider>
      <GrantCurrencyPanel sessionId="sess-1" participants={participants} disabled={disabled} />
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
  mockGrant.mockReset();
});

describe('GrantCurrencyPanel — target gating', () => {
  it('renders nothing when no participant has a bound character', () => {
    const { container } = render(
      <ToastProvider>
        <GrantCurrencyPanel
          sessionId="sess-1"
          participants={[
            { username: 'leon', is_dm: true, character: null },
            { username: 'sam', is_dm: false, character: null },
          ]}
        />
      </ToastProvider>,
    );
    expect(container.querySelector('select')).not.toBeInTheDocument();
  });

  it('only offers participants with a bound character', () => {
    renderPanel();
    const select = screen.getByLabelText('Character') as HTMLSelectElement;
    const optionTexts = Array.from(select.options).map((o) => o.textContent);
    expect(optionTexts).toEqual(['Ashwin', 'Rilla']);
  });
});

describe('GrantCurrencyPanel — amount validation', () => {
  it('Grant is disabled with an empty amount', () => {
    renderPanel();
    expect(screen.getByRole('button', { name: /Grant gold to/ })).toBeDisabled();
  });

  it('Grant stays disabled for zero, negative, non-integer, bool-ish, or sci-notation amounts', () => {
    renderPanel();
    const input = screen.getByLabelText('Gold');
    // Parity with CurrencyPurse's own sweep — both 'true' AND 'false' (the
    // JSON-bool-injection shape the mandate names) on the SAME input.
    for (const bad of ['0', '-3', '2.5', 'abc', 'true', 'false', '3e2']) {
      fireEvent.change(input, { target: { value: bad } });
      expect(screen.getByRole('button', { name: /Grant gold to/ })).toBeDisabled();
    }
    expect(mockGrant).not.toHaveBeenCalled();
  });

  it('Grant stays disabled over the 1,000,000 cap, enables at exactly the cap', () => {
    renderPanel();
    const input = screen.getByLabelText('Gold');
    fireEvent.change(input, { target: { value: '1000001' } });
    expect(screen.getByRole('button', { name: /Grant gold to/ })).toBeDisabled();
    fireEvent.change(input, { target: { value: '1000000' } });
    expect(screen.getByRole('button', { name: /Grant gold to/ })).toBeEnabled();
  });
});

describe('GrantCurrencyPanel — Grant calls the right endpoint', () => {
  it('clicking Grant calls grantCurrency(sessionId, characterId, gold) for the selected target', async () => {
    mockGrant.mockResolvedValue({ currency_gp: 150, granted: 50 });
    renderPanel();

    fireEvent.change(screen.getByLabelText('Character'), { target: { value: '43' } });
    fireEvent.change(screen.getByLabelText('Gold'), { target: { value: '50' } });
    fireEvent.click(screen.getByRole('button', { name: 'Grant gold to Rilla' }));
    await flush();

    expect(mockGrant).toHaveBeenCalledWith('sess-1', '43', 50);
  });

  it('defaults the target to the first eligible character', async () => {
    mockGrant.mockResolvedValue({ currency_gp: 100, granted: 50 });
    renderPanel();

    fireEvent.change(screen.getByLabelText('Gold'), { target: { value: '50' } });
    fireEvent.click(screen.getByRole('button', { name: 'Grant gold to Ashwin' }));
    await flush();

    expect(mockGrant).toHaveBeenCalledWith('sess-1', '42', 50);
  });

  it('announces the new balance on a successful grant', async () => {
    mockGrant.mockResolvedValue({ currency_gp: 150, granted: 50 });
    renderPanel();

    fireEvent.change(screen.getByLabelText('Gold'), { target: { value: '50' } });
    fireEvent.click(screen.getByRole('button', { name: 'Grant gold to Ashwin' }));
    await flush();

    expect(
      await screen.findByText('Granted 50 gp to Ashwin (now 150 gp).'),
    ).toBeInTheDocument();
    // Amount clears after a successful grant.
    expect((screen.getByLabelText('Gold') as HTMLInputElement).value).toBe('');
  });
});

describe('GrantCurrencyPanel — refusal copy', () => {
  it('maps a known refusal reason to specific copy', async () => {
    const err = new Error('API error 400: 400') as Error & { status: number; body: unknown };
    err.status = 400;
    err.body = { success: false, message: 'bad amount', data: { reason: 'invalid_amount' } };
    mockGrant.mockRejectedValue(err);
    renderPanel();

    fireEvent.change(screen.getByLabelText('Gold'), { target: { value: '50' } });
    fireEvent.click(screen.getByRole('button', { name: 'Grant gold to Ashwin' }));
    await flush();

    expect(
      await screen.findByText('Grant amount must be a positive integer.'),
    ).toBeInTheDocument();
  });

  it('maps not_found (foreign/missing character — same reason a denied DM gets) to specific copy', async () => {
    const err = new Error('API error 404: 404') as Error & { status: number; body: unknown };
    err.status = 404;
    err.body = { success: false, message: 'Character not found.', data: { reason: 'not_found' } };
    mockGrant.mockRejectedValue(err);
    renderPanel();

    fireEvent.change(screen.getByLabelText('Gold'), { target: { value: '50' } });
    fireEvent.click(screen.getByRole('button', { name: 'Grant gold to Ashwin' }));
    await flush();

    expect(
      await screen.findByText("That character isn't seated at this table."),
    ).toBeInTheDocument();
  });

  it('maps balance_cap to specific copy', async () => {
    const err = new Error('API error 400: 400') as Error & { status: number; body: unknown };
    err.status = 400;
    err.body = { success: false, message: 'over cap', data: { reason: 'balance_cap' } };
    mockGrant.mockRejectedValue(err);
    renderPanel();

    fireEvent.change(screen.getByLabelText('Gold'), { target: { value: '50' } });
    fireEvent.click(screen.getByRole('button', { name: 'Grant gold to Ashwin' }));
    await flush();

    expect(
      await screen.findByText('That would exceed the maximum allowed balance.'),
    ).toBeInTheDocument();
  });

  it('maps session_not_found to specific copy', async () => {
    const err = new Error('API error 404: 404') as Error & { status: number; body: unknown };
    err.status = 404;
    err.body = { success: false, message: 'no session', data: { reason: 'session_not_found' } };
    mockGrant.mockRejectedValue(err);
    renderPanel();

    fireEvent.change(screen.getByLabelText('Gold'), { target: { value: '50' } });
    fireEvent.click(screen.getByRole('button', { name: 'Grant gold to Ashwin' }));
    await flush();

    expect(
      await screen.findByText('Session not found — reload and try again.'),
    ).toBeInTheDocument();
  });

  it('an unrecognized reason / network failure gets the transient fallback copy', async () => {
    mockGrant.mockRejectedValue(new Error('network blip'));
    renderPanel();

    fireEvent.change(screen.getByLabelText('Gold'), { target: { value: '50' } });
    fireEvent.click(screen.getByRole('button', { name: 'Grant gold to Ashwin' }));
    await flush();

    expect(
      await screen.findByText('Could not grant gold. Try again in a moment.'),
    ).toBeInTheDocument();
  });
});

describe('GrantCurrencyPanel — busy-latch double-submit protection', () => {
  it('back-to-back clicks in the same React batch call grantCurrency only once', async () => {
    mockGrant.mockResolvedValue({ currency_gp: 150, granted: 50 });
    renderPanel();

    fireEvent.change(screen.getByLabelText('Gold'), { target: { value: '50' } });
    const btn = screen.getByRole('button', { name: 'Grant gold to Ashwin' });
    await act(async () => {
      fireEvent.click(btn);
      fireEvent.click(btn);
    });
    await flush();

    expect(mockGrant).toHaveBeenCalledTimes(1);
  });

  it('releases the latch on a failed mutate — a subsequent click tries again', async () => {
    mockGrant.mockRejectedValueOnce(new Error('network blip'));
    mockGrant.mockResolvedValueOnce({ currency_gp: 150, granted: 50 });
    renderPanel();

    fireEvent.change(screen.getByLabelText('Gold'), { target: { value: '50' } });
    const btn = screen.getByRole('button', { name: 'Grant gold to Ashwin' });
    fireEvent.click(btn);
    await flush();
    expect(mockGrant).toHaveBeenCalledTimes(1);

    await waitFor(() => expect(btn).toBeEnabled());
    fireEvent.change(screen.getByLabelText('Gold'), { target: { value: '50' } });
    fireEvent.click(screen.getByRole('button', { name: 'Grant gold to Ashwin' }));
    await flush();
    expect(mockGrant).toHaveBeenCalledTimes(2);
  });

  it('all controls (character select, amount, Grant button) disable while a grant is in flight — parity with CurrencyPurse', async () => {
    let resolveGrant: (v: unknown) => void = () => {};
    mockGrant.mockReturnValue(
      new Promise((resolve) => {
        resolveGrant = resolve;
      }),
    );
    renderPanel();

    fireEvent.change(screen.getByLabelText('Gold'), { target: { value: '50' } });
    fireEvent.click(screen.getByRole('button', { name: 'Grant gold to Ashwin' }));
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByLabelText('Character')).toBeDisabled();
    expect(screen.getByLabelText('Gold')).toBeDisabled();
    expect(screen.getByRole('button', { name: /Grant gold to/ })).toBeDisabled();

    resolveGrant({ currency_gp: 150, granted: 50 });
    await flush();
  });
});

describe('GrantCurrencyPanel — disabled prop', () => {
  it('disabled=true disables the target select, amount input, and Grant button', () => {
    renderPanel(PARTICIPANTS, true);
    expect(screen.getByLabelText('Character')).toBeDisabled();
    expect(screen.getByLabelText('Gold')).toBeDisabled();
    expect(screen.getByRole('button', { name: /Grant gold to/ })).toBeDisabled();
  });
});
