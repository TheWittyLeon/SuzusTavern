/**
 * Tests for the CODEX_ENABLED route guard on src/app/codex/page.tsx
 * (DDX-21 follow-up) — the ENABLED side.
 *
 * `../../lib/config` is intentionally NOT mocked here — this file uses the
 * real module, which resolves CODEX_ENABLED=true under jest (NODE_ENV=test
 * is not 'production'). Pairs with codex-flag-guard.test.tsx (the mocked
 * "flag off" side) to pin both halves of the guard's contract explicitly.
 */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

const mockPush = jest.fn();
const mockReplace = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
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
import type { User } from '../../lib/api/types';

const mockGetCatalog = dnd.getCatalog as jest.MockedFunction<typeof dnd.getCatalog>;
const mockGetCatalogCounts = dnd.getCatalogCounts as jest.MockedFunction<typeof dnd.getCatalogCounts>;

const LEON: User = { id: 1, username: 'leon', email: null };

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
  mockPush.mockReset();
  mockReplace.mockReset();
  mockGetCatalog.mockReset();
  mockGetCatalogCounts.mockReset();
  mockGetCatalog.mockResolvedValue({
    system: 'dnd5e',
    content_type: 'spell',
    items: [],
    total: 0,
    limit: 500,
    offset: 0,
  });
  mockGetCatalogCounts.mockResolvedValue({
    system: 'dnd5e',
    packs: null,
    content_type: null,
    counts: {
      spell: 0, monster: 0, item: 0, race: 0, class: 0, background: 0, condition: 0,
    },
  } as unknown as Awaited<ReturnType<typeof dnd.getCatalogCounts>>);
});

describe('CODEX_ENABLED route guard — flag on (real value under test)', () => {
  it('confirms the jest environment resolves CODEX_ENABLED to true', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { CODEX_ENABLED } = require('../../lib/config') as { CODEX_ENABLED: boolean };
    expect(CODEX_ENABLED).toBe(true);
  });

  it('renders the real Codex chrome and never redirects', async () => {
    renderCodex();

    await waitFor(() => {
      expect(screen.getByRole('tablist', { name: /content type/i })).toBeInTheDocument();
    });
    expect(screen.getByRole('heading', { name: 'Codex' })).toBeInTheDocument();
    expect(mockReplace).not.toHaveBeenCalled();
  });
});
