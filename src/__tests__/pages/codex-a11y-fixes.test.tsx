/**
 * Coverage for the DDX-21 Codex accessibility + cosmetic fix pass
 * (Iro-A11y CRITICAL-1, MAJOR-4/5/6/7/8, MINOR-2). The pre-existing
 * happy-path suite is src/__tests__/pages/codex.test.tsx and the adversarial
 * suite is src/__tests__/pages/codex-adversarial.test.tsx — this file is
 * scoped to the NEW behaviors this pass introduced:
 *
 *   - CRITICAL-1: below the 1280px breakpoint, selecting a row opens a real
 *     dismissible modal (focus-trap, Escape, backdrop-click, focus restore)
 *     instead of the display:none drawer.
 *   - MAJOR-4 / MAJOR-5: arrow/Home/End/typeahead virtual-focus moves call
 *     scrollIntoView.
 *   - MAJOR-6: selection changes are announced via a live region; the
 *     drawer's <aside> has a dynamic accessible name.
 *   - MAJOR-7 / MAJOR-8: the rail is a keyboard-navigable tablist (Up/Down +
 *     Home/End). MAJOR-7 originally flipped the rail horizontal (with
 *     Left/Right wired on top) below 860px; DDX-21 fix pass 3 reverted that
 *     reflow (Aoi-UI live-browser re-verify found it non-sticky and prone to
 *     wrapping the subfilter onto the tab row) — the rail is vertical-always
 *     now, so only Up/Down/Home/End apply, at every viewport width.
 *   - MINOR-2: the listHead count announcement is debounced; the visible
 *     count is not.
 *
 * Touch target sizing (MAJOR-9) is a pure CSS media-query fix — CSS Modules
 * are identity-mocked in this Jest setup and jsdom doesn't compute real
 * layout, so it isn't unit-testable here; verified by reading the compiled
 * CSS instead (see Codex.module.css).
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
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
import CodexPage from '../../app/codex/page';
import type { CatalogItem, User } from '../../lib/api/types';

const mockGetCatalog = dnd.getCatalog as jest.MockedFunction<typeof dnd.getCatalog>;
const mockGetCatalogCounts = dnd.getCatalogCounts as jest.MockedFunction<typeof dnd.getCatalogCounts>;

const LEON: User = { id: 1, username: 'leon', email: null };

const COUNTS = {
  system: 'dnd5e',
  packs: null,
  content_type: null,
  counts: { spell: 3, monster: 1, item: 0, race: 0, class: 0, background: 0, condition: 0 },
} as unknown as Awaited<ReturnType<typeof dnd.getCatalogCounts>>;

// Three spells so typeahead has something unambiguous to jump to (only
// "Gust" starts with "g"; only "Mage Hand" starts with "m").
const FIREBALL: CatalogItem = {
  slug: 'fireball',
  name: 'Fireball',
  content_type: 'spell',
  source_type: 'srd',
  data: { level: 3, school: 'evocation', description: 'boom' },
};
const MAGE_HAND: CatalogItem = {
  slug: 'mage-hand',
  name: 'Mage Hand',
  content_type: 'spell',
  source_type: 'srd',
  data: { level: 0, description: 'a spectral hand' },
};
const GUST: CatalogItem = {
  slug: 'gust',
  name: 'Gust',
  content_type: 'spell',
  source_type: 'srd',
  data: { level: 1, description: 'a gust of wind' },
};
const GOBLIN: CatalogItem = {
  slug: 'goblin',
  name: 'Goblin',
  content_type: 'monster',
  source_type: 'srd',
  data: { cr: 0.25 },
};

const SPELL_RESPONSE = {
  system: 'dnd5e',
  content_type: 'spell',
  items: [FIREBALL, MAGE_HAND, GUST],
  total: 3,
  limit: 500,
  offset: 0,
};
const MONSTER_RESPONSE = {
  system: 'dnd5e',
  content_type: 'monster',
  items: [GOBLIN],
  total: 1,
  limit: 500,
  offset: 0,
};

function renderCodex() {
  return render(
    <ToastProvider>
      <ThemeProvider>
        <AuthProvider initialUser={LEON} initialMaybeAuthed={false}>
          <CodexPage />
        </AuthProvider>
      </ThemeProvider>
    </ToastProvider>,
  );
}

const NARROW_DRAWER = '(max-width: 1280px)';
const RAIL_HORIZONTAL = '(max-width: 860px)';

/** Like jest.setup.ts's default stub, but lets a test opt specific queries into `matches: true`. */
function mockMatchMedia(matchingQueries: string[]) {
  window.matchMedia = jest.fn().mockImplementation((query: string) => ({
    matches: matchingQueries.includes(query),
    media: query,
    onchange: null,
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
  }));
}

