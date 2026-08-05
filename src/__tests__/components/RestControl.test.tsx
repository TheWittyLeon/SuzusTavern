/**
 * RestControl — short/long rest on the character sheet (TAV-REST-UI).
 *
 * The behaviours worth pinning are the ones where getting it wrong MISLEADS
 * rather than merely looks off:
 *
 *   1. A long rest is irreversible and clears a risk track, so it must not
 *      fire straight off the button — the confirm is the feature, not chrome.
 *   2. A rest returns ONLY a message. Every number on the sheet is stale until
 *      the parent refetches, so `onRested` firing is the whole contract.
 *   3. A reconcile that fails after a rest that SUCCEEDED must not be reported
 *      as a failed rest. That copy would make a player rest twice.
 *   4. Refusal copy is mapped only to codes the stack really emits — this
 *      component's sibling already shipped three invented ones.
 *
 * Conventions mirror ResourcePanel.test.tsx.
 */
import React from 'react';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

jest.mock('../../lib/api/dnd', () => ({
  characterRest: jest.fn(),
}));

import * as dnd from '../../lib/api/dnd';
import { ToastProvider } from '../../components/Toast';
import RestControl from '../../components/RestControl';

const mockRest = dnd.characterRest as jest.Mock;

function renderControl(props: Partial<React.ComponentProps<typeof RestControl>> = {}) {
  const onRested = jest.fn().mockResolvedValue(undefined);
  const utils = render(
    <ToastProvider>
      <RestControl
        characterId="cid-1"
        username="leon"
        isOwner
        onRested={onRested}
        {...props}
      />
    </ToastProvider>,
  );
  return { ...utils, onRested: (props.onRested as jest.Mock) ?? onRested };
}

/** Click Long rest, then confirm in the dialog. */
async function takeLongRest() {
  fireEvent.click(screen.getByRole('button', { name: 'Long rest' }));
  const confirm = await screen.findByRole('button', { name: 'Take a long rest' });
  await act(async () => {
    fireEvent.click(confirm);
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRest.mockResolvedValue({ message: 'You feel rested.' });
});

describe('ownership gate', () => {
  it('renders no rest controls for a non-owner', () => {
    renderControl({ isOwner: false });
    expect(screen.queryByRole('button', { name: 'Short rest' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Long rest' })).not.toBeInTheDocument();
  });

  it('renders both controls for the owner (positive control for the gate)', () => {
    renderControl();
    expect(screen.getByRole('button', { name: 'Short rest' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Long rest' })).toBeInTheDocument();
  });
});

describe('short rest', () => {
  it('sends rest_type "short" with no confirmation step', async () => {
    renderControl();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Short rest' }));
    });
    expect(mockRest).toHaveBeenCalledTimes(1);
    expect(mockRest).toHaveBeenCalledWith('cid-1', 'leon', 'short');
  });

  it('shows the ENGINE message rather than a sentence of its own', async () => {
    mockRest.mockResolvedValue({ message: 'You recover 2 hit dice.' });
    renderControl();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Short rest' }));
    });
    expect(await screen.findByText('You recover 2 hit dice.')).toBeInTheDocument();
  });

  it('re-voices the REAL engine string instead of leaking chat formatting', async () => {
    // The literal shape `cmd_longrest` returns — a bracket tag and the
    // player's own name in the third person. Every fixture in the first
    // version of this file used an invented clean string, which is exactly
    // why the chat formatting shipped unnoticed (Kage-CR I2). The RECOVERY
    // DETAIL must survive verbatim; only the preamble is rewritten.
    mockRest.mockResolvedValue({
      message:
        '[Rest] leon takes a long rest. All spell slots restored. HP restored to 9/9, hit dice 4/6.',
    });
    renderControl();
    await takeLongRest();
    expect(
      await screen.findByText(
        'You take a long rest. All spell slots restored. HP restored to 9/9, hit dice 4/6.',
      ),
    ).toBeInTheDocument();
  });

  it('leaves an unrecognised engine phrasing UNCHANGED rather than mangling it', async () => {
    // The failure mode that matters if the engine's wording ever changes: a
    // partially-applied rewrite would show a truncated or misleading
    // sentence. Returning it whole keeps it true, if slightly odd.
    mockRest.mockResolvedValue({ message: 'The shard is quiet once more.' });
    renderControl();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Short rest' }));
    });
    expect(
      await screen.findByText('The shard is quiet once more.'),
    ).toBeInTheDocument();
  });

  it('never rewrites a DIFFERENT name out of the message', async () => {
    // The rewrite is anchored to the caller's own username on purpose. A
    // blanket `\w+ takes` would silently third-person-strip an ally's name
    // from a message that legitimately mentions one.
    mockRest.mockResolvedValue({ message: '[Rest] mallory takes a short rest.' });
    renderControl();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Short rest' }));
    });
    expect(await screen.findByText('mallory takes a short rest.')).toBeInTheDocument();
  });

  it('falls back to its own copy when the hop answers with no message', async () => {
    // A degraded hop can answer `{}` — the component must still confirm the
    // rest happened rather than render an empty toast.
    mockRest.mockResolvedValue({});
    renderControl();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Short rest' }));
    });
    expect(await screen.findByText('Short rest taken.')).toBeInTheDocument();
  });
});

