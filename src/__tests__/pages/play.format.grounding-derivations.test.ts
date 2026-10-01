/**
 * @jest-environment node
 *
 * The combat-verb guard's two reads of `grounding` (TAV-COMBAT-VERB-NO-MECHANICS),
 * moved verbatim out of page.tsx (A9c-2 D3 ratchet extraction). The page-level
 * suites exercise them through the composer; this pins the pure functions.
 */
import { groundingCreatureNames, isCombatEncounterUnstarted } from '../../app/play/[sessionId]/format';
import type { GroundingData } from '../../lib/api/types';

const g = (over: Record<string, unknown>) => over as unknown as GroundingData;

describe('isCombatEncounterUnstarted', () => {
  it('is false with no grounding, no encounter, a non-combat kind, or no id', () => {
    expect(isCombatEncounterUnstarted(null)).toBe(false);
    expect(isCombatEncounterUnstarted(g({}))).toBe(false);
    expect(isCombatEncounterUnstarted(g({ encounter: { kind: 'social', id: 'e1' } }))).toBe(false);
    expect(isCombatEncounterUnstarted(g({ encounter: { kind: 'combat' } }))).toBe(false);
    expect(isCombatEncounterUnstarted(g({ encounter: { kind: 'combat', id: '' } }))).toBe(false);
  });

  it('is true for a combat encounter with no encounter_state map, or an entry-less one', () => {
    expect(isCombatEncounterUnstarted(g({ encounter: { kind: 'combat', id: 'e1' } }))).toBe(true);
    expect(isCombatEncounterUnstarted(g({ encounter: { kind: 'combat', id: 'e1' }, encounter_state: {} }))).toBe(true);
    expect(
      isCombatEncounterUnstarted(g({ encounter: { kind: 'combat', id: 'e1' }, encounter_state: { other: 'resolved_win' } })),
    ).toBe(true);
  });

  it('is false once ANY state entry exists for the id (unresolved or resolved_*)', () => {
    for (const st of ['unresolved', 'resolved_win']) {
      expect(
        isCombatEncounterUnstarted(g({ encounter: { kind: 'combat', id: 'e1' }, encounter_state: { e1: st } })),
      ).toBe(false);
    }
  });
});

describe('groundingCreatureNames', () => {
  it('returns the non-empty string names of monsters_resolved, in order', () => {
    expect(
      groundingCreatureNames(
        g({ encounter: { monsters_resolved: [{ name: 'Goblin' }, { name: '' }, { name: 7 }, null, { name: 'Wolf' }] } }),
      ),
    ).toEqual(['Goblin', 'Wolf']);
  });

  it('is [] for no grounding, no encounter, or a non-array monsters_resolved', () => {
    expect(groundingCreatureNames(null)).toEqual([]);
    expect(groundingCreatureNames(g({ encounter: null }))).toEqual([]);
    expect(groundingCreatureNames(g({ encounter: { monsters_resolved: 'goblin' } }))).toEqual([]);
  });
});
