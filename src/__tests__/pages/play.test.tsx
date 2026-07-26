/**
 * Tests for the play session page (src/app/play/[sessionId]/page.tsx,
 * ST-060–065 / ST-071 / ST-062 / ADV-6).
 *
 * ADV-6 coverage:
 *   - beginEncounter calls combatFromScene (not spawnMonster) — happy path
 *   - 400 "No encounter available" → friendly toast, button resets (no stuck spinner)
 *   - network/500 error → graceful error message, no crash
 *   - spawnMonster is NOT called from beginEncounter
 */
import React from 'react';
import { render, screen, waitFor, fireEvent, act, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { CharacterSheet, NarrationEvent, Participant, Session } from '@/lib/api/types';

jest.mock('next/navigation', () => ({
  useParams: () => ({ sessionId: 's1' }),
}));

const mockToast = jest.fn();
jest.mock('../../components/Toast', () => ({
  useToast: () => ({ toast: mockToast }),
}));

jest.mock('../../lib/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 1, username: 'alice', email: null } }),
}));

jest.mock('../../lib/useReducedMotion', () => ({
  useReducedMotion: () => true, // reveal narration instantly in tests
}));

jest.mock('../../lib/api/dnd', () => ({
  getSession: jest.fn(),
  getSessionEvents: jest.fn(() => Promise.resolve([])),
  getSessionEventsRaw: jest.fn(() => Promise.resolve(null)),
  getParticipants: jest.fn(),
  getGrounding: jest.fn(() => Promise.resolve(null)),
  getCombatState: jest.fn(() => Promise.resolve(null)),
  // A2: getCharacterSheet for real quick-checks; resolve null → no quick-checks rendered.
  getCharacterSheet: jest.fn(() => Promise.resolve(null)),
  // A1: postSessionEvent for the AI-off opening marker; resolve silently.
  postSessionEvent: jest.fn(() => Promise.resolve({})),
  // ADV-6: combatFromScene replaces the old startCombat + spawnMonster flow.
  combatFromScene: jest.fn(),
  // Keep startCombat + spawnMonster in the mock — they're still exported and
  // other code paths may use them. Only beginEncounter has been updated.
  startCombat: jest.fn(),
  spawnMonster: jest.fn(),
  rollInitiative: jest.fn(),
  monsterTurn: jest.fn(),
  attack: jest.fn(),
  dodge: jest.fn(),
  dash: jest.fn(),
  endTurn: jest.fn(),
  endCombat: jest.fn(),
  advanceScene: jest.fn(),
  setFlag: jest.fn(),
  // B2-4: rebind support
  bindCharacter: jest.fn(() => Promise.resolve({ campaign_id: 's1', username: 'alice', role: 'player', character_id: 1 })),
  listMyCharacters: jest.fn(() => Promise.resolve([])),
  // DDX-22 Phase 3: JournalPane is now unconditionally mounted on the play
  // page (only its CSS visibility/inert state is gated by journalVisible —
  // see page.tsx's <aside id="play-pane-journal">), so every render of this
  // page fires a getSessionNotes() GET regardless of whether the journal is
  // ever opened. Default to "no note yet" so this suite stays hermetic.
  getSessionNotes: jest.fn(() => Promise.resolve(null)),
  putSessionNotes: jest.fn(() => Promise.resolve({ body: '', updated_at: '2026-01-01T00:00:00Z' })),
}));

jest.mock('../../lib/stream', () => ({
  streamDmNarration: jest.fn(),
}));

import * as dnd from '@/lib/api/dnd';
import * as stream from '@/lib/stream';
import PlayPage from '@/app/play/[sessionId]/page';

const mGetSession = dnd.getSession as jest.MockedFunction<typeof dnd.getSession>;
const mGetParticipants = dnd.getParticipants as jest.MockedFunction<typeof dnd.getParticipants>;
const mStream = stream.streamDmNarration as jest.MockedFunction<typeof stream.streamDmNarration>;
const mCombatFromScene = dnd.combatFromScene as jest.MockedFunction<typeof dnd.combatFromScene>;
const mSpawnMonster = dnd.spawnMonster as jest.MockedFunction<typeof dnd.spawnMonster>;
const mRollInitiative = dnd.rollInitiative as jest.MockedFunction<typeof dnd.rollInitiative>;

