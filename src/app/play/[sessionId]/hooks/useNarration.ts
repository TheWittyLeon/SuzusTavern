'use client';

/**
 * TAV-PLAY-SHELL step 5, hook 7 of ~9 (decomposition plan §2.2, amended by
 * Amendment A §A.2 row 7) — `useNarration`. Owns plan §1.3: the live
 * narration/composer-turn surface — `narrate`, `narrateDurable`,
 * `narrateDurableBeat`, `subscribeToJob`, `revealText`, `onRetryFailedTurn`,
 * `onSendDmNarration`, `talking`/`thinking`/`activeJob`/`jobFailed` and every
 * ref that exists only to serve them (`subscribedJobIdRef`, `turnKeyRef`,
 * `lastDurableTurnRef`, `pollFailureGraceRef`, `durableRetryRowRef`,
 * `revealRef`, `narrationAbort`), plus `resumeThinking` (the one pure
 * derivation off this hook's own `talking`/`activeJob`).
 *
 * Composed at row 7 — ABOVE `useDice` (row 8, A6) and
 * `useSceneActions` (row 9, A5's other half) but BELOW `useSceneState` (row
 * 6, A5's first half). This is the resolution to Amendment A §A.2/§A.3 edge
 * R2: `narrate()` reads `refreshGrounding`/`refocusSceneHeadIfStranded`/
 * `grounding`/`applyOfferedCheckSignal`/`playArrivalLine`/
 * `playRescueTransitionLine` — all `useSceneState`'s — so this hook takes
 * the WHOLE `useSceneState` return as one bundle (`sceneState`), the same
 * shape `useCombatActions.ts`'s own header already named as the plan for
 * this hook ("mirrors how useNarration (A5) is planned to take 'sceneState'
 * as one named input rather than exploding it"). `useSceneState` itself
 * never reads anything of this hook's — the edge is one-directional, exactly
 * as §A.3 R2 describes.
 *
 * `transcript: UseTranscriptResult` is bundled for the same reason, scaled
 * up: nine separate fields (`appendLog`, `upsertStreamNarration`,
 * `clearStreamNarration`, `finalizeStreamNarration`, `logRef`,
 * `streamRowIdRef`, `idRef`, `setLog`, `pendingByKeyRef`) would make the
 * call site error-prone to read in the right order — `useCombatActions.ts`
 * stayed with a single plain `appendLog` parameter because it only needed
 * that one field; this hook needs nine, which is exactly the "many fields,
 * one hook" case §A.6 already used to justify `combat: UseCombatStateResult`
 * on `useCombatActions`.
 *
 * `msg`/`setMsg`/`dmNarrationPending`/`setDmNarrationPending`/
 * `setDmNarrationError` are plain parameters, not bundled — they are
 * Composer/DM-narration-panel state (plan §1.11/§1.12), not yet owned by any
 * hook, and only `onSendDmNarration` (one of eight functions this hook owns)
 * reads them. Bundling five fields for one consumer inside a nine-function
 * hook would obscure rather than clarify.
 *
 * `sessionId`/`session`/`username` are plain parameters — `session` mirrors
 * `useSceneState`'s own choice (state owned by `useSessionLifecycle`, not
 * re-derived); `username` is self-derived via `useAuth()` below instead
 * (matches `useScene`'s/`useSafety`'s established choice, not
 * `useCombatActions`' deviation — that deviation was justified by its own
 * header for a reason specific to that hook, not a general rule).
 *
 * Deliberately does NOT own: the mount-load effect (still in page.tsx) and
 * the unified durable events poll (`useSessionEvents`, Amendment A row 11,
 * A4) — both call `subscribeToJob` and write `talking`/`thinking`/
 * `activeJob`/`jobFailed`/`subscribedJobIdRef`/`turnKeyRef`/
 * `pollFailureGraceRef` through this hook's returned setters/refs,
 * unchanged in every respect except where those values now come from (the
 * mount effect still calls them directly; the poll takes them as plain
 * `handlers` fields, composed last so it never imports this hook). `onRoll`
 * (plan §1.6, `useDice` territory, A6) reads `talking`/`narrate`/
 * `narrateDurableBeat` the same way. `narrationAbort` is exported for
 * exactly one external reader: the poll's own SSE-tail grace-timeout
 * cleanup, now in `hooks/useSessionEvents.ts`.
 *
 * `narrationAbort`/`revealRef`'s unmount-cleanup effect moves here bodily —
 * it is now the FIRST effect this component tree registers (this hook
 * composes before the mount-load effect), where before extraction it was
 * the fifth. Proven inert in the A5 commit message: neither ref has a
 * reader outside this hook, and no other effect's own cleanup touches
 * either — reordering when its cleanup runs relative to unrelated effects'
 * cleanups is unobservable.
 *
 * Discharges the `debt:` marker A1b/A2/A3 carried forward (`page.tsx`, at
 * the old `useScene(...)` call site) — `confirmBeatRef` is deleted in this
 * same commit's third half (A5 step 3): `useSceneActions` (row 9) composes
 * BELOW this hook and takes `narrate`/`narrateDurableBeat` as plain,
 * already-declared parameters, so the ref that existed only to cross the
 * temporal dead zone between the old single `useScene` (composed above
 * narration) and narration itself no longer has a reason to exist.
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';
import { useAuth } from '@/lib/auth/AuthProvider';
import { useToast } from '@/components/Toast';
import { useReducedMotion } from '@/lib/useReducedMotion';
import { postSessionEvent } from '@/lib/api/dnd';
import { streamDmNarration, postDmTurn, subscribeDmJob } from '@/lib/stream';
import { mintTurnKey, saveTurnKey, clearTurnKey } from '@/lib/turnKey';
import { shouldClearAbortedStreamRow } from '@/lib/streamRowOwnership';
import { DURABLE_GENERATION_ENABLED } from '@/lib/config';
import type { ComposeMode } from '@/components/Composer';
import type { GroundingData, OfferedCheck, PendingGeneration, Session } from '@/lib/api/types';
import { nowStamp } from '../format';
import type { UseSceneStateResult } from './useSceneState';
import type { UseTranscriptResult } from './useTranscript';

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

export interface UseNarrationResult {
  talking: boolean;
  thinking: boolean;
  // Kage-CR A4 IMPORTANT-3 (2026-09-28): `setTalking`/`setThinking` used to
  // be exported raw so `useSessionEvents.ts`'s durable poll could flip them
  // at turn end (§4c turn_key lifecycle clear, §4d poll-failure-grace forced
  // cleanup) — two independent capabilities for what both call sites always
  // use as one sequence, and a swap between them was a provable no-op
  // (Miko-QA). Replaced by the one transition an external caller actually
  // needs; see the `onTurnSettled` definition above for the full
  // state-space enumeration.
  onTurnSettled: () => void;
  // Kage-CR A5 IMPORTANT-3 (routed to A6 commit 0): `activeJob` (the bare
  // value), `lastDurableTurnRef` and `revealText` were exported with zero
  // readers outside this file (grepped; the only other hits anywhere in
  // src/ are provenance comments saying these moved here, never a real
  // read) — the same "declared field with no reader" shape A2's
  // IMPORTANT-3 caught for `combatStateRef`/`pollIntervalRef`, closed by
  // A3 commit 0b the same way: drop from the interface/return, add each
  // back in the commit that adds its first reader. `setActiveJob` IS kept
  // — it has real external readers in the unified events poll
  // (`useSessionEvents`, Amendment A row 11, A4).
  setActiveJob: Dispatch<SetStateAction<PendingGeneration | null>>;
  jobFailed: boolean;
  setJobFailed: Dispatch<SetStateAction<boolean>>;
  subscribedJobIdRef: MutableRefObject<string | null>;
  turnKeyRef: MutableRefObject<string | null>;
  pollFailureGraceRef: MutableRefObject<{ turnKey: string; nullTicks: number } | null>;
  durableRetryRowRef: MutableRefObject<HTMLDivElement | null>;
  narrationAbort: MutableRefObject<AbortController | null>;
  resumeThinking: boolean;
  subscribeToJob: (
    jobId: string,
    ledgerKey: string,
    triggerSeq: number | undefined,
    origin: 'composer' | 'beat',
    precreateRow: boolean,
  ) => Promise<void>;
  narrate: NarrateFn;
  narrateDurable: (playerMessage: string, beatMode: ComposeMode) => Promise<void>;
  narrateDurableBeat: NarrateDurableBeatFn;
  onRetryFailedTurn: () => void;
  onSendDmNarration: () => Promise<void>;
}

export function useNarration(
  sessionId: string,
  session: Session | null,
  sceneState: UseSceneStateResult,
  transcript: UseTranscriptResult,
  msg: string,
  setMsg: Dispatch<SetStateAction<string>>,
  dmNarrationPending: boolean,
  setDmNarrationPending: Dispatch<SetStateAction<boolean>>,
  setDmNarrationError: Dispatch<SetStateAction<string | null>>,
): UseNarrationResult {
  const { user } = useAuth();
  const username = user?.username ?? null;
  const { toast } = useToast();
  // revealText's fake-typewriter is the one thing this hook animates --
  // self-derived here (not a parameter) for the same reason toast/username
  // are: the value belongs to whichever hook consumes it, matching
  // useSceneState's/useSafety's established choice.
  const reduced = useReducedMotion();

  const {
    grounding,
    checkWrapRef,
    transitionWrapRef,
    refreshGrounding,
    refocusSceneHeadIfStranded,
    applyOfferedCheckSignal,
    playArrivalLine,
    playRescueTransitionLine,
    setOfferedCheckSkill,
    setFreeformOfferedCheck,
  } = sceneState;
  const {
    appendLog,
    upsertStreamNarration,
    clearStreamNarration,
    finalizeStreamNarration,
    logRef,
    streamRowIdRef,
    idRef,
    setLog,
    pendingByKeyRef,
  } = transcript;

  const [talking, setTalking] = useState(false);
  const [thinking, setThinking] = useState(false);

  /**
   * Kage-CR A4 IMPORTANT-3 (2026-09-28) — `talking`/`thinking` only ever
   * reach THREE of their four possible combinations, enumerated against
   * every call site in this file (not assumed): `(true, true)` on turn
   * start, `(talking=true, thinking=false)` once the first chunk of a
   * response is visible ("stop the thinking dots, keep talking"), and
   * `(false, false)` once the turn settles. `(talking=false, thinking=true)`
   * (thinking with no talking) is never reachable, so the thirteen
   * `setThinking`/`setTalking` sites this file used to write out longhand
   * (eight two-line pairs plus five single-line sites) are really three
   * named transitions. Naming them
   * makes the unreachable fourth combination unrepresentable instead of
   * merely unobserved (Miko-QA's own mutation proof: swapping
   * `setThinking`/`setTalking` at a call site was a PROVABLE no-op given
   * today's code — exactly the smell this fixes).
   *
   * `onTurnSettled` is the only one of the three exported on
   * `UseNarrationResult`, replacing the bare `setThinking`+`setTalking`
   * pair `useSessionEvents.ts`'s poll used to receive as two independent
   * capabilities for what both its call sites (durable and flag-OFF) always
   * use as one sequence. `beginTurn`/`firstChunkArrived` stay internal —
   * nothing outside this file starts or narrates a turn.
   */
  const beginTurn = useCallback(() => {
    setTalking(true);
    setThinking(true);
  }, []);
  const firstChunkArrived = useCallback(() => {
    setThinking(false);
  }, []);
  const onTurnSettled = useCallback(() => {
    setThinking(false);
    setTalking(false);
  }, []);

  // DDX-20 Pass 2 — the in-flight job surfaced by the poll's
  // `pending_generation` block (Technical Design §2.2), promoted to real
  // state so the resume/busy affordance (§9) can render off it. Drives the
  // "Resuming Suzu's turn…" status ONLY when this client is not already
  // actively streaming its own beat (talking/thinking cover that case) —
  // see `resumeThinking` below.
  const [activeJob, setActiveJob] = useState<PendingGeneration | null>(null);
  // DDX-20 Pass 2 — guards against re-opening the SSE tail for a job this
  // client is already subscribed to (the poll re-observes the same
  // `pending_generation` block every ~4s while a beat is in flight; without
  // this guard each tick would open a fresh SSE connection). Cleared when
  // the tracked job resolves (subscribeToJob's own completion) or when a
  // later poll tick sees `pending_generation` go null.
  const subscribedJobIdRef = useRef<string | null>(null);
  // DDX-20 Pass 2 — the client-minted turn_key for THIS client's own
  // currently in-flight turn (§4c lifecycle: set on turn start, cleared once
  // the poll's reconciliation removes its ledger entry — i.e. the beat's
  // narration seq has been observed — or on failure/retry). null when no
  // turn owned by this tab is in flight.
  //
  // DDX-20 Pass 3 Finding 3 (Kage-CR SHOULD-FIX, carried not fixed) — this
  // is a SINGLE ref shared by both `narrateDurable` and `narrateDurableBeat`
  // — see the full rationale this comment used to carry in page.tsx, moved
  // here verbatim in spirit: a beat firing mid-composer-turn (or vice
  // versa) clobbers whichever turn_key lost the write race. Deferred, not
  // forced into this extraction's scope. `play.ddx20-pass3-synthetic-beats
  // .test.tsx` locks today's clobber behavior.
  const turnKeyRef = useRef<string | null>(null);
  // DDX-20 Pass 2 — the last composer-submitted (message, mode) this client
  // originated, kept so a retry-after-failed (§4d) can resubmit the SAME
  // content under a FRESH turn_key (mintTurnKey() is called fresh on every
  // narrateDurable() invocation — retry never reuses a turn_key).
  const lastDurableTurnRef = useRef<{ message: string; mode: ComposeMode } | null>(null);
  // DDX-20 Pass 2 — true when the most recent durable beat this client was
  // watching (its own, or one it subscribed to) ended in an SSE `error`
  // event, OR the poll-only failure detector (`useSessionEvents.ts`)
  // declared it dead. Drives the retry affordance (§4d / §9).
  const [jobFailed, setJobFailed] = useState(false);
  // DDX-20 Pass 2 (Miko-QA finding c) — poll-only failure-detection grace
  // counter for THIS client's own in-flight turn_key (see
  // POLL_FAILURE_GRACE_TICKS in page.tsx). Tracks the turn_key it's
  // counting against so a brand-new turn never inherits a stale count.
  const pollFailureGraceRef = useRef<{ turnKey: string; nullTicks: number } | null>(null);
  // DDX-20 §4d/§9 (Iro MAJOR-1) — same permanently-mounted tabIndex={-1}
  // refocus-anchor pattern as xCardBannerRef (page.tsx): onRetryFailedTurn
  // unmounts the Retry button, which would otherwise force-blur focus to
  // <body>. Refocusing this wrapper BEFORE that unmount keeps focus in the
  // document.
  const durableRetryRowRef = useRef<HTMLDivElement>(null);

  const revealRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const narrationAbort = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      if (revealRef.current) clearInterval(revealRef.current);
      narrationAbort.current?.abort();
    },
    [],
  );

  /**
   * TAV-NARRATION-DECOUPLE (2026-07-25): the client-side fake-typewriter for
   * the buffered/non-streamMode legacy SSE beat. Drives the same
   * `upsertStreamNarration` chat row the streamMode branch uses directly.
   * TAV-COMPOSING (Phase 1, 2026-07-26): starts the row EMPTY
   * (`upsertStreamNarration('')`) and grows it word-by-word, so `thinking`
   * clears once the first non-empty tick paints.
   */
  const revealText = useCallback(
    (full: string) => {
      if (revealRef.current) clearInterval(revealRef.current);
      // prefers-reduced-motion: skip the fake typewriter entirely, same as
      // every drawer transition (Play.module.css:967/1008, invariant A12) --
      // reveal the whole beat at once instead of animating it token by token.
      if (reduced) {
        upsertStreamNarration(full);
        if (full.trim() !== '') firstChunkArrived();
        return;
      }
      const tokens = full.split(/(\s+)/);
      let i = 0;
      upsertStreamNarration('');
      revealRef.current = setInterval(() => {
        i += 1;
        const shown = tokens.slice(0, i).join('');
        upsertStreamNarration(shown);
        if (shown.trim() !== '') firstChunkArrived();
        if (i >= tokens.length && revealRef.current) {
          clearInterval(revealRef.current);
          revealRef.current = null;
        }
      }, 26);
    },
    [reduced, upsertStreamNarration, firstChunkArrived],
  );

  /**
   * DDX-20 Pass 2 — subscribe to a durable job's SSE tail (Client Integration
   * Design §6 `subscribeDmJob`). Used from THREE call sites, uniformly:
   *   (1) narrateDurable's own just-created/deduped-resumed job (originating client).
   *   (2) the 409-busy pivot (§4a) — subscribing to ANOTHER client's in-flight job.
   *   (3) the poll's stateless resume/don't-re-POST discovery (§4b) — mount/reload.
   * In every case SSE is a non-authoritative live accelerator (§3.3): the
   * durable poll is what actually reconciles the finished beat into the
   * transcript via the ledger (rule 3) — this function only drives the live
   * `thinking`/`talking` UI + the chat log's live streaming row
   * (`upsertStreamNarration`) and keeps `pendingByKeyRef`'s `narrationRowId`
   * in sync so that reconciliation can find this row when the durable event
   * lands.
   *
   * `ledgerKey` is the turn_key when known (originating / mount-resume);
   * the 409-busy case does not learn the OTHER client's real turn_key, so
   * callers pass a synthetic per-job key there — rule 3 matches by
   * `triggerSeq`, not by the ledger map's key, so a synthetic key still
   * reconciles correctly.
   *
   * `origin` (DDX-20 Pass 3 Finding 1) — 'composer' for `narrateDurable`'s
   * two call sites and the poll's stateless resume-discovery call; 'beat'
   * for `narrateDurableBeat`'s two call sites. Drives whether an SSE-tail
   * `error` may surface the shared composer Retry banner.
   *
   * `precreateRow` (TAV-NARRATION-DECOUPLE Phase 2) — when true, pre-create
   * THIS turn's streaming anchor row and claim it in the ledger
   * synchronously, before any await, so the poll's reconciliation (rule 3)
   * always finds a `streaming` row to REPLACE instead of appending a fresh
   * one whole. `false` only for the poll's stateless resume-discovery
   * subscribe.
   */
  const subscribeToJob = useCallback(
    async (
      jobId: string,
      ledgerKey: string,
      triggerSeq: number | undefined,
      origin: 'composer' | 'beat',
      precreateRow: boolean,
    ) => {
      // DDX-20 Pass 3 Finding 2 (Kage-CR MAJOR-1 / Miko-QA) — de-dupe by
      // job_id BEFORE touching anything else. See the full rationale this
      // comment carried in page.tsx: a 409-busy-pivot can target a job THIS
      // SAME CLIENT already subscribed to under a DIFFERENT ledgerKey;
      // re-subscribing would orphan a second ledger entry for one job and
      // reset the shared narrating UI for a job already correctly driving
      // it. A genuinely different, not-yet-watched job_id falls through.
      for (const entry of pendingByKeyRef.current.values()) {
        if (entry.jobId === jobId && entry.awaitingNarration) {
          console.debug('subscribe_dedup_same_job', { job_id: jobId, ledger_key: ledgerKey, origin });
          return;
        }
      }

      subscribedJobIdRef.current = jobId;
      // Kage #3 — register INTENT to receive this turn's narration
      // SYNCHRONOUSLY, before any await. Closes the race where the durable
      // narration event could land on a poll tick BEFORE this function's
      // first SSE chunk arrives.
      pendingByKeyRef.current.set(ledgerKey, {
        ...pendingByKeyRef.current.get(ledgerKey),
        jobId,
        triggerSeq,
        awaitingNarration: true,
        origin,
      });

      narrationAbort.current?.abort();
      const ctrl = new AbortController();
      narrationAbort.current = ctrl;
      beginTurn();
      clearStreamNarration(true);

      let full = '';
      let sawError = false;
      // Kage #3 — true once the FIRST chunk observes that the poll's own
      // reconciliation already claimed (appended) this turn's narration
      // before we got here (reconcileEvents.ts rule 3 sub-case (c)). Once
      // true, every subsequent chunk is dropped for the chat log too — the
      // durable row the poll already appended is canonical, and (T1/TAV-S1)
      // mutating an already-visible, already-announced-once row's text on
      // every chunk would re-flood a screen reader.
      let pollClaimedNarration = false;
      // TAV-S1-ABORT-CLEAR: this tail's OWN streaming row id — only
      // meaningful when we, not the poll, own the live row.
      let ownStreamRowId: string | null = null;

      // TAV-NARRATION-DECOUPLE Phase 2 — pre-create THIS turn's streaming
      // anchor row and claim it in the ledger BEFORE the SSE tail even
      // starts, so the poll's reconcile (rule 3) always finds a `streaming`
      // row to REPLACE rather than appending a fresh one whole once no
      // chunk has arrived yet. Runs after `clearStreamNarration(true)`
      // above (drops any superseded beat's stale row first) and before the
      // `for await` below suspends.
      if (precreateRow) {
        upsertStreamNarration('');
        ownStreamRowId = streamRowIdRef.current;
        const precreateEntry = pendingByKeyRef.current.get(ledgerKey);
        if (precreateEntry && ownStreamRowId) {
          precreateEntry.narrationRowId = ownStreamRowId;
        }
        // §8 masked observability — correlation ids only, no prose/mechanics.
        console.debug('narration_anchor_precreated', {
          job_id: jobId,
          ledger_key: ledgerKey,
          origin,
        });
      }

      try {
        for await (const ev of subscribeDmJob(jobId, sessionId, { signal: ctrl.signal })) {
          if (ev.kind === 'chunk') {
            full = ev.text;
            // TAV-COMPOSING — clear `thinking` only once something is
            // actually visible: either the poll-claimed detection just
            // below (the row is already on-screen, non-hidden), or the
            // upsert below that carries real (non-empty) text.
            if (!pollClaimedNarration) {
              if (!streamRowIdRef.current) {
                // First chunk. If the ledger entry is already gone or
                // already carries a narrationRowId we didn't set
                // (streamRowIdRef is still null here, so it can't be ours)
                // — the poll's reconciliation got here first. Stop
                // touching the transcript for the rest of this tail.
                const preEntry = pendingByKeyRef.current.get(ledgerKey);
                if (!preEntry || preEntry.narrationRowId) {
                  pollClaimedNarration = true;
                  firstChunkArrived();
                }
              }
              // Tora CRITICAL-1 (resurrection race) — same gate as narrate():
              // a stale/superseded tail can still deliver a trailing chunk
              // after a successor has synchronously aborted `ctrl`.
              // `ctrl.signal.aborted` flips synchronously on `.abort()`
              // regardless of generator progress, so checking it here stops
              // a stale tail from re-minting/adopting a row a successor
              // already owns.
              if (!pollClaimedNarration && !ctrl.signal.aborted) {
                upsertStreamNarration(full);
                // TAV-S1-ABORT-CLEAR: snapshot the row id THIS tail owns.
                ownStreamRowId = streamRowIdRef.current;
                // Keep the ledger's narrationRowId in sync with the live
                // row so reconcileDurableEvents (rule 3) can find-and-
                // replace it once the durable seq-bearing event lands.
                const entry = pendingByKeyRef.current.get(ledgerKey);
                if (entry && streamRowIdRef.current) {
                  entry.narrationRowId = streamRowIdRef.current;
                }
                if (full.trim() !== '') firstChunkArrived();
              }
            }
          } else if (ev.kind === 'error') {
            sawError = true;
          }
        }
      } catch (e) {
        sawError = true;
        console.error('[dm-turn] subscribe failed client-side:', e);
      }

      if (ctrl.signal.aborted) {
        // TAV-S1-ABORT-CLEAR: see narrate()'s identical comment — only
        // clear if a successor hasn't already claimed/replaced this ref.
        if (shouldClearAbortedStreamRow(streamRowIdRef.current, ownStreamRowId)) {
          clearStreamNarration(true);
        }
        return;
      }
      onTurnSettled();
      if (subscribedJobIdRef.current === jobId) subscribedJobIdRef.current = null;

      if (sawError && !pollClaimedNarration) {
        // §4d failure detection (SSE tail yields error). Drop the orphaned
        // streaming row and its ledger entry — a `failed` job never writes
        // a durable narration event, so nothing will ever reconcile it.
        // Guarded on !pollClaimedNarration — Kage #3: if the poll's own
        // reconciliation already rendered this beat's durable narration
        // before we got here, a LATE SSE error is not a real failure.
        clearStreamNarration(true);
        pendingByKeyRef.current.delete(ledgerKey);

        if (origin === 'beat') {
          // DDX-20 Pass 3 Finding 1 (Miko-QA/Kage-CR MUST-FIX) — a
          // beat-originated job's SSE-tail error drops SILENTLY (§3.1
          // "beats have no retry affordance"). Masked per §10 — no
          // mechanics/prose, just the correlation id.
          console.debug('beat_narration_sse_error_dropped', { job_id: jobId, turn_key: ledgerKey });
        } else {
          setJobFailed(true);
          appendLog({
            who: 'Suzu',
            kind: 'system',
            text: 'Suzu stepped away for a moment. Try again.',
          });
        }
      }
    },
    [
      sessionId,
      clearStreamNarration,
      upsertStreamNarration,
      appendLog,
      pendingByKeyRef,
      streamRowIdRef,
      beginTurn,
      firstChunkArrived,
      onTurnSettled,
    ],
  );

  const narrate = useCallback(
    async (
      playerMessage: string,
      mechanics: string,
      beatMode: ComposeMode,
      opts?: { kind?: 'beat' | 'opening'; session?: Session; suppressIntent?: boolean },
    ) => {
      // FIX-1: use the override session when supplied (opening call),
      // otherwise fall back to the closure value (all subsequent
      // player/combat calls).
      const activeSession = opts?.session ?? session;
      if (!activeSession || !username) return;

      // S5.2: human-DM sessions do NOT route through the LLM pipeline at
      // all. S5.5: ai_assist_level='off' or 'assist' also suppresses
      // auto-fire narration.
      const aiLevel = activeSession.ai_assist_level;
      if (activeSession.dm_mode === 'human' || aiLevel === 'off' || aiLevel === 'assist') return;

      // Iro Ship 2 CRITICAL-1: capture BEFORE any await — a sceneAdvanced
      // signal below triggers refreshGrounding(), which can recompute
      // availableChecks/availableTransitions and unmount whichever button
      // the player was just on. Mirrors onMoveOn/onAttemptCheck's own
      // capture exactly.
      const hadFocusInCheckWrap = checkWrapRef.current?.contains(document.activeElement) ?? false;
      const hadFocusInTransitionWrap =
        transitionWrapRef.current?.contains(document.activeElement) ?? false;

      narrationAbort.current?.abort();
      const ctrl = new AbortController();
      narrationAbort.current = ctrl;
      beginTurn();
      // Drop any partial live-narration row left over from an aborted beat
      // so this beat starts a fresh bottom-of-chat row (never overwrites
      // the old).
      clearStreamNarration(true);
      // P1-PLAYFIX-2 §A.6 — clear any stale offer from a previous beat;
      // THIS turn's response (if any) re-sets it below.
      setOfferedCheckSkill(null);
      setFreeformOfferedCheck(null);

      const isOpening = opts?.kind === 'opening';

      const transcriptLines = logRef.current.slice(-8).map((r) => `${r.who}: ${r.text}`);
      let full = '';
      let errored = false;
      let lastErrorReason: string | undefined;
      let offeredCheckSignal: OfferedCheck | undefined;
      let sceneAdvancedSignal = false;
      // TAV-S1-ABORT-CLEAR: this beat's OWN streaming row id, captured
      // right after upsertStreamNarration creates/updates it. A successor
      // beat always clears + replaces streamRowIdRef before this one's
      // abort check runs, so comparing against the CURRENT ref tells us
      // whether a successor has already claimed it.
      let ownStreamRowId: string | null = null;
      try {
        for await (const ev of streamDmNarration(
          {
            username,
            channel: activeSession.channel,
            // Opening beats MUST send empty message — the proxy enforces this.
            message: isOpening ? '' : playerMessage,
            mechanics,
            transcript: transcriptLines,
            mode: beatMode,
            session_id: activeSession.session_id,
            ...(isOpening ? { kind: 'opening' as const } : {}),
            // Kage #1 / Miko DEFECT-2 — true only on the client's own
            // synthetic confirmation beats (onMoveOn/onAttemptCheck/
            // handleSceneAdvance); tells the server's INTENT classifier not
            // to advance the scene a second time.
            suppress_intent: opts?.suppressIntent ?? false,
          },
          { signal: ctrl.signal },
        )) {
          if (ev.kind === 'chunk') {
            full = ev.text;
            // TAV-COMPOSING — same re-timing as subscribeToJob above: don't
            // clear on the bare event, clear once real content is actually
            // visible.
            if (ev.streamMode) {
              // DM-STREAM: the server is already pacing the reveal
              // token-by-token — set the cumulative text directly instead
              // of running the client-side fake typewriter.
              if (revealRef.current) {
                clearInterval(revealRef.current);
                revealRef.current = null;
              }
              // Tora CRITICAL-1 (resurrection race) — see subscribeToJob's
              // identical comment.
              if (!ctrl.signal.aborted) {
                upsertStreamNarration(full);
                ownStreamRowId = streamRowIdRef.current;
                if (full.trim() !== '') firstChunkArrived();
              }
            } else {
              // Flag-OFF / buffered path — fake-reveal, driving the chat
              // streaming row directly (revealText, TAV-NARRATION-DECOUPLE).
              revealText(full);
            }
            if (ev.offeredCheck) offeredCheckSignal = ev.offeredCheck;
            if (ev.sceneAdvanced) sceneAdvancedSignal = true;
          } else if (ev.kind === 'error') {
            errored = true;
            lastErrorReason = ev.reason;
          }
        }
      } catch (e) {
        errored = true;
        // OBS-1: never swallow the reason — this catch is exactly where
        // "instant stepped-away with zero trace" failures land.
        lastErrorReason = e instanceof Error ? `${e.name}: ${e.message}` : String(e);

        console.error('[dm-narration] beat failed client-side:', e);
      }

      if (ctrl.signal.aborted) {
        // TAV-S1-ABORT-CLEAR: an aborted beat with no successor would
        // otherwise leave a dangling aria-hidden streaming row that
        // nothing will ever finalize. Only clear if streamRowIdRef STILL
        // points at this beat's own row.
        if (shouldClearAbortedStreamRow(streamRowIdRef.current, ownStreamRowId)) {
          clearStreamNarration(true);
        }
        return;
      }
      onTurnSettled();
      if (errored || !full.trim()) {
        // Drop any partial live-streamed row before showing the fallback.
        clearStreamNarration(true);
        const fallbackText = isOpening
          ? "Suzu hasn't joined yet — try a move and she'll catch up."
          : lastErrorReason === 'ai_off'
            ? 'This table runs without AI narration — you and your DM drive the scene.'
            : // OBS-1: on the local stack, show the captured failure reason
              // in the log row itself so a playtest report carries the
              // cause verbatim (prod keeps the friendly copy only).
              `Suzu stepped away for a moment. Try again.${
                process.env.NEXT_PUBLIC_DEPLOY_ENV === 'local' && lastErrorReason
                  ? ` (debug: ${lastErrorReason})`
                  : ''
              }`;
        appendLog({
          who: 'Suzu',
          kind: 'system',
          text: fallbackText,
        });
        return;
      }

      if (streamRowIdRef.current) {
        // Kage-CR CRITICAL (review pass) — the buffered/non-streamMode path
        // drives its streaming row via revealText's setInterval (26ms
        // ticks), independent of the SSE loop above: a `done` event can
        // race ahead of the interval's next tick. Truncating the reveal
        // here (showing the full text immediately) is an acceptable
        // degradation — the invariant that matters is exactly ONE row.
        if (revealRef.current) {
          clearInterval(revealRef.current);
          revealRef.current = null;
        }
        // Streamed path — finalize by REMOUNTING a fresh, non-hidden row
        // (new id) rather than mutating the same node's text.
        finalizeStreamNarration(full);
      } else {
        // Buffered / flag-OFF path — append the finished narration as before.
        appendLog({ who: 'Suzu', kind: 'narration', text: full });
      }

      // P1-PLAYFIX-2 §A.5/§A.7 (A.2 reconciliation) — the server already
      // narrated the transition in-fiction on THIS turn when
      // `sceneAdvanced` is true; just catch the scene card / affordances
      // up. Never call narrate() again here.
      let freshGrounding: GroundingData | null = null;
      if (sceneAdvancedSignal) {
        freshGrounding = await refreshGrounding();
        // Iro Ship 2 CRITICAL-1: mirror onMoveOn/onAttemptCheck — refocus
        // the scene heading if the refresh above stranded focus on <body>.
        refocusSceneHeadIfStranded(hadFocusInCheckWrap || hadFocusInTransitionWrap);
        // DM-ARRIVAL-NARRATION — C3's rescue-transition line (if any) plays
        // FIRST, then the arrival line.
        playRescueTransitionLine(freshGrounding);
        playArrivalLine(freshGrounding);
      }

      // P1-PLAYFIX-2 §A.5/§A.6 — surface an offered check. Per §A.3 this
      // NEVER auto-rolls; it only makes the matching "Attempt {skill}"
      // affordance impossible to miss.
      if (offeredCheckSignal) {
        // Iro MAJOR-1: validate against the freshly-fetched grounding when
        // this beat just advanced the scene — the `grounding` closure value
        // is stale until the next render.
        const currentGrounding = sceneAdvancedSignal ? freshGrounding : grounding;
        applyOfferedCheckSignal(offeredCheckSignal, currentGrounding);
      }
    },
    [
      session,
      username,
      revealText,
      appendLog,
      upsertStreamNarration,
      clearStreamNarration,
      finalizeStreamNarration,
      refreshGrounding,
      refocusSceneHeadIfStranded,
      grounding,
      applyOfferedCheckSignal,
      playArrivalLine,
      playRescueTransitionLine,
      checkWrapRef,
      transitionWrapRef,
      setOfferedCheckSkill,
      setFreeformOfferedCheck,
      logRef,
      streamRowIdRef,
      beginTurn,
      firstChunkArrived,
      onTurnSettled,
    ],
  );

  /**
   * DDX-20 Pass 2 — the flag-ON durable turn path (Client Integration Design
   * §4/§5/§6). Mints+persists a `turn_key`, appends the optimistic player
   * row, POSTs `/api/narration/dm/turn`, and handles all three create
   * outcomes (created, resumed, busy-409). Mirrors `narrate()`'s own
   * AI-eligibility gate.
   */
  const narrateDurable = useCallback(
    async (playerMessage: string, beatMode: ComposeMode) => {
      if (!session || !username || !sessionId) return;

      const aiLevel = session.ai_assist_level;
      const aiEligible = session.dm_mode !== 'human' && aiLevel !== 'off' && aiLevel !== 'assist';

      if (!aiEligible) {
        appendLog({ who: username, kind: 'player', text: playerMessage, color: 'var(--accent)' });
        return;
      }

      // Miko-QA finding (b) — mirrors narrate()'s own pattern: flip
      // talking/thinking SYNCHRONOUSLY, before any await.
      beginTurn();

      setJobFailed(false);
      lastDurableTurnRef.current = { message: playerMessage, mode: beatMode };

      const turnKey = mintTurnKey();
      saveTurnKey(sessionId, turnKey);
      turnKeyRef.current = turnKey;

      const rowId = `r${(idRef.current += 1)}`;
      setLog((prev) => [
        ...prev,
        {
          id: rowId,
          who: username,
          kind: 'player' as const,
          text: playerMessage,
          ts: nowStamp(),
          color: 'var(--accent)',
          pendingKey: turnKey,
        },
      ]);
      pendingByKeyRef.current.set(turnKey, { playerRowId: rowId });

      let handle: Awaited<ReturnType<typeof postDmTurn>>;
      try {
        handle = await postDmTurn({
          username,
          channel: session.channel,
          session_id: sessionId,
          message: playerMessage,
          mode: beatMode,
          turn_key: turnKey,
        });
      } catch (e) {
        console.error('[dm-turn] create failed client-side:', e);
        setLog((prev) => prev.filter((r) => r.id !== rowId));
        pendingByKeyRef.current.delete(turnKey);
        clearTurnKey(sessionId);
        turnKeyRef.current = null;
        setMsg(playerMessage);
        // Release the guard set synchronously above.
        onTurnSettled();
        toast({ tone: 'error', message: 'Could not reach Suzu. Your message was not sent.' });
        return;
      }

      if ('busy' in handle) {
        // §4a — 409-subscribe-pivot.
        setLog((prev) => prev.filter((r) => r.id !== rowId));
        pendingByKeyRef.current.delete(turnKey);
        clearTurnKey(sessionId);
        turnKeyRef.current = null;
        setMsg(playerMessage);
        toast({
          tone: 'info',
          message: "Suzu is still responding — your message wasn't sent, try again in a moment.",
        });
        setActiveJob({
          turn_key: '',
          job_id: handle.job_id,
          status: handle.status,
          trigger_seq: handle.trigger_seq,
          started_at: new Date().toISOString(),
        });
        void subscribeToJob(handle.job_id, `busy:${handle.job_id}`, handle.trigger_seq, 'composer', true);
        return;
      }

      setActiveJob({
        turn_key: handle.turn_key,
        job_id: handle.job_id,
        status: handle.status === 'final' ? 'streaming' : handle.status,
        trigger_seq: 0,
        started_at: new Date().toISOString(),
      });
      void subscribeToJob(handle.job_id, turnKey, undefined, 'composer', true);
    },
    // setMsg: page.tsx-local Composer state -- this crosses the same hook
    // boundary idRef/pendingByKeyRef/setLog already cross (below), so it's
    // listed for the same reason: it's a parameter now, not a closure over
    // a page.tsx-local useState the linter proved stable before A5.
    [
      session,
      username,
      sessionId,
      appendLog,
      subscribeToJob,
      toast,
      idRef,
      pendingByKeyRef,
      setLog,
      setMsg,
      beginTurn,
      onTurnSettled,
    ],
  );

  /**
   * DDX-20 Pass 3 (Synthetic-Beat Design §7 step 2) — a thin durable sibling
   * of `narrateDurable` for the six non-composer "synthetic beat" call
   * sites. Differs from `narrateDurable` in four ways: forwards
   * mechanics+suppress_intent; no optimistic player row (each beat already
   * keeps its own client-only appendLog SYSTEM row); a 409 is
   * subscribe-and-drop (no composer text/row to restore); the error path
   * never toasts or restores composer text (beats have no retry/error
   * affordance).
   *
   * DDX-20 Pass 3 Finding 1 (Miko-QA/Kage-CR MUST-FIX) — this function must
   * NEVER write `jobFailed`/`lastDurableTurnRef`. Those are composer-retry
   * state; a beat writing them would clobber a genuine composer failure's
   * retry payload, or cause a later beat SSE error to surface the
   * composer's Retry banner. `subscribeToJob`'s `origin: 'beat'` argument is
   * what actually suppresses the Retry banner for a beat's own SSE-tail
   * error.
   */
  const narrateDurableBeat = useCallback(
    async (
      playerLine: string,
      mechanics: string,
      beatMode: ComposeMode,
      opts?: { suppressIntent?: boolean; beat?: string },
    ) => {
      if (!session || !username || !sessionId) return;

      const aiLevel = session.ai_assist_level;
      const aiEligible = session.dm_mode !== 'human' && aiLevel !== 'off' && aiLevel !== 'assist';
      if (!aiEligible) return;

      beginTurn();

      const turnKey = mintTurnKey();
      saveTurnKey(sessionId, turnKey);
      turnKeyRef.current = turnKey;

      // §2 player-row policy — no optimistic player row for a synthetic
      // beat; register a ledger entry with NO playerRowId so the poll's
      // durable player_action is appended exactly once.
      pendingByKeyRef.current.set(turnKey, {});

      const beatTag = opts?.beat ?? 'unknown';
      console.debug('beat_turn_started', {
        turn_key: turnKey,
        beat: beatTag,
        suppress_intent: opts?.suppressIntent ?? false,
      });

      let handle: Awaited<ReturnType<typeof postDmTurn>>;
      try {
        handle = await postDmTurn({
          username,
          channel: session.channel,
          session_id: sessionId,
          message: playerLine,
          mechanics,
          mode: beatMode,
          turn_key: turnKey,
          suppress_intent: opts?.suppressIntent ?? false,
        });
      } catch (e) {
        console.error('[dm-turn] beat create failed client-side:', e);
        pendingByKeyRef.current.delete(turnKey);
        clearTurnKey(sessionId);
        turnKeyRef.current = null;
        onTurnSettled();
        return;
      }

      if ('busy' in handle) {
        pendingByKeyRef.current.delete(turnKey);
        clearTurnKey(sessionId);
        turnKeyRef.current = null;
        console.debug('beat_turn_busy_409', { beat: beatTag, inflight_job_id: handle.job_id });
        setActiveJob({
          turn_key: '',
          job_id: handle.job_id,
          status: handle.status,
          trigger_seq: handle.trigger_seq,
          started_at: new Date().toISOString(),
        });
        void subscribeToJob(handle.job_id, `busy:${handle.job_id}`, handle.trigger_seq, 'beat', true);
        return;
      }

      setActiveJob({
        turn_key: handle.turn_key,
        job_id: handle.job_id,
        status: handle.status === 'final' ? 'streaming' : handle.status,
        trigger_seq: 0,
        started_at: new Date().toISOString(),
      });
      void subscribeToJob(handle.job_id, turnKey, undefined, 'beat', true);
    },
    [session, username, sessionId, subscribeToJob, pendingByKeyRef, beginTurn, onTurnSettled],
  );

  /**
   * DDX-20 Pass 2 (§4d) — retry-after-failed. A `failed` job's turn_key is
   * deduped-forever server-side, so retry MUST mint a NEW one.
   *
   * Iro MAJOR-1: `setJobFailed(false)` unmounts the Retry button this click
   * handler is attached to — refocus the permanently-mounted
   * `durableRetryRowRef` wrapper FIRST (refocus-before-unmount).
   */
  const onRetryFailedTurn = useCallback(() => {
    if (durableRetryRowRef.current?.contains(document.activeElement)) {
      durableRetryRowRef.current.focus({ preventScroll: true });
    }
    const last = lastDurableTurnRef.current;
    setJobFailed(false);
    if (last) void narrateDurable(last.message, last.mode);
  }, [narrateDurable]);

  // ── S5.2: DM narration submit handler ───────────────────────────────────────
  /**
   * Called when the human DM sends a dm_narration beat via the composer.
   * Posts to POST /api/dnd/sessions/{id}/events (the existing proxy
   * passthrough). Makes ZERO calls to /api/narration/* — the DM authors the
   * text directly. Text is preserved in `msg` on error (cleared only on
   * success).
   */
  const onSendDmNarration = useCallback(async () => {
    const text = msg.trim();
    if (!text || !sessionId || !session || !username || dmNarrationPending) return;
    setDmNarrationPending(true);
    setDmNarrationError(null);
    // DDX-20 §3.3 (flag-ON only) — stamp a client-minted client_key into the
    // POSTed event's data so ledger rule 4 can dedup this DM's own
    // optimistic row against the durable poll row once it round-trips back.
    const clientKey = DURABLE_GENERATION_ENABLED ? mintTurnKey() : undefined;
    try {
      await postSessionEvent(sessionId, {
        kind: 'dm_narration',
        actor_username: session.dm_username ?? username,
        data: clientKey ? { text, client_key: clientKey } : { text },
        visibility: 'table',
      });
      const actor = session.dm_username ?? username;
      if (clientKey) {
        const rowId = `r${(idRef.current += 1)}`;
        setLog((prev) => [
          ...prev,
          {
            id: rowId,
            who: `DM (${actor})`,
            kind: 'dm_narration' as const,
            text,
            ts: nowStamp(),
            pendingKey: clientKey,
          },
        ]);
        pendingByKeyRef.current.set(clientKey, { playerRowId: rowId });
      } else {
        // Flag-OFF (unchanged) — optimistically append with the distinct
        // dm_narration kind; the poll never renders dm_narration rows on
        // this path, so there is no reconciliation to set up.
        appendLog({
          who: `DM (${actor})`,
          kind: 'dm_narration',
          text,
        });
      }
      setMsg(''); // clear only on success
    } catch (err) {
      // Kage-CR final round: recognise `code === 'unauthorized'` alongside a
      // direct 401/403, not a hand-copied status list.
      const e = err as { status?: number; code?: string } | null;
      if (e?.status === 401 || e?.status === 403 || e?.code === 'unauthorized') {
        window.location.href = '/login';
        return;
      }
      setDmNarrationError('Could not send narration. Try again.');
    } finally {
      setDmNarrationPending(false);
    }
  }, [
    msg,
    sessionId,
    session,
    username,
    dmNarrationPending,
    appendLog,
    idRef,
    setLog,
    pendingByKeyRef,
    setMsg,
    setDmNarrationPending,
    setDmNarrationError,
  ]);

  // DDX-20 Pass 2 — drives the "Resuming Suzu's turn…" status ONLY when
  // this client is not already actively streaming its own beat (talking
  // covers that case) and only on the flag-ON path (activeJob is never set
  // on the flag-OFF path).
  const resumeThinking = DURABLE_GENERATION_ENABLED && !talking && activeJob != null;

  return {
    talking,
    thinking,
    onTurnSettled,
    setActiveJob,
    jobFailed,
    setJobFailed,
    subscribedJobIdRef,
    turnKeyRef,
    pollFailureGraceRef,
    durableRetryRowRef,
    narrationAbort,
    resumeThinking,
    subscribeToJob,
    narrate,
    narrateDurable,
    narrateDurableBeat,
    onRetryFailedTurn,
    onSendDmNarration,
  };
}
