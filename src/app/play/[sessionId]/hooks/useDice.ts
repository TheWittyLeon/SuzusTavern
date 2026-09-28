'use client';

/**
 * TAV-PLAY-SHELL step 5, hook 8 of ~9 (decomposition plan §2.2, amended by
 * Amendment A §A.2 row 8) — `useDice`. Owns plan §1.6: `quickChecks`,
 * `advantage`, `rollBusy` (+ its synchronous double-submit latch ref), and
 * `onRoll`.
 *
 * Composed AFTER `useNarration` (row 7) and BEFORE `useSceneActions` (row
 * 9) — this is Amendment A §A.3 edge R5's resolution ("reorder only …
 * `advantage`'s only non-JSX reader is `onAttemptCheck`") and edge R7's
 * ("`useDice.onRoll` → `useNarration`: forward under the amended order").
 * `useSceneActions` receives `advantage` from THIS hook's return as a
 * plain parameter, same call-site shape as before — only where the value
 * originates changed.
 *
 * `session`/`narrate`/`narrateDurableBeat`/`talking`/`combatBusy` are
 * plain parameters, not bundles — `onRoll` reads exactly one field each
 * off narration (`narrate`, `narrateDurableBeat`, `talking`) and combat's
 * state (`combatBusy`), the same "one field, plain param" reading
 * `useCombatActions.ts`'s own header already establishes for `appendLog`
 * (one field off `transcript`) versus `combat: UseCombatStateResult`
 * (many fields, bundled). `username` is self-derived via `useAuth()` below
 * — matches `useSceneActions`'/`useSceneState`'s/`useSafety`'s established
 * choice, not `useCombatActions`' deviation (that deviation was justified
 * by Amendment A §A.6 naming it explicitly for THAT hook, not a general
 * rule). `toast` is likewise self-derived via `useToast()`, same reason.
 *
 * Deliberately does NOT own the unified durable events poll (still inline
 * in page.tsx, `useSessionEvents` territory, not yet extracted — composes
 * LAST per Amendment A row 11 and "the poll never imports a sibling
 * hook"). That poll's flag-OFF branch renders `dice_roll`/`x_card` rows
 * and is what a roll's own result lands through (`onRoll` never appends a
 * row locally).
 *
 * Kage-CR A6 IMPORTANT-1 (2026-09-28): this hook used to also own
 * `diceRollPollIntervalRef` — the interval handle for the still-inline
 * poll's `setInterval`/`clearInterval`. That was the exact inverse of
 * Amendment A §A.3 edge R4's principle ("`useSessionEvents` owns the
 * interval, not the ledger"): grep confirmed the ref had no reader or
 * writer anywhere in this file, only in the poll's own closure — a
 * "declared field with no reader" one hop removed (the field IS read, just
 * never by the hook that declared it). Resolved outright rather than
 * deferred: `useDice` no longer declares or returns it, and the poll now
 * owns a plain effect-local interval id (see page.tsx's poll effect / this
 * repo's `useSessionEvents.ts` once A4 lands).
 *
 * Deliberately does NOT own the sheet-fetch/quick-checks-BUILDING logic
 * (still inside page.tsx's mount effect, its own `debt:` marker) — that
 * effect calls THIS hook's `setQuickChecks` exactly as it already calls
 * `setGrounding` (owned by `useSceneState`) and `setMySheet` (owned by
 * `useMyCharacter`). Only the STATE moved; the fetch stays where the rest
 * of the atomic mount sequence lives.
 *
 * No new ref-mirror: `rollBusyRef` (a synchronous double-submit latch,
 * same shape as `sceneAdvanceBusyRef`/`checkBusyRef`) is an ordinary
 * hook-owned ref, not a mirror bridging a temporal dead zone — zero
 * `useLayoutEffect` remain in `hooks/` after A5, and this commit keeps it
 * at zero.
 */
