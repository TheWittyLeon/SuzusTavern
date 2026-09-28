'use client';

/**
 * TAV-PLAY-SHELL step 5, hook 4 of ~9 (decomposition plan §2.2) — `useScene`.
 * Owns plan §1.5: grounding, the check-disappearance-explanation diff
 * ledger, the arrival/rescue/outcome authored-line players, the scene-head
 * refocus helper, the offered-check signal router, the A1 opening-scene
 * gate, and the two player-facing handlers (`onMoveOn`, `onAttemptCheck`) —
 * plus `handleSceneAdvance`, the ADV-8 auto-advance narrator these two
 * handlers share with combat's own scene_advance path (still in page.tsx,
 * hook 5/`useCombat` territory).
 *
 * Signature is `useScene(sessionId, session, combatEngaged, talking,
 * advantage, appendLog, confirmBeatRef, renderedSeqsRef)`,
 * not the plan's abridged `useScene(sessionId)` — every extra parameter is a
 * real cross-concern read, same kind of documented deviation as
 * useSafety's/useMyCharacter's own header:
 *   - `session`/`talking`/`advantage` — scene's own gates
 *     (`onMoveOn`/`onAttemptCheck` refuse while `talking` or the session is
 *     locked) read state owned by useSessionLifecycle (already extracted)
 *     or by not-yet-extracted hooks (useCombat/useNarration) — this hook
 *     doesn't own any of them.
 *   - `combatEngaged` (Amendment A §A.1) — the ONE derived boolean this hook
 *     reads off combat's state (`isCombatEngaged(combatState)`, see
 *     `../format.ts`), not `CombatState` itself. Gates
 *     `availableTransitions`/`availableChecks` during active combat. This
 *     is a DATA gate, not a presentation one: `availableTransitions` also
 *     feeds the composer's keyword fast-path (`matchKeywordIntent` in
 *     page.tsx's `onSend`, `page.tsx:3750`) — dropping this filter and
 *     suppressing only in a JSX consumer (e.g. `Offers`) would let a
 *     movement phrase typed mid-fight advance the scene. Do not
 *     "simplify" this into `Offers`.
 *   - `appendLog` — every authored-line player and both handlers write to
 *     the transcript; that's useTranscript's concern (hook 6), not yet
 *     extracted.
 *   - `renderedSeqsRef` — `onAttemptCheck` seeds the DDX-20 durable-poll
 *     dedup ledger with its own optimistic write's `event_seq`; that
 *     ledger is useSessionEvents' concern (hook 7), not yet extracted.
 *
 * `confirmBeatRef` is the one genuinely new shape, not just a wider
 * parameter list. `onMoveOn`/`onAttemptCheck`/`handleSceneAdvance` all fire
 * a confirmation narration beat (`ConfirmBeatFn`, below), and that function
 * is owned by useNarration — hook 8, composed AFTER useScene per plan
 * §2.2's fixed order ("dependencies flow downward only"). But useNarration
 * itself takes scene's own grounding/refresh helpers as input (its own
 * "Derived from: transcript, scene" row), so the two are mutually
 * referential in the CURRENT, single-component code today (narrate() calls
 * refreshGrounding/playArrivalLine/applyOfferedCheckSignal; onMoveOn calls
 * narrate) — exactly the shape plan §2.2 flags for `useSessionEvents`
 * ("the only inversion in the design and it is deliberate"), just on the
 * other hook. page.tsx cannot pass `narrate`/`narrateDurableBeat`
 * (`useCallback`s declared far below this hook's call site, right after
 * `appendLog`, because the mount effect needs `setGrounding`/`openScene`
 * before either narration function exists) as plain arguments — that's a
 * genuine temporal-dead-zone, not a stylistic one. page.tsx instead keeps
 * ONE ref, `confirmBeatRef`, assigned by a single `useLayoutEffect` (which
 * owns the `DURABLE_GENERATION_ENABLED` fork) once `narrate`/
 * `narrateDurableBeat` are declared (mirrors this same file's own
 * `combatStateRef`/`logRef` "latest value without a dep" idiom, applied to
 * a function) and passes the STABLE ref in; refs never change identity, so
 * no TDZ and no extra dependency-array entries. This ref-mirror is a
 * deliberate shortcut, marked at its actual call site (page.tsx, right
 * where `useScene(...)` is called) rather than here, so
 * `tools/debt-harvest.py` sees exactly one marker for it.
 *
 * Deliberately does NOT own (debt: markers at each site in page.tsx):
 * the mount effect's grounding fetch (still seeds combatId/participants/
 * quick-checks too — useSessionLifecycle's own hook-1 marker), the unified
 * durable events poll's grounding-invalidation branches (useSessionEvents,
 * hook 7), `combatEncounterUnstarted`/`sceneCreatureNames` (read `grounding`
 * but exist for the combat-verb guard — plan §1.4, useCombat's derived
 * values, not scene's), and the encounter-appearance-toast/begin-encounter-
 * refocus effects (read this hook's own `sceneHasEncounter` but also
 * `combatId`, useCombat's state).
 */
