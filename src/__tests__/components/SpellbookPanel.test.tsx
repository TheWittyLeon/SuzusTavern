/**
 * SpellbookPanel — T4 (DDX-11t sheet Spells tab slice).
 *
 * Known-list rendering, Browse (available + learn/prepare) wiring, busy-latch,
 * success toast, non-caster empty rendering, empty spellbook — mirrors
 * InventoryPanel/SpellSlotsPanel's test conventions.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';

jest.mock('../../lib/api/dnd', () => ({
  getKnownSpells: jest.fn(),
  getAvailableSpells: jest.fn(),
  learnSpell: jest.fn(),
  prepareSpell: jest.fn(),
}));

import * as dnd from '../../lib/api/dnd';
import { ToastProvider } from '../../components/Toast';
import SpellbookPanel from '../../components/SpellbookPanel';
import type {
  AvailableSpellsResult,
  SpellBudget,
  SpellListResult,
} from '../../lib/api/types';

const mockGetKnown = dnd.getKnownSpells as jest.Mock;
const mockGetAvailable = dnd.getAvailableSpells as jest.Mock;
const mockLearn = dnd.learnSpell as jest.Mock;
const mockPrepare = dnd.prepareSpell as jest.Mock;

const BUDGET: SpellBudget = {
  cantrips_known: 2,
  cantrips_max: 4,
  spells_known: null,
  spells_max: null,
  prepared_used: 1,
  prepared_max: 3,
};

const KNOWN_WIZARD: SpellListResult = {
  is_spellcaster: true,
  caster_kind: 'spellbook',
  ability: 'intelligence',
  budget: BUDGET,
  cantrips: [
    {
      slug: 'fire-bolt',
      name: 'Fire Bolt',
      level: 0,
      school: 'evocation',
      source: 'class',
      prepared: true,
      is_cantrip: true,
      concentration: false,
      ritual: false,
      castable_now: true,
    },
  ],
  spells: [
    {
      slug: 'magic-missile',
      name: 'Magic Missile',
      level: 1,
      school: 'evocation',
      source: 'class',
      prepared: true,
      is_cantrip: false,
      concentration: false,
      ritual: false,
      castable_now: true,
      min_slot_level: 1,
    },
    {
      slug: 'shield',
      name: 'Shield',
      level: 1,
      school: 'abjuration',
      source: 'class',
      prepared: false,
      is_cantrip: false,
      concentration: false,
      ritual: false,
      castable_now: false,
      min_slot_level: 1,
    },
  ],
};

const EMPTY_KNOWN: SpellListResult = {
  is_spellcaster: true,
  caster_kind: 'spellbook',
  ability: 'intelligence',
  budget: BUDGET,
  cantrips: [],
  spells: [],
};

const AVAILABLE_WIZARD: AvailableSpellsResult = {
  cantrips: [
    {
      slug: 'mage-hand',
      name: 'Mage Hand',
      level: 0,
      school: 'conjuration',
      concentration: false,
      ritual: false,
      in_repertoire: false,
      prepared: false,
    },
  ],
  by_level: {
    '1': [
      {
        slug: 'shield',
        name: 'Shield',
        level: 1,
        school: 'abjuration',
        concentration: false,
        ritual: false,
        in_repertoire: true,
        prepared: false,
      },
      {
        slug: 'sleep',
        name: 'Sleep',
        level: 1,
        school: 'enchantment',
        concentration: false,
        ritual: false,
        in_repertoire: false,
        prepared: false,
      },
    ],
  },
  can_learn: true,
  can_prepare: true,
  budget: BUDGET,
};

/** Build a rejection matching the real ApiError shape (client.ts's
 *  makeApiError / apiCall) so learnErrorMessage/prepareErrorMessage's
 *  isApiError + refusalReason probe recognizes it — a plain `Error` never
 *  satisfies `'status' in e`, so mapping tests must use this instead of a
 *  bare `new Error(reason)`. */
function refusalError(reason: string) {
  const err = new Error(`API error 422: ${reason}`) as Error & {
    status: number;
    code: string;
    body: unknown;
  };
  err.status = 422;
  err.code = reason;
  err.body = { success: false, error: reason };
  return err;
}

function renderPanel(overrides?: { isOwner?: boolean; isCaster?: boolean; refreshKey?: number }) {
  return render(
    <ToastProvider>
      <SpellbookPanel
        characterId="cid-2"
        username="leon"
        isOwner={overrides?.isOwner ?? true}
        isCaster={overrides?.isCaster ?? true}
        refreshKey={overrides?.refreshKey}
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
  mockGetKnown.mockReset();
  mockGetAvailable.mockReset();
  mockLearn.mockReset();
  mockPrepare.mockReset();
});

