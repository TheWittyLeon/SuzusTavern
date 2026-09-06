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
    expect(trigger).toBeDisabled();
    expect(await screen.findByText(/sources unavailable/i)).toBeInTheDocument();
    // The rest of the page keeps working against the unfiltered catalog.
    expect(await screen.findByRole('option', { name: /fireball/i })).toBeInTheDocument();
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
  it('Enter opens the popup, ArrowDown moves virtual focus, Enter selects + closes + returns focus to the trigger', async () => {
    renderCodex();
    await screen.findByRole('option', { name: /fireball/i });
    const trigger = screen.getByRole('combobox', { name: /content source/i });

    trigger.focus();
    fireEvent.keyDown(trigger, { key: 'Enter' });
    const listbox = await screen.findByRole('listbox', { name: /content source/i });
    expect(listbox).toBeInTheDocument();

    fireEvent.keyDown(listbox, { key: 'ArrowDown' }); // -> SRD
    fireEvent.keyDown(listbox, { key: 'ArrowDown' }); // -> Naruto (homebrew)
    fireEvent.keyDown(listbox, { key: 'Enter' });

    expect(screen.queryByRole('listbox', { name: /content source/i })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(mockReplace).toHaveBeenCalledWith('/codex?source=leon-naruto-5e', { scroll: false });
  });

  it('Escape closes without changing the selection and returns focus to the trigger', async () => {
    renderCodex();
    await screen.findByRole('option', { name: /fireball/i });
    const trigger = screen.getByRole('combobox', { name: /content source/i });

    fireEvent.click(trigger);
    const listbox = await screen.findByRole('listbox', { name: /content source/i });
    fireEvent.keyDown(listbox, { key: 'ArrowDown' });
    fireEvent.keyDown(listbox, { key: 'Escape' });

    expect(screen.queryByRole('listbox', { name: /content source/i })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(mockReplace).not.toHaveBeenCalled();
    expect(trigger).toHaveTextContent('All sources');
  });

  it('Home/End jump virtual focus to the first/last option', async () => {
    renderCodex();
    await screen.findByRole('option', { name: /fireball/i });
    fireEvent.click(screen.getByRole('combobox', { name: /content source/i }));
    const listbox = await screen.findByRole('listbox', { name: /content source/i });

    fireEvent.keyDown(listbox, { key: 'End' });
    fireEvent.keyDown(listbox, { key: 'Enter' });
    expect(mockReplace).toHaveBeenCalledWith('/codex?source=leon-naruto-5e', { scroll: false });
  });

  it('typeahead jumps to the option starting with the typed letter', async () => {
    renderCodex();
    await screen.findByRole('option', { name: /fireball/i });
    fireEvent.click(screen.getByRole('combobox', { name: /content source/i }));
    const listbox = await screen.findByRole('listbox', { name: /content source/i });

    fireEvent.keyDown(listbox, { key: 'n' }); // "Naruto — ..." starts with n
    fireEvent.keyDown(listbox, { key: 'Enter' });
    expect(mockReplace).toHaveBeenCalledWith('/codex?source=leon-naruto-5e', { scroll: false });
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