describe('long rest — the confirm is the feature', () => {
  it('does NOT rest on the button alone', async () => {
    renderControl();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Long rest' }));
    });
    expect(mockRest).not.toHaveBeenCalled();
  });

  it('warns that it cannot be undone and clears a risk track', async () => {
    renderControl();
    fireEvent.click(screen.getByRole('button', { name: 'Long rest' }));
    expect(await screen.findByText(/cannot be undone/i)).toBeInTheDocument();
    expect(screen.getByText(/risk track/i)).toBeInTheDocument();
  });

  it('sends rest_type "long" once confirmed', async () => {
    renderControl();
    await takeLongRest();
    expect(mockRest).toHaveBeenCalledTimes(1);
    expect(mockRest).toHaveBeenCalledWith('cid-1', 'leon', 'long');
  });

  it('CLOSES the dialog after the rest completes', async () => {
    // The untested half of "the confirm is the feature" (Kage-CR I6): every
    // other test here proves the dialog opens and gates the call, and nothing
    // proved it goes away. Regress `setConfirmingLong(false)` in the `finally`
    // and the player is left sitting in a modal after a successful,
    // irreversible action, staring at a live "Take a long rest" button —
    // which invites exactly the double rest the whole component guards
    // against. Mutation-verified: deleting that line was green before this.
    renderControl();
    await takeLongRest();
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: 'Take a long rest' }),
      ).not.toBeInTheDocument(),
    );
  });

  it('CLOSES the dialog even when the rest is refused', async () => {
    // The `finally` covers both paths; a refusal that stranded the modal
    // would be the same trap with worse timing.
    mockRest.mockRejectedValue(
      Object.assign(new Error('nope'), {
        status: 404,
        body: { data: { reason: 'not_found' } },
      }),
    );
    renderControl();
    await takeLongRest();
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: 'Take a long rest' }),
      ).not.toBeInTheDocument(),
    );
  });

  it('cancelling rests nothing at all', async () => {
    renderControl();
    fireEvent.click(screen.getByRole('button', { name: 'Long rest' }));
    const cancel = await screen.findByRole('button', { name: 'Cancel' });
    await act(async () => {
      fireEvent.click(cancel);
    });
    expect(mockRest).not.toHaveBeenCalled();
  });
});

describe('reconcile — the response carries no numbers', () => {
  it('calls onRested after a successful rest', async () => {
    const { onRested } = renderControl();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Short rest' }));
    });
    await waitFor(() => expect(onRested).toHaveBeenCalledTimes(1));
  });

  it('does NOT call onRested when the rest was refused', async () => {
    // The negative half of the test above. Without it, an implementation that
    // reconciled unconditionally would pass the positive case and look right.
    mockRest.mockRejectedValue(
      Object.assign(new Error('nope'), {
        status: 404,
        body: { data: { reason: 'not_found' } },
      }),
    );
    const { onRested } = renderControl();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Short rest' }));
    });
    expect(onRested).not.toHaveBeenCalled();
  });

  it('a FAILED reconcile is not reported as a failed rest', async () => {
    // The distinction that matters most in this component: the rest really
    // happened. Telling the player it did not is how they take a second one.
    const onRested = jest.fn().mockRejectedValue(new Error('sheet refetch died'));
    renderControl({ onRested });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Short rest' }));
    });
    expect(
      await screen.findByText(
        'Rested — but these numbers may be out of date. Reload to see them.',
      ),
    ).toBeInTheDocument();
    // The assertion that makes the one above non-vacuous: the failure copy
    // must NOT be the one used for a rest that genuinely did not happen.
    expect(
      screen.queryByText('Could not rest. Try again in a moment.'),
    ).not.toBeInTheDocument();
  });
});

