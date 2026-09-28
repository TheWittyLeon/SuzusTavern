'use client';

/**
 * TAV-PLAY-SHELL step 5, hook 11 of ~9 (decomposition plan §2.2, amended by
 * Amendment A §A.2 row 11) — `useSessionEvents`. **The one hard boundary**
 * of the whole decomposition. Owns the 4s unified durable events poll (plan
 * §1.2's "effect 1587–2101 — 514 lines, the single largest block in the
 * file") and its flag-OFF (`DURABLE_GENERATION_ENABLED === false`, the LIVE
 * prod path) legacy sibling: one interval, one fetch cadence, one dedup
 * ledger, no matter which branch fires.
 *
 * Composed LAST — after `useCombatActions` (row 10) — per Amendment A
 * §A.2's amended order and §A.3 edges R4/R6: "`useSessionEvents` owns the
 * interval, not the ledger" and "its handler-callback contract was already
 * the right shape; it just needed to be *after* the things it calls."
 * `page.tsx`'s own composition order is now: 1 lifecycle → 2 myCharacter →
 * 3 safety → 4 transcript → 5 combatState → 6 sceneState → 7 narration →
 * 8 dice → 9 sceneActions → 10 combatActions → **11 events**.
 *
 * **It never imports a sibling hook — handler params/callbacks only, not
 * context reads.** Kage-CR's A6 review measured this precisely: the poll's
 * 227 code lines (comments stripped) close over 27 sibling identifiers —
 * refs, setters and stable callbacks — and **zero sibling STATE VALUES**
 * (`grounding`, `log`, `combatState`, `talking`, `session`, `mySheet`,
 * `participants`, `quickChecks`, `advantage`, `rollBusy`, `xCardEvent`, …
 * all zero code hits). A poll that reads no sibling *value* has no stale-
 * closure problem, so the handler-callback fan-out is achievable with
 * **zero ref-mirrors** — `hooks/` stays at zero `useLayoutEffect` after
 * this commit, same as it was after A5.
 *
 * `handlers` is **one named object**, not 27 positional params — Kage's A6
 * review proved positional params are the wrong shape at this scale: probe
 * MD9 swapped `narrate`/`narrateDurableBeat` at `useDice`'s 5-param call
 * site and `tsc --noEmit` stayed exit 0 (only tests caught it), because the
 * two function types are structurally interchangeable. "Survivable at 5
 * params. At [this hook's] 26 it is not" (Kage, verbatim) — several fields
 * here share an exact type too (`renderedSeqsRef`/`journalSeenSeqsRef` are
 * both `MutableRefObject<Set<number>>`; `turnKeyRef`/`subscribedJobIdRef`
 * are both `MutableRefObject<string | null>`), so a positional swap would
 * type-check silently. A single object literal with named keys turns that
 * class of mistake into "wrote the wrong key", not "miscounted a position".
 * Named by WHAT each field is (the sibling hook's own identifier), not by
 * an invented "event" name (`onXCard`, `onJournalEvent`, …) — every field
 * already has exactly one real name from its owning hook's return type, and
 * renaming it at this boundary would make a byte-diff against `page.tsx`'s
 * former inline poll harder to verify, not easier. Every such comment moved
 * with its code (plan §5's pin rule); provenance comments that said "…'s
 * destructure above" are corrected to name the owning hook explicitly,
 * since "above" stopped being true the moment this code left `page.tsx`.
 *
 * `renderedSeqsRef`/`pendingByKeyRef`/`logRef`/`lastEventSeqRef` stay
 * OWNED by `useTranscript` (Amendment A §A.3 edge R4: "the ref is
 * transcript state … not poll state — the poll *reads* it") and arrive
 * here as plain fields on `handlers`, same as every other sibling-hook
 * value. `journalSeenSeqsRef`/`setJournalEvents` are the one exception:
 * neither is owned by any hook yet (`journalEvents` is still a page.tsx-
 * local `useState`, plan §1.9/DDX-22 territory) — they arrive the same way,
 * because "no hook owns it yet" is not a reason to invent one here.
 *
 * `sessionId`/`state` are plain leading params (not part of `handlers`) —
 * every other hook in this series leads with `sessionId`, and neither
 * collides in type with anything else on this signature, so positional is
 * safe for exactly these two.
 *
 * Preserves, unmodified in every branch: the `since_seq`-drop-tolerant
 * cursor loop (`has_more`, capped at 25 pages), the intra-tick +
 * cross-tick seq dedup for `journalEvents` (`journalSeenSeqsRef`, DDX-20
 * F9+Recap fix), the durable reconcile ledger
 * (`reconcileDurableEvents`/`applyReconcileResult`), the grounding-
 * invalidation refetch + focus-rescue pairing (Tora-Gesture CRITICAL-1,
 * both branches), the offered-check parity fix (Phase 4, "the sleeper
 * bug"), the `pending_generation` no-op guard (Kage #5), the stateless
 * poll-discovery resume path (§4b), the turn_key lifecycle clear (§4c) and
 * the poll-only failure-detection grace window (§4d, Miko-QA finding c).
 * Every past seq-ordering bug this file's comments document moved with its
 * code — this hook is exactly as strict about that history as the plan
 * demands ("the comments document past seq-ordering bugs, and every such
 * comment moves with its code").
 *
 * Kage-CR A6 IMPORTANT-1's `diceRollPollIntervalRef` finding is closed
 * ahead of this commit (A4 commit 0, `useDice.ts`): the poll's own interval
 * handle is a plain effect-local `const`, never a ref — see this file's own
 * `useEffect` for where it lives now.
 */
