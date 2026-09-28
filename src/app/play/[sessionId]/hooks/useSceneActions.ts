'use client';

/**
 * TAV-PLAY-SHELL step 5, hook 9 of ~9 (decomposition plan §2.2, amended by
 * Amendment A §A.2 row 9) — `useSceneActions`. The behaviour half of what
 * A1 landed as one `useScene` hook (§A.2's rule: "a hook that CALLS a
 * sibling composes after everything it calls"). Owns `handleSceneAdvance`
 * (the ADV-8 auto-advance narrator, shared with `useCombatActions`' own
 * scene_advance path) and the two player-facing handlers `onMoveOn`/
 * `onAttemptCheck`.
 *
 * Composed AFTER `useSceneState` (row 6) AND `useNarration` (row 7) — this
 * is the resolution to Amendment A §A.3 edge R2 (`useScene` → `useNarration`:
 * `narrate`/`narrateDurableBeat`/`talking`) and the reason the old single
 * `useScene` needed `confirmBeatRef` at all. All three handlers here fire a
 * confirmation narration beat; with this hook composed below `useNarration`,
 * `narrate`/`narrateDurableBeat` are plain, already-declared parameters —
 * no temporal dead zone, no ref.
 *
 * `confirmBeat` (below) replaces `confirmBeatRef.current(...)` + the
 * page.tsx `useLayoutEffect` that used to keep it current (Amendment A
 * §A.4/§A.5 step 3, deleted in this same commit's third half). The
 * `DURABLE_GENERATION_ENABLED` fork that effect owned moves here verbatim —
 * same two arms, same "byte-unchanged legacy path" comment on the flag-OFF
 * arm (still the live one in prod) — as a plain `useCallback`, because
 * nothing above this hook's call site needs it early: it is used only by
 * the three functions this hook itself defines.
 *
 * Signature — `session`, `sceneState: UseSceneStateResult`, `narrate:
 * NarrateFn`, `narrateDurableBeat: NarrateDurableBeatFn`, `talking`,
 * `advantage`, `appendLog`, `renderedSeqsRef`:
 *   - `sceneState` is the whole `useSceneState` return, not exploded — same
 *     "many fields, one hook" shape `useCombatActions` already established
 *     for `combat: UseCombatStateResult` and `useNarration` (A5's other
 *     half) established for `sceneState`/`transcript`. `internals`
 *     (`setAdventureComplete`/`setCompletionSeries`/`setSceneAdvanceBusy`/
 *     `setCheckBusy`/`ownResolvedCheckKeysRef`) is the one sub-object this
 *     hook reads that page.tsx's own JSX never does — see
 *     `useSceneState.ts`'s header for why it's grouped there (Amendment A
 *     §A.7 risk A-R3).
 *   - `username` is self-derived via `useAuth()`, not a parameter — matches
 *     the OLD `useScene`'s own choice (and `useSceneState`'s /`useSafety`'s),
 *     not `useCombatActions`' deviation (justified there for a reason
 *     specific to that hook).
 *   - `sessionId` is NOT a parameter — neither `handleSceneAdvance` nor
 *     `onMoveOn`/`onAttemptCheck` ever read a separate `sessionId` string;
 *     all three reach the session id via `session.session_id`.
 *   - `sceneAdvanceBusyRef`/`checkBusyRef` are this hook's OWN local
 *     `useRef` calls (see `useSceneState.ts`'s header) — each has exactly
 *     one reader, the handler declared right below it, same as before this
 *     split.
 *
 * No new ref-mirror: `confirmBeat` is a plain function, not a ref. The
 * `debt:` marker's own `ceiling:` ("exactly ONE such ref in hooks/") is
 * satisfied by there being ZERO after this commit, not by staying at one.
 */
import { useCallback, useRef, type MutableRefObject } from 'react';
import { useAuth } from '@/lib/auth/AuthProvider';
import { useToast } from '@/components/Toast';
import { advanceScene, resolveCheck } from '@/lib/api/dnd';
import { engineErrorMessage, extractReason, isApiError } from '@/lib/dnd/engineError';
import { DURABLE_GENERATION_ENABLED } from '@/lib/config';
import type { Advantage } from '@/components/DiceTray';
import type { LogRow } from '@/components/ChatLog';
import type { Session } from '@/lib/api/types';
import { isSessionLocked, titleCaseSkill } from '../format';
import type { NarrateDurableBeatFn, NarrateFn } from './useNarration';
import type { UseSceneStateResult } from './useSceneState';

