/**
 * Tests for the CODEX_ENABLED route guard on src/app/codex/page.tsx
 * (DDX-21 follow-up) — the DISABLED side.
 *
 * `../../lib/config` is mocked to CODEX_ENABLED=false for this whole file,
 * so every test here exercises the "flag off" path: redirect to /dashboard,
 * no real UI ever reaches the screen.
 *
 * The "flag on" side is covered by codex-flag-guard-enabled.test.tsx (which
 * does NOT mock config — it uses the real module, which resolves
 * CODEX_ENABLED=true under jest) plus, implicitly, every assertion in
 * codex.test.tsx / codex-a11y-fixes.test.tsx / codex-adversarial.test.tsx —
 * all of which already render the full feature against that same real value.
 *
 * (A same-file "mutate the mocked module's property between tests" approach
 * was tried first and does NOT work here: the component reads a snapshotted
 * value at import time, not a live binding, so mutating the mock's property
 * mid-test has no effect on an already-rendered tree. Two fixed-value files
 * side-step that entirely.)
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

jest.mock('../../lib/config', () => ({
  CODEX_ENABLED: false,
  OAUTH_ENABLED: false,
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

describe('CODEX_ENABLED route guard — flag off', () => {
  it('redirects to /dashboard when CODEX_ENABLED is false', async () => {
    renderCodex();

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/dashboard');
    });
  });

  it('renders nothing — no rail, no Codex chrome — while gated', async () => {
    renderCodex();

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/dashboard'));

    // ToastProvider (a wrapper, not CodexPage) always mounts its own empty
    // viewport div — assert on the actual Codex chrome being absent instead
    // of the whole container, which would false-fail on that unrelated node.
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Codex' })).not.toBeInTheDocument();
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
  });

  it('never surfaces catalog data in the DOM while gated', async () => {
    // Rules of Hooks means useCodexCatalog's effects still run (the guard is
    // a render-time `return null`, not a conditional hook) — this documents
    // that trade-off rather than asserting the fetch never fires: nothing it
    // returns ever reaches the screen either way.
    mockGetCatalog.mockResolvedValue({
      system: 'dnd5e',
      content_type: 'spell',
      items: [{
        slug: 'fireball',
        name: 'Fireball',
        content_type: 'spell',
        source_type: 'srd',
        public_id: 'dnd5e:spell:fireball',
        pack_id: 'srd-5e',
        data: { level: 3, school: 'evocation' },
      }] as unknown as Awaited<ReturnType<typeof dnd.getCatalog>>['items'],
      total: 1,
      limit: 500,
      offset: 0,
    });

    renderCodex();

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/dashboard'));
    expect(screen.queryByText('Fireball')).not.toBeInTheDocument();
  });
});
