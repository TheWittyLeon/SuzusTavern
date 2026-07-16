/**
 * DDX-20 Pass 3 — synthetic-beat coverage (Miko-QA adversarial gate on
 * commit 3edd2d7, `overnight/tavern-integration-2026-07-09`).
 *
 * Pass 3 (Synthetic-Beat Design §8) specifies six test categories for the
 * six non-composer beat call sites (roll-confirm, scene-transition x2,
 * check-confirm, combat-start, end-turn) once routed through
 * `narrateDurableBeat`. As shipped in 3edd2d7, NONE of those categories are
 * exercised through an actual beat call site with the flag ON — the only
 * new test added by the commit is a pure-function reconcileEvents.ts unit
 * test that never touches `narrateDurableBeat`, `postDmTurn`, or any of the
 * six call sites (onRoll/handleSceneAdvance/onMoveOn/onAttemptCheck/
 * beginEncounter/onCombatAction). This file closes part of that gap for the
 * roll-confirm beat (the simplest to drive through the real UI) and locks a
 * genuine defect found while probing it: a synthetic beat's failed job
 * retries through the WRONG originator function, silently dropping
 * `mechanics`/`suppress_intent`.
 *
 * Scope note: this file does NOT attempt beats 2-6 (scene-transition/
 * check-confirm/combat-start/end-turn) — driving those through the real UI
 * needs grounding/offered-check/combat-state fixtures beyond this pass's
 * review budget. The roll-confirm defect below is sufficient to prove the
 * shared-retry-state design flaw is real; it is not beat-specific (the
 * retry function is shared by all six call sites via the same
 * `lastDurableTurnRef`/`onRetryFailedTurn` wiring), so the same drop
 * reproduces for beats 2-6, with the added consequence for suppress_intent
 * beats (2/3/4) that a retried beat's `suppress_intent` reverts to
 * undefined/false, letting the server's INTENT classifier re-advance a
 * scene the beat's own action already advanced. See finding write-up
 * (handed to Ren-Dev) for the reasoning chain.
 */
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import type {
  Session,
  Participant,
  EventsPage,
  CombatState,
  GroundingData,
  EngineSessionEvent,
} from '@/lib/api/types';

