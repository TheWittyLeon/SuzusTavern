/**
 * Regression coverage for DDX-21 Codex fix passes 2 and 3 (Aoi-UI's
 * live-browser passes, 2026-07-05) — the bugs from those passes that are
 * meaningfully testable at the component/RTL level:
 *
 *   - DDX21-1 (CRITICAL, fix pass 2): selecting a monster with a multi-part
 *     `speed` object (e.g. an Aboleth's `{walk, swim}`) and then switching
 *     Codex kind-tabs crashed the whole /codex route — React threw "Objects
 *     are not valid as a React child" because a stale cross-kind render fed
 *     the monster's compound speed OBJECT into CodexRow's 'race' branch,
 *     which rendered `{d.speed}` as a raw JSX child assuming a plain number.
 *     Fixed at the time by `raceSpeedLabel` (codex.ts), a per-field guard.
 *
 *   - DDX21-1 (CRITICAL, fix pass 3 — the architectural fix): Aoi's
 *     live-browser re-verify found the SAME underlying race produces a SECOND
 *     full-route crash with a DIFFERENT field: Monsters -> Backgrounds throws
 *     `TypeError: (d.skills ?? []).slice is not a function`, because a stale
 *     monster row's runtime-only `skills` bonus-map OBJECT (present on the
 *     wire, absent from CatalogMonsterData's TS type) reaches the
 *     'background' branch's array-only `.slice()` call. Per-field guards
 *     "keep losing" (~13 similarly unguarded accessors exist) — the real fix
 *     is architectural: useCodexCatalog now tags its `items` with the
 *     `itemsKind` they actually belong to, and page.tsx gates ALL rendering
 *     (list rows + detail) on `itemsKind === activeKind`, so a stale render
 *     shows a momentary loading/empty state instead of ever handing one
 *     kind's data to another kind's renderer. This kills the whole crash
 *     class, not just the two fields discovered so far.
 *
 * This suite renders CodexPage inside a real ErrorBoundary (mirroring
 * src/app/layout.tsx's actual nesting) and proves, for multiple kind-tab
 * pairings (Monster -> Race, Monster -> Background, and a sweep of
 * Monster -> every other kind — monster rows carry the most extra runtime
 * fields, so they're the highest-risk source): (a) the selection/detail
 * resets when the kind tab changes, and (b) the crash itself cannot happen.
 *
 * The Monster -> Background test in particular is written to fail against
 * pre-fix-pass-3 code (confirmed by running it against the tree before the
 * `itemsKind` gate landed: it throws inside the ErrorBoundary exactly as
 * Aoi described) and pass once the gate is in place.
 *
 *   - DDX21-3 (MINOR): the Classes tab rendered "12 classs" (naive
 *     `${noun}s`). This suite proves the visible list-head count reads
 *     "classes", not "classs", once nounPlural is wired through.
 *
 * (DDX21-2's sticky-rail background is a pure-CSS fix, not observable from
 * jsdom — see codex-css.test.ts for that regression guard. The ≤860px
 * horizontal rail reflow that DDX21-2 also touched was reverted in fix pass
 * 3 — see codex-css.test.ts and codex-a11y-fixes.test.tsx for that.)
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
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
  getCatalog: jest.fn(),
  getCatalogCounts: jest.fn(),
}));

import * as dnd from '../../lib/api/dnd';
import { AuthProvider } from '../../lib/auth/AuthProvider';
import { ThemeProvider } from '../../lib/theme/ThemeProvider';
import { ToastProvider } from '../../components/Toast';
import ErrorBoundary from '../../components/ErrorBoundary';
import CodexPage from '../../app/codex/page';
import type { CatalogItem, CatalogMonsterData, User } from '../../lib/api/types';

const mockGetCatalog = dnd.getCatalog as jest.MockedFunction<typeof dnd.getCatalog>;
const mockGetCatalogCounts = dnd.getCatalogCounts as jest.MockedFunction<typeof dnd.getCatalogCounts>;

const LEON: User = { id: 1, username: 'leon', email: null };

function respond(type: string, items: CatalogItem[]) {
  return { system: 'dnd5e', content_type: type, items, total: items.length, limit: 500, offset: 0 };
}

/** Renders CodexPage wrapped in a real ErrorBoundary — mirrors
 * src/app/layout.tsx's actual production nesting (ErrorBoundary wraps
 * ToastProvider/children there). The other codex test files don't include
 * one, so they'd never observe an ErrorBoundary fallback even if the page
 * crashed; this suite needs to. */