import { useEffect } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import {
  getGrounding,
  getSessionEventsPage,
  getSessionEventsRaw,
} from '@/lib/api/dnd';
import { eventToLogRow, POLL_RENDERED_KINDS } from '@/lib/rehydration';
import { DURABLE_GENERATION_ENABLED } from '@/lib/config';
import { clearTurnKey } from '@/lib/turnKey';
import { reconcileDurableEvents, applyReconcileResult } from '@/lib/dnd/reconcileEvents';
import type { PendingTurnEntry } from '@/lib/dnd/reconcileEvents';
import type {
  EngineSessionEvent,
  GroundingData,
  OfferedCheck,
  PendingGeneration,
} from '@/lib/api/types';
import type { LogRow } from '@/components/ChatLog';
import { POLL_INTERVAL_MS, scanXCardTracking } from '../format';
import type { PlayPageLoadState } from './useSessionLifecycle';
import type { XCardEvent } from './useSafety';

/**
 * DDX-20 §4d (Miko-QA finding c) — the poll-only failure-detection grace
 * window: consecutive poll ticks a client's OWN in-flight turn_key may go
 * unreflected in `pending_generation` (with no narration seq > trigger_seq
 * having landed) before it's treated as a died-silently job (Redis TTL
 * eviction, runner crash, or an SSE tail that closed without an error
 * frame — a proxy idle-timeout truncation, a backgrounded tab pausing the
 * EventSource). 2 ticks (~8s at the poll cadence above) absorbs ordinary
 * poll/commit timing lag without meaningfully delaying real-failure
 * detection for a beat that typically completes well within that window.
 */
const POLL_FAILURE_GRACE_TICKS = 2;

/**
 * Session-event kinds that can change scene affordances (available checks,
 * transitions/gated exits) and therefore require a `grounding` re-fetch when
 * they arrive over the `/events` poll.
 *
 * - `scene_advance` — the server-side cursor moved to a new scene.
 * - `beat_resolved` / `beat_done` / `beat_override` — the STRUCT-006 beat ledger
 *   changed. The beat classifier resolves required beats AFTER the narration
 *   turn is delivered (deliberate — see the durable poll effect), and resolving
 *   the last unmet required beat opens a previously-hidden anti-skip gate: a new
 *   exit + its check appear in grounding WITHOUT the cursor advancing. Without a
 *   re-fetch on these, a classifier-opened gate stays invisible until a manual
 *   page reload. All three are written `visibility="table"` by the engine, so
 *   they reach this feed. Both the durable and the flag-OFF/SSE poll branches
 *   share this predicate so the two paths can't drift.
 */
const GROUNDING_INVALIDATING_KINDS = new Set([
  'scene_advance',
  'beat_resolved',
  'beat_done',
  'beat_override',
  // Check Retry + Fail-Forward (2026-07-28 design section 7.4): a
  // resolved/locked check changes this scene's check rail. Without this, a
  // second client at the same table keeps showing a check as available
  // after another player already resolved it, and eats a 409 on click.
  'check_resolved',
]);

/**
 * Phase 4 (Sora-Arch design §4 Fork 3) — parse an `offered_check` payload off
 * a durable `narration`/`dm_narration` session event's `data` (the field the
 * completed-job payload carries per the locked wire contract:
 * `{skill, dc: int|null, note: str|null}`). This is the durable-poll
 * counterpart to src/lib/stream.ts's identical SSE-side parsing — same
 * defensive posture: any missing/malformed shape simply returns null
 * (presence is a bonus, never a requirement), so a pre-Phase-4 engine/proxy
 * that doesn't send this field yet degrades to "no offer", never a crash.
 */
function parseOfferedCheckPayload(
  data: Record<string, unknown> | null | undefined,
): OfferedCheck | null {
  const raw = data?.['offered_check'];
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const skill = r['skill'];
  if (typeof skill !== 'string') return null;
  const dc = typeof r['dc'] === 'number' ? (r['dc'] as number) : undefined;
  const note = typeof r['note'] === 'string' ? (r['note'] as string) : undefined;
  return { skill, ...(dc !== undefined ? { dc } : {}), ...(note !== undefined ? { note } : {}) };
}

/**
 * The fan-out. One named object — every field is the exact identifier its
 * owning hook already exports (grep-traceable against `page.tsx`'s former
 * inline destructure), grouped here so a call-site swap is a wrong KEY, not
 * a miscounted position. Owning hook named per field; `journalSeenSeqsRef`/
 * `setJournalEvents` have no owning hook yet (see this file's header).
 */
export interface UseSessionEventsHandlers {
  // useTranscript (the ledger) — Amendment A §A.3 edge R4: this hook reads
  // it, never owns it.
  lastEventSeqRef: MutableRefObject<number>;
  renderedSeqsRef: MutableRefObject<Set<number>>;
  pendingByKeyRef: MutableRefObject<Map<string, PendingTurnEntry>>;
  logRef: MutableRefObject<LogRow[]>;
  setLog: Dispatch<SetStateAction<LogRow[]>>;
  appendLog: (row: Omit<LogRow, 'id' | 'ts'>) => void;
  clearStreamNarration: (removeRow: boolean) => void;

