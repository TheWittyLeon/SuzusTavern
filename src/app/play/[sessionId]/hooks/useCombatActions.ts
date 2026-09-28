'use client';

/**
 * TAV-PLAY-SHELL step 5, hook 5b of ~9 (decomposition plan §2.2, amended by
 * Amendment A §A.2 row 10 / §A.6) — `useCombatActions`. The behaviour half
 * of what the plan originally named one `useCombat(sessionId, session)`
 * hook (§A.2's rule: "a hook that CALLS a sibling composes after everything
 * it calls").
 *
 * Composed AFTER `useSceneState`, `useNarration` and `useSceneActions` (§A.6;
 * A5 landed the latter two — `narrate`/`narrateDurableBeat` come from
 * `useNarration`'s destructure, `handleSceneAdvance` from
 * `useSceneActions`', `playOutcomeLine`/`refreshGrounding` from
 * `useSceneState`'s, all declared above this hook's call site in page.tsx).
 *
 * Owns: `beginEncounter`, `onCombatAction`, `onEndCombat`, the monster
 * auto-driver effect, and the turn-change refocus effect. Deliberately does
 * NOT own the dying-row refocus effect (a THIRD, separate effect per plan
 * §1.13 — stays in page.tsx, reads this hook's `isDying` return) or the
 * XP-form Escape guard (stays in page.tsx — useSessionLifecycle territory).
 *
 * Signature deviation from §A.6's abridged list (same kind of documented
 * deviation `useSceneState`'s/`useSceneActions`'/`useSafety`'s own headers
 * flag):
 *   - `combat: UseCombatStateResult` — §A.6 names this input as
 *     "combatState" (singular). The moved code actually reads/writes TEN
 *     separate fields off `useCombatState`'s return (`combatId`,
 *     `combatState`, three setters, three refs). Passing those as ten more
 *     positional parameters (on top of the eight §A.6 already names) would
 *     make the call site error-prone to read in the right order; passing
 *     the hook's own result object is ordinary hook composition, not a new
 *     mechanism — the same "many fields, one hook" shape `useNarration` (A5)
 *     uses for its own `sceneState`/`transcript` parameters.
 *   - `myCharacterIdStr`, `sceneHeadRef`, `composerRailAnchorRef`,
 *     `dmPanelAnchorRef`, `localTurnActionRef` — needed by the turn-change
 *     refocus effect, not named in §A.6's list. `composerRailAnchorRef`/
 *     `dmPanelAnchorRef`/`localTurnActionRef` stay DECLARED in page.tsx
 *     (not created here) because they are ALSO read by page.tsx's own JSX
 *     (`railRef`/`dmPanelAnchorRef` props) and, for `composerRailAnchorRef`,
 *     by the separate dying-row refocus effect this hook does not own — one
 *     ref object, passed in, never duplicated.
 *   - `toast` is NOT a parameter — called via its own `useToast()`, same as
 *     `useSceneState`/`useSceneActions`/`useSafety` already do for the
 *     identical value.
 *   - `username` IS a plain parameter (per §A.6, unlike `useSceneState`'s/
 *     `useSceneActions`' own choice to re-derive it via `useAuth()` — §A.6
 *     names it explicitly for this hook, so it is taken as given rather
 *     than re-derived).
 *
 * No new ref-mirror: every ref this hook uses (`combatBusyRef`/
 * `stateSeqRef`/`monsterDrivingRef` from `combat`; `composerRailAnchorRef`/
 * `dmPanelAnchorRef`/`localTurnActionRef`/`sceneHeadRef` passed in) already
 * existed before this split. `confirmBeatRef` — the one ref-mirror this
 * file's sibling marker used to permit — is deleted as of A5 (see
 * `useSceneActions.ts`'s header); zero ref-mirrors remain in `hooks/`.
 */
