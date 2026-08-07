/**
 * TAV-SCENE-TRANSITION-LEAKS-FLAG-SLUG (2026-08-06) — Tavern side.
 *
 * The seed adventures spelled the gate `requires_flag`, a key NOTHING reads.
 * Both gated transitions in hollow-tide-cave.json were therefore always
 * offered, and the machine slug in the label ("… (requires lookout_spotted)")
 * was the only hint a gate was intended.
 *
 * The fix is DATA, not client code: the labels lost the slug and the key
 * became `requires: [flag]`, which the engine already implements —
 * `engine/beats.py::transition_available` evaluates it and
 * `routes/sessions.py` REPLACES `current_scene["transitions"]` with the
 * available subset before grounding reaches the wire. (Kage-CR blocking
 * finding #1, 2026-08-06: an earlier revision of this batch added a
 * client-side gate instead. That was the wrong layer — it duplicated a
 * server mechanism in a second vocabulary, and worse, it hid the exit from
 * the PLAYER while the narrator kept reading the unfiltered list and could
 * still invite them to take it.)
 *
 * So the Tavern's contract is now: RENDER WHAT GROUNDING GIVES YOU. These
 * tests pin exactly that, because the tempting "fix" for a future reader who
 * sees `requires` in the payload is to re-add a client filter and re-create
 * the narrator divergence. The server-side gate behaviour itself is proved
 * in the engine repo (tests/test_seed_adventure_authoring.py).
 */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
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
  getSessionNotes: jest.fn(() => Promise.resolve(null)),
  putSessionNotes: jest.fn(() => Promise.resolve({ body: '', updated_at: '2026-01-01T00:00:00Z' })),
}));

jest.mock('../../lib/stream', () => ({
  streamDmNarration: jest.fn(async function* () {
    yield { kind: 'done' as const };
  }),
}));

import * as dnd from '@/lib/api/dnd';
import * as stream from '@/lib/stream';
import PlayPage from '@/app/play/[sessionId]/page';

const mGetSession = dnd.getSession as jest.MockedFunction<typeof dnd.getSession>;
const mGetParticipants = dnd.getParticipants as jest.MockedFunction<typeof dnd.getParticipants>;
const mGetGrounding = dnd.getGrounding as jest.MockedFunction<typeof dnd.getGrounding>;
const mGetSessionEvents = dnd.getSessionEvents as jest.MockedFunction<typeof dnd.getSessionEvents>;
const mGetSessionEventsRaw = dnd.getSessionEventsRaw as jest.MockedFunction<
  typeof dnd.getSessionEventsRaw
>;
const mStream = stream.streamDmNarration as jest.MockedFunction<typeof stream.streamDmNarration>;

const SESSION: Session = {
  session_id: 's1',
  channel: 'hollow_tide',
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
      name: 'Seth',
      char_class: 'Ranger',
      level: 3,
      current_hp: 20,
      max_hp: 20,
      ac: 15,
    },
  },
];

/** Grounding EXACTLY as the engine hands it over: `routes/sessions.py` has
 *  already dropped any transition whose `requires` is unmet, so a gated exit
 *  present here is one the server decided is OPEN. `flags` is passed through
 *  verbatim and is deliberately varied across these tests to prove the client
 *  does NOT second-guess the server with a filter of its own. */
function groundingFromServer(
  flags: Record<string, unknown>,
  transitions: GroundingData['transitions'],
): GroundingData {
  return {
    scene_id: 'cave_mouth',
    scene_name: 'Cave Mouth',
    boxed_text: 'The tide has carved a hollow into the cliff.',
    transitions,
    checks: [],
    flags,
    encounter_state: {},
  };
}

/** What reaches the page once `lookout_spotted` is set: the gated exit is
 *  included, and `requires` is NOT present — the BFF projection in
 *  `src/lib/api/dnd.ts` drops it (2026-08-06), because the engine has already
 *  applied it and shipping it would only invite a client re-filter. The
 *  projection itself is tested in `src/__tests__/lib/api-dnd-transitions.test.ts`;
 *  these cases prove the page renders what it is handed either way. */
const SERVED_WITH_GATED: GroundingData['transitions'] = [
  { to: 'cave_mouth', label: 'Ambush the lookout first' },
  { to: 'exit', label: 'Just walk away' },
];

/** What the server sends while the flag is unmet: it stripped the exit. */
const SERVED_WITHOUT_GATED: GroundingData['transitions'] = [
  { to: 'exit', label: 'Just walk away' },
];

