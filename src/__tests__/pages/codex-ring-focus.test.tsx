/**
 * Coverage for CODEX-RING-CLIP's onFocus handler on the Codex listbox
 * (page.tsx, commit 11c4000). The virtual-focus ring (Codex.module.css
 * `.rows:focus-visible .rowFocused`) is the listbox's only visible focus
 * indicator, so when real DOM focus lands on `.rows` by KEYBOARD, the active
 * row must be scrolled into view. It must NOT scroll on a mouse-driven focus
 * (e.g. clicking a row calls `listboxRef.current.focus()` internally) — the
 * handler's own comment explains why: scrolling between mousedown and click
 * would land the click on a different row.
 *
 * jsdom check (2026-09-18, jsdom 26.1.0 via jest-environment-jsdom 30.4.1):
 * `Element.prototype.matches(':focus-visible')` is IMPLEMENTED (does not
 * throw) but does not model input modality at all — it simply mirrors
 * `:focus` (true whenever the element is `document.activeElement`,
 * regardless of whether the focus was keyboard- or mouse-driven). That means
 * a real keyboard-vs-mouse distinction is NOT observable in this harness by
 * driving real Tab/click sequences and reading the real pseudo-class result
 * — every test below spies on `Element.prototype.matches` and controls its
 * ':focus-visible' answer directly, which tests what the CODE does with each
 * answer (the part this harness can prove) rather than which answer a real
 * browser would give for a given input device (which it can't — that needs
 * the deploy/browser break-it pass, per the QA handoff for this fix).
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
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
  getPacks: jest.fn(),
}));

import * as dnd from '../../lib/api/dnd';
import { AuthProvider } from '../../lib/auth/AuthProvider';
import { ThemeProvider } from '../../lib/theme/ThemeProvider';
import { ToastProvider } from '../../components/Toast';
import CodexPage from '../../app/codex/page';
import type { CatalogItem, User } from '../../lib/api/types';

const mockGetCatalog = dnd.getCatalog as jest.MockedFunction<typeof dnd.getCatalog>;
const mockGetCatalogCounts = dnd.getCatalogCounts as jest.MockedFunction<typeof dnd.getCatalogCounts>;
const mockGetPacks = dnd.getPacks as jest.MockedFunction<typeof dnd.getPacks>;

beforeEach(() => {
  mockGetPacks.mockReset().mockResolvedValue([]);
});

const LEON: User = { id: 1, username: 'leon', email: null };

const COUNTS = {
  system: 'dnd5e',
  packs: null,
  content_type: null,
  counts: { spell: 3, monster: 0, item: 0, race: 0, class: 0, background: 0, condition: 0 },
} as unknown as Awaited<ReturnType<typeof dnd.getCatalogCounts>>;

// Two spells so ArrowDown has somewhere to land other than row 0 — a test
// that never moves focusedIdx off 0 can't tell a correctly-targeted
// scrollRowIntoView(focusedIdx) apart from a mutated, hardcoded
// scrollRowIntoView(0).
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

const SPELL_RESPONSE = {
  system: 'dnd5e',
  content_type: 'spell',
  items: [FIREBALL, MAGE_HAND],
  total: 2,
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

describe('CODEX-RING-CLIP: .rows onFocus scrolls the active row only on keyboard focus', () => {
  let scrollIntoViewMock: jest.Mock;
  const realMatches = Element.prototype.matches;
  let matchesSpy: jest.SpyInstance;
  // Controls what the spy returns for the ':focus-visible' selector only;
  // every other selector falls through to the real implementation so
  // unrelated `.matches(...)` / `.closest(...)` callers elsewhere in the
  // tree (React internals, RTL, other components) are unaffected.
  let focusVisibleAnswer: boolean | 'throw';

  beforeEach(() => {
    mockGetCatalogCounts.mockReset().mockResolvedValue(COUNTS);
    mockGetCatalog.mockReset().mockImplementation((_system, opts) => {
      if (opts?.type === 'spell') return Promise.resolve(SPELL_RESPONSE as never);
      return Promise.resolve({ system: 'dnd5e', content_type: opts?.type ?? null, items: [], total: 0, limit: 500, offset: 0 } as never);
    });

    scrollIntoViewMock = Element.prototype.scrollIntoView as jest.Mock;
    scrollIntoViewMock.mockClear();

    focusVisibleAnswer = true;
    matchesSpy = jest
      .spyOn(Element.prototype, 'matches')
      .mockImplementation(function (this: Element, selector: string) {
        if (selector === ':focus-visible') {
          if (focusVisibleAnswer === 'throw') {
            throw new DOMException(
              "Failed to execute 'matches' on 'Element': ':focus-visible' is not a valid selector.",
              'SyntaxError',
            );
          }
          return focusVisibleAnswer;
        }
        return realMatches.call(this, selector);
      });
  });

  afterEach(() => {
    matchesSpy.mockRestore();
  });

  it('keyboard focus (matches(":focus-visible") -> true) scrolls the CURRENTLY focused row, not row 0', async () => {
    renderCodex();
    const listbox = await screen.findByRole('listbox', { name: /spells results/i });

    // Move virtual focus off row 0 first.
    fireEvent.keyDown(listbox, { key: 'ArrowDown' }); // focusedIdx -> 1 (Mage Hand)
    expect(listbox).toHaveAttribute('aria-activedescendant', expect.stringContaining('mage-hand'));
    scrollIntoViewMock.mockClear(); // the ArrowDown handler itself also scrolls — isolate onFocus's call

    focusVisibleAnswer = true;
    fireEvent.focus(listbox);

    expect(scrollIntoViewMock).toHaveBeenCalledTimes(1);
    const scrolledEl = scrollIntoViewMock.mock.instances[0] as HTMLElement;
    expect(scrolledEl).toBe(screen.getByRole('option', { name: /mage hand/i }));
    expect(scrolledEl).not.toBe(screen.getByRole('option', { name: /fireball/i }));
  });

  it('mouse focus (matches(":focus-visible") -> false) does NOT scroll — clicking a row must not move the list under the pointer', async () => {
    renderCodex();
    const mageHandRow = await screen.findByRole('option', { name: /mage hand/i });

    focusVisibleAnswer = false;
    scrollIntoViewMock.mockClear();

    // The row's onSelect calls listboxRef.current.focus() internally — a
    // real DOM focus() call, not a synthetic fireEvent — this is the actual
    // click-to-select path, not a fabricated focus event.
    fireEvent.click(mageHandRow);

    expect(scrollIntoViewMock).not.toHaveBeenCalled();
    // The click still worked as a selection despite not scrolling.
    expect(screen.getByRole('listbox')).toHaveAttribute(
      'aria-activedescendant',
      expect.stringContaining('mage-hand'),
    );
  });

  it('an engine where matches(":focus-visible") throws (unsupported selector) does not crash and does not scroll', async () => {
    renderCodex();
    const listbox = await screen.findByRole('listbox', { name: /spells results/i });
    scrollIntoViewMock.mockClear();
    focusVisibleAnswer = 'throw';

    expect(() => fireEvent.focus(listbox)).not.toThrow();
    expect(scrollIntoViewMock).not.toHaveBeenCalled();
  });

  it('an empty filtered list (nothing matches the search) does not render the listbox at all — no focused-but-unindicated state to gate', async () => {
    renderCodex();
    await screen.findByRole('listbox', { name: /spells results/i });
    const search = screen.getByRole('searchbox');
    fireEvent.change(search, { target: { value: 'zzzznomatch' } });

    expect(await screen.findByText(/no results match your search/i)).toBeInTheDocument();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });
});