function renderCodexWithBoundary() {
  return render(
    <ToastProvider>
      <ThemeProvider>
        <AuthProvider initialUser={LEON} initialMaybeAuthed={false}>
          <ErrorBoundary>
            <CodexPage />
          </ErrorBoundary>
        </AuthProvider>
      </ThemeProvider>
    </ToastProvider>,
  );
}

function errorBoundaryTripped(): boolean {
  return document.querySelector('[data-component="ErrorBoundary"]') !== null;
}

// A monster with a genuine multi-part speed object — Aboleth's real SRD
// speed block (walk 10 ft., swim 40 ft.), matching Aoi's exact repro and the
// exact error signature she captured ("object with keys {swim, walk}").
const ABOLETH: CatalogItem = {
  slug: 'aboleth',
  name: 'Aboleth',
  content_type: 'monster',
  source_type: 'srd',
  data: {
    size: 'Large',
    monster_type: 'aberration',
    ac: 17,
    hp_formula: '18d10+90',
    speed: { walk: 10, swim: 40 },
    cr: 10,
  },
};

// A monster whose runtime payload includes a `skills` bonus-map OBJECT (e.g.
// "Perception +11") — a field the engine actually returns but that
// CatalogMonsterData's TS type does not declare (Aoi's live-browser
// re-verify, fix pass 3: confirmed present at runtime, absent from the
// type). Built as a plain object and cast through `unknown` at the reference
// site below, rather than `as CatalogMonsterData` on the literal itself —
// that would just relocate the exact "TS type doesn't match runtime reality"
// gap this bug depends on to compile time instead of reproducing it.
const SNEAKY_GOBLIN_DATA = {
  size: 'Small',
  monster_type: 'humanoid',
  ac: 15,
  hp_formula: '2d8',
  cr: 0.25,
  skills: { Perception: 11, Stealth: 5 },
};
const SNEAKY_GOBLIN: CatalogItem = {
  slug: 'sneaky-goblin',
  name: 'Sneaky Goblin',
  content_type: 'monster',
  source_type: 'srd',
  data: SNEAKY_GOBLIN_DATA as unknown as CatalogMonsterData,
};

