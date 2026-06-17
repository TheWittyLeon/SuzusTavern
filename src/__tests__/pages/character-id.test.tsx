/**
 * Tests for the interim character landing (src/app/character/[id]/page.tsx).
 *
 * Sprint 6 P0: this is NOT the full sheet (ST-054+). It renders the engine's
 * summary string as a "created" confirmation, and a friendly error state.
 */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

const mockReplace = jest.fn();
const mockPush = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace, push: mockPush }),
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
  getCharacter: jest.fn(),
}));

import * as dnd from '../../lib/api/dnd';
import { AuthProvider } from '../../lib/auth/AuthProvider';
import CharacterPage from '../../app/character/[id]/page';
import type { Character, User } from '../../lib/api/types';

const mockGet = dnd.getCharacter as jest.MockedFunction<typeof dnd.getCharacter>;
const ALICE: User = { id: 1, username: 'alice', email: null };

function renderPage() {
  return render(
    <AuthProvider initialUser={ALICE}>
      <CharacterPage />
    </AuthProvider>,
  );
}

beforeEach(() => {
  mockGet.mockReset();
});

describe('Character landing (interim)', () => {
  it('renders the engine summary as a created-character confirmation', async () => {
    mockGet.mockResolvedValue({
      sheet: 'Velka — Half-Elf Rogue Lv.1 (Charlatan) | HP:7/7 AC:13 Prof:+2 XP:0 | STR:8(-1)',
    } as unknown as Character);

    renderPage();

    expect(await screen.findByText(/Half-Elf Rogue Lv\.1/)).toBeInTheDocument();
    expect(screen.getByText('created')).toBeInTheDocument();
    // Heading is the parsed name.
    expect(screen.getByRole('heading', { level: 1, name: /Velka/ })).toBeInTheDocument();
  });

  it('shows a friendly error when the character cannot be loaded', async () => {
    mockGet.mockRejectedValue(new Error('not found'));
    renderPage();
    await waitFor(() =>
      expect(screen.getByText(/can.?t find that one/i)).toBeInTheDocument(),
    );
  });
});
