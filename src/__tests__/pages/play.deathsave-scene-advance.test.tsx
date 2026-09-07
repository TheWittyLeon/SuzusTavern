/**
 * TAV-DEATHSAVE-SCENE-ADVANCE + WF-O-OUTCOMELINE + TAV-ARRIVAL-ON-AUTO-ADVANCE
 * (2026-08-18, playtest-fix batch; revised same day per Kage-CR review).
 *
 * THE BUG (verified live 2026-08-17): Leon's PC hit 0 HP; his death-save
 * click triggered the engine's anti-TPK rescue, which returned a
 * `scene_advance` — but the death-save branch in `onCombatAction`, unlike
 * its attack and endturn siblings, never read `res.scene_advance` at all.
 * `handleSceneAdvance` never ran: no scene-shift log line, no grounding
 * refresh, no transition narration — 65 seconds of dead air while "dying",
 * then the next scene's narration appeared out of nowhere.
 *
 * FIXES PINNED HERE:
 *   1. Death-save now reads `res.scene_advance` exactly like attack/endturn —
 *      structurally parallel branches (see `play.tav-reason-codes-combat.
 *      test.tsx` for the pre-existing attack/dodge refusal coverage this
 *      complements).
 *   2. WF-O-OUTCOMELINE T1 (Kage-CR ruling 2026-08-18): the engine delivers
 *      an authored `outcome_line` as a top-level sibling of `scene_advance`
 *      on the combat-mutation response, resolved server-side BEFORE the
 *      advance_to fork — so it can be present even when there is NO
 *      scene_advance at all (on the shipping `everfree_flight` encounter,
 *      `flee` and `victory` both author a line but have `advance_to: None`).
 *      Rendering is hoisted OUT of the scene_advance gate: every call site
 *      (onCombatAction, onEndCombat, the monster-turn effect) plays
 *      `outcome_line` whenever present, scene_advance or not.
 *   3. WF-O-OUTCOMELINE T2 (Kage-CR ruling 2026-08-18): when a scene_advance
 *      IS present, `outcome_line` and the destination's `arrival_line`
 *      STACK, in that order (outcome_line narrates leaving the old scene;
 *      arrival_line narrates entering the new one) — mirroring `onMoveOn`'s
 *      pre-existing `playRescueTransitionLine(g); if (playArrivalLine(g))
 *      return;` pair exactly (see `play.arrival-narration.test.tsx` /
 *      `play.c3-rescue-transition-line.test.tsx`). Only `playArrivalLine`
 *      gates the synthetic "Scene advance: X -> Y" beat — the 2026-08-09
 *      REPLACE ruling was scoped to arrival-line-vs-SYNTHETIC-beat, never
 *      outcome-line-vs-arrival-line. An earlier pass here wrongly made
 *      outcome_line gate the return too, which would have suppressed the
 *      hut's authored arrival_line on exactly the flight -> hut rescue this
 *      whole batch exists to fix.
 *   4. TAV-ARRIVAL-ON-AUTO-ADVANCE: `playArrivalLine` used to be reachable
 *      ONLY from `onMoveOn` (the manual "Move on" button) — a combat/auto-
 *      driven advance (death-save rescue, endturn auto-resolve, ...) played
 *      no arrival line at all even when the destination authored one. Now
 *      `handleSceneAdvance` calls it too (per the stacking order in #3).
 *
 * The attack/endturn/monster-turn outcome_line tests below are FORWARD-
 * CONTRACT PINS on the client's handling, not live-behavior claims — the
 * engine currently emits `outcome_line` only on the death-save and
 * `/combat/{id}/end` routes (verified against
 * NekoNova-DnDEngine routes/combat.py); attack/dodge/dash/endturn/
 * monster-turn responses never carry it today, so those tests document what
 * the client does IF/WHEN the engine adds it there, not what happens now.
 */
import React from 'react';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { CombatState, GroundingData, NarrationEvent, Participant, Session } from '@/lib/api/types';

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
  useReducedMotion: () => true,
}));

