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
  bindCharacter: jest.fn(),
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
const mockBind = dnd.bindCharacter as jest.MockedFunction<typeof dnd.bindCharacter>;
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
  mockBind.mockReset().mockResolvedValue({
    campaign_id: 'campaign-old',
    username: 'leon',
    role: 'player',
    character_id: null,
  });
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

it('Begin creates a session with a unique-suffixed channel, verbatim name, and routes to the new session', async () => {
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
  // Begin now lands directly in the new session rather than /dashboard (TAV-PLAY-BEGIN-REDIRECT).
  await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/play/s9'));
});

it('Begin falls back to /dashboard when createSession resolves null (pre-upgrade backend)', async () => {
  mockCreate.mockResolvedValue(null);
  await openForm();
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /^begin$/i }));
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
    expect(groups.length).toBe(4); // DM · spellcasting · visibility · content rating
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
  // Iro CRITICAL-2 regression guard: a lone FREE character still auto-binds
  // silently — no picker shown (that's reserved for a lone in-use character
  // or 2+ characters).
  expect(screen.queryByRole('radiogroup', { name: /your character/i })).not.toBeInTheDocument();
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /^begin$/i }));
  });
  await waitFor(() => {
    const call = mockCreate.mock.calls[0][0] as SessionStartRequest;
    expect(call['character_id']).toBe(10);
  });
});

it('Begin with multiple characters shows a picker radiogroup', async () => {
  mockListChars.mockResolvedValue([CHAR_A, CHAR_B]);
  await openForm();
  await waitFor(() =>
    expect(screen.getByRole('radiogroup', { name: /your character/i })).toBeInTheDocument(),
  );
  expect(screen.getByRole('radio', { name: /aria/i })).toBeInTheDocument();
  expect(screen.getByRole('radio', { name: /brax/i })).toBeInTheDocument();
  expect(screen.getByRole('radio', { name: /no character/i })).toBeInTheDocument();
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
  // Pick and click in separate acts: first commits setSelectedCharId(11),
  // second calls handleBegin which reads the committed selectedCharId.
  await act(async () => {
    fireEvent.click(screen.getByRole('radio', { name: /brax/i }));
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
    expect(screen.getByRole('radiogroup', { name: /your character/i })).toBeInTheDocument(),
  );
  // Explicitly pick "No character" (DM only).
  fireEvent.click(screen.getByRole('radio', { name: /no character/i }));
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /^begin$/i }));
  });
  await waitFor(() => {
    const call = mockCreate.mock.calls[0][0] as SessionStartRequest;
    expect(call['character_id']).toBeUndefined();
  });
});

// ── ONE-CHAR-ONE-CAMPAIGN-UX: in-use picker + release-confirm (design §5 test 9) ──

const CHAR_BUSY: Character = {
  character_id: '12',
  username: 'leon',
  name: 'Cael',
  race: 'Elf',
  char_class: 'Wizard',
  level: 4,
  hp: { current: 20, max: 20 },
  ac: 12,
  in_use: true,
  active_campaign_id: 'campaign-old',
  active_campaign_name: 'The Shadowfell Keep',
  active_campaign_status: 'active',
};

const CHAR_ENDED: Character = {
  character_id: '13',
  username: 'leon',
  name: 'Doran',
  race: 'Dwarf',
  char_class: 'Barbarian',
  level: 5,
  hp: { current: 40, max: 40 },
  ac: 15,
  in_use: true,
  active_campaign_id: 'campaign-ended',
  active_campaign_name: 'The Sunken Chapel',
  active_campaign_status: 'ended',
};

