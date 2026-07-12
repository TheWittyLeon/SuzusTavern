/**
 * P1-PLAYFIX-2 §A.3/§A.5/§A.6 (A.3) — Tavern client: free-text intent fast-path
 * + offered_check surfacing.
 *
 * Coverage:
 *   - an unambiguous fast-path phrase ("I head deeper") routes straight to
 *     onMoveOn (advanceScene called) and the composer's bare narrate(text,'',
 *     mode) call is SKIPPED — mutual exclusivity: onMoveOn does its own
 *     narrate() call with the transition mechanics, never the raw player text.
 *   - P1-PLAYFIX-2 gate fix (2026-07-02, Kage #3 / Miko DEFECT-1): check
 *     phrases NEVER fast-path anymore — "I sneak past it" always falls
 *     through to narrate() (resolveCheck is never called off free text; only
 *     the "Attempt" button rolls a check).
 *   - ambiguous / roleplay text with no scene-affordance match falls through
 *     to narrate() with the raw player message and empty mechanics, exactly
 *     as before this change.
 *   - a narrate() SSE response carrying `offeredCheck` (A.2 reconciliation —
 *     see types.ts/stream.ts) surfaces the matching "Attempt {skill}"
 *     affordance (sr-only invite span + toast, 8s duration — Iro MINOR-2)
 *     without auto-rolling.
 *   - fork scene renders both authored transitions as distinct buttons
 *     (regression lock, §A.3's "fork = deliberate branch, not a guess").
 *   - Kage #1 / Miko DEFECT-2: `suppress_intent` is true ONLY on the client's
 *     own synthetic confirmation beats (onMoveOn's post-advance narrate()),
 *     never on a real player-authored beat.
 *   - Iro Ship 2 CRITICAL-1: narrate()'s own sceneAdvanced-triggered
 *     refreshGrounding() carries the same stranded-focus recovery as
 *     onMoveOn/onAttemptCheck.
 *   - Iro MAJOR-1: narrate()'s offered_check validation uses the freshly
 *     fetched grounding (not the stale pre-refresh closure) when the same
 *     beat also signals sceneAdvanced.
 */
import React from 'react';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { GroundingData, NarrationEvent, Participant, Session } from '@/lib/api/types';

jest.mock('next/navigation', () => ({
  useParams: () => ({ sessionId: 's1' }),
}));

const mockToast = jest.fn();
jest.mock('../../components/Toast', () => ({
  useToast: () => ({ toast: mockToast }),
}));

jest.mock('../../lib/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 1, username: 'leon', email: null } }),
}));

jest.mock('../../lib/useReducedMotion', () => ({
  useReducedMotion: () => true,
}));

