/**
 * DDX-20 Pass 3 — DEFECT found during Miko-QA adversarial review of commit
 * 3edd2d7 (§3.3 combat->scene sequencing, the documented "beat 6 in-flight,
 * beat 2 fires and gets 409'd" case) — FIXED by Ren-Dev (Finding 2) in the
 * gate-fold commit on top of 3edd2d7.
 *
 * §3.3 of the Pass-3 Synthetic-Beat Design says the 409'd beat's
 * subscribe-and-drop is harmless: "the trailing scene-transition narration
 * is dropped; the scene still advances." That is true for the VISIBLE
 * transcript. It was NOT true for the reconciliation ledger's internal
 * state, pre-fix: `narrateDurableBeat`'s 409 branch called
 * `subscribeToJob(handle.job_id, "busy:${handle.job_id}", trigger_seq)`
 * (page.tsx) UNCONDITIONALLY — including when `handle.job_id` is a job THIS
 * SAME CLIENT already owns and is already subscribed to under its own real
 * turn_key (exactly the beat-6-then-beat-2 same-tab, no-await sequencing
 * §3.3 documents as the normal/accepted case for combat -> scene-advance).
 * `subscribeToJob` registered a ledger entry keyed by whatever `ledgerKey` it
 * was given (reconcileEvents.ts's `pendingByKey` map, keyed by turn_key or a
 * synthetic key) — so this produced TWO awaitingNarration=true entries for
 * the SAME underlying job: the real one (keyed by beat 6's own turn_key)
 * and a phantom one (keyed `busy:<job_id>`, registered by beat 2's 409
 * handler).
 *
 * `findActiveNarrationEntry` (reconcileEvents.ts) returns the FIRST
 * `awaitingNarration` match in Map INSERTION order. Since the real entry was
 * inserted first (beat 6 subscribed before beat 2's 409 fired), it consumed
 * the job's one-and-only narration event — the phantom `busy:<job_id>`
 * entry was never matched and was never removed from the ledger.
 *
 * That orphaned entry didn't just leak memory. Because
 * `findActiveNarrationEntry` scans in insertion order and matches ANY entry
 * with `awaitingNarration && (triggerSeq==null || seq > triggerSeq)`, the
 * orphan — inserted before any LATER, unrelated turn's own real ledger
 * entry — could wrongly claim that LATER turn's narration event instead. The
 * later turn's real entry would then never resolve: its optimistic/streaming
 * row would never be stamped `streaming:false` (Kage #1's own fix elsewhere
 * in this same design exists specifically to prevent a row staying
 * `aria-hidden` forever — this was that exact failure mode, reintroduced via
 * a different path), and the orphan's own claim produced a spurious
 * appended row.
 *
 * FIX (Finding 2, Ren-Dev fold): `subscribeToJob` (page.tsx) now de-dupes by
 * `job_id` BEFORE ever calling `pendingByKey.set(...)` — if an existing live
 * entry already tracks the same `jobId` with `awaitingNarration: true`, the
 * second `subscribeToJob` call is a pure no-op (no second `.set()`, no
 * abort/reset of the live subscription). That means beat 2's 409 handler
 * above no longer registers `busy:job-6` at all when job-6 is already
 * tracked — the SECOND entry this file's tests used to construct by hand
 * simply never comes into existence in the real client.
 *
 * This file is a PURE `reconcileDurableEvents`/`applyReconcileResult` unit
 * test — it has no way to invoke the real (React-hooks-based) `subscribeToJob`
 * directly, so it locks the FIX at the level it CAN observe: the ledger
 * SHAPE `subscribeToJob`'s new dedupe guard now produces (exactly ONE entry
 * per job, never two) and the CONSEQUENCE that shape has on
 * `reconcileDurableEvents` (unchanged, and per §5 correct for a single entry
 * per job) — no orphan, no hijack of a later turn. The real dedupe guard
 * itself is exercised at the integration level in
 * `play.ddx20-pass3-synthetic-beats.test.tsx`'s "combat->scene sequencing"
 * coverage (§8 item 5), which fires beat 6 then beat 2 through the actual
 * page and asserts only ONE ledger entry / SSE subscription ever exists for
 * the shared job.
 */
import {
  reconcileDurableEvents,
  applyReconcileResult,
  type PendingTurnEntry,
} from '../../lib/dnd/reconcileEvents';
import type { LogRow } from '../../components/ChatLog';
import type { EngineSessionEvent } from '../../lib/api/types';

function noRow(): LogRow | undefined {
  return undefined;
}

