/**
 * ResourcePanel — class-declared resources on the character sheet.
 *
 * The behaviours worth pinning are the ones where a pool and a track diverge,
 * and the ones where rendering something wrong would MISLEAD rather than just
 * look off: a track must never offer a Use control, a not-yet-unlocked
 * resource must not read as an empty pool, and a class with no resources must
 * render nothing at all rather than an empty card.
 *
 * Conventions mirror CurrencyPurse.test.tsx.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';

jest.mock('../../lib/api/dnd', () => ({
  listResources: jest.fn(),
  spendResource: jest.fn(),
  undoLastResource: jest.fn(),
}));

import * as dnd from '../../lib/api/dnd';
import { ToastProvider } from '../../components/Toast';
import ResourcePanel from '../../components/ResourcePanel';
import type { ClassResource } from '../../lib/api/types';

const mockList = dnd.listResources as jest.Mock;
const mockSpend = dnd.spendResource as jest.Mock;
const mockUndo = dnd.undoLastResource as jest.Mock;

function pool(over: Partial<ClassResource> = {}): ClassResource {
  return {
    key: 'ki',
    label: 'Ki',
    kind: 'pool',
    current: 3,
    maximum: 5,
    refresh: 'short',
    ...over,
  };
}

/** Default is deliberately BELOW the halfway mark, i.e. the NEUTRAL track
 *  state. The critical state is a distinct rendering (extra text + a changed
 *  aria-label), so tests that mean "critical" set it explicitly rather than
 *  inheriting it from a fixture — otherwise every track assertion silently
 *  tests only the danger branch. */
function track(over: Partial<ClassResource> = {}): ClassResource {
  return {
    key: 'instability',
    label: 'Instability',
    kind: 'track',
    current: 2,
    maximum: 10,
    refresh: 'none',
    ...over,
  };
}

function renderPanel(props: Partial<React.ComponentProps<typeof ResourcePanel>> = {}) {
  return render(
    <ToastProvider>
      <ResourcePanel
        characterId="cid-1"
        username="leon"
        isOwner
        {...props}
      />
    </ToastProvider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockList.mockResolvedValue({ resources: [], undoable: null });
});

describe('rendering', () => {
  it('renders a pool as current/maximum with its refresh cadence', async () => {
    mockList.mockResolvedValue({ resources: [pool()], undoable: null });
    renderPanel();
    expect(await screen.findByText('Ki')).toBeInTheDocument();
    expect(screen.getByText('3/5')).toBeInTheDocument();
    expect(screen.getByText('Short or long rest')).toBeInTheDocument();
  });

  it('renders NOTHING for a class that declares no resources', async () => {
    // Kage-CR I8: this used to gate on `mockList` HAVING BEEN CALLED, which is
    // synchronous in the effect — so it asserted while the component was still
    // in `resources === null` and returned null for a reason unrelated to the
    // claim. Mutating the `[]` handling left it green. Settle first.
    mockList.mockResolvedValue({ resources: [], undoable: null });
    const { container } = renderPanel();
    await act(async () => {});
    expect(screen.queryByText('Class resources')).not.toBeInTheDocument();
    expect(container.querySelector('ul')).toBeNull();
  });

  it('shows a not-yet-unlocked resource as "Unlocks later", not as 0/0', async () => {
    mockList.mockResolvedValue({
      resources: [pool({ current: 0, maximum: 0 })],
      undoable: null,
    });
    renderPanel();
    expect(await screen.findByText('Unlocks later')).toBeInTheDocument();
    expect(screen.queryByText('0/0')).not.toBeInTheDocument();
  });

  it('degrades alone when the fetch fails, without throwing', async () => {
    mockList.mockRejectedValue(new Error('boom'));
    renderPanel();
    expect(await screen.findByText(/Couldn’t load resources/)).toBeInTheDocument();
  });

  it('surfaces an unrecognised cadence verbatim rather than hiding it', async () => {
    mockList.mockResolvedValue({
      resources: [pool({ refresh: 'fortnightly' })],
      undoable: null,
    });
    renderPanel();
    expect(await screen.findByText('fortnightly')).toBeInTheDocument();
  });
});

