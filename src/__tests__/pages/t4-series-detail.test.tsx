/**
 * T4p1 — series detail page (src/app/modules/series/[slug]/page.tsx).
 *
 * Covers: hero rendering (title/subtitle/pills/member count), the play-order
 * list (label present vs "Part N" fallback, act_handle caption), the
 * "Begin with <part>" + per-row "Run this" deep links to
 * /modules?adventure=<ref>, loading/error/retry, and the not-found state
 * for a slug with no matching series.
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
    members: [
      { ref: 'dnd5e:adventure:mlp-act1-spine', act_handle: 'act1', label: 'Act I — The Stranger in Ponyville' },
      { ref: 'dnd5e:adventure:mlp-act2-canterlot' },
    ],
  },
};

function catalogResponse(items: unknown[]): CatalogResponse {
  return {
    system: 'dnd5e',
    content_type: 'series',
    items,
    total: items.length,
    limit: 50,
    offset: 0,
  } as unknown as CatalogResponse;
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
  mockGetCatalog.mockReset();
});

it('shows a loading skeleton while the series catalog is fetching', () => {
  mockGetCatalog.mockReturnValue(new Promise(() => {}));
  renderDetail();
  expect(screen.queryByRole('heading', { name: /tales of the oppressed/i })).not.toBeInTheDocument();
});

it('renders the hero (title, subtitle, pills, member count) and the play-order list', async () => {
  mockGetCatalog.mockResolvedValue(catalogResponse([SERIES_ITEM]));
  renderDetail();

  // TavernShell renders the series name as the page's <h1>; the hero
  // repeats it as an <h2> — scope to the h2 to avoid a duplicate-text match.
  expect(
    await screen.findByRole('heading', { level: 2, name: 'Tales of the Oppressed' }),
  ).toBeInTheDocument();
  expect(screen.getByText('An Equestria campaign, act by act')).toBeInTheDocument();
  expect(screen.getByText('levels 1–4')).toBeInTheDocument();
  expect(screen.getByText(/2 parts/i)).toBeInTheDocument();
  expect(screen.getByText('mature')).toBeInTheDocument();

  // Play order: member 1 has an authored label, member 2 does not.
  expect(screen.getByText('Act I — The Stranger in Ponyville')).toBeInTheDocument();
  expect(screen.getByText('act1')).toBeInTheDocument();
  expect(screen.getByText('Part 2')).toBeInTheDocument();
});

it('the hero "Begin with" CTA and each part row deep-link to /modules?adventure=<ref>', async () => {
  mockGetCatalog.mockResolvedValue(catalogResponse([SERIES_ITEM]));
  renderDetail();
  await screen.findByRole('heading', { level: 2, name: 'Tales of the Oppressed' });

  const beginLink = screen.getByRole('link', {
    name: /begin with act i.*the stranger in ponyville/i,
  });
  expect(beginLink).toHaveAttribute(
    'href',
    `/modules?adventure=${encodeURIComponent('dnd5e:adventure:mlp-act1-spine')}`,
  );

  const runPart2 = screen.getByRole('link', { name: /run this.*part 2/i });
  expect(runPart2).toHaveAttribute(
    'href',
    `/modules?adventure=${encodeURIComponent('dnd5e:adventure:mlp-act2-canterlot')}`,
  );
});

it('shows the not-found state for a slug with no matching series', async () => {
  mockGetCatalog.mockResolvedValue(catalogResponse([])); // empty — slug 'mlp-toto-campaign' matches nothing
  renderDetail();
  expect(await screen.findByText(/isn.t in the catalog/i)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /back to modules/i })).toHaveAttribute('href', '/modules');
});

it('shows the error state and retries on click', async () => {
  mockGetCatalog
    .mockRejectedValueOnce(new Error('network error'))
    .mockResolvedValue(catalogResponse([SERIES_ITEM]));
  renderDetail();

  const retryBtn = await screen.findByRole('button', { name: /try again/i });
  fireEvent.click(retryBtn);

  await waitFor(() =>
    expect(screen.getByRole('heading', { level: 2, name: 'Tales of the Oppressed' })).toBeInTheDocument(),
  );
  expect(mockGetCatalog).toHaveBeenCalledTimes(2);
});
