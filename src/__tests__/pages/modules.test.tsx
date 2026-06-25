/**
 * Tests for src/app/modules/page.tsx — the way-to-start (Option B).
 *
 * ADV-9: The module list is now data-driven (getCatalog). Tests cover:
 *   - Loading / empty / error / retry states
 *   - Adventure cards rendered from catalog response
 *   - createSession called with adventure_ref = public_id (not hardcoded id)
 *   - content_rating SFW interlock still intact
 *   - Character binding still works
 *   - No hardcoded MODULES content in the rendered output
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';

const mockPush = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn() }),
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
  createSession: jest.fn(),
  listMyCharacters: jest.fn(),
  getCatalog: jest.fn(),
}));

import * as dnd from '../../lib/api/dnd';
import { AuthProvider } from '../../lib/auth/AuthProvider';
import { ThemeProvider } from '../../lib/theme/ThemeProvider';
import { ToastProvider } from '../../components/Toast';
import ModulesPage from '../../app/modules/page';
import type { Character, Session, SessionStartRequest, User } from '../../lib/api/types';

const mockCreate = dnd.createSession as jest.MockedFunction<typeof dnd.createSession>;
const mockListChars = dnd.listMyCharacters as jest.MockedFunction<typeof dnd.listMyCharacters>;
const mockGetCatalog = dnd.getCatalog as jest.MockedFunction<typeof dnd.getCatalog>;
const LEON: User = { id: 1, username: 'leon', email: null };

const CHAR_A: Character = {
  character_id: '10',
  username: 'leon',
  name: 'Aria',
  race: 'Human',
  char_class: 'Fighter',
  level: 3,
  hp: { current: 28, max: 28 },
  ac: 16,
};
const CHAR_B: Character = {
  character_id: '11',
  username: 'leon',
  name: 'Brax',
  race: 'Dwarf',
  char_class: 'Cleric',
  level: 2,
  hp: { current: 18, max: 18 },
  ac: 14,
};

/** A catalog response with one seeded adventure (the Hollow Tide Cave). */
const HOLLOW_TIDE_CATALOG = {
  system: 'dnd5e',
  content_type: 'adventure',
  items: [
    {
      public_id: 'dnd5e:adventure:hollow-tide-cave',
      name: 'The Hollow Tide Cave',
      summary: {
        subtitle: 'A coastal cave, a missing crew, and goblins in the dark.',
        level_range: { min: 1, max: 2 },
        length: 'one_session',
        content_rating: 'sfw',
        tags: ['coastal', 'dungeon', 'low-level', 'goblins'],
      },
    },
  ],
  total: 1,
  limit: 50,
  offset: 0,
};

/** A catalog response with two adventures (tests data-driven expansion). */
const TWO_ADVENTURE_CATALOG = {
  ...HOLLOW_TIDE_CATALOG,
  items: [
    ...HOLLOW_TIDE_CATALOG.items,
    {
      public_id: 'dnd5e:adventure:goblin-warrens',
      name: 'The Goblin Warrens',
      summary: {
        subtitle: 'Deep tunnels, ancient grudges.',
        level_range: { min: 2, max: 4 },
        length: 'short',
        content_rating: 'sfw',
        tags: ['dungeon'],
      },
    },
  ],
  total: 2,
};

function renderModules() {
  return render(
    <ToastProvider>
      <ThemeProvider><AuthProvider initialUser={LEON} initialMaybeAuthed={false}>
        <ModulesPage />
      </AuthProvider></ThemeProvider>
    </ToastProvider>,
  );
}

beforeEach(() => {
  mockPush.mockClear();
  mockCreate.mockReset().mockResolvedValue({ session_id: 's9', channel: 'x' } as Session);
  mockListChars.mockReset().mockResolvedValue([]);
  // Default: catalog returns the seeded Hollow Tide adventure.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mockGetCatalog.mockReset().mockResolvedValue(HOLLOW_TIDE_CATALOG as any);
});

// ── Catalog loading / empty / error / retry ──────────────────────────────────

it('shows a loading skeleton while the catalog is fetching', () => {
  // Hold the catalog response in limbo to capture the loading state.
  mockGetCatalog.mockReturnValue(new Promise(() => {}));
  renderModules();
  // PageSkeleton has aria-busy="true" (internal); the shell heading still renders.
  expect(screen.getByRole('heading', { level: 1, name: /start a campaign/i })).toBeInTheDocument();
  // Module cards must NOT be present while loading.
  expect(screen.queryByRole('button', { name: /run this/i })).not.toBeInTheDocument();
});

it('shows the adventure grid after a successful catalog fetch', async () => {
  renderModules();
  expect(await screen.findByRole('heading', { level: 2, name: /hollow tide/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /run this/i })).toBeInTheDocument();
  // Level range pill
  expect(screen.getByText(/levels 1/i)).toBeInTheDocument();
  // Subtitle
  expect(screen.getByText(/coastal cave/i)).toBeInTheDocument();
});