// Amendment A §A.4 (IMPORTANT-1): all three call pairs into
// narrate/narrateDurableBeat differ only in playerLine/mechanics/the durable
// beat label -- beatMode is always 'act' and suppressIntent always true on
// every branch. The union is exhaustive for THIS hook, which is the only
// thing that fires these two beats.
type SceneConfirmBeat = 'scene_advance' | 'check_confirm';

export interface UseSceneActionsResult {
  handleSceneAdvance: (
    fromScene: string,
    toScene: string,
    outcome?: string,
    outcomeLine?: string | null,
  ) => Promise<void>;
  onMoveOn: (toScene: string | null) => Promise<void>;
  onAttemptCheck: (skill: string) => Promise<void>;
}

export function useSceneActions(
  session: Session | null,
  sceneState: UseSceneStateResult,
  narrate: NarrateFn,
  narrateDurableBeat: NarrateDurableBeatFn,
  talking: boolean,
  advantage: Advantage,
  appendLog: (row: Omit<LogRow, 'id' | 'ts'>) => void,
  renderedSeqsRef: MutableRefObject<Set<number>>,
): UseSceneActionsResult {
  const { user } = useAuth();
  const username = user?.username ?? null;
  const { toast } = useToast();

  const {
    transitionWrapRef,
    checkWrapRef,
    refreshGrounding,
    playOutcomeLine,
    playArrivalLine,
    playRescueTransitionLine,
    refocusSceneHeadIfStranded,
    internals: { setAdventureComplete, setCompletionSeries, setSceneAdvanceBusy, setCheckBusy, ownResolvedCheckKeysRef },
  } = sceneState;

  // Amendment A §A.4/§A.5 step 3 — replaces confirmBeatRef + page.tsx's
  // useLayoutEffect. useSceneActions composes BELOW useNarration, so
  // narrate/narrateDurableBeat are plain, already-declared values here: no
  // temporal dead zone, so no ref is needed to cross it.
  const confirmBeat = useCallback(
    (playerLine: string, mechanics: string, beat: SceneConfirmBeat) => {
      if (DURABLE_GENERATION_ENABLED) {
        void narrateDurableBeat(playerLine, mechanics, 'act', { suppressIntent: true, beat });
      } else {
        void narrate(playerLine, mechanics, 'act', { suppressIntent: true }); // byte-unchanged legacy path
      }
    },
    [narrate, narrateDurableBeat],
  );

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
      confirmBeat(
        'The scene changes.',
        `Scene advance: ${fromScene} → ${toScene}. Narrate the transition.`,
        'scene_advance',
      );
    },
    [appendLog, refreshGrounding, playOutcomeLine, playArrivalLine, confirmBeat],
  );

  /** Manual "Move on" button handler (ADV-7T). */
  // sceneAdvanceBusyRef: separate ref latch for Move on (uses its own state,
  // not combatBusyRef, since scene advance can coexist with combat logic).
  // Local to this hook -- see useSceneState.ts's header on why this ref
  // moved bodily instead of riding sceneState's internals bundle.
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
        confirmBeat('We move on.', transitionContext, 'scene_advance');
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
      confirmBeat,
      toast,
      playArrivalLine,
      playRescueTransitionLine,
      transitionWrapRef,
      setSceneAdvanceBusy,
      setAdventureComplete,
      setCompletionSeries,
    ],
  );

  /**
   * P1-PLAYFIX §3.3.3 (S2.4) — check affordance handler ("Attempt: Survival (DC 12)").
   * Resolves the authored check via the engine (DC + skill match are engine-side —
   * the client only names the skill), narrates the real result, then MUST
   * refreshGrounding() so the client learns any flag/auto-advance from the
   * refreshed scene state rather than inferring it from the check response.
   */
  // checkBusyRef: local to this hook -- see useSceneState.ts's header.
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
        // renderedSeqsRef is only ever read from pollDurable
        // (`hooks/useSessionEvents.ts`, Amendment A row 11, A4), reachable
        // only when DURABLE_GENERATION_ENABLED.
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
        confirmBeat(`I attempt a ${skillLabel} check.`, result.mechanics, 'check_confirm');
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
      confirmBeat,
      toast,
      renderedSeqsRef,
      checkWrapRef,
      setCheckBusy,
      ownResolvedCheckKeysRef,
    ],
  );

  return { handleSceneAdvance, onMoveOn, onAttemptCheck };
}