  // useSceneState
  checkWrapRef: MutableRefObject<HTMLDivElement | null>;
  setGrounding: Dispatch<SetStateAction<GroundingData | null>>;
  diffAndExplainResolvedChecks: (g: GroundingData | null | undefined) => void;
  refocusSceneHeadIfStranded: (hadFocusInGroup: boolean) => void;
  applyOfferedCheckSignal: (signal: OfferedCheck, currentGrounding: GroundingData | null) => void;
  setOfferedCheckSkill: Dispatch<SetStateAction<string | null>>;
  setFreeformOfferedCheck: Dispatch<SetStateAction<string | null>>;

  // useNarration
  setActiveJob: Dispatch<SetStateAction<PendingGeneration | null>>;
  setJobFailed: Dispatch<SetStateAction<boolean>>;
  // Kage-CR A4 IMPORTANT-3 (2026-09-28) — replaces the raw `setThinking`/
  // `setTalking` pair: both call sites this poll used them at (§4c turn_key
  // lifecycle clear, §4d poll-failure-grace forced cleanup) always set them
  // together to false, and a swap between them was a provable no-op
  // (Miko-QA's mutation). `useNarration` now owns the one named transition
  // this poll needs; see that hook's own header for the full three-state
  // enumeration.
  onTurnSettled: () => void;
  subscribedJobIdRef: MutableRefObject<string | null>;
  turnKeyRef: MutableRefObject<string | null>;
  pollFailureGraceRef: MutableRefObject<{ turnKey: string; nullTicks: number } | null>;
  narrationAbort: MutableRefObject<AbortController | null>;
  subscribeToJob: (
    jobId: string,
    ledgerKey: string,
    triggerSeq: number | undefined,
    origin: 'composer' | 'beat',
    precreateRow: boolean,
  ) => Promise<void>;

  // useSafety
  setXCardEvent: Dispatch<SetStateAction<XCardEvent | null>>;
  setLatestNarrationSeq: Dispatch<SetStateAction<number | null>>;

  // page.tsx-local (DDX-22 journal drawer state, plan §1.9) — no owning
  // hook yet; arrives the same way as everything above regardless.
  journalSeenSeqsRef: MutableRefObject<Set<number>>;
  setJournalEvents: Dispatch<SetStateAction<EngineSessionEvent[]>>;
}