it('shows the empty state when the catalog returns no adventures', async () => {
  mockGetCatalog.mockResolvedValue({ ...HOLLOW_TIDE_CATALOG, items: [], total: 0 } as ReturnType<typeof dnd.getCatalog> extends Promise<infer T> ? T : never);
  renderModules();
  expect(await screen.findByText(/no modules available yet/i)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /run this/i })).not.toBeInTheDocument();
});

it('shows the error state and retry button when the catalog fetch fails', async () => {
  mockGetCatalog.mockRejectedValue(new Error('network error'));
  renderModules();
  // Match loosely — the apostrophe in "can't" is a curved Unicode right single quote
  // (’) from &rsquo; in JSX, not a straight apostrophe.
  expect(await screen.findByText(/reach the adventure catalog/i)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
});

it('retry re-fetches the catalog and shows the grid on success', async () => {
  // First call fails; second succeeds.
  mockGetCatalog
    .mockRejectedValueOnce(new Error('timeout'))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .mockResolvedValue(HOLLOW_TIDE_CATALOG as any);

  renderModules();
  // Wait for error state.
  const retryBtn = await screen.findByRole('button', { name: /try again/i });
  await act(async () => {
    fireEvent.click(retryBtn);
  });
  // After retry, the adventure grid should render.
  expect(await screen.findByRole('heading', { level: 2, name: /hollow tide/i })).toBeInTheDocument();
  expect(mockGetCatalog).toHaveBeenCalledTimes(2);
});

it('a second adventure in the catalog renders without any Tavern change', async () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mockGetCatalog.mockResolvedValue(TWO_ADVENTURE_CATALOG as any);
  renderModules();
  expect(await screen.findByRole('heading', { level: 2, name: /hollow tide/i })).toBeInTheDocument();
  expect(screen.getByRole('heading', { level: 2, name: /goblin warrens/i })).toBeInTheDocument();
  expect(screen.getAllByRole('button', { name: /run this/i })).toHaveLength(2);
});

// ── getCatalog called with correct args ──────────────────────────────────────

it('getCatalog is called with system=dnd5e and type=adventure', async () => {
  renderModules();
  await screen.findByRole('button', { name: /run this/i });
  expect(mockGetCatalog).toHaveBeenCalledWith('dnd5e', { type: 'adventure' }, expect.anything());
});

// ── Module pick → StarterForm ─────────────────────────────────────────────────

async function openForm() {
  renderModules();
  // Wait for catalog to load and the "Run this" button to appear.
  const runBtn = await screen.findByRole('button', { name: /run this/i });
  fireEvent.click(runBtn);
}

it('opens the starter form when a module is chosen', async () => {
  await openForm();
  expect(screen.getByRole('heading', { name: /set the table/i })).toBeInTheDocument();
  expect(screen.getByText(/table name/i)).toBeInTheDocument();
});

// ── adventure_ref passed to createSession (the key ADV-9 AC) ─────────────────

it('Begin sends adventure_ref = public_id from the catalog item', async () => {
  await openForm();
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /^begin$/i }));
  });
  await waitFor(() => {
    const call = mockCreate.mock.calls[0][0] as SessionStartRequest;
    expect(call['adventure_ref']).toBe('dnd5e:adventure:hollow-tide-cave');
  });
});

it('Begin creates a session with a unique-suffixed channel, verbatim name, and routes to the dashboard', async () => {
  await openForm();
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /^begin$/i }));
  });
  // Default selection: Suzu DMs (ai) + private + sfw
  await waitFor(() => {
    const call = mockCreate.mock.calls[0][0] as SessionStartRequest;
    // channel is now unique-suffixed: base slug + hyphen + 4 random [a-z0-9] chars
    expect(call['channel']).toMatch(/^the_hollow_tide_cave-[a-z0-9]{4}$/);
    // name is the verbatim human form value
    expect(call['name']).toBe('The Hollow Tide Cave');
    expect(call['username']).toBe('leon');
    expect(call['dm_mode']).toBe('ai');
    expect(call['ai_assist_level']).toBe('full');
    expect(call['visibility']).toBe('private');
    expect(call['content_rating']).toBe('sfw');
    expect(call['adventure_ref']).toBe('dnd5e:adventure:hollow-tide-cave');
  });
  await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/dashboard'));
});

it('modules create sends both name (verbatim) and a unique channel to createSession', async () => {
  await openForm();
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /^begin$/i }));
  });
  await waitFor(() => {
    const call = mockCreate.mock.calls[0][0] as SessionStartRequest;
    // name is the verbatim human label from the form field
    expect(call['name']).toBe('The Hollow Tide Cave');
    // channel has the unique suffix — base slug + hyphen + 4 chars
    expect(call['channel']).toMatch(/^the_hollow_tide_cave-[a-z0-9]{4}$/);
    // name and channel are different (name is not slugified)
    expect(call['name']).not.toBe(call['channel']);
  });
});