import { useCallback, useMemo, useRef, useState, type Dispatch, type MutableRefObject, type RefObject, type SetStateAction } from 'react';
import { useAuth } from '@/lib/auth/AuthProvider';
import { useToast } from '@/components/Toast';
import {
  advanceScene,
  C3_GROUNDING_FIELD,
  getGrounding,
  getSessionEvents,
  postSessionEvent,
  resolveCheck,
} from '@/lib/api/dnd';
import { engineErrorMessage, extractReason, isApiError } from '@/lib/dnd/engineError';
import { DURABLE_GENERATION_ENABLED } from '@/lib/config';
import type { ComposeMode } from '@/components/Composer';
import type { Advantage } from '@/components/DiceTray';
import type { LogRow } from '@/components/ChatLog';
import type {
  GroundingData,
  OfferedCheck,
  SceneCheck,
  SceneTransition,
  Session,
  SessionEvent,
  SeriesCompletionPointer,
  SeriesNextAdventure,
} from '@/lib/api/types';
import { buildReadAloudBlock, isSessionLocked, titleCaseSkill } from '../format';

/** A1 — structural event kinds that indicate the scene hasn't started yet.
 * These are session/character SETUP events, not fiction — their presence
 * must NOT suppress the read-aloud opening. The engine emits `rebind` when
 * a character is bound/re-bound to a campaign (there is no
 * `character_bound` kind); both are listed so the gate matches engine
 * reality regardless. */
const STRUCTURAL_EVENT_KINDS = new Set([
  'session_start',
  'session_created',
  'character_bound',
  'rebind',
  'opening_narrated',
]);

export type NarrateFn = (
  playerMessage: string,
  mechanics: string,
  beatMode: ComposeMode,
  opts?: { kind?: 'beat' | 'opening'; session?: Session; suppressIntent?: boolean },
) => void | Promise<void>;

export type NarrateDurableBeatFn = (
  playerLine: string,
  mechanics: string,
  beatMode: ComposeMode,
  opts?: { suppressIntent?: boolean; beat?: string },
) => void | Promise<void>;

// Amendment A §A.4 (IMPORTANT-1): all three useScene call pairs into
// narrate/narrateDurableBeat differ only in playerLine/mechanics/the durable
// beat label -- beatMode is always 'act' and suppressIntent always true on
// every branch. The union is exhaustive for THIS hook, which is the only
// thing that fires these two beats. NarrateDurableBeatFn's own `beat?:
// string` stays open, so adding a beat kind elsewhere (end_turn,
// combat_start, roll_confirm) does not touch this type.
export type SceneConfirmBeat = 'scene_advance' | 'check_confirm';
export type ConfirmBeatFn = (
  playerLine: string,
  mechanics: string,
  beat: SceneConfirmBeat,
) => void;

export interface UseSceneResult {
  grounding: GroundingData | null;
  setGrounding: Dispatch<SetStateAction<GroundingData | null>>;
  sceneAdvanceBusy: boolean;
  adventureComplete: boolean;
  completionSeries: {
    series: SeriesCompletionPointer;
    next: SeriesNextAdventure | null;
  } | null;
  checkBusy: boolean;
  offeredCheckSkill: string | null;
  setOfferedCheckSkill: Dispatch<SetStateAction<string | null>>;
  freeformOfferedCheck: string | null;
  setFreeformOfferedCheck: Dispatch<SetStateAction<string | null>>;
  sceneHeadRef: RefObject<HTMLDivElement | null>;
  checkWrapRef: RefObject<HTMLDivElement | null>;
  transitionWrapRef: RefObject<HTMLDivElement | null>;
  freeformCheckRef: RefObject<HTMLDivElement | null>;
  sceneHasEncounter: boolean;
  availableTransitions: SceneTransition[];
  availableChecks: SceneCheck[];
  diffAndExplainResolvedChecks: (g: GroundingData | null | undefined) => void;
  refreshGrounding: () => Promise<GroundingData | null>;
  playArrivalLine: (g: GroundingData | null) => boolean;
  playRescueTransitionLine: (g: GroundingData | null) => boolean;
  playOutcomeLine: (outcomeLine: string | null | undefined, sceneLabel?: string) => boolean;
  refocusSceneHeadIfStranded: (hadFocusInGroup: boolean) => void;
  applyOfferedCheckSignal: (signal: OfferedCheck, currentGrounding: GroundingData | null) => void;
  openScene: (s: Session, g: GroundingData, sid: string, signal: AbortSignal) => Promise<void>;
  handleSceneAdvance: (
    fromScene: string,
    toScene: string,
    outcome?: string,
    outcomeLine?: string | null,
  ) => Promise<void>;
  onMoveOn: (toScene: string | null) => Promise<void>;
  onAttemptCheck: (skill: string) => Promise<void>;
}