describe('ONE-CHAR-ONE-CAMPAIGN-UX picker', () => {
  it('renders an in-use badge naming the character\'s current table', async () => {
    mockListChars.mockResolvedValue([CHAR_A, CHAR_BUSY]);
    await openForm();
    await screen.findByRole('radiogroup', { name: /your character/i });
    expect(screen.getByText(/in the shadowfell keep/i)).toBeInTheDocument();
    expect(screen.getByText(/^free$/i)).toBeInTheDocument();
  });

  it('a char with in_use undefined degrades gracefully and is treated as free', async () => {
    mockListChars.mockResolvedValue([CHAR_A, CHAR_B]);
    await openForm();
    await screen.findByRole('radiogroup', { name: /your character/i });
    // Both CHAR_A and CHAR_B have no in_use field at all (pre-upgrade shape).
    expect(screen.getAllByText(/^free$/i)).toHaveLength(2);
    expect(screen.queryByText(/in use|ended/i)).not.toBeInTheDocument();
  });

  it('selecting an in-use card opens the release-confirm dialog', async () => {
    mockListChars.mockResolvedValue([CHAR_A, CHAR_BUSY]);
    await openForm();
    await screen.findByRole('radiogroup', { name: /your character/i });
    fireEvent.click(screen.getByRole('radio', { name: /cael/i }));
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByText(/shadowfell keep/i, { selector: 'strong' })).toBeInTheDocument();
  });

  it('Cancel on the release-confirm aborts — no bind, no createSession', async () => {
    mockListChars.mockResolvedValue([CHAR_A, CHAR_BUSY]);
    await openForm();
    await screen.findByRole('radiogroup', { name: /your character/i });
    fireEvent.click(screen.getByRole('radio', { name: /cael/i }));
    await screen.findByRole('alertdialog');
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    // Cael must still show as unselected (aborted, not armed).
    expect(screen.getByRole('radio', { name: /cael/i })).toHaveAttribute('aria-checked', 'false');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^begin$/i }));
    });
    await waitFor(() => expect(mockCreate).toHaveBeenCalled());
    expect(mockBind).not.toHaveBeenCalled();
  });

  it('Confirm on the release-confirm arms the pick; Begin releases then creates the session', async () => {
    mockListChars.mockResolvedValue([CHAR_A, CHAR_BUSY]);
    await openForm();
    await screen.findByRole('radiogroup', { name: /your character/i });
    fireEvent.click(screen.getByRole('radio', { name: /cael/i }));
    await screen.findByRole('alertdialog');
    fireEvent.click(screen.getByRole('button', { name: /release & bring here/i }));
    await waitFor(() =>
      expect(screen.getByRole('radio', { name: /cael/i })).toHaveAttribute('aria-checked', 'true'),
    );
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^begin$/i }));
    });
    // Release fires before createSession, and the /play/<id> redirect (TAV-PLAY-BEGIN-REDIRECT)
    // still fires afterward.
    await waitFor(() => expect(mockCreate).toHaveBeenCalled());
    expect(mockBind).toHaveBeenCalledWith('campaign-old', { username: 'leon', character_id: null });
    expect(mockBind.mock.invocationCallOrder[0]).toBeLessThan(mockCreate.mock.invocationCallOrder[0]);
    const call = mockCreate.mock.calls[0][0] as SessionStartRequest;
    expect(call['character_id']).toBe(12);
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/play/s9'));
  });

  it('a free character begins with no release call', async () => {
    mockListChars.mockResolvedValue([CHAR_A, CHAR_BUSY]);
    await openForm();
    await screen.findByRole('radiogroup', { name: /your character/i });
    // Default selection lands on the first FREE character (Aria) — Begin without touching the picker.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^begin$/i }));
    });
    await waitFor(() => expect(mockCreate).toHaveBeenCalled());
    expect(mockBind).not.toHaveBeenCalled();
    const call = mockCreate.mock.calls[0][0] as SessionStartRequest;
    expect(call['character_id']).toBe(10);
  });
});

// ── Iro CRITICAL-1: arrow traversal must not open the release-confirm ───────

describe('Iro CRITICAL-1: arrow-key traversal vs explicit activation', () => {
  it('ArrowDown onto an in-use card moves focus only — no alertdialog; a click on it still commits', async () => {
    mockListChars.mockResolvedValue([CHAR_A, CHAR_BUSY]);
    await openForm();
    await screen.findByRole('radiogroup', { name: /your character/i });
    const aria = screen.getByRole('radio', { name: /aria/i });
    aria.focus();
    // Arrow onto Cael (in-use) — must move roving-tabindex focus ONLY.
    fireEvent.keyDown(aria, { key: 'ArrowDown' });
    const cael = screen.getByRole('radio', { name: /cael/i });
    expect(cael).toHaveFocus();
    expect(cael).toHaveAttribute('tabindex', '0');
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    // Aria must still show as selected (aria-checked) — arrowing never re-committed it.
    expect(aria).toHaveAttribute('aria-checked', 'true');

    // Enter/Space on a real <button> fires a native click; fireEvent.click stands
    // in for that here since jsdom doesn't run default browser key-activation for
    // fireEvent.keyDown. Either way it's the same onClick={activate} path.
    fireEvent.click(cael);
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
  });

  it('ArrowUp wraps focus back to the last option without activating anything', async () => {
    mockListChars.mockResolvedValue([CHAR_A, CHAR_BUSY]);
    await openForm();
    await screen.findByRole('radiogroup', { name: /your character/i });
    // "No character" is the first option (index 0). Click (not a bare DOM
    // .focus() call) to land there — this also commits the roving-tabindex
    // sync via the click's onFocus/effect path — then ArrowUp wraps to the
    // last option (Cael, the in-use card).
    const none = screen.getByRole('radio', { name: /no character/i });
    fireEvent.click(none);
    expect(none).toHaveAttribute('aria-checked', 'true');
    fireEvent.keyDown(none, { key: 'ArrowUp' });
    expect(screen.getByRole('radio', { name: /cael/i })).toHaveFocus();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });
});