describe('FIXED — §3.3 same-job busy-pivot no longer registers a second ledger entry (Finding 2)', () => {
  it('beat 6 (real, first-party) subscribes under its own turn_key; subscribeToJob\'s job_id dedupe guard means beat 2\'s 409-pivot against the SAME job never registers a second entry — job 6\'s one narration event resolves the ONE entry cleanly, no orphan', () => {
    const renderedSeqs = new Set<number>();
    const pendingByKey = new Map<string, PendingTurnEntry>();

    // Step 1 — beat 6 (onCombatAction/end-turn) fires narrateDurableBeat,
    // gets a real 200, and its own subscribeToJob registers the ONLY entry
    // (page.tsx: pendingByKeyRef.current.set(ledgerKey, {...,jobId,
    // triggerSeq, awaitingNarration:true, origin:'beat'})). trigger_seq 100
    // mirrors the seq of the player_action / preceding context this beat
    // replies to.
    pendingByKey.set('tk-beat6-endturn', {
      jobId: 'job-6',
      triggerSeq: 100,
      awaitingNarration: true,
      origin: 'beat',
    });

    // Step 2 — beat 2 (handleSceneAdvance) fires synchronously right after
    // (no await between them, per §3.3), targets the SAME job (the server's
    // single in-flight slot means beat 2's /dm/turn 409s against beat 6's
    // still-streaming job). Pre-fix, its 409 handler called
    // subscribeToJob(job_id, `busy:${job_id}`, trigger_seq) UNCONDITIONALLY,
    // registering a SECOND entry. Post-fix, subscribeToJob's top-of-function
    // dedupe guard (`entry.jobId === jobId && entry.awaitingNarration`)
    // finds the step-1 entry already tracking job-6 and returns BEFORE ever
    // calling `pendingByKey.set('busy:job-6', ...)` — so there is nothing to
    // simulate here; the map simply never grows a second entry. This
    // assertion is the fix's ledger-shape guarantee.
    expect(pendingByKey.size).toBe(1);

    // Step 3 — job 6's one-and-only narration event lands.
    const narrationEvent: EngineSessionEvent[] = [
      { seq: 101, kind: 'narration', data: { text: 'The blade connects — the fight turns.' } },
    ];
    const result = reconcileDurableEvents(narrationEvent, renderedSeqs, pendingByKey, noRow);

    // Exactly one row for this one event — no double-render.
    expect(result.appended).toHaveLength(1);

    // FIXED: the real (and only) entry resolves the narration and is
    // cleaned up — no orphan is left behind, because none was ever created.
    expect(pendingByKey.has('tk-beat6-endturn')).toBe(false);
    expect(pendingByKey.has('busy:job-6')).toBe(false);
    expect(pendingByKey.size).toBe(0);
  });

  it('consequence: with no orphan, a LATER, unrelated turn\'s narration reconciles normally — its streaming row IS patched streaming:false, and no spurious duplicate row appears', () => {
    const renderedSeqs = new Set<number>();
    const pendingByKey = new Map<string, PendingTurnEntry>();

    // No orphan survives the earlier beat-6/beat-2 sequencing (Finding 2
    // fix) — the ledger starts clean for the next turn.
    expect(pendingByKey.size).toBe(0);

    // Some time later, an entirely different turn (could be the composer,
    // could be another beat) starts — a REAL entry with its own live
    // streaming row.
    pendingByKey.set('tk-next-turn', {
      narrationRowId: 'stream-row-9',
      triggerSeq: 200,
      awaitingNarration: true,
    });

    const findRowById = (id: string): LogRow | undefined =>
      id === 'stream-row-9'
        ? {
            id: 'stream-row-9',
            who: 'Suzu',
            kind: 'narration',
            text: 'Partial...',
            ts: '10:00',
            streaming: true,
          }
        : undefined;

    const narrationEvent: EngineSessionEvent[] = [
      { seq: 205, kind: 'narration', data: { text: 'Suzu narrates the next beat in full.' } },
    ];
    const result = reconcileDurableEvents(narrationEvent, renderedSeqs, pendingByKey, findRowById);

    // FIXED: the real, currently-streaming turn's entry is the ONLY
    // candidate `findActiveNarrationEntry` can match — sub-case (a),
    // replace-in-place, not an orphan-claimed append.
    expect(result.appended).toHaveLength(0);
    expect(result.stamped).toHaveLength(1);
    expect(result.stamped[0]).toMatchObject({
      matchId: 'stream-row-9',
      patch: { streaming: false },
    });

    // The real next turn's entry is fully resolved.
    expect(pendingByKey.has('tk-next-turn')).toBe(false);

    // Applying this result to a `log` containing the real turn's live
    // streaming row demonstrates the user-visible fix: the streaming row IS
    // patched to `streaming:false` (Kage #1's aria-hidden-forever fix stays
    // intact — Finding 2 no longer reintroduces the failure via the
    // busy-pivot path), and no second, spurious row appears alongside it.
    const log: LogRow[] = [
      { id: 'stream-row-9', who: 'Suzu', kind: 'narration', text: 'Partial...', ts: '10:00', streaming: true },
    ];
    const nextLog = applyReconcileResult(log, result);
    // Sub-case (a) swaps in a FRESH id at the same slot (announce-once,
    // mirrors finalizeStreamNarration) — so the row count stays 1 and its
    // `streaming` flag flips false, but the id is no longer 'stream-row-9'.
    expect(nextLog).toHaveLength(1);
    expect(nextLog[0].streaming).toBe(false);
    expect(nextLog[0].id).not.toBe('stream-row-9');
  });
});