jest.mock('../../lib/api/dnd', () => ({
  getSession: jest.fn(),
  getSessionEvents: jest.fn(() => Promise.resolve([])),
  getSessionEventsRaw: jest.fn(() => Promise.resolve(null)),
  getParticipants: jest.fn(),
  getGrounding: jest.fn(),
  getCombatState: jest.fn(() => Promise.resolve(null)),
  getCharacterSheet: jest.fn(() => Promise.resolve(null)),
  postSessionEvent: jest.fn(() => Promise.resolve({})),
  combatFromScene: jest.fn(),
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
  resolveCheck: jest.fn(),
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
const mGetGrounding = dnd.getGrounding as jest.MockedFunction<typeof dnd.getGrounding>;
const mAdvanceScene = dnd.advanceScene as jest.MockedFunction<typeof dnd.advanceScene>;
const mResolveCheck = dnd.resolveCheck as jest.MockedFunction<typeof dnd.resolveCheck>;
const mStream = stream.streamDmNarration as jest.MockedFunction<typeof stream.streamDmNarration>;

const SESSION: Session = {
  session_id: 's1',
  channel: 'mlp_everfree_leon',
  status: 'active',
  dm_username: 'suzu',
  participant_usernames: ['leon'],
  player_count: 1,
  active_combat_id: null,
  dm_mode: 'ai',
  ai_assist_level: 'full',
};

const PARTY: Participant[] = [
  {
    username: 'leon',
    is_dm: false,
    character: {
      character_id: 'c1',
      name: 'Anomaly',
      char_class: 'Ranger',
      level: 1,
      current_hp: 10,
      max_hp: 10,
      ac: 13,
    },
  },
];

/** Single-edge scene (no fork) — models slice_everfree_navigate. */
const GROUNDING_SINGLE_EDGE: GroundingData = {
  scene_id: 'slice_everfree_navigate',
  scene_name: 'Into the Everfree',
  boxed_text: 'The path narrows ahead.',
  objective: 'Press onward.',
  transitions: [{ to: 'slice_everfree_timberwolf', label: 'Get moving' }],
  checks: [{ skill: 'survival', dc: 12 }],
  flags: {},
  encounter_state: {},
};

/** A scene offering only a stealth check, no transitions — isolates the
 *  check fast-path from the transition fast-path. */
const GROUNDING_STEALTH_ONLY: GroundingData = {
  scene_id: 'slice_everfree_timberwolf',
  scene_name: 'The Timberwolf',
  boxed_text: 'Twigs snap somewhere close.',
  objective: 'Slip past or fight the timberwolf.',
  transitions: [],
  checks: [{ skill: 'stealth', dc: 12 }],
  flags: {},
  encounter_state: {},
};

/** The fork scene: two auto:false labelled transitions, no checks. */
const GROUNDING_FORK: GroundingData = {
  scene_id: 'slice_everfree_fork',
  scene_name: 'The Fork',
  boxed_text: 'Two paths diverge.',
  objective: 'Choose a way onward.',
  transitions: [
    { to: 'slice_everfree_zecora', label: 'Follow the smoke — southeast' },
    { to: 'slice_everfree_ponyville', label: 'Follow the path — northwest' },
  ],
  checks: [],
  flags: {},
  encounter_state: {},
};

/** A NEWLY-advanced scene that offers a check (`perception`) NOT present on
 *  GROUNDING_SINGLE_EDGE / GROUNDING_STEALTH_ONLY above — used to prove the
 *  offered_check validation reads the POST-refresh grounding (Iro MAJOR-1),
 *  not the stale pre-refresh closure value. */
const GROUNDING_PERCEPTION_SCENE: GroundingData = {
  scene_id: 'slice_everfree_clearing',
  scene_name: 'The Clearing',
  boxed_text: 'Sunlight breaks through the canopy.',
  objective: 'Take stock of your surroundings.',
  transitions: [],
  checks: [{ skill: 'perception', dc: 10 }],
  flags: {},
  encounter_state: {},
};

function streamOnce(events: NarrationEvent[]) {
  mStream.mockImplementation(async function* () {
    for (const e of events) yield e;
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mGetSession.mockResolvedValue(SESSION);
  mGetParticipants.mockResolvedValue(PARTY);
  streamOnce([{ kind: 'chunk', text: 'Suzu narrates.' }, { kind: 'done' }]);
});

async function sendMessage(text: string) {
  const input = screen.getByRole('textbox');
  fireEvent.change(input, { target: { value: text } });
  await act(async () => {
    fireEvent.keyDown(input, { key: 'Enter' });
  });
}

// ── Fast-path: unambiguous transition intent skips narrate() ────────────────

describe('P1-PLAYFIX-2 §A.3 — fast-path transition intent', () => {
  it('"I head deeper" routes to onMoveOn (advanceScene) and does NOT send the raw player text through narrate()', async () => {
    mGetGrounding.mockResolvedValue(GROUNDING_SINGLE_EDGE);
    mAdvanceScene.mockResolvedValue({
      from_scene: 'slice_everfree_navigate',
      to_scene: 'slice_everfree_timberwolf',
    });
    render(<PlayPage />);
    await screen.findByRole('textbox');

    await sendMessage('I head deeper');

    await waitFor(() => expect(mAdvanceScene).toHaveBeenCalledTimes(1));
    expect(mAdvanceScene.mock.calls[0][0]).toBe('s1');
    expect(mAdvanceScene.mock.calls[0][1]).toMatchObject({ to_scene: 'slice_everfree_timberwolf' });

    // resolveCheck must never fire for a transition-intent beat.
    expect(mResolveCheck).not.toHaveBeenCalled();

    // narrate() DID fire (onMoveOn always narrates the transition) — but with
    // its OWN transition message, never the raw player text with empty
    // mechanics. This is the mutual-exclusivity proof: the plain
    // narrate(text, '', mode) call from onSend was skipped.
    await waitFor(() => expect(mStream).toHaveBeenCalledTimes(1));
    const payload = mStream.mock.calls[0][0];
    expect(payload.message).not.toBe('I head deeper');
    expect(payload.mechanics).not.toBe('');

    // Kage #1 / Miko DEFECT-2: onMoveOn's confirmation beat MUST suppress the
    // server's INTENT classifier — advanceScene() above already moved the
    // scene; letting INTENT act on this beat too would double-advance it.
    expect(payload.suppress_intent).toBe(true);
  });

  it('does not route when there is no authored transition to match (falls through to narrate)', async () => {
    mGetGrounding.mockResolvedValue({ ...GROUNDING_SINGLE_EDGE, transitions: [] });
    render(<PlayPage />);
    await screen.findByRole('textbox');

    await sendMessage('I head deeper');

    expect(mAdvanceScene).not.toHaveBeenCalled();
    await waitFor(() => expect(mStream).toHaveBeenCalledTimes(1));
    expect(mStream.mock.calls[0][0].message).toBe('I head deeper');
    expect(mStream.mock.calls[0][0].mechanics).toBe('');
    // A real player-authored beat — suppress_intent must be false, never true.
    expect(mStream.mock.calls[0][0].suppress_intent).toBe(false);
  });
});

describe('P1-PLAYFIX-2 gate fix (Kage #3 / Miko DEFECT-1) — checks never fast-path', () => {
  it('"I sneak past it" does NOT call resolveCheck — it falls through to narrate() with the raw player text (fast-path is movement-only)', async () => {
    mGetGrounding.mockResolvedValue(GROUNDING_STEALTH_ONLY);
    render(<PlayPage />);
    await screen.findByRole('textbox');

    await sendMessage('I sneak past it');

    // The old fast-path check hijack is gone entirely: no roll happens off
    // free text, ever — only the "Attempt" button rolls a check.
    expect(mResolveCheck).not.toHaveBeenCalled();
    expect(mAdvanceScene).not.toHaveBeenCalled();

    await waitFor(() => expect(mStream).toHaveBeenCalledTimes(1));
    const payload = mStream.mock.calls[0][0];
    expect(payload.message).toBe('I sneak past it');
    expect(payload.mechanics).toBe('');
  });

  it('atmospheric text containing a check-adjacent word ("creepy") also never calls resolveCheck', async () => {
    mGetGrounding.mockResolvedValue(GROUNDING_STEALTH_ONLY);
    render(<PlayPage />);
    await screen.findByRole('textbox');

    await sendMessage('This place feels creepy, honestly.');

    expect(mResolveCheck).not.toHaveBeenCalled();
    await waitFor(() => expect(mStream).toHaveBeenCalledTimes(1));
    expect(mStream.mock.calls[0][0].message).toBe('This place feels creepy, honestly.');
  });
});

describe('P1-PLAYFIX-2 §A.3 — ambiguous / roleplay text falls through to narrate()', () => {
  it('a phrase matching no authored affordance sends the raw text through narrate(), unchanged', async () => {
    mGetGrounding.mockResolvedValue(GROUNDING_SINGLE_EDGE);
    render(<PlayPage />);
    await screen.findByRole('textbox');

    await sendMessage('I hum a little tune to myself.');

    expect(mAdvanceScene).not.toHaveBeenCalled();
    expect(mResolveCheck).not.toHaveBeenCalled();
    await waitFor(() => expect(mStream).toHaveBeenCalledTimes(1));
    expect(mStream.mock.calls[0][0]).toMatchObject({
      message: 'I hum a little tune to myself.',
      mechanics: '',
    });
  });

  it('an ambiguous "I move on" at a fork falls through to narrate() rather than guessing a branch', async () => {
    mGetGrounding.mockResolvedValue(GROUNDING_FORK);
    render(<PlayPage />);
    await screen.findByRole('button', { name: /Follow the smoke/i });

    await sendMessage('I move on');

    expect(mAdvanceScene).not.toHaveBeenCalled();
    await waitFor(() => expect(mStream).toHaveBeenCalledTimes(1));
    expect(mStream.mock.calls[0][0].message).toBe('I move on');
  });
});

// ── offered_check surfacing (§A.5/§A.6, A.2 contract) ────────────────────────

describe('P1-PLAYFIX-2 §A.5/§A.6 — offered_check surfaces the matching affordance', () => {
  it('a narrate() response carrying offeredCheck highlights the Attempt button and announces it, without auto-rolling', async () => {
    mGetGrounding.mockResolvedValue(GROUNDING_STEALTH_ONLY);
    streamOnce([
      {
        kind: 'chunk',
        text: 'The undergrowth rustles. A Stealth check would serve you well here.',
        offeredCheck: { skill: 'stealth', dc: 12 },
      },
      { kind: 'done' },
    ]);
    render(<PlayPage />);
    await screen.findByRole('textbox');

    // Free text that names no scene affordance — always reaches narrate()
    // and its offeredCheck signal (there's no fast-path check branch to
    // short-circuit to anymore; see the "checks never fast-path" describe
    // block above).
    await sendMessage('I pause and listen carefully to the noise.');

    await waitFor(() =>
      expect(screen.getByText('Suzu invited this check.')).toBeInTheDocument(),
    );
    // Iro MINOR-2: this is an ACTIONABLE prompt (find + reach the button) —
    // it gets the longer 8s toast duration, not the default.
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        tone: 'info',
        message: expect.stringContaining('Stealth'),
        duration: 8000,
      }),
    );

    // Never auto-rolled — resolveCheck must NOT have been called just because
    // the offer landed. The player still has to click/roll.
    expect(mResolveCheck).not.toHaveBeenCalled();
  });

  it('an offeredCheck for a skill NOT authored on this scene is never surfaced (defensive)', async () => {
    mGetGrounding.mockResolvedValue(GROUNDING_STEALTH_ONLY); // only stealth authored
    streamOnce([
      { kind: 'chunk', text: 'Something about the ground catches your eye.', offeredCheck: { skill: 'survival' } },
      { kind: 'done' },
    ]);
    render(<PlayPage />);
    await screen.findByRole('textbox');

    await sendMessage('I look around curiously.');

    await waitFor(() => expect(mStream).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('Suzu invited this check.')).not.toBeInTheDocument();
  });

  // Iro MAJOR-1: the offered_check validation must read the FRESHLY-FETCHED
  // grounding when this same beat also signals sceneAdvanced — the
  // `grounding` closure value is stale until the next render (setGrounding()
  // is async), so validating against it would wrongly drop a check authored
  // on the scene the beat JUST advanced to.
  it('a beat that BOTH advances the scene AND offers a check on the NEW scene surfaces the offer (uses fresh grounding, not the stale closure)', async () => {
    // Initial scene has no `perception` check authored; the post-advance
    // scene does. If the code validated against the stale closure, the offer
    // would be wrongly dropped as "not authored".
    mGetGrounding
      .mockResolvedValueOnce(GROUNDING_SINGLE_EDGE)
      .mockResolvedValue(GROUNDING_PERCEPTION_SCENE);
    streamOnce([
      {
        kind: 'chunk',
        text: 'The path opens into a sunlit clearing. A Perception check might reveal more.',
        sceneAdvanced: true,
        advancedTo: 'slice_everfree_clearing',
        offeredCheck: { skill: 'perception', dc: 10 },
      },
      { kind: 'done' },
    ]);
    render(<PlayPage />);
    await screen.findByRole('textbox');

    // Ambiguous text — reaches narrate() rather than the transition fast-path.
    await sendMessage('I consider what to do next.');

    await waitFor(() =>
      expect(screen.getByText('Suzu invited this check.')).toBeInTheDocument(),
    );
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ tone: 'info', message: expect.stringContaining('Perception') }),
    );
  });
});

