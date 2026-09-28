import { CONDITION_SEVERITY_ORDER, worstCondition } from '@/components/tactical-map/conditions';
import { DND_CONDITIONS } from '@/lib/conditions';

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
    // rather than silently sorting last forever. Kage-CR D1 IMPORTANT-2:
    // the PREVIOUS version of this test declared its own local 21-string
    // copy of DND_CONDITIONS instead of importing the real export — adding
    // a condition to the real list left this guard 7/7 green (mutation-
    // confirmed). Importing the real export is what makes the guard fire.
    //
    // "invisible" is deliberately not a severity-ranked condition (T3
    // concerns visibility, not severity) — it's the one entry allowed to be
    // absent from the order.
    for (const c of DND_CONDITIONS) {
      if (c === 'invisible') continue;
      expect(CONDITION_SEVERITY_ORDER).toContain(c);
    }
  });

  describe('Kage-CR D1 suggestion: lethality ranking for a movement surface', () => {
    it('exhaustion_6 (death, per SRD stacking) outranks a merely-agency-removing condition like blinded', () => {
      expect(worstCondition(['blinded', 'exhaustion_6'])).toBe('exhaustion_6');
    });

    it('exhaustion_5 (speed halved to 0) outranks grappled (speed 0, but still able to act)', () => {
      expect(worstCondition(['grappled', 'exhaustion_5'])).toBe('exhaustion_5');
    });

    it('prone (movement-costly to stand or crawl) outranks charmed/deafened (no movement cost)', () => {
      expect(worstCondition(['charmed', 'prone'])).toBe('prone');
      expect(worstCondition(['deafened', 'prone'])).toBe('prone');
    });
  });
});
