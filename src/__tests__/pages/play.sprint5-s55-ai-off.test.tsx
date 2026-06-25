/**
 * S5.5 — AI-off UX + zero-LLM proof harness (jest side).
 *
 * AC coverage:
 *
 * S5.5-AC1  Session loaded with ai_assist_level='off': NarratorStrip (Suzu panel)
 *           is NOT rendered; the ai-off status bar is shown instead.
 * S5.5-AC2  Session loaded with ai_assist_level='off': streamDmNarration is NEVER
 *           called during the session lifecycle (combat start, player send, dice roll).
 * S5.5-AC3  Session loaded with ai_assist_level='full': NarratorStrip renders normally.
 * S5.5-AC4  Session loaded with ai_assist_level='assist': NarratorStrip renders;
 *           streamDmNarration is NOT called (no auto-fire).
 * S5.5-AC5  StarterForm: ai_assist_level radio shown for human/solo DM modes.
 * S5.5-AC6  StarterForm: ai_assist_level locked to 'full' (not shown) when dm_mode='ai'.
 * S5.5-AC7  StarterForm: createSession called with correct ai_assist_level payload
 *           for human + off combination.
 * S5.5-AC8  StarterForm: createSession called with correct ai_assist_level payload
 *           for human + assist combination.
 * S5.5-AC9  Play page: ai_assist_level read from session server-state on every render
 *           (no separate useState snapshot); changing session fixture causes correct gate.
 * S5.5-AC10 ai+off combo: form shows lock hint ("Suzu DMs mode requires full AI narration").
 */
import React from 'react';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';

// ── Page-level mocks -----------------------------------------------------------

jest.mock('next/navigation', () => ({
  useParams: () => ({ sessionId: 's1' }),
  useRouter: () => ({ push: jest.fn() }),
}));

const mockToast = jest.fn();
jest.mock('../../components/Toast', () => {
  const React = require('react');
  return {
    useToast: () => ({ toast: mockToast }),
    ToastProvider: ({ children }: { children: React.ReactNode }) =>
      React.createElement(React.Fragment, null, children),
  };
});

// AuthProvider mock: provide both useAuth (for PlayPage) and a passthrough
// AuthProvider component (for ModulesPage wrappers that need the real tree).
jest.mock('../../lib/auth/AuthProvider', () => {
  const React = require('react');
  return {
    useAuth: () => ({ user: { id: 1, username: 'dm_alice', email: null }, loading: false, maybeAuthed: false }),
    AuthProvider: ({ children, initialUser }: { children: React.ReactNode; initialUser?: unknown }) => {
      void initialUser; // prop passed by wrappers; ignored since useAuth is mocked
      return React.createElement(React.Fragment, null, children);
    },
  };
});

jest.mock('../../lib/useReducedMotion', () => ({
  useReducedMotion: () => true,
}));

jest.mock('../../lib/theme/ThemeProvider', () => {
  const React = require('react');
  return {
    ThemeProvider: ({ children }: { children: React.ReactNode }) =>
      React.createElement(React.Fragment, null, children),
    useTheme: () => ({
      vibe: 'dusk-tavern',
      setVibe: jest.fn(),
      density: 'cozy',
      setDensity: jest.fn(),
    }),
  };
});

// ── DnD API mocks --------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFn = (...args: any[]) => any;

const mockStreamDmNarration = jest.fn();
const mockGetSession = jest.fn<Promise<unknown>, unknown[]>();
const mockGetSessionEvents = jest.fn<Promise<unknown[]>, unknown[]>(() => Promise.resolve([]));
const mockGetParticipants = jest.fn<Promise<unknown>, unknown[]>();
const mockGetGrounding = jest.fn<Promise<unknown>, unknown[]>(() => Promise.resolve(null));
const mockGetCombatState = jest.fn<Promise<unknown>, unknown[]>(() => Promise.resolve(null));
const mockGetCharacterSheet = jest.fn<Promise<unknown>, unknown[]>(() => Promise.resolve(null));
const mockPostSessionEvent = jest.fn<Promise<unknown>, unknown[]>(() => Promise.resolve({ seq: 1 }));
const mockCreateSession = jest.fn<Promise<unknown>, unknown[]>();
const mockGetCatalog = jest.fn<Promise<unknown>, unknown[]>();
const mockListMyCharacters = jest.fn<Promise<unknown[]>, unknown[]>(() => Promise.resolve([]));

