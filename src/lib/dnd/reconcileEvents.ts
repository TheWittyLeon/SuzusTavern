/**
 * DDX-20 — poll-ingest reconciliation ledger (§3.2 of "DDX-20 — Tavern Client
 * Integration Design"). Pure function, no React/DOM — unit-testable without
 * rendering the play page.
 *
 * Flag-ON only (DURABLE_GENERATION_ENABLED). The flag-OFF poll never calls
 * this module — see page.tsx's dice-roll/events poll, which branches BEFORE
 * this code is reached.
 *
 * The ledger closes the id-vs-seq keying gap: an originating client already
 * optimistically appended a player row (id `r${n}`) and/or a streaming
 * narration row before the durable event for that same beat lands on the
 * poll (id `ev${seq}`). Naive concatenation would double-render. Two pieces
 * of caller-owned state drive the rules below (kept in page.tsx as refs —
 * `renderedSeqsRef`/`pendingByKeyRef` — and passed in here by reference so
 * this module can mutate them in place, poll-tick after poll-tick):
 *
 *   renderedSeqs: every durable `seq` already reflected in the log (belt and
 *     suspenders against re-observation across overlapping poll pages).
 *   pendingByKey: turn_key (or dm_narration's client_key) -> the in-flight
 *     optimistic row ids this client is waiting to reconcile.
 *
 * Rules (verbatim from the design doc):
 *   1. seq already in renderedSeqs -> skip.
 *   2. player_action: match `data.turn_key` in pendingByKey -> STAMP seq onto
 *      the existing row (id unchanged). No match -> APPEND (reload / another
 *      client's turn).
 *   3. narration/recap: match the active turn AWAITING narration (see
 *      `awaitingNarration` below) whose triggerSeq this seq completes ->
 *      three sub-cases: (a) a live SSE-created row is still `streaming` ->
 *      REPLACE it with the durable row (fresh id — announce-once, mirrors
 *      finalizeStreamNarration's own pattern); (b) the SSE-created row is
 *      already finalized (SSE delivered [DONE] first) -> just stamp seq;
 *      (c) NO SSE-created row exists yet (Kage #3 — the poll's own tick beat
 *      the subscriber's first SSE chunk to this reconciliation) -> APPEND the
 *      durable row normally and CLAIM the entry's narrationRowId with the
 *      newly-appended row's id, so a later-arriving SSE chunk (page.tsx
 *      subscribeToJob) can detect the claim and become a no-op instead of
 *      creating a duplicate row. No match -> APPEND (reload / another
 *      client's turn nobody here is watching).
 *   4. dm_narration: match `data.client_key` in pendingByKey exactly like
 *      player_action (same map/rules) -> STAMP or APPEND.
 *   5. Everything else (dice_roll/x_card/scene_advance/check_resolved/system
 *      kinds/etc.) -> APPEND unconditionally, same as today's poll.
 *   6. Caller advances its seq watermark to `maxSeqSeen` (or the response's
 *      own `max_seq`, whichever the caller prefers — both are exposed).
 */
import type { EngineSessionEvent } from '@/lib/api/types';
import type { LogRow } from '@/components/ChatLog';
import { eventToLogRow } from '@/lib/rehydration';

/** One in-flight optimistic turn's row ids, keyed by turn_key (or a human-DM
 *  beat's client_key — same map, same shape, see rule 4). */