describe('pool vs track — the distinction that must not blur', () => {
  it('offers a Use control for a pool but NEVER for a track', async () => {
    mockList.mockResolvedValue({ resources: [pool(), track()], undoable: null });
    renderPanel();
    await screen.findByText('Ki');
    expect(screen.getByLabelText('Use one Ki')).toBeInTheDocument();
    // A track is raised by the mechanics, never spent by the player, and the
    // engine refuses a track adjust outright (409 track_not_adjustable).
    expect(screen.queryByLabelText('Use one Instability')).not.toBeInTheDocument();
  });

  it('labels the meter by kind, so a screen reader hears which it is', async () => {
    mockList.mockResolvedValue({ resources: [pool(), track()], undoable: null });
    renderPanel();
    await screen.findByText('Ki');
    expect(screen.getByLabelText('Ki pool')).toBeInTheDocument();
    expect(screen.getByLabelText('Instability track')).toBeInTheDocument();
  });

  it('describes a track as a risk track rather than a rest cadence', async () => {
    mockList.mockResolvedValue({ resources: [track()], undoable: null });
    renderPanel();
    expect(await screen.findByText('Risk track')).toBeInTheDocument();
    expect(screen.queryByText('Does not refresh on rest')).not.toBeInTheDocument();
  });
});

describe('owner gate', () => {
  it('hides Use and Undo from a non-owner but still shows the state', async () => {
    mockList.mockResolvedValue({
      resources: [pool()],
      undoable: { key: 'ki', seq: 7 },
    });
    renderPanel({ isOwner: false });
    expect(await screen.findByText('3/5')).toBeInTheDocument();
    expect(screen.queryByLabelText('Use one Ki')).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Undo/)).not.toBeInTheDocument();
  });
});

describe('spend', () => {
  it('moves the number from the spend RESPONSE, before any refetch lands', async () => {
    // The claim in the component header is "apply the authoritative response
    // immediately, no refetch wait". Pin it by making the refetch never
    // resolve: if the number still moves, it came from the response.
    mockList.mockResolvedValueOnce({ resources: [pool()], undoable: null });
    mockList.mockReturnValue(new Promise(() => {})); // reconcile hangs forever
    mockSpend.mockResolvedValue({
      key: 'ki',
      label: 'Ki',
      current: 2,
      maximum: 5,
      spent: 1,
      undoable: { key: 'ki', seq: 9 },
    });
    renderPanel();
    await screen.findByText('3/5');
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Use one Ki'));
    });
    await waitFor(() => expect(screen.getByText('2/5')).toBeInTheDocument());
    expect(mockSpend).toHaveBeenCalledWith('cid-1', 'ki', 'leon', 1);
  });

  it('reconciles from the refetch, so a server-side change wins', async () => {
    // The optimistic value is the RESPONSE's; the refetch is what catches
    // anything the response could not know about (a concurrent DM correction,
    // a track moved by the same action). Server value must win.
    mockList.mockResolvedValueOnce({ resources: [pool()], undoable: null });
    mockList.mockResolvedValue({
      resources: [pool({ current: 1 })],
      undoable: { key: 'ki', seq: 9 },
    });
    mockSpend.mockResolvedValue({
      key: 'ki', label: 'Ki', current: 2, maximum: 5, spent: 1, undoable: null,
    });
    renderPanel();
    await screen.findByText('3/5');
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Use one Ki'));
    });
    await waitFor(() => expect(screen.getByText('1/5')).toBeInTheDocument());
  });

  it('maps the engine’s key-scoped insufficiency reason to readable copy', async () => {
    mockList.mockResolvedValue({ resources: [pool({ current: 1 })], undoable: null });
    const err = Object.assign(new Error('nope'), {
      status: 409,
      body: { data: { reason: 'insufficient_ki' } },
    });
    mockSpend.mockRejectedValue(err);
    renderPanel();
    await screen.findByText('1/5');
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Use one Ki'));
    });
    expect(await screen.findByText('Not enough Ki left.')).toBeInTheDocument();
  });

  it('latches against a same-tick double click', async () => {
    mockList.mockResolvedValue({ resources: [pool()], undoable: null });
    let resolve: (v: unknown) => void = () => {};
    mockSpend.mockReturnValue(new Promise((r) => { resolve = r; }));
    renderPanel();
    await screen.findByText('3/5');
    const btn = screen.getByLabelText('Use one Ki');
    await act(async () => {
      fireEvent.click(btn);
      fireEvent.click(btn);
    });
    expect(mockSpend).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolve({ key: 'ki', label: 'Ki', current: 2, maximum: 5, spent: 1, undoable: null });
    });
  });
});