// ── sceneAdvanced refresh signal (§A.5/§A.7) ─────────────────────────────────

describe('P1-PLAYFIX-2 §A.5/§A.7 — a narrate() sceneAdvanced signal refreshes grounding', () => {
  it('refreshes grounding (does NOT call narrate() a second time) when the response carries sceneAdvanced:true', async () => {
    mGetGrounding.mockResolvedValueOnce(GROUNDING_SINGLE_EDGE).mockResolvedValue(GROUNDING_FORK);
    streamOnce([
      {
        kind: 'chunk',
        text: 'You press deeper into the wood and the trail forks ahead.',
        sceneAdvanced: true,
        advancedTo: 'slice_everfree_fork',
      },
      { kind: 'done' },
    ]);
    render(<PlayPage />);
    await screen.findByRole('textbox');

    // Ambiguous text (not the fast-path phrase) so the beat reaches narrate().
    await sendMessage('I consider my options for a moment.');

    // grounding refetched — the fork's buttons now render (proves the client
    // learned the advance from the REFRESH, not by inferring it locally).
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Follow the smoke/i })).toBeInTheDocument(),
    );
    // Exactly one narration call — the response already narrated the
    // transition; a second narrate() call would double-narrate the beat.
    expect(mStream).toHaveBeenCalledTimes(1);
    expect(mGetGrounding.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('does NOT refresh grounding a second time when sceneAdvanced is false', async () => {
    mGetGrounding.mockResolvedValue(GROUNDING_SINGLE_EDGE);
    streamOnce([
      {
        kind: 'chunk',
        text: 'Nothing about the scene changes.',
        sceneAdvanced: false,
        advancedTo: null,
      },
      { kind: 'done' },
    ]);
    render(<PlayPage />);
    await screen.findByRole('textbox');

    const callsBefore = mGetGrounding.mock.calls.length;
    await sendMessage('I consider my options for a moment.');

    await waitFor(() => expect(mStream).toHaveBeenCalledTimes(1));
    expect(mGetGrounding.mock.calls.length).toBe(callsBefore);
  });
});