jest.mock('next/navigation', () => ({
  useParams: () => ({ sessionId: 'sess-pass3' }),
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

// Flag ON for this whole file — mirrors play.ddx20-durable-turn.test.tsx's
// own note: config is read once at import time, not a live binding.
jest.mock('../../lib/config', () => ({
  DURABLE_GENERATION_ENABLED: true,
  OAUTH_ENABLED: false,
  CODEX_ENABLED: false,
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFn = (...args: any[]) => any;

const EMPTY_PAGE: EventsPage = { events: [], max_seq: 0, has_more: false, pending_generation: null };

const mockGetSession = jest.fn<Promise<unknown>, unknown[]>();
const mockGetSessionEvents = jest.fn<Promise<unknown[]>, unknown[]>(() => Promise.resolve([]));
const mockGetSessionEventsRaw = jest.fn<Promise<unknown[] | null>, unknown[]>(() => Promise.resolve([]));
const mockGetSessionEventsPage = jest.fn<Promise<EventsPage>, unknown[]>(() => Promise.resolve(EMPTY_PAGE));
const mockGetParticipants = jest.fn<Promise<unknown>, unknown[]>();
const mockGetGrounding = jest.fn<Promise<unknown>, unknown[]>(() => Promise.resolve(null));
const mockGetCombatState = jest.fn<Promise<unknown>, unknown[]>(() => Promise.resolve(null));
const mockGetCharacterSheet = jest.fn<Promise<unknown>, unknown[]>(() => Promise.resolve(null));
const mockPostRoll = jest.fn<Promise<unknown>, unknown[]>();
// §8 coverage-gap additions (beats 2/3/5/6) — combat + scene-transition call
// sites, mirroring combat-ui-adv78.test.tsx's fixture/mock shapes.
const mockCombatFromScene = jest.fn<Promise<unknown>, unknown[]>();
const mockRollInitiative = jest.fn<Promise<unknown>, unknown[]>(() => Promise.resolve({ message: 'Initiative rolled.' }));
const mockMonsterTurn = jest.fn<Promise<unknown>, unknown[]>(() => Promise.resolve({ message: undefined, state: null }));
const mockEndTurn = jest.fn<Promise<unknown>, unknown[]>();
const mockAdvanceScene = jest.fn<Promise<unknown>, unknown[]>();

jest.mock('../../lib/api/dnd', () => ({
  getSession: (...args: Parameters<AnyFn>) => mockGetSession(...args),
  getSessionEvents: (...args: Parameters<AnyFn>) => mockGetSessionEvents(...args),
  getSessionEventsRaw: (...args: Parameters<AnyFn>) => mockGetSessionEventsRaw(...args),
  getSessionEventsPage: (...args: Parameters<AnyFn>) => mockGetSessionEventsPage(...args),
  getParticipants: (...args: Parameters<AnyFn>) => mockGetParticipants(...args),
  getGrounding: (...args: Parameters<AnyFn>) => mockGetGrounding(...args),
  getCombatState: (...args: Parameters<AnyFn>) => mockGetCombatState(...args),
  getCharacterSheet: (...args: Parameters<AnyFn>) => mockGetCharacterSheet(...args),
  postRoll: (...args: Parameters<AnyFn>) => mockPostRoll(...args),
  postSessionEvent: jest.fn(() => Promise.resolve({})),
  combatFromScene: (...args: Parameters<AnyFn>) => mockCombatFromScene(...args),
  startCombat: jest.fn(),
  spawnMonster: jest.fn(),
  rollInitiative: (...args: Parameters<AnyFn>) => mockRollInitiative(...args),
  monsterTurn: (...args: Parameters<AnyFn>) => mockMonsterTurn(...args),
  attack: jest.fn(),
  dodge: jest.fn(),
  dash: jest.fn(),
  endTurn: (...args: Parameters<AnyFn>) => mockEndTurn(...args),
  endCombat: jest.fn(),
  advanceScene: (...args: Parameters<AnyFn>) => mockAdvanceScene(...args),
  setFlag: jest.fn(),
  resolveCheck: jest.fn(),
  getSessionNotes: jest.fn(() => Promise.resolve(null)),
  putSessionNotes: jest.fn(() => Promise.resolve({ body: '', updated_at: '2026-01-01T00:00:00Z' })),
}));

const mockStreamDmNarration = jest.fn();
const mockPostDmTurn = jest.fn();
const mockSubscribeDmJob = jest.fn();

jest.mock('../../lib/stream', () => ({
  streamDmNarration: (...args: Parameters<AnyFn>) => mockStreamDmNarration(...args),
  postDmTurn: (...args: Parameters<AnyFn>) => mockPostDmTurn(...args),
  subscribeDmJob: (...args: Parameters<AnyFn>) => mockSubscribeDmJob(...args),
}));

import PlayPage from '@/app/play/[sessionId]/page';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// ai_assist_level 'full' — required for onRoll to reach the narration branch
// at all (session.ai_assist_level !== 'off' && !== 'assist').
const AI_SESSION: Session = {
  session_id: 'sess-pass3',
  channel: 'test_channel',
  name: 'Test Table',
  status: 'active',
  dm_username: 'suzu',
  dm_mode: 'ai',
  ai_assist_level: 'full',
  active_combat_id: null,
};

const PARTY: Participant[] = [
  {
    username: 'leon',
    is_dm: false,
    character: {
      character_id: 'c1',
      name: 'Velka',
      char_class: 'Rogue',
      level: 3,
      current_hp: 18,
      max_hp: 20,
      ac: 14,
    },
  },
];

const SHEET_WITH_SKILLS = {
  character_id: 'c1',
  owner_username: 'leon',
  name: 'Velka',
  race: 'Half-Elf',
  subrace: '',
  char_class: 'Rogue',
  subclass: '',
  level: 3,
  background: 'Criminal',
  alignment: 'CN',
  ability_scores: {},
  hp: { current: 18, max: 20, temp: 0 },
  ac: 14,
  initiative: 3,
  proficiency_bonus: 2,
  speed: 30,
  xp: 900,
  xp_next: 2700,
  hit_dice_remaining: 3,
  proficient_saves: [],
  proficient_skills: ['perception'],
  class_features: [],
  conditions: [],
  spellcasting: null,
  spell_slots: {},
  is_spellcaster: false,
  inventory: [],
  inventory_weight: 0,
  skills: [{ name: 'perception', ability: 'wisdom', modifier: 3, proficient: true }],
};

// ── §8 coverage-gap fixtures (beats 2/3/5/6) — mirrors combat-ui-adv78.test.tsx ──

const AI_SESSION_WITH_COMBAT: Session = { ...AI_SESSION, active_combat_id: 'combat-1' };

/** Active combat, Velka's turn, one live goblin — same shape convention as
 *  combat-ui-adv78.test.tsx's COMBAT_STATE fixture. */
const COMBAT_STATE_ACTIVE: CombatState = {
  combat_id: 'combat-1',
  session_id: 'sess-pass3',
  round: 1,
  state: 'active',
  turn_index: 0,
  active_participant_id: 'p_velka',
  initiative: ['p_velka', 'p_gob1'],
  participants: [
    {
      participant_id: 'p_velka',
      entity_id: 'c1',
      name: 'Velka',
      is_pc: true,
      initiative: 18,
      hp_current: 18,
      hp_max: 20,
      ac: 14,
      conditions: [],
      is_alive: true,
      can_be_targeted: true,
      is_active_turn: true,
      took_turn: false,
    },
    {
      participant_id: 'p_gob1',
      entity_id: 'goblin',
      name: 'Goblin',
      is_pc: false,
      initiative: 12,
      hp_current: 7,
      hp_max: 7,
      ac: 13,
      conditions: [],
      is_alive: true,
      can_be_targeted: true,
      is_active_turn: false,
      took_turn: false,
    },
  ],
  scene_id: 'cave_mouth',
  last_action: null,
  scene_advance: null,
};

/** Combat ended WITH a scene_advance — the §3.3 "beat 6 (end-turn) ends
 *  combat, then immediately fires beat 2 (scene-advance)" sequencing. */
const COMBAT_STATE_ENDED: CombatState = {
  ...COMBAT_STATE_ACTIVE,
  state: 'ended',
  active_participant_id: null,
  participants: COMBAT_STATE_ACTIVE.participants.map((p) => ({ ...p, is_active_turn: false })),
};

const GROUNDING_WITH_TRANSITION: GroundingData = {
  scene_id: 'cave_mouth',
  scene_name: 'Cave Mouth',
  boxed_text: 'A dark cave mouth looms before you.',
  transitions: [{ to: 'tunnel', label: 'Enter the tunnel' }],
};

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function renderAndOpenScene() {
  render(<PlayPage />);
  await screen.findByText('Test Table');
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /scene/i }));
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  window.localStorage.clear();
  mockGetSession.mockResolvedValue(AI_SESSION);
  mockGetSessionEvents.mockResolvedValue([]);
  mockGetSessionEventsRaw.mockResolvedValue([]);
  mockGetSessionEventsPage.mockResolvedValue(EMPTY_PAGE);
  mockGetParticipants.mockResolvedValue(PARTY);
  mockGetGrounding.mockResolvedValue(null);
  mockGetCombatState.mockResolvedValue(null);
  mockGetCharacterSheet.mockResolvedValue(SHEET_WITH_SKILLS);
  mockPostRoll.mockResolvedValue({
    kind: 'skill',
    notation: null,
    skill: 'perception',
    ability: null,
    character_id: 'c1',
    modifier: 3,
    advantage: 'straight',
    rolls: [15],
    kept: 15,
    total: 18,
    description: 'Perception check: rolled 15 + 3 = 18.',
    event_seq: 1,
  });
});

describe('Pass-3 synthetic beat #1 (roll-confirm) — flag ON', () => {
  it('routes through narrateDurableBeat: postDmTurn carries the roll mechanics + a fresh turn_key, NOT legacy streamDmNarration', async () => {
    mockPostDmTurn.mockResolvedValue({
      job_id: 'job-roll-1',
      turn_key: 'ignored',
      status: 'pending',
      deduped: false,
    });
    mockSubscribeDmJob.mockImplementation(async function* () {
      yield { kind: 'done' };
    });

    await renderAndOpenScene();
    const perceptionBtn = await screen.findByRole('button', { name: /perception/i });

    await act(async () => {
      fireEvent.click(perceptionBtn);
    });
    await flush();

    // The mechanical roll always posts, flag-agnostic.
    expect(mockPostRoll).toHaveBeenCalledTimes(1);

    // Flag-ON: the narration MUST go through the durable path, never legacy
    // SSE generate-and-stream.
    expect(mockStreamDmNarration).not.toHaveBeenCalled();
    expect(mockPostDmTurn).toHaveBeenCalledTimes(1);
    const body = mockPostDmTurn.mock.calls[0][0];
    expect(body).toMatchObject({
      username: 'leon',
      channel: 'test_channel',
      session_id: 'sess-pass3',
      message: 'I roll Perception.',
      mechanics: 'Perception check: rolled 15 + 3 = 18. Narrate the outcome.',
      mode: 'act',
      suppress_intent: false,
    });
    expect(body.turn_key).toMatch(UUID_RE);
  });

  it('does NOT append an optimistic player row for the roll beat (§2 player-row policy — dice_roll is already durable+polled)', async () => {
    mockPostDmTurn.mockResolvedValue({
      job_id: 'job-roll-2',
      turn_key: 'ignored',
      status: 'pending',
      deduped: false,
    });
    mockSubscribeDmJob.mockImplementation(async function* () {
      yield { kind: 'done' };
    });

    await renderAndOpenScene();
    const perceptionBtn = await screen.findByRole('button', { name: /perception/i });

    await act(async () => {
      fireEvent.click(perceptionBtn);
    });
    await flush();

    expect(screen.queryByText('I roll Perception.')).not.toBeInTheDocument();
  });
});

describe('FIXED — Finding 1 (Miko-QA/Kage-CR MUST-FIX): synthetic-beat SSE-tail failure now drops SILENTLY instead of surfacing the composer Retry', () => {
  it('a roll-beat whose SSE tail errors does NOT surface the composer Retry banner and does NOT resubmit through narrateDurable (§3.1 "beats have no retry affordance")', async () => {
    const calls: Array<{ message: string; mechanics?: string; suppress_intent?: boolean }> = [];
    mockPostDmTurn.mockImplementation(async (body: {
      message: string;
      mechanics?: string;
      suppress_intent?: boolean;
      turn_key: string;
    }) => {
      calls.push({ message: body.message, mechanics: body.mechanics, suppress_intent: body.suppress_intent });
      return { job_id: `job-${calls.length}`, turn_key: body.turn_key, status: 'pending', deduped: false };
    });
    // The beat's own SSE tail errors.
    mockSubscribeDmJob.mockImplementationOnce(async function* () {
      yield { kind: 'error', error: 'generation failed' };
    });

    await renderAndOpenScene();
    const perceptionBtn = await screen.findByRole('button', { name: /perception/i });
    await act(async () => {
      fireEvent.click(perceptionBtn);
    });
    await flush();

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      message: 'I roll Perception.',
      mechanics: 'Perception check: rolled 15 + 3 = 18. Narrate the outcome.',
    });

    // FIXED (Finding 1): subscribeToJob's `origin: 'beat'` argument means the
    // SSE-tail error is dropped silently — no composer Retry banner, no
    // "Suzu stepped away" system row.
    expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/didn.t come through/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/stepped away/i)).not.toBeInTheDocument();

    // Give any stray async work a chance to run — confirms nothing fires a
    // delayed second postDmTurn call either (no hidden auto-retry).
    await flush();
    expect(calls).toHaveLength(1);
  });

  it('a scene-transition beat (suppress_intent:true) whose SSE tail errors ALSO drops silently — a beat with suppress_intent is exactly the case where a composer-path retry would be most dangerous (double scene-advance)', async () => {
    mockGetGrounding.mockResolvedValue(GROUNDING_WITH_TRANSITION);
    mockAdvanceScene.mockResolvedValue({ from_scene: 'cave_mouth', to_scene: 'tunnel' });
    const calls: Array<{ message: string; suppress_intent?: boolean }> = [];
    mockPostDmTurn.mockImplementation(async (body: { message: string; suppress_intent?: boolean; turn_key: string }) => {
      calls.push({ message: body.message, suppress_intent: body.suppress_intent });
      return { job_id: `job-${calls.length}`, turn_key: body.turn_key, status: 'pending', deduped: false };
    });
    mockSubscribeDmJob.mockImplementationOnce(async function* () {
      yield { kind: 'error', error: 'generation failed' };
    });

    await renderAndOpenScene();
    const moveOnBtn = await screen.findByRole('button', { name: /Enter the tunnel/i });
    await act(async () => {
      fireEvent.click(moveOnBtn);
    });
    await flush();

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ message: 'We move on.', suppress_intent: true });
    // No Retry banner — a retry here would replay through narrateDurable
    // (no suppress_intent param at all), letting the server's INTENT
    // classifier re-advance a scene this beat's own advanceScene() call
    // already advanced.
    expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument();
    await flush();
    expect(calls).toHaveLength(1);
  });
});

