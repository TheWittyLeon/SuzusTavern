import { buildHistoryRows, mergeHealedRows } from '@/app/play/[sessionId]/historyRows';
import type { LogRow } from '@/components/ChatLog';
import type { EngineSessionEvent } from '@/lib/api/types';

const ev = (seq: number, kind: string, text: string): EngineSessionEvent => ({ seq, kind, data: { text } });

describe('mergeHealedRows (TAV-HEAL-SHARES-MOUNT-ROW-BUILDER)', () => {
  const live = (id: string, kind: LogRow['kind'], text: string): LogRow => ({ id, ts: '', who: 'x', kind, text });

  it('puts healed history before the rows this page appended, and drops what a live turn already drew', () => {
    const log: LogRow[] = [
      { id: 'ev1', ts: '', who: 'Suzu', kind: 'narration', text: 'one' },
      live('r1', 'player', 'I go'),
      live('r2', 'narration', 'You went'),
    ];
    const healed = buildHistoryRows([ev(2, 'narration', 'two'), ev(3, 'player_action', 'I go'), ev(4, 'narration', 'You went')], null);
    const merged = mergeHealedRows(log, healed);
    expect(merged.map((r) => r.id)).toEqual(['ev1', 'ev2', 'r1', 'r2']);
  });

  it('with no live rows it appends', () => {
    const log: LogRow[] = [{ id: 'ev1', ts: '', who: 'Suzu', kind: 'narration', text: 'one' }];
    const merged = mergeHealedRows(log, buildHistoryRows([ev(2, 'narration', 'two')], null));
    expect(merged.map((r) => r.id)).toEqual(['ev1', 'ev2']);
  });
});