describe('SpellbookPanel — non-caster renders nothing', () => {
  it('renders no spellbook widget at all when isCaster is false', async () => {
    renderPanel({ isCaster: false });
    await flush();
    expect(screen.queryByText('Spellbook')).not.toBeInTheDocument();
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    expect(mockGetKnown).not.toHaveBeenCalled();
    // MIKO: neither GET fires for a non-caster, not just the one the
    // existing test already checked — Browse's lazy load never has a chance
    // to trigger since the tablist itself never renders.
    expect(mockGetAvailable).not.toHaveBeenCalled();
  });
});

describe('SpellbookPanel — Known tab rendering', () => {
  it('fetches and renders known cantrips + leveled spells grouped by level, with a prepared pill', async () => {
    mockGetKnown.mockResolvedValue(KNOWN_WIZARD);
    renderPanel();
    await flush();

    // TAV-SPELLBOOK-STALE-AFTER-PICKER (Kage defect B): the mount effect now
    // threads an AbortController signal through the fetch — see
    // SpellbookPanel.tsx's mount/refreshKey effect.
    expect(mockGetKnown).toHaveBeenCalledWith('cid-2', 'leon', expect.any(AbortSignal));
    expect(screen.getByText('Cantrips')).toBeInTheDocument();
    expect(screen.getByText('Fire Bolt')).toBeInTheDocument();
    expect(screen.getByText('Level 1')).toBeInTheDocument();
    expect(screen.getByText('Magic Missile')).toBeInTheDocument();
    expect(screen.getByText('Shield')).toBeInTheDocument();
    expect(screen.getByText('prepared')).toBeInTheDocument();
    // LEVELUP-UX (Kage m11): the spell-info popover trigger is mounted on
    // every row in this host — the wrapper is invisible to getByText, so
    // this is the one assertion that fails if the mount is dropped.
    expect(
      screen.getAllByRole('button', { name: /spell details/i }).length,
    ).toBeGreaterThan(0);
  });

  it('renders the empty-spellbook graceful message for a caster with nothing known yet', async () => {
    mockGetKnown.mockResolvedValue(EMPTY_KNOWN);
    renderPanel();
    await flush();
    expect(screen.getByText('No spells known yet.')).toBeInTheDocument();
  });

  it('non-owner: no Prepare/Unprepare controls render on the Known tab, and no Browse tab at all', async () => {
    mockGetKnown.mockResolvedValue(KNOWN_WIZARD);
    renderPanel({ isOwner: false });
    await flush();

    expect(screen.queryByRole('button', { name: /^prepare/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^unprepare/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Browse' })).not.toBeInTheDocument();
  });
});

describe('SpellbookPanel — Browse tab: lazy load + learn wiring', () => {
  it('does not call getAvailableSpells until the Browse tab is opened', async () => {
    mockGetKnown.mockResolvedValue(KNOWN_WIZARD);
    renderPanel();
    await flush();
    expect(mockGetAvailable).not.toHaveBeenCalled();

    mockGetAvailable.mockResolvedValue(AVAILABLE_WIZARD);
    fireEvent.click(screen.getByRole('tab', { name: 'Browse' }));
    await flush();

    expect(mockGetAvailable).toHaveBeenCalledWith('cid-2', 'leon');
    expect(screen.getByText('Mage Hand')).toBeInTheDocument();
    expect(screen.getByText('Sleep')).toBeInTheDocument();
  });

  it('clicking Learn on an unlearned spell calls learnSpell(cid, username, slug), then refetches known + available', async () => {
    mockGetKnown.mockResolvedValue(KNOWN_WIZARD);
    mockGetAvailable.mockResolvedValue(AVAILABLE_WIZARD);
    mockLearn.mockResolvedValue({ learned: true, budget: BUDGET });
    renderPanel();
    await flush();

    fireEvent.click(screen.getByRole('tab', { name: 'Browse' }));
    await flush();

    mockGetKnown.mockClear();
    mockGetAvailable.mockClear();

    fireEvent.click(screen.getByRole('button', { name: 'Learn Sleep' }));
    await flush();

    expect(mockLearn).toHaveBeenCalledWith('cid-2', 'leon', 'sleep');
    expect(mockGetKnown).toHaveBeenCalledWith('cid-2', 'leon');
    expect(mockGetAvailable).toHaveBeenCalledWith('cid-2', 'leon');
    expect(await screen.findByText('Learned Sleep.')).toBeInTheDocument();
  });

  it('a spell already in_repertoire shows a "known" pill instead of a Learn button', async () => {
    mockGetKnown.mockResolvedValue(KNOWN_WIZARD);
    mockGetAvailable.mockResolvedValue(AVAILABLE_WIZARD);
    renderPanel();
    await flush();
    fireEvent.click(screen.getByRole('tab', { name: 'Browse' }));
    await flush();

    expect(screen.queryByRole('button', { name: 'Learn Shield' })).not.toBeInTheDocument();
    expect(screen.getByText('known')).toBeInTheDocument();
  });
});

describe('SpellbookPanel — prepare wiring (Known + Browse)', () => {
  it('clicking Prepare on a known unprepared spell calls prepareSpell(cid, username, slug, true), then refetches, with a success toast', async () => {
    mockGetKnown.mockResolvedValue(KNOWN_WIZARD);
    mockPrepare.mockResolvedValue({ prepared: true, prepared_used: 2, prepared_max: 3 });
    renderPanel();
    await flush();

    fireEvent.click(screen.getByRole('button', { name: 'Prepare Shield' }));
    await flush();

    expect(mockPrepare).toHaveBeenCalledWith('cid-2', 'leon', 'shield', true);
    expect(mockGetKnown).toHaveBeenCalledTimes(2); // initial mount + refetch
    expect(await screen.findByText('Prepared Shield.')).toBeInTheDocument();
  });

  it('clicking Unprepare on a prepared spell calls prepareSpell(..., false)', async () => {
    mockGetKnown.mockResolvedValue(KNOWN_WIZARD);
    mockPrepare.mockResolvedValue({ prepared: false, prepared_used: 0, prepared_max: 3 });
    renderPanel();
    await flush();

    fireEvent.click(screen.getByRole('button', { name: 'Unprepare Magic Missile' }));
    await flush();

    expect(mockPrepare).toHaveBeenCalledWith('cid-2', 'leon', 'magic-missile', false);
    expect(await screen.findByText('Unprepared Magic Missile.')).toBeInTheDocument();
  });

  it('a "known" caster_kind (e.g. sorcerer) shows no Prepare/Unprepare controls on the Known tab', async () => {
    mockGetKnown.mockResolvedValue({
      ...KNOWN_WIZARD,
      caster_kind: 'known',
    });
    renderPanel();
    await flush();
    expect(screen.queryByRole('button', { name: /^prepare/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^unprepare/i })).not.toBeInTheDocument();
  });
});

describe('SpellbookPanel — busy-latch double-submit protection', () => {
  it('back-to-back clicks on Learn in the same React batch call learnSpell only once', async () => {
    mockGetKnown.mockResolvedValue(KNOWN_WIZARD);
    mockGetAvailable.mockResolvedValue(AVAILABLE_WIZARD);
    mockLearn.mockResolvedValue({ learned: true, budget: BUDGET });
    renderPanel();
    await flush();
    fireEvent.click(screen.getByRole('tab', { name: 'Browse' }));
    await flush();

    const learnBtn = screen.getByRole('button', { name: 'Learn Sleep' });
    await act(async () => {
      fireEvent.click(learnBtn);
      fireEvent.click(learnBtn);
    });
    await flush();

    expect(mockLearn).toHaveBeenCalledTimes(1);
  });

  it('releases the latch on a failed learn mutate — a subsequent click tries again, with an error toast', async () => {
    mockGetKnown.mockResolvedValue(KNOWN_WIZARD);
    mockGetAvailable.mockResolvedValue(AVAILABLE_WIZARD);
    mockLearn.mockRejectedValueOnce(refusalError('over_known_limit'));
    mockLearn.mockResolvedValueOnce({ learned: true, budget: BUDGET });
    renderPanel();
    await flush();
    fireEvent.click(screen.getByRole('tab', { name: 'Browse' }));
    await flush();

    const learnBtn = screen.getByRole('button', { name: 'Learn Sleep' });
    fireEvent.click(learnBtn);
    await flush();
    expect(mockLearn).toHaveBeenCalledTimes(1);
    // KAGE fix: a deterministic engine refusal surfaces its SPECIFIC reason,
    // not the generic "try again in a moment" transient-failure copy.
    expect(await screen.findByText("You've reached your known-spell limit.")).toBeInTheDocument();

    await waitFor(() => expect(learnBtn).toBeEnabled());
    fireEvent.click(learnBtn);
    await flush();
    expect(mockLearn).toHaveBeenCalledTimes(2);
  });

  it('a mutation in flight disables other controls (shared ref/state across Known + Browse)', async () => {
    mockGetKnown.mockResolvedValue(KNOWN_WIZARD);
    mockGetAvailable.mockResolvedValue(AVAILABLE_WIZARD);
    let resolvePrepare: (v: unknown) => void = () => {};
    mockPrepare.mockReturnValue(
      new Promise((resolve) => {
        resolvePrepare = resolve;
      }),
    );
    renderPanel();
    await flush();

    fireEvent.click(screen.getByRole('button', { name: 'Prepare Shield' }));
    await act(async () => {
      await Promise.resolve();
    });

    fireEvent.click(screen.getByRole('tab', { name: 'Browse' }));
    await flush();
    // Even after switching tabs, the shared busy state should still gate a
    // Learn click fired while the prepare above is in flight — the real
    // <button> is natively `disabled`, so jsdom refuses to dispatch the click
    // handler at all.
    const learnBtn = screen.getByRole('button', { name: 'Learn Sleep' });
    expect(learnBtn).toBeDisabled();
    fireEvent.click(learnBtn);
    await flush();
    expect(mockLearn).not.toHaveBeenCalled();

    resolvePrepare({ prepared: true, prepared_used: 2, prepared_max: 3 });
    await flush();
  });
});

describe('SpellbookPanel — refetch failure after a successful mutate (D2 pattern)', () => {
  it('getKnownSpells throwing on refetch after a resolved learnSpell gets its own warn toast, never the success toast, and releases the latch', async () => {
    mockGetKnown.mockResolvedValueOnce(KNOWN_WIZARD); // initial mount
    mockGetAvailable.mockResolvedValue(AVAILABLE_WIZARD);
    mockLearn.mockResolvedValue({ learned: true, budget: BUDGET });
    renderPanel();
    await flush();
    fireEvent.click(screen.getByRole('tab', { name: 'Browse' }));
    await flush();

    mockGetKnown.mockRejectedValue(new Error('network blip'));

    const learnBtn = screen.getByRole('button', { name: 'Learn Sleep' });
    fireEvent.click(learnBtn);
    await flush();

    expect(
      await screen.findByText("Couldn't refresh your spellbook — reload to see the result."),
    ).toBeInTheDocument();
    expect(screen.queryByText('Learned Sleep.')).not.toBeInTheDocument();
    await waitFor(() => expect(learnBtn).toBeEnabled());
  });

  // MIKO adversarial gate (2026-07-09): the mandate explicitly asked
  // "tested for both learn AND prepare?" — the diff's own 14 tests only
  // covered the D2 refetch-failure contract for learn. Symmetric proof for
  // prepare, through the Known tab (prepare's real UI surface).
  it('prepareSpell resolving but the silent refetch throwing gets its own warn toast, never success, and releases the latch', async () => {
    mockGetKnown.mockResolvedValueOnce(KNOWN_WIZARD); // initial mount
    mockPrepare.mockResolvedValue({ prepared: true, prepared_used: 2, prepared_max: 3 });
    renderPanel();
    await flush();

    mockGetKnown.mockRejectedValue(new Error('network blip'));

    const prepareBtn = screen.getByRole('button', { name: 'Prepare Shield' });
    fireEvent.click(prepareBtn);
    await flush();

    expect(
      await screen.findByText("Couldn't refresh your spellbook — reload to see the result."),
    ).toBeInTheDocument();
    expect(screen.queryByText('Prepared Shield.')).not.toBeInTheDocument();
    // Latch must release on this path exactly like learn's — proven with a
    // real follow-up click, not just an enabled-attribute check.
    await waitFor(() => expect(prepareBtn).toBeEnabled());
    mockGetKnown.mockResolvedValue(KNOWN_WIZARD);
    mockPrepare.mockClear();
    fireEvent.click(prepareBtn);
    await flush();
    expect(mockPrepare).toHaveBeenCalledTimes(1);
  });
});

describe('SpellbookPanel — MIKO adversarial additions (2026-07-09)', () => {
  it('a failed prepareSpell surfaces the engine\'s SPECIFIC refusal reason, releases the latch, and does NOT optimistically flip the pill/button (no refetch ever fires)', async () => {
    mockGetKnown.mockResolvedValue(KNOWN_WIZARD);
    mockPrepare.mockRejectedValueOnce(refusalError('over_prepared_limit'));
    renderPanel();
    await flush();

    const prepareBtn = screen.getByRole('button', { name: 'Prepare Shield' });
    fireEvent.click(prepareBtn);
    await flush();

    // KAGE fix: specific copy for a deterministic refusal, not the generic
    // "try again in a moment" transient-failure message.
    expect(
      await screen.findByText("You've prepared all you can."),
    ).toBeInTheDocument();
    // Still says "Prepare" (not "Unprepare"), no "prepared" pill appeared next
    // to Shield — proves there is no client-side optimistic mutation of the
    // known list on a rejected prepare, only ever a server-truth refetch.
    expect(screen.getByRole('button', { name: 'Prepare Shield' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Unprepare Shield' })).not.toBeInTheDocument();
    // Refetch is only called from inside the success branch — a rejected
    // mutate must never re-GET at all.
    expect(mockGetKnown).toHaveBeenCalledTimes(1); // initial mount only
    await waitFor(() => expect(prepareBtn).toBeEnabled());
  });

  it('rapid double-click on Prepare in the same batch calls prepareSpell exactly once (shared latch, symmetric with the diff\'s own Learn-only proof)', async () => {
    mockGetKnown.mockResolvedValue(KNOWN_WIZARD);
    mockPrepare.mockResolvedValue({ prepared: true, prepared_used: 2, prepared_max: 3 });
    renderPanel();
    await flush();

    const prepareBtn = screen.getByRole('button', { name: 'Prepare Shield' });
    await act(async () => {
      fireEvent.click(prepareBtn);
      fireEvent.click(prepareBtn);
    });
    await flush();

    expect(mockPrepare).toHaveBeenCalledTimes(1);
  });

  it('a successful Prepare, once refetched, actually flips the button to Unprepare and shows the prepared pill off the NEW server response — not just a toast', async () => {
    const AFTER_PREPARE: SpellListResult = {
      ...KNOWN_WIZARD,
      spells: KNOWN_WIZARD.spells.map((s) =>
        s.slug === 'shield' ? { ...s, prepared: true } : s,
      ),
    };
    mockGetKnown.mockResolvedValueOnce(KNOWN_WIZARD); // initial mount
    mockGetKnown.mockResolvedValueOnce(AFTER_PREPARE); // post-mutate refetch
    mockPrepare.mockResolvedValue({ prepared: true, prepared_used: 2, prepared_max: 3 });
    renderPanel();
    await flush();

    fireEvent.click(screen.getByRole('button', { name: 'Prepare Shield' }));
    await flush();

    expect(await screen.findByRole('button', { name: 'Unprepare Shield' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Prepare Shield' })).not.toBeInTheDocument();
  });

  it('renders the graceful empty-pool message when Browse has nothing left to learn at the caster\'s level', async () => {
    mockGetKnown.mockResolvedValue(KNOWN_WIZARD);
    mockGetAvailable.mockResolvedValue({
      cantrips: [],
      by_level: { '1': [] },
      can_learn: true,
      can_prepare: true,
      budget: BUDGET,
    } satisfies AvailableSpellsResult);
    renderPanel();
    await flush();
    fireEvent.click(screen.getByRole('tab', { name: 'Browse' }));
    await flush();

    expect(screen.getByText('Nothing left to learn at your level.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Learn/ })).not.toBeInTheDocument();
  });

  it('Browse tab: when the engine reports can_prepare:false (e.g. a "known"-kind caster like sorcerer), no Prepare/Unprepare buttons render there either — the panel trusts the server flag, not its own re-derivation', async () => {
    mockGetKnown.mockResolvedValue({ ...KNOWN_WIZARD, caster_kind: 'known' });
    mockGetAvailable.mockResolvedValue({
      ...AVAILABLE_WIZARD,
      can_prepare: false,
    } satisfies AvailableSpellsResult);
    renderPanel();
    await flush();
    fireEvent.click(screen.getByRole('tab', { name: 'Browse' }));
    await flush();

    // Shield is in_repertoire in the fixture, so it would show a Prepare/
    // Unprepare control if canPrepare were (incorrectly) derived client-side
    // from caster_kind rather than trusted from available.can_prepare.
    expect(screen.queryByRole('button', { name: /^Prepare/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Unprepare/ })).not.toBeInTheDocument();
    // Learn is unaffected — Sleep (not in_repertoire) still offers Learn.
    expect(screen.getByRole('button', { name: 'Learn Sleep' })).toBeInTheDocument();
  });

  it('FIXED: a failed initial Browse load shows the graceful error message, and re-opening the tab afterward DOES retry the fetch — on the retry succeeding, the pool renders', async () => {
    mockGetKnown.mockResolvedValue(KNOWN_WIZARD);
    mockGetAvailable.mockRejectedValueOnce(new Error('network down'));
    renderPanel();
    await flush();

    fireEvent.click(screen.getByRole('tab', { name: 'Browse' }));
    await flush();
    expect(screen.getByText(/Couldn.t load available spells\./)).toBeInTheDocument();
    expect(mockGetAvailable).toHaveBeenCalledTimes(1);

    // User backs out to Known, then returns to Browse hoping it retries.
    mockGetAvailable.mockResolvedValueOnce(AVAILABLE_WIZARD);
    fireEvent.click(screen.getByRole('tab', { name: 'Known' }));
    await flush();
    fireEvent.click(screen.getByRole('tab', { name: 'Browse' }));
    await flush();

    // Re-opening Browse after an error retries the fetch, and on the retry
    // succeeding the pool renders — no more stuck-on-error state.
    expect(mockGetAvailable).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(/Couldn.t load available spells\./)).not.toBeInTheDocument();
    expect(screen.getByText('Mage Hand')).toBeInTheDocument();
    expect(screen.getByText('Sleep')).toBeInTheDocument();
  });

  it('Browse error branch also renders an explicit Retry button that re-fetches on click', async () => {
    mockGetKnown.mockResolvedValue(KNOWN_WIZARD);
    mockGetAvailable.mockRejectedValueOnce(new Error('network down'));
    renderPanel();
    await flush();

    fireEvent.click(screen.getByRole('tab', { name: 'Browse' }));
    await flush();
    expect(screen.getByText(/Couldn.t load available spells\./)).toBeInTheDocument();

    mockGetAvailable.mockResolvedValueOnce(AVAILABLE_WIZARD);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await flush();

    expect(mockGetAvailable).toHaveBeenCalledTimes(2);
    expect(screen.getByText('Mage Hand')).toBeInTheDocument();
  });
});

describe('SpellbookPanel — REN fix 2: engine refusal reason mapping', () => {
  it('a learn refusal with reason "already_known" shows the specific copy, not the generic transient message', async () => {
    mockGetKnown.mockResolvedValue(KNOWN_WIZARD);
    mockGetAvailable.mockResolvedValue(AVAILABLE_WIZARD);
    mockLearn.mockRejectedValueOnce(refusalError('already_known'));
    renderPanel();
    await flush();
    fireEvent.click(screen.getByRole('tab', { name: 'Browse' }));
    await flush();

    fireEvent.click(screen.getByRole('button', { name: 'Learn Sleep' }));
    await flush();

    expect(await screen.findByText('Already in your spellbook.')).toBeInTheDocument();
  });

  it('a prepare refusal with reason "cannot_prepare_cantrip" shows the specific copy', async () => {
    mockGetKnown.mockResolvedValue(KNOWN_WIZARD);
    mockPrepare.mockRejectedValueOnce(refusalError('cannot_prepare_cantrip'));
    renderPanel();
    await flush();

    fireEvent.click(screen.getByRole('button', { name: 'Unprepare Magic Missile' }));
    await flush();

    expect(
      await screen.findByText('Cantrips are always ready — no need to prepare.'),
    ).toBeInTheDocument();
  });

  it('a genuine network/unknown failure (no reason on the body) still falls back to the generic "try again in a moment" copy for both learn and prepare', async () => {
    mockGetKnown.mockResolvedValue(KNOWN_WIZARD);
    mockGetAvailable.mockResolvedValue(AVAILABLE_WIZARD);
    mockLearn.mockRejectedValueOnce(new Error('network blip'));
    mockPrepare.mockRejectedValueOnce(new Error('network blip'));
    renderPanel();
    await flush();
    fireEvent.click(screen.getByRole('tab', { name: 'Browse' }));
    await flush();

    fireEvent.click(screen.getByRole('button', { name: 'Learn Sleep' }));
    await flush();
    expect(
      await screen.findByText('Could not learn Sleep. Try again in a moment.'),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Known' }));
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Prepare Shield' }));
    await flush();
    expect(
      await screen.findByText('Could not update Shield. Try again in a moment.'),
    ).toBeInTheDocument();
  });
});

describe('SpellbookPanel — Iro a11y follow-up (tablist keyboard nav + focus restore)', () => {
  it('ArrowRight on the tablist moves selection AND keyboard focus from Known to Browse (roving tabindex, mirrors Composer)', async () => {
    mockGetKnown.mockResolvedValue(KNOWN_WIZARD);
    mockGetAvailable.mockResolvedValue(AVAILABLE_WIZARD);
    renderPanel();
    await flush();

    const knownTab = screen.getByRole('tab', { name: 'Known' });
    knownTab.focus();
    expect(knownTab).toHaveAttribute('aria-selected', 'true');

    fireEvent.keyDown(knownTab, { key: 'ArrowRight' });
    await flush();

    const browseTab = screen.getByRole('tab', { name: 'Browse' });
    expect(browseTab).toHaveAttribute('aria-selected', 'true');
    expect(browseTab).toHaveFocus();
    expect(knownTab).toHaveAttribute('tabIndex', '-1');
  });

  it('ArrowLeft from Browse wraps back around to Known (Home/End style cycling)', async () => {
    mockGetKnown.mockResolvedValue(KNOWN_WIZARD);
    mockGetAvailable.mockResolvedValue(AVAILABLE_WIZARD);
    renderPanel();
    await flush();
    fireEvent.click(screen.getByRole('tab', { name: 'Browse' }));
    await flush();

    const browseTab = screen.getByRole('tab', { name: 'Browse' });
    browseTab.focus();
    fireEvent.keyDown(browseTab, { key: 'ArrowLeft' });
    await flush();

    const knownTab = screen.getByRole('tab', { name: 'Known' });
    expect(knownTab).toHaveAttribute('aria-selected', 'true');
    expect(knownTab).toHaveFocus();
  });

  it('tab buttons and panels are ARIA-linked via id/aria-controls/aria-labelledby (no more plain panel aria-label)', async () => {
    mockGetKnown.mockResolvedValue(KNOWN_WIZARD);
    renderPanel();
    await flush();

    const knownTab = screen.getByRole('tab', { name: 'Known' });
    const knownPanel = screen.getByRole('tabpanel');
    expect(knownTab).toHaveAttribute('id', 'spellbook-tab-known');
    expect(knownTab).toHaveAttribute('aria-controls', 'spellbook-panel-known');
    expect(knownPanel).toHaveAttribute('id', 'spellbook-panel-known');
    expect(knownPanel).toHaveAttribute('aria-labelledby', 'spellbook-tab-known');
    expect(knownPanel).not.toHaveAttribute('aria-label');
  });

  it('focus is restored to the spell row (not stranded at body) after a successful Learn on Browse', async () => {
    mockGetKnown.mockResolvedValue(KNOWN_WIZARD);
    mockGetAvailable.mockResolvedValue(AVAILABLE_WIZARD);
    mockLearn.mockResolvedValue({ learned: true, budget: BUDGET });
    renderPanel();
    await flush();
    fireEvent.click(screen.getByRole('tab', { name: 'Browse' }));
    await flush();

    fireEvent.click(screen.getByRole('button', { name: 'Learn Sleep' }));
    await flush();

    // The Learn button unmounts once Sleep becomes in_repertoire (refetch
    // swaps it for a Prepare button) — the stable target is the <li> row.
    const sleepRow = screen.getByText('Sleep').closest('li');
    expect(sleepRow).toHaveFocus();
  });

  it('focus is restored to the spell row after a successful Prepare on the Known tab', async () => {
    mockGetKnown.mockResolvedValue(KNOWN_WIZARD);
    mockPrepare.mockResolvedValue({ prepared: true, prepared_used: 2, prepared_max: 3 });
    renderPanel();
    await flush();

    fireEvent.click(screen.getByRole('button', { name: 'Prepare Shield' }));
    await flush();

    const shieldRow = screen.getByText('Shield').closest('li');
    expect(shieldRow).toHaveFocus();
  });
});

describe('SpellbookPanel — TAV-SPELLBOOK-STALE-AFTER-PICKER: refreshKey (Miko-QA adversarial)', () => {
  it('refreshKey is optional — omitting it (existing call sites, e.g. any test above) still mounts and fetches known spells exactly once', async () => {
    mockGetKnown.mockResolvedValue(KNOWN_WIZARD);
    renderPanel(); // no refreshKey passed at all
    await flush();
    expect(mockGetKnown).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Fire Bolt')).toBeInTheDocument();
  });

  it('bumping refreshKey while Known is the active tab re-runs loadKnown and the fresh server data replaces the old list', async () => {
    mockGetKnown.mockResolvedValueOnce(KNOWN_WIZARD);
    const { rerender } = renderPanel({ refreshKey: 0 });
    await flush();
    expect(mockGetKnown).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Shield')).toBeInTheDocument();

    // Simulate a level-choice resolve granting a NEW cantrip — the parent
    // page bumps the nonce, same as character/[id]/page.tsx's onResolved.
    const AFTER: SpellListResult = {
      ...KNOWN_WIZARD,
      cantrips: [
        ...KNOWN_WIZARD.cantrips,
        {
          slug: 'ray-of-frost',
          name: 'Ray of Frost',
          level: 0,
          school: 'evocation',
          source: 'class',
          prepared: true,
          is_cantrip: true,
          concentration: false,
          ritual: false,
          castable_now: true,
        },
      ],
    };
    mockGetKnown.mockResolvedValueOnce(AFTER);
    rerender(
      <ToastProvider>
        <SpellbookPanel
          characterId="cid-2"
          username="leon"
          isOwner
          isCaster
          refreshKey={1}
        />
      </ToastProvider>,
    );
    await flush();

    expect(mockGetKnown).toHaveBeenCalledTimes(2);
    expect(screen.getByText('Ray of Frost')).toBeInTheDocument();
  });

  it('a same-value refreshKey re-render (e.g. parent re-rendering for an unrelated reason) does NOT re-fetch — only an actual bump does', async () => {
    mockGetKnown.mockResolvedValue(KNOWN_WIZARD);
    const { rerender } = renderPanel({ refreshKey: 5 });
    await flush();
    expect(mockGetKnown).toHaveBeenCalledTimes(1);

    rerender(
      <ToastProvider>
        <SpellbookPanel characterId="cid-2" username="leon" isOwner isCaster refreshKey={5} />
      </ToastProvider>,
    );
    await flush();
    expect(mockGetKnown).toHaveBeenCalledTimes(1);
  });

  it('REN fix (Kage defect A): bumping refreshKey while the Browse tab is already open + loaded refreshes the pool IN PLACE instead of dropping to a blank panel', async () => {
    mockGetKnown.mockResolvedValue(KNOWN_WIZARD);
    mockGetAvailable.mockResolvedValue(AVAILABLE_WIZARD);
    const { rerender } = renderPanel({ refreshKey: 0 });
    await flush();
    fireEvent.click(screen.getByRole('tab', { name: 'Browse' }));
    await flush();
    expect(screen.getByText('Sleep')).toBeInTheDocument();
    expect(mockGetAvailable).toHaveBeenCalledTimes(1);

    // Parent bumps the nonce (a level-choice resolve) while Browse stays the
    // active tab — nothing in openTab fires again, since the user isn't the
    // one switching tabs this time. The newly-learned spell (Mage Hand) is
    // now in the character's repertoire — its Browse row stays (still an
    // eligible pool entry) but flips from a "Learn" button to a "known" pill,
    // which only happens on a genuine re-fetch of fresh server data.
    const AVAILABLE_AFTER_LEARN: AvailableSpellsResult = {
      ...AVAILABLE_WIZARD,
      cantrips: AVAILABLE_WIZARD.cantrips.map((s) =>
        s.slug === 'mage-hand' ? { ...s, in_repertoire: true } : s,
      ),
    };
    mockGetKnown.mockResolvedValueOnce(KNOWN_WIZARD);
    mockGetAvailable.mockResolvedValueOnce(AVAILABLE_AFTER_LEARN);
    rerender(
      <ToastProvider>
        <SpellbookPanel characterId="cid-2" username="leon" isOwner isCaster refreshKey={1} />
      </ToastProvider>,
    );
    await flush();

    // The pool refreshes in place — no blank panel, no stranded 'idle' state.
    // Sleep (still !in_repertoire) still shows its Learn button; Mage Hand
    // (now learned) no longer does — proving this actually re-fetched rather
    // than merely re-rendering the old data.
    expect(screen.getByRole('button', { name: 'Learn Sleep' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Learn Mage Hand' })).not.toBeInTheDocument();
    expect(screen.queryByText(/loading available spells/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/couldn.t load available spells/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    // The original tab-open fetch, plus the refreshKey-driven refresh.
    expect(mockGetAvailable).toHaveBeenCalledTimes(2);
  });

  it('REN fix (Kage defect B): a rapid double-bump of refreshKey is ordering-safe — an earlier fetch resolving AFTER a later one no longer overwrites the fresher data with stale data', async () => {
    let resolveFirst: ((v: SpellListResult) => void) | undefined;
    let resolveSecond: ((v: SpellListResult) => void) | undefined;
    mockGetKnown.mockResolvedValueOnce(KNOWN_WIZARD); // initial mount, settles immediately
    const { rerender } = renderPanel({ refreshKey: 0 });
    await flush();

    const STALE: SpellListResult = { ...EMPTY_KNOWN, cantrips: [], spells: [] };
    const FRESH: SpellListResult = KNOWN_WIZARD;

    mockGetKnown.mockImplementationOnce(
      () => new Promise<SpellListResult>((resolve) => { resolveFirst = resolve; }),
    );
    rerender(
      <ToastProvider>
        <SpellbookPanel characterId="cid-2" username="leon" isOwner isCaster refreshKey={1} />
      </ToastProvider>,
    );

    mockGetKnown.mockImplementationOnce(
      () => new Promise<SpellListResult>((resolve) => { resolveSecond = resolve; }),
    );
    rerender(
      <ToastProvider>
        <SpellbookPanel characterId="cid-2" username="leon" isOwner isCaster refreshKey={2} />
      </ToastProvider>,
    );

    // The SECOND (latest, refreshKey=2) request resolves first with the
    // fresh state; the FIRST (stale, refreshKey=1) request resolves after
    // it — but its effect's cleanup already aborted that request's
    // AbortController (refreshKey=1 -> 2 unmounts/reruns the effect), so
    // loadKnown's post-await `if (opts?.signal?.aborted) return;` guard
    // no-ops it instead of letting it win the last-write.
    await act(async () => {
      resolveSecond?.(FRESH);
      await Promise.resolve();
    });
    expect(screen.getByText('Fire Bolt')).toBeInTheDocument();

    await act(async () => {
      resolveFirst?.(STALE);
      await Promise.resolve();
    });
    // Fixed: still shows the freshest data — the superseded (aborted) first
    // request's late resolution no longer clobbers the screen.
    expect(screen.getByText('Fire Bolt')).toBeInTheDocument();
  });
});

describe('SpellbookPanel — REN fix 3: Browse Prepare requires in_repertoire', () => {
  it('an un-learned wizard spell (in_repertoire:false) shows Learn but never a Prepare/Unprepare button on Browse', async () => {
    mockGetKnown.mockResolvedValue(KNOWN_WIZARD);
    mockGetAvailable.mockResolvedValue(AVAILABLE_WIZARD); // sleep: in_repertoire:false, can_prepare:true
    renderPanel();
    await flush();
    fireEvent.click(screen.getByRole('tab', { name: 'Browse' }));
    await flush();

    expect(screen.getByRole('button', { name: 'Learn Sleep' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Prepare Sleep/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Unprepare Sleep/ })).not.toBeInTheDocument();
  });

  it('a learned wizard spell (in_repertoire:true) DOES show the Prepare button on Browse once canPrepare is true', async () => {
    mockGetKnown.mockResolvedValue(KNOWN_WIZARD);
    mockGetAvailable.mockResolvedValue(AVAILABLE_WIZARD); // shield: in_repertoire:true, can_prepare:true
    renderPanel();
    await flush();
    fireEvent.click(screen.getByRole('tab', { name: 'Browse' }));
    await flush();

    expect(screen.getByRole('button', { name: 'Prepare Shield' })).toBeInTheDocument();
  });
});