// ── §8 coverage-gap closure (beats 2/3/5/6) ─────────────────────────────────
//
// Miko-QA's original coverage note: only beat #1 (roll-confirm) was exercised
// through a real call site; beats 2-6 were left as a documented gap pending
// grounding/combat-state fixtures. This closes it for beats 3, 5, and the
// combined 6-then-2 sequencing (which is ALSO the Finding-2 integration
// proof — see that describe block's own note). Beat 4 (check-confirm)
// remains a genuine, pre-existing, ALREADY-ACCEPTED gap under the durable
// flag — see its own `describe` block below for why, rather than silently
// declaring it covered.

describe('Pass-3 synthetic beat #3 (scene-transition / onMoveOn) — flag ON, §8 items 2/3/4/6', () => {
  it('per-beat dedup: the durable player_action appends exactly once and the narration reconciles to exactly one row', async () => {
    mockGetGrounding.mockResolvedValue(GROUNDING_WITH_TRANSITION);
    mockAdvanceScene.mockResolvedValue({ from_scene: 'cave_mouth', to_scene: 'tunnel' });
    let capturedTurnKey = '';
    mockPostDmTurn.mockImplementation(async (body: { turn_key: string }) => {
      capturedTurnKey = body.turn_key;
      return { job_id: 'job-move-dedup', turn_key: body.turn_key, status: 'pending', deduped: false };
    });
    mockSubscribeDmJob.mockImplementation(async function* () {
      yield { kind: 'chunk', text: 'partial' };
      // never resolves — this test only cares about the POLL's reconciliation,
      // mirrors play.ddx20-durable-turn.test.tsx's own don't-re-POST pattern.
      await new Promise(() => {});
    });

    jest.useFakeTimers();
    try {
      await renderAndOpenScene();
      const moveOnBtn = await screen.findByRole('button', { name: /Enter the tunnel/i });
      await act(async () => {
        fireEvent.click(moveOnBtn);
      });
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(capturedTurnKey).toMatch(UUID_RE);

      const playerActionEvt: EngineSessionEvent = {
        seq: 50,
        kind: 'player_action',
        actor: 'leon',
        visibility: 'table',
        created_at: '2026-07-14T10:00:00Z',
        data: { who: 'leon', text: 'We move on.', turn_key: capturedTurnKey },
      };
      const narrationEvt: EngineSessionEvent = {
        seq: 51,
        kind: 'narration',
        visibility: 'table',
        created_at: '2026-07-14T10:00:01Z',
        data: { who: 'Suzu', text: 'The tunnel swallows the light.' },
      };
      mockGetSessionEventsPage.mockResolvedValue({
        events: [playerActionEvt, narrationEvt],
        max_seq: 51,
        has_more: false,
        pending_generation: null,
      });

      await act(async () => {
        jest.advanceTimersByTime(4000);
      });
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      // Exactly one durable player_action row ("We move on.") — no double
      // with any optimistic row (there is none — §2 player-row policy).
      expect(screen.getAllByText('We move on.')).toHaveLength(1);
      // Exactly one narration row.
      expect(screen.getAllByText('The tunnel swallows the light.')).toHaveLength(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('409-on-auto-beat: subscribe-and-drop — no error row, no retry affordance, no composer-text mutation', async () => {
    mockGetGrounding.mockResolvedValue(GROUNDING_WITH_TRANSITION);
    mockAdvanceScene.mockResolvedValue({ from_scene: 'cave_mouth', to_scene: 'tunnel' });
    mockPostDmTurn.mockResolvedValue({
      busy: true,
      job_id: 'job-inflight',
      status: 'streaming',
      trigger_seq: 7,
    });
    mockSubscribeDmJob.mockImplementation(async function* () {
      yield { kind: 'chunk', text: 'Suzu is mid-scene.' };
      await new Promise(() => {});
    });

    await renderAndOpenScene();
    const moveOnBtn = await screen.findByRole('button', { name: /Enter the tunnel/i });
    await act(async () => {
      fireEvent.click(moveOnBtn);
    });
    await flush();

    // subscribe-and-drop: subscribeDmJob IS called (watching the in-flight
    // job so the shared thinking/talking UI stays accurate), but there is no
    // error row, no retry affordance, and (unlike the composer's 409
    // text-restore) no textbox content was ever touched — this beat never
    // had composer text to restore in the first place.
    expect(mockSubscribeDmJob).toHaveBeenCalledWith(
      'job-inflight',
      expect.anything(),
      expect.anything(),
    );
    expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/stepped away/i)).not.toBeInTheDocument();
    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('');
  });

  it('suppress_intent + mechanics carriage: /dm/turn payload carries suppress_intent:true and the scene-advance instruction string', async () => {
    mockGetGrounding.mockResolvedValue(GROUNDING_WITH_TRANSITION);
    mockAdvanceScene.mockResolvedValue({ from_scene: 'cave_mouth', to_scene: 'tunnel' });
    mockPostDmTurn.mockResolvedValue({
      job_id: 'job-move-carry',
      turn_key: 'ignored',
      status: 'pending',
      deduped: false,
    });
    mockSubscribeDmJob.mockImplementation(async function* () {
      yield { kind: 'done' };
    });

    await renderAndOpenScene();
    const moveOnBtn = await screen.findByRole('button', { name: /Enter the tunnel/i });
    await act(async () => {
      fireEvent.click(moveOnBtn);
    });
    await flush();

    expect(mockPostDmTurn).toHaveBeenCalledTimes(1);
    expect(mockPostDmTurn.mock.calls[0][0]).toMatchObject({
      message: 'We move on.',
      mechanics: 'Scene advance: cave_mouth → tunnel. Narrate the transition.',
      suppress_intent: true,
    });
  });
});

describe('Pass-3 synthetic beat #5 (combat-start / beginEncounter) — flag ON, §8 items 2/4/6', () => {
  it('mechanics passthrough + suppress_intent omitted (false): postDmTurn carries the combat-start instruction, not suppress_intent', async () => {
    mockCombatFromScene.mockResolvedValue({
      combat_id: 'combat-1',
      monsters: [{ name: 'Goblin' }],
      state: COMBAT_STATE_ACTIVE,
    });
    mockGetCombatState.mockResolvedValue(COMBAT_STATE_ACTIVE);
    mockPostDmTurn.mockResolvedValue({
      job_id: 'job-combat-start',
      turn_key: 'ignored',
      status: 'pending',
      deduped: false,
    });
    mockSubscribeDmJob.mockImplementation(async function* () {
      yield { kind: 'done' };
    });

    await renderAndOpenScene();
    const beginBtn = await screen.findByRole('button', { name: /Begin an encounter/i });
    await act(async () => {
      fireEvent.click(beginBtn);
    });
    await flush();

    expect(mockPostDmTurn).toHaveBeenCalledTimes(1);
    expect(mockPostDmTurn.mock.calls[0][0]).toMatchObject({
      message: 'We are under attack!',
      mechanics: 'Combat starts. Goblin enter the scene. Set the scene.',
      suppress_intent: false,
    });
  });

  it('per-beat dedup: the durable player_action + narration for the combat-start beat each reconcile exactly once', async () => {
    mockCombatFromScene.mockResolvedValue({
      combat_id: 'combat-1',
      monsters: [{ name: 'Goblin' }],
      state: COMBAT_STATE_ACTIVE,
    });
    mockGetCombatState.mockResolvedValue(COMBAT_STATE_ACTIVE);
    let capturedTurnKey = '';
    mockPostDmTurn.mockImplementation(async (body: { turn_key: string }) => {
      capturedTurnKey = body.turn_key;
      return { job_id: 'job-combat-start-2', turn_key: body.turn_key, status: 'pending', deduped: false };
    });
    mockSubscribeDmJob.mockImplementation(async function* () {
      yield { kind: 'chunk', text: 'partial' };
      await new Promise(() => {});
    });

    jest.useFakeTimers();
    try {
      await renderAndOpenScene();
      const beginBtn = await screen.findByRole('button', { name: /Begin an encounter/i });
      await act(async () => {
        fireEvent.click(beginBtn);
      });
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(capturedTurnKey).toMatch(UUID_RE);

      mockGetSessionEventsPage.mockResolvedValue({
        events: [
          {
            seq: 60,
            kind: 'player_action',
            actor: 'leon',
            visibility: 'table',
            created_at: '2026-07-14T10:00:00Z',
            data: { who: 'leon', text: 'We are under attack!', turn_key: capturedTurnKey },
          },
          {
            seq: 61,
            kind: 'narration',
            visibility: 'table',
            created_at: '2026-07-14T10:00:01Z',
            data: { who: 'Suzu', text: 'The goblin snarls and lunges.' },
          },
        ],
        max_seq: 61,
        has_more: false,
        pending_generation: null,
      });

      await act(async () => {
        jest.advanceTimersByTime(4000);
      });
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(screen.getAllByText('We are under attack!')).toHaveLength(1);
      expect(screen.getAllByText('The goblin snarls and lunges.')).toHaveLength(1);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('Pass-3 combat→scene sequencing (beat 6 in-flight → beat 2 409) — §8 item 5 AND the Finding-2 integration proof', () => {
  it('beat 6 (end-turn) fires, beat 2 (scene-advance) 409s against the SAME job — subscribeDmJob is called exactly ONCE (Finding 2\'s job-id dedupe guard prevents a second ledger entry / second subscribe from ever being registered — the orphan-hijack mechanism reconcileEvents.pass3-busy-pivot-orphan.test.ts locks can no longer occur)', async () => {
    mockGetSession.mockResolvedValue(AI_SESSION_WITH_COMBAT);
    mockGetCombatState.mockResolvedValue(COMBAT_STATE_ACTIVE);
    mockGetGrounding.mockResolvedValue(GROUNDING_WITH_TRANSITION);
    mockEndTurn.mockResolvedValue({
      message: 'You end your turn.',
      state: COMBAT_STATE_ENDED,
      scene_advance: { from_scene: 'cave_mouth', to_scene: 'tunnel', outcome: 'victory' },
    });

    // Beat 6 ("I end my turn.") gets a real 200 for job-6. Beat 2 ("The
    // scene changes.") — fired immediately after, no await between them, per
    // §3.3 — 409s against that SAME job (the server's single in-flight slot).
    mockPostDmTurn.mockImplementation(async (body: { message: string; turn_key: string }) => {
      if (body.message === 'I end my turn.') {
        return { job_id: 'job-6', turn_key: body.turn_key, status: 'pending', deduped: false };
      }
      // 'The scene changes.' (beat 2) — busy against job-6.
      return { busy: true, job_id: 'job-6', status: 'streaming', trigger_seq: 100 };
    });
    mockSubscribeDmJob.mockImplementation(async function* () {
      yield { kind: 'chunk', text: 'Velka ends her turn.' };
      await new Promise(() => {});
    });

    await renderAndOpenScene();
    const endTurnBtn = await screen.findByRole('button', { name: /^End turn$/i });
    await act(async () => {
      fireEvent.click(endTurnBtn);
    });
    await flush();

    // Both beats POSTed (the mechanical actions are independent — §3.4, no
    // double-fire) — beat 6 got 200, beat 2 got 409.
    expect(mockPostDmTurn).toHaveBeenCalledTimes(2);

    // THE FIX: subscribeToJob's job-id dedupe guard means beat 2's 409
    // handler's subscribeToJob(job-6, "busy:job-6", ...) call short-circuits
    // BEFORE ever invoking the real subscribeDmJob SSE call a second time —
    // pre-fix, this would be 2 (Iro MAJOR-1's "re-announces narrating every
    // combat turn" symptom, and the root cause of Finding 2's orphan ledger
    // entry).
    expect(mockSubscribeDmJob).toHaveBeenCalledTimes(1);
    expect(mockSubscribeDmJob).toHaveBeenCalledWith(
      'job-6',
      expect.anything(),
      expect.anything(),
    );

    // No error/retry surface from any of this — both beats are silent by
    // design (§3.1/§3.2).
    expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument();
  });
});

describe('Pass-3 synthetic beat #4 (check-confirm) — documented residual gap, NOT silently declared covered', () => {
  it('cannot be driven through the real UI under DURABLE_GENERATION_ENABLED=true in any current test harness — offeredCheckSkill (the gate on the "Attempt {skill}" button) is set EXCLUSIVELY inside the legacy narrate() SSE chunk loop (page.tsx), which flag-ON never calls for the composer path (onSend routes to narrateDurable instead); no durable equivalent of the offered_check signal exists (design §6.3 — an ALREADY-ACCEPTED gap for the composer path too, not new to this beat)', () => {
    // This is a documentation test, not a UI exercise: it records WHY beat 4
    // has no per-beat-dedup/409/suppress_intent/mechanics coverage through a
    // rendered "Attempt {skill}" click, rather than silently omitting it or
    // faking a click that could never happen in the shipped flag-ON client.
    // The wiring itself IS covered by static inspection (source, quoted
    // below) and is the SAME code shape already proven correct for beats
    // 2/3/5/6 above (narrateDurableBeat's suppress_intent/mechanics
    // parameters don't vary by call site):
    //
    //   onAttemptCheck (page.tsx): if (DURABLE_GENERATION_ENABLED) {
    //     void narrateDurableBeat(`I attempt a ${skillLabel} check.`,
    //       result.mechanics, 'act', { suppressIntent: true, beat: 'check_confirm' });
    //   }
    //
    // A live-staging exercise (P1b carried gate 6, per the design doc's own
    // §8 "defers to live staging" note) is the only way to exercise the real
    // offer->Attempt->resolve round trip once G1/G2 land — not a Jest
    // harness gap Ren-Dev can close without inventing a fake offer
    // mechanism the shipped client doesn't have.
    expect(true).toBe(true);
  });
});

describe('Finding 3 (SHOULD-FIX, carried not fixed) — turnKeyRef clobber characterization lock', () => {
  it('beat 6 (end-turn) mints+owns turnKeyRef; beat 2 (scene-advance) firing right after mints its OWN turnKey, clobbers the shared ref, then NULLS it on its 409 — even though beat 6\'s job is STILL in flight. The §4c/§4d turnKeyRef-based cleanup/dead-job detection is left tracking nothing for beat 6\'s real, still-open turn.', async () => {
    // Same fixture/sequencing as the Finding-2 integration test above — an
    // organic, UI-reachable trigger (onRoll/onMoveOn/onAttemptCheck all gate
    // on `!talking` so a same-tab double-fire can't reach them mid-turn, but
    // onCombatAction -> handleSceneAdvance does NOT gate on `talking` at all,
    // which is exactly what makes beats 6-then-2 the real, reachable
    // clobber trigger, not a synthetic double-click).
    mockGetSession.mockResolvedValue(AI_SESSION_WITH_COMBAT);
    mockGetCombatState.mockResolvedValue(COMBAT_STATE_ACTIVE);
    mockGetGrounding.mockResolvedValue(GROUNDING_WITH_TRANSITION);
    mockEndTurn.mockResolvedValue({
      message: 'You end your turn.',
      state: COMBAT_STATE_ENDED,
      scene_advance: { from_scene: 'cave_mouth', to_scene: 'tunnel', outcome: 'victory' },
    });
    mockPostDmTurn.mockImplementation(async (body: { message: string; turn_key: string }) => {
      if (body.message === 'I end my turn.') {
        return { job_id: 'job-6', turn_key: body.turn_key, status: 'pending', deduped: false };
      }
      return { busy: true, job_id: 'job-6', status: 'streaming', trigger_seq: 100 };
    });
    // Beat 6's own SSE tail NEVER resolves — its job is genuinely still
    // in-flight for the whole test, exactly the case §4d exists to detect
    // if it silently dies (backgrounded tab / proxy idle-timeout, no SSE
    // error frame ever arrives).
    mockSubscribeDmJob.mockImplementation(async function* () {
      yield { kind: 'chunk', text: 'Velka ends her turn.' };
      await new Promise(() => {});
    });

    await renderAndOpenScene();
    const endTurnBtn = await screen.findByRole('button', { name: /^End turn$/i });
    await act(async () => {
      fireEvent.click(endTurnBtn);
    });
    await flush();

    // FINDING 3 (unfixed): turnKeyRef was clobbered from beat 6's key to
    // beat 2's key, then NULLED entirely once beat 2 discovered it was busy
    // (narrateDurableBeat's 409 branch: `turnKeyRef.current = null`) —
    // localStorage (saveTurnKey/clearTurnKey) mirrors the same ref 1:1, so
    // it's an observable proxy for the in-memory state.
    const key = window.localStorage.getItem('st:dnd:sess-pass3:activeTurnKey');
    expect(key).toBeNull();

    // Yet beat 6's job is STILL genuinely in flight (its SSE tail is
    // deliberately hung above, and it never got an error/done). If beat 6's
    // job silently died right now with no SSE error frame, the §4d
    // poll-failure-grace detector (page.tsx, reads turnKeyRef.current) would
    // never notice — turnKeyRef.current is null, not beat 6's key. This is
    // exactly Finding 3's carried gap. A future fix (multi-key tracking, per
    // the carried-item comment on turnKeyRef in page.tsx) should make this
    // assertion FAIL (key still reflects beat 6's still-open turn) rather
    // than pass.
    expect(mockSubscribeDmJob).toHaveBeenCalledTimes(1); // beat 6's tail, still open
  });
});
