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
        occupant: { name: 'Bren Oakshield', isSelf: true, isAlly: false, hostile: false, invisible: false, dead: false, downed: false, occupiesCell: true },
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
        occupant: { name: 'Bren Oakshield', isSelf: true, isAlly: false, hostile: false, invisible: false, dead: false, downed: true, occupiesCell: true },
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
        occupant: { name: 'Bren Oakshield', isSelf: true, isAlly: false, hostile: false, invisible: false, dead: true, downed: false, occupiesCell: true },
        blocked: false,
        moveModeActive: true,
      }),
    ).toBe('Row 1, column 1. Bren Oakshield — you, dead. Current position.');
  });

  it('a dead self cell that is NOT the mover\'s own reads via the reach phrase, never "Current position." (Kage-CR B8c-1 IMPORTANT-3 — the bug this fix-round closes)', () => {
    // occupiesCell: false — the viewer is dead AND not the active mover
    // (occupiesWhenAlive is false, and the isSelf-&&-isActiveMover
    // carve-out does not apply), so this cell is a legal move target for
    // whoever IS active, and the self-narration must say so instead of
    // asserting "Current position." unconditionally.
    expect(
      cellAccessibleName({
        row1: 2,
        col1: 3,
        occupant: { name: 'Bren', isSelf: true, isAlly: false, hostile: false, invisible: false, dead: true, downed: false, occupiesCell: false },
        blocked: false,
        inRange: true,
        costFt: 5,
        moveModeActive: true,
      }),
    ).toBe('Row 2, column 3. Bren — you, dead. In range — costs 5 feet.');
    expect(
      cellAccessibleName({
        row1: 2,
        col1: 3,
        occupant: { name: 'Bren', isSelf: true, isAlly: false, hostile: false, invisible: false, dead: true, downed: false, occupiesCell: false },
        blocked: false,
        inRange: false,
        moveModeActive: true,
      }),
    ).toBe('Row 2, column 3. Bren — you, dead. Out of range.');
  });

  it('positive control: a self cell where the viewer IS the active mover always stays "Current position." — the occupiesCell carve-out, not reach state', () => {
    // occupiesCell: true via the isSelf-&&-isActiveMover carve-out even
    // though this cell is never in `reach` (reachableCells skips its own
    // fromKey) — "Current position." must not depend on inRange at all.
    expect(
      cellAccessibleName({
        row1: 3,
        col1: 3,
        occupant: { name: 'Bren', isSelf: true, isAlly: false, hostile: false, invisible: false, dead: false, downed: false, occupiesCell: true },
        blocked: false,
        inRange: false,
        moveModeActive: true,
      }),
    ).toBe('Row 3, column 3. Bren — you. Current position.');
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
        occupant: { name: 'Sable Nightwhisper', isSelf: false, isAlly: true, hostile: false, invisible: false, dead: false, downed: false, occupiesCell: true },
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
        occupant: { name: 'Goblin', isSelf: false, isAlly: false, hostile: true, invisible: true, dead: false, downed: false, occupiesCell: true },
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
        occupant: { name: 'Goblin', isSelf: false, isAlly: false, hostile: true, invisible: false, dead: true, downed: false, occupiesCell: false },
        blocked: false,
        inRange: true,
        costFt: 10,
        moveModeActive: true,
      }),
    ).toBe('Row 2, column 2. Goblin, hostile, dead. In range — costs 10 feet.');
  });

  it('names a dead occupant\'s cell as a destination, never "Occupied" (B8a IMP-5: the dead are walkable)', () => {
    const corpse = { name: 'Goblin', isSelf: false, isAlly: false, hostile: true, invisible: false, dead: true, downed: false, occupiesCell: false };
    expect(
      cellAccessibleName({ row1: 2, col1: 9, occupant: corpse, blocked: false, inRange: false, moveModeActive: true }),
    ).toBe('Row 2, column 9. Goblin, hostile, dead. Out of range.');
    expect(
      cellAccessibleName({ row1: 2, col1: 9, occupant: corpse, blocked: false, moveModeActive: false }),
    ).toBe('Row 2, column 9. Goblin, hostile, dead.');
    // Control: a downed-but-alive occupant still occupies (engine keys on
    // is_active, not HP), so it keeps the refusal even when in range.
    expect(
      cellAccessibleName({
        row1: 2,
        col1: 9,
        occupant: { ...corpse, dead: false, downed: true, occupiesCell: true },
        blocked: false,
        inRange: true,
        costFt: 10,
        moveModeActive: true,
      }),
    ).toBe("Row 2, column 9. Goblin, hostile, downed. Occupied — can't stop here.");
  });

  it('a dead occupant carrying other conditions reads the reach phrase before the conditions list (Kage-CR 🟢 E)', () => {
    expect(
      cellAccessibleName({
        row1: 2,
        col1: 3,
        occupant: {
          name: 'Corpse',
          isSelf: false,
          isAlly: false,
          hostile: true,
          invisible: false,
          dead: true,
          downed: false,
          occupiesCell: false,
          otherConditions: ['Prone'],
        },
        blocked: false,
        inRange: true,
        costFt: 5,
        moveModeActive: true,
      }),
    ).toBe('Row 2, column 3. Corpse, hostile, dead. In range — costs 5 feet. Conditions: Prone.');
  });

  it('discriminates occupiesCell from dead on the OTHER-occupant branch (Kage-CR B8c-1 IMPORTANT-A) — every fixture above has the two anti-correlated', () => {
    // Every non-self CellOccupant fixture above has `dead` and `occupiesCell`
    // perfectly anti-correlated (dead: true always pairs with occupiesCell:
    // false, dead: false always with occupiesCell: true), so a11y.ts's
    // `!input.occupant.occupiesCell` branch and a hypothetical
    // `input.occupant.dead` re-derivation are numerically indistinguishable
    // on every case that exists — option (a)'s whole point (ONE
    // `occupiesCell` fact, never re-derived from `dead`) is unpinned. These
    // two cases break the correlation on purpose: a dead-but-still-occupying
    // corpse (a future membership rule — a Huge corpse that still blocks)
    // and a living-but-non-occupying occupant (a future phasing ally).
    // Mutation-proven: reverting the other-occupant branch in a11y.ts to
    // `if (input.occupant.dead)` reds this test, while the whole
    // pre-existing suite above stays green under that same mutation.
    expect(
      cellAccessibleName({
        row1: 1,
        col1: 1,
        occupant: { name: 'Corpse', isSelf: false, isAlly: false, hostile: true, invisible: false, dead: true, downed: false, occupiesCell: true },
        blocked: false,
        moveModeActive: true,
      }),
    ).toBe("Row 1, column 1. Corpse, hostile, dead. Occupied — can't stop here.");

    expect(
      cellAccessibleName({
        row1: 1,
        col1: 2,
        occupant: { name: 'Sable', isSelf: false, isAlly: true, hostile: false, invisible: false, dead: false, downed: false, occupiesCell: false },
        blocked: false,
        inRange: true,
        costFt: 5,
        moveModeActive: true,
      }),
    ).toBe('Row 1, column 2. Sable, ally. In range — costs 5 feet.');
  });

  it('names a downed ally-occupied cell, including the downed disclosure (D1b item D, Kage-CR re-verify)', () => {
    // Same gap as the dead test above, for the OTHER state .tokenDowned's
    // faded/dashed/red-ring visual treatment discloses: a downed ally read
    // identically to a healthy one to a screen-reader user before this.
    expect(
      cellAccessibleName({
        row1: 6,
        col1: 2,
        occupant: { name: 'Bren Oakshield', isSelf: false, isAlly: true, hostile: false, invisible: false, dead: false, downed: true, occupiesCell: true },
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
          occupiesCell: true,
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