jest.mock('../../lib/api/dnd', () => ({
  getSession: jest.fn(),
  getSessionEvents: jest.fn(() => Promise.resolve([])),
  getSessionEventsRaw: jest.fn(() => Promise.resolve(null)),
  getParticipants: jest.fn(),
  getGrounding: jest.fn(),
  getCombatState: jest.fn(),
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
  rollDeathSave: jest.fn(),
  endCombat: jest.fn(),
  advanceScene: jest.fn(),
  setFlag: jest.fn(),
  resolveCheck: jest.fn(),
  getSessionNotes: jest.fn(() => Promise.resolve(null)),
  putSessionNotes: jest.fn(() =>
    Promise.resolve({ body: '', updated_at: '2026-01-01T00:00:00Z' }),
  ),
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
const mGetCombatState = dnd.getCombatState as jest.MockedFunction<typeof dnd.getCombatState>;
const mRollDeathSave = dnd.rollDeathSave as jest.MockedFunction<typeof dnd.rollDeathSave>;
const mAttack = dnd.attack as jest.MockedFunction<typeof dnd.attack>;
const mEndTurn = dnd.endTurn as jest.MockedFunction<typeof dnd.endTurn>;
const mEndCombat = dnd.endCombat as jest.MockedFunction<typeof dnd.endCombat>;
const mStream = stream.streamDmNarration as jest.MockedFunction<typeof stream.streamDmNarration>;

const SESSION_WITH_COMBAT: Session = {
  session_id: 's1',
  channel: 'the_hollow_tide',
  status: 'active',
  dm_username: 'suzu',
  participant_usernames: ['alice'],
  player_count: 1,
  active_combat_id: 'combat-42',
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
      name: 'Anomaly',
      char_class: 'Ranger',
      level: 3,
      current_hp: 0,
      max_hp: 22,
      ac: 13,
    },
  },
];

/** The viewer's own PC, downed and dying — required for the "Roll death
 *  save" affordance to render at all (Composer's `isDying` gate). */
const COMBAT_STATE_DYING: CombatState = {
  combat_id: 'combat-42',
  session_id: 's1',
  round: 3,
  state: 'active',
  turn_index: 0,
  active_participant_id: 'p_anomaly',
  initiative: ['p_anomaly', 'p_wolf1'],
  participants: [
    {
      participant_id: 'p_anomaly',
      entity_id: 'c1',
      name: 'Anomaly',
      is_pc: true,
      initiative: 18,
      hp_current: 0,
      hp_max: 22,
      ac: 13,
      conditions: [],
      is_alive: true,
      can_be_targeted: true,
      is_active_turn: true,
      took_turn: false,
      death_saves: {
        successes: 0,
        failures: 1,
        is_downed: true,
        is_dying: true,
        is_stable: false,
        is_dead: false,
      },
    },
    {
      participant_id: 'p_wolf1',
      entity_id: 'timberwolf',
      name: 'Timberwolf',
      is_pc: false,
      initiative: 12,
      hp_current: 6,
      hp_max: 6,
      ac: 12,
      conditions: [],
      is_alive: true,
      can_be_targeted: true,
      is_active_turn: false,
      took_turn: false,
    },
  ],
  terrain: { lighting: 'dim', cover: '', hazards: [] },
  encounter_id: 'everfree_ambush',
  scene_id: 'everfree_flight',
  last_action: null,
  scene_advance: null,
};

/** Same table, but it is the PC's ordinary attack/endturn turn (not downed) —
 *  used by the outcome_line-parity tests for attack/endturn. */
const COMBAT_STATE_ACTIVE: CombatState = {
  ...COMBAT_STATE_DYING,
  participants: [
    {
      ...COMBAT_STATE_DYING.participants[0],
      hp_current: 14,
      death_saves: {
        successes: 0,
        failures: 0,
        is_downed: false,
        is_dying: false,
        is_stable: false,
        is_dead: false,
      },
    },
    COMBAT_STATE_DYING.participants[1],
  ],
};

/** State returned once the rescue/finalize resolves combat. */
const COMBAT_STATE_ENDED: CombatState = {
  ...COMBAT_STATE_DYING,
  state: 'ended',
  active_participant_id: null,
  scene_advance: null,
};

const SCENE_FROM: GroundingData = {
  scene_id: 'everfree_flight',
  scene_name: 'The Flight',
  boxed_text: 'Something is pacing you through the trees.',
  objective: 'Get clear.',
  transitions: [{ to: 'everfree_zecoras_hut', label: 'Press forward — smoke to the southeast' }],
  checks: [],
  flags: {},
  encounter_state: {},
};

const ARRIVAL_LINE =
  'The trees give out all at once, and the smell of woodsmoke arrives before the hut does.';

const OUTCOME_LINE =
  'The timberwolves scatter as something unseen drags you clear of the pack, breath ragged but alive.';

/** Destination with no authored lines at all — today's baseline behaviour. */
const SCENE_TO_PLAIN: GroundingData = {
  scene_id: 'everfree_zecoras_hut',
  scene_name: "Zecora's Hut",
  boxed_text: 'Bottles hang from the eaves, catching what light there is.',
  objective: 'Work out where you are.',
  transitions: [],
  checks: [],
  flags: {},
  encounter_state: {},
};

/** Destination carrying only an authored arrival line. */
const SCENE_TO_ARRIVAL: GroundingData = { ...SCENE_TO_PLAIN, arrival_line: ARRIVAL_LINE };

function streamOnce(events: NarrationEvent[]) {
  mStream.mockImplementation(async function* () {
    for (const e of events) yield e;
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mGetSession.mockResolvedValue(SESSION_WITH_COMBAT);
  mGetParticipants.mockResolvedValue(PARTY);
  streamOnce([{ kind: 'chunk', text: 'The fight continues.' }, { kind: 'done' }]);
});

async function clickDeathSave() {
  await waitFor(() =>
    expect(screen.getByRole('button', { name: /Roll death save/i })).toBeInTheDocument(),
  );
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /Roll death save/i }));
  });
}

