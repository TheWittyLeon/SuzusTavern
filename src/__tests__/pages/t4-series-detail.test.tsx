/**
 * T4p1/B1 — series detail page (src/app/modules/series/[slug]/page.tsx).
 *
 * B1 (T5 live sweep, 2026-08-28): the engine's real D1-ruled wire shape for
 * a series' `summary.member_refs` is a PLAIN STRING ARRAY of adventure
 * public_ids — not the {ref,act_handle,label}[] object shape an earlier
 * design draft assumed. This page now resolves member titles/levels by
 * joining member_refs against a `type=adventure` catalog fetch (by
 * public_id) — these fixtures/assertions cover that join, incl. the
 * unresolved-ref ("hole, not an ending") case.
 *
 * Covers: hero rendering (title/subtitle/pills/member count), the
 * play-order list (resolved adventure title vs "Part N"/"Not available"
 * for an unresolved ref), the "Begin with <part>" + per-row "Run this"
 * deep links to /modules?adventure=<ref>, loading/error/retry, and the
 * not-found state for a slug with no matching series.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

jest.mock('next/navigation', () => ({
  useParams: () => ({ slug: 'mlp-toto-campaign' }),
  // TavernShell's UserMenu also calls useRouter().
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
}));

import * as dnd from '../../lib/api/dnd';
import { AuthProvider } from '../../lib/auth/AuthProvider';
import { ThemeProvider } from '../../lib/theme/ThemeProvider';
import { ToastProvider } from '../../components/Toast';
import SeriesDetailPage from '../../app/modules/series/[slug]/page';
import type { CatalogResponse, User } from '../../lib/api/types';

const mockGetCatalog = dnd.getCatalog as jest.MockedFunction<typeof dnd.getCatalog>;
const LEON: User = { id: 1, username: 'leon', email: null };

const SERIES_ITEM = {
  public_id: 'dnd5e:series:mlp-toto-campaign',
  slug: 'mlp-toto-campaign',
  name: 'Tales of the Oppressed',
  content_type: 'series',
  summary: {
    subtitle: 'An Equestria campaign, act by act',
    level_range: { min: 1, max: 4 },
    content_rating: 'mature',
    cover: { color: '#6b4fa8', pattern: 'hatch', glyph: 'crown', image_ref: null },
    member_count: 2,
    // B1: bare adventure public_id strings — the real wire shape.
    member_refs: ['dnd5e:adventure:mlp-act1-spine', 'dnd5e:adventure:mlp-act2-canterlot'],
  },
};

/** Only member 1 resolves against the type=adventure fetch — member 2 is
 *  deliberately absent (retired/unentitled/paginated), exercising the
 *  "hole, not an ending" unresolved-ref path. */
const ADVENTURES = [
  {
    public_id: 'dnd5e:adventure:mlp-act1-spine',
    name: 'Act I — The Stranger in Ponyville',
    // Deliberately distinct from the series-level range (1-4) so the two
    // "levels …" strings can't collide in a getByText query.
    summary: { level_range: { min: 1, max: 3 }, length: 'campaign' },
  },
];

function seriesResponse(items: unknown[]): CatalogResponse {
  return {
    system: 'dnd5e',
    content_type: 'series',
    items,
    total: items.length,
    limit: 50,
    offset: 0,
  } as unknown as CatalogResponse;
}

function adventureResponse(items: unknown[]): CatalogResponse {
  return {
    system: 'dnd5e',
    content_type: 'adventure',
    items,
    total: items.length,
    limit: 50,
    offset: 0,
  } as unknown as CatalogResponse;
}

/** Wires getCatalog to branch on `type`, mirroring modules/page.tsx's own
 *  dual-fetch pattern (and this page's new adventure-join fetch). */
function mockCatalog({
  seriesItems = [SERIES_ITEM] as unknown[],
  adventures = ADVENTURES as unknown[],
}: { seriesItems?: unknown[]; adventures?: unknown[] } = {}) {
  mockGetCatalog.mockReset().mockImplementation(async (_system, opts) => {
    if (opts?.type === 'series') return seriesResponse(seriesItems);
    return adventureResponse(adventures);
  });
}

function renderDetail() {
  return render(
    <ToastProvider>
      <ThemeProvider>
        <AuthProvider initialUser={LEON} initialMaybeAuthed={false}>
          <SeriesDetailPage />
        </AuthProvider>
      </ThemeProvider>
    </ToastProvider>,
  );
}

beforeEach(() => {
  mockCatalog();
});

it('shows a loading skeleton while the series catalog is fetching', () => {
  mockGetCatalog.mockReset().mockReturnValue(new Promise(() => {}));
  renderDetail();
  expect(screen.queryByRole('heading', { name: /tales of the oppressed/i })).not.toBeInTheDocument();
});

