/**
 * Tests for the codex source picker (TAV-CODEX-SOURCE-PICKER-NPC, Aoi-UI §1):
 * URL round-trip, keyboard operation, persistence across kind switches, the
 * invalid/inaccessible-`?source=` fallback (never reflected anywhere), and
 * the packs-endpoint-down degrade.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';

const mockReplace = jest.fn();
let mockSearchParams = new URLSearchParams();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: mockReplace }),
  useSearchParams: () => mockSearchParams,
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
import type { CatalogItem, ContentPack, User } from '../../lib/api/types';

const mockGetCatalog = dnd.getCatalog as jest.MockedFunction<typeof dnd.getCatalog>;
const mockGetCatalogCounts = dnd.getCatalogCounts as jest.MockedFunction<typeof dnd.getCatalogCounts>;
const mockGetPacks = dnd.getPacks as jest.MockedFunction<typeof dnd.getPacks>;

const LEON: User = { id: 1, username: 'leon', email: null };

const SRD: ContentPack = {
  pack_id: 'srd-5e',
  display_name: 'D&D 5e SRD 5.1',
  precedence: 0,
  system_id: 'dnd5e',
  kind: 'srd',
  visibility: 'public',
  is_owner: false,
};
const NARUTO: ContentPack = {
  pack_id: 'leon-naruto-5e',
  display_name: 'Naruto — Genin Dawn (private)',
  precedence: 10,
  system_id: 'dnd5e',
  kind: 'homebrew',
  visibility: 'private',
  is_owner: true,
};

function respond(type: string, items: CatalogItem[]) {
  return { system: 'dnd5e', content_type: type, items, total: items.length, limit: 500, offset: 0 };
}

const FIREBALL: CatalogItem = {
  slug: 'fireball',
  name: 'Fireball',
  content_type: 'spell',
  source_type: 'srd',
  data: { level: 3 },
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

beforeEach(() => {
  mockReplace.mockReset();
  mockSearchParams = new URLSearchParams();
  mockGetCatalogCounts.mockReset().mockResolvedValue({ counts: {}, content_type: null } as never);
  mockGetPacks.mockReset().mockResolvedValue([SRD, NARUTO]);
  mockGetCatalog.mockReset().mockImplementation((_s, opts) =>
    Promise.resolve(opts?.type === 'spell' ? respond('spell', [FIREBALL]) : respond(opts?.type ?? '', [])),
  );
});

describe('the `pack` query key (Kage-CR proxy review) — never sent as an empty string', () => {
  it('"All sources" omits `pack` entirely from getCatalog/getCatalogCounts — never `pack: ""`', async () => {
    renderCodex();
    await screen.findByRole('option', { name: /fireball/i });

    await waitFor(() => expect(mockGetCatalog).toHaveBeenCalled());
    for (const call of mockGetCatalog.mock.calls) {
      expect(call[1]).not.toHaveProperty('pack');
    }
    for (const call of mockGetCatalogCounts.mock.calls) {
      expect(call[1] ?? {}).not.toHaveProperty('pack');
    }
  });

  it('an invalid/unknown ?source= in the URL also omits `pack` (falls back to All, never `pack: ""`)', async () => {
    mockSearchParams = new URLSearchParams('source=forged-xyz-does-not-exist');
    renderCodex();
    await waitFor(() => expect(mockGetCatalog).toHaveBeenCalled());
    for (const call of mockGetCatalog.mock.calls) {
      expect(call[1]).not.toHaveProperty('pack');
    }
  });

  it('a chosen source sends `pack` exactly once per call, with the real pack_id (never blank)', async () => {
    renderCodex();
    await screen.findByRole('option', { name: /fireball/i });

    fireEvent.click(screen.getByRole('combobox', { name: /content source/i }));
    fireEvent.click(await screen.findByRole('option', { name: /naruto/i }));

    await waitFor(() => {
      const calls = mockGetCatalog.mock.calls.filter((c) => (c[1] as { type?: string }).type === 'spell');
      const last = calls[calls.length - 1];
      expect(last[1]).toHaveProperty('pack', 'leon-naruto-5e');
    });
  });
});

describe('trigger + degraded states', () => {
  it('shows "All sources" by default with no packs selected', async () => {
    renderCodex();
    expect(await screen.findByRole('combobox', { name: /content source/i })).toHaveTextContent(
      'All sources',
    );
  });

  it('packs endpoint down: picker shows "All sources" only + an inline notice, rest of the page still works', async () => {
    mockGetPacks.mockReset().mockRejectedValue(new Error('down'));
    renderCodex();

    const trigger = await screen.findByRole('combobox', { name: /content source/i });
    expect(trigger).toHaveTextContent('All sources');
    // Kage-CR #16: aria-disabled, not the native `disabled` attribute — the
    // trigger stays reachable/focusable (and announced as disabled, with a
    // reason via the adjacent notice) rather than silently dropped from the
    // tab order.
    expect(trigger).not.toBeDisabled();
    expect(trigger).toHaveAttribute('aria-disabled', 'true');
    expect(await screen.findByText(/sources unavailable/i)).toBeInTheDocument();
    // The rest of the page keeps working against the unfiltered catalog.
    expect(await screen.findByRole('option', { name: /fireball/i })).toBeInTheDocument();
  });
});

describe('rail counts reflect the active source (Aoi-UI §Rail)', () => {
  it('re-fetches the manifest counts with `pack` when the source changes, and omits it for "All"', async () => {
    renderCodex();
    await screen.findByRole('option', { name: /fireball/i });
    await waitFor(() =>
      expect(mockGetCatalogCounts).toHaveBeenCalledWith('dnd5e', {}, expect.anything()),
    );

    fireEvent.click(screen.getByRole('combobox', { name: /content source/i }));
    fireEvent.click(await screen.findByRole('option', { name: /naruto/i }));

    await waitFor(() =>
      expect(mockGetCatalogCounts).toHaveBeenCalledWith(
        'dnd5e',
        { pack: 'leon-naruto-5e' },
        expect.anything(),
      ),
    );
  });
});

describe('URL round-trip + persistence', () => {
  it('reads an initial ?source= from the URL and reflects it as the selected pack', async () => {
    mockSearchParams = new URLSearchParams('source=leon-naruto-5e');
    renderCodex();
    await waitFor(() => {
      expect(screen.getByRole('combobox', { name: /content source/i })).toHaveTextContent(
        'Naruto — Genin Dawn (private)',
      );
    });
  });

  it('picking a homebrew pack writes ?source=<pack_id> via router.replace (no push) and re-scopes the active kind\'s fetch', async () => {
    renderCodex();
    await screen.findByRole('option', { name: /fireball/i });

    fireEvent.click(screen.getByRole('combobox', { name: /content source/i }));
    fireEvent.click(await screen.findByRole('option', { name: /naruto/i }));

    expect(mockReplace).toHaveBeenCalledWith('/codex?source=leon-naruto-5e', { scroll: false });
    await waitFor(() => {
      expect(mockGetCatalog).toHaveBeenCalledWith(
        'dnd5e',
        expect.objectContaining({ type: 'spell', pack: 'leon-naruto-5e' }),
        expect.anything(),
      );
    });
  });

  it('picking "All sources" again omits ?source= entirely from the replaced URL', async () => {
    mockSearchParams = new URLSearchParams('source=leon-naruto-5e');
    renderCodex();
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: /content source/i })).toHaveTextContent('Naruto'),
    );

    fireEvent.click(screen.getByRole('combobox', { name: /content source/i }));
    fireEvent.click(await screen.findByRole('option', { name: /^all sources$/i }));

    expect(mockReplace).toHaveBeenCalledWith('/codex', { scroll: false });
  });

  it('persists the selected source across a kind-tab switch', async () => {
    renderCodex();
    await screen.findByRole('option', { name: /fireball/i });

    fireEvent.click(screen.getByRole('combobox', { name: /content source/i }));
    fireEvent.click(await screen.findByRole('option', { name: /naruto/i }));
    await waitFor(() => expect(mockReplace).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('tab', { name: /monsters/i }));

    await waitFor(() => {
      expect(mockGetCatalog).toHaveBeenCalledWith(
        'dnd5e',
        expect.objectContaining({ type: 'monster', pack: 'leon-naruto-5e' }),
        expect.anything(),
      );
    });
    expect(screen.getByRole('combobox', { name: /content source/i })).toHaveTextContent('Naruto');
  });
});

describe('invalid/inaccessible ?source= (adversarial, Sensitive Screens)', () => {
  it('a source id absent from the packs list silently falls back to "All" — the raw value is never reflected anywhere in the DOM', async () => {
    mockSearchParams = new URLSearchParams('source=forged-xyz-does-not-exist');
    renderCodex();

    await waitFor(() => {
      expect(screen.getByRole('combobox', { name: /content source/i })).toHaveTextContent('All sources');
    });
    expect(document.body.textContent).not.toContain('forged-xyz-does-not-exist');
    // And the fetch never carries the forged value either.
    await waitFor(() => expect(mockGetCatalog).toHaveBeenCalled());
    for (const call of mockGetCatalog.mock.calls) {
      expect((call[1] as { pack?: string }).pack).not.toBe('forged-xyz-does-not-exist');
    }
  });
});

describe('keyboard operation (APG select-only combobox, A11Y-1)', () => {
  // CRITICAL-1 (Iro-A11y): real DOM focus never leaves the trigger button —
  // the popup <ul> is a virtual-focus listbox, never itself focused. Every
  // key dispatch below therefore targets the TRIGGER, not the list (the
  // previous version of this suite fired on the list directly, which never
  // exercises the real keydown handler and passed falsely even against the
  // keyboard-trap bug).
  it('Enter opens the popup, ArrowDown moves virtual focus, Enter selects + closes + returns focus to the trigger', async () => {
    renderCodex();
    await screen.findByRole('option', { name: /fireball/i });
    const trigger = screen.getByRole('combobox', { name: /content source/i });

    trigger.focus();
    fireEvent.keyDown(trigger, { key: 'Enter' });
    const listbox = await screen.findByRole('listbox', { name: /content source/i });
    expect(listbox).toBeInTheDocument();
    expect(trigger).toHaveFocus();

    fireEvent.keyDown(trigger, { key: 'ArrowDown' }); // -> SRD
    fireEvent.keyDown(trigger, { key: 'ArrowDown' }); // -> Naruto (homebrew)
    fireEvent.keyDown(trigger, { key: 'Enter' });

    expect(screen.queryByRole('listbox', { name: /content source/i })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(mockReplace).toHaveBeenCalledWith('/codex?source=leon-naruto-5e', { scroll: false });
  });

  it('Escape closes without changing the selection and returns focus to the trigger', async () => {
    renderCodex();
    await screen.findByRole('option', { name: /fireball/i });
    const trigger = screen.getByRole('combobox', { name: /content source/i });

    fireEvent.click(trigger);
    await screen.findByRole('listbox', { name: /content source/i });
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    fireEvent.keyDown(trigger, { key: 'Escape' });

    expect(screen.queryByRole('listbox', { name: /content source/i })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(mockReplace).not.toHaveBeenCalled();
    expect(trigger).toHaveTextContent('All sources');
  });

  it('Home/End jump virtual focus to the first/last option', async () => {
    renderCodex();
    await screen.findByRole('option', { name: /fireball/i });
    const trigger = screen.getByRole('combobox', { name: /content source/i });
    fireEvent.click(trigger);
    await screen.findByRole('listbox', { name: /content source/i });

    fireEvent.keyDown(trigger, { key: 'End' });
    fireEvent.keyDown(trigger, { key: 'Enter' });
    expect(mockReplace).toHaveBeenCalledWith('/codex?source=leon-naruto-5e', { scroll: false });
  });

  it('typeahead jumps to the option starting with the typed letter', async () => {
    renderCodex();
    await screen.findByRole('option', { name: /fireball/i });
    const trigger = screen.getByRole('combobox', { name: /content source/i });
    fireEvent.click(trigger);
    await screen.findByRole('listbox', { name: /content source/i });

    fireEvent.keyDown(trigger, { key: 'n' }); // "Naruto — ..." starts with n
    fireEvent.keyDown(trigger, { key: 'Enter' });
    expect(mockReplace).toHaveBeenCalledWith('/codex?source=leon-naruto-5e', { scroll: false });
  });

  it('CRITICAL-1 regression pin: dispatching keydown on the POPUP <ul> itself does nothing (proves the handler lives on the trigger, not a sibling that can never receive real focus)', async () => {
    renderCodex();
    await screen.findByRole('option', { name: /fireball/i });
    const trigger = screen.getByRole('combobox', { name: /content source/i });
    fireEvent.click(trigger);
    const listbox = await screen.findByRole('listbox', { name: /content source/i });

    fireEvent.keyDown(listbox, { key: 'End' });
    fireEvent.keyDown(listbox, { key: 'Enter' });

    // Real focus never moved to the list, so these keys were never handled —
    // the popup is still open and no selection was committed.
    expect(screen.getByRole('listbox', { name: /content source/i })).toBeInTheDocument();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('outside click closes the popup without changing the selection', async () => {
    renderCodex();
    await screen.findByRole('option', { name: /fireball/i });
    fireEvent.click(screen.getByRole('combobox', { name: /content source/i }));
    await screen.findByRole('listbox', { name: /content source/i });

    fireEvent.mouseDown(document.body);

    expect(screen.queryByRole('listbox', { name: /content source/i })).not.toBeInTheDocument();
    expect(mockReplace).not.toHaveBeenCalled();
  });
});

describe('selected option indicator (non-color, A11Y checklist)', () => {
  it('the selected option carries aria-selected=true and a visible check glyph', async () => {
    mockSearchParams = new URLSearchParams('source=leon-naruto-5e');
    renderCodex();
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: /content source/i })).toHaveTextContent('Naruto'),
    );
    fireEvent.click(screen.getByRole('combobox', { name: /content source/i }));
    const listbox = await screen.findByRole('listbox', { name: /content source/i });
    const selectedOption = within(listbox).getByRole('option', { name: /naruto/i });
    expect(selectedOption).toHaveAttribute('aria-selected', 'true');
    expect(selectedOption.querySelector('svg')).toBeInTheDocument();
  });
});

describe('itemsSource invariant — page.tsx kindReady gate (Kage-CR #8, DDX21-1 extension)', () => {
  it('switching source at a FIXED kind never renders the stale source\'s monster row under the new source', async () => {
    const ABOLETH: CatalogItem = {
      slug: 'aboleth',
      name: 'Aboleth',
      content_type: 'monster',
      source_type: 'srd',
      data: { speed: { walk: 10, swim: 40 }, cr: 10 },
    };
    let resolveNaruto!: () => void;
    mockGetCatalog.mockReset().mockImplementation((_s, opts) => {
      if (opts?.type === 'spell') return Promise.resolve(respond('spell', [FIREBALL]));
      if (opts?.type === 'monster' && !opts?.pack) return Promise.resolve(respond('monster', [ABOLETH]));
      if (opts?.type === 'monster' && opts?.pack === 'leon-naruto-5e') {
        return new Promise((res) => {
          resolveNaruto = () => res(respond('monster', []));
        });
      }
      return Promise.resolve(respond(opts?.type ?? '', []));
    });

    renderCodex();
    await screen.findByRole('option', { name: /fireball/i });
    fireEvent.click(screen.getByRole('tab', { name: /monsters/i }));
    await screen.findByRole('option', { name: /aboleth/i });

    // Switch source to Naruto — its monster fetch is deliberately delayed.
    fireEvent.click(screen.getByRole('combobox', { name: /content source/i }));
    fireEvent.click(await screen.findByRole('option', { name: /naruto/i }));

    // THE INVARIANT: while Naruto's monster page is still in flight, the
    // "All sources" Aboleth row must NOT still render as if it belongs to
    // the new source — page.tsx's `kindReady` gate
    // (`itemsKind === activeKind && itemsSource === effectiveSource`) is
    // what's meant to guarantee this. Honest caveat (verified by mutation,
    // not assumed): under RTL's synchronous `act()` flushing, deleting the
    // `itemsSource` conjunct here does NOT currently fail this specific
    // assertion — the hook's own `runPaging` synchronously clears `items`
    // to `[]` inside the same effect that starts the new fetch (before any
    // `await`), so the outer gate is redundant defense-in-depth for a
    // same-kind source switch, not provably load-bearing via this black-box
    // test. It remains load-bearing for the ORIGINAL DDX21-1 shape-mismatch
    // class (a kind switch handing one kind's data to another's renderer,
    // still covered by codex-ddx21-fixes.test.tsx) and as a guard against a
    // future refactor of the hook that stops self-clearing synchronously.
    // Kept in place; flagged to Kage-CR rather than presented as disproven.
    await waitFor(() => {
      expect(screen.queryByRole('option', { name: /aboleth/i })).not.toBeInTheDocument();
    });

    resolveNaruto();
    await waitFor(() => {
      expect(screen.getByText(/no monsters/i)).toBeInTheDocument();
    });
  });
});

describe('FR-16 — NPC subfilter is affiliation, populated from the loaded list (Kage-CR #9)', () => {
  it('the Affiliation subfilter lists distinct affiliations from the currently loaded NPC rows', async () => {
    const ITACHI: CatalogItem = {
      slug: 'itachi',
      name: 'Itachi Uchiha',
      content_type: 'npc',
      source_type: 'homebrew',
      data: { name: 'Itachi Uchiha', affiliation: 'Akatsuki' },
    };
    const IRUKA: CatalogItem = {
      slug: 'iruka',
      name: 'Iruka Umino',
      content_type: 'npc',
      source_type: 'homebrew',
      data: { name: 'Iruka Umino', affiliation: 'Leaf Village' },
    };
    mockGetCatalog.mockReset().mockImplementation((_s, opts) => {
      if (opts?.type === 'spell') return Promise.resolve(respond('spell', [FIREBALL]));
      if (opts?.type === 'npc') return Promise.resolve(respond('npc', [ITACHI, IRUKA]));
      return Promise.resolve(respond(opts?.type ?? '', []));
    });

    renderCodex();
    await screen.findByRole('option', { name: /fireball/i });
    fireEvent.click(screen.getByRole('tab', { name: /npcs/i }));
    await screen.findByRole('option', { name: /itachi/i });

    const subfilter = screen.getByLabelText(/affiliation/i);
    expect(within(subfilter).getByRole('option', { name: 'Akatsuki' })).toBeInTheDocument();
    expect(within(subfilter).getByRole('option', { name: 'Leaf Village' })).toBeInTheDocument();

    fireEvent.change(subfilter, { target: { value: 'Akatsuki' } });
    expect(screen.getByRole('option', { name: /itachi/i })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /iruka/i })).not.toBeInTheDocument();
  });
});

describe('MAJOR-1 (Iro-A11y) — group headings reach the accessible tree', () => {
  it('"Homebrew" is exposed via an accessible group, not an aria-hidden divider', async () => {
    renderCodex();
    await screen.findByRole('option', { name: /fireball/i });
    fireEvent.click(screen.getByRole('combobox', { name: /content source/i }));
    const listbox = await screen.findByRole('listbox', { name: /content source/i });

    const group = within(listbox).getByRole('group', { name: /homebrew/i });
    expect(group).toBeInTheDocument();
    // The Naruto option lives inside the accessible group.
    expect(within(group).getByRole('option', { name: /naruto/i })).toBeInTheDocument();
  });
});