describe('TAV-DEATHSAVE-SCENE-ADVANCE — death-save reads scene_advance like attack/endturn', () => {
  it('a rescue-triggered scene_advance is surfaced: scene-shift log, grounding refresh, transition narration', async () => {
    mGetCombatState.mockResolvedValue(COMBAT_STATE_DYING);
    mGetGrounding.mockResolvedValueOnce(SCENE_FROM).mockResolvedValue(SCENE_TO_PLAIN);
    mRollDeathSave.mockResolvedValue({
      message: 'You stabilize — someone drags you clear.',
      state: COMBAT_STATE_ENDED,
      scene_advance: { from_scene: 'everfree_flight', to_scene: 'everfree_zecoras_hut', outcome: 'rescue' },
    });
    render(<PlayPage />);
    await screen.findByText('The Hollow Tide');

    await clickDeathSave();

    // The system log line handleSceneAdvance appends — proves the branch was
    // actually reached, not just that the roll's own message rendered.
    expect(
      await screen.findByText('The scene shifts: everfree_flight → everfree_zecoras_hut (rescue)'),
    ).toBeInTheDocument();
    // Grounding refreshed: mount + handleSceneAdvance's own refresh + the
    // pre-existing "combat ended -> refresh for the Move on affordance" call.
    await waitFor(() => expect(mGetGrounding).toHaveBeenCalledTimes(3));
    // Two narration beats: the roll's own reaction, then (neither outcome_line
    // nor arrival_line authored here) the generic transition fallback.
    await waitFor(() => expect(mStream).toHaveBeenCalledTimes(2));
    expect(mStream.mock.calls[0][0].message).toBe('I roll a death save.');
    expect(mStream.mock.calls[1][0].message).toBe('The scene changes.');
  });

  it('an ordinary death-save roll with no scene_advance behaves exactly as before (regression)', async () => {
    mGetCombatState.mockResolvedValue(COMBAT_STATE_DYING);
    mGetGrounding.mockResolvedValue(SCENE_FROM);
    mRollDeathSave.mockResolvedValue({
      message: 'You roll a 14. 1 success.',
      state: {
        ...COMBAT_STATE_DYING,
        participants: [
          {
            ...COMBAT_STATE_DYING.participants[0],
            death_saves: {
              successes: 1,
              failures: 1,
              is_downed: true,
              is_dying: true,
              is_stable: false,
              is_dead: false,
            },
          },
          COMBAT_STATE_DYING.participants[1],
        ],
      },
      // No scene_advance key at all — the overwhelming majority of rolls.
    });
    render(<PlayPage />);
    await screen.findByText('The Hollow Tide');

    await clickDeathSave();

    await screen.findByText('You roll a 14. 1 success.');
    expect(screen.queryByText(/The scene shifts:/)).not.toBeInTheDocument();
    // handleSceneAdvance never ran, so refreshGrounding was never called from
    // it — only the mount-time fetch (combat stayed 'active', so the
    // "combat ended" refresh doesn't fire either).
    expect(mGetGrounding).toHaveBeenCalledTimes(1);
    // The roll's own reaction beat still fires — only the scene-advance
    // machinery (log line, grounding refresh, transition beat) is absent.
    await waitFor(() => expect(mStream).toHaveBeenCalledTimes(1));
    expect(mStream.mock.calls[0][0].message).toBe('I roll a death save.');
  });
});

