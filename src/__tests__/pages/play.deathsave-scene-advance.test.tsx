/**
 * TAV-DEATHSAVE-SCENE-ADVANCE + WF-O-OUTCOMELINE + TAV-ARRIVAL-ON-AUTO-ADVANCE
 * (2026-08-18, playtest-fix batch).
 *
 * THE BUG (verified live 2026-08-17): Leon's PC hit 0 HP; his death-save
 * click triggered the engine's anti-TPK rescue, which returned a
 * `scene_advance` — but the death-save branch in `onCombatAction`, unlike
 * its attack and endturn siblings, never read `res.scene_advance` at all.
 * `handleSceneAdvance` never ran: no scene-shift log line, no grounding
 * refresh, no transition narration — 65 seconds of dead air while "dying",
 * then the next scene's narration appeared out of nowhere.
 *
 * THREE FIXES PINNED HERE:
 *   1. Death-save now reads `res.scene_advance` exactly like attack/endturn —
 *      structurally parallel branches (see `play.tav-reason-codes-combat.
 *      test.tsx` for the pre-existing attack/dodge refusal coverage this
 *      complements).
 *   2. WF-O-OUTCOMELINE: the engine now delivers an authored `outcome_line`
 *      as a top-level sibling of `scene_advance` on the SAME response — when
 *      present, it IS the transition narration and REPLACES the synthetic
 *      "Scene advance: X -> Y. Narrate the transition." beat, mirroring
 *      DM-ARRIVAL-NARRATION's "REPLACE the beat" ruling (Leon, 2026-08-09;
 *      see `play.arrival-narration.test.tsx`). Applies to every branch that
 *      processes scene_advance, not just death-save.
 *   3. TAV-ARRIVAL-ON-AUTO-ADVANCE: `playArrivalLine` used to be reachable
 *      ONLY from `onMoveOn` (the manual "Move on" button) — a combat/auto-
 *      driven advance (death-save rescue, endturn auto-resolve, ...) played
 *      no arrival line at all even when the destination authored one. Now
 *      `handleSceneAdvance` calls it too, with the same "REPLACE, never
 *      stack" semantics — outcome_line wins if both are authored for the
 *      same transition.
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

describe('WF-O-OUTCOMELINE — outcome_line replaces the generic transition beat', () => {
  it('death-save: outcome_line plays verbatim and the synthetic beat is skipped', async () => {
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
    // The whole point of the REPLACE ruling: only the roll's own reaction
    // beat fires — no second model call narrates the transition too.
    await waitFor(() => expect(mStream).toHaveBeenCalledTimes(1));
    expect(mStream.mock.calls[0][0].message).toBe('I roll a death save.');
  });

  it('death-save: an over-400-char outcome_line is dropped (warns) and falls through to the generic beat', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mGetCombatState.mockResolvedValue(COMBAT_STATE_DYING);
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

  it('attack: outcome_line also replaces the generic beat — not death-save-only', async () => {
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
    await waitFor(() => expect(mStream).toHaveBeenCalledTimes(1));
    expect(mStream.mock.calls[0][0].message).toBe('I attack Timberwolf.');
  });

  it('endturn: outcome_line also replaces the generic beat', async () => {
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
    await waitFor(() => expect(mStream).toHaveBeenCalledTimes(1));
    expect(mStream.mock.calls[0][0].message).toBe('I end my turn.');
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

  it('outcome_line takes priority over arrival_line when both are authored for the same transition — never stacked', async () => {
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

    expect(await screen.findByText(OUTCOME_LINE)).toBeInTheDocument();
    // Exactly one authored beat renders — never both for the same seam.
    expect(screen.queryByText(ARRIVAL_LINE)).not.toBeInTheDocument();
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