describe('undo', () => {
  it('passes the rendered seq so a stale panel cannot undo a different spend', async () => {
    mockList.mockResolvedValue({
      resources: [pool({ current: 2 })],
      undoable: { key: 'ki', seq: 42 },
    });
    mockUndo.mockResolvedValue({
      key: 'ki', label: 'Ki', current: 3, maximum: 5, spent: 0, undoable: null,
    });
    renderPanel();
    await screen.findByText('2/5');
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Undo the last resource spend'));
    });
    expect(mockUndo).toHaveBeenCalledWith('cid-1', 'leon', 42);
  });

  it('does not offer Undo when there is nothing undoable', async () => {
    mockList.mockResolvedValue({ resources: [pool()], undoable: null });
    renderPanel();
    await screen.findByText('3/5');
    expect(screen.queryByLabelText('Undo the last resource spend')).not.toBeInTheDocument();
  });
});

describe('refreshToken', () => {
  it('refetches when the parent bumps it (a level-up regrows maxima)', async () => {
    mockList.mockResolvedValue({ resources: [pool()], undoable: null });
    const { rerender } = renderPanel({ refreshToken: 3 });
    await waitFor(() => expect(mockList).toHaveBeenCalledTimes(1));
    rerender(
      <ToastProvider>
        <ResourcePanel characterId="cid-1" username="leon" isOwner refreshToken={4} />
      </ToastProvider>,
    );
    await waitFor(() => expect(mockList).toHaveBeenCalledTimes(2));
  });
});


describe('Iro-A11y + engine-contract fixes', () => {
  it('titles the panel at h2 — a PEER of Inventory/Features, not an orphan h3', async () => {
    // Every other top-level section on the sheet is h2. As an h3 sharing a
    // Card with the headingless CurrencyPurse, this was skipped entirely by
    // h2 quick-nav, or read as a false subsection of "Inventory".
    mockList.mockResolvedValue({ resources: [pool()], undoable: null });
    renderPanel();
    const h = await screen.findByRole('heading', { name: 'Class resources' });
    expect(h.tagName).toBe('H2');
  });

  it('titles the ERROR state at h2 too', async () => {
    mockList.mockRejectedValue(new Error('boom'));
    renderPanel();
    const h = await screen.findByRole('heading', { name: 'Class resources' });
    expect(h.tagName).toBe('H2');
  });

  it('announces a critical track in TEXT, not by colour alone', async () => {
    // The neutral and danger fills are 1.07-1.50:1 apart from each other
    // across the four palettes — effectively invisible. Colour cannot be the
    // only carrier of "this track is about to Surge".
    mockList.mockResolvedValue({
      resources: [track({ current: 8, maximum: 10 })],
      undoable: null,
    });
    renderPanel();
    expect(await screen.findByText('Risk track — critical')).toBeInTheDocument();
    expect(screen.getByLabelText('Instability track, critical')).toBeInTheDocument();
  });

  it('does NOT mark a track critical below the halfway point', async () => {
    // Positive control on the threshold — without it, a component that always
    // said "critical" would pass the test above.
    mockList.mockResolvedValue({
      resources: [track({ current: 2, maximum: 10 })],
      undoable: null,
    });
    renderPanel();
    expect(await screen.findByText('Risk track')).toBeInTheDocument();
    expect(screen.queryByText('Risk track — critical')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Instability track')).toBeInTheDocument();
  });

  it.each([
    ['seq_mismatch', 'That spend is no longer the most recent one. Refreshing…'],
    ['state_moved', 'That resource has changed since — undoing it is no longer safe.'],
    ['nothing_to_undo', 'There is nothing left to undo.'],
  ])('maps the engine’s REAL undo refusal %s to specific copy', async (reason, copy) => {
    // These are verified against routes/resources.py. An earlier version of
    // this map invented `undo_target_mismatch` / `stale_seq` /
    // `undo_window_expired` — codes the engine never emits — so every one of
    // those refusals silently fell through to the generic fallback.
    mockList.mockResolvedValue({
      resources: [pool({ current: 2 })],
      undoable: { key: 'ki', seq: 42 },
    });
    mockUndo.mockRejectedValue(
      Object.assign(new Error('nope'), { status: 409, body: { data: { reason } } }),
    );
    renderPanel();
    await screen.findByText('2/5');
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Undo the last resource spend'));
    });
    expect(await screen.findByText(copy)).toBeInTheDocument();
  });
});


