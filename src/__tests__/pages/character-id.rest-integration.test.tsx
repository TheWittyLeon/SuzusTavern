/**
 * TAV-REST-UI — page-level wiring for RestControl (src/app/character/[id]/page.tsx).
 *
 * RestControl.test.tsx (component isolation) already proves RestControl's own
 * contract: confirm-gates the long rest, calls `onRested` only on a successful
 * rest, and tells the difference between a refused rest and a failed reconcile.
 * None of that exercises the PAGE's half of the contract, which is where the
 * actual defect surface for this diff lives:
 *
 *   1. `handleRested` bumps `restEpoch` AND refetches the sheet — does the
 *      real page do both, and does the refetched sheet actually reach the
 *      DOM (not just get requested)?
 *   2. `refreshToken={`${sheet.level}:${restEpoch}`}` is a COMPOSITE string
 *      specifically because `level + restEpoch` collides (level 5 after one
 *      rest === level 6 after none). Nothing pins that this is still true —
 *      every existing ResourcePanel/page test only ever changes ONE of the
 *      two inputs at a time, which a sum formula also gets right.
 *   3. `handleRested` deliberately does NOT go through `load`, because `load`
 *      answers a failure with `setState('error')`, which would replace the
 *      whole sheet with an error card after a rest that SUCCEEDED. Nothing
 *      exercises the real `handleRested` failing.
 *
 * Mount pattern and fixture shape follow character-id.test.tsx.
 */
import React from 'react';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: jest.fn(), push: jest.fn() }),
  useParams: () => ({ id: 'char-int-1' }),
}));

jest.mock('../../lib/api/auth', () => ({
  login: jest.fn(),
  verify2FA: jest.fn(),
  logout: jest.fn(),
  refresh: jest.fn(),
  me: jest.fn(),
  register: jest.fn(),
}));

jest.mock('../../lib/api/dnd', () => ({
  getCharacterSheet: jest.fn(),
  levelUpCharacter: jest.fn(),
  equipItem: jest.fn(),
  unequipItem: jest.fn(),
  giveItem: jest.fn(),
  listResources: jest.fn(),
  characterRest: jest.fn(),
  adjustHp: jest.fn(),
  getCatalog: jest.fn(),
}));

import * as dnd from '../../lib/api/dnd';
import { AuthProvider } from '../../lib/auth/AuthProvider';
import { ThemeProvider } from '../../lib/theme/ThemeProvider';
import { ToastProvider } from '../../components/Toast';
import CharacterPage from '../../app/character/[id]/page';
import type { CharacterSheet, ClassResource, User } from '../../lib/api/types';

const mockGet = dnd.getCharacterSheet as jest.MockedFunction<typeof dnd.getCharacterSheet>;
const mockAdjustHp = dnd.adjustHp as jest.Mock;
const mockListResources = dnd.listResources as jest.MockedFunction<typeof dnd.listResources>;
const mockRest = dnd.characterRest as jest.MockedFunction<typeof dnd.characterRest>;
const mockGetCatalog = dnd.getCatalog as jest.MockedFunction<typeof dnd.getCatalog>;

const ALICE: User = { id: 1, username: 'alice', email: null };

function ability(score: number, modifier: number) {
  return { score, modifier };
}

function sheet(overrides: Partial<CharacterSheet>): CharacterSheet {
  return {
    character_id: 'char-int-1',
    owner_username: 'alice',
    name: 'Test Hero',
    race: 'Human',
    subrace: '',
    char_class: 'Monk',
    subclass: '',
    level: 6,
    background: 'Hermit',
    alignment: '',
    ability_scores: {
      strength: ability(10, 0),
      dexterity: ability(16, 3),
      constitution: ability(13, 1),
      intelligence: ability(10, 0),
      wisdom: ability(14, 2),
      charisma: ability(8, -1),
    },
    hp: { current: 4, max: 9, temp: 0 },
    ac: 15,
    initiative: 3,
    proficiency_bonus: 3,
    speed: 30,
    xp: 0,
    xp_next: 14000,
    hit_dice_remaining: 1,
    proficient_saves: ['strength', 'dexterity'],
    proficient_skills: ['acrobatics'],
    class_features: ['Martial Arts'],
    conditions: [],
    spellcasting: null,
    spell_slots: {},
    is_spellcaster: false,
    inventory: [],
    inventory_weight: 0,
    ...overrides,
  };
}

