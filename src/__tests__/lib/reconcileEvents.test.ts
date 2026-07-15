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

describe('reconcileDurableEvents — rule 3 (narration/recap)', () => {
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

  it('recap kind uses the same matching rule as narration', () => {
    const renderedSeqs = new Set<number>();
    const pendingByKey = new Map<string, PendingTurnEntry>([
      ['tk-1', { narrationRowId: 'r7', triggerSeq: 10, awaitingNarration: true }],
    ]);
    const events: EngineSessionEvent[] = [
      { seq: 11, kind: 'recap', data: { text: 'Previously on…' } },
    ];
    const result = reconcileDurableEvents(events, renderedSeqs, pendingByKey, noRow);
    expect(result.stamped).toHaveLength(1);
    expect(result.stamped[0].matchId).toBe('r7');
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
