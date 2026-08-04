/**
 * Password self-service — the signed-in change flow and the shared field block.
 *
 * The behaviours worth pinning are the ones where getting it wrong is a
 * SECURITY or lockout problem rather than a cosmetic one:
 *   - a successful change signs you out everywhere, and the UI must say so
 *     BEFORE you commit and act on it after;
 *   - the client must not enforce a policy the server doesn't (that locks a
 *     user out of a passphrase the server would have taken);
 *   - server-side field errors must be surfaced verbatim, not replaced.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';

const push = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

jest.mock('../../lib/api/auth', () => ({
  changePassword: jest.fn(),
  passwordPolicy: jest.fn(),
}));

import * as auth from '../../lib/api/auth';
import ChangePassphrasePanel from '../../components/ChangePassphrasePanel';

const mockChange = auth.changePassword as jest.Mock;
const mockPolicy = auth.passwordPolicy as jest.Mock;

const POLICY = {
  min_length: 8,
  max_length: 128,
  require_uppercase: true,
  require_lowercase: true,
  require_digit: true,
  require_special: true,
  history_depth: 5,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockPolicy.mockResolvedValue(POLICY);
});

async function fill(current: string, next: string, confirm = next) {
  render(<ChangePassphrasePanel />);
  await act(async () => {});
  fireEvent.change(screen.getByLabelText('Current passphrase'), {
    target: { value: current },
  });
  fireEvent.change(screen.getByLabelText('New passphrase'), {
    target: { value: next },
  });
  fireEvent.change(screen.getByLabelText('Confirm new passphrase'), {
    target: { value: confirm },
  });
}

describe('the sign-out consequence', () => {
  it('warns BEFORE submit that this signs you out everywhere', async () => {
    render(<ChangePassphrasePanel />);
    await act(async () => {});
    expect(
      screen.getByText(/signs you out everywhere/i),
    ).toBeInTheDocument();
  });

  it('sends the user to /login after a successful change', async () => {
    // The BFF clears this browser's cookies because upstream revoked every
    // session — leaving the user here would 401 their next action.
    // Fake timers must be installed BEFORE the click: the redirect is a
    // real `setTimeout` scheduled during the submit, and advancing fake
    // timers cannot fire a callback that was queued on the real clock.
    // Queries below are synchronous for the same reason — `findByText` waits
    // on real timers and would hang.
    jest.useFakeTimers();
    try {
      mockChange.mockResolvedValue({ msg: 'ok' });
      await fill('old-one', 'Brand-New-1!');
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /change passphrase/i }));
      });
      expect(screen.getByText(/Every session was signed out/i)).toBeInTheDocument();
      await act(async () => {
        jest.advanceTimersByTime(2500);
      });
      expect(push).toHaveBeenCalledWith('/login');
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('validation is the SERVER’s job', () => {
  it('enables submit for a weak passphrase — the server decides, not us', async () => {
    // A client rule stricter than the server's would refuse a passphrase the
    // server would accept. The checklist is guidance; the gate is only
    // "non-empty and matching".
    await fill('old-one', 'abc');
    expect(
      screen.getByRole('button', { name: /change passphrase/i }),
    ).toBeEnabled();
  });

  it('blocks submit when the two new fields differ, and says so', async () => {
    await fill('old-one', 'Brand-New-1!', 'Brand-New-2!');
    expect(screen.getByText(/don’t match/i)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /change passphrase/i }),
    ).toBeDisabled();
  });

  it('surfaces the server’s field-level errors verbatim', async () => {
    mockChange.mockRejectedValue(
      Object.assign(new Error('bad'), {
        status: 400,
        body: { msg: 'nope', errors: ['Password must contain a digit'] },
      }),
    );
    await fill('old-one', 'Brand-New-1!');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /change passphrase/i }));
    });
    expect(
      await screen.findByText('Password must contain a digit'),
    ).toBeInTheDocument();
  });

  it('maps a 429 to rate-limit copy rather than a generic failure', async () => {
    mockChange.mockRejectedValue(
      Object.assign(new Error('slow down'), { status: 429, body: {} }),
    );
    await fill('old-one', 'Brand-New-1!');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /change passphrase/i }));
    });
    expect(await screen.findByText(/too many attempts/i)).toBeInTheDocument();
  });
});

describe('the live policy checklist', () => {
  it('reflects the SERVER’s rules, not a hardcoded list', async () => {
    mockPolicy.mockResolvedValue({ ...POLICY, min_length: 14, require_special: false });
    render(<ChangePassphrasePanel />);
    expect(await screen.findByText('At least 14 characters')).toBeInTheDocument();
    // require_special: false -> that rule must not be shown at all.
    expect(screen.queryByText('A symbol')).not.toBeInTheDocument();
  });

  it('still renders a usable form when the policy fetch fails', async () => {
    // The hint is an affordance, not a gate.
    mockPolicy.mockRejectedValue(new Error('down'));
    render(<ChangePassphrasePanel />);
    await act(async () => {});
    expect(screen.getByLabelText('New passphrase')).toBeInTheDocument();
  });

  it('marks a rule met in TEXT, not by colour alone', async () => {
    render(<ChangePassphrasePanel />);
    await act(async () => {});
    fireEvent.change(screen.getByLabelText('New passphrase'), {
      target: { value: 'abcdefghij' },
    });
    await waitFor(() =>
      expect(screen.getByLabelText('A lowercase letter — met')).toBeInTheDocument(),
    );
    expect(
      screen.getByLabelText('A number — not yet met'),
    ).toBeInTheDocument();
  });
});