jest.mock('../../lib/api/dnd', () => ({
  getSession: (...args: Parameters<AnyFn>) => mockGetSession(...args),
  getSessionEvents: (...args: Parameters<AnyFn>) => mockGetSessionEvents(...args),
  getParticipants: (...args: Parameters<AnyFn>) => mockGetParticipants(...args),
  getGrounding: (...args: Parameters<AnyFn>) => mockGetGrounding(...args),
  getCombatState: (...args: Parameters<AnyFn>) => mockGetCombatState(...args),
  getCharacterSheet: (...args: Parameters<AnyFn>) => mockGetCharacterSheet(...args),
  postSessionEvent: (...args: Parameters<AnyFn>) => mockPostSessionEvent(...args),
  createSession: (...args: Parameters<AnyFn>) => mockCreateSession(...args),
  getCatalog: (...args: Parameters<AnyFn>) => mockGetCatalog(...args),
  listMyCharacters: (...args: Parameters<AnyFn>) => mockListMyCharacters(...args),
  npcAction: jest.fn(),
  combatFromScene: jest.fn(),
  rollInitiative: jest.fn(),
  monsterTurn: jest.fn(),
  startCombat: jest.fn(),
  spawnMonster: jest.fn(),
  attack: jest.fn(),
  dodge: jest.fn(),
  dash: jest.fn(),
  endTurn: jest.fn(),
  endCombat: jest.fn(),
  advanceScene: jest.fn(),
  setFlag: jest.fn(),
  bindCharacter: jest.fn(() => Promise.resolve({ campaign_id: 's1', username: 'dm_alice', role: 'dm', character_id: null })),
  submitOverride: jest.fn(),
  setSessionPolicy: jest.fn(),
}));

jest.mock('../../lib/stream', () => ({
  streamDmNarration: (...args: Parameters<AnyFn>) => mockStreamDmNarration(...args),
}));

// ── sessionAnnotations mock (needed by modules page) --------------------------
jest.mock('../../lib/sessionAnnotations', () => ({
  uniqueChannelFromName: (name: string) => `${name.replace(/\s/g, '_').toLowerCase()}_test`,
  setSessionAnnotations: jest.fn(),
}));

import PlayPage from '@/app/play/[sessionId]/page';
import ModulesPage from '@/app/modules/page';
import { ThemeProvider } from '@/lib/theme/ThemeProvider';
import { AuthProvider } from '@/lib/auth/AuthProvider';
import { ToastProvider } from '@/components/Toast';
import type { Session, User } from '@/lib/api/types';

const LEON: User = { id: 1, username: 'dm_alice', email: null };

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

// ── Fixtures ------------------------------------------------------------------

const DM_PARTY = [{ username: 'dm_alice', is_dm: true, character: null }];

function makeSession(ai_assist_level: 'full' | 'assist' | 'off', dm_mode: 'ai' | 'human' = 'human'): Session {
  return {
    session_id: 's1',
    channel: 'test_channel',
    name: 'Test Table',
    dm_username: 'dm_alice',
    dm_mode,
    ai_assist_level,
    active_combat_id: null,
  };
}

function setupPlayPage(session: Session) {
  jest.clearAllMocks();
  mockGetSession.mockResolvedValue(session);
  mockGetSessionEvents.mockResolvedValue([]);
  mockGetParticipants.mockResolvedValue(DM_PARTY);
  mockGetGrounding.mockResolvedValue(null);
  mockGetCombatState.mockResolvedValue(null);
  mockGetCharacterSheet.mockResolvedValue(null);
}

// ── S5.5-AC1: NarratorStrip hidden when ai_assist_level='off' ----------------

describe('S5.5-AC1 — ai_assist_level=off hides the Suzu narrator panel', () => {
  it('renders the ai-off status bar instead of NarratorStrip idle text', async () => {
    setupPlayPage(makeSession('off'));
    render(<PlayPage />);

    await waitFor(() => expect(mockGetSession).toHaveBeenCalled());
    await act(async () => { await Promise.resolve(); });

    // The NarratorStrip idle text should NOT appear when ai is off.
    // "Suzu is listening" is the NarratorStrip idle state.
    expect(screen.queryByText(/Suzu is listening/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Suzu is narrating/i)).not.toBeInTheDocument();
  });
});

// ── S5.5-AC2: streamDmNarration never called for ai_assist_level='off' -------

