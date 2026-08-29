/**
 * TAV-WIZARD-429-HANG (P1, overnight 2026-08-29) — fix pins.
 *
 * A rate-limiter 429 during wizard boot (directly on the catalog endpoints, or
 * on the /api/auth/refresh retry the catalog's 401 triggers) or during a step
 * advance (the caster path's silent create) must render a real error surface
 * with a retry affordance — never an infinite skeleton, and never an alert
 * whose copy blames the player's connection/choices for a limiter refusal.
 *
 * OLD behavior pinned away:
 *   - boot 429 → generic catalog-error card ("Check your connection…")
 *   - silent-create 429 → generic "Check your choices and try again" alert
 * NEW behavior pinned here:
 *   - boot 429 → rate-limited card ("Hold on a moment." / "Too many requests…")
 *     with a working Try again that recovers once the limiter cools
 *   - silent-create 429 → alert says the choices are fine and to retry;
 *     Continue stays enabled (the retry affordance)
 *
 * Unlike character-new.test.tsx (which mocks useCatalog wholesale), these
 * tests run the REAL useCatalog + REAL AuthProvider + REAL apiFetch, mocking
 * only global.fetch — the 429 is mocked at the network seam (never by
 * exhausting the real limiter), so the full classification chain
 * (client.ts -> useCatalog -> page branches) is exercised.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

const mockReplace = jest.fn();
const mockPush = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace, push: mockPush }),
}));

// The wizard's live Suzu commentary (ST-053) streams via streamNarration on
// mount. Mock it to an empty stream so tests don't hit the real network.
jest.mock('../../lib/stream', () => ({
  streamNarration: jest.fn(async function* () {
    /* no chunks → deterministic fallback line */
  }),
}));

import { AuthProvider } from '../../lib/auth/AuthProvider';
import { ThemeProvider } from '../../lib/theme/ThemeProvider';
import { ToastProvider } from '../../components/Toast';
import CharacterNewPage from '../../app/character/new/page';
import type { User } from '../../lib/api/types';

const ALICE: User = { id: 1, username: 'alice', email: null };

// jsdom exposes no global fetch — apiFetch only touches .ok/.status/.json(),
// so a minimal shape is enough (and avoids depending on a Response polyfill).
type FetchResponseLike = { ok: boolean; status: number; json: () => Promise<unknown> };
const json = (status: number, body: unknown): FetchResponseLike => ({
  ok: status >= 200 && status < 300,
  status,
  json: () => Promise.resolve(body),
});

const RATE_LIMITED_BODY = { error: 'rate_limited', retry_after: 30 };

// Real catalog wire shapes (CatalogItem), envelope-wrapped the way the BFF
// answers — exercised through catalogItemToRace/Class/Background for real.
const CATALOG_ITEMS: Record<string, unknown[]> = {
  race: [
    {
      slug: 'human',
      name: 'Human',
      content_type: 'race',
      source_type: 'srd',
      data: { ability_bonus: { strength: 1 }, speed: 30, subraces: {} },
    },
  ],
  class: [
    {
      // A CASTER class — the silent create fires on Equipment -> Spells.
      slug: 'wizard',
      name: 'Wizard',
      content_type: 'class',
      source_type: 'srd',
      data: {
        hit_die: 6,
        saving_throws: ['intelligence', 'wisdom'],
        primary_ability: ['intelligence'],
        spellcasting_ability: 'intelligence',
      },
    },
  ],
  background: [
    {
      slug: 'acolyte',
      name: 'Acolyte',
      content_type: 'background',
      source_type: 'srd',
      data: { skills: ['insight', 'religion'] },
    },
  ],
};

const catalogOk = (url: string): FetchResponseLike => {
  const type = /[?&]type=([a-z]+)/.exec(url)?.[1] ?? '';
  const items = CATALOG_ITEMS[type] ?? [];
  return json(200, {
    success: true,
    data: { items, total: items.length, limit: 50, offset: 0, content_type: type },
  });
};

const EMPTY_EQUIPMENT_OK = json(200, {
  success: true,
  data: {
    class: 'Wizard',
    background: 'Acolyte',
    class_package: { fixed: [], choices: [] },
    background_package: { fixed: [], choices: [] },
  },
});

/** Route-aware fetch mock. Handlers receive the URL (catalog needs the
 *  `type` param). Unmatched paths reject loudly so a new network dependency
 *  in the wizard breaks the test instead of silently passing. Routes are
 *  matched in order and can be swapped mid-test via the returned setter. */