export function useSessionEvents(
  sessionId: string,
  state: PlayPageLoadState,
  handlers: UseSessionEventsHandlers,
): void {
  // ── dice-roll events poll (4s, foregrounded) ────────────────────────────────
  // DDX-08 / T3: dice rolls are server-authoritative (POST /roll persists a
  // `dice_roll` session event, DDX-07) — this poll is what makes a roll
  // triggered on ANY client (including this one; onRoll never appends a row
  // locally) show up on EVERY client watching the session, without a reload.
  // Mirrors the session-status poll (useSessionLifecycle's own effect):
  // same cadence, same document.hidden gate, same cleanup-on-unmount shape.
  //
  // The engine's GET /events has no "since seq" filter, so every tick refetches
  // the full (capped) event list and appends only rows with seq strictly
  // greater than handlers.lastEventSeqRef.current (set once by rehydration, advanced
  // here after each tick). Only `dice_roll` and `x_card` (DDX-26) events are
  // rendered as ROWS by this poll — other kinds (player_action/narration/...)
  // are already reflected through their own optimistic-append/streaming paths
  // and are intentionally left to a future unified events poll (DDX-20) to
  // avoid duplicating rows for the client that originated them.
  //
  // DDX-26: this same tick also feeds `newOnes` (every kind, not just the
  // rendered ones) to scanXCardTracking so the X-card banner's active-state
  // (xCardEvent / latestNarrationSeq) converges on every open client — the
  // raiser's own tab included, since the raise handler only sets an
  // optimistic local value and relies on this poll for the durable/cross-tab
  // truth, exactly like onRoll relies on this poll for dice_roll rows.
  useEffect(() => {
    if (!sessionId || state !== 'ok') return;

    // DDX-20 (flag-ON only) — the unified events poll. Replaces the
    // full-refetch-and-filter legacy poll with the `since_seq` cursor
    // (Technical Design §2.2) and reconciles EVERY kind (not just
    // dice_roll/x_card) through the ledger (§3.2) so an originating client
    // never double-renders and a reload reconstructs purely from the poll.
    // Loops forward while `has_more` is true (cold-start / large-backlog
    // catch-up), same cursor-loop shape as the design's §6 mobile-parity
    // note. Never called on the flag-OFF path — see the early-return guard
    // in `poll` below, which is the ENTIRE flag-off diff to this effect.
    const pollDurable = async () => {
      try {
        let sinceSeq = handlers.lastEventSeqRef.current;
        let page = await getSessionEventsPage(sessionId, sinceSeq);
        let allNewEvents: EngineSessionEvent[] = [...page.events];
        let maxSeq = page.max_seq;
        let guard = 0;
        while (page.has_more && guard < 25) {
          guard += 1;
          const pageMax = page.events.reduce((m, e) => Math.max(m, e.seq ?? 0), sinceSeq);
          if (pageMax <= sinceSeq) break; // no forward progress — avoid an infinite loop
          sinceSeq = pageMax;
          page = await getSessionEventsPage(sessionId, sinceSeq);
          allNewEvents = allNewEvents.concat(page.events);
          maxSeq = Math.max(maxSeq, page.max_seq);
        }

        if (allNewEvents.length > 0) {
          // DDX-20 F9+Recap Design §2.4 — merge-by-seq, NOT a blind append.
          // This comment used to claim "the cursor read only ever returns
          // rows this client hasn't seen yet, so appending is correct here"
          // — that assumption doesn't hold in general (Kage-CR SUGGESTION,
          // this pass — reworded to lead with the permanent reason instead
          // of a "not yet deployed" framing that would read as stale the day
          // it ships): Tavern and the NekoNova proxy deploy independently,
          // so a flag-ON Tavern build can always meet a proxy that drops
          // `since_seq` (ProjectNekoNova/api/routes/dnd_sessions.py) before
          // it reaches the engine, no matter what lands upstream — this
          // defense is permanent, not contingent on any one deploy. (That
          // drop IS fixed upstream in ProjectNekoNova `be4db8a`
          // (`feature/ddx-20-p1b-durable-runner`), not yet merged to main or
          // deployed as of this pass — cross-repo, filed separately, not
          // fixed here — but whether it ships doesn't change whether Tavern
          // needs this defense.) So `allNewEvents` is the FULL session
          // history on EVERY poll tick under today's proxy. A blind
          // `[...prev, ...allNewEvents]` append therefore re-added the whole
          // history every ~4s: unbounded journalEvents growth, duplicate
          // React keys in deriveRecapHistory (`recap-${seq}`), and a fresh
          // array identity every tick even when nothing changed. This runs
          // BEFORE reconcileDurableEvents below, so the §2.2 ledger seed
          // page.tsx's mount effect installs does NOT cover it —
          // journalEvents needs its own dedup.
          // Same "don't trust the network" posture as §2.2: correct
          // regardless of what the wire actually returns.
          //
          // Post-review fix (Kage-CR IMPORTANT / Miko-QA MEDIUM, fold
          // commit) — the dedup used to build `seen` ONCE from `prev` and
          // never update it while filtering `allNewEvents`, so it only
          // deduped ACROSS ticks, never WITHIN one: the has_more catch-up
          // loop above reproduces exactly that when the wire drops
          // `since_seq` (an identical page gets refetched and concat'd onto
          // `allNewEvents` before this runs). Separately, `e.seq == null`
          // used to short-circuit straight to "fresh", so a malformed/
          // legacy no-seq event bypassed dedup ENTIRELY and re-appended
          // every tick, unbounded, for as long as the session stayed
          // mounted — worse than the has_more case, which at least
          // self-limits after 2 fetches. Fixed by mirroring
          // reconcileDurableEvents' own rule 1 (reconcileEvents.ts):
          // check-and-add one key at a time via handlers.journalSeenSeqsRef
          // (seeded alongside journalEvents in page.tsx's mount effect)
          // instead of computing a static snapshot once per tick.
          //
          // Seq normalizes via `?? 0` (matching reconcileEvents.ts:151 and
          // handlers.lastEventSeqRef's own `?? 0` convention, established in
          // page.tsx's mount-effect rehydration seed), not treated as
          // unconditionally unique when missing. Trade-off, stated plainly
          // (Kage-CR SUGGESTION, this pass — corrected from a "window"
          // framing that understated the blast radius): key `0` is poisoned
          // for the WHOLE MOUNT once anything claims it, not just within one
          // poll batch — and the poisoning event can come from the
          // rehydration seed in page.tsx's mount effect (handlers.journalSeenSeqsRef's
          // mount-time `?? 0` normalization of the rehydrated history) just as easily as from
          // a later poll tick, so every LATER genuinely-distinct null-seq
          // event is dropped for the rest of the session once that happens,
          // not merely within a shared batch. Accepted because (a) this is
          // dormant BY CONSTRUCTION, not just "hasn't happened yet":
          // `msm.session_events.seq` is `bigint NOT NULL`
          // (NekoNova-DnDEngine db/migrations/msm/001_schema.sql:415), its
          // sole writer `_log_session_event_locked`
          // (engine/msm_repo.py:1498-1568, whose own inline comment states
          // it is "the SOLE assigner of msm.session_events.seq") always
          // computes
          // `seq` inline via `COALESCE(MAX(seq), 0) + 1`, the legacy
          // fallback synthesizes a 1-based seq from row order, and the
          // NekoNova proxy only ever filters whole events — it never
          // rewrites fields — so neither engine path can structurally emit
          // a null seq, and (b) the alternative (today's pre-fix behavior:
          // null-seq events exempt from dedup entirely) is the strictly
          // worse, ACTUALLY-reachable bug this fixes.
          //
          // console.debug hoisted above handlers.setJournalEvents (Kage-CR
          // SUGGESTION) — state updaters must stay pure; React 19
          // StrictMode double-invokes them to catch exactly this, and would
          // have double-logged in dev. `journalFresh` is computed here (a
          // plain, already-decided array) so the updater below only ever
          // does a deterministic append + sort — no Set mutation, no
          // logging, safe to double-invoke.
          const journalFresh: EngineSessionEvent[] = [];
          for (const e of allNewEvents) {
            const key = e.seq ?? 0;
            if (handlers.journalSeenSeqsRef.current.has(key)) continue;
            handlers.journalSeenSeqsRef.current.add(key);
            journalFresh.push(e);
          }
          // §10 observability — the live tell for the NekoNova since_seq
          // drop (fresh 0, fetched N on every tick with no real new
          // activity); flips to fetched:0 the day that hop is fixed. Now
          // also catches the null-seq variant above (Kage-CR SUGGESTION —
          // previously silent for it: a null-seq event always counted as
          // "fresh" under the old filter, so fetched and fresh stayed
          // numerically equal even on a 100%-redundant tick, and the has_more
          // duplicate case never shrank `fresh` either since `seen` was never
          // updated intra-batch). Masked: counts only, never prose/mechanics.
          if (journalFresh.length < allNewEvents.length) {
            console.debug('poll_page_redundant', {
              fetched: allNewEvents.length,
              fresh: journalFresh.length,
            });
          }
          if (journalFresh.length > 0) {
            handlers.setJournalEvents((prev) =>
              [...prev, ...journalFresh].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0)),
            );
          }

          // Scene panel objective / quick-checks AND gated exits/checks are
          // driven by `grounding` state. On the DURABLE path a scene_advance is
          // discovered HERE (via this poll), not through narrate()'s SSE
          // `sceneAdvancedSignal` — so without this refetch the Scene card lags
          // on the previous scene after the runner advances the cursor
          // server-side (the transcript shows the transition beat, but the
          // objective/quick-checks stay stale).
          //
          // STRUCT-006 (2026-07-24): the beat classifier resolves required
          // beats AFTER the narration turn is delivered (deliberate — grounding
          // hides gated exits, so no INTENT on the turn that opens a gate could
          // ever name that exit; zero added player latency). It writes
          // beat_resolved (source=classifier) / beat_done / beat_override
          // session events (all visibility="table", so they reach this feed),
          // and resolving the last unmet required beat opens a previously-hidden
          // anti-skip gate: a new exit + its check appear in grounding.
          // scene_advance alone did NOT cover this — the gate opens WITHOUT the
          // cursor moving — so a classifier-opened gate stayed invisible until a
          // manual page reload (the one thing that materially breaks the
          // feel-check). Re-fetching on the beat-ledger kinds too surfaces it
          // within one poll cycle (~4s).
          //
          // Keyed on `journalFresh` (seq-deduped) not `allNewEvents`, so it
          // fires ONCE per resolve rather than every tick under the NekoNova
          // `since_seq`-drop full-history refetch. Inlined (not
          // useSceneState's `refreshGrounding()`) because that helper always
          // calls handlers.setGrounding+handlers.diffAndExplainResolvedChecks unconditionally
          // — this tick may only have an `offerThisTick` with
          // `invalidatesGrounding` false, and must NOT touch grounding
          // state at all in that case.
          const invalidatesGrounding = journalFresh.some(
            (e) => e.kind != null && GROUNDING_INVALIDATING_KINDS.has(e.kind),
          );

          // Phase 4 (Sora-Arch design §4 Fork 3; Miko-QA "the sleeper bug"
          // fix, the single most important new client-side assertion in the
          // whole plan) — durable-poll parity for `offered_check`.
          // narrate()'s SSE path already surfaces this (src/lib/stream.ts);
          // the durable poll never read it at all, so a completed job's
          // check offer sat silently on the wire, unrendered. Only the
          // HIGHEST-seq narration/dm_narration event THIS TICK decides the
          // outcome — mirrors narrate() clearing offeredCheckSkill/
          // freeformOfferedCheck at the top of EVERY beat, then only
          // re-setting one at the bottom if THAT beat offered one: an older
          // beat's stale offer must never win over a newer beat's "no
          // offer" just because both landed in the same catch-up batch
          // (e.g. a backgrounded tab resuming several beats at once).
          let latestNarrationEvent: EngineSessionEvent | null = null;
          for (const e of journalFresh) {
            if (e.kind !== 'narration' && e.kind !== 'dm_narration') continue;
            if (!latestNarrationEvent || (e.seq ?? 0) > (latestNarrationEvent.seq ?? 0)) {
              latestNarrationEvent = e;
            }
          }
          const offerThisTick = latestNarrationEvent
            ? parseOfferedCheckPayload(latestNarrationEvent.data)
            : undefined; // no NEW narration beat this tick at all — leave offer state untouched

          if (invalidatesGrounding || offerThisTick) {
            // Iro MAJOR-1 parity: validate the offer against CURRENT
            // grounding, never the closure's `grounding` (this poll, like
            // narrate(), treats it as unreliable — see the effect's own
            // convention of always refetching fresh below).
            getGrounding(sessionId)
              .then((g) => {
                if (invalidatesGrounding) {
                  // Tora-Gesture CRITICAL-1 (2026-07-28): this setGrounding
                  // call can unmount the check the player currently has
                  // focus on (another table member resolved/locked it, or a
                  // STRUCT-006 classifier did via roleplay -- no click on
                  // THIS client at all), stranding focus on <body> with no
                  // recovery. Same rescue onAttemptCheck's own click path
                  // already uses (useSceneActions.ts) -- capture
                  // synchronously right before the state update that may
                  // unmount, refocus after. `refocusSceneHeadIfStranded`/
                  // `setGrounding`/`diffAndExplainResolvedChecks`/
                  // `checkWrapRef` are all useSceneState's (TAV-PLAY-SHELL
                  // step 5 hook 6), arriving here as plain handler params --
                  // the poll takes handler callbacks, not context reads
                  // (Amendment A §A.2 row 11) -- stable across renders, so
                  // deliberately NOT added to this effect's own deps array
                  // (kept consistent with the surrounding omissions this
                  // effect's own deps comment documents).
                  const hadFocusInCheckWrap =
                    handlers.checkWrapRef.current?.contains(document.activeElement) ?? false;
                  handlers.setGrounding(g);
                  handlers.diffAndExplainResolvedChecks(g);
                  handlers.refocusSceneHeadIfStranded(hadFocusInCheckWrap);
                }
                if (offerThisTick) handlers.applyOfferedCheckSignal(offerThisTick, g);
              })
              .catch(() => {});
          }
          if (latestNarrationEvent && !offerThisTick) {
            // A new beat landed this tick and offered nothing — clear any
            // stale highlight from an earlier beat (mirrors narrate()'s
            // per-beat clear at the top of the SSE function).
            handlers.setOfferedCheckSkill(null);
            handlers.setFreeformOfferedCheck(null);
          }

          // §10 observability (Kage-CR low suggestion) — snapshot which
          // beat-origin ledger keys are still awaiting narration BEFORE
          // reconciling, so we can log `beat_narration_reconciled` for any
          // that resolve (deleted from the ledger) this tick. Masked: no
          // mechanics/prose, just seq + the turn_key correlation id.
          const beatKeysAwaitingBefore = [...handlers.pendingByKeyRef.current.entries()]
            .filter(([, e]) => e.origin === 'beat' && e.awaitingNarration)
            .map(([key]) => key);

          const result = reconcileDurableEvents(
            allNewEvents,
            handlers.renderedSeqsRef.current,
            handlers.pendingByKeyRef.current,
            (id) => handlers.logRef.current.find((r) => r.id === id),
          );
          if (result.appended.length > 0 || result.stamped.length > 0) {
            handlers.setLog((prev) => applyReconcileResult(prev, result));
          }
          for (const key of beatKeysAwaitingBefore) {
            if (!handlers.pendingByKeyRef.current.has(key)) {
              console.debug('beat_narration_reconciled', { seq: result.maxSeqSeen, turn_key: key });
            }
          }
          const { xCard, narrationSeq } = scanXCardTracking(allNewEvents);
          if (xCard) {
            handlers.setXCardEvent((prev) => (!prev || xCard.seq > prev.seq ? xCard : prev));
          }
          if (narrationSeq != null) {
            handlers.setLatestNarrationSeq((prev) =>
              prev == null || narrationSeq > prev ? narrationSeq : prev,
            );
          }
        }

        handlers.lastEventSeqRef.current = Math.max(handlers.lastEventSeqRef.current, maxSeq, sinceSeq);

        // §2.2/§4b — surface pending_generation as real state (Pass 2 —
        // drives the resume/busy affordance). Masked observability per §10:
        // never log data.text/prose, only the correlation id + seq.
        // Kage #5: only touch state when job_id/status actually changed —
        // otherwise every ~4s tick constructs a NEW object (even when the
        // job is unchanged) and forces a re-render for nothing, mirroring
        // the same no-op-guard discipline the flag-OFF session-status poll
        // already applies via sessionsEqual().
        const pending = page.pending_generation;
        handlers.setActiveJob((prev) => {
          if (prev === pending) return prev;
          if (
            prev &&
            pending &&
            prev.job_id === pending.job_id &&
            prev.status === pending.status &&
            prev.trigger_seq === pending.trigger_seq
          ) {
            return prev;
          }
          return pending;
        });

        // §4b — stateless poll-discovery, the primary resume mechanism:
        // subscribe (never POST) to an in-flight job this client is not
        // already tailing. Covers three cases uniformly via the
        // handlers.subscribedJobIdRef guard: (1) a fresh mount/reload discovering
        // another client's (or this tab's own PRIOR reload's) turn — the
        // "don't-re-POST" rule; (2) this client's own just-created job,
        // where narrateDurable already set handlers.subscribedJobIdRef before this
        // tick runs, so the guard correctly no-ops here; (3) the 409-busy
        // pivot's own subscribe, same no-op guard.
        if (pending && pending.job_id !== handlers.subscribedJobIdRef.current) {
          console.debug('turn_resumed_from_pending', {
            job_id: pending.job_id,
            trigger_seq: pending.trigger_seq,
          });
          // origin: 'composer' — a stateless poll-resume genuinely cannot
          // tell whether the discovered job was a composer turn or a
          // synthetic beat (no server-side marker exists, and this client's
          // own lastDurableTurnRef/handlers.turnKeyRef are reset across a reload
          // anyway). Defaulting to 'composer' preserves pre-fix behavior
          // here (out of Finding 1's scope, which is the explicit
          // narrateDurable/narrateDurableBeat call sites below) — worst case
          // on a genuine beat-job SSE error post-reload is a Retry banner
          // whose click no-ops (onRetryFailedTurn already guards on a null
          // lastDurableTurnRef), not a wrong-content resubmit.
          // precreateRow: false (TAV-NARRATION-DECOUPLE Phase 2) — deliberately
          // scoped OFF this stateless resume path: the narration may already
          // exist server-side by the time a reload discovers the job, so
          // pre-creating an anchor here risks racing a same-tick append.
          // Resume pop-in stays possible but is rare/accepted (design §11).
          void handlers.subscribeToJob(
            pending.job_id,
            pending.turn_key,
            pending.trigger_seq,
            'composer',
            false,
          );
        } else if (!pending) {
          handlers.subscribedJobIdRef.current = null;
        }

        // §4c turn_key lifecycle — clear once THIS client's own in-flight
        // turn resolved (reconcileDurableEvents' rules 2/3 above removed its
        // ledger entry once the narration seq was observed).
        if (handlers.turnKeyRef.current && !handlers.pendingByKeyRef.current.has(handlers.turnKeyRef.current)) {
          clearTurnKey(sessionId);
          handlers.turnKeyRef.current = null;
          handlers.pollFailureGraceRef.current = null;
          // TAV-COMPOSING (Phase 1, 2026-07-26) — this turn's own ledger
          // entry is gone, so the beat resolved via the poll's reconciliation
          // (rule 3 sub-case a/b) BEFORE (or without) handlers.subscribeToJob's tail
          // ever clearing the indicator itself (e.g. the poll replaced a
          // precreated anchor before the first SSE chunk). Scoped to
          // `handlers.turnKeyRef` — the composer's own current turn — so it never
          // clears a DIFFERENT, still-in-flight beat's indicator; a beat's
          // own tail always self-clears at its SSE end (:973-ish) regardless.
          handlers.onTurnSettled();
        }

        // §4d, mechanism 2 (Miko-QA finding c) — poll-only failure detection.
        // Only meaningful while THIS client still owns an unresolved turn
        // (the completion branch just above already handles the success
        // case). If `pending_generation` doesn't reflect our turn_key this
        // tick, count it; once that streak reaches POLL_FAILURE_GRACE_TICKS
        // with STILL no narration having landed, treat the job as dead —
        // same cleanup + retry affordance as handlers.subscribeToJob's SSE-error path.
        // This is what catches a job that died where NO client is actively
        // holding its SSE tail to observe an `error` frame (reload after a
        // silent failure, a tab backgrounded long enough for the browser to
        // pause/kill the EventSource, a proxy idle-timeout truncation).
        if (handlers.turnKeyRef.current && handlers.pendingByKeyRef.current.has(handlers.turnKeyRef.current)) {
          const ownTurnKey = handlers.turnKeyRef.current;
          if (pending?.turn_key === ownTurnKey) {
            // Confirmed alive this tick — reset the grace counter.
            handlers.pollFailureGraceRef.current = { turnKey: ownTurnKey, nullTicks: 0 };
          } else {
            const grace =
              handlers.pollFailureGraceRef.current?.turnKey === ownTurnKey
                ? handlers.pollFailureGraceRef.current
                : { turnKey: ownTurnKey, nullTicks: 0 };
            grace.nullTicks += 1;
            handlers.pollFailureGraceRef.current = grace;

            if (grace.nullTicks >= POLL_FAILURE_GRACE_TICKS) {
              console.debug('turn_failed_poll_grace', { turn_key: ownTurnKey });
              // Abort a live SSE tail if one is still (uselessly) open for
              // this job — mirrors handlers.subscribeToJob's own cleanup.
              if (handlers.subscribedJobIdRef.current) {
                handlers.narrationAbort.current?.abort();
                handlers.subscribedJobIdRef.current = null;
              }
              handlers.pendingByKeyRef.current.delete(ownTurnKey);
              clearTurnKey(sessionId);
              handlers.turnKeyRef.current = null;
              handlers.pollFailureGraceRef.current = null;
              handlers.clearStreamNarration(true);
              handlers.onTurnSettled();
              handlers.setActiveJob(null);
              handlers.setJobFailed(true);
              handlers.appendLog({
                who: 'Suzu',
                kind: 'system',
                text: 'Suzu stepped away for a moment. Try again.',
              });
            }
          }
        } else if (handlers.pollFailureGraceRef.current && handlers.pollFailureGraceRef.current.turnKey !== handlers.turnKeyRef.current) {
          // Stale counter from a resolved/abandoned turn — drop it so a
          // future turn starts its own grace count from zero.
          handlers.pollFailureGraceRef.current = null;
        }
      } catch {
        // Poll errors are non-fatal — the next tick will retry (same
        // convention as the flag-OFF branch below).
      }
    };

    const poll = async () => {
      if (document.hidden) return;
      if (DURABLE_GENERATION_ENABLED) {
        await pollDurable();
        return;
      }
      try {
        const events = await getSessionEventsRaw(sessionId);
        if (!events || events.length === 0) return;
        const newOnes = events
          .filter((e) => (e.seq ?? 0) > handlers.lastEventSeqRef.current)
          .sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
        if (newOnes.length === 0) return;
        // Miko poll-churn fix: this used to run BEFORE the newOnes.length
        // guard above, so a fresh (but content-identical) array from
        // getSessionEventsRaw re-rendered the whole page + re-ran all 3
        // JournalPane derivations on EVERY 4s tick forever, even when
        // nothing new happened. Mirrors the sibling session-status poll's
        // own sessionsEqual no-op guard: only touch state when something
        // actually changed. The mount-time rehydration effect already seeds
        // journalEvents once on load — this only keeps it current on ticks
        // that have real new activity.
        handlers.setJournalEvents([...events].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0)));
        const rows = newOnes
          .filter((e) => e.kind != null && POLL_RENDERED_KINDS.has(e.kind))
          .map(eventToLogRow)
          .filter((r): r is LogRow => r !== null);
        if (rows.length > 0) {
          handlers.setLog((prev) => [...prev, ...rows]);
        }
        const { xCard, narrationSeq } = scanXCardTracking(newOnes);
        if (xCard) {
          handlers.setXCardEvent((prev) => (!prev || xCard.seq > prev.seq ? xCard : prev));
        }
        if (narrationSeq != null) {
          handlers.setLatestNarrationSeq((prev) =>
            prev == null || narrationSeq > prev ? narrationSeq : prev,
          );
        }
        // STRUCT-006 (2026-07-24): mirror the durable poll's grounding
        // invalidation. On the flag-OFF/SSE path the beat classifier still runs
        // post-delivery (narration.py background thread + buffered) and writes
        // beat_resolved, so a classifier-opened gate would otherwise stay hidden
        // until reload here too. scene_advance normally reaches grounding via
        // narrate()'s sceneAdvancedSignal, but re-fetching on it here as well is
        // idempotent and also catches a cross-client advance this tab didn't
        // originate. `newOnes` is seq-deduped, so this fires once per change.
        if (newOnes.some((e) => e.kind != null && GROUNDING_INVALIDATING_KINDS.has(e.kind))) {
          getGrounding(sessionId)
            .then((g) => {
              // Tora-Gesture CRITICAL-1 (2026-07-28): SSE/flag-off mirror of
              // the durable poll's identical fix above -- capture focus
              // synchronously right before the state update that may
              // unmount a focused check (poll-driven removal, no click on
              // THIS client), refocus the scene heading after.
              // `setGrounding`/`diffAndExplainResolvedChecks`/
              // `refocusSceneHeadIfStranded`/`checkWrapRef` are all
              // useSceneState's (TAV-PLAY-SHELL step 5 hook 6), arriving here
              // as plain handler params, same as the durable-poll branch
              // above -- deliberately not listed in this effect's own deps
              // array, same reasoning as that branch.
              const hadFocusInCheckWrap =
                handlers.checkWrapRef.current?.contains(document.activeElement) ?? false;
              handlers.setGrounding(g);
              handlers.diffAndExplainResolvedChecks(g);
              handlers.refocusSceneHeadIfStranded(hadFocusInCheckWrap);
            })
            .catch(() => {});
        }
        handlers.lastEventSeqRef.current = newOnes.reduce(
          (m, e) => Math.max(m, e.seq ?? 0),
          handlers.lastEventSeqRef.current,
        );
      } catch {
        // Poll errors are non-fatal — the next tick will retry.
      }
    };

    // Kage-CR A6 IMPORTANT-1: an effect-local interval id, not a ref --
    // nothing outside this effect's own closure ever read the old
    // diceRollPollIntervalRef (grep-confirmed), so a plain local is exactly
    // equivalent and correctly scopes the handle to the poll that owns it.
    const intervalId = setInterval(poll, POLL_INTERVAL_MS);
    return () => clearInterval(intervalId);
    // DDX-20 Pass 2: `handlers.subscribeToJob`/`handlers.appendLog`/
    // `handlers.clearStreamNarration` are listed (all `[]`-stable
    // useCallbacks on their owning hook, so this never resets the interval
    // in practice) — matches this effect's existing convention of NOT
    // listing the many plain imported functions it also calls
    // (getSessionEventsPage, eventToLogRow, scanXCardTracking,
    // reconcileDurableEvents, applyReconcileResult) since those aren't
    // component-scoped values ESLint tracks the same way.
    //
    // Phase 4: `handlers.applyOfferedCheckSignal` (used by `pollDurable`
    // above) is deliberately omitted too — it is useSceneState's (TAV-
    // PLAY-SHELL step 5 hook 6), arriving as a plain handler param, same
    // "stable, not worth listing" reasoning as `getGrounding`/
    // `handlers.diffAndExplainResolvedChecks`/
    // `handlers.refocusSceneHeadIfStranded` immediately above.
    //
    // NEVER add `handlers` itself to this array (Kage-CR A4 IMPORTANT-1):
    // page.tsx passes a fresh object literal every render, so `[handlers]`
    // tears down and re-arms the poll on every render and under streaming
    // re-render pressure the 4s interval never fires. List members only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, state, handlers.subscribeToJob, handlers.appendLog, handlers.clearStreamNarration]);
}
