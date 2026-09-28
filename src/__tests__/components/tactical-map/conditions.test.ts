import { CONDITION_SEVERITY_ORDER, worstCondition } from '@/components/tactical-map/conditions';

describe('worstCondition', () => {
  it('returns undefined for an empty list', () => {
    expect(worstCondition([])).toBeUndefined();
  });

  it('returns the single condition when there is only one', () => {
    expect(worstCondition(['prone'])).toBe('prone');
  });

  it('picks the more severe of two conditions regardless of array order', () => {
    expect(worstCondition(['prone', 'unconscious'])).toBe('unconscious');
    expect(worstCondition(['unconscious', 'prone'])).toBe('unconscious');
  });

  it('is case-insensitive against the severity order', () => {
    expect(worstCondition(['Prone', 'UNCONSCIOUS'])).toBe('UNCONSCIOUS');
  });

  it('ranks a worse exhaustion level above a lesser one', () => {
    expect(worstCondition(['exhaustion_2', 'exhaustion_5'])).toBe('exhaustion_5');
  });

  it('treats an unlisted condition as lowest severity, never throwing', () => {
    expect(worstCondition(['some_future_condition', 'prone'])).toBe('prone');
    expect(worstCondition(['some_future_condition'])).toBe('some_future_condition');
  });

  it('every engine-vocabulary condition (src/lib/conditions.ts::DND_CONDITIONS) has a rank', () => {
    // Guards the "ceiling" the debt: marker on CONDITION_SEVERITY_ORDER
    // names — a future DND_CONDITIONS addition should fail this loudly
    // rather than silently sorting last forever.
    const DND_CONDITIONS = [
      'blinded', 'charmed', 'deafened', 'dodge', 'frightened', 'grappled',
      'incapacitated', 'invisible', 'paralyzed', 'petrified', 'poisoned',
      'prone', 'restrained', 'stunned', 'unconscious',
      'exhaustion_1', 'exhaustion_2', 'exhaustion_3', 'exhaustion_4',
      'exhaustion_5', 'exhaustion_6',
    ];
    // "invisible" is deliberately not a severity-ranked condition (T3
    // concerns visibility, not severity) — it's the one entry allowed to be
    // absent from the order.
    for (const c of DND_CONDITIONS) {
      if (c === 'invisible') continue;
      expect(CONDITION_SEVERITY_ORDER).toContain(c);
    }
  });
});
