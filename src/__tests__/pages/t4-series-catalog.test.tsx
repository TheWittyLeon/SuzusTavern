/**
 * T4p1 — series catalog surface (src/app/modules/page.tsx).
 *
 * Covers the parts modules.test.tsx / adv9-modules-edge.test.tsx don't:
 *   - series cards render from a type=series catalog response
 *   - a malformed series item (no cover/member_refs) never renders a broken card
 *   - editorial_role='spine_chunk' adventures are excluded from the one-shot grid
 *   - the series membership stamp renders as a pill on a one-shot card
 *   - the "One-shots" section label only appears once series ALSO exist
 *   - ?adventure=<public_id> deep-links straight into StarterForm
 */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

const mockPush = jest.fn();
let mockSearchParams = new URLSearchParams();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn() }),
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
  createSessionFull: jest.fn(),
  listMyCharacters: jest.fn(),
  getCatalog: jest.fn(),
  bindCharacter: jest.fn(),
}));

import * as dnd from '../../lib/api/dnd';
import { AuthProvider } from '../../lib/auth/AuthProvider';
import { ThemeProvider } from '../../lib/theme/ThemeProvider';
import { ToastProvider } from '../../components/Toast';
import ModulesPage from '../../app/modules/page';
import type { CatalogResponse, User } from '../../lib/api/types';

const mockListChars = dnd.listMyCharacters as jest.MockedFunction<typeof dnd.listMyCharacters>;
const mockGetCatalog = dnd.getCatalog as jest.MockedFunction<typeof dnd.getCatalog>;
const LEON: User = { id: 1, username: 'leon', email: null };

const ONE_SHOT = {
  public_id: 'dnd5e:adventure:hollow-tide-cave',
  name: 'The Hollow Tide Cave',
  summary: {
    subtitle: 'A coastal cave.',
    level_range: { min: 1, max: 2 },
    length: 'one_session',
    content_rating: 'sfw',
  },
};

const SPINE_CHUNK = {
  public_id: 'dnd5e:adventure:mlp-act1-c1c2-slice',
  name: 'Act I chunk 1-2',
  summary: {
    editorial_role: 'spine_chunk',
  },
};

const STAMPED_MEMBER = {
  public_id: 'dnd5e:adventure:mlp-act1-spine',
  name: 'Act I — The Stranger in Ponyville',
  summary: {
    level_range: { min: 1, max: 4 },
    length: 'campaign',
    series: {
      ref: 'dnd5e:series:mlp-toto-campaign',
      title: 'Tales of the Oppressed',
      position: 1,
      total: 4,
    },
  },
};

const WELLFORMED_SERIES = {
  public_id: 'dnd5e:series:mlp-toto-campaign',
  slug: 'mlp-toto-campaign',
  name: 'Tales of the Oppressed',
  content_type: 'series',
  summary: {
    subtitle: 'An Equestria campaign, act by act',
    level_range: { min: 1, max: 4 },
    content_rating: 'mature',
    cover: { color: '#6b4fa8', pattern: 'hatch', glyph: 'crown', image_ref: null },
    member_count: 1,
    // B1 (T5 live sweep, engine D1 ruling): member_refs is a plain string
    // array on the real wire — was incorrectly modeled as
    // {ref,act_handle,label}[] objects.
    member_refs: ['dnd5e:adventure:mlp-act1-spine'],
  },
};

/** A series item missing cover/member_refs — the shape a foreign or stale
 *  response would have. Must never render a broken card. */
const MALFORMED_SERIES = {
  public_id: 'dnd5e:series:incomplete',
  slug: 'incomplete',
  name: 'Incomplete Series',
  content_type: 'series',
  summary: { subtitle: 'no cover or member_refs here' },
};

function catalogResponse(items: unknown[], contentType: string | null): CatalogResponse {
  return {
    system: 'dnd5e',
    content_type: contentType,
    items,
    total: items.length,
    limit: 50,
    offset: 0,
  } as unknown as CatalogResponse;
}

function mockCatalog({
  adventures = [ONE_SHOT],
  seriesItems = [] as unknown[],
}: {
  adventures?: unknown[];
  seriesItems?: unknown[];
} = {}) {
  mockGetCatalog.mockReset().mockImplementation(async (_system, opts) => {
    if (opts?.type === 'series') return catalogResponse(seriesItems, 'series');
    return catalogResponse(adventures, 'adventure');
  });
}

function renderModules() {
  return render(
    <ToastProvider>
      <ThemeProvider>
        <AuthProvider initialUser={LEON} initialMaybeAuthed={false}>
          <ModulesPage />
        </AuthProvider>
      </ThemeProvider>
    </ToastProvider>,
  );
}