// Regression: confirm no test asserts old hardcoded module content outside of
// dynamic catalog rendering — the MODULES constant is gone; the name only
// appears because the catalog returns it.

it('module_id is NOT sent to createSession (engine owns adventure link now)', async () => {
  await openForm();
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /^begin$/i }));
  });
  await waitFor(() => {
    const call = mockCreate.mock.calls[0][0] as SessionStartRequest;
    // module_id was a localStorage annotation; it's gone; adventure_ref is the replacement.
    expect((call as unknown as Record<string, unknown>)['module_id']).toBeUndefined();
  });
});

// ── RadioGroup keyboard navigation ────────────────────────────────────────────

describe('RadioGroup keyboard navigation (S3.4)', () => {
  it('groups are radiogroups with roving tabindex (checked=0, others=-1)', async () => {
    await openForm();
    const groups = screen.getAllByRole('radiogroup');
    expect(groups.length).toBe(3); // DM · visibility · content rating
    const ai = screen.getByRole('radio', { name: /suzu dms/i });
    const solo = screen.getByRole('radio', { name: /solo/i });
    expect(ai).toHaveAttribute('tabindex', '0');
    expect(solo).toHaveAttribute('tabindex', '-1');
  });

  it('ArrowDown moves the selection within a radiogroup', async () => {
    await openForm();
    const ai = screen.getByRole('radio', { name: /suzu dms/i });
    fireEvent.keyDown(ai, { key: 'ArrowDown' });
    // S5.5: "Human DM" is now the second option (between Suzu DMs and Solo).
    expect(screen.getByRole('radio', { name: /human dm/i })).toHaveAttribute('aria-checked', 'true');
  });

  it('Arrow navigation skips a disabled option (Mature when Public)', async () => {
    await openForm();
    fireEvent.click(screen.getByRole('radio', { name: /^public/i }));
    const sfw = screen.getByRole('radio', { name: /safe for stream/i });
    fireEvent.keyDown(sfw, { key: 'ArrowDown' });
    expect(screen.getByRole('radio', { name: /mature/i })).toHaveAttribute('aria-checked', 'false');
  });
});

// ── content_rating SFW interlock ──────────────────────────────────────────────

describe('content_rating SFW interlock', () => {
  it('allows Mature on a private table (default)', async () => {
    await openForm();
    expect(screen.getByRole('radio', { name: /mature/i })).not.toBeDisabled();
  });

  it('forces SFW + disables Mature when the table is Public', async () => {
    await openForm();
    fireEvent.click(screen.getByRole('radio', { name: /^public/i }));
    const mature = screen.getByRole('radio', { name: /mature/i });
    expect(mature).toBeDisabled();
    expect(screen.getByRole('radio', { name: /safe for stream/i })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByText(/always safe-for-stream/i)).toBeInTheDocument();
  });

  it('resets a Mature selection back to SFW when switching to Public', async () => {
    await openForm();
    fireEvent.click(screen.getByRole('radio', { name: /mature/i }));
    expect(screen.getByRole('radio', { name: /mature/i })).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByRole('radio', { name: /^public/i }));
    expect(screen.getByRole('radio', { name: /safe for stream/i })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });
});

// ── DM mode axes ─────────────────────────────────────────────────────────────

it('Begin with Suzu DMs selection sends dm_mode:ai + ai_assist_level:full', async () => {
  await openForm();
  fireEvent.click(screen.getByRole('radio', { name: /suzu dms/i }));
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /^begin$/i }));
  });
  await waitFor(() => {
    const call = mockCreate.mock.calls[0][0] as SessionStartRequest;
    expect(call['dm_mode']).toBe('ai');
    expect(call['ai_assist_level']).toBe('full');
  });
});

it('Begin with Solo selection sends dm_mode:human + ai_assist_level:off', async () => {
  await openForm();
  fireEvent.click(screen.getByRole('radio', { name: /solo/i }));
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /^begin$/i }));
  });
  await waitFor(() => {
    const call = mockCreate.mock.calls[0][0] as SessionStartRequest;
    expect(call['dm_mode']).toBe('human');
    expect(call['ai_assist_level']).toBe('off');
  });
});

it('Begin sends the visibility and effective content_rating axes', async () => {
  await openForm();
  fireEvent.click(screen.getByRole('radio', { name: /^unlisted/i }));
  fireEvent.click(screen.getByRole('radio', { name: /mature/i }));
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /^begin$/i }));
  });
  await waitFor(() => {
    const call = mockCreate.mock.calls[0][0] as SessionStartRequest;
    expect(call['visibility']).toBe('unlisted');
    expect(call['content_rating']).toBe('mature');
  });
});