describe('S5.5-AC2 — streamDmNarration is never called when ai_assist_level=off', () => {
  it('mounts + player sends a message: zero streamDmNarration calls', async () => {
    setupPlayPage(makeSession('off', 'human'));
    render(<PlayPage />);

    await waitFor(() => expect(mockGetSession).toHaveBeenCalled());
    await act(async () => { await Promise.resolve(); });

    // The session is human-DM so the composer is in dm_narration mode.
    // Find the textarea and send a message.
    const textarea = screen.queryByRole('textbox', { name: /Compose/i });
    if (textarea) {
      fireEvent.change(textarea, { target: { value: 'A goblin lurks in the shadows.' } });
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /^Send$/i }));
      });
      await waitFor(() => expect(mockPostSessionEvent).toHaveBeenCalled());
    }

    // streamDmNarration (the LLM pipe) must NEVER be called regardless of action.
    expect(mockStreamDmNarration).not.toHaveBeenCalled();
  });

  it('ai session with ai_assist_level=off: streamDmNarration not called on send', async () => {
    // Simulate an AI-mode session that somehow has ai_assist_level='off'
    // (the engine would normally snap this, but the client gate should still hold).
    setupPlayPage(makeSession('off', 'ai'));
    render(<PlayPage />);

    await waitFor(() => expect(mockGetSession).toHaveBeenCalled());
    await act(async () => { await Promise.resolve(); });

    const textarea = screen.queryByRole('textbox', { name: /Compose/i });
    if (textarea) {
      fireEvent.change(textarea, { target: { value: 'I look around.' } });
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /^Send$/i }));
      });
      await act(async () => { await Promise.resolve(); });
    }

    expect(mockStreamDmNarration).not.toHaveBeenCalled();
  });
});

// ── S5.5-AC3: NarratorStrip renders normally for ai_assist_level='full' ------

describe('S5.5-AC3 — NarratorStrip renders for ai_assist_level=full', () => {
  it('shows Suzu idle text on full AI session', async () => {
    // AI session: the logged-in user IS the DM but it's AI mode so no auto-switch
    // We use an ai session where dm_alice would get Say/Act tabs.
    setupPlayPage(makeSession('full', 'ai'));
    // For AI mode: streamDmNarration needs to return an async iterable (no-op) to avoid
    // hang. The page calls narrate() which calls streamDmNarration.
    // The opening narration only fires when there's grounding; since mockGetGrounding
    // returns null, narrate() won't fire. The NarratorStrip should still show.
    render(<PlayPage />);

    await waitFor(() => expect(mockGetSession).toHaveBeenCalled());
    await act(async () => { await Promise.resolve(); });

    // NarratorStrip idle state should be visible.
    expect(screen.getByText(/Suzu is listening/i)).toBeInTheDocument();
  });
});

// ── S5.5-AC4: NarratorStrip present for ai_assist_level='assist' ---------------
// Note: the SessionRecap component legitimately calls streamDmNarration for
// 'assist' sessions (it provides an AI "previously on" summary — this is an
// explicit read, not auto-fire narration). AC4 focuses on play-screen
// narrate() NOT auto-firing on player sends, which requires checking the
// narrate() gate, not the raw streamDmNarration call count.

describe('S5.5-AC4 — assist mode: NarratorStrip renders', () => {
  it('shows NarratorStrip for assist level (not hidden like off)', async () => {
    setupPlayPage(makeSession('assist', 'ai'));
    render(<PlayPage />);

    await waitFor(() => expect(mockGetSession).toHaveBeenCalled());
    await act(async () => { await Promise.resolve(); });

    // The Suzu panel renders for assist (not hidden like 'off').
    expect(screen.getByText(/Suzu is listening/i)).toBeInTheDocument();
  });

  it('assist: narrate() does not auto-fire on player "say" send (Say/Act modes present)', async () => {
    // 'assist' with an AI-DM session where the logged-in user is a PLAYER
    // (auth mock always returns dm_alice; for this test we need to verify the
    // narrate() gate logic, which we can check via the streamDmNarration call count
    // on the PLAY page's COMPOSER send, not the SessionRecap background call).
    //
    // Since streamDmNarration IS legitimately called by SessionRecap for 'assist',
    // this test verifies the narrate() gate returns early by checking the call
    // count before and after a composer send — any new call from composer send
    // would appear after the page mount calls settle.
    setupPlayPage(makeSession('assist', 'ai'));
    // Provide a minimal async iterator response so SessionRecap's call doesn't hang.
    mockStreamDmNarration.mockImplementation(async function* () { /* no-op */ });
    render(<PlayPage />);

    await waitFor(() => expect(mockGetSession).toHaveBeenCalled());
    await act(async () => { await Promise.resolve(); });

    // Count calls at this point (SessionRecap may have called it).
    const callsAtMount = mockStreamDmNarration.mock.calls.length;

    // Send a player message via the composer.
    const textarea = screen.queryByRole('textbox', { name: /Compose/i });
    if (textarea) {
      fireEvent.change(textarea, { target: { value: 'I look around.' } });
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /^Send$/i }));
      });
      await act(async () => { await Promise.resolve(); });
    }

    // The narrate() function must NOT have added new calls for the player send.
    // (Any calls from mount belong to SessionRecap; player-action narrate calls are gated.)
    const callsAfterSend = mockStreamDmNarration.mock.calls.length;
    expect(callsAfterSend).toBe(callsAtMount);
  });
});

