/**
 * buildLine (B8c-3 M1.1; Sora's mount brief 2.2, Iro-A11y's ruling 1 acceptances 4 and 5): the scene line and the cell's accessible name are two renderings of ONE
 * `CellNameInput`. Every fact in one is in the other (name, side, conditions, feet, the feature's label); the words of the line are pinned here, and Aoi settles them.
 */
import { buildLine, cellAccessibleName, type CellNameInput, type CellOccupant, type InspectLine } from '@/components/tactical-map/a11y';

const occ = (o: Partial<CellOccupant> = {}): CellOccupant => ({
  name: 'Goblin Skulker', isSelf: false, isAlly: false, hostile: true, invisible: false, dead: false, downed: false, occupiesCell: true, otherConditions: [], ...o,
});
const input = (o: Partial<CellNameInput> = {}): CellNameInput => ({ row1: 6, col1: 10, blocked: false, moveModeActive: false, ...o });
const cell = (o: Partial<CellNameInput>): InspectLine => ({ kind: 'cell', input: input(o) });

describe('buildLine — the words', () => {
  it('rest: the stage\'s own line, with the round when it is known', () => {
    expect(buildLine(null, { round: 2 })).toBe('In combat · round 2');
    expect(buildLine(null, { round: null })).toBe('In combat');
  });

  it('turn: the mover and the feet left', () => {
    expect(buildLine({ kind: 'turn', name: 'Kestrel Ashwood', feetLeft: 30 }, { round: 2 })).toBe('In combat · round 2 · Kestrel Ashwood: 30 ft left');
    expect(buildLine({ kind: 'turn', name: 'Kestrel Ashwood', feetLeft: 0 }, { round: null })).toBe('In combat · Kestrel Ashwood: 0 ft left');
  });

  it('a creature: name, side, Downed or Dead, Invisible, conditions — the brief\'s own example', () => {
    expect(buildLine(cell({ occupant: occ({ invisible: true, otherConditions: ['Poisoned', 'Prone'] }) }), { round: 2 })).toBe('Goblin Skulker · Foe · Invisible · Poisoned, Prone');
  });

  it('sides: You, Ally, Foe', () => {
    expect(buildLine(cell({ occupant: occ({ name: 'Bren', isSelf: true, hostile: false }) }), { round: 1 })).toBe('Bren · You');
    expect(buildLine(cell({ occupant: occ({ name: 'Sable', isAlly: true, hostile: false }) }), { round: 1 })).toBe('Sable · Ally');
    expect(buildLine(cell({ occupant: occ() }), { round: 1 })).toBe('Goblin Skulker · Foe');
  });

  it('downed and dead say so, before Invisible; dead wins over downed (they are exclusive by construction)', () => {
    expect(buildLine(cell({ occupant: occ({ downed: true, invisible: true }) }), { round: 1 })).toBe('Goblin Skulker · Foe · Downed · Invisible');
    expect(buildLine(cell({ occupant: occ({ dead: true }) }), { round: 1 })).toBe('Goblin Skulker · Foe · Dead');
  });

  it('a feature: its label alone; under a token it follows the creature\'s facts', () => {
    expect(buildLine(cell({ featureLabel: 'Stalagmites' }), { round: 2 })).toBe('Stalagmites');
    expect(buildLine(cell({ occupant: occ(), featureLabel: 'Brazier' }), { round: 2 })).toBe('Goblin Skulker · Foe · Brazier');
  });

  it('a target: legal says where and what it costs of what is left; not legal is the cell\'s own name (the square and why, in its own words)', () => {
    const legal = input({ moveModeActive: true, inRange: true, costFt: 15 });
    expect(buildLine({ kind: 'target', input: legal, legal: true, costFt: 15, budgetFt: 30 }, { round: 2 })).toBe('Move to row 6, column 10 · 15 ft of 30');
    const blocked = input({ moveModeActive: true, blocked: true });
    expect(buildLine({ kind: 'target', input: blocked, legal: false }, { round: 2 })).toBe('Row 6, column 10. Blocked. Not reachable.');
    expect(buildLine({ kind: 'target', input: blocked, legal: false }, { round: 2 })).toBe(cellAccessibleName(blocked));
    const occupied = input({ moveModeActive: true, occupant: occ() });
    expect(buildLine({ kind: 'target', input: occupied, legal: false }, { round: 2 })).toBe('Row 6, column 10. Goblin Skulker, hostile. Occupied — can\'t stop here.');
  });
});

