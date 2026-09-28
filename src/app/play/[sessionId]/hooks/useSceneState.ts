'use client';

/**
 * TAV-PLAY-SHELL step 5, hook 6 of ~9 (decomposition plan §2.2, amended by
 * Amendment A §A.2 row 6) — `useSceneState`. The state half of what A1
 * landed as one `useScene` hook — Amendment A §A.2's rule: "a hook that
 * only holds state, refs and a poll that reads none of its siblings
 * composes in tier 1." Owns plan §1.5 MINUS the three beat-firing handlers:
 * grounding, the check-disappearance-explanation diff ledger, the
 * arrival/rescue/outcome authored-line players, the scene-head refocus
 * helper, the offered-check signal router, and the A1 opening-scene gate.
 *
 * `handleSceneAdvance`/`onMoveOn`/`onAttemptCheck` moved to `useSceneActions`
 * (row 9, A5's other half, same file split) — each one fires a confirmation
 * narration beat, which is `useNarration`'s (row 7, composed BELOW this
 * hook and ABOVE `useSceneActions`) concern, not this hook's.
 *
 * Signature is `useSceneState(sessionId, combatEngaged, appendLog)`, not the
 * plan's abridged `useScene(sessionId)` — narrower than A1's original
 * `useScene`, which also took `session`/`talking`/`advantage`/
 * `confirmBeatRef`/`renderedSeqsRef`: every one of those five was needed
 * only by the three handlers that moved to `useSceneActions` (`session` had
 * zero remaining readers here once they left — `openScene`'s own `s`
 * parameter is a caller-supplied argument, not this hook's `session`
 * closure, so dropping the unused parameter rather than threading a dead
 * value through is the correct read of "no unrequested parameter", the
 * same rule that keeps `density` off a region that doesn't vary by it):
 *   - `combatEngaged` (Amendment A §A.1) — the ONE derived boolean this hook
 *     reads off combat's state (`isCombatEngaged(combatState)`, see
 *     `../format.ts`), not `CombatState` itself. Gates
 *     `availableTransitions`/`availableChecks` during active combat — a
 *     DATA gate, not a presentation one (see A.1's own reasoning, unchanged
 *     from A1).
 *   - `appendLog` — every authored-line player writes to the transcript;
 *     that's useTranscript's concern (row 4, composed ABOVE this hook).
 *
 * `internals` (Amendment A §A.7 risk A-R3, its own named mitigation) — the
 * split widens this hook's public surface: `setAdventureComplete`,
 * `setCompletionSeries`, `setSceneAdvanceBusy`, `setCheckBusy`,
 * `ownResolvedCheckKeysRef` exist ONLY so `useSceneActions`' moved handlers
 * can write state this hook still owns (page.tsx's own JSX reads
 * `adventureComplete`/`completionSeries`/`sceneAdvanceBusy`/`checkBusy` as
 * plain values). Grouped under one `internals` field, per A-R3's own
 * mitigation text, so the exported surface reads as "these are for
 * useSceneActions", not general API.
 *
 * `sceneAdvanceBusyRef`/`checkBusyRef` — NOT part of `internals`, and not
 * part of this file at all. Both were pure synchronous-double-submit
 * latches read/written ONLY inside the one handler each served
 * (`onMoveOn`/`onAttemptCheck` respectively) — zero other readers in `main`
 * before this split. They move bodily into `useSceneActions.ts` as its own
 * local `useRef` calls instead of being threaded back through this hook's
 * `internals` bundle: a ref with exactly one reader belongs where it's
 * read, and exporting it here would widen this hook's surface for no
 * consumer outside the one handler that already owns it. This is a
 * narrower, not a wider, reading of A-R3's own enumerated list (which named
 * both as becoming exported) — the goal A-R3 states (minimal exported
 * surface) is better served by not exporting them at all than by grouping
 * them.
 */
import { useCallback, useMemo, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import { useToast } from '@/components/Toast';
import {
  C3_GROUNDING_FIELD,
  getGrounding,
  getSessionEvents,
  postSessionEvent,
} from '@/lib/api/dnd';
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
import { buildReadAloudBlock, titleCaseSkill } from '../format';

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

export interface UseSceneStateResult {
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
  sceneHeadRef: MutableRefObject<HTMLDivElement | null>;
  checkWrapRef: MutableRefObject<HTMLDivElement | null>;
  transitionWrapRef: MutableRefObject<HTMLDivElement | null>;
  freeformCheckRef: MutableRefObject<HTMLDivElement | null>;
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
  /** Amendment A §A.7 A-R3 mitigation — see this file's header. */
  internals: {
    setAdventureComplete: Dispatch<SetStateAction<boolean>>;
    setCompletionSeries: Dispatch<
      SetStateAction<{ series: SeriesCompletionPointer; next: SeriesNextAdventure | null } | null>
    >;
    setSceneAdvanceBusy: Dispatch<SetStateAction<boolean>>;
    setCheckBusy: Dispatch<SetStateAction<boolean>>;
    ownResolvedCheckKeysRef: MutableRefObject<Set<string>>;
  };
}

export function useSceneState(
  sessionId: string,
  combatEngaged: boolean,
  appendLog: (row: Omit<LogRow, 'id' | 'ts'>) => void,
): UseSceneStateResult {
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
  // + SILENT log row (onAttemptCheck, MAJOR-2, useSceneActions.ts); every
  // OTHER client only sees the check silently vanish from the rail unless
  // this fires. Keyed `${skill}-${dc}`, mirroring the engine's own
  // check_key convention (minus scene_id -- these refs are scene-scoped and
  // reset on scene change instead, see below).
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
   * (`useCombatActions`) for the no-advance path, and `handleSceneAdvance`
   * (`useSceneActions`) for the advance path.
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
   * legacy/flag-OFF SSE beat (`narrate()`, useNarration.ts) or the durable
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
   * beat via onSend/onRoll, page.tsx).
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

  // Phase 4 Package B (Sora-Arch design §3 Fork 2) — does the CURRENT scene
  // define an authored combat encounter at all (any trigger, before it's
  // ever started)? Drives page.tsx's "Begin an encounter"/"Stand and fight"
  // button render gate and its rising-edge toast effect (both stay in
  // page.tsx — they also read `combatId`, useCombatState's own state).
  const sceneHasEncounter = grounding?.encounter != null;

  // P1-PLAYFIX-2 §A.3: memoized (not a plain const) — the composer's
  // keyword-fast-path (page.tsx onSend) depends on this array, and a fresh
  // array literal every render would recreate that callback every render
  // too. `combatEngaged` is a parameter (Amendment A §A.1:
  // `isCombatEngaged(combatState)`, owned by useCombatState) — transitions/
  // checks are an exploration-beat affordance, hidden during active combat.
  // This is a DATA gate, not a presentation one — see this hook's own
  // header comment for why.
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
    internals: {
      setAdventureComplete,
      setCompletionSeries,
      setSceneAdvanceBusy,
      setCheckBusy,
      ownResolvedCheckKeysRef,
    },
  };
}
