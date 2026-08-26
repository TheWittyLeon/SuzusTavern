import { groupClassFeatures, SCAFFOLDING_FEATURE_NAMES } from '../../lib/dnd/classFeatureText';

describe('groupClassFeatures', () => {
  it('filters the exact scaffolding menu-label names', () => {
    const raw = [
      'Ki Blast',
      'Unarmored Defense',
      'Martial Arts',
      'Ki Stat',
      'School',
      'Signature',
      'Rung I',
      'Rung II',
      'Rung III',
      'Rung IV',
      'Rung V',
      'Capstone',
    ];
    const out = groupClassFeatures(raw);
    const names = out.map((f) => f.name);
    expect(names).toEqual(['Ki Blast', 'Unarmored Defense', 'Martial Arts']);
    // Negative control: every scaffolding name really was present in the
    // input and really is absent from the output — this fails if the
    // filter set above ever drifts from SCAFFOLDING_FEATURE_NAMES.
    for (const scaffold of SCAFFOLDING_FEATURE_NAMES) {
      expect(raw).toContain(scaffold);
      expect(names).not.toContain(scaffold);
    }
  });

  it('does NOT hide a real feature whose name merely CONTAINS a scaffolding string (exact match only, no substring/fuzzy match)', () => {
    // "Demon Style — Rung I" is a real cross-trained-school feature on a
    // live character (24043, suzu_dnd_dev) — it contains "Rung I" as a
    // substring but must survive a scaffolding filter that only strips the
    // literal "Rung I".
    const out = groupClassFeatures(['Rung I', 'Demon Style — Rung I']);
    expect(out.map((f) => f.name)).toEqual(['Demon Style — Rung I']);
  });

  it('collapses repeated names into one entry with a count, preserving first-seen order', () => {
    const raw = [
      'Ki Blast',
      'Ability Score Improvement',
      'Extra Attack',
      'Ability Score Improvement',
      'Ability Score Improvement',
      'Ability Score Improvement',
      'Ability Score Improvement',
    ];
    const out = groupClassFeatures(raw);
    expect(out).toEqual([
      { name: 'Ki Blast', count: 1 },
      { name: 'Ability Score Improvement', count: 5 },
      { name: 'Extra Attack', count: 1 },
    ]);
  });

  it('returns an empty list for an all-scaffolding input', () => {
    expect(groupClassFeatures(['Ki Stat', 'School', 'Capstone'])).toEqual([]);
  });

  it('returns an empty list for an empty input', () => {
    expect(groupClassFeatures([])).toEqual([]);
  });
});