describe('WF-O-OUTCOMELINE (T2) — outcome_line renders on a scene_advance; only arrival_line gates the generic beat', () => {
  it('death-save: outcome_line renders as its own beat; the generic transition beat STILL fires when the destination has no arrival_line', async () => {
    mGetCombatState.mockResolvedValue(COMBAT_STATE_DYING);
    mGetGrounding.mockResolvedValueOnce(SCENE_FROM).mockResolvedValue(SCENE_TO_PLAIN);
    mRollDeathSave.mockResolvedValue({
      message: 'You stabilize — someone drags you clear.',
      state: COMBAT_STATE_ENDED,
      scene_advance: { from_scene: 'everfree_flight', to_scene: 'everfree_zecoras_hut', outcome: 'rescue' },
      outcome_line: OUTCOME_LINE,
    });
    render(<PlayPage />);
    await screen.findByText('The Hollow Tide');

    await clickDeathSave();

    expect(await screen.findByText(OUTCOME_LINE)).toBeInTheDocument();
    await waitFor(() => expect(mGetGrounding).toHaveBeenCalledTimes(3));
    // T2: outcome_line does NOT gate the synthetic beat by itself — only
    // playArrivalLine does, and SCENE_TO_PLAIN authors no arrival_line, so
    // three beats total: the roll's own reaction, then the generic
    // transition fallback (outcome_line is a log row, not a stream call).
    await waitFor(() => expect(mStream).toHaveBeenCalledTimes(2));
    expect(mStream.mock.calls[0][0].message).toBe('I roll a death save.');
    expect(mStream.mock.calls[1][0].message).toBe('The scene changes.');
  });

  it('death-save: an over-400-char outcome_line is dropped (warns) and falls through to arrival_line/the generic beat, in that order', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mGetCombatState.mockResolvedValue(COMBAT_STATE_DYING);
    // No arrival_line authored either — proves the >400 drop falls all the
    // way through to the generic beat, not straight to it (comment
    // correction, Kage-CR 2026-08-18): the code path it falls through is
    // playArrivalLine first, which also finds nothing here and returns
    // false, THEN the generic beat.
    mGetGrounding.mockResolvedValueOnce(SCENE_FROM).mockResolvedValue(SCENE_TO_PLAIN);
    mRollDeathSave.mockResolvedValue({
      message: 'You stabilize — someone drags you clear.',
      state: COMBAT_STATE_ENDED,
      scene_advance: { from_scene: 'everfree_flight', to_scene: 'everfree_zecoras_hut', outcome: 'rescue' },
      outcome_line: 'x'.repeat(401),
    });
    render(<PlayPage />);
    await screen.findByText('The Hollow Tide');

    await clickDeathSave();

    await waitFor(() => expect(mStream).toHaveBeenCalledTimes(2));
    expect(mStream.mock.calls[1][0].message).toBe('The scene changes.');
    expect(screen.queryByText(/^x+$/)).not.toBeInTheDocument();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringMatching(/\[outcome_line\].*401 chars.*dropped/),
    );
    warnSpy.mockRestore();
  });

  it('death-save: an over-400-char outcome_line falls through to a destination arrival_line when one IS authored', async () => {
    // Same drop as above, but this time the destination DOES author an
    // arrival_line — proving the fallthrough lands there first, not at the
    // generic beat, exactly as the corrected comment states.
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mGetCombatState.mockResolvedValue(COMBAT_STATE_DYING);
    mGetGrounding.mockResolvedValueOnce(SCENE_FROM).mockResolvedValue(SCENE_TO_ARRIVAL);
    mRollDeathSave.mockResolvedValue({
      message: 'You stabilize — someone drags you clear.',
      state: COMBAT_STATE_ENDED,
      scene_advance: { from_scene: 'everfree_flight', to_scene: 'everfree_zecoras_hut', outcome: 'rescue' },
      outcome_line: 'x'.repeat(401),
    });
    render(<PlayPage />);
    await screen.findByText('The Hollow Tide');

    await clickDeathSave();

    expect(await screen.findByText(ARRIVAL_LINE)).toBeInTheDocument();
    // arrival_line gated the return — no generic beat, only the roll's own.
    await waitFor(() => expect(mStream).toHaveBeenCalledTimes(1));
    warnSpy.mockRestore();
  });

  // FORWARD-CONTRACT PIN (see file header) — the engine does not emit
  // outcome_line on /combat/attack today; this pins the client's handling
  // for if/when it does, not current live behaviour.
  it('attack: outcome_line stacks the same way as death-save — not death-save-only', async () => {
    mGetCombatState.mockResolvedValue(COMBAT_STATE_ACTIVE);
    mGetGrounding.mockResolvedValueOnce(SCENE_FROM).mockResolvedValue(SCENE_TO_PLAIN);
    mAttack.mockResolvedValue({
      message: 'You attack Timberwolf. (kill)',
      state: COMBAT_STATE_ENDED,
      scene_advance: { from_scene: 'everfree_flight', to_scene: 'everfree_zecoras_hut', outcome: 'victory' },
      outcome_line: OUTCOME_LINE,
    });
    render(<PlayPage />);
    await screen.findByText('The Hollow Tide');

    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: /Attack/i }).length).toBeGreaterThan(0),
    );
    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: /Attack/i })[0]);
    });
    await waitFor(() => screen.getByRole('menu'));
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: /Timberwolf/i }));
    });

    expect(await screen.findByText(OUTCOME_LINE)).toBeInTheDocument();
    await waitFor(() => expect(mStream).toHaveBeenCalledTimes(2));
    expect(mStream.mock.calls[0][0].message).toBe('I attack Timberwolf.');
    expect(mStream.mock.calls[1][0].message).toBe('The scene changes.');
  });

  // FORWARD-CONTRACT PIN (see file header) — the engine does not emit
  // outcome_line on /combat/endturn today; this pins the client's handling
  // for if/when it does, not current live behaviour.
  it('endturn: outcome_line stacks the same way as death-save', async () => {
    mGetCombatState.mockResolvedValue(COMBAT_STATE_ACTIVE);
    mGetGrounding.mockResolvedValueOnce(SCENE_FROM).mockResolvedValue(SCENE_TO_PLAIN);
    mEndTurn.mockResolvedValue({
      message: 'You end your turn.',
      state: COMBAT_STATE_ENDED,
      scene_advance: { from_scene: 'everfree_flight', to_scene: 'everfree_zecoras_hut', outcome: 'flee' },
      outcome_line: OUTCOME_LINE,
    });
    render(<PlayPage />);
    await screen.findByText('The Hollow Tide');

    await waitFor(() => expect(screen.getByRole('button', { name: 'End turn' })).toBeInTheDocument());
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'End turn' }));
    });

    expect(await screen.findByText(OUTCOME_LINE)).toBeInTheDocument();
    await waitFor(() => expect(mStream).toHaveBeenCalledTimes(2));
    expect(mStream.mock.calls[0][0].message).toBe('I end my turn.');
    expect(mStream.mock.calls[1][0].message).toBe('The scene changes.');
  });
});