function mockFetchRoutes(initial: Array<[RegExp, (url: string) => FetchResponseLike]>) {
  let routes = initial;
  const impl = jest.fn((input: RequestInfo | URL) => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
    for (const [re, make] of routes) {
      if (re.test(url)) return Promise.resolve(make(url));
    }
    return Promise.reject(new Error(`unmocked fetch: ${url}`));
  });
  (global as { fetch?: unknown }).fetch = impl;
  return {
    impl,
    setRoutes(next: Array<[RegExp, (url: string) => FetchResponseLike]>) {
      routes = next;
    },
  };
}

function renderWizard(user: User | null = ALICE, maybeAuthed = false) {
  return render(
    <ThemeProvider>
      <ToastProvider>
        <AuthProvider initialUser={user} initialMaybeAuthed={maybeAuthed}>
          <CharacterNewPage />
        </AuthProvider>
      </ToastProvider>
    </ThemeProvider>,
  );
}

afterEach(() => {
  delete (global as { fetch?: unknown }).fetch;
  jest.restoreAllMocks();
});

describe('TAV-WIZARD-429-HANG — limiter 429 during wizard boot', () => {
  it('catalog endpoints answer 429 directly → rate-limited surface, and Try again recovers once the limiter cools', async () => {
    const fetchMock = mockFetchRoutes([
      [/\/api\/dnd\/catalog/, () => json(429, RATE_LIMITED_BODY)],
    ]);
    renderWizard();

    // NEW: the rate-limited card — names the limiter, not the connection.
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/hold on a moment/i);
    expect(alert).toHaveTextContent(/too many requests/i);
    // OLD (pinned away): 'error'-card copy blaming the connection.
    expect(alert).not.toHaveTextContent(/check your connection/i);

    // Retry affordance exists, is focused (a11y parity with the error card)…
    const retry = screen.getByRole('button', { name: /try again/i });
    await waitFor(() => expect(retry).toHaveFocus());

    // …and actually recovers: limiter cools, retry → the wizard renders.
    fetchMock.setRoutes([[/\/api\/dnd\/catalog/, catalogOk]]);
    fireEvent.click(retry);
    expect(
      await screen.findByText(/who, broadly speaking, are you\?/i),
    ).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /human/i })).toBeInTheDocument();
  });

  it('catalog 401 → the silent refresh retry answers 429 → same rate-limited surface (refresh_unavailable path)', async () => {
    mockFetchRoutes([
      [/\/api\/auth\/refresh/, () => json(429, RATE_LIMITED_BODY)],
      [/\/api\/dnd\/catalog/, () => json(401, { success: false, error: 'unauthorized' })],
    ]);
    renderWizard();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/too many requests/i);
    expect(alert).not.toHaveTextContent(/check your connection/i);
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });

  it('boot in maybeAuthed with the refresh limiter tripped → rate-limited re-auth prompt with retry (never a skeleton)', async () => {
    mockFetchRoutes([[/\/api\/auth\/refresh/, () => json(429, RATE_LIMITED_BODY)]]);
    renderWizard(null, true);

    // SessionExpired's rate_limited variant (via useAuthGate) — a real
    // surface with a retry CTA, not the loading skeleton.
    expect(await screen.findByText(/hold on a moment/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});

describe('TAV-WIZARD-429-HANG — limiter 429 during step advance (silent create)', () => {
  it('Equipment → Spells silent create answers 429 → alert names the limiter (not the choices) and Continue stays enabled', async () => {
    mockFetchRoutes([
      [/\/api\/dnd\/catalog/, catalogOk],
      [/\/api\/dnd\/starting-equipment/, () => EMPTY_EQUIPMENT_OK],
      [/\/api\/dnd\/characters$/, () => json(429, RATE_LIMITED_BODY)],
    ]);
    renderWizard();

    // Walk: Race → Class → Abilities → Background → Equipment.
    fireEvent.click(await screen.findByRole('radio', { name: /human/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.click(screen.getByRole('radio', { name: /wizard/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // abilities: defaults ok
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Velka' } });
    fireEvent.click(screen.getByRole('radio', { name: /acolyte/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' })); // -> Equipment

    // Equipment fetch resolves (empty packages) → Continue enabled → the
    // caster path's silent create fires on this click and 429s.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    const alert = await screen.findByRole('alert');
    // NEW: limiter-aware copy — the player's picks are not to blame.
    expect(alert).toHaveTextContent(/too many requests/i);
    expect(alert).toHaveTextContent(/your choices are fine/i);
    // OLD (pinned away): generic "Check your choices and try again" line.
    expect(alert).not.toHaveTextContent(/check your choices/i);

    // Retry affordance: still on Equipment, Continue re-enabled.
    expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled();
    expect(screen.getByText(/what did you bring\?/i)).toBeInTheDocument();
  });
});