it('Begin on a public table always sends content_rating:sfw regardless of prior selection', async () => {
  await openForm();
  fireEvent.click(screen.getByRole('radio', { name: /^unlisted/i }));
  fireEvent.click(screen.getByRole('radio', { name: /mature/i }));
  fireEvent.click(screen.getByRole('radio', { name: /^public/i }));
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /^begin$/i }));
  });
  await waitFor(() => {
    const call = mockCreate.mock.calls[0][0] as SessionStartRequest;
    expect(call['visibility']).toBe('public');
    expect(call['content_rating']).toBe('sfw');
  });
});

// ── character binding ─────────────────────────────────────────────────────────

it('Begin with no characters sends no character_id', async () => {
  mockListChars.mockResolvedValue([]);
  await openForm();
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /^begin$/i }));
  });
  await waitFor(() => {
    const call = mockCreate.mock.calls[0][0] as SessionStartRequest;
    expect(call['character_id']).toBeUndefined();
  });
});

it('Begin with exactly one character auto-binds it (sends character_id)', async () => {
  // Use a deferred promise so we can resolve it inside act, ensuring React
  // commits setCharacters + setSelectedCharId within a controlled act scope.
  let resolveChars!: (chars: Character[]) => void;
  const charsPromise = new Promise<Character[]>((res) => { resolveChars = res; });
  mockListChars.mockReturnValue(charsPromise);
  await openForm();
  // StarterForm is now mounted but characters haven't loaded yet.
  await act(async () => {
    resolveChars([CHAR_A]); // resolve inside act so state update is committed
    await charsPromise;
  });
  // auto-bind: selectedCharId should now be 10
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /^begin$/i }));
  });
  await waitFor(() => {
    const call = mockCreate.mock.calls[0][0] as SessionStartRequest;
    expect(call['character_id']).toBe(10);
  });
});

it('Begin with multiple characters shows a picker select', async () => {
  mockListChars.mockResolvedValue([CHAR_A, CHAR_B]);
  await openForm();
  await waitFor(() =>
    expect(screen.getByRole('combobox', { name: /your character/i })).toBeInTheDocument(),
  );
});

it('Begin with multiple characters sends the selected character_id', async () => {
  // Use a deferred promise so we can resolve characters inside act.
  let resolveChars!: (chars: Character[]) => void;
  const charsPromise = new Promise<Character[]>((res) => { resolveChars = res; });
  mockListChars.mockReturnValue(charsPromise);
  await openForm();
  // Resolve inside act so setCharacters([CHAR_A, CHAR_B]) is committed.
  await act(async () => {
    resolveChars([CHAR_A, CHAR_B]);
    await charsPromise;
  });
  const combobox = screen.getByRole('combobox', { name: /your character/i });
  // Change and click in separate acts: first commits setSelectedCharId(11),
  // second calls handleBegin which reads the committed selectedCharId.
  await act(async () => {
    fireEvent.change(combobox, { target: { value: '11' } });
  });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /^begin$/i }));
  });
  await waitFor(() => {
    const call = mockCreate.mock.calls[0][0] as SessionStartRequest;
    expect(call['character_id']).toBe(11);
  });
});

it('Begin with multiple characters defaults to the first and sends its character_id', async () => {
  // Regression: the picker used to default to "no character", so creating a table
  // without touching it bound nothing and the engine silently used the first
  // character anyway. It now defaults to the first character (visible + changeable).
  let resolveChars!: (chars: Character[]) => void;
  const charsPromise = new Promise<Character[]>((res) => { resolveChars = res; });
  mockListChars.mockReturnValue(charsPromise);
  await openForm();
  await act(async () => {
    resolveChars([CHAR_A, CHAR_B]);
    await charsPromise;
  });
  // No interaction with the picker — just Begin.
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /^begin$/i }));
  });
  await waitFor(() => {
    const call = mockCreate.mock.calls[0][0] as SessionStartRequest;
    expect(call['character_id']).toBe(10); // CHAR_A — the first character
  });
});

it('Begin with multiple characters and EXPLICIT no-character sends no character_id', async () => {
  mockListChars.mockResolvedValue([CHAR_A, CHAR_B]);
  await openForm();
  await waitFor(() =>
    expect(screen.getByRole('combobox', { name: /your character/i })).toBeInTheDocument(),
  );
  // Explicitly pick "— no character (DM only) —".
  fireEvent.change(screen.getByRole('combobox', { name: /your character/i }), {
    target: { value: '' },
  });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /^begin$/i }));
  });
  await waitFor(() => {
    const call = mockCreate.mock.calls[0][0] as SessionStartRequest;
    expect(call['character_id']).toBeUndefined();
  });
});