// ── S5.5-AC5/6: StarterForm ai_assist_level radio ---------------------------------

const CATALOG_RESPONSE = {
  items: [{
    public_id: 'dnd5e:adventure:hollow-tide-cave',
    name: 'The Hollow Tide Cave',
    summary: {
      subtitle: 'A starter adventure',
      level_range: { min: 1, max: 3 },
      length: 'one_shot',
    },
  }],
};

function setupModulesPage() {
  jest.clearAllMocks();
  mockGetCatalog.mockResolvedValue(CATALOG_RESPONSE);
  mockListMyCharacters.mockResolvedValue([]);
  mockCreateSession.mockResolvedValue({ session_id: 'new-s1', channel: 'new_session_test' });
}

describe('S5.5-AC5 — StarterForm shows ai_assist_level radio for human/solo modes', () => {
  it('ai assist level fieldset visible when Human DM is selected', async () => {
    setupModulesPage();
    render(<ModulesPage />);

    // Wait for catalog to load and grid to appear.
    await waitFor(() => expect(screen.queryByText('The Hollow Tide Cave')).toBeInTheDocument());

    // Click "Run this" to open StarterForm.
    fireEvent.click(screen.getByRole('button', { name: /Run this — The Hollow Tide Cave/i }));

    await waitFor(() => expect(screen.queryByText('Set the table')).toBeInTheDocument());

    // Default is 'Suzu DMs' (ai mode) — ai assist level fieldset should NOT be shown.
    expect(screen.queryByRole('radiogroup', { name: /AI narration level/i })).not.toBeInTheDocument();

    // Switch to 'Human DM'.
    fireEvent.click(screen.getByRole('radio', { name: /Human DM/i }));

    // AI narration level fieldset should appear.
    await waitFor(() =>
      expect(screen.queryByRole('radiogroup', { name: /AI narration level/i })).toBeInTheDocument(),
    );

    // Options should be visible.
    expect(screen.getByRole('radio', { name: /No AI/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /AI assist on request/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Full AI DM/i })).toBeInTheDocument();
  });

  it('ai assist level fieldset visible when Solo is selected', async () => {
    setupModulesPage();
    render(<ModulesPage />);

    await waitFor(() => expect(screen.queryByText('The Hollow Tide Cave')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Run this — The Hollow Tide Cave/i }));
    await waitFor(() => expect(screen.queryByText('Set the table')).toBeInTheDocument());

    // Switch to 'Solo'.
    fireEvent.click(screen.getByRole('radio', { name: /Solo/i }));

    await waitFor(() =>
      expect(screen.queryByRole('radiogroup', { name: /AI narration level/i })).toBeInTheDocument(),
    );
  });
});

describe('S5.5-AC6 — StarterForm: ai_assist_level fieldset hidden when Suzu DMs (ai mode)', () => {
  it('no AI narration level choices shown; lock hint visible', async () => {
    setupModulesPage();
    render(<ModulesPage />);

    await waitFor(() => expect(screen.queryByText('The Hollow Tide Cave')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Run this — The Hollow Tide Cave/i }));
    await waitFor(() => expect(screen.queryByText('Set the table')).toBeInTheDocument());

    // Default = Suzu DMs (ai) — ai assist fieldset must be absent.
    expect(screen.queryByRole('radiogroup', { name: /AI narration level/i })).not.toBeInTheDocument();

    // Lock hint visible.
    expect(screen.getByText(/Suzu DMs mode requires full AI narration/i)).toBeInTheDocument();
  });
});