export interface PendingTurnEntry {
  playerRowId?: string;
  narrationRowId?: string;
  /** The player_action seq this beat's narration replies to (§3.2 rule 3). */
  triggerSeq?: number;
  /**
   * DDX-20 Pass 3 Finding 2 (Kage-CR / Miko-QA) — the underlying durable
   * job_id this entry tracks. Not read by this pure reconcile module (the
   * rules above key entirely off turn_key/client_key + seq); it exists so
   * page.tsx's `subscribeToJob` can de-dupe a same-job subscribe (e.g. a
   * synthetic beat's 409-busy-pivot targeting a job THIS SAME CLIENT already
   * subscribed to under a different ledgerKey) BEFORE it ever registers a
   * second `awaitingNarration` entry for one job — the exact defect
   * `reconcileEvents.pass3-busy-pivot-orphan.test.ts` locks. See that file's
   * module doc for the full orphan/hijack mechanism this prevents.
   */
  jobId?: string;
  /**
   * DDX-20 Pass 3 Finding 1 — which call path originated this job:
   * 'composer' (onSend/narrateDurable, has a retry affordance) or 'beat'
   * (the six synthetic-beat call sites via narrateDurableBeat — §3.1 "beats
   * have no retry affordance"). Not read by this pure reconcile module;
   * page.tsx's subscribeToJob uses it to decide whether an SSE-tail `error`
   * may surface the shared composer Retry banner (composer) or must drop
   * silently (beat — surfacing it would replay through narrateDurable, which
   * has no mechanics/suppress_intent parameters, silently dropping both).
   */
  origin?: 'composer' | 'beat';
  /**
   * Kage #3 — true once a subscriber (the originating client's own SSE tail,
   * a 409-busy pivot's subscribe, or the poll's stateless resume-discovery
   * subscribe) has registered INTENT to receive this turn's narration.
   * Set SYNCHRONOUSLY by page.tsx's subscribeToJob before any await — this
   * is what closes the race where the durable narration event could land on
   * a poll tick before the SSE tail's first chunk has had a chance to run
   * and set `narrationRowId`. Rule 3 matches on THIS flag, not on
   * `narrationRowId` — a match with `narrationRowId` still unset is exactly
   * the race case (see rule 3's sub-case (c) above).
   */
  awaitingNarration?: boolean;
}

export interface StampInstruction {
  /** The CURRENT id of the row to patch (find-by-id; id may change via the patch). */
  matchId: string;
  /** Shallow-merged onto the matched row. May include a new `id` (rule 3's replace case). */
  patch: Partial<LogRow>;
}

export interface ReconcileResult {
  /** New durable rows to append, already in ascending-seq order. */
  appended: LogRow[];
  /** Existing optimistic rows to stamp/replace in place. */
  stamped: StampInstruction[];
  /** Highest seq observed this call (0 if `newEvents` was empty). */
  maxSeqSeen: number;
}

/**
 * Reconcile one poll page's new events against the ledger. Mutates
 * `renderedSeqs` and `pendingByKey` in place; returns what the caller should
 * apply to its `log` state. `findRowById` lets rule 3 tell a still-streaming
 * row apart from an already-finalized one — the pure function has no view of
 * current `log` state otherwise.
 */