/**
 * page.tsx renders exactly two `<p className="sr-only" aria-live="polite">`
 * nodes, in this order: the debounced count announcement, then the selection
 * announcement (MINOR-2 / MAJOR-6). Neither TavernShell nor Toast render any
 * sr-only <p>, so this is unambiguous.
 */
function srOnlyLiveParagraphs() {
  return Array.from(document.querySelectorAll('p.sr-only')) as HTMLParagraphElement[];
}
function countAnnouncementText() {
  return srOnlyLiveParagraphs()[0]?.textContent ?? '';
}
function selectionAnnouncementText() {
  return srOnlyLiveParagraphs()[1]?.textContent ?? '';
}

describe('Codex A11Y fixes (DDX-21)', () => {
  let originalMatchMedia: typeof window.matchMedia;
  let scrollIntoViewMock: jest.Mock;

  beforeEach(() => {
    originalMatchMedia = window.matchMedia;
    scrollIntoViewMock = Element.prototype.scrollIntoView as jest.Mock;
    scrollIntoViewMock.mockClear();
    mockGetCatalogCounts.mockReset().mockResolvedValue(COUNTS);
    mockGetCatalog.mockReset().mockImplementation((_system, opts) => {
      if (opts?.type === 'monster') return Promise.resolve(MONSTER_RESPONSE as never);
      if (opts?.type === 'spell') return Promise.resolve(SPELL_RESPONSE as never);
      return Promise.resolve({ system: 'dnd5e', content_type: opts?.type ?? null, items: [], total: 0, limit: 500, offset: 0 } as never);
    });
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  // ── CRITICAL-1: narrow-viewport detail modal ─────────────────────────────

  describe('narrow-viewport detail modal (CRITICAL-1)', () => {
    it('does not open a modal at a wide viewport — the desktop drawer handles selection inline', async () => {
      mockMatchMedia([]);
      renderCodex();
      const row = await screen.findByRole('option', { name: /fireball/i });
      fireEvent.click(row);
      await screen.findByRole('heading', { level: 2, name: /fireball/i });
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('opens a labelled dialog and focuses its close button when a row is selected below the breakpoint', async () => {
      mockMatchMedia([NARROW_DRAWER]);
      renderCodex();
      const row = await screen.findByRole('option', { name: /fireball/i });
      fireEvent.click(row);

      const dialog = await screen.findByRole('dialog');
      expect(dialog).toHaveAttribute('aria-modal', 'true');
      expect(dialog).toHaveAccessibleName(/fireball/i);
      await waitFor(() => {
        expect(within(dialog).getByRole('button', { name: /close details/i })).toHaveFocus();
      });
    });

    it('selecting via Enter in the listbox also opens the modal when narrow', async () => {
      mockMatchMedia([NARROW_DRAWER]);
      renderCodex();
      await screen.findByRole('option', { name: /fireball/i });
      const listbox = screen.getByRole('listbox', { name: /spells results/i });
      fireEvent.keyDown(listbox, { key: 'Enter' });
      const dialog = await screen.findByRole('dialog');
      expect(dialog).toHaveAccessibleName(/fireball/i);
    });

    it('Escape closes the modal and restores focus to the listbox', async () => {
      mockMatchMedia([NARROW_DRAWER]);
      renderCodex();
      const row = await screen.findByRole('option', { name: /fireball/i });
      fireEvent.click(row);
      const dialog = await screen.findByRole('dialog');

      fireEvent.keyDown(dialog, { key: 'Escape' });

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(screen.getByRole('listbox', { name: /spells results/i })).toHaveFocus();
    });

    it('clicking the backdrop closes the modal', async () => {
      mockMatchMedia([NARROW_DRAWER]);
      renderCodex();
      const row = await screen.findByRole('option', { name: /fireball/i });
      fireEvent.click(row);
      const dialog = await screen.findByRole('dialog');
      const backdrop = dialog.parentElement as HTMLElement;

      fireEvent.click(backdrop);

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('clicking the close button closes the modal and restores focus to the listbox', async () => {
      mockMatchMedia([NARROW_DRAWER]);
      renderCodex();
      const row = await screen.findByRole('option', { name: /fireball/i });
      fireEvent.click(row);
      const dialog = await screen.findByRole('dialog');

      fireEvent.click(within(dialog).getByRole('button', { name: /close details/i }));

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(screen.getByRole('listbox', { name: /spells results/i })).toHaveFocus();
    });

    it('switching tabs closes an open modal (a stale kind’s detail shouldn’t linger)', async () => {
      mockMatchMedia([NARROW_DRAWER]);
      renderCodex();
      const row = await screen.findByRole('option', { name: /fireball/i });
      fireEvent.click(row);
      await screen.findByRole('dialog');

      fireEvent.click(screen.getByRole('tab', { name: /monsters/i }));

      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      // Let the monster-tab fetch this triggered settle before the test ends.
      await screen.findByRole('option', { name: /goblin/i });
    });
  });

  // ── MAJOR-4 / MAJOR-5: scrollIntoView on virtual-focus moves ─────────────

  describe('scrollIntoView on virtual-focus moves (MAJOR-4 / MAJOR-5)', () => {
    it('calls scrollIntoView with {block:"nearest", behavior:"auto"} on ArrowDown/ArrowUp', async () => {
      mockMatchMedia([]);
      renderCodex();
      await screen.findByRole('option', { name: /fireball/i });
      const listbox = screen.getByRole('listbox', { name: /spells results/i });
      scrollIntoViewMock.mockClear();

      fireEvent.keyDown(listbox, { key: 'ArrowDown' });
      expect(scrollIntoViewMock).toHaveBeenCalledWith({ block: 'nearest', behavior: 'auto' });

      scrollIntoViewMock.mockClear();
      fireEvent.keyDown(listbox, { key: 'ArrowUp' });
      expect(scrollIntoViewMock).toHaveBeenCalledWith({ block: 'nearest', behavior: 'auto' });
    });

    it('calls scrollIntoView on Home and End', async () => {
      mockMatchMedia([]);
      renderCodex();
      await screen.findByRole('option', { name: /fireball/i });
      const listbox = screen.getByRole('listbox', { name: /spells results/i });

      scrollIntoViewMock.mockClear();
      fireEvent.keyDown(listbox, { key: 'End' });
      expect(scrollIntoViewMock).toHaveBeenCalledWith({ block: 'nearest', behavior: 'auto' });
      expect(listbox).toHaveAttribute('aria-activedescendant', expect.stringContaining('gust'));

      scrollIntoViewMock.mockClear();
      fireEvent.keyDown(listbox, { key: 'Home' });
      expect(scrollIntoViewMock).toHaveBeenCalledWith({ block: 'nearest', behavior: 'auto' });
      expect(listbox).toHaveAttribute('aria-activedescendant', expect.stringContaining('fireball'));
    });

    it('typeahead jumps virtual focus to the first filtered row starting with the typed letters and scrolls it into view', async () => {
      mockMatchMedia([]);
      renderCodex();
      await screen.findByRole('option', { name: /fireball/i });
      const listbox = screen.getByRole('listbox', { name: /spells results/i });
      scrollIntoViewMock.mockClear();

      fireEvent.keyDown(listbox, { key: 'g' }); // only "Gust" starts with g

      expect(listbox).toHaveAttribute('aria-activedescendant', expect.stringContaining('gust'));
      expect(scrollIntoViewMock).toHaveBeenCalledWith({ block: 'nearest', behavior: 'auto' });
    });

    it('typeahead does not move focus when no filtered row matches the buffer', async () => {
      mockMatchMedia([]);
      renderCodex();
      await screen.findByRole('option', { name: /fireball/i });
      const listbox = screen.getByRole('listbox', { name: /spells results/i });

      fireEvent.keyDown(listbox, { key: 'z' }); // nothing starts with z

      expect(listbox).toHaveAttribute('aria-activedescendant', expect.stringContaining('fireball'));
    });

    it('the typeahead buffer resets after ~500ms of inactivity (real timers)', async () => {
      mockMatchMedia([]);
      renderCodex();
      await screen.findByRole('option', { name: /fireball/i });
      const listbox = screen.getByRole('listbox', { name: /spells results/i });

      fireEvent.keyDown(listbox, { key: 'g' }); // -> Gust
      expect(listbox).toHaveAttribute('aria-activedescendant', expect.stringContaining('gust'));

      await act(async () => {
        await new Promise((r) => setTimeout(r, 550));
      });

      // A fresh "m" should mean Mage Hand. If the buffer hadn't reset it would
      // be "gm", which matches nothing, and focus would stay on Gust.
      fireEvent.keyDown(listbox, { key: 'm' });
      expect(listbox).toHaveAttribute('aria-activedescendant', expect.stringContaining('mage-hand'));
    });
  });

  // ── MAJOR-8: rail keyboard navigation (vertical-always since DDX-21 fix
  // pass 3 — see Codex.module.css's .rail comment: the ≤860px horizontal
  // reflow this block used to cover was reverted, so aria-orientation is now
  // "vertical" unconditionally and there's no Left/Right axis to test) ─────

  describe('rail keyboard navigation (MAJOR-8)', () => {
    it('Home/End jump to the first/last tab', async () => {
      mockMatchMedia([]);
      renderCodex();
      await screen.findAllByRole('tab');

      fireEvent.keyDown(screen.getByRole('tab', { name: /spells/i }), { key: 'End' });
      const conditionsTab = screen.getByRole('tab', { name: /conditions/i });
      expect(conditionsTab).toHaveAttribute('aria-selected', 'true');

      fireEvent.keyDown(conditionsTab, { key: 'Home' });
      expect(screen.getByRole('tab', { name: /spells/i })).toHaveAttribute('aria-selected', 'true');
    });

    it('is aria-orientation="vertical" at a wide viewport, and ArrowLeft/ArrowRight do nothing', async () => {
      mockMatchMedia([]);
      renderCodex();
      await screen.findAllByRole('tab');
      expect(screen.getByRole('tablist', { name: /content type/i })).toHaveAttribute(
        'aria-orientation',
        'vertical',
      );

      const spellsTab = screen.getByRole('tab', { name: /spells/i });
      fireEvent.keyDown(spellsTab, { key: 'ArrowRight' });
      expect(spellsTab).toHaveAttribute('aria-selected', 'true');
    });

    it('stays aria-orientation="vertical" below 860px too (DDX-21 fix pass 3 reverted the horizontal reflow), and ArrowLeft/ArrowRight still do nothing', async () => {
      mockMatchMedia([RAIL_HORIZONTAL, NARROW_DRAWER]);
      renderCodex();
      await screen.findAllByRole('tab');
      expect(screen.getByRole('tablist', { name: /content type/i })).toHaveAttribute(
        'aria-orientation',
        'vertical',
      );

      const spellsTab = screen.getByRole('tab', { name: /spells/i });
      fireEvent.keyDown(spellsTab, { key: 'ArrowRight' });
      expect(spellsTab).toHaveAttribute('aria-selected', 'true');
      fireEvent.keyDown(spellsTab, { key: 'ArrowLeft' });
      expect(spellsTab).toHaveAttribute('aria-selected', 'true');
    });

    it('ArrowUp/ArrowDown move the active tab regardless of viewport width', async () => {
      mockMatchMedia([RAIL_HORIZONTAL, NARROW_DRAWER]);
      renderCodex();
      await screen.findAllByRole('tab');

      fireEvent.keyDown(screen.getByRole('tab', { name: /spells/i }), { key: 'ArrowDown' });
      expect(screen.getByRole('tab', { name: /monsters/i })).toHaveAttribute('aria-selected', 'true');
      // Let the monster-tab fetch this triggered settle before the test ends
      // (mirrors codex.test.tsx's own rail-navigation test).
      await screen.findByRole('option', { name: /goblin/i });
    });
  });

  // ── MAJOR-6 / MINOR-2: live-region announcements ─────────────────────────

  describe('live-region announcements (MAJOR-6 / MINOR-2)', () => {
    it('announces the selected item name via a polite live region, and clears it when nothing is selected', async () => {
      mockMatchMedia([]);
      renderCodex();
      const row = await screen.findByRole('option', { name: /fireball/i });
      fireEvent.click(row);

      await waitFor(() => expect(selectionAnnouncementText()).toBe('Showing details for Fireball'));

      // Switching tabs resets the selection — the announcement should clear,
      // not linger stale.
      fireEvent.click(screen.getByRole('tab', { name: /monsters/i }));
      await waitFor(() => expect(selectionAnnouncementText()).toBe(''));
      // Let the monster-tab fetch this triggered settle before the test ends.
      await screen.findByRole('option', { name: /goblin/i });
    });

    it('the drawer <aside> has a dynamic accessible name reflecting the current selection', async () => {
      mockMatchMedia([]);
      renderCodex();
      expect(screen.getByRole('complementary', { name: /spells details/i })).toBeInTheDocument();

      const row = await screen.findByRole('option', { name: /fireball/i });
      fireEvent.click(row);

      expect(
        screen.getByRole('complementary', { name: /spells details: fireball/i }),
      ).toBeInTheDocument();
    });

    it('debounces the count announcement (~400ms) while the visible count stays instant', async () => {
      mockMatchMedia([]);
      renderCodex();
      await screen.findByRole('option', { name: /fireball/i });

      // Let the initial load's debounced announcement settle first so the
      // next assertion isn't racing it.
      await act(async () => {
        await new Promise((r) => setTimeout(r, 450));
      });
      expect(countAnnouncementText()).toBe('3 spells');

      const search = screen.getByRole('searchbox', { name: /search spells/i });
      fireEvent.change(search, { target: { value: 'mage' } });

      // Visible count updates instantly...
      const listHead = document.querySelector('.listHead') as HTMLElement;
      expect(listHead.textContent).toMatch(/1 spell\b/);
      // ...but the announcement hasn't caught up yet.
      expect(countAnnouncementText()).toBe('3 spells');

      await act(async () => {
        await new Promise((r) => setTimeout(r, 450));
      });
      // filtered.length (1) !== items.length (3) — the existing " · N total"
      // suffix is unchanged behavior, just now on a debounce.
      expect(countAnnouncementText()).toBe('1 spell · 3 total');
    });
  });
});