describe('Kage-CR — reconcile lifecycle', () => {
  it('drops a LATE-resolving earlier load instead of clobbering fresher state', async () => {
    // C1, reproduced by Kage as "server truth 1/5, panel shows 3/5". The
    // post-mutation reconciles are signal-less and the busy latch releases
    // before they resolve, so two in-flight GETs race and the LAST to land
    // wins. A generation guard makes the NEWEST win instead.
    let resolveSlow: (v: unknown) => void = () => {};
    mockList
      .mockResolvedValueOnce({ resources: [pool()], undoable: null }) // mount 3/5
      .mockReturnValueOnce(new Promise((r) => { resolveSlow = r; })) // gen 2, slow
      .mockResolvedValueOnce({ resources: [pool({ current: 1 })], undoable: null }); // gen 3

    const { rerender } = renderPanel({ refreshToken: 1 });
    await screen.findByText('3/5');

    const bump = (n: number) =>
      rerender(
        <ToastProvider>
          <ResourcePanel characterId="cid-1" username="leon" isOwner refreshToken={n} />
        </ToastProvider>,
      );
    bump(2); // starts the slow gen-2 load
    bump(3); // starts gen 3, which resolves immediately
    await waitFor(() => expect(screen.getByText('1/5')).toBeInTheDocument());

    // Now the STALE gen-2 response lands. It must be discarded.
    await act(async () => {
      resolveSlow({ resources: [pool({ current: 5, maximum: 5 })], undoable: null });
    });
    expect(screen.getByText('1/5')).toBeInTheDocument();
    expect(screen.queryByText('5/5')).not.toBeInTheDocument();
  });

  it('a BACKGROUND reconcile failure keeps the display instead of blanking it', async () => {
    // I1: a successful spend followed by a transient GET failure replaced the
    // entire list with an error card, moments after a success toast.
    mockList.mockResolvedValueOnce({ resources: [pool()], undoable: null });
    mockList.mockRejectedValue(new Error('transient'));
    mockSpend.mockResolvedValue({
      key: 'ki', label: 'Ki', current: 2, maximum: 5, spent: 1, undoable: null,
    });
    renderPanel();
    await screen.findByText('3/5');
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Use one Ki'));
    });
    // The spend's own value survives; no error card.
    expect(screen.getByText('2/5')).toBeInTheDocument();
    expect(screen.queryByText(/Couldn’t load resources/)).not.toBeInTheDocument();
  });

  it('an ABORTED load does not render a false error card', async () => {
    // I2: `apiFetch` rethrows a PLAIN Error for an abort, so `err.name ===
    // "AbortError"` does not work (five admin pages carry that dead guard).
    // The signal is the reliable check.
    mockList.mockResolvedValueOnce({ resources: [pool()], undoable: null });
    mockList.mockImplementation((_c, _u, signal?: AbortSignal) =>
      new Promise((_res, rej) => {
        signal?.addEventListener('abort', () => rej(new Error('abort')));
      }),
    );
    const { rerender, unmount } = renderPanel({ refreshToken: 1 });
    await screen.findByText('3/5');
    rerender(
      <ToastProvider>
        <ResourcePanel characterId="cid-1" username="leon" isOwner refreshToken={2} />
      </ToastProvider>,
    );
    await act(async () => { unmount(); });
    // Nothing to assert on the DOM after unmount — the real claim is that no
    // "setState on unmounted"/error path ran. Re-render fresh and confirm the
    // error card is not the resting state.
    mockList.mockResolvedValue({ resources: [pool()], undoable: null });
    renderPanel();
    expect(await screen.findByText('3/5')).toBeInTheDocument();
    expect(screen.queryByText(/Couldn’t load resources/)).not.toBeInTheDocument();
  });

  it('reconciles after a REFUSED spend, not just a successful one', async () => {
    // I3: the engine refusing means our number was wrong. Returning early
    // without a refetch left the stale value AND a live button.
    mockList.mockResolvedValue({ resources: [pool()], undoable: null });
    mockSpend.mockRejectedValue(
      Object.assign(new Error('nope'), {
        status: 409, body: { data: { reason: 'insufficient_ki' } },
      }),
    );
    renderPanel();
    await screen.findByText('3/5');
    const before = mockList.mock.calls.length;
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Use one Ki'));
    });
    expect(mockList.mock.calls.length).toBeGreaterThan(before);
  });

  it('applies undo’s own response and clears the Undo affordance', async () => {
    // I5: undo discarded its authoritative payload, so the number lagged a
    // round trip and Undo stayed clickable into a guaranteed nothing_to_undo.
    mockList.mockResolvedValueOnce({
      resources: [pool({ current: 2 })],
      undoable: { key: 'ki', seq: 42 },
    });
    mockList.mockReturnValue(new Promise(() => {})); // reconcile hangs
    mockUndo.mockResolvedValue({
      key: 'ki', current: 3, maximum: 5, restored: 1, requested: 1,
    });
    renderPanel();
    await screen.findByText('2/5');
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Undo the last resource spend'));
    });
    expect(screen.getByText('3/5')).toBeInTheDocument();
    expect(
      screen.queryByLabelText('Undo the last resource spend'),
    ).not.toBeInTheDocument();
  });
});