const KI: ClassResource = {
  key: 'ki',
  label: 'Ki',
  kind: 'pool',
  current: 2,
  maximum: 4,
  refresh: 'short',
};

function renderPage() {
  return render(
    <ThemeProvider>
      <AuthProvider initialUser={ALICE}>
        <ToastProvider>
          <CharacterPage />
        </ToastProvider>
      </AuthProvider>
    </ThemeProvider>,
  );
}

async function clickShortRest() {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Short rest' }));
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockListResources.mockResolvedValue({ resources: [KI], undoable: null });
  mockRest.mockResolvedValue({ message: 'You feel rested.' });
  mockGetCatalog.mockResolvedValue({
    system: 'dnd5e',
    content_type: 'class',
    items: [],
    total: 0,
    limit: 100,
    offset: 0,
  });
});

describe('TAV-REST-UI — page wiring: handleRested drives both refetches', () => {
  it('a successful rest refetches the sheet (visible in the DOM) AND re-triggers ResourcePanel', async () => {
    mockGet
      .mockResolvedValueOnce(sheet({ hp: { current: 4, max: 9, temp: 0 } }))
      .mockResolvedValueOnce(sheet({ hp: { current: 9, max: 9, temp: 0 } }));

    renderPage();
    await screen.findByRole('heading', { level: 1, name: 'Test Hero' });

    // Pre-rest state, and the baseline call counts this test's deltas are
    // measured against.
    expect(screen.getByRole('meter', { name: /hit points 4 of 9/i })).toBeInTheDocument();
    expect(mockGet).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(mockListResources).toHaveBeenCalledTimes(1));

    await clickShortRest();

    expect(mockRest).toHaveBeenCalledWith('char-int-1', 'alice', 'short');
    // (1) handleRested's own getCharacterSheet call landed...
    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(2));
    // The explicit third `undefined` is the SIGNAL SLOT, and it is deliberate,
    // not sloppiness (Kage-CR I5): the reconcile now routes through the page's
    // shared `load`, which takes `(signal?, opts?)`, and `handleRested` passes
    // no signal because it is fired from a click rather than an effect with a
    // lifecycle to hang a controller on. Ordering — the bug this refactor
    // actually fixes — is covered by `load`'s generation guard, not by abort.
    // Asserted exactly rather than loosened, so a future change that starts
    // passing a real signal has to come back and say so here.
    expect(mockGet).toHaveBeenNthCalledWith(2, 'char-int-1', 'alice', undefined);
    // (2) ...and its result actually reached the DOM via setSheet — proving
    // handleRested doesn't just fetch and discard.
    await waitFor(() =>
      expect(screen.getByRole('meter', { name: /hit points 9 of 9/i })).toBeInTheDocument(),
    );
    // (3) restEpoch bumped, and ResourcePanel's own effect re-fired because
    // its refreshToken prop changed.
    await waitFor(() => expect(mockListResources).toHaveBeenCalledTimes(2));
  });
});

describe('TAV-REST-UI — refreshToken must be a composite, not level + restEpoch', () => {
  it('a rest that lands alongside a level change ResourcePanel must still refetch even though the OLD sum formula would have collided', async () => {
    // The exact numbers from page.tsx's own comment: level 6 with zero rests
    // and level 5 with one rest both sum to 6. A level can legitimately move
    // between an initial load and a rest's reconcile (a DM correction, a
    // rebuild elsewhere in the app) without the rest itself changing it, so
    // this is not contrived — it is the scenario the composite string exists
    // to survive.
    mockGet
      .mockResolvedValueOnce(sheet({ level: 6 })) // token would be "6:0"
      .mockResolvedValueOnce(sheet({ level: 5 })); // token would be "5:1"

    renderPage();
    await screen.findByRole('heading', { level: 1, name: 'Test Hero' });
    await waitFor(() => expect(mockListResources).toHaveBeenCalledTimes(1));

    await clickShortRest();
    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(2));

    // Under `level + restEpoch`, old sum (6+0=6) === new sum (5+1=6): the
    // dependency array would see no change and ResourcePanel's effect would
    // NOT re-fire, silently leaving stale resources on screen right after a
    // rest. This assertion fails under that regression and only passes under
    // the composite-string implementation.
    await waitFor(() => expect(mockListResources).toHaveBeenCalledTimes(2));
  });
});