it('renders the hero (title, subtitle, pills, member count) and the play-order list with RESOLVED titles', async () => {
  renderDetail();

  // TavernShell renders the series name as the page's <h1>; the hero
  // repeats it as an <h2> — scope to the h2 to avoid a duplicate-text match.
  expect(
    await screen.findByRole('heading', { level: 2, name: 'Tales of the Oppressed' }),
  ).toBeInTheDocument();
  expect(screen.getByText('An Equestria campaign, act by act')).toBeInTheDocument();
  // Series-level pill (hero) vs. part-row caption (resolved member's OWN
  // level_range, 1-3) are deliberately different ranges — see ADVENTURES.
  expect(screen.getByText('levels 1–4')).toBeInTheDocument();
  expect(screen.getByText('levels 1–3')).toBeInTheDocument();
  expect(screen.getByText(/2 parts/i)).toBeInTheDocument();
  expect(screen.getByText('mature')).toBeInTheDocument();

  // Part 1 resolves against the adventure fetch -> its REAL catalog title.
  expect(screen.getByText('Act I — The Stranger in Ponyville')).toBeInTheDocument();
  // Part 2 has no match in the adventure fetch -> positional fallback, and
  // a graceful "Not available" in place of a dead Run-this link.
  expect(screen.getByText('Part 2')).toBeInTheDocument();
  expect(screen.getByText('Not available')).toBeInTheDocument();
});

it('the hero "Begin with" CTA and a resolved part row deep-link to /modules?adventure=<ref>', async () => {
  renderDetail();
  await screen.findByRole('heading', { level: 2, name: 'Tales of the Oppressed' });

  const beginLink = screen.getByRole('link', {
    name: /begin with act i.*the stranger in ponyville/i,
  });
  expect(beginLink).toHaveAttribute(
    'href',
    `/modules?adventure=${encodeURIComponent('dnd5e:adventure:mlp-act1-spine')}`,
  );

  const runPart1 = screen.getByRole('link', { name: /run this.*the stranger in ponyville/i });
  expect(runPart1).toHaveAttribute(
    'href',
    `/modules?adventure=${encodeURIComponent('dnd5e:adventure:mlp-act1-spine')}`,
  );
});

it('an unresolved member never renders a Run-this link (no dead button)', async () => {
  renderDetail();
  await screen.findByRole('heading', { level: 2, name: 'Tales of the Oppressed' });
  expect(
    screen.queryByRole('link', { name: /run this.*part 2/i }),
  ).not.toBeInTheDocument();
});

it('the hero CTA is absent entirely when even the FIRST member is unresolved', async () => {
  mockCatalog({ seriesItems: [SERIES_ITEM], adventures: [] });
  renderDetail();
  await screen.findByRole('heading', { level: 2, name: 'Tales of the Oppressed' });
  expect(screen.queryByRole('link', { name: /^begin with/i })).not.toBeInTheDocument();
});

it('a failed adventure fetch degrades every member to unresolved, never the whole page to error', async () => {
  mockGetCatalog.mockReset().mockImplementation(async (_system, opts) => {
    if (opts?.type === 'series') return seriesResponse([SERIES_ITEM]);
    throw new Error('adventure fetch down');
  });
  renderDetail();

  expect(
    await screen.findByRole('heading', { level: 2, name: 'Tales of the Oppressed' }),
  ).toBeInTheDocument();
  expect(screen.getByText('Part 1')).toBeInTheDocument();
  expect(screen.getByText('Part 2')).toBeInTheDocument();
  expect(screen.getAllByText('Not available')).toHaveLength(2);
});

it('shows the not-found state for a slug with no matching series', async () => {
  mockCatalog({ seriesItems: [] }); // empty — slug 'mlp-toto-campaign' matches nothing
  renderDetail();
  expect(await screen.findByText(/isn.t in the catalog/i)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /back to modules/i })).toHaveAttribute('href', '/modules');
});

it('shows the error state and retries on click', async () => {
  let seriesCall = 0;
  mockGetCatalog.mockReset().mockImplementation(async (_system, opts) => {
    if (opts?.type === 'series') {
      seriesCall += 1;
      if (seriesCall === 1) throw new Error('network error');
      return seriesResponse([SERIES_ITEM]);
    }
    return adventureResponse(ADVENTURES);
  });
  renderDetail();

  const retryBtn = await screen.findByRole('button', { name: /try again/i });
  fireEvent.click(retryBtn);

  await waitFor(() =>
    expect(screen.getByRole('heading', { level: 2, name: 'Tales of the Oppressed' })).toBeInTheDocument(),
  );
  expect(seriesCall).toBe(2);
});