describe('refusals — only codes the stack actually emits', () => {
  it('maps not_found with copy that does not resolve owner-vs-missing', async () => {
    // The engine answers 404/not_found for "not yours" AND "does not exist"
    // deliberately, to close an enumeration oracle. The copy must not undo
    // that by telling the viewer which one it was.
    mockRest.mockRejectedValue(
      Object.assign(new Error('nope'), {
        status: 404,
        body: { data: { reason: 'not_found' } },
      }),
    );
    renderControl();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Short rest' }));
    });
    const msg = await screen.findByText('That character could not be found.');
    expect(msg).toBeInTheDocument();
    expect(screen.queryByText(/not yours|permission|owner/i)).not.toBeInTheDocument();
  });

  it('maps the proxy-level invalid_rest_type', async () => {
    mockRest.mockRejectedValue(
      Object.assign(new Error('nope'), {
        status: 400,
        body: { data: { reason: 'invalid_rest_type' } },
      }),
    );
    renderControl();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Short rest' }));
    });
    expect(
      await screen.findByText('That rest type is not recognised.'),
    ).toBeInTheDocument();
  });

  it('falls back for a 503, which carries no data.reason at all', async () => {
    mockRest.mockRejectedValue(
      Object.assign(new Error('down'), {
        status: 503,
        body: { error: 'D&D service unavailable' },
      }),
    );
    renderControl();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Short rest' }));
    });
    expect(
      await screen.findByText('Could not rest. Try again in a moment.'),
    ).toBeInTheDocument();
  });
});

describe('a11y — focus after a short rest (Iro)', () => {
  it('returns focus to the Short rest button once busy clears', async () => {
    // A real browser blurs a focused button the instant it becomes
    // `disabled` (the same LEVELUP-UX-A11Y-TAIL rule ConfirmDialog's own
    // busy-focus-park effect exists for) — jsdom does not reproduce that
    // blur (disabled elements keep focus there), so this can only assert
    // the OUTCOME: once busy clears, focus is back on the trigger, not
    // stranded wherever the blur would have left it.
    renderControl();
    const btn = screen.getByRole('button', { name: 'Short rest' });
    btn.focus();
    expect(btn).toHaveFocus();
    await act(async () => {
      fireEvent.click(btn);
    });
    await waitFor(() => expect(btn).toHaveFocus());
  });

  it('does NOT steal focus onto Short rest after a long rest completes', async () => {
    // The negative half: ConfirmDialog already owns restoring focus to the
    // Long rest trigger on close (it captures `document.activeElement` when
    // it opens, hence the explicit `.focus()` below — `fireEvent.click`
    // dispatches a click without moving focus the way a real pointer/
    // keyboard interaction would). If this component's own restore effect
    // were not scoped to the short-rest path, it would fire on ANY busy
    // clear and yank focus onto the wrong button.
    renderControl();
    const longBtn = screen.getByRole('button', { name: 'Long rest' });
    longBtn.focus();
    fireEvent.click(longBtn);
    const confirm = await screen.findByRole('button', { name: 'Take a long rest' });
    await act(async () => {
      fireEvent.click(confirm);
    });
    await waitFor(() => expect(longBtn).toHaveFocus());
    expect(screen.getByRole('button', { name: 'Short rest' })).not.toHaveFocus();
  });
});

describe('double-submit', () => {
  it('latches against a same-tick double click', async () => {
    let resolve: (v: unknown) => void = () => {};
    mockRest.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    renderControl();
    const btn = screen.getByRole('button', { name: 'Short rest' });
    // BOTH CLICKS INSIDE ONE `act`, and that is the whole test.
    //
    // RTL wraps each bare `fireEvent` in its own `act`, which FLUSHES the
    // re-render — so two loose clicks let `setBusy(true)` land first and the
    // second click is turned away by the `busy` prop, not by the ref. Written
    // that way this test passed even after the ref latch was replaced with a
    // plain `if (busy) return`, i.e. it asserted nothing about the thing it
    // names (verified by mutation). Batching them into a single `act` is what
    // reproduces the real same-tick double click, where `busy` is still false
    // in the second handler's closure and the synchronous ref is the only
    // defence. A doubled rest is two irreversible mutations with no undo.
    await act(async () => {
      fireEvent.click(btn);
      fireEvent.click(btn);
    });
    expect(mockRest).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolve({ message: 'ok' });
    });
  });
});