describe('Kage-CR I7 — the two highest-value coverage gaps', () => {
  it('hides Use on an EMPTY pool — the engine would only refuse it', async () => {
    // Mutation-proven gap: dropping `res.current > 0` from `canSpend` left all
    // 23 tests green. This is focus #1 — a control implying an action the
    // engine will refuse.
    mockList.mockResolvedValue({
      resources: [pool({ current: 0, maximum: 5 })],
      undoable: null,
    });
    renderPanel();
    expect(await screen.findByText('0/5')).toBeInTheDocument();
    expect(screen.queryByLabelText('Use one Ki')).not.toBeInTheDocument();
  });

  it('the meter reports the REAL value, not a hardcoded or inverted one', async () => {
    // Mutation-proven gap: `pct` could be hardcoded to 100 (a 1/5 pool
    // rendering a full bar) or inverted, and nothing failed.
    mockList.mockResolvedValue({
      resources: [pool({ current: 1, maximum: 5 })],
      undoable: null,
    });
    renderPanel();
    const meter = await screen.findByLabelText('Ki pool');
    expect(meter).toHaveAttribute('aria-valuenow', '1');
    expect(meter).toHaveAttribute('aria-valuemin', '0');
    expect(meter).toHaveAttribute('aria-valuemax', '5');
    // The fill width is the visual half of the same number.
    const fill = meter.firstElementChild as HTMLElement;
    expect(fill).toHaveStyle({ width: '20%' });
  });

  it('a full pool fills the meter completely', async () => {
    // Positive control on the width assertion above — without it, a component
    // that always rendered 0% would pass.
    mockList.mockResolvedValue({ resources: [pool({ current: 5, maximum: 5 })], undoable: null });
    renderPanel();
    const meter = await screen.findByLabelText('Ki pool');
    expect((meter.firstElementChild as HTMLElement)).toHaveStyle({ width: '100%' });
  });
});