import { useCallback, useEffect, useRef, type MutableRefObject, type RefObject } from 'react';
import { useToast } from '@/components/Toast';
import {
  combatFromScene,
  endCombat,
  getCombatState,
  rollInitiative,
  monsterTurn,
  attack as combatAttack,
  dodge as combatDodge,
  dash as combatDash,
  endTurn as combatEndTurn,
  rollDeathSave as combatDeathSave,
} from '@/lib/api/dnd';
import { DURABLE_GENERATION_ENABLED } from '@/lib/config';
import { engineErrorMessage } from '@/lib/dnd/engineError';
import { COMBAT_REFUSAL_REASON_MAP } from '@/lib/dnd/engineReasons';
import type { CombatAction } from '@/components/Composer';
import type { LogRow } from '@/components/ChatLog';
import type { CombatState, EndCombatOutcome, Session } from '@/lib/api/types';
import { isSessionLocked } from '../format';
import type { UseCombatStateResult } from './useCombatState';
import type { NarrateFn, NarrateDurableBeatFn } from './useNarration';
import type { UseSceneActionsResult } from './useSceneActions';
import type { UseSceneStateResult } from './useSceneState';

export interface UseCombatActionsResult {
  beginEncounter: () => Promise<void>;
  onCombatAction: (action: CombatAction, payload?: string) => Promise<void>;
  onEndCombat: (outcome?: EndCombatOutcome) => Promise<void>;
}