beforeEach(() => {
  mockPush.mockClear();
  mockSearchParams = new URLSearchParams();
  mockListChars.mockReset().mockResolvedValue([]);
  mockCatalog();
});

describe('T4p1: series cover cards', () => {
  it('renders a series card with title, subtitle, level range, part count, and a View series link', async () => {
    mockCatalog({ adventures: [ONE_SHOT], seriesItems: [WELLFORMED_SERIES] });
    renderModules();

    expect(await screen.findByText('Series')).toBeInTheDocument();
    expect(screen.getByText('Tales of the Oppressed')).toBeInTheDocument();
    expect(screen.getByText(/an equestria campaign/i)).toBeInTheDocument();
    expect(screen.getByText(/1 part/i)).toBeInTheDocument();
    expect(screen.getByText('levels 1–4')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /view series.*tales of the oppressed/i });
    expect(link).toHaveAttribute('href', '/modules/series/mlp-toto-campaign');
  });

  it('never renders a broken card for a series item missing cover/member_refs', async () => {
    mockCatalog({ adventures: [ONE_SHOT], seriesItems: [MALFORMED_SERIES] });
    renderModules();

    await screen.findByRole('heading', { level: 2, name: /hollow tide/i });
    expect(screen.queryByText('Series')).not.toBeInTheDocument();
    expect(screen.queryByText('Incomplete Series')).not.toBeInTheDocument();
  });

  it('shows the "One-shots" section label only when series ALSO exist', async () => {
    // No series at all — the existing flat grid stays unlabeled (backward compatible).
    mockCatalog({ adventures: [ONE_SHOT], seriesItems: [] });
    renderModules();
    await screen.findByRole('heading', { level: 2, name: /hollow tide/i });
    expect(screen.queryByText('One-shots')).not.toBeInTheDocument();
  });

  it('shows the "One-shots" section label once a series is present alongside one-shots', async () => {
    mockCatalog({ adventures: [ONE_SHOT], seriesItems: [WELLFORMED_SERIES] });
    renderModules();
    await screen.findByText('One-shots');
    expect(await screen.findByRole('heading', { level: 2, name: /hollow tide/i })).toBeInTheDocument();
  });
});

describe('T4p1: editorial_role filtering (design doc D2)', () => {
  it('excludes editorial_role=spine_chunk rows from the browsable one-shot grid', async () => {
    mockCatalog({ adventures: [ONE_SHOT, SPINE_CHUNK], seriesItems: [] });
    renderModules();
    await screen.findByRole('heading', { level: 2, name: /hollow tide/i });
    expect(screen.queryByText('Act I chunk 1-2')).not.toBeInTheDocument();
  });

  it('a catalog of ONLY spine_chunk rows (no true one-shots, no series) shows the empty state, not a bare grid', async () => {
    mockCatalog({ adventures: [SPINE_CHUNK], seriesItems: [] });
    renderModules();
    expect(await screen.findByText(/no modules available yet/i)).toBeInTheDocument();
  });
});

describe('T4p1: adventure-summary series stamp (design doc §8.2)', () => {
  it('renders a pill naming the series on a one-shot card whose summary carries summary.series', async () => {
    mockCatalog({ adventures: [STAMPED_MEMBER], seriesItems: [] });
    renderModules();
    await screen.findByRole('heading', { level: 2, name: /the stranger in ponyville/i });
    expect(screen.getByText('Tales of the Oppressed')).toBeInTheDocument();
  });
});

describe('T4p1: ?adventure= deep link opens StarterForm directly', () => {
  it('auto-selects the matching adventure and opens the starter form', async () => {
    mockSearchParams = new URLSearchParams('adventure=dnd5e:adventure:hollow-tide-cave');
    mockCatalog({ adventures: [ONE_SHOT], seriesItems: [] });
    renderModules();
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /set the table/i })).toBeInTheDocument(),
    );
    expect(screen.getByText(/running/i)).toHaveTextContent('The Hollow Tide Cave');
  });

  it('a deep link to an unknown adventure_ref degrades gracefully — the catalog still renders', async () => {
    mockSearchParams = new URLSearchParams('adventure=dnd5e:adventure:does-not-exist');
    mockCatalog({ adventures: [ONE_SHOT], seriesItems: [] });
    renderModules();
    expect(await screen.findByRole('heading', { level: 2, name: /hollow tide/i })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /set the table/i })).not.toBeInTheDocument();
  });
});