describe('TAV-REST-UI — a failed reconcile must not be reported as a failed rest, page-level', () => {
  it('handleRested rejecting does NOT route through load/setState("error") and blank the sheet', async () => {
    mockGet
      .mockResolvedValueOnce(sheet({}))
      .mockRejectedValueOnce(new Error('reconcile network blip'));

    renderPage();
    await screen.findByRole('heading', { level: 1, name: 'Test Hero' });

    await clickShortRest();

    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(2));
    // The rest itself succeeded; only the reconcile GET failed. If
    // `handleRested` were ever refactored to go through `load` (or to catch
    // and call the same error setter), the whole sheet would be replaced by
    // this error card — which is exactly the bug the header comment says
    // this design avoids.
    expect(screen.queryByText(/can.?t find that one/i)).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Test Hero' })).toBeInTheDocument();
    // And RestControl's own rested-flag logic sees the rejection propagate
    // out of the REAL handleRested (not a stand-in), so it reports the
    // rest-happened-but-stale warning, not the rest-failed error.
    expect(
      await screen.findByText(
        'Rested — but these numbers may be out of date. Reload to see them.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText('Could not rest. Try again in a moment.'),
    ).not.toBeInTheDocument();
  });
});

describe('TAV-REST-UI — the cross-writer race the generation guard must actually cover', () => {
  it('a slow rest reconcile cannot clobber a newer write from ANOTHER panel', async () => {
    // Kage-CR I5, round 2. The first fix added a `loadGenRef` counter inside
    // `load` — which orders `load()` against `load()` and nothing else. The
    // panels that cause this race do NOT go through `load`: HpControl,
    // CurrencyPurse, InventoryPanel and SpellSlotsPanel each run their own
    // getCharacterSheet and hand the result back via `onChanged`. So the
    // counter was inert against the exact scenario its comment described, and
    // Kage reproduced the clobber against the real page AFTER that fix.
    //
    // The sequence, which is ordinary play, not a contrived interleave:
    //   1. sheet at 4/9
    //   2. short rest fires; its reconcile GET HANGS
    //   3. player heals to 9/9 through HpControl -> its own GET -> applySheet
    //   4. the rest's stale GET finally answers, still carrying 4/9
    // Without `applySheet` bumping the generation, step 4 wins and the
    // player's healing silently reverts.
    let releaseStaleReconcile: (v: CharacterSheet) => void = () => {};
    mockGet
      // (1) initial mount
      .mockResolvedValueOnce(sheet({ hp: { current: 4, max: 9, temp: 0 } }))
      // (2) the rest's reconcile — held open
      .mockImplementationOnce(
        () =>
          new Promise<CharacterSheet>((res) => {
            releaseStaleReconcile = res;
          }),
      )
      // (3) HpControl's own refetch after healing — resolves immediately
      .mockResolvedValueOnce(sheet({ hp: { current: 9, max: 9, temp: 0 } }));
    mockAdjustHp.mockResolvedValue({ current: 9, max: 9, temp: 0 });

    renderPage();
    await screen.findByRole('meter', { name: /hit points 4 of 9/i });

    await clickShortRest();

    // Heal while the rest's reconcile is still in flight.
    await act(async () => {
      fireEvent.change(screen.getByLabelText('HP amount'), { target: { value: '5' } });
      fireEvent.click(screen.getByLabelText('Apply healing'));
    });
    await waitFor(() =>
      expect(screen.getByRole('meter', { name: /hit points 9 of 9/i })).toBeInTheDocument(),
    );

    // Now let the STALE rest reconcile land, carrying the pre-heal snapshot.
    await act(async () => {
      releaseStaleReconcile(sheet({ hp: { current: 4, max: 9, temp: 0 } }));
    });

    // It must be DISCARDED, not applied. Revert `applySheet` to a bare
    // `setSheet` at the panel call sites and this goes red with 4 of 9.
    expect(
      screen.getByRole('meter', { name: /hit points 9 of 9/i }),
    ).toBeInTheDocument();
  });
});