function streamOnce(events: NarrationEvent[]) {
  mStream.mockImplementation(async function* () {
    for (const e of events) yield e;
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mGetSession.mockResolvedValue(SESSION);
  mGetParticipants.mockResolvedValue(PARTY);
  mGetSessionEvents.mockResolvedValue([]);
  mGetSessionEventsRaw.mockResolvedValue(null);
  streamOnce([{ kind: 'chunk', text: 'Suzu narrates.' }, { kind: 'done' }]);
});

const GATED_LABEL = /Ambush the lookout first/i;
const CONTROL_LABEL = /Just walk away/i;

describe('TAV-SCENE-TRANSITION-LEAKS-FLAG-SLUG — the Tavern trusts the server-filtered list', () => {
  it('the server stripped the gated exit: it is absent, control still shows', async () => {
    mGetGrounding.mockResolvedValue(groundingFromServer({}, SERVED_WITHOUT_GATED));
    render(<PlayPage />);

    await waitFor(() =>
      expect(screen.getByRole('button', { name: CONTROL_LABEL })).toBeInTheDocument(),
    );
    expect(screen.queryByRole('button', { name: GATED_LABEL })).not.toBeInTheDocument();
  });

  it('the server included the gated exit: it renders', async () => {
    mGetGrounding.mockResolvedValue(
      groundingFromServer({ lookout_spotted: true }, SERVED_WITH_GATED),
    );
    render(<PlayPage />);

    await waitFor(() =>
      expect(screen.getByRole('button', { name: GATED_LABEL })).toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: CONTROL_LABEL })).toBeInTheDocument();
  });

  // ── The anti-regression core of this file ────────────────────────────────
  // Each of the three below sends a transition the SERVER chose to include,
  // paired with a `flags` map that a client-side gate would read as "locked".
  // They pass only while the Tavern does no flag filtering of its own. Re-add
  // the client gate Kage-CR removed and all three go red.

  it('flags ABSENT for a served gated exit: still renders (no client re-filtering)', async () => {
    mGetGrounding.mockResolvedValue(groundingFromServer({}, SERVED_WITH_GATED));
    render(<PlayPage />);

    await waitFor(() =>
      expect(screen.getByRole('button', { name: GATED_LABEL })).toBeInTheDocument(),
    );
  });

  it('flag explicitly FALSE but the exit was served: still renders — the server is the authority', async () => {
    mGetGrounding.mockResolvedValue(
      groundingFromServer({ lookout_spotted: false }, SERVED_WITH_GATED),
    );
    render(<PlayPage />);

    await waitFor(() =>
      expect(screen.getByRole('button', { name: GATED_LABEL })).toBeInTheDocument(),
    );
  });

  it('grounding.flags entirely undefined does not crash and does not suppress a served exit', async () => {
    const grounding = groundingFromServer({}, SERVED_WITH_GATED);
    delete (grounding as { flags?: Record<string, unknown> }).flags;
    mGetGrounding.mockResolvedValue(grounding);
    render(<PlayPage />);

    await waitFor(() =>
      expect(screen.getByRole('button', { name: GATED_LABEL })).toBeInTheDocument(),
    );
  });

  it('the label carries NO machine slug (the actual reported defect)', async () => {
    mGetGrounding.mockResolvedValue(
      groundingFromServer({ lookout_spotted: true }, SERVED_WITH_GATED),
    );
    render(<PlayPage />);

    const btn = await screen.findByRole('button', { name: GATED_LABEL });
    expect(btn).toHaveTextContent('Ambush the lookout first');
    expect(btn.textContent).not.toMatch(/requires_?/i);
    expect(btn.textContent).not.toMatch(/lookout_spotted/);
  });

  it('ZERO available transitions: the Move-on group unmounts cleanly, nothing throws', async () => {
    // Kage-CR #9 (2026-08-06). This is `back_chamber` after the gate fix: the
    // server has stripped the krell_bargained exit, and the only survivor is
    // encounter-gated with the encounter unresolved — so the client filters
    // that too and `availableTransitions` is empty. Worth pinning in jsdom
    // rather than leaving to the browser pass: a manual playtest is a one-shot
    // event, not a regression net, and an empty list is exactly the shape that
    // tends to throw on `[0]`/`.map` in a later refactor.
    mGetGrounding.mockResolvedValue(
      groundingFromServer({}, [
        { to: 'exit', label: 'Lead the crew out', requires_encounter_resolved: 'krell_band' },
      ]),
    );
    render(<PlayPage />);

    // Wait for grounding to have been consumed at all, so this cannot pass
    // merely because the page had not finished loading.
    await waitFor(() => expect(mGetGrounding).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.getByText(/The tide has carved a hollow into the cliff\./i)).toBeInTheDocument(),
    );

    expect(screen.queryByRole('button', { name: /Lead the crew out/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: GATED_LABEL })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: CONTROL_LABEL })).not.toBeInTheDocument();
  });

  it('the encounter gate — the one client-side gate that IS real — still filters', async () => {
    // `requires_encounter_resolved` has no engine equivalent, so unlike the
    // flag gate it must stay client-side. Guard against removing it by
    // over-applying the "trust the server" rule above.
    mGetGrounding.mockResolvedValue(
      groundingFromServer({}, [
        { to: 'exit', label: 'Lead the crew out', requires_encounter_resolved: 'krell_band' },
        { to: 'exit', label: 'Just walk away' },
      ]),
    );
    render(<PlayPage />);

    await waitFor(() =>
      expect(screen.getByRole('button', { name: CONTROL_LABEL })).toBeInTheDocument(),
    );
    expect(screen.queryByRole('button', { name: /Lead the crew out/i })).not.toBeInTheDocument();
  });
});