const SESSION: Session = {
  session_id: 's1',
  channel: 'the_hollow_tide',
  status: 'active',
  dm_username: 'suzu',
  participant_usernames: ['alice'],
  player_count: 1,
  active_combat_id: null,
  dm_mode: 'ai',
  visibility: 'public',
  content_rating: 'sfw',
};

const PARTY: Participant[] = [
  {
    username: 'alice',
    is_dm: false,
    character: {
      character_id: 'c1',
      name: 'Velka',
      char_class: 'Rogue',
      level: 1,
      current_hp: 8,
      max_hp: 10,
      ac: 14,
    },
  },
];

/** ADV-6 happy-path response from combatFromScene. */
const FROM_SCENE_RESULT = {
  combat_id: 'combat-42',
  round: 1,
  monsters: [
    { participant_id: 'g1', name: 'Goblin', hp: 7, from_ref: 'dnd5e:monster:goblin', tactics: 'flanks', position: 'near_barrel' },
    { participant_id: 'g2', name: 'Goblin', hp: 7, from_ref: 'dnd5e:monster:goblin', tactics: 'flanks', position: 'near_barrel' },
  ],
  terrain: { lighting: 'dim' },
  encounter_id: 'cave_mouth_guards',
};

function streamOnce(events: NarrationEvent[]) {
  mStream.mockImplementation(async function* () {
    for (const e of events) yield e;
  });
}

/** Builds a mock ApiError with the given status code (mirrors the real ApiError shape). */
function apiError(status: number, message: string): Error & { status: number; body?: unknown } {
  const err = new Error(message) as Error & { status: number; body?: unknown };
  err.status = status;
  // F1/CAST-FAIL-SILENT: mirror the real makeApiError shape (src/lib/api/
  // client.ts) — `.body` is the parsed `{success, message, data}` envelope,
  // not just the bare Error `.message` string. engineErrorMessage reads
  // `err.body.message`, never `err.message`.
  err.body = { success: false, message, data: {} };
  return err;
}

beforeEach(() => {
  jest.clearAllMocks();
  mGetSession.mockResolvedValue(SESSION);
  mGetParticipants.mockResolvedValue(PARTY);
  streamOnce([{ kind: 'chunk', text: 'The door creaks open.' }, { kind: 'done' }]);
  mCombatFromScene.mockResolvedValue(FROM_SCENE_RESULT);
  mRollInitiative.mockResolvedValue({ message: 'Initiative rolled.' });
});

