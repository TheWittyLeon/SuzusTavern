/**
 * Auth-gate coverage for /character/[id] (UIR2-TAV-3), mounted through the
 * REAL AuthProvider — not a mocked useAuth(). character-id.test.tsx's own
 * `renderPage()` helper hardcodes `initialUser={ALICE}`, so none of its
 * existing tests ever exercise a null-user render; useAuthGate.test.tsx and
 * AuthProvider.autherror.test.tsx prove the hook and the provider each work
 * in isolation, but neither mounts THIS page. That leaves a real gap: this
 * is the exact page named in the TAV-3 bug report as reproducing the
 * "infinite skeleton" symptom (`if (!user) return <skeleton>` with no escape
 * hatch, CharacterPage ~98 pre-diff) — nothing today proves the fix actually
 * lands on the page the bug was filed against, not just in the abstraction.
 */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

const mockReplace = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace, push: jest.fn() }),
  useParams: () => ({ id: 'abc-123' }),
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
  getCharacterSheet: jest.fn(),
  levelUpCharacter: jest.fn(),
  equipItem: jest.fn(),
  unequipItem: jest.fn(),
  giveItem: jest.fn(),
  getCatalog: jest.fn(),
}));

import * as authApi from '../../lib/api/auth';
import * as dnd from '../../lib/api/dnd';
import { AuthProvider } from '../../lib/auth/AuthProvider';
import { ThemeProvider } from '../../lib/theme/ThemeProvider';
import { ToastProvider } from '../../components/Toast';
import CharacterPage from '../../app/character/[id]/page';

const mockRefresh = authApi.refresh as jest.MockedFunction<typeof authApi.refresh>;
const mockMe = authApi.me as jest.MockedFunction<typeof authApi.me>;
const mockGetSheet = dnd.getCharacterSheet as jest.MockedFunction<typeof dnd.getCharacterSheet>;
const mockGetCatalog = dnd.getCatalog as jest.MockedFunction<typeof dnd.getCatalog>;

/** Shapes an Error the way client.ts's makeApiError does — {status, code}. */
function apiError(status: number, message = 'api error') {
  return Object.assign(new Error(message), { status, code: String(status) });
}

function renderWithProvider(initialMaybeAuthed: boolean) {
  return render(
    <ThemeProvider>
      <AuthProvider initialUser={null} initialMaybeAuthed={initialMaybeAuthed}>
        <ToastProvider>
          <CharacterPage />
        </ToastProvider>
      </AuthProvider>
    </ThemeProvider>,
  );
}

beforeEach(() => {
  mockReplace.mockClear();
  mockRefresh.mockReset();
  mockMe.mockReset();
  mockGetSheet.mockReset();
  mockGetCatalog.mockReset();
  mockGetCatalog.mockResolvedValue({
    system: 'dnd5e',
    content_type: 'class',
    items: [],
    total: 0,
    limit: 100,
    offset: 0,
  });
});

describe('CharacterPage — the ORIGINAL infinite-skeleton bug site, real refresh failure', () => {
  it('a failed silent refresh (401) shows SessionExpired, not an eternal skeleton — the exact bug this ticket fixes', async () => {
    mockRefresh.mockRejectedValueOnce(apiError(401));
    renderWithProvider(true);

    // Pre-fix, this page's bespoke `if (!user) return <skeleton>` had no
    // escape hatch and would sit here forever. Post-fix: authError routes to
    // SessionExpired instead.
    expect(
      await screen.findByRole('heading', { name: /your session has ended/i }),
    ).toBeInTheDocument();
    // The skeleton must NOT still be showing once resolved to an error.
    expect(screen.queryByLabelText('Loading character')).not.toBeInTheDocument();
    // Never fetched sheet data for a user that was never confirmed.
    expect(mockGetSheet).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('a 429 silent refresh shows the rate_limited variant with a working retry that recovers the real sheet', async () => {
    mockRefresh.mockRejectedValueOnce(apiError(429));
    renderWithProvider(true);

    const retryButton = await screen.findByRole('button', { name: /try again/i });
    expect(mockGetSheet).not.toHaveBeenCalled();

    mockRefresh.mockResolvedValueOnce({ ok: true });
    mockMe.mockResolvedValueOnce({ user: { id: 1, username: 'alice', email: null } });
    mockGetSheet.mockResolvedValueOnce({
      character_id: 'abc-123',
      owner_username: 'alice',
      name: 'Velka Nightquill',
      race: 'Human',
      subrace: '',
      char_class: 'Rogue',
      subclass: '',
      level: 1,
      background: 'Charlatan',
      alignment: '',
      ability_scores: {
        strength: { score: 9, modifier: -1 },
        dexterity: { score: 16, modifier: 3 },
        constitution: { score: 13, modifier: 1 },
        intelligence: { score: 12, modifier: 1 },
        wisdom: { score: 10, modifier: 0 },
        charisma: { score: 14, modifier: 2 },
      },
      hp: { current: 9, max: 9, temp: 0 },
      ac: 13,
      initiative: 3,
      proficiency_bonus: 2,
      speed: 30,
      xp: 0,
      xp_next: 300,
      hit_dice_remaining: 1,
      proficient_saves: [],
      proficient_skills: [],
      class_features: [],
      conditions: [],
      spellcasting: null,
      spell_slots: {},
      is_spellcaster: false,
      inventory: [],
      inventory_weight: 0,
    });

    retryButton.click();

    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1, name: 'Velka Nightquill' })).toBeInTheDocument(),
    );
    expect(
      screen.queryByRole('heading', { name: /hold on a moment/i }),
    ).not.toBeInTheDocument();
  });

  it('genuine logout (no refresh cookie at all) still redirects to /login — unchanged prior behavior', async () => {
    renderWithProvider(false);

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/login'));
    expect(
      screen.queryByRole('heading', { name: /your session has ended|hold on a moment/i }),
    ).not.toBeInTheDocument();
    expect(mockGetSheet).not.toHaveBeenCalled();
  });
});