export function useCombatActions(
  session: Session | null,
  username: string | null,
  myCharacterIdStr: string | null,
  combat: UseCombatStateResult,
  appendLog: (row: Omit<LogRow, 'id' | 'ts'>) => void,
  narrate: NarrateFn,
  narrateDurableBeat: NarrateDurableBeatFn,
  handleSceneAdvance: UseSceneActionsResult['handleSceneAdvance'],
  playOutcomeLine: UseSceneStateResult['playOutcomeLine'],
  refreshGrounding: UseSceneStateResult['refreshGrounding'],
  sceneHeadRef: RefObject<HTMLDivElement | null>,
  composerRailAnchorRef: RefObject<HTMLDivElement | null>,
  dmPanelAnchorRef: RefObject<HTMLElement | null>,
  localTurnActionRef: MutableRefObject<boolean>,
): UseCombatActionsResult {
  const { toast } = useToast();
  const {
    combatId,
    combatState,
    setCombatId,
    setCombatState,
    setCombatBusy,
    setRefusedReason,
    setOutcomeChooserOpen,
    combatBusyRef,
    stateSeqRef,
    monsterDrivingRef,
  } = combat;

  // ── combat ──────────────────────────────────────────────────────────────────
  /**
   * ADV-6: Begin an encounter from the current scene's authored encounter block.
   * Now also initialises combatState from the response's data.state (CUI-11).
   */
  const beginEncounter = useCallback(async () => {
    if (!session || !username || combatBusyRef.current) return;
    combatBusyRef.current = true;
    // Tora MINOR-2: increment seq at mutation START so any in-flight poll is discarded.
    stateSeqRef.current += 1;
    setCombatBusy(true);
    setRefusedReason(null);
    try {
      const result = await combatFromScene({ session_id: session.session_id });
      const newId = result.combat_id;
      setCombatId(newId);
      // Initialise combatState from the engine response if it carries structured state;
      // else fetch it immediately. (Proxy passes through data.state once engine is updated.)
      if ('state' in result && result.state) {
        stateSeqRef.current += 1;
        setCombatState(result.state as CombatState);
      } else {
        // Fallback: explicit fetch for the structured state.
        const cs = await getCombatState(newId).catch(() => null);
        if (cs) {
          stateSeqRef.current += 1;
          setCombatState(cs);
        }
      }
      const initRes = await rollInitiative({ username, combat_id: newId }).catch(() => null);
      // Use the state from the initiative response if the engine emits it;
      // avoids a separate getCombatState round-trip (M2).
      const csAfterInit = initRes?.state ?? (await getCombatState(newId).catch(() => null));
      if (csAfterInit) {
        stateSeqRef.current += 1;
        setCombatState(csAfterInit);
      }
      const monsterNames = result.monsters.map((m) => m.name).join(', ') || 'enemies';
      appendLog({
        who: 'Suzu',
        kind: 'system',
        text: `Combat begins — ${monsterNames} close in. Roll initiative.`,
      });
      if (DURABLE_GENERATION_ENABLED) {
        void narrateDurableBeat(
          'We are under attack!',
          `Combat starts. ${monsterNames} enter the scene. Set the scene.`,
          'act',
          { beat: 'combat_start' },
        );
      } else {
        void narrate(
          'We are under attack!',
          `Combat starts. ${monsterNames} enter the scene. Set the scene.`,
          'act',
        ); // byte-unchanged legacy path
      }
    } catch (err) {
      // combat_from_scene's 400/409 refusals (NekoNova-DnDEngine
      // routes/combat.py) set no data.reason, only a ready-to-show `message`
      // ("No encounter available for the current scene.", "A combat is already
      // active for this session.", …).
      //
      // CORRECTION (2026-08-06, Kage-CR #3): this comment used to say "the
      // 4xx-business branch below is what actually surfaces it". It doesn't —
      // `api/routes/dnd_combat.py::_handle_dnd_error` renames `message` to
      // `error` and tier-2 probes `body.message`, so every one of those
      // refusals currently shows the bare fallback. Real fix is
      // NEKONOVA-PROXY-DROPS-MESSAGE (filed); not patched over with curated
      // copy here because the engine's text is already the right words.
      toast({
        tone: 'error',
        message: engineErrorMessage(err, {
          fallback: 'Could not start combat.',
          // Kage-CR #4: reuse, don't re-type. A second literal of this string
          // in a batch whose whole point is one home for reason copy would
          // drift the moment either is reworded.
          reasonMap: { msm_disabled: COMBAT_REFUSAL_REASON_MAP.msm_disabled },
        }),
      });
    } finally {
      combatBusyRef.current = false;
      setCombatBusy(false);
    }
  }, [
    session,
    username,
    toast,
    appendLog,
    narrate,
    narrateDurableBeat,
    combatBusyRef,
    stateSeqRef,
    setCombatBusy,
    setRefusedReason,
    setCombatId,
    setCombatState,
  ]);

  const onCombatAction = useCallback(
    async (action: CombatAction, payload?: string) => {
      if (!session || !username || !combatId || combatBusyRef.current) return;
      combatBusyRef.current = true;
      // Tora MINOR-2: increment seq at mutation START so any in-flight poll is discarded.
      stateSeqRef.current += 1;
      setCombatBusy(true);
      setRefusedReason(null);

      try {
        let message = '';
        let playerLine = '';
        let newState: CombatState | null | undefined;
        let sceneAdvance: { fromScene: string; toScene: string; outcome?: string } | null = null;
        // T1 (Kage-CR ruling 2026-08-18): hoisted OUT of `sceneAdvance` —
        // outcome_line resolves independently of scene_advance (see
        // `playOutcomeLine`'s doc comment), so it's captured on every
        // branch's own `res`, not folded into the scene-advance-only shape.
        // Harmless on the branches whose routes don't emit it today (dodge/
        // dash/attack/endturn — only death-save and /combat/{id}/end do).
        let outcomeLine: string | null | undefined;

        if (action === 'attack' && payload) {
          // payload is the participant_id (from the target menu item's id).
          // We send target_id as the preferred path; target (name) as fallback.
          const target = combatState?.participants.find((p) => p.participant_id === payload);
          const targetName = target?.name ?? payload;
          let res;
          try {
            res = await combatAttack({
              username,
              combat_id: combatId,
              target: targetName,
              target_id: payload,
            });
          } catch (err) {
            // F1/CAST-FAIL-SILENT: engineErrorMessage always returns a
            // non-empty string (curated reason, else the engine's own 4xx
            // message, else the fallback) — a bare "no data.reason" refusal
            // (e.g. a 404 "Combat or session not found." with no reason
            // code) used to fall through to `setRefusedReason(null)` here,
            // silently clearing the banner with nothing shown at all.
            setRefusedReason(
              engineErrorMessage(err, {
                // NOT "did not land" — that is the language of a MISSED attack
                // roll and was read as one. NOT "try again" either: the most
                // common refusal here (a spent action) cannot succeed until the
                // turn ends. This fires only for network/abort or a refusal
                // carrying no reason code at all.
                fallback: "That combat action didn't go through.",
                reasonMap: COMBAT_REFUSAL_REASON_MAP,
              }),
            );
            const body = (err as { body?: unknown } | null)?.body;
            const data = (body as { data?: { state?: CombatState } } | null)?.data;
            if (data?.state) {
              stateSeqRef.current += 1;
              setCombatState(data.state);
            }
            return;
          }
          newState = res.state ?? null;
          outcomeLine = res.outcome_line;
          if (res.scene_advance) {
            sceneAdvance = {
              fromScene: res.scene_advance.from_scene,
              toScene: res.scene_advance.to_scene,
              outcome: res.scene_advance.outcome,
            };
          }
          // Surface what happened from last_action.
          const la = newState?.last_action;
          const outcomeText = la
            ? ` (${la.outcome}${la.damage_dealt ? `, ${la.damage_dealt} dmg` : ''})`
            : '';
          message = res.message ?? `You attack ${targetName}.${outcomeText}`;
          playerLine = `I attack ${targetName}.`;
        } else if (action === 'dodge') {
          const res = await combatDodge({ username, combat_id: combatId });
          newState = res.state ?? null;
          outcomeLine = res.outcome_line;
          message = res.message ?? 'You take the Dodge action.';
          playerLine = 'I dodge.';
        } else if (action === 'dash') {
          const res = await combatDash({ username, combat_id: combatId });
          newState = res.state ?? null;
          outcomeLine = res.outcome_line;
          message = res.message ?? 'You take the Dash action.';
          playerLine = 'I dash.';
        } else if (action === 'deathsave') {
          // Combat-UX Fixes 2026-07-27, Fix B: solo self-resolve — omit
          // target/target_id, cmd_deathsave resolves the caller's own downed
          // character first.
          const res = await combatDeathSave({ username, combat_id: combatId });
          newState = res.state ?? null;
          outcomeLine = res.outcome_line;
          // TAV-DEATHSAVE-SCENE-ADVANCE (2026-08-18): a death save can
          // trigger the engine's anti-TPK rescue (`maybe_trigger_anti_tpk_
          // rescue` -> `finalize_combat`), which — exactly like the attack
          // and endturn branches above/below — may carry a `scene_advance`.
          // This branch used to drop it on the floor entirely: no scene-shift
          // log line, no grounding refresh, no transition narration — just
          // dead air until the next scene's narration appeared with no
          // lead-in. Structurally parallel to its two siblings now.
          if (res.scene_advance) {
            sceneAdvance = {
              fromScene: res.scene_advance.from_scene,
              toScene: res.scene_advance.to_scene,
              outcome: res.scene_advance.outcome,
            };
          }
          message = res.message ?? 'You roll a death save.';
          playerLine = 'I roll a death save.';
        } else if (action === 'endturn') {
          const res = await combatEndTurn({ username, combat_id: combatId });
          newState = res.state ?? null;
          outcomeLine = res.outcome_line;
          if (res.scene_advance) {
            sceneAdvance = {
              fromScene: res.scene_advance.from_scene,
              toScene: res.scene_advance.to_scene,
              outcome: res.scene_advance.outcome,
            };
          }
          message = res.message ?? 'You end your turn.';
          playerLine = 'I end my turn.';
        }

        if (newState) {
          stateSeqRef.current += 1;
          setCombatState(newState);
        }

        appendLog({ who: username, kind: 'system', text: message });
        // DDX-20 Pass 3 §3.3 — flag-OFF this `await` serializes end-turn
        // narration ahead of the scene-advance call just below (preserved
        // verbatim). Flag-ON, `narrateDurableBeat` returns after the job is
        // CREATED, not after narration completes, so it is fired-and-forgot
        // (`void`, no `await`) here — the accepted trade-off documented in
        // Pass-3 §3.3: beat 2 (scene-advance) may 409 subscribe-and-drop
        // against this beat's still-streaming narration; the scene still
        // advances (its durable `scene_advance` event is independent). Do
        // NOT try to serialize these — that re-couples the beats for a
        // cosmetic gain the single-slot model already bounds.
        if (DURABLE_GENERATION_ENABLED) {
          void narrateDurableBeat(playerLine, message, 'act', { beat: 'end_turn' });
        } else {
          await narrate(playerLine, message, 'act'); // byte-unchanged legacy path
        }

        // Monsters' turns (after the player ends theirs) are driven uniformly by
        // the auto monster-turn effect below — it picks up whenever combatState
        // shows a non-PC active turn, including at combat start when monsters win
        // initiative.

        // ADV-8 auto-advance: scene_advance != null means combat resolved + scene moved.
        if (sceneAdvance) {
          await handleSceneAdvance(
            sceneAdvance.fromScene,
            sceneAdvance.toScene,
            sceneAdvance.outcome,
            outcomeLine,
          );
        } else {
          // T1 (Kage-CR ruling 2026-08-18): an outcome_line can resolve with
          // NO scene_advance at all (flee/victory on everfree_flight, whose
          // advance_to is null for both) — play it directly rather than
          // gating it behind a scene shift that never happens.
          playOutcomeLine(outcomeLine);
        }

        // If combat ended, refresh grounding for the "Move on" affordance.
        if (newState?.state === 'ended') {
          void refreshGrounding();
        }
      } catch (err) {
        // F1/CAST-FAIL-SILENT: same chokepoint as the attack sub-branch
        // above — always surfaces SOMETHING (curated/engine-message/
        // fallback), so a dodge/dash/endturn refusal with no reason code no
        // longer falls silently through the old `if (reason) … else toast`
        // split with nothing shown for the in-between case.
        setRefusedReason(
          engineErrorMessage(err, {
            // NOT "did not land" — that is the language of a MISSED attack
            // roll and was read as one. NOT "try again" either: the most
            // common refusal here (a spent action) cannot succeed until the
            // turn ends. This fires only for network/abort or a refusal
            // carrying no reason code at all.
            fallback: "That combat action didn't go through.",
            reasonMap: COMBAT_REFUSAL_REASON_MAP,
          }),
        );
        const body = (err as { body?: unknown } | null)?.body;
        const data = (body as { data?: { state?: CombatState } } | null)?.data;
        if (data?.state) {
          stateSeqRef.current += 1;
          setCombatState(data.state);
        }
      } finally {
        combatBusyRef.current = false;
        setCombatBusy(false);
      }
    },
    [
      session,
      username,
      combatId,
      combatState,
      appendLog,
      narrate,
      narrateDurableBeat,
      handleSceneAdvance,
      refreshGrounding,
      playOutcomeLine,
      combatBusyRef,
      stateSeqRef,
      setCombatBusy,
      setRefusedReason,
      setCombatState,
    ],
  );

  /**
   * B3-1: Explicit "End combat" — posts /combat/{id}/end with a DM-chosen outcome.
   * Previously hardcoded 'unresolved'; now driven by the outcome chooser.
   */
  const onEndCombat = useCallback(
    async (outcome: EndCombatOutcome = 'unresolved') => {
      if (!combatId || !username || combatBusyRef.current) return;
      combatBusyRef.current = true;
      // Tora MINOR-2: increment seq at mutation START so any in-flight poll is discarded.
      stateSeqRef.current += 1;
      setCombatBusy(true);
      // Tora MINOR-1: do NOT close the chooser here — only close on success so the
      // user can retry on engine error without re-opening the panel.
      try {
        const result = await endCombat(combatId, { username, outcome });
        if (result.state) {
          stateSeqRef.current += 1;
          setCombatState(result.state);
        }
        const outcomeLabel = result.outcome
          ? result.outcome.charAt(0).toUpperCase() + result.outcome.slice(1)
          : 'Unresolved';
        appendLog({
          who: 'Suzu',
          kind: 'system',
          text: `Combat ended. ${outcomeLabel}.`,
        });
        // Tora MINOR-1: close on SUCCESS only.
        setOutcomeChooserOpen(false);
        if (result.scene_advance) {
          await handleSceneAdvance(
            result.scene_advance.from_scene,
            result.scene_advance.to_scene,
            result.scene_advance.outcome,
            result.outcome_line,
          );
        } else {
          // T1 (Kage-CR ruling 2026-08-18): outcome_line can resolve without a
          // scene_advance here too — see the identical hoist in onCombatAction.
          playOutcomeLine(result.outcome_line);
          void refreshGrounding();
        }
      } catch (err) {
        const body = (err as { body?: unknown } | null)?.body;
        const data = (body as { data?: { reason?: string } } | null)?.data;
        const reason = data?.reason;
        if (reason === 'victory_refused') {
          toast({ tone: 'error', message: "Can't claim victory — no enemies are down yet." });
        } else {
          toast({ tone: 'error', message: 'Could not end combat.' });
        }
        // Tora MINOR-1: chooser stays open on error so the user can retry.
      } finally {
        combatBusyRef.current = false;
        setCombatBusy(false);
      }
    },
    [
      combatId,
      username,
      appendLog,
      handleSceneAdvance,
      refreshGrounding,
      playOutcomeLine,
      toast,
      combatBusyRef,
      stateSeqRef,
      setCombatBusy,
      setCombatState,
      setOutcomeChooserOpen,
    ],
  );

  // Auto-drive monster turns. Whenever combat is active and the current turn
  // belongs to a living NPC, run that monster's turn — looping through all
  // consecutive NPC turns until it's a PC's turn or combat ends. Without this,
  // a combat where monsters win initiative is stuck at the start (the player is
  // never reached) and monster turns between rounds never advance.
  //
  // S5.3: skip the auto-driver entirely when dm_mode === 'human' — the DM
  // drives monster turns manually via the DmNarrationPanel (npc-action route).
  useEffect(() => {
    if (!combatState || combatState.state !== 'active' || !combatId || !username) return;
    // Human DM: monster turns are driven by the DmNarrationPanel, not auto.
    // S5.5: ai_assist_level='off' or 'assist' also suppresses auto monster drive.
    // For 'off': no AI; for 'assist': no auto-fire (manual DM invocation only).
    const autoAiLevel = session?.ai_assist_level;
    // DDX-25: a paused/ended session freezes the whole table — the DM-side
    // monster auto-driver must halt too, not just player actions, or monsters
    // keep acting until the next PC turn while the banner reads "paused".
    if (session?.dm_mode === 'human' || autoAiLevel === 'off' || autoAiLevel === 'assist' || isSessionLocked(session)) return;
    // Only monsterDrivingRef guards here — NOT combatBusyRef. A player's end-turn
    // completes with combatBusyRef still set while it hands off to a monster's
    // turn; gating on it would stall the hand-off. The active.is_pc check below
    // already prevents this from firing during the player's own turn.
    if (monsterDrivingRef.current) return;
    const active = combatState.participants.find(
      (p) => p.participant_id === combatState.active_participant_id,
    );
    if (!active || active.is_pc || !active.is_alive) return;

    monsterDrivingRef.current = true;
    let cancelled = false;
    (async () => {
      try {
        // Hard cap defends against an engine that fails to advance the turn.
        for (let i = 0; i < 20 && !cancelled; i += 1) {
          const mres = await Promise.resolve(
            monsterTurn({ username, combat_id: combatId }),
          ).catch(() => null);
          if (!mres) break;
          const mla = mres.state?.last_action;
          const mLog =
            mres.message ??
            (mla
              ? `${mla.actor_id}: ${mla.outcome}${mla.damage_dealt ? `, ${mla.damage_dealt} dmg` : ''}`
              : null);
          if (mLog) appendLog({ who: 'Suzu', kind: 'system', text: mLog });
          if (mres.state) {
            stateSeqRef.current += 1;
            setCombatState(mres.state);
          }
          if (mres.scene_advance) {
            await handleSceneAdvance(
              mres.scene_advance.from_scene,
              mres.scene_advance.to_scene,
              mres.scene_advance.outcome,
              mres.outcome_line,
            );
            break;
          }
          // T1 (Kage-CR ruling 2026-08-18): outcome_line can resolve without
          // a scene_advance — same hoist as onCombatAction/onEndCombat.
          // FORWARD-CONTRACT NOTE: `/monster-turn` does not emit outcome_line
          // on the engine today (only death-save + /combat/{id}/end do) —
          // this is inert-but-harmless until/unless the engine adds it here.
          playOutcomeLine(mres.outcome_line);
          const st = mres.state;
          if (!st || st.state !== 'active') break;
          const next = st.participants.find((p) => p.participant_id === st.active_participant_id);
          if (!next || next.is_pc || !next.is_alive) break; // reached the player / nobody to drive
        }
      } finally {
        monsterDrivingRef.current = false;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    combatState,
    combatId,
    username,
    session,
    appendLog,
    handleSceneAdvance,
    playOutcomeLine,
    monsterDrivingRef,
    stateSeqRef,
    setCombatState,
  ]);

  // Tora MAJOR-2: refocus the newly-enabled rail's container when a combat
  // action flips the active turn and disabling the just-clicked button
  // stranded focus on <body>. Reacts to combatState.active_participant_id
  // changing rather than hooking into onCombatAction/MonsterRow.fireAction
  // directly — both mutation paths already funnel into setCombatState (via
  // onStateUpdate / the response's own newState), so one generic effect here
  // covers a player Attack/Dodge/Dash/End-turn AND a DM per-monster
  // Attack/Skip/Move without touching either handler's control flow (kept
  // intentionally narrow per the review guardrail on this item). Mirrors
  // refocusSceneHeadIfStranded's rAF-after-commit stranding check, falling
  // back to sceneHeadRef when neither rail applies to this viewer.
  //
  // Local, private to this hook (not exported): prevActiveParticipantIdRef.
  // Only this effect reads or writes it.
  const prevActiveParticipantIdRef = useRef<string | null>(null);
  useEffect(() => {
    const active = combatId && combatState?.state !== 'ended' ? combatState : null;
    const current = active?.active_participant_id ?? null;
    const prev = prevActiveParticipantIdRef.current;
    prevActiveParticipantIdRef.current = current;

    // Consume the provenance flag on every pass (even early-return ones) so a
    // local click that didn't end up changing the active participant can't
    // leak forward and get misattributed to a later, unrelated turn change.
    const causedByLocalClick = localTurnActionRef.current;
    localTurnActionRef.current = false;

    if (prev == null || current == null || prev === current) return;
    // Provenance gate (Iro CRITICAL-1): only proceed when THIS client's own
    // disabling click caused this transition — never for a transition that
    // arrived purely via the poll (another client's action).
    if (!causedByLocalClick) return;

    const isDmSeat = !!(
      session?.dm_username &&
      username &&
      session.dm_username.toLowerCase() === username.toLowerCase() &&
      session?.dm_mode === 'human'
    );
    const newActiveParticipant =
      active?.participants.find((p) => p.participant_id === current) ?? null;
    // Ownership gate (Iro CRITICAL-1): reuses the `activeIsMine` pattern
    // (this hook's sibling, `useCombatState`) — the composer/cast rail is
    // only refocused when the newly active participant is THIS viewer's OWN
    // bound PC, never another player's rail for their turn. This also
    // subsumes the old dmPlayingOwnPc/hasComposerRail check: a DM with a
    // bound PC gets this branch exactly when it becomes their own PC's turn.
    const newActiveIsMine =
      !!newActiveParticipant?.is_pc &&
      myCharacterIdStr != null &&
      newActiveParticipant.entity_id === myCharacterIdStr;

    requestAnimationFrame(() => {
      if (document.activeElement !== document.body) return;
      if (newActiveIsMine) {
        composerRailAnchorRef.current?.focus({ preventScroll: true });
      } else if (!newActiveParticipant?.is_pc && isDmSeat) {
        dmPanelAnchorRef.current?.focus({ preventScroll: true });
      } else {
        sceneHeadRef.current?.focus({ preventScroll: true });
      }
    });
    // sceneHeadRef comes from useSceneState's destructure (TAV-PLAY-SHELL
    // step 5 hook 6) -- stable across renders, listed because the linter can no
    // longer prove that from a local useRef call.
  }, [
    combatState,
    combatId,
    session,
    username,
    myCharacterIdStr,
    sceneHeadRef,
    composerRailAnchorRef,
    dmPanelAnchorRef,
    localTurnActionRef,
    prevActiveParticipantIdRef,
  ]);

  return { beginEncounter, onCombatAction, onEndCombat };
}