describe('TAV-ARRIVAL-ON-AUTO-ADVANCE — playArrivalLine reachable from combat-driven advances', () => {
  it('a death-save rescue landing on a scene with an authored arrival_line plays it (previously played nothing)', async () => {
    mGetCombatState.mockResolvedValue(COMBAT_STATE_DYING);
    mGetGrounding.mockResolvedValueOnce(SCENE_FROM).mockResolvedValue(SCENE_TO_ARRIVAL);
    mRollDeathSave.mockResolvedValue({
      message: 'You stabilize — someone drags you clear.',
      state: COMBAT_STATE_ENDED,
      scene_advance: { from_scene: 'everfree_flight', to_scene: 'everfree_zecoras_hut', outcome: 'rescue' },
      // No outcome_line authored on THIS resolution — arrival_line is the
      // only authored content for the seam.
    });
    render(<PlayPage />);
    await screen.findByText('The Hollow Tide');

    await clickDeathSave();

    expect(await screen.findByText(ARRIVAL_LINE)).toBeInTheDocument();
    // Roll's own reaction beat still fires; the generic transition beat does
    // not — the arrival line replaced it.
    await waitFor(() => expect(mStream).toHaveBeenCalledTimes(1));
    expect(mStream.mock.calls[0][0].message).toBe('I roll a death save.');
  });

  it('T2: outcome_line and arrival_line STACK, outcome_line first, when both are authored for the same rescue transition', async () => {
    // This is the exact motivating scenario: the hut (destination) authors
    // BOTH an arrival_line (place) and the rescue resolves with its own
    // outcome_line (event) — Kage-CR's ruling is that these are two
    // different narrative beats and must both render, mirroring onMoveOn's
    // pre-existing playRescueTransitionLine + playArrivalLine stacking.
    mGetCombatState.mockResolvedValue(COMBAT_STATE_DYING);
    mGetGrounding.mockResolvedValueOnce(SCENE_FROM).mockResolvedValue(SCENE_TO_ARRIVAL);
    mRollDeathSave.mockResolvedValue({
      message: 'You stabilize — someone drags you clear.',
      state: COMBAT_STATE_ENDED,
      scene_advance: { from_scene: 'everfree_flight', to_scene: 'everfree_zecoras_hut', outcome: 'rescue' },
      outcome_line: OUTCOME_LINE,
    });
    render(<PlayPage />);
    await screen.findByText('The Hollow Tide');

    await clickDeathSave();

    // Both authored lines render — neither suppresses the other.
    expect(await screen.findByText(OUTCOME_LINE)).toBeInTheDocument();
    expect(await screen.findByText(ARRIVAL_LINE)).toBeInTheDocument();
    // Order: outcome_line (leaving the old scene) before arrival_line
    // (entering the new one).
    const body = document.body.textContent ?? '';
    expect(body.indexOf(OUTCOME_LINE)).toBeLessThan(body.indexOf(ARRIVAL_LINE));
    // arrival_line still gates the synthetic beat — only the roll's own
    // reaction beat streams; no second model call.
    await waitFor(() => expect(mStream).toHaveBeenCalledTimes(1));
    expect(mStream.mock.calls[0][0].message).toBe('I roll a death save.');
  });

  it('neither outcome_line nor arrival_line authored: the generic beat still fires (unchanged baseline)', async () => {
    mGetCombatState.mockResolvedValue(COMBAT_STATE_DYING);
    mGetGrounding.mockResolvedValueOnce(SCENE_FROM).mockResolvedValue(SCENE_TO_PLAIN);
    mRollDeathSave.mockResolvedValue({
      message: 'You stabilize — someone drags you clear.',
      state: COMBAT_STATE_ENDED,
      scene_advance: { from_scene: 'everfree_flight', to_scene: 'everfree_zecoras_hut', outcome: 'rescue' },
    });
    render(<PlayPage />);
    await screen.findByText('The Hollow Tide');

    await clickDeathSave();

    await waitFor(() => expect(mStream).toHaveBeenCalledTimes(2));
    expect(mStream.mock.calls[1][0].message).toBe('The scene changes.');
  });
});