// Iro Ship 2 CRITICAL-1 (P1-PLAYFIX-2 gate fix) — narrate()'s own
// sceneAdvanced-triggered refreshGrounding() must carry the same stranded-
// focus recovery as onMoveOn/onAttemptCheck: a resolved-check or taken-
// transition button that unmounts on refresh must not strand focus on
// <body>.
describe('P1-PLAYFIX-2 gate fix (Iro CRITICAL-1) — narrate() refocuses a stranded scene heading', () => {
  it('moves focus to the scene heading when a sceneAdvanced refresh unmounts the check button the player was on', async () => {
    mGetGrounding.mockResolvedValueOnce(GROUNDING_STEALTH_ONLY).mockResolvedValue(GROUNDING_FORK);
    const { container } = render(<PlayPage />);
    await screen.findByRole('textbox');

    // DM-gated (Leon, explicit): establish Suzu's in-fiction offer first so
    // the Attempt button exists to be focused/stranded below.
    streamOnce([
      {
        kind: 'chunk',
        text: 'The undergrowth rustles. A Stealth check would serve you well here.',
        offeredCheck: { skill: 'stealth', dc: 12 },
      },
      { kind: 'done' },
    ]);
    await sendMessage('I pause and listen carefully to the noise.');
    const stealthBtn = await screen.findByRole('button', { name: /Attempt Stealth/i });

    // The player was focused on the check button (keyboard nav or a prior
    // click) at the moment they sent this free-text beat — sendMessage()
    // below only fires change/keyDown on the textbox, which in jsdom does
    // NOT move document.activeElement off whatever was last .focus()'d.
    act(() => stealthBtn.focus());
    expect(stealthBtn).toHaveFocus();

    streamOnce([
      {
        kind: 'chunk',
        text: 'You slip past and the path opens onto a fork ahead.',
        sceneAdvanced: true,
        advancedTo: 'slice_everfree_fork',
      },
      { kind: 'done' },
    ]);
    await sendMessage('I consider what to do next.');

    // The check row (and its button) unmounts once grounding refreshes to
    // the checks-free fork scene — focus must land on the scene heading.
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /Attempt Stealth/i })).not.toBeInTheDocument();
    });
    const sceneHead = container.querySelector('[aria-label^="Scene:"]');
    await waitFor(() => expect(document.activeElement).toBe(sceneHead));
  });
});

// ── Fork buttons regression lock (§A.3) ──────────────────────────────────────

describe('P1-PLAYFIX-2 §A.3 — fork renders two distinct buttons (regression)', () => {
  it('both authored fork branches render as separate labelled buttons', async () => {
    mGetGrounding.mockResolvedValue(GROUNDING_FORK);
    render(<PlayPage />);

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Follow the smoke — southeast/i })).toBeInTheDocument(),
    );
    expect(
      screen.getByRole('button', { name: /Follow the path — northwest/i }),
    ).toBeInTheDocument();
  });
});