import { useCallback, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { useAuth } from '@/lib/auth/AuthProvider';
import { useToast } from '@/components/Toast';
import { postRoll } from '@/lib/api/dnd';
import { DURABLE_GENERATION_ENABLED } from '@/lib/config';
import type { Advantage, QuickCheck, RollTrigger } from '@/components/DiceTray';
import type { Session } from '@/lib/api/types';
import { isSessionLocked } from '../format';
import type { NarrateDurableBeatFn, NarrateFn } from './useNarration';

export interface UseDiceResult {
  quickChecks: QuickCheck[] | null;
  setQuickChecks: Dispatch<SetStateAction<QuickCheck[] | null>>;
  advantage: Advantage;
  setAdvantage: Dispatch<SetStateAction<Advantage>>;
  rollBusy: boolean;
  onRoll: (trigger: RollTrigger) => Promise<void>;
}

export function useDice(
  session: Session | null,
  narrate: NarrateFn,
  narrateDurableBeat: NarrateDurableBeatFn,
  talking: boolean,
  combatBusy: boolean,
): UseDiceResult {
  const { user } = useAuth();
  const username = user?.username ?? null;
  const { toast } = useToast();

  // A2 — real quick-checks derived from the bound character's sheet.
  // null = not yet resolved; [] = DM-only (no character bound) or fetch
  // failed. Built by page.tsx's still-inline mount effect (see this file's
  // header) via `setQuickChecks` below.
  const [quickChecks, setQuickChecks] = useState<QuickCheck[] | null>(null);
  const [advantage, setAdvantage] = useState<Advantage>('none');

  // Synchronous double-submit latch for roll buttons (mirrors checkBusyRef /
  // sceneAdvanceBusyRef) — a roll is a real server write (persists a
  // `dice_roll` event), so a same-tick double-click must not fire it twice.
  const rollBusyRef = useRef(false);
  const [rollBusy, setRollBusy] = useState(false);

  // ── dice ────────────────────────────────────────────────────────────────────
  // DDX-08 / T3: rolls are server-authoritative (POST /roll persists a
  // `dice_roll` session event, DDX-07/DDX-08). This handler only forwards the
  // trigger — it does NOT append a row to the log or compute an outcome. The
  // result is rendered by the dice-roll events poll (page.tsx, still
  // inline), exactly like on every other client watching this session, so
  // the roller sees their own roll the same way everyone else does and a
  // roll from client A always shows up on client B without a reload.
  const onRoll = useCallback(
    async (trigger: RollTrigger) => {
      // rollBusyRef: synchronous double-submit latch (mirrors checkBusyRef /
      // sceneAdvanceBusyRef) — a roll is a real server write, so a same-tick
      // double-click must not fire it twice.
      if (!session || !username || rollBusyRef.current || isSessionLocked(session)) return;
      rollBusyRef.current = true;
      setRollBusy(true);
      try {
        const advantageWire: 'straight' | 'advantage' | 'disadvantage' =
          advantage === 'adv' ? 'advantage' : advantage === 'dis' ? 'disadvantage' : 'straight';

        if (trigger.kind === 'check') {
          const result = await postRoll(session.session_id, {
            username,
            kind: 'skill',
            skill: trigger.skill,
            advantage: advantageWire,
          });
          // S5.5: skip auto-narration when AI is off or assist-only.
          const sessionAiLevel = session.ai_assist_level;
          // DDX-25 R2 (D2): a paused/ended session must not auto-fire
          // narration either — the DiceTray `disabled` prop already blocks
          // the click that reaches here (see its own sessionLocked gate
          // further down), but this is checked again here too, mirroring the
          // double-gate convention this file already uses for `talking` in
          // onMoveOn/onAttemptCheck.
          if (
            !talking &&
            !combatBusy &&
            !isSessionLocked(session) &&
            sessionAiLevel !== 'off' &&
            sessionAiLevel !== 'assist'
          ) {
            if (DURABLE_GENERATION_ENABLED) {
              void narrateDurableBeat(
                `I roll ${trigger.label}.`,
                `${result.description} Narrate the outcome.`,
                'act',
                { beat: 'roll' },
              );
            } else {
              void narrate(
                `I roll ${trigger.label}.`,
                `${result.description} Narrate the outcome.`,
                'act',
              ); // byte-unchanged legacy path
            }
          }
        } else if (trigger.sides === 20) {
          // Plain d20 button: a bare (unmodified) d20 — kind='raw' with no
          // notation still honours the advantage/disadvantage pill
          // server-side, it just has no character/modifier attached.
          await postRoll(session.session_id, {
            username,
            kind: 'raw',
            advantage: advantageWire,
          });
        } else {
          // Any other plain die (d4/d6/d8/d10/d12): notation always wins
          // over `kind` server-side and rolls straight — advantage only
          // applies to the d20 case above (mirrors the pre-DDX-08 behaviour).
          await postRoll(session.session_id, {
            username,
            notation: `1d${trigger.sides}`,
          });
        }
      } catch {
        toast({ tone: 'error', message: 'Could not roll — try again.' });
      } finally {
        rollBusyRef.current = false;
        setRollBusy(false);
      }
    },
    [session, username, advantage, talking, combatBusy, narrate, narrateDurableBeat, toast],
  );

  return {
    quickChecks,
    setQuickChecks,
    advantage,
    setAdvantage,
    rollBusy,
    onRoll,
  };
}