export function reconcileDurableEvents(
  newEvents: EngineSessionEvent[],
  renderedSeqs: Set<number>,
  pendingByKey: Map<string, PendingTurnEntry>,
  findRowById: (id: string) => LogRow | undefined,
): ReconcileResult {
  const appended: LogRow[] = [];
  const stamped: StampInstruction[] = [];
  let maxSeqSeen = 0;

  const sorted = [...newEvents].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));

  for (const e of sorted) {
    const seq = e.seq ?? 0;
    if (seq > maxSeqSeen) maxSeqSeen = seq;
    if (renderedSeqs.has(seq)) continue; // rule 1

    if (e.kind === 'player_action') {
      const turnKey = (e.data?.['turn_key'] as string | undefined) || undefined;
      const entry = turnKey ? pendingByKey.get(turnKey) : undefined;
      if (entry?.playerRowId) {
        stamped.push({ matchId: entry.playerRowId, patch: { seq } });
        renderedSeqs.add(seq);
        entry.playerRowId = undefined;
        if (turnKey && !entry.narrationRowId) pendingByKey.delete(turnKey);
      } else {
        appendIfRow(appended, e);
        renderedSeqs.add(seq);
      }
      continue;
    }

    if (e.kind === 'narration' || e.kind === 'recap') {
      const match = findActiveNarrationEntry(pendingByKey, seq);
      if (match) {
        const [key, entry] = match;
        const existing = entry.narrationRowId ? findRowById(entry.narrationRowId) : undefined;
        const durableRow = eventToLogRow(e);
        if (entry.narrationRowId && existing?.streaming && durableRow) {
          // Sub-case (a): a live SSE-created row is still streaming — replace
          // it with the durable row's OWN fresh id (announce-once) — mirrors
          // finalizeStreamNarration's pattern of swapping the id at the same
          // array slot to force a remount.
          // Kage #1: `durableRow` (from eventToLogRow) never carries a
          // `streaming` key, and applyReconcileResult SHALLOW-MERGES the
          // patch onto the existing row — without an explicit
          // `streaming: false` here, the merged row keeps the OLD row's
          // `streaming: true`, so ChatLog renders it aria-hidden forever and
          // the finalized narration is never announced to screen readers.
          stamped.push({ matchId: entry.narrationRowId, patch: { ...durableRow, streaming: false } });
        } else if (entry.narrationRowId) {
          // Sub-case (b): already finalized (SSE delivered [DONE] first) —
          // just stamp seq, keep the existing id/text untouched.
          stamped.push({ matchId: entry.narrationRowId, patch: { seq } });
        } else if (durableRow) {
          // Sub-case (c), Kage #3 — the poll beat the subscriber's first SSE
          // chunk here: no row exists to replace/stamp yet. Append the
          // durable row normally, and CLAIM the entry's narrationRowId with
          // its id so a later-arriving SSE chunk (subscribeToJob, page.tsx)
          // recognises the poll already rendered this beat and skips
          // creating a duplicate row instead of racing a second one in.
          appended.push(durableRow);
          entry.narrationRowId = durableRow.id;
        }
        renderedSeqs.add(seq);
        entry.awaitingNarration = false;
        if (!entry.playerRowId) pendingByKey.delete(key);
      } else {
        appendIfRow(appended, e);
        renderedSeqs.add(seq);
      }
      continue;
    }

    if (e.kind === 'dm_narration') {
      const clientKey = (e.data?.['client_key'] as string | undefined) || undefined;
      const entry = clientKey ? pendingByKey.get(clientKey) : undefined;
      if (entry?.playerRowId) {
        stamped.push({ matchId: entry.playerRowId, patch: { seq } });
        renderedSeqs.add(seq);
        entry.playerRowId = undefined;
        if (clientKey && !entry.narrationRowId) pendingByKey.delete(clientKey);
      } else {
        appendIfRow(appended, e);
        renderedSeqs.add(seq);
      }
      continue;
    }

    // Rule 5 — dice_roll / x_card / scene_advance / check_resolved / system
    // kinds / anything eventToLogRow already handles: unchanged from today.
    appendIfRow(appended, e);
    renderedSeqs.add(seq);
  }

  return { appended, stamped, maxSeqSeen };
}

function appendIfRow(appended: LogRow[], e: EngineSessionEvent): void {
  const row = eventToLogRow(e);
  if (row) appended.push(row);
}

/** Find the first pending entry with an active narration wait whose trigger
 *  this seq completes (no triggerSeq recorded = match unconditionally, a
 *  defensive fallback that should not occur in practice).
 *
 *  Kage #3 — matches on `awaitingNarration` (registered synchronously by the
 *  subscriber BEFORE any await), NOT on `narrationRowId` (only set once the
 *  SSE tail's first chunk actually lands). Matching on `narrationRowId`
 *  would miss the race where the poll's own reconciliation tick observes the
 *  durable narration event before the subscriber's first SSE byte arrives —
 *  see rule 3 sub-case (c) in the module doc above. */
function findActiveNarrationEntry(
  pendingByKey: Map<string, PendingTurnEntry>,
  seq: number,
): [string, PendingTurnEntry] | undefined {
  for (const [key, entry] of pendingByKey) {
    if (entry.awaitingNarration && (entry.triggerSeq == null || seq > entry.triggerSeq)) {
      return [key, entry];
    }
  }
  return undefined;
}

/** Apply a ReconcileResult to a `log` array (pure — callers use this inside a
 *  `setLog(prev => applyReconcileResult(prev, result))` functional update). */
export function applyReconcileResult(prev: LogRow[], result: ReconcileResult): LogRow[] {
  if (result.stamped.length === 0 && result.appended.length === 0) return prev;
  let next = prev;
  for (const { matchId, patch } of result.stamped) {
    const idx = next.findIndex((r) => r.id === matchId);
    if (idx === -1) continue;
    if (next === prev) next = [...prev];
    next[idx] = { ...next[idx], ...patch };
  }
  return result.appended.length > 0 ? [...next, ...result.appended] : next;
}