describe('Miko QA (2026-08-18 batch validation, revised) — outcome_line boundary + T1 no-scene-advance fix', () => {
  it('outcome_line at exactly 400 chars renders (boundary passes; only 401+ was pinned by name)', async () => {
    const line400 = 'x'.repeat(400);
    mGetCombatState.mockResolvedValue(COMBAT_STATE_DYING);
    mGetGrounding.mockResolvedValueOnce(SCENE_FROM).mockResolvedValue(SCENE_TO_PLAIN);
    mRollDeathSave.mockResolvedValue({
      message: 'You stabilize — someone drags you clear.',
      state: COMBAT_STATE_ENDED,
      scene_advance: { from_scene: 'everfree_flight', to_scene: 'everfree_zecoras_hut', outcome: 'rescue' },
      outcome_line: line400,
    });
    render(<PlayPage />);
    await screen.findByText('The Hollow Tide');

    await clickDeathSave();

    expect(await screen.findByText(line400)).toBeInTheDocument();
    // T2: no arrival_line authored on SCENE_TO_PLAIN, so outcome_line does
    // not gate the generic beat on its own — two beats total.
    await waitFor(() => expect(mStream).toHaveBeenCalledTimes(2));
  });

  // T1 CLOSES THE GAP Miko's original pass pinned as a documented
  // limitation: "outcome_line with scene_advance=null (a same-scene
  // victory/flee resolution — the engine supports this per
  // WF-O-OUTCOMELINE, advance_to can be null while outcome_line is still
  // populated) is silently dropped, because every call site gated on
  // `if (res.scene_advance)` first." That gate is now hoisted (T1,
  // Kage-CR ruling 2026-08-18) — this test flips from a documented-drop pin
  // to a documented-render pin. Uses the SAME fixture shape as the original
  // pin so the flip is a direct, auditable diff of that test.
  it('T1: outcome_line with scene_advance=null (a same-scene victory/flee resolution) now RENDERS, with no scene-shift log line', async () => {
    mGetCombatState.mockResolvedValue(COMBAT_STATE_ACTIVE);
    mGetGrounding.mockResolvedValue(SCENE_FROM);
    mAttack.mockResolvedValue({
      message: 'You attack Timberwolf. (victory)',
      state: COMBAT_STATE_ENDED,
      scene_advance: null,
      outcome_line: OUTCOME_LINE,
    });
    render(<PlayPage />);
    await screen.findByText('The Hollow Tide');

    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: /Attack/i }).length).toBeGreaterThan(0),
    );
    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: /Attack/i })[0]);
    });
    await waitFor(() => screen.getByRole('menu'));
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: /Timberwolf/i }));
    });

    // The authored victory line now reaches the transcript...
    expect(await screen.findByText(OUTCOME_LINE)).toBeInTheDocument();
    // ...with no "The scene shifts: ..." log line (handleSceneAdvance was
    // never invoked — there is no scene to shift to). Grounding is still
    // refreshed once by the pre-existing "combat ended -> refresh for the
    // Move on affordance" call (COMBAT_STATE_ENDED here) — playOutcomeLine
    // itself renders directly off the response and never touches grounding.
    expect(screen.queryByText(/The scene shifts:/)).not.toBeInTheDocument();
    expect(mGetGrounding).toHaveBeenCalledTimes(2);
    // ...and no synthetic transition beat fires either — only the attack's
    // own reaction beat streams.
    await waitFor(() => expect(mStream).toHaveBeenCalledTimes(1));
    expect(mStream.mock.calls[0][0].message).toBe('I attack Timberwolf.');
  });
});

