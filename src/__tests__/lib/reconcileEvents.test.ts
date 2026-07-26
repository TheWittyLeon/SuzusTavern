/**
 * DDX-20 §3.2 — reconciliation ledger unit tests (the core dedup test target
 * per the Client Integration Design's Testing Strategy §8). Pure-function
 * coverage, no React/DOM — directly exercises the rules the flag-ON poll
 * relies on.
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

describe('reconcileDurableEvents — rule 1 (already rendered)', () => {
  it('skips a seq already present in renderedSeqs', () => {
    const renderedSeqs = new Set<number>([5]);
    const pendingByKey = new Map<string, PendingTurnEntry>();
    const events: EngineSessionEvent[] = [
      { seq: 5, kind: 'dice_roll', data: { description: 'Rolled 5.' } },
    ];
    const result = reconcileDurableEvents(events, renderedSeqs, pendingByKey, noRow);
    expect(result.appended).toHaveLength(0);
    expect(result.stamped).toHaveLength(0);
    expect(result.maxSeqSeen).toBe(5);
  });
});

describe('reconcileDurableEvents — rule 2 (player_action)', () => {
  it('originating client: stamps seq onto the existing optimistic row instead of appending', () => {
    const renderedSeqs = new Set<number>();
    const pendingByKey = new Map<string, PendingTurnEntry>([
      ['tk-1', { playerRowId: 'r1', narrationRowId: 'r2', triggerSeq: undefined }],
    ]);
    const events: EngineSessionEvent[] = [
      {
        seq: 100,
        kind: 'player_action',
        actor: 'leon',
        data: { who: 'leon', text: 'I open the door.', turn_key: 'tk-1' },
      },
    ];
    const result = reconcileDurableEvents(events, renderedSeqs, pendingByKey, noRow);
    expect(result.appended).toHaveLength(0);
    expect(result.stamped).toEqual([{ matchId: 'r1', patch: { seq: 100 } }]);
    expect(renderedSeqs.has(100)).toBe(true);
    // playerRowId cleared but the entry survives (narrationRowId still pending)
    expect(pendingByKey.get('tk-1')?.playerRowId).toBeUndefined();
    expect(pendingByKey.get('tk-1')?.narrationRowId).toBe('r2');
  });

  it('reload / another client: no ledger match -> appends the durable row', () => {
    const renderedSeqs = new Set<number>();
    const pendingByKey = new Map<string, PendingTurnEntry>();
    const events: EngineSessionEvent[] = [
      {
        seq: 200,
        kind: 'player_action',
        actor: 'leon',
        data: { who: 'leon', text: 'I look around.', turn_key: 'tk-unknown' },
      },
    ];
    const result = reconcileDurableEvents(events, renderedSeqs, pendingByKey, noRow);
    expect(result.stamped).toHaveLength(0);
    expect(result.appended).toHaveLength(1);
    expect(result.appended[0]).toMatchObject({ id: 'ev200', text: 'I look around.', seq: 200 });
  });

  it('deletes the ledger entry once both playerRowId and narrationRowId are cleared', () => {
    const renderedSeqs = new Set<number>();
    const pendingByKey = new Map<string, PendingTurnEntry>([
      ['tk-solo', { playerRowId: 'r1' }], // no narrationRowId pending
    ]);
    const events: EngineSessionEvent[] = [
      { seq: 1, kind: 'player_action', data: { who: 'leon', text: 'hi', turn_key: 'tk-solo' } },
    ];
    reconcileDurableEvents(events, renderedSeqs, pendingByKey, noRow);
    expect(pendingByKey.has('tk-solo')).toBe(false);
  });
});

describe('reconcileDurableEvents — rule 3 (narration)', () => {
  it('streaming row still growing: replaces it with the durable row (fresh id, announce-once)', () => {
    const renderedSeqs = new Set<number>();
    const pendingByKey = new Map<string, PendingTurnEntry>([
      ['tk-1', { narrationRowId: 'r7', triggerSeq: 100, awaitingNarration: true }],
    ]);
    const streamingRow: LogRow = {
      id: 'r7',
      who: 'Suzu',
      kind: 'narration',
      text: 'The door cre',
      ts: '10:00',
      streaming: true,
    };
    const events: EngineSessionEvent[] = [
      { seq: 101, kind: 'narration', data: { text: 'The door creaks open.' } },
    ];
    const result = reconcileDurableEvents(
      events,
      renderedSeqs,
      pendingByKey,
      (id) => (id === 'r7' ? streamingRow : undefined),
    );
    expect(result.stamped).toHaveLength(1);
    expect(result.stamped[0].matchId).toBe('r7');
    // Replaced with the durable row's own fields — fresh id, non-streaming, seq stamped.
    expect(result.stamped[0].patch).toMatchObject({
      id: 'ev101',
      text: 'The door creaks open.',
      seq: 101,
    });
    // Kage #1 (a11y regression): the patch MUST explicitly carry
    // `streaming: false` — applyReconcileResult SHALLOW-MERGES the patch
    // onto the existing row, so omitting this key would let the OLD row's
    // `streaming: true` survive the merge, leaving ChatLog rendering the
    // finalized narration `aria-hidden` forever (never announced).
    expect(result.stamped[0].patch.streaming).toBe(false);
    expect(pendingByKey.has('tk-1')).toBe(false);

    // Prove it end-to-end through the actual merge, not just the patch shape:
    // the row is aria-hidden (streaming:true) BEFORE reconciliation and MUST
    // NOT be after applyReconcileResult runs the merge.
    const merged = applyReconcileResult([streamingRow], result);
    const mergedRow = merged.find((r) => r.id === 'ev101');
    expect(mergedRow?.streaming).toBe(false);
  });

  it('already-finalized row (SSE delivered [DONE] first): just stamps seq, id/text untouched', () => {
    const renderedSeqs = new Set<number>();
    const pendingByKey = new Map<string, PendingTurnEntry>([
      ['tk-1', { narrationRowId: 'r7', triggerSeq: 100, awaitingNarration: true }],
    ]);
    const finalizedRow: LogRow = {
      id: 'r9', // finalizeStreamNarration already swapped the id
      who: 'Suzu',
      kind: 'narration',
      text: 'The door creaks open.',
      ts: '10:00',
      streaming: false,
    };
    const events: EngineSessionEvent[] = [
      { seq: 101, kind: 'narration', data: { text: 'The door creaks open.' } },
    ];
    const result = reconcileDurableEvents(
      events,
      renderedSeqs,
      pendingByKey,
      (id) => (id === 'r7' ? finalizedRow : undefined),
    );
    expect(result.stamped).toEqual([{ matchId: 'r7', patch: { seq: 101 } }]);
  });

  it('trigger_seq gate: does not match a narration entry whose triggerSeq >= this seq', () => {
    const renderedSeqs = new Set<number>();
    const pendingByKey = new Map<string, PendingTurnEntry>([
      ['tk-1', { narrationRowId: 'r7', triggerSeq: 500, awaitingNarration: true }],
    ]);
    const events: EngineSessionEvent[] = [
      { seq: 101, kind: 'narration', data: { text: 'Unrelated recap prose.' } },
    ];
    const result = reconcileDurableEvents(events, renderedSeqs, pendingByKey, noRow);
    // 101 is not > 500, so no match -> append instead of stamp.
    expect(result.stamped).toHaveLength(0);
    expect(result.appended).toHaveLength(1);
  });

  it('DDX-20 F9+Recap Design §3.4 — a durable recap event NEVER matches an active narration entry (ENGINE-RECAP-ALLOWLIST safety guard)', () => {
    // This test used to encode the opposite as intended behaviour ("recap
    // kind uses the same matching rule as narration") — that was the bug.
    // Recap never creates a durable job (SessionRecap.tsx's request is a
    // legacy streamDmNarration call), so it can never legitimately own a
    // pendingByKey entry; the only thing rule 3 could do with a recap event
    // is hijack an UNRELATED in-flight turn's entry (steal its ledger slot,
    // strand its streaming row aria-hidden forever). Rule 3 is narrowed to
    // 'narration' only — a recap event now falls to rule 5, where
    // eventToLogRow(recap) -> null makes it a complete no-op.
    const renderedSeqs = new Set<number>();
    const pendingByKey = new Map<string, PendingTurnEntry>([
      ['tk-1', { narrationRowId: 'r7', triggerSeq: 10, awaitingNarration: true }],
    ]);
    const events: EngineSessionEvent[] = [
      { seq: 11, kind: 'recap', data: { text: 'Previously on…' } },
    ];
    const result = reconcileDurableEvents(events, renderedSeqs, pendingByKey, noRow);
    // No stamp, no append — a recap event can never match rule 3 or produce
    // a row (rule 5's eventToLogRow(recap) -> null).
    expect(result.stamped).toHaveLength(0);
    expect(result.appended).toHaveLength(0);
    // The entry is completely untouched: it survives, still awaiting the
    // REAL narration for turn tk-1 — a recap landing mid-turn must not be
    // able to delete or resolve someone else's ledger entry.
    expect(pendingByKey.has('tk-1')).toBe(true);
    expect(pendingByKey.get('tk-1')?.awaitingNarration).toBe(true);
    expect(pendingByKey.get('tk-1')?.narrationRowId).toBe('r7');
    // The seq is still marked processed (rule 5's ledger discipline applies
    // even to a null-mapped kind — same treatment as opening_narrated/
    // rebind/session_start), so a later duplicate poll of the SAME recap
    // event can't re-process it either.
    expect(renderedSeqs.has(11)).toBe(true);
  });

  it('an entry not yet marked awaitingNarration never matches (registration-required invariant)', () => {
    const renderedSeqs = new Set<number>();
    // narrationRowId is even set here — proves matching is driven by
    // awaitingNarration, not narrationRowId's mere presence.
    const pendingByKey = new Map<string, PendingTurnEntry>([
      ['tk-1', { narrationRowId: 'r7', triggerSeq: 10 }],
    ]);
    const events: EngineSessionEvent[] = [
      { seq: 11, kind: 'narration', data: { text: 'Unregistered.' } },
    ];
    const result = reconcileDurableEvents(events, renderedSeqs, pendingByKey, noRow);
    expect(result.stamped).toHaveLength(0);
    expect(result.appended).toHaveLength(1);
  });

  it('Kage #3 — the poll observes the narration BEFORE the subscriber registered any row (no narrationRowId yet): appends the durable row and CLAIMS narrationRowId so a late SSE chunk can detect it', () => {
    const renderedSeqs = new Set<number>();
    // awaitingNarration registered synchronously by subscribeToJob BEFORE its
    // first SSE chunk arrived — narrationRowId is still unset.
    const pendingByKey = new Map<string, PendingTurnEntry>([
      ['tk-1', { triggerSeq: 100, awaitingNarration: true }],
    ]);
    const events: EngineSessionEvent[] = [
      { seq: 101, kind: 'narration', data: { text: 'The door creaks open.' } },
    ];
    const result = reconcileDurableEvents(events, renderedSeqs, pendingByKey, noRow);

    // No row existed to stamp/replace — the durable row is APPENDED instead.
    expect(result.stamped).toHaveLength(0);
    expect(result.appended).toHaveLength(1);
    expect(result.appended[0]).toMatchObject({ id: 'ev101', text: 'The door creaks open.' });

    // The entry is fully resolved (both playerRowId and narrationRowId
    // absent/cleared going in) — deleted, same as the normal-path outcome.
    expect(pendingByKey.has('tk-1')).toBe(false);
  });

  it('TAV-NARRATION-DECOUPLE Phase 2 — a pre-created EMPTY anchor (narrationRowId set before any chunk landed) still takes sub-case (a) REPLACE, not append — the exact mechanism page.tsx\'s subscribeToJob precreate relies on to turn the poll-claim race\'s pop-in (sub-case c) into a stream (sub-case a)', () => {
    const renderedSeqs = new Set<number>();
    // This is the literal precreate shape: `upsertStreamNarration('')` sets
    // streaming:true with EMPTY text, and narrationRowId is claimed
    // SYNCHRONOUSLY at job-start — before the SSE tail's first chunk (if
    // any) has even had a chance to arrive.
    const pendingByKey = new Map<string, PendingTurnEntry>([
      ['tk-precreate', { narrationRowId: 'r-anchor', triggerSeq: undefined, awaitingNarration: true }],
    ]);
    const anchorRow: LogRow = {
      id: 'r-anchor',
      who: 'Suzu',
      kind: 'narration',
      text: '',
      ts: '10:00',
      streaming: true,
    };
    const events: EngineSessionEvent[] = [
      { seq: 300, kind: 'narration', data: { text: 'The door creaks open.' } },
    ];
    const result = reconcileDurableEvents(
      events,
      renderedSeqs,
      pendingByKey,
      (id) => (id === 'r-anchor' ? anchorRow : undefined),
    );

    // Sub-case (a): REPLACE the anchor in place — NOT the sibling "Kage #3"
    // test's sub-case (c) APPEND outcome (compare the `appended`/`stamped`
    // shapes directly against that test above: no narrationRowId pre-set
    // there -> appended; narrationRowId pre-set here, even to an EMPTY
    // anchor -> stamped/replaced). This is the non-vacuous proof that
    // precreate is what flips the poll-claim race from pop-in to stream.
    expect(result.appended).toHaveLength(0);
    expect(result.stamped).toHaveLength(1);
    expect(result.stamped[0].matchId).toBe('r-anchor');
    expect(result.stamped[0].patch).toMatchObject({
      id: 'ev300',
      text: 'The door creaks open.',
      streaming: false,
    });

    // End-to-end through the merge: the anchor's id/text/streaming flip in
    // the SAME array slot (a real remount, not an in-place mutation of an
    // aria-hidden node) — the announce-once contract holds even though the
    // row started life completely empty.
    const merged = applyReconcileResult([anchorRow], result);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ id: 'ev300', text: 'The door creaks open.', streaming: false });
  });

  it('Kage #3 — the claimed entry survives when playerRowId is still pending (rare ordering edge)', () => {
    const renderedSeqs = new Set<number>();
    const pendingByKey = new Map<string, PendingTurnEntry>([
      ['tk-1', { playerRowId: 'r3', triggerSeq: 100, awaitingNarration: true }],
    ]);
    const events: EngineSessionEvent[] = [
      { seq: 101, kind: 'narration', data: { text: 'The door creaks open.' } },
    ];
    const result = reconcileDurableEvents(events, renderedSeqs, pendingByKey, noRow);

    expect(result.appended).toHaveLength(1);
    // Entry survives (playerRowId still pending) but now carries the CLAIM —
    // a late SSE chunk's lookup would see narrationRowId already set.
    const entry = pendingByKey.get('tk-1');
    expect(entry).toBeDefined();
    expect(entry?.narrationRowId).toBe('ev101');
    expect(entry?.awaitingNarration).toBe(false);
  });
});

describe('reconcileDurableEvents — Pass-3 synthetic beats (turn_key entry with NO playerRowId)', () => {
  it('appends the durable player_action exactly once and reconciles the narration (rule-2 else + rule-3) — locks Pass-3 Synthetic-Beat Design §5\'s zero-reconcile-change guarantee', () => {
    const renderedSeqs = new Set<number>();
    const pendingByKey = new Map<string, PendingTurnEntry>([
      // narrateDurableBeat registers exactly this shape: no playerRowId (§2
      // player-row policy — the beat keeps its own client-only system row
      // instead), awaitingNarration set synchronously by subscribeToJob.
      ['tk-beat-1', { triggerSeq: 100, awaitingNarration: true }],
    ]);

    // player_action lands first (lower seq) — rule 2's else-branch, since
    // entry.playerRowId is falsy.
    const playerActionEvent: EngineSessionEvent[] = [
      {
        seq: 101,
        kind: 'player_action',
        actor: 'leon',
        data: { who: 'leon', text: 'I roll Perception.', turn_key: 'tk-beat-1' },
      },
    ];
    const firstResult = reconcileDurableEvents(playerActionEvent, renderedSeqs, pendingByKey, noRow);

    // Appended exactly once — never stamped (there is no optimistic row to
    // stamp onto for a synthetic beat).
    expect(firstResult.stamped).toHaveLength(0);
    expect(firstResult.appended).toHaveLength(1);
    expect(firstResult.appended[0]).toMatchObject({
      id: 'ev101',
      text: 'I roll Perception.',
      seq: 101,
    });
    expect(renderedSeqs.has(101)).toBe(true);
    // The entry survives — narration for this beat hasn't landed yet.
    expect(pendingByKey.has('tk-beat-1')).toBe(true);
    expect(pendingByKey.get('tk-beat-1')?.playerRowId).toBeUndefined();

    // narration lands next (higher seq) — rule 3, sub-case (c): no
    // narrationRowId exists yet (no live SSE row raced ahead of the poll),
    // so it's appended and the entry is cleaned up (no playerRowId left to
    // wait for either).
    const narrationEvent: EngineSessionEvent[] = [
      { seq: 102, kind: 'narration', data: { text: 'You spot movement in the brush.' } },
    ];
    const secondResult = reconcileDurableEvents(narrationEvent, renderedSeqs, pendingByKey, noRow);

    expect(secondResult.stamped).toHaveLength(0);
    expect(secondResult.appended).toHaveLength(1);
    expect(secondResult.appended[0]).toMatchObject({
      id: 'ev102',
      text: 'You spot movement in the brush.',
      seq: 102,
    });
    expect(renderedSeqs.has(102)).toBe(true);
    // Ledger entry fully cleaned up — exactly one player row, exactly one
    // narration row, no dangling reconcile state.
    expect(pendingByKey.has('tk-beat-1')).toBe(false);
  });

  it('Kage-CR low suggestion (companion lock) — mirrors the ACTUAL real beat entry shape: narrateDurableBeat registers `{}` (no triggerSeq at all — it is only added later, synchronously, by subscribeToJob) — a 200-path beat with no busy-pivot never learns a trigger_seq, so triggerSeq is undefined, not a concrete number', () => {
    const renderedSeqs = new Set<number>();
    const pendingByKey = new Map<string, PendingTurnEntry>([
      // subscribeToJob(handle.job_id, turnKey, undefined, 'beat') — the
      // 200-path call narrateDurableBeat makes — passes triggerSeq as
      // literally `undefined` (no busy handle to read a trigger_seq off
      // of). findActiveNarrationEntry treats an undefined triggerSeq as
      // "match unconditionally" (seq > triggerSeq only gates when a
      // concrete number is present) — this locks that this is still the
      // correct outcome for the real (undefined) shape, not just the
      // synthetic triggerSeq:100 the sibling test above uses.
      ['tk-beat-2', { jobId: 'job-42', triggerSeq: undefined, awaitingNarration: true, origin: 'beat' }],
    ]);

    const playerActionEvent: EngineSessionEvent[] = [
      {
        seq: 201,
        kind: 'player_action',
        actor: 'leon',
        data: { who: 'leon', text: 'The scene changes.', turn_key: 'tk-beat-2' },
      },
    ];
    const firstResult = reconcileDurableEvents(playerActionEvent, renderedSeqs, pendingByKey, noRow);
    expect(firstResult.appended).toHaveLength(1);
    expect(pendingByKey.has('tk-beat-2')).toBe(true);

    const narrationEvent: EngineSessionEvent[] = [
      { seq: 202, kind: 'narration', data: { text: 'The room dims as the scene turns.' } },
    ];
    const secondResult = reconcileDurableEvents(narrationEvent, renderedSeqs, pendingByKey, noRow);
    expect(secondResult.appended).toHaveLength(1);
    expect(pendingByKey.has('tk-beat-2')).toBe(false);
  });
});

describe('reconcileDurableEvents — rule 4 (dm_narration client_key)', () => {
  it('matches by data.client_key exactly like player_action', () => {
    const renderedSeqs = new Set<number>();
    const pendingByKey = new Map<string, PendingTurnEntry>([
      ['ck-1', { playerRowId: 'r3' }],
    ]);
    const events: EngineSessionEvent[] = [
      {
        seq: 55,
        kind: 'dm_narration',
        actor: 'suzu_dm',
        data: { text: 'The torches flicker.', client_key: 'ck-1' },
      },
    ];
    const result = reconcileDurableEvents(events, renderedSeqs, pendingByKey, noRow);
    expect(result.stamped).toEqual([{ matchId: 'r3', patch: { seq: 55 } }]);
    expect(result.appended).toHaveLength(0);
  });

  it('no client_key match -> appends', () => {
    const renderedSeqs = new Set<number>();
    const pendingByKey = new Map<string, PendingTurnEntry>();
    const events: EngineSessionEvent[] = [
      { seq: 56, kind: 'dm_narration', actor: 'suzu_dm', data: { text: 'A ruling.' } },
    ];
    const result = reconcileDurableEvents(events, renderedSeqs, pendingByKey, noRow);
    expect(result.appended).toHaveLength(1);
  });
});

describe('reconcileDurableEvents — rule 5 (unchanged system kinds)', () => {
  it('dice_roll / x_card / scene_advance always append, ledger untouched', () => {
    const renderedSeqs = new Set<number>();
    const pendingByKey = new Map<string, PendingTurnEntry>();
    const events: EngineSessionEvent[] = [
      { seq: 1, kind: 'dice_roll', actor: 'leon', data: { description: 'Rolled 12.' } },
      { seq: 2, kind: 'x_card', actor: 'leon' },
      { seq: 3, kind: 'scene_advance', data: { description: 'Scene shifts.' } },
    ];
    const result = reconcileDurableEvents(events, renderedSeqs, pendingByKey, noRow);
    expect(result.appended).toHaveLength(3);
    expect(pendingByKey.size).toBe(0);
  });
});

describe('reconcileDurableEvents — reload reconstruction', () => {
  it('empty pendingByKey: a full history page rebuilds the transcript in seq order via appends only', () => {
    const renderedSeqs = new Set<number>();
    const pendingByKey = new Map<string, PendingTurnEntry>();
    const events: EngineSessionEvent[] = [
      { seq: 3, kind: 'narration', data: { text: 'third' } },
      { seq: 1, kind: 'player_action', data: { who: 'leon', text: 'first', turn_key: 'tk-x' } },
      { seq: 2, kind: 'dice_roll', data: { description: 'second' } },
    ];
    const result = reconcileDurableEvents(events, renderedSeqs, pendingByKey, noRow);
    expect(result.appended.map((r) => r.id)).toEqual(['ev1', 'ev2', 'ev3']);
    expect(result.appended[0].text).toBe('first');
    expect(result.appended[2].text).toBe('third');
    expect(result.stamped).toHaveLength(0);
    expect(result.maxSeqSeen).toBe(3);
  });
});

describe('applyReconcileResult', () => {
  it('returns the same array reference when there is nothing to do (no-op guard)', () => {
    const prev: LogRow[] = [{ id: 'r1', who: 'leon', kind: 'player', text: 'hi', ts: '10:00' }];
    const next = applyReconcileResult(prev, { appended: [], stamped: [], maxSeqSeen: 0 });
    expect(next).toBe(prev);
  });

  it('stamps in place (same array position, patch merged) and appends new rows at the end', () => {
    const prev: LogRow[] = [
      { id: 'r1', who: 'leon', kind: 'player', text: 'hi', ts: '10:00' },
      { id: 'r2', who: 'Suzu', kind: 'narration', text: '...', ts: '10:00', streaming: true },
    ];
    const next = applyReconcileResult(prev, {
      appended: [{ id: 'ev5', who: 'Suzu', kind: 'roll', text: 'd20', ts: '10:01', seq: 5 }],
      stamped: [{ matchId: 'r1', patch: { seq: 3 } }],
      maxSeqSeen: 5,
    });
    expect(next).toHaveLength(3);
    expect(next[0]).toEqual({ id: 'r1', who: 'leon', kind: 'player', text: 'hi', ts: '10:00', seq: 3 });
    expect(next[1]).toBe(prev[1]); // untouched row keeps identity
    expect(next[2].id).toBe('ev5');
    // original array not mutated
    expect(prev[0]).not.toHaveProperty('seq');
  });

  it('an unmatched matchId is a no-op for that instruction (row already gone)', () => {
    const prev: LogRow[] = [{ id: 'r1', who: 'leon', kind: 'player', text: 'hi', ts: '10:00' }];
    const next = applyReconcileResult(prev, {
      appended: [],
      stamped: [{ matchId: 'ghost', patch: { seq: 9 } }],
      maxSeqSeen: 9,
    });
    expect(next).toBe(prev);
  });
});