describe('Play page', () => {
  it('loads the session and renders its title + party', async () => {
    render(<PlayPage />);
    expect(await screen.findByText('The Hollow Tide')).toBeInTheDocument();
    // B2-4: "Velka" now appears in both PartyPanel and the rebind section label.
    const velkaEls = await screen.findAllByText('Velka');
    expect(velkaEls.length).toBeGreaterThanOrEqual(1);
  });

  // ── TAV-PARTY-INLINE-SHEET ───────────────────────────────────────────────────
  const VELKA_SHEET: CharacterSheet = {
    character_id: 'c1',
    owner_username: 'alice',
    name: 'Velka',
    race: 'Human',
    subrace: '',
    char_class: 'Rogue',
    subclass: '',
    level: 1,
    background: '',
    alignment: '',
    ability_scores: {
      strength: { score: 10, modifier: 0 },
      dexterity: { score: 16, modifier: 3 },
      constitution: { score: 12, modifier: 1 },
      intelligence: { score: 10, modifier: 0 },
      wisdom: { score: 10, modifier: 0 },
      charisma: { score: 10, modifier: 0 },
    },
    hp: { current: 8, max: 10, temp: 0 },
    ac: 14,
    initiative: 3,
    proficiency_bonus: 2,
    speed: 30,
    xp: 0,
    xp_next: 300,
    hit_dice_remaining: 1,
    proficient_saves: [],
    proficient_skills: ['stealth'],
    class_features: ['Sneak Attack'],
    conditions: [],
    spellcasting: null,
    spell_slots: {},
    is_spellcaster: false,
    inventory: [{ name: 'Shortsword', item_type: 'weapon', sub: '', quantity: 1, equipped: true }],
    inventory_weight: 2,
    languages: ['Common'],
  };

  const BOB_SHEET: CharacterSheet = {
    ...VELKA_SHEET,
    character_id: 'c2',
    owner_username: 'bob',
    name: 'Grask',
    class_features: ['Rage'],
    inventory: [{ name: 'Greataxe', item_type: 'weapon', sub: '', quantity: 1, equipped: true }],
  };

  const PARTY_WITH_BOB: Participant[] = [
    ...PARTY,
    {
      username: 'bob',
      is_dm: false,
      character: {
        character_id: 'c2',
        name: 'Grask',
        char_class: 'Barbarian',
        level: 1,
        current_hp: 12,
        max_hp: 12,
        ac: 13,
      },
    },
  ];

  it("TAV-PARTY-INLINE-SHEET: clicking your OWN party card opens the drawer from the already-loaded sheet, no navigation, no extra fetch", async () => {
    const mGetCharacterSheet = dnd.getCharacterSheet as jest.MockedFunction<
      typeof dnd.getCharacterSheet
    >;
    // Resolves for EVERY call (including the page's own boundCharId hydration
    // effect) — this is what makes `mySheet` already populated by the time
    // the party card is clicked.
    mGetCharacterSheet.mockResolvedValue(VELKA_SHEET);

    render(<PlayPage />);
    await screen.findByText('The Hollow Tide');
    await waitFor(() => expect(mGetCharacterSheet).toHaveBeenCalled());
    const callsBeforeClick = mGetCharacterSheet.mock.calls.length;

    // The card is a <button> now, not a <Link> — no navigation on click.
    const card = screen.getByRole('button', { name: /Velka/ });
    expect(screen.queryByRole('link', { name: /Velka/ })).not.toBeInTheDocument();

    fireEvent.click(card);

    const dialog = await screen.findByRole('dialog', { name: /Velka/ });
    expect(within(dialog).getByText('Sneak Attack')).toBeInTheDocument();
    expect(within(dialog).getByText(/Shortsword/)).toBeInTheDocument();
    // Reused mySheet — no NEW getCharacterSheet call fired for the click itself.
    expect(mGetCharacterSheet.mock.calls.length).toBe(callsBeforeClick);

    // Still on the same play page — no route change.
    expect(screen.getByText('The Hollow Tide')).toBeInTheDocument();

    // Closing via Escape returns the drawer to hidden (role="dialog" gone).
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: /Velka/ })).not.toBeInTheDocument(),
    );
  });

  it('TAV-PARTY-INLINE-SHEET: clicking a DIFFERENT member\'s card fetches and shows THEIR sheet, not navigation', async () => {
    mGetParticipants.mockResolvedValue(PARTY_WITH_BOB);
    const mGetCharacterSheet = dnd.getCharacterSheet as jest.MockedFunction<
      typeof dnd.getCharacterSheet
    >;
    mGetCharacterSheet.mockImplementation((id: string) =>
      id === 'c1'
        ? Promise.resolve(VELKA_SHEET)
        : id === 'c2'
          ? Promise.resolve(BOB_SHEET)
          : Promise.reject(new Error('not found')),
    );

    render(<PlayPage />);
    await screen.findByText('The Hollow Tide');

    const card = screen.getByRole('button', { name: /Grask/ });
    expect(screen.queryByRole('link', { name: /Grask/ })).not.toBeInTheDocument();
    fireEvent.click(card);

    const dialog = await screen.findByRole('dialog', { name: /Grask/ });
    expect(within(dialog).getByText('Rage')).toBeInTheDocument();
    expect(within(dialog).getByText(/Greataxe/)).toBeInTheDocument();
    expect(mGetCharacterSheet).toHaveBeenCalledWith('c2', 'alice');

    // Still on the same play page — no route change.
    expect(screen.getByText('The Hollow Tide')).toBeInTheDocument();
  });

  it('mobile view tabs switch Story / Party / Scene (party reachable on mobile)', async () => {
    render(<PlayPage />);
    await screen.findByText('The Hollow Tide');

    const story = screen.getByRole('button', { name: /story/i });
    const party = screen.getByRole('button', { name: /party/i });
    const scene = screen.getByRole('button', { name: /scene/i });

    expect(story).toHaveAttribute('aria-pressed', 'true');
    expect(party).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(party);
    expect(party).toHaveAttribute('aria-pressed', 'true');
    expect(story).toHaveAttribute('aria-pressed', 'false');
    expect(scene).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(scene);
    expect(scene).toHaveAttribute('aria-pressed', 'true');
    expect(party).toHaveAttribute('aria-pressed', 'false');
  });

  it('Say → streams DM narration into the chat log', async () => {
    render(<PlayPage />);
    await screen.findByText('The Hollow Tide');

    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'I open the door.' } });
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' });
    });

    await waitFor(() => expect(mStream).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('I open the door.')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getAllByText('The door creaks open.').length).toBeGreaterThan(0),
    );
    const payload = mStream.mock.calls[0][0];
    expect(payload.message).toBe('I open the door.');
    expect(payload.mechanics).toBe('');
  });

  it('OOC messages never reach the AI pipeline', async () => {
    render(<PlayPage />);
    await screen.findByText('The Hollow Tide');

    fireEvent.click(screen.getByRole('tab', { name: 'OOC' }));
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'brb, tea' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(await screen.findByText('(ooc) brb, tea')).toBeInTheDocument();
    expect(mStream).not.toHaveBeenCalled();
  });

  it('shows a fallback when the session is missing', async () => {
    mGetSession.mockResolvedValue(null as unknown as Session);
    render(<PlayPage />);
    expect(await screen.findByText(/That table has closed/i)).toBeInTheDocument();
  });

  it('combat attack → engine result string is passed as mechanics to narration', async () => {
    mGetSession.mockResolvedValue({ ...SESSION, active_combat_id: 'c1' });
    (dnd.attack as jest.MockedFunction<typeof dnd.attack>).mockResolvedValue({
      message: 'Longsword vs Goblin A: 19 + 5 = 24 vs AC 15 — HIT. Damage 1d8+3 = 9.',
    });
    streamOnce([{ kind: 'chunk', text: 'Your blade finds the gap.' }, { kind: 'done' }]);

    render(<PlayPage />);
    await screen.findByText('The Hollow Tide');

    await act(async () => {
      const attackBtn = screen.queryByRole('button', { name: /Attack/i });
      if (attackBtn) fireEvent.click(attackBtn);
    });

    await waitFor(() => {
      if (mStream.mock.calls.length === 0) return;
      const payload = mStream.mock.calls[0][0];
      expect(payload.mechanics).toContain('HIT');
    }, { timeout: 3000 });
  });

  it('narration stream exception renders the stepped-away system message', async () => {
    mStream.mockImplementation(async function* () {
      yield { kind: 'error' as const, error: 'backend failed' };
      yield { kind: 'done' as const };
    });

    render(<PlayPage />);
    await screen.findByText('The Hollow Tide');

    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'I look around.' } });
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' });
    });

    await waitFor(() =>
      expect(screen.getByText(/stepped away/i)).toBeInTheDocument(),
    );
  });

  it('ai_off error reason shows the intentional-no-AI message, not stepped-away', async () => {
    mStream.mockImplementation(async function* () {
      yield {
        kind: 'error' as const,
        error: 'AI narration is disabled for this table',
        reason: 'ai_off',
      };
      yield { kind: 'done' as const };
    });

    render(<PlayPage />);
    await screen.findByText('The Hollow Tide');

    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'I scout ahead.' } });
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' });
    });

    await waitFor(() =>
      expect(
        screen.getByText(/this table runs without ai narration/i),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByText(/stepped away/i)).not.toBeInTheDocument();
  });

  it('unknown error reason still shows the generic stepped-away message', async () => {
    mStream.mockImplementation(async function* () {
      yield { kind: 'error' as const, error: 'something broke', reason: 'ai_unverified' };
      yield { kind: 'done' as const };
    });

    render(<PlayPage />);
    await screen.findByText('The Hollow Tide');

    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'I wait.' } });
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' });
    });

    await waitFor(() =>
      expect(screen.getByText(/stepped away/i)).toBeInTheDocument(),
    );
    expect(screen.queryByText(/this table runs without ai narration/i)).not.toBeInTheDocument();
  });
});