// ── Iro CRITICAL-2: a lone in-use character still gets a picker + release path ──

describe('Iro CRITICAL-2: lone in-use character', () => {
  it('renders the picker + in-use badge for a single in-use character, and can be released + moved here', async () => {
    mockListChars.mockResolvedValue([CHAR_BUSY]);
    await openForm();
    await screen.findByRole('radiogroup', { name: /your character/i });
    expect(screen.getByRole('radio', { name: /cael/i })).toBeInTheDocument();
    expect(screen.getByText(/in the shadowfell keep/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('radio', { name: /cael/i }));
    await screen.findByRole('alertdialog');
    fireEvent.click(screen.getByRole('button', { name: /release & bring here/i }));
    await waitFor(() =>
      expect(screen.getByRole('radio', { name: /cael/i })).toHaveAttribute('aria-checked', 'true'),
    );

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^begin$/i }));
    });
    await waitFor(() => expect(mockCreate).toHaveBeenCalled());
    expect(mockBind).toHaveBeenCalledWith('campaign-old', { username: 'leon', character_id: null });
    expect(mockBind.mock.invocationCallOrder[0]).toBeLessThan(mockCreate.mock.invocationCallOrder[0]);
    const call = mockCreate.mock.calls[0][0] as SessionStartRequest;
    expect(call['character_id']).toBe(12);
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/play/s9'));
  });
});

// ── Miko F2: 'ended' badge branch coverage ───────────────────────────────────

describe("Miko F2: characterBadge() 'ended' branch", () => {
  it('an ended-status character renders the exact "Ended" badge text with bad tone', async () => {
    mockListChars.mockResolvedValue([CHAR_A, CHAR_ENDED]);
    await openForm();
    await screen.findByRole('radiogroup', { name: /your character/i });
    const badge = screen.getByText('Ended — release to reuse');
    expect(badge).toBeInTheDocument();
    // Pill's 'bad' tone maps fg to var(--bad-ink) (Pill.tsx TONE_MAP) — asserting
    // this confirms characterBadge() returned tone:'bad', not 'warn'/'good'.
    expect(badge).toHaveStyle({ color: 'var(--bad-ink)' });
  });
});

// ── Miko F3: stale character list after a failed create post-release ────────

describe('Miko F3: local state reconciliation after release-succeeded/create-failed', () => {
  it('clears the released character\'s in-use state locally when createSession fails', async () => {
    mockListChars.mockResolvedValue([CHAR_A, CHAR_BUSY]);
    mockCreate.mockRejectedValue(new Error('engine unavailable'));
    await openForm();
    await screen.findByRole('radiogroup', { name: /your character/i });

    fireEvent.click(screen.getByRole('radio', { name: /cael/i }));
    await screen.findByRole('alertdialog');
    fireEvent.click(screen.getByRole('button', { name: /release & bring here/i }));
    await waitFor(() =>
      expect(screen.getByRole('radio', { name: /cael/i })).toHaveAttribute('aria-checked', 'true'),
    );

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^begin$/i }));
    });
    await waitFor(() => expect(mockBind).toHaveBeenCalled());
    // The failure toast still fires (existing behavior, unchanged).
    expect(await screen.findByText(/could not start the table/i)).toBeInTheDocument();
    // Cael's badge must now read Free — not the stale "In The Shadowfell Keep" —
    // since the release actually succeeded server-side before create failed.
    await waitFor(() => expect(screen.getAllByText(/^free$/i).length).toBeGreaterThan(0));
    expect(screen.queryByText(/in the shadowfell keep/i)).not.toBeInTheDocument();
  });
});