export function useScene(
  sessionId: string,
  session: Session | null,
  combatEngaged: boolean,
  talking: boolean,
  advantage: Advantage,
  appendLog: (row: Omit<LogRow, 'id' | 'ts'>) => void,
  confirmBeatRef: MutableRefObject<ConfirmBeatFn>,
  renderedSeqsRef: MutableRefObject<Set<number>>,
): UseSceneResult {
  const { user } = useAuth();
  const username = user?.username ?? null;
  const { toast } = useToast();

  // A1 — fire-once gate: ensures the opening beat only streams once per
  // mount even under React StrictMode's double-invoke. The durable
  // server-side event is the canonical guard; this ref prevents a second
  // fire within the same component lifetime (e.g. StrictMode double-effect).
  const openingFiredRef = useRef(false);

  // Grounding for the "Move on" affordance (ADV-7T).
  const [grounding, setGrounding] = useState<GroundingData | null>(null);
  const [sceneAdvanceBusy, setSceneAdvanceBusy] = useState(false);
  // TAV-SLICE-END-ADVANCE-NULL / Kage-CR item 4: a terminal advance
  // (to_scene: null / completed: true) has no further "Move on" affordance —
  // latch this so a second click can't post another /advance (and narrate
  // another "adventure concludes" beat) indefinitely. Session-lifetime only;
  // a reload naturally resets it (the engine's own `progress.completed` is
  // the durable source of truth — this is just a UI repeat-guard).
  const [adventureComplete, setAdventureComplete] = useState(false);
  // T4p2: the /advance completion payload's series next-pointer (design doc
  // §6.4) — RENDER-ONLY addition, not a new interaction. Populated (never
  // required) alongside adventureComplete above; NextPartOffer degrades to
  // rendering nothing when this stays null (not in a series, or the field
  // is absent on an older engine/SUZU_DND_SERIES off). One series entry is
  // rendered — the first, matching `next_adventure`'s own single-series
  // flatten rule (design doc §6.4's "why next_adventure also exists").
  const [completionSeries, setCompletionSeries] = useState<{
    series: SeriesCompletionPointer;
    next: SeriesNextAdventure | null;
  } | null>(null);

  // P1-PLAYFIX (S2.4) — busy flag for the check-affordance row (Attempt: Survival, etc.).
  const [checkBusy, setCheckBusy] = useState(false);

  // P1-PLAYFIX-2 §A.5/§A.6 — the skill the server invited this turn (present
  // once the SSE payload carries an `offeredCheck`; forward-compatible, see
  // dnd.ts/types.ts). Cleared at the start of every new narrate() beat so a
  // stale offer never lingers past the turn it was made on. NEVER drives an
  // auto-roll — it only makes the matching "Attempt {skill}" button hard to miss.
  const [offeredCheckSkill, setOfferedCheckSkill] = useState<string | null>(null);

  // Phase 4 (Sora-Arch design §4 Fork 3; Miko-QA "the sleeper bug" fix) — a
  // skill Suzu invited this turn that is NOT one of the current scene's
  // AUTHORED checks (grounding.checks) — a freeform/unauthored offer. The
  // pre-Phase-4 client validated every offer against `availableChecks` and
  // silently DROPPED anything outside it; this state instead routes such an
  // offer to a dedicated "Attempt {skill}" affordance that rolls via the
  // always-available quickChecks/postRoll -> engine `/roll (kind=skill)`
  // primitive (never `/check`, which 400s `no_such_check` for anything
  // unauthored). Mutually exclusive with `offeredCheckSkill` above — see
  // `applyOfferedCheckSignal` below, which sets exactly one of the two per
  // offer and clears both at the top of every new beat.
  const [freeformOfferedCheck, setFreeformOfferedCheck] = useState<string | null>(null);

  // Iro Ship 2 CRITICAL-1: a resolved check / taken transition unmounts the
  // just-clicked button once `refreshGrounding()` recomputes availableChecks /
  // availableTransitions, dropping focus to <body> with no announcement.
  // `sceneHeadRef` is a stable, always-mounted anchor (mirrors the
  // `endCombatBtnRef` refocus pattern in page.tsx); the wrap refs let each
  // handler capture "did this click originate inside my group" before the
  // unmount.
  const sceneHeadRef = useRef<HTMLDivElement>(null);
  const checkWrapRef = useRef<HTMLDivElement>(null);
  const transitionWrapRef = useRef<HTMLDivElement>(null);
  // Phase 4 (Miko-QA "the sleeper bug" fix) — scroll anchor for the freeform
  // "Attempt {skill}" affordance (see `freeformOfferedCheck` above), mirrors
  // `checkWrapRef`'s identical role for the authored checks group.
  const freeformCheckRef = useRef<HTMLDivElement>(null);

  // Check Retry + Fail-Forward (2026-07-28 design) — Iro-A11y MAJOR-1:
  // disappearance-explanation for a check resolved by someone OTHER than
  // this client's own click (a table-mate's action, or a STRUCT-006
  // classifier resolving the gating flag through roleplay -- no click on
  // THIS client at all). The acting client's own resolution gets the toast
  // + SILENT log row (onAttemptCheck, MAJOR-2, below); every OTHER client
  // only sees the check silently vanish from the rail unless this fires.
  // Keyed `${skill}-${dc}`, mirroring the engine's own check_key
  // convention (minus scene_id -- these refs are scene-scoped and reset on
  // scene change instead, see below).
  const lastDiffedSceneIdRef = useRef<string | null | undefined>(undefined);
  const prevCheckStatesRef = useRef<Map<string, string | undefined>>(new Map());
  const explainedResolvedKeysRef = useRef<Set<string>>(new Set());
  const ownResolvedCheckKeysRef = useRef<Set<string>>(new Set());

  const diffAndExplainResolvedChecks = useCallback(
    (g: GroundingData | null | undefined) => {
      const sceneId = g?.scene_id ?? null;
      if (sceneId !== lastDiffedSceneIdRef.current) {
        // Scene changed (or this is the very first call this mount) --
        // a check sharing the SAME skill+dc key in a DIFFERENT scene is a
        // different authored check entirely; start every ref fresh so
        // nothing carries over across the boundary. This also means the
        // very first diff of a fresh scene never spuriously "explains" a
        // check that was already resolved before this client ever looked
        // -- an empty prevCheckStatesRef means nothing counts as a
        // transition on that first pass (see `wasSeenBefore` below).
        lastDiffedSceneIdRef.current = sceneId;
        prevCheckStatesRef.current = new Map();
        explainedResolvedKeysRef.current = new Set();
        ownResolvedCheckKeysRef.current = new Set();
      }

      const prev = prevCheckStatesRef.current;
      const next = new Map<string, string | undefined>();
      for (const c of g?.checks ?? []) {
        if (!c || typeof c.skill !== 'string') continue;
        const key = `${c.skill}-${c.dc}`;
        next.set(key, c.state);
        const wasSeenBefore = prev.has(key);
        const wasResolved = prev.get(key) === 'resolved';
        const isResolved = c.state === 'resolved';
        // Double-append guard: `explainedResolvedKeysRef` is checked AND
        // set synchronously in the same pass as the transition check, so
        // even if two grounding fetches raced (both reading the same
        // pre-update `prev`), only the first to actually execute this loop
        // body can win the append -- diffAndExplainResolvedChecks itself
        // never awaits mid-diff, so the two calls can't interleave.
        if (
          isResolved &&
          !wasResolved &&
          wasSeenBefore &&
          !ownResolvedCheckKeysRef.current.has(key) &&
          !explainedResolvedKeysRef.current.has(key)
        ) {
          explainedResolvedKeysRef.current.add(key);
          appendLog({
            who: 'Suzu',
            kind: 'system',
            text: `✦ The ${titleCaseSkill(c.skill)} approach resolves.`,
          });
        }
      }
      prevCheckStatesRef.current = next;
    },
    [appendLog],
  );

  const refreshGrounding = useCallback(async (): Promise<GroundingData | null> => {
    if (!sessionId) return null;
    const g = await getGrounding(sessionId).catch(() => null);
    setGrounding(g);
    diffAndExplainResolvedChecks(g);
    return g;
  }, [sessionId, diffAndExplainResolvedChecks]);

  /**
   * DM-ARRIVAL-NARRATION — the last scene an arrival line was played for.
   *
   * Two independent code paths refresh grounding after an advance (onMoveOn,
   * and narrate()'s `sceneAdvancedSignal`), and the durable events poll can
   * refetch on the same transition, so the naive version double-plays the
   * line. Keyed on the SCENE rather than latched once per mount on purpose:
   * a genuine re-entry into a scene later in the session is a real arrival and
   * should play again — only the same seam replayed back-to-back is suppressed.
   */
  const lastArrivalSceneRef = useRef<string | null>(null);

  /**
   * DM-ARRIVAL-NARRATION — play the destination scene's authored arrival line,
   * deterministically. Returns true when it actually rendered one.
   *
   * Takes the grounding EXPLICITLY (never the `grounding` closure) — every
   * caller has just awaited refreshGrounding(), and setGrounding() is async,
   * so the closure value is still the scene we just left.
   *
   * KNOWN GAP, deliberate: the durable events poll is NOT a caller. It
   * refetches grounding for several reasons that are not advances (a
   * classifier-opened beat gate on the SAME scene, most of all), so calling
   * this from there would fire an arrival line mid-scene the first time any of
   * them happened. `DURABLE_GENERATION_ENABLED` is false, so narrate()'s SSE
   * signal and onMoveOn are the live advance paths and this is currently
   * complete; whoever flips that flag must add an advance-specific call there
   * (keyed on the scene_advance event, not on `invalidatesGrounding`).
   */
  const playArrivalLine = useCallback(
    (g: GroundingData | null): boolean => {
      const line = g?.arrival_line;
      const sceneId = g?.scene_id;
      if (typeof line !== 'string' || !line.trim()) return false;
      if (sceneId && lastArrivalSceneRef.current === sceneId) return false;
      lastArrivalSceneRef.current = sceneId ?? null;
      appendLog({ who: 'Suzu', kind: 'narration', text: line });
      return true;
    },
    [appendLog],
  );

  /**
   * Contract C3 (COMBAT-UX-FOLLOW-UP-1: rescue narration jarring, pinned
   * 2026-08-11) — the deterministic scripted rescue-transition line, built
   * on the SAME "authored content played verbatim" pattern as
   * `playArrivalLine` just above. PERMANENTLY inert on the engine side
   * (WF-O-OUTCOMELINE retired the scene-level `C3_GROUNDING_FIELD`
   * authoring key) — kept only so a stray/legacy authored key degrades to
   * a silent no-op instead of a crash. `playOutcomeLine` is the live
   * equivalent.
   */
  const lastRescueLineSceneRef = useRef<string | null>(null);
  const playRescueTransitionLine = useCallback(
    (g: GroundingData | null): boolean => {
      const line = g?.[C3_GROUNDING_FIELD];
      const sceneId = g?.scene_id;
      if (typeof line !== 'string' || !line.trim()) return false;
      // Kage SUGG-3 (2026-08-12): an over-ceiling authored line is dropped
      // SILENTLY below — from the author's seat "the feature just doesn't
      // appear", with nothing in the console pointing at why. Warn, scoped to
      // the actual length-drop branch only (not the absent/blank cases above,
      // which are the ordinary "no rescue line authored" path, not a defect).
      if (line.length > 400) {
        console.warn(
          `[C3] rescue-transition line for scene "${sceneId ?? 'unknown'}" is ${line.length} chars (ceiling 400) — dropped, not rendered.`,
        );
        return false;
      }
      if (sceneId && lastRescueLineSceneRef.current === sceneId) return false;
      lastRescueLineSceneRef.current = sceneId ?? null;
      appendLog({ who: 'Suzu', kind: 'narration', text: line });
      return true;
    },
    [appendLog],
  );

  /**
   * WF-O-OUTCOMELINE (engine, 2026-08-16) — play the engine's authored
   * `outcome_line` verbatim, as Suzu narration, when the combat mutation
   * response carries one. Callers invoke this independently of whether a
   * scene actually advanced (an outcome can resolve with no scene shift at
   * all) — see `onCombatAction`/`onEndCombat`/the monster-turn effect
   * (still in page.tsx, useCombat territory) for the no-advance path, and
   * `handleSceneAdvance` below for the advance path.
   */
  const playOutcomeLine = useCallback(
    (outcomeLine: string | null | undefined, sceneLabel?: string): boolean => {
      if (typeof outcomeLine !== 'string' || !outcomeLine.trim()) return false;
      if (outcomeLine.length > 400) {
        console.warn(
          `[outcome_line] transition line${sceneLabel ? ` for scene "${sceneLabel}"` : ''} is ${outcomeLine.length} chars (ceiling 400) — dropped, not rendered.`,
        );
        return false;
      }
      appendLog({ who: 'Suzu', kind: 'narration', text: outcomeLine });
      return true;
    },
    [appendLog],
  );

  /**
   * Iro Ship 2 CRITICAL-1 — refocus the scene heading if a `refreshGrounding()`
   * refresh unmounted the button the user was just on, stranding focus on
   * <body>. `hadFocusInGroup` MUST be captured synchronously by the caller
   * BEFORE any await (the browser focuses a clicked button synchronously, so
   * that's the only reliable moment to know which group had focus).
   * The stranding check itself runs inside a rAF so it observes the DOM
   * *after* React's commit — checking immediately after an `await` can race
   * the commit and false-negative. Only acts if focus actually landed on
   * <body> (i.e. was truly dropped) — if the user had already tabbed
   * elsewhere in the interim, activeElement is that element, not <body>, and
   * we leave it alone.
   */
  const refocusSceneHeadIfStranded = useCallback((hadFocusInGroup: boolean) => {
    if (!hadFocusInGroup) return;
    requestAnimationFrame(() => {
      if (document.activeElement === document.body) {
        sceneHeadRef.current?.focus();
      }
    });
  }, []);

  /**
   * Phase 4 (Sora-Arch design §4 Fork 3; Miko-QA "the sleeper bug" fix) —
   * surface an `offered_check` signal from EITHER narration path: the
   * legacy/flag-OFF SSE beat (`narrate()`, page.tsx) or the durable
   * session-events poll (`pollDurable`, page.tsx). NEVER auto-rolls — only
   * makes the matching "Attempt {skill}" affordance impossible to miss:
   * either the authored highlighted chip (`offeredCheckSkill`), or — the
   * sleeper-bug fix — a dedicated freeform "Attempt {skill}" button
   * (`freeformOfferedCheck`) when the offered skill isn't one of THIS
   * scene's authored checks. The two are mutually exclusive; this function
   * is the ONLY writer of either, so every call sets exactly one and clears
   * the other.
   */
  const applyOfferedCheckSignal = useCallback(
    (signal: OfferedCheck, currentGrounding: GroundingData | null) => {
      const isAuthoredCheck = (currentGrounding?.checks ?? []).some(
        (c) => c.skill === signal.skill,
      );
      setOfferedCheckSkill(isAuthoredCheck ? signal.skill : null);
      setFreeformOfferedCheck(isAuthoredCheck ? null : signal.skill);
      toast({
        tone: 'info',
        message: `Suzu invites a ${titleCaseSkill(signal.skill)} check — the Attempt button is ready when you are.`,
        duration: 8000,
      });
      requestAnimationFrame(() => {
        (isAuthoredCheck ? checkWrapRef : freeformCheckRef).current?.scrollIntoView({
          block: 'nearest',
        });
      });
    },
    [toast],
  );

  // ── A1: opening scene ───────────────────────────────────────────────────────

  /**
   * Gate: should the opening beat fire this mount?
   * Returns true only when:
   *   - grounding has a scene_id + boxed_text (there's a scene to open)
   *   - getSessionEvents returns no `opening_narrated` event
   *   - AND no non-structural fiction events exist (belt-and-braces)
   * Returns false on any error (fail safe: don't speculate, render silence).
   */
  const checkShouldOpen = useCallback(
    async (sid: string, g: GroundingData, signal: AbortSignal): Promise<boolean> => {
      // No authored scene — nothing to open.
      if (!g.scene_id || !g.boxed_text) return false;
      // Per-lifetime ref guard catches StrictMode double-invoke within one mount.
      if (openingFiredRef.current) return false;

      // FIX-4: getSessionEvents now returns null on error (engine unreachable).
      // Treat null as fail-safe: don't open when we can't confirm the session state.
      const events = await getSessionEvents(sid, signal);
      if (events === null) return false; // engine unreachable → fail safe, don't open
      if (signal.aborted) return false;

      // Durable marker exists: opening already ran.
      if (events.some((e: SessionEvent) => e.event_type === 'opening_narrated')) return false;

      // Belt-and-braces: any non-structural event means play already started.
      const hasFiction = events.some(
        (e: SessionEvent) => e.event_type && !STRUCTURAL_EVENT_KINDS.has(e.event_type),
      );
      if (hasFiction) return false;

      return true;
    },
    [],
  );

  /**
   * A1 / P1-READALOUD — Open the scene on first load. Fire-and-forget; non-blocking.
   *
   * Unified verbatim path: renders the authored boxed_text block instantly
   * for ALL session types (AI, AI-off, human-DM). No LLM call on open.
   * Suzu's narration fires on the player's first action instead (normal
   * beat via onSend/onRoll, still in page.tsx).
   *
   * Idempotency: guarded by openingFiredRef (in-memory, per-mount) AND the
   * durable `opening_narrated` session event (survives remounts).
   */
  const openScene = useCallback(
    async (s: Session, g: GroundingData, sid: string, signal: AbortSignal) => {
      const shouldOpen = await checkShouldOpen(sid, g, signal);
      if (!shouldOpen || signal.aborted) return;

      // Latch: prevent a second fire from StrictMode double-invoke or any
      // concurrent call within the same component lifetime.
      openingFiredRef.current = true;

      // Step 1 — render the verbatim read-aloud block (authored, byte-identical,
      // same for every session type). No typewriter; player reads at their pace.
      appendLog({
        who: 'Scene',
        kind: 'read_aloud',
        text: buildReadAloudBlock(g),
      });

      // Step 2 — render optional authored NPC opening lines, verbatim, in order.
      for (const line of g.opening_lines ?? []) {
        if (signal.aborted) return;
        appendLog({
          who: line.speaker_display_name,
          kind: 'read_aloud_line',
          text: line.line,
        });
      }

      // Step 3 — write durable marker (best-effort, non-fatal on failure).
      // Semantics: "read-aloud has been shown for this scene opening". The
      // event kind is unchanged so the engine allowlist stays frozen.
      if (!signal.aborted) {
        void postSessionEvent(sid, {
          kind: 'opening_narrated',
          data: { scene_id: g.scene_id, source: 'read_aloud_verbatim' },
        }).catch(() => {/* non-fatal */});
      }

      // Step 4 — NO AI opening call. The next narrate() fires when the player
      // sends their first action via onSend / onRoll (existing paths, unchanged).
      // That call is a normal beat with is_opening=False; Suzu reacts to the
      // player rather than re-describing the room.
    },
    [checkShouldOpen, appendLog],
  );

  // ── scene advance (ADV-7T / CUI-12) ─────────────────────────────────────────

  /**
   * Handle an ADV-8 auto-advance (scene_advance != null on a combat response).
   * Surfaced as a system log beat + grounding refresh + DM narration.
   *
   * T2 (Kage-CR ruling 2026-08-18): `outcomeLine` and the destination's
   * `arrival_line` STACK, in that order — outcome_line narrates leaving the
   * old scene (this resolution's authored beat), arrival_line narrates
   * entering the new one, exactly mirroring `onMoveOn`'s established
   * `playRescueTransitionLine(g); if (playArrivalLine(g)) return;` pair.
   * Only `playArrivalLine` gates the synthetic "Scene advance: X → Y.
   * Narrate the transition." beat below.
   */
  const handleSceneAdvance = useCallback(
    async (fromScene: string, toScene: string, outcome?: string, outcomeLine?: string | null) => {
      const label = outcome ? ` (${outcome})` : '';
      appendLog({
        who: 'Suzu',
        kind: 'system',
        text: `The scene shifts: ${fromScene} → ${toScene}${label}`,
      });
      const freshGrounding = await refreshGrounding();
      playOutcomeLine(outcomeLine, toScene);
      if (playArrivalLine(freshGrounding)) return;
      // Kage #1 / Miko DEFECT-2: this beat only narrates a transition the
      // caller's own scene_advance already performed server-side — suppress
      // the server's INTENT classifier from advancing the scene AGAIN.
      confirmBeatRef.current(
        'The scene changes.',
        `Scene advance: ${fromScene} → ${toScene}. Narrate the transition.`,
        'scene_advance',
      );
    },
    [appendLog, refreshGrounding, playOutcomeLine, playArrivalLine, confirmBeatRef],
  );

  /** Manual "Move on" button handler (ADV-7T). */
  // sceneAdvanceBusyRef: separate ref latch for Move on (uses its own state,
  // not combatBusyRef, since scene advance can coexist with combat logic).
  const sceneAdvanceBusyRef = useRef(false);

  const onMoveOn = useCallback(
    async (toScene: string | null) => {
      if (!session || !username || sceneAdvanceBusyRef.current) return;
      // FIX-2: guard against clicking Move on while an opening stream is in flight.
      // Without this, a race between the opening narration and a scene transition
      // leaves the opening_narrated marker unwritten → re-fires on the next mount.
      if (talking) return;
      // DDX-25 R2 (D2): a paused/ended session must not advance the scene.
      if (isSessionLocked(session)) return;
      // Iro Ship 2 CRITICAL-1: capture BEFORE the await — refreshGrounding()
      // below may recompute availableTransitions and unmount the clicked
      // button, so this is the last reliable moment to know it had focus.
      const hadFocusInTransitionWrap =
        transitionWrapRef.current?.contains(document.activeElement) ?? false;
      try {
        // FIX-3: latch INSIDE the try so the finally always resets them.
        sceneAdvanceBusyRef.current = true;
        setSceneAdvanceBusy(true);
        const result = await advanceScene(session.session_id, { to_scene: toScene });
        // TAV-SLICE-END-ADVANCE-NULL (engine d41351f): the terminal-transition
        // shape is `completed: true` (always paired with `to_scene: null`) —
        // there is no destination scene because the adventure just ended.
        const isAdventureComplete = result.completed === true || result.to_scene === null;
        if (isAdventureComplete) {
          setAdventureComplete(true);
          // T4p2: render-only — capture the completion payload's series
          // pointer (design doc §6.4) if the engine sent one.
          const firstSeries = result.series?.[0];
          if (firstSeries) {
            setCompletionSeries({
              series: firstSeries,
              next: result.next_adventure ?? null,
            });
          }
        }
        appendLog({
          who: 'Suzu',
          kind: 'system',
          text: isAdventureComplete
            ? 'The adventure is complete.'
            : `The scene shifts: ${result.from_scene} → ${result.to_scene}`,
        });
        const advancedGrounding = await refreshGrounding();
        refocusSceneHeadIfStranded(hadFocusInTransitionWrap);
        // DM-ARRIVAL-NARRATION (Leon's ruling 2026-08-09: REPLACE the beat).
        // C3 — plays first, same as the server-INTENT path; does NOT
        // participate in the "replace the synthetic beat" ruling below.
        playRescueTransitionLine(advancedGrounding);
        if (playArrivalLine(advancedGrounding)) return;
        // Kage #1 / Miko DEFECT-2: advanceScene() above already moved the
        // scene server-side — suppress the INTENT classifier from advancing
        // it a second time off this confirmation beat.
        const transitionContext = isAdventureComplete
          ? `Scene advance: ${result.from_scene} → the adventure concludes. Narrate the ending.`
          : `Scene advance: ${result.from_scene} → ${result.to_scene}. Narrate the transition.`;
        confirmBeatRef.current('We move on.', transitionContext, 'scene_advance');
      } catch (err) {
        const status = (err as { status?: number } | null)?.status;
        if (status === 400) {
          // freeform_session or unknown_scene — quiet info, not a crash.
          toast({ tone: 'info', message: 'No authored adventure to advance through.' });
        } else if (status === 503) {
          toast({ tone: 'info', message: 'Scene advancement is not available right now.' });
        } else {
          toast({ tone: 'error', message: 'Could not advance the scene.' });
        }
      } finally {
        sceneAdvanceBusyRef.current = false;
        setSceneAdvanceBusy(false);
      }
    },
    [
      session,
      username,
      talking,
      appendLog,
      refreshGrounding,
      refocusSceneHeadIfStranded,
      confirmBeatRef,
      toast,
      playArrivalLine,
      playRescueTransitionLine,
    ],
  );

  /**
   * P1-PLAYFIX §3.3.3 (S2.4) — check affordance handler ("Attempt: Survival (DC 12)").
   * Resolves the authored check via the engine (DC + skill match are engine-side —
   * the client only names the skill), narrates the real result, then MUST
   * refreshGrounding() so the client learns any flag/auto-advance from the
   * refreshed scene state rather than inferring it from the check response.
   */
  const checkBusyRef = useRef(false);

  const onAttemptCheck = useCallback(
    async (skill: string) => {
      // DDX-25 R2 (D2): a paused/ended session must not resolve a check
      // either (mirrors the `sessionLocked` gate on this button's disabled
      // prop, in page.tsx).
      if (!session || !username || checkBusyRef.current || talking || isSessionLocked(session)) return;
      const skillLabel = titleCaseSkill(skill);
      // Iro Ship 2 CRITICAL-1: capture BEFORE the await — refreshGrounding()
      // below may recompute availableChecks and unmount the clicked button,
      // so this is the last reliable moment to know it had focus.
      const hadFocusInCheckWrap = checkWrapRef.current?.contains(document.activeElement) ?? false;
      try {
        checkBusyRef.current = true;
        setCheckBusy(true);
        const result = await resolveCheck(session.session_id, {
          skill,
          actor_username: username,
          advantage: advantage === 'adv' ? true : undefined,
          disadvantage: advantage === 'dis' ? true : undefined,
        });
        // F4/CHECK-DOUBLE-RENDER: seed the durable reconcile ledger with this
        // check's own event_seq BEFORE the next poll tick can observe the
        // same check_resolved event and re-append it. Flag-gated:
        // renderedSeqsRef is only ever read from pollDurable (useSessionEvents
        // territory, not yet extracted), reachable only when
        // DURABLE_GENERATION_ENABLED.
        if (DURABLE_GENERATION_ENABLED && result.event_seq != null) {
          renderedSeqsRef.current.add(result.event_seq);
        }
        appendLog({
          who: username,
          kind: 'system',
          text: result.description,
          ...(DURABLE_GENERATION_ENABLED && result.event_seq != null
            ? { seq: result.event_seq }
            : {}),
        });
        // Check Retry + Fail-Forward Iro-A11y MAJOR-1 (2026-07-28): mark this
        // key as "resolved via my own click" BEFORE refreshGrounding() below
        // runs the disappearance-explanation diff, so it skips explaining a
        // resolution *I* just caused -- I get the toast + silent row instead
        // (below), not the spectator-facing explanation row.
        if (result.success && result.flag_set.length > 0) {
          ownResolvedCheckKeysRef.current.add(`${skill}-${result.dc}`);
        }
        // refreshGrounding() BEFORE narrate() so the scene card / check row are
        // already current when Suzu's beat lands (the engine may have set a
        // flag and/or auto-advanced the scene — never assumed from `result`).
        await refreshGrounding();
        refocusSceneHeadIfStranded(hadFocusInCheckWrap);
        // Check Retry + Fail-Forward (2026-07-28 design section 7.3): the
        // "zero success signal" half of the cold-open bug report -- a check
        // that resolves successfully AND sets a flag gets an explicit
        // payoff.
        if (result.success && result.flag_set.length > 0) {
          toast({ tone: 'success', message: 'The way forward opens.' });
          // Iro-A11y MAJOR-2 (2026-07-28): `silent: true` keeps this row in
          // the transcript for sighted/scrollback readers but hides it from
          // ChatLog's own aria-live region.
          appendLog({
            who: username,
            kind: 'system',
            text: '✦ The way forward opens.',
            silent: true,
          });
        }
        // Kage #1 / Miko DEFECT-2: resolveCheck() above already resolved the
        // check (and any resulting flag/auto-advance) server-side — suppress
        // the INTENT classifier from acting on this confirmation beat too.
        confirmBeatRef.current(`I attempt a ${skillLabel} check.`, result.mechanics, 'check_confirm');
      } catch (err) {
        // F1/CAST-FAIL-SILENT: curated map wins for the known reasons.
        const fallback = 'Could not resolve that check.';
        const message = engineErrorMessage(err, {
          fallback,
          reasonMap: {
            no_such_check: `No ${skillLabel} check is available right now.`,
            freeform_session: 'No authored adventure to check against.',
            msm_disabled: 'Skill checks are not available right now.',
            // Check Retry + Fail-Forward (2026-07-28 design section 7.5):
            // curated copy wins over the engine's own 409 message.
            check_locked: 'That approach is closed — find another way.',
            check_resolved: "You've already settled that one.",
          },
        });
        toast({ tone: message === fallback ? 'error' : 'info', message });
        // Tora-Gesture MAJOR-1 (2026-07-28): a check_locked/check_resolved
        // 409 means THIS client's grounding is stale relative to the server
        // -- self-correct immediately for these two reasons ONLY, mirroring
        // the success path's own refresh+refocus above.
        const reason = isApiError(err) ? extractReason(err) : undefined;
        if (reason === 'check_locked' || reason === 'check_resolved') {
          await refreshGrounding();
          refocusSceneHeadIfStranded(hadFocusInCheckWrap);
        }
      } finally {
        checkBusyRef.current = false;
        setCheckBusy(false);
      }
    },
    [
      session,
      username,
      talking,
      advantage,
      appendLog,
      refreshGrounding,
      refocusSceneHeadIfStranded,
      confirmBeatRef,
      toast,
      renderedSeqsRef,
    ],
  );

  // Phase 4 Package B (Sora-Arch design §3 Fork 2) — does the CURRENT scene
  // define an authored combat encounter at all (any trigger, before it's
  // ever started)? Drives page.tsx's "Begin an encounter"/"Stand and fight"
  // button render gate and its rising-edge toast effect (both stay in
  // page.tsx — they also read `combatId`, useCombat's state).
  const sceneHasEncounter = grounding?.encounter != null;

  // P1-PLAYFIX-2 §A.3: memoized (not a plain const) — the composer's
  // keyword-fast-path (page.tsx onSend, still there) depends on this array,
  // and a fresh array literal every render would recreate that callback
  // every render too. `combatEngaged` is a parameter (Amendment A §A.1:
  // `isCombatEngaged(combatState)`, owned by useCombat, not yet extracted)
  // — transitions/checks are an exploration-beat affordance, hidden during
  // active combat. This is a DATA gate, not a presentation one — see this
  // hook's own header comment for why.
  const availableTransitions = useMemo<SceneTransition[]>(
    () =>
      combatEngaged === false && grounding?.transitions
        ? grounding.transitions.filter((t) => {
            // NOTE (TAV-SCENE-TRANSITION-LEAKS-FLAG-SLUG, 2026-08-06): flag
            // gating is deliberately NOT done here. The engine owns it —
            // `engine/beats.py::available_transitions` evaluates a
            // transition's `requires: [flag, ...]` list and
            // `routes/sessions.py` replaces `current_scene["transitions"]`
            // with that filtered subset before grounding reaches the wire.
            if (!t.requires_encounter_resolved) return true;
            const enc = grounding.encounter_state as Record<string, { status?: string }> | null;
            if (!enc) return false;
            const st = enc[t.requires_encounter_resolved]?.status ?? '';
            return st.startsWith('resolved_');
          })
        : [],
    [combatEngaged, grounding],
  );

  // P1-PLAYFIX §3.3.3 (S2.4) — authored skill checks for the current scene.
  // Same combat gating as "Move on": hidden during active combat.
  //
  // D1a (Leon, product decision, 2026-07-19): ALL of the active scene's
  // authored checks surface as first-class, player-invoked affordances — no
  // longer gated behind a narrator invite. Deduped by skill+dc, left in the
  // scene's own authored order.
  const availableChecks = useMemo<SceneCheck[]>(() => {
    if (combatEngaged) return [];
    const raw = grounding?.checks ?? [];
    const seen = new Set<string>();
    const deduped: SceneCheck[] = [];
    for (const c of raw) {
      // Check Retry + Fail-Forward (2026-07-28 design section 7.1/7.2): a
      // resolved check is removed from the rail entirely.
      if (c.state === 'resolved') continue;
      const key = `${c.skill}-${c.dc}`;
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(c);
    }
    return deduped;
  }, [combatEngaged, grounding]);

  return {
    grounding,
    setGrounding,
    sceneAdvanceBusy,
    adventureComplete,
    completionSeries,
    checkBusy,
    offeredCheckSkill,
    setOfferedCheckSkill,
    freeformOfferedCheck,
    setFreeformOfferedCheck,
    sceneHeadRef,
    checkWrapRef,
    transitionWrapRef,
    freeformCheckRef,
    sceneHasEncounter,
    availableTransitions,
    availableChecks,
    diffAndExplainResolvedChecks,
    refreshGrounding,
    playArrivalLine,
    playRescueTransitionLine,
    playOutcomeLine,
    refocusSceneHeadIfStranded,
    applyOfferedCheckSignal,
    openScene,
    handleSceneAdvance,
    onMoveOn,
    onAttemptCheck,
  };
}