describe('DDX21-1: compound-speed monster + kind-tab switch no longer crashes /codex', () => {
  beforeEach(() => {
    mockGetCatalogCounts.mockReset().mockResolvedValue({
      system: 'dnd5e',
      packs: null,
      content_type: null,
      counts: { spell: 0, monster: 1, item: 0, race: 0, class: 0, background: 0, condition: 0 },
    } as unknown as Awaited<ReturnType<typeof dnd.getCatalogCounts>>);
    mockGetCatalog.mockReset().mockImplementation((_system, opts) => {
      if (opts?.type === 'monster') return Promise.resolve(respond('monster', [ABOLETH])) as never;
      return Promise.resolve(respond(opts?.type ?? '', [])) as never;
    });
  });

  it('selecting the Aboleth then switching to Races never throws / trips the ErrorBoundary, and the selection resets', async () => {
    renderCodexWithBoundary();

    // 1. Load the Monster tab (this is what caches the compound-speed item in
    //    useCodexCatalog's per-kind cache) and select the Aboleth.
    fireEvent.click(await screen.findByRole('tab', { name: /monsters/i }));
    const row = await screen.findByRole('option', { name: /aboleth/i });
    fireEvent.click(row);
    expect(await screen.findByRole('heading', { level: 2, name: /aboleth/i })).toBeInTheDocument();

    // 2. Switch kind tabs — this is the exact repro. Pre-fix, this throws
    //    while rendering the (stale) Aboleth row/detail under the 'race'
    //    kind's code path, which the ErrorBoundary in this tree would catch
    //    and replace the whole route with "Something went wrong".
    fireEvent.click(screen.getByRole('tab', { name: /races/i }));

    // No crash: the ErrorBoundary fallback never appears, and the Races tab
    // is genuinely active (the app is still alive and interactive).
    expect(errorBoundaryTripped()).toBe(false);
    expect(screen.queryByText(/something went wrong/i)).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /races/i })).toHaveAttribute('aria-selected', 'true');

    // Selection reset: the drawer no longer shows the Aboleth as selected —
    // it settles on the empty "Pick a race." state (no race items mocked).
    await waitFor(() => {
      expect(screen.queryByRole('heading', { level: 2, name: /aboleth/i })).not.toBeInTheDocument();
    });
    expect(await screen.findByText(/pick a race/i)).toBeInTheDocument();

    // The route is still fully functional after the switch — prove it by
    // navigating to a THIRD tab too.
    fireEvent.click(screen.getByRole('tab', { name: /items/i }));
    expect(screen.getByRole('tab', { name: /items/i })).toHaveAttribute('aria-selected', 'true');
    expect(errorBoundaryTripped()).toBe(false);
  });

  it('the same switch away from Monsters never throws even without an explicit row selection', async () => {
    // Per the root-cause analysis: useCodexCatalog's `items` (used to render
    // EVERY row in the list, not just the selected one) lags one render
    // behind `activeKind`, so merely having visited the Monster tab (which
    // loads/caches the Aboleth) is enough to reproduce this — selecting a row
    // isn't actually required to trip it. Covers that broader shape too.
    renderCodexWithBoundary();
    fireEvent.click(await screen.findByRole('tab', { name: /monsters/i }));
    await screen.findByRole('option', { name: /aboleth/i });

    fireEvent.click(screen.getByRole('tab', { name: /races/i }));

    expect(errorBoundaryTripped()).toBe(false);
    expect(screen.getByRole('tab', { name: /races/i })).toHaveAttribute('aria-selected', 'true');
  });
});

describe('DDX21-1 fix pass 3: the architectural itemsKind gate — monster -> background (new repro) and a full-sweep regression net', () => {
  beforeEach(() => {
    mockGetCatalogCounts.mockReset().mockResolvedValue({
      system: 'dnd5e',
      packs: null,
      content_type: null,
      counts: { spell: 0, monster: 1, item: 0, race: 0, class: 0, background: 0, condition: 0 },
    } as unknown as Awaited<ReturnType<typeof dnd.getCatalogCounts>>);
    mockGetCatalog.mockReset().mockImplementation((_system, opts) => {
      if (opts?.type === 'monster') return Promise.resolve(respond('monster', [SNEAKY_GOBLIN])) as never;
      return Promise.resolve(respond(opts?.type ?? '', [])) as never;
    });
  });

  // This is the test that must be run against pre-fix-pass-3 code to confirm
  // it genuinely fails there (it does — throws inside the ErrorBoundary,
  // "TypeError: (d.skills ?? []).slice is not a function", exactly as Aoi
  // reproduced live) before trusting that it passes because of the fix.
  it('switching from Monsters to Backgrounds never throws / trips the ErrorBoundary (the new repro)', async () => {
    renderCodexWithBoundary();

    fireEvent.click(await screen.findByRole('tab', { name: /monsters/i }));
    await screen.findByRole('option', { name: /sneaky goblin/i });

    fireEvent.click(screen.getByRole('tab', { name: /backgrounds/i }));

    expect(errorBoundaryTripped()).toBe(false);
    expect(screen.queryByText(/something went wrong/i)).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /backgrounds/i })).toHaveAttribute('aria-selected', 'true');
  });

  it('selecting the goblin then switching to Backgrounds never throws, and the selection resets', async () => {
    renderCodexWithBoundary();

    fireEvent.click(await screen.findByRole('tab', { name: /monsters/i }));
    const row = await screen.findByRole('option', { name: /sneaky goblin/i });
    fireEvent.click(row);
    expect(await screen.findByRole('heading', { level: 2, name: /sneaky goblin/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: /backgrounds/i }));

    expect(errorBoundaryTripped()).toBe(false);
    expect(screen.queryByText(/something went wrong/i)).not.toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByRole('heading', { level: 2, name: /sneaky goblin/i })).not.toBeInTheDocument();
    });
    expect(await screen.findByText(/pick a background/i)).toBeInTheDocument();
  });

  it('sweeps Monster -> every other kind in turn without ever tripping the ErrorBoundary (monster rows carry the most extra runtime fields, so they are the highest-risk source)', async () => {
    renderCodexWithBoundary();
    fireEvent.click(await screen.findByRole('tab', { name: /monsters/i }));
    await screen.findByRole('option', { name: /sneaky goblin/i });

    const otherKindNames = [/spells/i, /items/i, /races/i, /classes/i, /backgrounds/i, /conditions/i];

    for (const name of otherKindNames) {
      fireEvent.click(screen.getByRole('tab', { name }));

      expect(errorBoundaryTripped()).toBe(false);
      expect(screen.queryByText(/something went wrong/i)).not.toBeInTheDocument();
      expect(screen.getByRole('tab', { name })).toHaveAttribute('aria-selected', 'true');

      // Hop back to Monsters before the next pairing, re-priming the
      // stale-tick condition (every pairing below is Monster -> kindY, never
      // kindX -> kindY).
      fireEvent.click(screen.getByRole('tab', { name: /monsters/i }));
      await screen.findByRole('option', { name: /sneaky goblin/i });
    }

    // The route is still fully functional after the whole sweep.
    expect(screen.getAllByRole('tab')).toHaveLength(7);
  });
});