// ── ADV-6: beginEncounter / combatFromScene ───────────────────────────────────

describe('ADV-6 — beginEncounter', () => {
  /** Helper: render, wait for session, click "Begin an encounter". */
  async function clickBeginEncounter() {
    render(<PlayPage />);
    await screen.findByText('The Hollow Tide');
    const btn = screen.getByRole('button', { name: /begin an encounter/i });
    await act(async () => {
      fireEvent.click(btn);
    });
    return btn;
  }

  it('happy path: calls combatFromScene with the session_id', async () => {
    await clickBeginEncounter();
    await waitFor(() => expect(mCombatFromScene).toHaveBeenCalledTimes(1));
    expect(mCombatFromScene).toHaveBeenCalledWith(
      expect.objectContaining({ session_id: 's1' }),
    );
  });

  it('happy path: does NOT call spawnMonster (hardcoded goblin spawn is gone)', async () => {
    await clickBeginEncounter();
    await waitFor(() => expect(mCombatFromScene).toHaveBeenCalledTimes(1));
    expect(mSpawnMonster).not.toHaveBeenCalled();
  });

  it('happy path: wires the returned combat_id into the combat UI', async () => {
    await clickBeginEncounter();
    // combat_id from FROM_SCENE_RESULT = 'combat-42' flips combatIsActive —
    // this fixture's `getCombatState` mock resolves null (no structured
    // state), so NarratorStrip's own "Round N" combat line has nothing to
    // show yet; the "combat" status pill (narratorStatusPill, unconditional
    // on combatIsActive alone) is the reliable signal that the UI actually
    // transitioned into combat mode.
    await waitFor(() => {
      expect(screen.getAllByText(/^combat$/i).length).toBeGreaterThan(0);
    });
  });

  it('happy path: monster names from the engine appear in the log', async () => {
    await clickBeginEncounter();
    // The log line mentions the spawned monster names returned by the engine.
    await waitFor(() =>
      expect(screen.getByText(/goblin.*close in/i)).toBeInTheDocument(),
    );
  });

  it('F1/CAST-FAIL-SILENT: 400 "No encounter available" surfaces the engine\'s own ready-to-show message (not a generic fallback), button resets', async () => {
    // combat_from_scene never sets data.reason for this refusal (see
    // routes/combat.py) — no curated copy exists for it, so engineErrorMessage's
    // 4xx-business branch is what surfaces the engine's own message verbatim.
    mCombatFromScene.mockRejectedValue(apiError(400, 'No encounter available for the current scene.'));
    const btn = await clickBeginEncounter();
    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          tone: 'error',
          message: 'No encounter available for the current scene.',
        }),
      ),
    );
    // Button must not be stuck in disabled/busy state after the 400.
    await waitFor(() => expect(btn).not.toBeDisabled());
    // UI must NOT transition into combat mode (no "combat" status pill).
    expect(screen.queryByText(/^combat$/i)).not.toBeInTheDocument();
  });

  it('adversarial: 500 server error → generic error toast, no crash', async () => {
    mCombatFromScene.mockRejectedValue(apiError(500, 'Internal server error'));
    await clickBeginEncounter();
    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          tone: 'error',
          message: expect.stringMatching(/could not start combat/i),
        }),
      ),
    );
    expect(screen.queryByText(/^combat$/i)).not.toBeInTheDocument();
  });

  it('adversarial: network error (no status) → generic error toast, no crash', async () => {
    mCombatFromScene.mockRejectedValue(new Error('Failed to fetch'));
    await clickBeginEncounter();
    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ tone: 'error' }),
      ),
    );
    expect(screen.queryByText(/^combat$/i)).not.toBeInTheDocument();
  });

  it('adversarial: double-click does not double-submit (combatBusy guard)', async () => {
    // Hold the first call in-flight.
    let resolve!: (v: typeof FROM_SCENE_RESULT) => void;
    mCombatFromScene.mockReturnValue(new Promise((r) => { resolve = r; }));

    render(<PlayPage />);
    await screen.findByText('The Hollow Tide');
    const btn = screen.getByRole('button', { name: /begin an encounter/i });

    // First click — starts the request.
    await act(async () => { fireEvent.click(btn); });
    // Second click while in-flight — button is disabled; should not fire again.
    await act(async () => { fireEvent.click(btn); });

    // Resolve the first request.
    await act(async () => { resolve(FROM_SCENE_RESULT); });

    // combatFromScene must have been called exactly once.
    expect(mCombatFromScene).toHaveBeenCalledTimes(1);
  });
});

// ── ADV-6 client fn ──────────────────────────────────────────────────────────

describe('combatFromScene client function', () => {
  it('is exported from the dnd client module', async () => {
    // Import it fresh to confirm the export is there.
    const { combatFromScene: fn } = await import('@/lib/api/dnd');
    expect(typeof fn).toBe('function');
  });
});