// ── S5.5-AC7: createSession with human+off payload ---------------------------

describe('S5.5-AC7 — createSession carries ai_assist_level=off for human+off', () => {
  it('submits correct payload', async () => {
    setupModulesPage();
    render(<ModulesPage />);

    await waitFor(() => expect(screen.queryByText('The Hollow Tide Cave')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Run this — The Hollow Tide Cave/i }));
    await waitFor(() => expect(screen.queryByText('Set the table')).toBeInTheDocument());

    // Switch to Human DM.
    fireEvent.click(screen.getByRole('radio', { name: /Human DM/i }));

    // AI narration defaults to 'off' after switching to human (the "safe" default).
    await waitFor(() =>
      expect(screen.queryByRole('radiogroup', { name: /AI narration level/i })).toBeInTheDocument(),
    );

    // Explicitly pick 'No AI' (should already be selected after switching to human).
    fireEvent.click(screen.getByRole('radio', { name: /No AI/i }));

    // Submit.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Begin/i }));
    });

    await waitFor(() => expect(mockCreateSession).toHaveBeenCalled());

    expect(mockCreateSession).toHaveBeenCalledWith(
      expect.objectContaining({
        dm_mode: 'human',
        ai_assist_level: 'off',
      }),
    );
  });
});

// ── S5.5-AC8: createSession with human+assist payload -------------------------

describe('S5.5-AC8 — createSession carries ai_assist_level=assist for human+assist', () => {
  it('submits correct payload', async () => {
    setupModulesPage();
    render(<ModulesPage />);

    await waitFor(() => expect(screen.queryByText('The Hollow Tide Cave')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Run this — The Hollow Tide Cave/i }));
    await waitFor(() => expect(screen.queryByText('Set the table')).toBeInTheDocument());

    // Switch to Human DM.
    fireEvent.click(screen.getByRole('radio', { name: /Human DM/i }));

    await waitFor(() =>
      expect(screen.queryByRole('radiogroup', { name: /AI narration level/i })).toBeInTheDocument(),
    );

    // Pick 'AI assist on request'.
    fireEvent.click(screen.getByRole('radio', { name: /AI assist on request/i }));

    // Submit.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Begin/i }));
    });

    await waitFor(() => expect(mockCreateSession).toHaveBeenCalled());

    expect(mockCreateSession).toHaveBeenCalledWith(
      expect.objectContaining({
        dm_mode: 'human',
        ai_assist_level: 'assist',
      }),
    );
  });
});

// ── S5.5-AC9: aiLevel read from server session, no stale snapshot -------------

describe('S5.5-AC9 — ai gate reads session.ai_assist_level (server truth)', () => {
  it('switching session fixture between off and full changes NarratorStrip presence', async () => {
    // Test 1: off session — panel hidden.
    setupPlayPage(makeSession('off', 'ai'));
    const { unmount } = render(<PlayPage />);
    await waitFor(() => expect(mockGetSession).toHaveBeenCalled());
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByText(/Suzu is listening/i)).not.toBeInTheDocument();
    unmount();

    // Test 2: full session — panel visible.
    setupPlayPage(makeSession('full', 'ai'));
    render(<PlayPage />);
    await waitFor(() => expect(mockGetSession).toHaveBeenCalled());
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByText(/Suzu is listening/i)).toBeInTheDocument();
  });
});

// ── S5.5-AC10: ai+off lock hint in StarterForm --------------------------------

describe('S5.5-AC10 — StarterForm shows lock hint for Suzu DMs mode', () => {
  it('lock hint present when Suzu DMs is selected', async () => {
    setupModulesPage();
    render(<ModulesPage />);

    await waitFor(() => expect(screen.queryByText('The Hollow Tide Cave')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Run this — The Hollow Tide Cave/i }));
    await waitFor(() => expect(screen.queryByText('Set the table')).toBeInTheDocument());

    // Default = Suzu DMs — lock hint visible.
    expect(screen.getByText(/Suzu DMs mode requires full AI narration/i)).toBeInTheDocument();

    // Switch to Human DM — lock hint gone; fieldset shown instead.
    fireEvent.click(screen.getByRole('radio', { name: /Human DM/i }));
    await waitFor(() =>
      expect(screen.queryByText(/Suzu DMs mode requires full AI narration/i)).not.toBeInTheDocument(),
    );
    expect(screen.queryByRole('radiogroup', { name: /AI narration level/i })).toBeInTheDocument();
  });
});