describe('T1 LIVE PATH (Kage-CR re-review 2026-08-18) — onEndCombat, not just the mAttack forward-contract pin', () => {
  // POST /combat/{id}/end emits outcome_line unconditionally today (engine
  // routes/combat.py, the DM-gated finalize route) — onEndCombat -> endCombat()
  // is exactly how a victory/flee resolution reaches the client, unlike the
  // mAttack/mEndTurn tests above (forward-contract pins on a route that
  // doesn't emit outcome_line yet). This is the one call site where deleting
  // `playOutcomeLine(result.outcome_line)` from the else-branch would be a
  // LIVE regression, not a speculative one — verified to catch that mutation
  // (commented the call out locally, confirmed this test reds, restored).
  it('outcome_line with scene_advance: null renders verbatim, with no "The scene shifts:" row', async () => {
    mGetCombatState.mockResolvedValue(COMBAT_STATE_ACTIVE);
    mGetGrounding.mockResolvedValue(SCENE_FROM);
    mEndCombat.mockResolvedValue({
      state: COMBAT_STATE_ENDED,
      outcome: 'flee',
      scene_advance: null,
      outcome_line: OUTCOME_LINE,
    });
    render(<PlayPage />);
    await screen.findByText('The Hollow Tide');

    const endBtn = await screen.findByRole('button', { name: /End combat — choose outcome/i });
    await act(async () => {
      fireEvent.click(endBtn);
    });
    await screen.findByRole('group', { name: /Choose combat outcome/i });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Flee\b/i }));
    });

    expect(await screen.findByText(OUTCOME_LINE)).toBeInTheDocument();
    // No scene_advance -> handleSceneAdvance never ran -> no scene-shift log.
    expect(screen.queryByText(/The scene shifts:/)).not.toBeInTheDocument();
  });
});