describe('buildLine and cellAccessibleName read the same CellNameInput: the same facts appear in both (Iro acceptance 5)', () => {
  const cases: Array<[string, CellNameInput]> = [
    ['an invisible, poisoned, prone foe', input({ occupant: occ({ invisible: true, otherConditions: ['Poisoned', 'Prone'] }) })],
    ['a downed ally', input({ occupant: occ({ name: 'Sable Voss', hostile: false, isAlly: true, downed: true }) })],
    ['the viewer\'s own PC with a condition', input({ occupant: occ({ name: 'Kestrel Ashwood', hostile: false, isSelf: true, otherConditions: ['Frightened'] }) })],
    ['a dead foe', input({ occupant: occ({ dead: true, occupiesCell: false }) })],
  ];

  it.each(cases)('%s: name, side, state and every condition are in both renderings', (_label, i) => {
    const o = i.occupant!;
    const name = cellAccessibleName(i).toLowerCase();
    const line = buildLine({ kind: 'cell', input: i }, { round: 1 }).toLowerCase();
    for (const text of [o.name.toLowerCase(), ...(o.otherConditions ?? []).map((c) => c.toLowerCase())]) {
      expect(name).toContain(text);
      expect(line).toContain(text);
    }
    const side = o.isSelf ? ['you', 'you'] : o.isAlly ? ['ally', 'ally'] : ['hostile', 'foe'];
    expect(name).toContain(side[0]);
    expect(line).toContain(side[1]);
    for (const [flag, word] of [[o.downed, 'downed'], [o.dead, 'dead'], [o.invisible, 'invisible']] as const) {
      if (flag) { expect(name).toContain(word); expect(line).toContain(word); } else { expect(name).not.toContain(word); expect(line).not.toContain(word); }
    }
  });

  it('a feature\'s label is in both (it was a hover title only, inert to keyboard and touch)', () => {
    const i = input({ featureLabel: 'Stalagmites' });
    expect(cellAccessibleName(i)).toContain('Stalagmites');
    expect(buildLine({ kind: 'cell', input: i }, { round: 1 })).toContain('Stalagmites');
    expect(cellAccessibleName(i)).toBe('Row 6, column 10. Feature: Stalagmites. Empty.');
  });

  it('the feet: a legal target\'s cost is in both, and so is the square', () => {
    const i = input({ moveModeActive: true, inRange: true, costFt: 15 });
    const name = cellAccessibleName(i);
    const line = buildLine({ kind: 'target', input: i, legal: true, costFt: 15, budgetFt: 30 }, { round: 1 });
    expect(name).toContain('costs 15 feet');
    expect(line).toContain('15 ft of 30');
    for (const text of ['6', '10']) { expect(name).toContain(text); expect(line).toContain(text); }
  });

  it('a feature joins the name on every branch: self, blocked and occupied, not just an empty square', () => {
    for (const i of [input({ featureLabel: 'Brazier', occupant: occ({ isSelf: true, hostile: false }) }), input({ featureLabel: 'Brazier', blocked: true }), input({ featureLabel: 'Brazier', occupant: occ() })]) {
      expect(cellAccessibleName(i)).toContain('Feature: Brazier.');
    }
  });

  it('the line carries no markup and no live-region attribute: it is plain text (Iro ruling 1)', () => {
    for (const [, i] of cases) expect(buildLine({ kind: 'cell', input: i }, { round: 1 })).not.toMatch(/[<>]|aria-/);
  });
});
