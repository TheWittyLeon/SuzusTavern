/**
 * ADV-9 modules page edge tests.
 *
 * Gaps filled vs modules.test.tsx:
 *   1. Catalog item with summary=null → the `?? {}` guard fires; card renders
 *      without crashing; level-range pill is absent (not undefined error).
 *   2. Catalog item with missing public_id but present slug → slug used as
 *      adventure_ref fallback; createSession receives a non-empty adventure_ref.
 *   3. Catalog item with neither public_id nor slug → adventure_ref=''; the
 *      UI does not crash and the card still renders.
 */

import React from 'react';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';

const mockPush = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn() }),
}));

// The auth API is used by AuthProvider internally — stub it to avoid network calls.
jest.mock('../../lib/api/auth', () => ({
  login: jest.fn(),
  verify2FA: jest.fn(),
  logout: jest.fn(),
  refresh: jest.fn(),
  me: jest.fn(),
  register: jest.fn(),
}));

jest.mock('../../lib/api/dnd', () => ({
  createSession: jest.fn(),
  listMyCharacters: jest.fn(),
  getCatalog: jest.fn(),
}));

import * as dnd from '../../lib/api/dnd';
import { AuthProvider } from '../../lib/auth/AuthProvider';
import { ThemeProvider } from '../../lib/theme/ThemeProvider';
import { ToastProvider } from '../../components/Toast';
import ModulesPage from '../../app/modules/page';
import type { Session, User } from '../../lib/api/types';

const mockCreate = dnd.createSession as jest.MockedFunction<typeof dnd.createSession>;
const mockListChars = dnd.listMyCharacters as jest.MockedFunction<typeof dnd.listMyCharacters>;
const mockGetCatalog = dnd.getCatalog as jest.MockedFunction<typeof dnd.getCatalog>;

const LEON: User = { id: 1, username: 'leon', email: null };

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
  mockCreate.mockReset().mockResolvedValue({ session_id: 's9', channel: 'x' } as Session);
  mockListChars.mockReset().mockResolvedValue([]);
  mockGetCatalog.mockReset();
});

// ── null summary field ────────────────────────────────────────────────────────

describe('ADV-9 modules page — null summary guard', () => {
  it('catalog item with summary=null renders the card without crashing', async () => {
    // The engine returns null for the summary JSONB slice when optional data is absent.
    // The page adapter uses `(item['summary'] ?? {})` to guard this.
    mockGetCatalog.mockResolvedValue({
      system: 'dnd5e',
      content_type: 'adventure',
      items: [
        {
          public_id: 'dnd5e:adventure:sparse',
          name: 'Sparse Adventure',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          summary: null as any,
        },
      ],
      total: 1,
      limit: 50,
      offset: 0,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    renderModules();

    // Card must render — null summary must not crash the adapter
    expect(
      await screen.findByRole('heading', { level: 2, name: /sparse adventure/i }),
    ).toBeInTheDocument();

    // Level-range pill must not appear (no data)
    expect(screen.queryByText(/levels/i)).not.toBeInTheDocument();

    // The "Run this" button must still be present
    expect(screen.getByRole('button', { name: /run this/i })).toBeInTheDocument();
  });

  it('catalog item with null summary → createSession receives the public_id as adventure_ref', async () => {
    // Even with a null summary, the adventure_ref comes from the top-level public_id
    // field — the null only affects display.
    mockGetCatalog.mockResolvedValue({
      system: 'dnd5e',
      content_type: 'adventure',
      items: [
        {
          public_id: 'dnd5e:adventure:sparse',
          name: 'Sparse Adventure',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          summary: null as any,
        },
      ],
      total: 1,
      limit: 50,
      offset: 0,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    renderModules();

    const runBtn = await screen.findByRole('button', { name: /run this/i });
    fireEvent.click(runBtn);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^begin$/i }));
    });

    await waitFor(() => {
      const call = mockCreate.mock.calls[0][0] as unknown as Record<string, unknown>;
      expect(call['adventure_ref']).toBe('dnd5e:adventure:sparse');
    });
  });
});

// ── missing public_id → slug fallback ────────────────────────────────────────

describe('ADV-9 modules page — missing public_id fallback', () => {
  it('catalog item with no public_id but slug → slug used as adventure_ref', async () => {
    // The adapter: `public_id: String(item['public_id'] ?? item['slug'] ?? '')`
    // Ensures a non-empty adventure_ref reaches createSession when public_id is absent.
    mockGetCatalog.mockResolvedValue({
      system: 'dnd5e',
      content_type: 'adventure',
      items: [
        {
          // no public_id
          slug: 'hollow-tide-cave',
          name: 'The Hollow Tide Cave',
          summary: {
            subtitle: 'A coastal cave.',
            level_range: { min: 1, max: 2 },
            length: 'one_session',
            content_rating: 'sfw',
            tags: ['coastal'],
          },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
      ],
      total: 1,
      limit: 50,
      offset: 0,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    renderModules();

    const runBtn = await screen.findByRole('button', { name: /run this/i });
    fireEvent.click(runBtn);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^begin$/i }));
    });

    await waitFor(() => {
      const call = mockCreate.mock.calls[0][0] as unknown as Record<string, unknown>;
      // Must not be '' — the slug fallback must fire
      expect(call['adventure_ref']).toBe('hollow-tide-cave');
    });
  });
});

// ── neither public_id nor slug ────────────────────────────────────────────────

describe('ADV-9 modules page — degenerate catalog item', () => {
  it('catalog item with no public_id and no slug → card renders, does not crash', async () => {
    // Degenerate case: both identifiers absent.  The adapter falls through to ''
    // which may produce an empty adventure_ref.  The Tavern must not crash at render.
    mockGetCatalog.mockResolvedValue({
      system: 'dnd5e',
      content_type: 'adventure',
      items: [
        {
          name: 'Mystery Adventure',
          summary: { subtitle: 'A mystery.', length: 'one_session', content_rating: 'sfw' },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
      ],
      total: 1,
      limit: 50,
      offset: 0,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    renderModules();

    // Card must render — no crash at the render stage
    expect(
      await screen.findByRole('heading', { level: 2, name: /mystery adventure/i }),
    ).toBeInTheDocument();

    expect(screen.getByRole('button', { name: /run this/i })).toBeInTheDocument();
  });
});
