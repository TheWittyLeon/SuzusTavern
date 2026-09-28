import { cellAccessibleName, nextFocusCoord, toDisplayRowCol } from '@/components/tactical-map/a11y';

describe('toDisplayRowCol', () => {
  it('converts a 0-indexed [x,y] wire coordinate to 1-indexed {row,col}', () => {
    expect(toDisplayRowCol([0, 0])).toEqual({ row1: 1, col1: 1 });
    expect(toDisplayRowCol([7, 4])).toEqual({ row1: 5, col1: 8 });
  });
});

describe('cellAccessibleName', () => {
  it('matches the design/mockup demo table for the viewer\'s own current cell', () => {
    expect(
      cellAccessibleName({
        row1: 5,
        col1: 5,
        occupant: { name: 'Bren Oakshield', isSelf: true, isAlly: false, hostile: false, invisible: false, dead: false, downed: false },
        blocked: false,
        moveModeActive: true,
      }),
    ).toBe('Row 5, column 5. Bren Oakshield — you. Current position.');
  });

  it('discloses downed on the viewer\'s own cell, not just other occupants\' (D1c, Kage-CR D1b IMPORTANT-2)', () => {
    // Before this fix the isSelf branch returned before the downed/dead
    // clauses ever ran, so a downed viewer announced identically to a
    // healthy one — the same visual/AT gap the dead/downed disclosures
    // above already closed for OTHER occupants, unclosed for your own PC.
    expect(
      cellAccessibleName({
        row1: 1,
        col1: 1,
        occupant: { name: 'Bren Oakshield', isSelf: true, isAlly: false, hostile: false, invisible: false, dead: false, downed: true },
        blocked: false,
        moveModeActive: true,
      }),
    ).toBe('Row 1, column 1. Bren Oakshield — you, downed. Current position.');
  });

  it('discloses dead on the viewer\'s own cell (D1c, Kage-CR D1b IMPORTANT-2)', () => {
    expect(
      cellAccessibleName({
        row1: 1,
        col1: 1,
        occupant: { name: 'Bren Oakshield', isSelf: true, isAlly: false, hostile: false, invisible: false, dead: true, downed: false },
        blocked: false,
        moveModeActive: true,
      }),
    ).toBe('Row 1, column 1. Bren Oakshield — you, dead. Current position.');
  });

  it('matches the design/mockup demo table for an in-range empty cell', () => {
    expect(
      cellAccessibleName({ row1: 5, col1: 8, occupant: undefined, blocked: false, inRange: true, costFt: 15, moveModeActive: true }),
    ).toBe('Row 5, column 8. Empty. In range — costs 15 feet.');
  });

  it('matches the design/mockup demo table for an out-of-range empty cell', () => {
    expect(
      cellAccessibleName({ row1: 5, col1: 17, occupant: undefined, blocked: false, inRange: false, moveModeActive: true }),
    ).toBe('Row 5, column 17. Empty. Out of range.');
  });

  it('says "Empty." with no range language outside move mode', () => {
    expect(
      cellAccessibleName({ row1: 5, col1: 17, occupant: undefined, blocked: false, moveModeActive: false }),
    ).toBe('Row 5, column 17. Empty.');
  });

  it('names a blocked cell generically — never a per-content flavor string like "rubble"', () => {
    const name = cellAccessibleName({ row1: 3, col1: 7, occupant: undefined, blocked: true, moveModeActive: true });
    expect(name).toBe('Row 3, column 7. Blocked. Not reachable.');
    expect(name).not.toMatch(/rubble/i);
  });

  it('names an ally-occupied cell', () => {
    expect(
      cellAccessibleName({
        row1: 4,
        col1: 3,
        occupant: { name: 'Sable Nightwhisper', isSelf: false, isAlly: true, hostile: false, invisible: false, dead: false, downed: false },
        blocked: false,
        moveModeActive: true,
      }),
    ).toBe("Row 4, column 3. Sable Nightwhisper, ally. Occupied — can't stop here.");
  });

  it('names an invisible-but-shown hostile-occupied cell, including the invisible disclosure (M1)', () => {
    expect(
      cellAccessibleName({
        row1: 4,
        col1: 11,
        occupant: { name: 'Goblin', isSelf: false, isAlly: false, hostile: true, invisible: true, dead: false, downed: false },
        blocked: false,
        moveModeActive: true,
      }),
    ).toBe("Row 4, column 11. Goblin, hostile, invisible. Occupied — can't stop here.");
  });

  it('names a dead hostile-occupied cell, including the dead disclosure (Kage-CR D1 IMPORTANT-8)', () => {
    // A screen-reader user gets no benefit from .tokenDead's visual
    // grayscale treatment — without this, a corpse still reads as an
    // ordinary live foe to AT, the exact gap the visual fix closed for
    // sighted users.
    expect(
      cellAccessibleName({
        row1: 2,
        col1: 2,
        occupant: { name: 'Goblin', isSelf: false, isAlly: false, hostile: true, invisible: false, dead: true, downed: false },
        blocked: false,
        moveModeActive: true,
      }),
    ).toBe("Row 2, column 2. Goblin, hostile, dead. Occupied — can't stop here.");
  });

  it('names a downed ally-occupied cell, including the downed disclosure (D1b item D, Kage-CR re-verify)', () => {
    // Same gap as the dead test above, for the OTHER state .tokenDowned's
    // faded/dashed/red-ring visual treatment discloses: a downed ally read
    // identically to a healthy one to a screen-reader user before this.
    expect(
      cellAccessibleName({
        row1: 6,
        col1: 2,
        occupant: { name: 'Bren Oakshield', isSelf: false, isAlly: true, hostile: false, invisible: false, dead: false, downed: true },
        blocked: false,
        moveModeActive: true,
      }),
    ).toBe("Row 6, column 2. Bren Oakshield, ally, downed. Occupied — can't stop here.");
  });

  it('appends a full conditions list (T2 "full list on focus") when the occupant has conditions beyond invisible', () => {
    expect(
      cellAccessibleName({
        row1: 4,
        col1: 3,
        occupant: {
          name: 'Sable Nightwhisper',
          isSelf: false,
          isAlly: true,
          hostile: false,
          invisible: false,
          dead: false,
          downed: false,
          otherConditions: ['Prone', 'Poisoned'],
        },
        blocked: false,
        moveModeActive: true,
      }),
    ).toBe(
      "Row 4, column 3. Sable Nightwhisper, ally. Occupied — can't stop here. Conditions: Prone, Poisoned.",
    );
  });

  it('blocked takes priority over an (impossible in valid data) occupant/range state', () => {
    const name = cellAccessibleName({ row1: 1, col1: 1, occupant: undefined, blocked: true, inRange: true, costFt: 5, moveModeActive: true });
    expect(name).toBe('Row 1, column 1. Blocked. Not reachable.');
  });
});

describe('nextFocusCoord', () => {
  it('moves one cell in each arrow direction', () => {
    expect(nextFocusCoord('ArrowRight', [2, 2], 10, 10)).toEqual([3, 2]);
    expect(nextFocusCoord('ArrowLeft', [2, 2], 10, 10)).toEqual([1, 2]);
    expect(nextFocusCoord('ArrowDown', [2, 2], 10, 10)).toEqual([2, 3]);
    expect(nextFocusCoord('ArrowUp', [2, 2], 10, 10)).toEqual([2, 1]);
  });

  it('clamps at the board edges instead of wrapping', () => {
    expect(nextFocusCoord('ArrowLeft', [0, 0], 10, 10)).toBeNull();
    expect(nextFocusCoord('ArrowUp', [0, 0], 10, 10)).toBeNull();
    expect(nextFocusCoord('ArrowRight', [9, 9], 10, 10)).toBeNull();
    expect(nextFocusCoord('ArrowDown', [9, 9], 10, 10)).toBeNull();
  });

  it('returns null for a non-arrow key', () => {
    expect(nextFocusCoord('Enter', [2, 2], 10, 10)).toBeNull();
    expect(nextFocusCoord('a', [2, 2], 10, 10)).toBeNull();
  });
});