describe('DDX21-3: Classes tab pluralizes correctly ("classes", not "classs")', () => {
  const FIGHTER: CatalogItem = {
    slug: 'fighter',
    name: 'Fighter',
    content_type: 'class',
    source_type: 'srd',
    data: { hit_die: 10 },
  };
  const WIZARD: CatalogItem = {
    slug: 'wizard',
    name: 'Wizard',
    content_type: 'class',
    source_type: 'srd',
    data: { hit_die: 6 },
  };

  beforeEach(() => {
    mockGetCatalogCounts.mockReset().mockResolvedValue({
      system: 'dnd5e',
      packs: null,
      content_type: null,
      counts: { spell: 0, monster: 0, item: 0, race: 0, class: 2, background: 0, condition: 0 },
    } as unknown as Awaited<ReturnType<typeof dnd.getCatalogCounts>>);
    mockGetCatalog.mockReset().mockImplementation((_system, opts) => {
      if (opts?.type === 'class') return Promise.resolve(respond('class', [FIGHTER, WIZARD])) as never;
      return Promise.resolve(respond(opts?.type ?? '', [])) as never;
    });
  });

  it('the visible list-head count reads "2 classes", never "2 classs"', async () => {
    renderCodexWithBoundary();
    fireEvent.click(await screen.findByRole('tab', { name: /classes/i }));
    await screen.findByRole('option', { name: /fighter/i });

    const listHead = document.querySelector('.listHead') as HTMLElement;
    expect(listHead.textContent).toMatch(/2 classes\b/);
    expect(listHead.textContent).not.toMatch(/classs/);
  });

  it('the debounced sr-only announcement also reads "classes", never "classs"', async () => {
    renderCodexWithBoundary();
    fireEvent.click(await screen.findByRole('tab', { name: /classes/i }));
    await screen.findByRole('option', { name: /fighter/i });

    await waitFor(() => {
      const liveParagraphs = Array.from(document.querySelectorAll('p.sr-only')) as HTMLElement[];
      const countAnnouncement = liveParagraphs[0]?.textContent ?? '';
      expect(countAnnouncement).toMatch(/2 classes\b/);
      expect(countAnnouncement).not.toMatch(/classs/);
    });
  });
});
