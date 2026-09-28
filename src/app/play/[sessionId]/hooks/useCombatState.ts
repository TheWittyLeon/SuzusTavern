'use client';

/**
 * TAV-PLAY-SHELL step 5, hook 5a of ~9 (decomposition plan §2.2, amended by
 * Amendment A §A.2 row 5 / §A.6) — `useCombatState`. Plan §2.2 originally
 * named one `useCombat(sessionId, session)` hook; Amendment A splits it in
 * two along the state/behaviour line (§A.2's rule: "a hook that only holds
 * state, refs and a poll that reads none of its siblings composes in tier
 * 1[-of-combat]"). This half owns the state cells.
 *
 * Composed ABOVE `useScene` (Amendment A §A.1/§A.6) so `useScene` can take
 * `combatEngaged: boolean` as a plain downward parameter instead of the
 * whole `CombatState` — `isCombatEngaged` itself stays in `../format.ts`
 * (Amendment A §A.1); only the CALL moves here from page.tsx.
 *
 * Owns plan §1.4's state half: `combatId`, `combatState`, `combatBusy`,
 * `refusedReason`, `outcomeChooserOpen`, the `combatStateRef` sync effect,
 * the 4s combat-state poll (deps `[combatId]`, unchanged reasoning), and
 * every pure derivation off `combatState` (§A.6): `combatEngaged`,
 * `combatIsActive`, `round`, `targetableFoes`, `isPlayerTurn`, `isDying`,
 * `anyMonsterDown`, `allHostilesDown`, `selfPcId`.
 *
 * `setCombatId`/`setCombatState`/`stateSeqRef`/`setCombatBusy` are exported
 * because three write sites outside `useCombatActions` still write through
 * them directly: the mount-load effect (`page.tsx`, seeds `combatId` +
 * fetches initial `combatState`), `DmNarrationPanel`'s
 * `onCombatStateUpdate`/`onCombatStateRefresh`, and `CastSpellPanel`'s
 * `onStateRefresh`. None of those move into this hook — they stay inline in
 * page.tsx exactly as before, now reading these setters/refs from this
 * hook's return instead of a local `useState`/`useRef` call.
 *
 * Deliberately does NOT own (§A.6): `combatEncounterUnstarted`/
 * `sceneCreatureNames` (read `grounding`, a tier-6/useScene concern this
 * state-tier hook can't reach — they stay in page.tsx, "useCombat's own
 * derived values" per useScene.ts's own header, just not THIS half of it),
 * `activeParticipant`/`activeIsMine`/`myActionSpent`/`myDeathSaveParticipant`/
 * `isMyPcDead`/`turnStatusText`/`activeEncounterId` (JSX-adjacent derived
 * values not named in Amendment A §A.6's "every pure derivation" list —
 * they stay in page.tsx, recomputed there off this hook's `combatState`
 * return, the same cheap-recompute shape `myDeathSaveParticipant` already
 * used before this split), the movement-model fields (`at`/`space`/
 * `movement_remaining` — lane B6 adds those to `CombatState` itself; they
 * arrive as fields on this hook's own `combatState`, no edge here), and
 * `beginEncounter`/`onCombatAction`/`onEndCombat`/the monster auto-driver
 * effect/the turn-change refocus effect (`useCombatActions`, composed AFTER
 * scene + narration — see that hook's own header).
 */
import { useEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import { getCombatState } from '@/lib/api/dnd';
import { isLivingTargetableFoe } from '@/lib/dnd/combatTargets';
import type { CombatTarget } from '@/components/Composer';
import type { CombatState, Participant } from '@/lib/api/types';
import { POLL_INTERVAL_MS, isCombatEngaged } from '../format';

export interface UseCombatStateResult {
  combatId: string | null;
  setCombatId: Dispatch<SetStateAction<string | null>>;
  combatState: CombatState | null;
  setCombatState: Dispatch<SetStateAction<CombatState | null>>;
  combatBusy: boolean;
  setCombatBusy: Dispatch<SetStateAction<boolean>>;
  refusedReason: string | null;
  setRefusedReason: Dispatch<SetStateAction<string | null>>;
  outcomeChooserOpen: boolean;
  setOutcomeChooserOpen: Dispatch<SetStateAction<boolean>>;
  combatStateRef: MutableRefObject<CombatState | null>;
  stateSeqRef: MutableRefObject<number>;
  combatBusyRef: MutableRefObject<boolean>;
  monsterDrivingRef: MutableRefObject<boolean>;
  pollIntervalRef: MutableRefObject<ReturnType<typeof setInterval> | null>;
  /** Amendment A §A.1 — the ONE derived boolean useScene reads. NOT
   *  `combatIsActive` below (see that field's own note). */
  combatEngaged: boolean;
  /** `!!combatId && combatState?.state !== 'ended'` — also true before
   *  initiative and between turns, unlike `combatEngaged`. Kept as a
   *  SEPARATE field (never unified — Amendment A §A.1's naming note) since
   *  page.tsx's render gates (`statusPill`, `TopBar`, `PartyStrip`, ...)
   *  have always used this exact predicate. */
  combatIsActive: boolean;
  round: number | null;
  targetableFoes: CombatTarget[];
  isPlayerTurn: boolean;
  isDying: boolean;
  anyMonsterDown: boolean;
  allHostilesDown: boolean;
  selfPcId: string | null;
}

export function useCombatState(
  myCharacterIdStr: string | null,
  participants: Participant[],
  username: string | null,
): UseCombatStateResult {
  const [combatId, setCombatId] = useState<string | null>(null);
  const [combatState, setCombatState] = useState<CombatState | null>(null);
  const [combatBusy, setCombatBusy] = useState(false);
  const [refusedReason, setRefusedReason] = useState<string | null>(null);
  // B3-1: outcome chooser state (null = chooser closed).
  const [outcomeChooserOpen, setOutcomeChooserOpen] = useState(false);

  // Monotone sequence guard: combatState updates from polls must not overwrite
  // a more-recent mutation response. Mutations bump this; polls gate on it.
  const stateSeqRef = useRef(0);
  // Synchronous latch for double-tap protection on all combat mutating actions.
  // React state (combatBusy) only disables UI after a re-render; the ref closes
  // the race window between two taps in the same event-loop tick.
  const combatBusyRef = useRef(false);
  // Guards the auto monster-turn driver so combatState updates mid-loop don't
  // spawn a second concurrent driver.
  const monsterDrivingRef = useRef(false);
  // Mirror of combatState kept in sync via an effect so the poll callback can
  // read the current state without being listed as a dep (avoids resetting the
  // interval on every state-string transition).
  const combatStateRef = useRef<CombatState | null>(null);
  // DDX-08 / T3: interval handle for the combat-state poll below.
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Keep combatStateRef in sync so the poll callback can read current state
  // without being a dep of the poll effect (which would reset the interval on
  // every state-string transition such as active→between_turns→active).
  useEffect(() => {
    combatStateRef.current = combatState;
  }, [combatState]);

  // ── combat state poll (4s, foregrounded) ────────────────────────────────────
  // Deps: [combatId] only — state transitions (active→between_turns→active) must
  // NOT reset the interval. The ended short-circuit is checked inside poll() via
  // combatStateRef so the effect never needs to observe combatState?.state.
  useEffect(() => {
    if (!combatId) return;

    const poll = async () => {
      if (document.hidden) return;
      // Short-circuit: if combat has ended, skip the fetch.
      if (combatStateRef.current?.state === 'ended') return;
      const mySeq = stateSeqRef.current;
      try {
        const cs = await getCombatState(combatId);
        // Only apply if no mutation has happened since we sent this request.
        if (stateSeqRef.current === mySeq) {
          setCombatState(cs);
        }
      } catch {
        // Poll errors are non-fatal — the next tick will retry.
      }
    };

    pollIntervalRef.current = setInterval(poll, POLL_INTERVAL_MS);

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, [combatId]);

  // ── derived combat state (Amendment A §A.6: "every pure derivation off
  // combatState") ─────────────────────────────────────────────────────────────
  const combatEngaged = isCombatEngaged(combatState);
  const combatIsActive = !!combatId && combatState?.state !== 'ended';
  // Round from combatState is authoritative; fall back to null when no state yet.
  const round = combatState?.round ?? null;

  // Participants that are valid targets (living, targetable enemies).
  // F2/CAST-DEAD-TARGET: shared with CastSpellPanel's own target picker via
  // isLivingTargetableFoe (src/lib/dnd/combatTargets.ts) — Cast layers a
  // heal-downed-ally exception on top of the same base rule instead of
  // re-deriving it.
  const targetableFoes: CombatTarget[] = combatState
    ? combatState.participants
        .filter(isLivingTargetableFoe)
        .map((p) => ({
          id: p.participant_id,
          name: p.name,
          hp: p.hp_current,
          maxHp: p.hp_max,
        }))
    : [];

  // B1-4: per-user turn resolution. Find the active participant; it's MY turn
  // only when the active participant is a PC whose entity_id matches my bound
  // character_id (stringified). Out of combat: always enabled. DM/no-character:
  // never their turn during combat. Local-only (not exported): page.tsx
  // recomputes its own copy for myActionSpent/myDeathSaveParticipant/
  // isMyPcDead/turnStatusText, none of which Amendment A §A.6 names as this
  // hook's own — see this file's header.
  const activeParticipant = combatState?.participants.find((p) => p.is_active_turn) ?? null;
  const activeIsMine =
    activeParticipant?.is_pc === true &&
    myCharacterIdStr != null &&
    activeParticipant.entity_id === myCharacterIdStr;

  const isPlayerTurn = combatState?.state === 'active'
    ? activeIsMine
    : true; // out of combat: always enabled

  // Combat-UX Fixes 2026-07-27, Fix B: the gate for the "Roll death save"
  // affordance — the viewer's own PC, on their turn, at 0 HP, not stable, not
  // dead (death_saves.is_dying already encodes exactly that on the wire).
  const isDying = activeIsMine && activeParticipant?.death_saves?.is_dying === true;

  // B3-1: Victory is disabled when no monster is down (engine would 400 victory_refused).
  const anyMonsterDown = !!combatState?.participants.some(
    (p) => !p.is_pc && !p.is_alive,
  );
  // F3/COMBAT-NO-AUTO-RESOLVE: advisory (never blocking) — surfaced when the
  // last hostile drops mid-combat. Reuses `targetableFoes` (isLivingTargetableFoe),
  // the SAME signal the attack rail's own target picker already computes,
  // rather than re-deriving "any living enemy" a second way. Gated on
  // state==='active' explicitly (not just emptiness) — targetableFoes is ALSO
  // empty before combat starts and after it ends, for a different reason;
  // this must not fire in either case.
  const allHostilesDown = combatState?.state === 'active' && targetableFoes.length === 0;

  // Find the selfParticipantId for the "you" badge in the tracker.
  // B1-4: prefer entity_id match (precise); fall back to name match for older engine.
  const selfPcId =
    (myCharacterIdStr != null
      ? combatState?.participants.find(
          (p) => p.is_pc && p.entity_id === myCharacterIdStr,
        )?.participant_id
      : undefined) ??
    combatState?.participants.find(
      (p) =>
        p.is_pc &&
        participants.some(
          (part) =>
            part.username.toLowerCase() === (username ?? '').toLowerCase() &&
            part.character?.name?.toLowerCase() === p.name.toLowerCase(),
        ),
    )?.participant_id ??
    null;

  return {
    combatId,
    setCombatId,
    combatState,
    setCombatState,
    combatBusy,
    setCombatBusy,
    refusedReason,
    setRefusedReason,
    outcomeChooserOpen,
    setOutcomeChooserOpen,
    combatStateRef,
    stateSeqRef,
    combatBusyRef,
    monsterDrivingRef,
    pollIntervalRef,
    combatEngaged,
    combatIsActive,
    round,
    targetableFoes,
    isPlayerTurn,
    isDying,
    anyMonsterDown,
    allHostilesDown,
    selfPcId,
  };
}
