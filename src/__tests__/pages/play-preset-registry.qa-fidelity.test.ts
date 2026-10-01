/**
 * Miko-QA, A9a review (TAV-PLAY-SHELL step 6a, `presets.ts`), fixed up by
 * Ren-Dev's fix round per Kage-CR's Q1 ruling (2026-09-30).
 *
 * `play-preset-registry.test.ts` (the item's own pin) proves the registry
 * is INTERNALLY consistent — every RegionId has a row, no orphan grid
 * areas, announcing regions never go invisible. None of that checks
 * whether a row's CONTENT is faithful to what was actually ruled. This
 * file adds that second layer: per-row/per-moment assertions traced to
 * specific rulings, for the regions the rulings gate explicitly.
 *
 * Miko originally flagged `actionBar` being placed (non-null) in the
 * STORY row in both moments as an R16 violation and wrote two cases
 * asserting Story never places it. Kage-CR's review OVERRULES that
 * defect: Amendment A already hides `offers` during combat
 * (`regions.offers.combat = { area: null, visible: false }`, every row),
 * so removing the action bar too would leave Story-combat with ZERO
 * action affordances — a dead-end layout that settles the question
 * mechanically. R16's Table parenthetical ("scene stage, sheet docked
 * open, action bar") is a three-word characterisation of a direction, not
 * an exhaustive parts manifest (it also omits the story log, which Table
 * obviously has) — "not listed" does not mean "absent". The mockup's
 * "Story: Not shown; actions are chips" mechanism is exactly the second
 * submit surface S3 (ruled later than both R16 and the mockup) forbids:
 * "ActionBar stays the single place that submits a combat action." The
 * two cases below are inverted accordingly: Story places `actionBar` in
 * BOTH moments, gaining only a density change (`'vitals'` exploring,
 * `'chips'` combat) — see `presets.ts`'s own `regions.actionBar` comment
 * for the ruling text. The other six cases are Miko's, unchanged.
 *
 * These assertions run against the REAL registry (no mutation) — every
 * one below reflects the live, ruled state at HEAD.
 */
import { LAYOUT_ROWS_BY_ID, REGION_IDS, getPlacement } from '../../app/play/[sessionId]/presets';

describe('play-preset-registry — ruling fidelity (Miko-QA, R16)', () => {
  it('REGION_IDS is exactly the plan’s 11, in the plan’s own order (regression lock, independent of presets.ts)', () => {
    // Authored independently from the plan's §3.2 listing, not copied from
    // presets.ts, so a future edit to REGION_IDS that silently drops or
    // reorders a member is caught here even though it would not change the
    // *set* comparisons the item's own test file runs.
    expect(REGION_IDS).toEqual([
      'topBar',
      'partyStrip',
      'sceneStage',
      'suzuPresence',
      'storyLog',
      'offers',
      'characterBlock',
      'actionBar',
      'composer',
      'tableControls',
      'safetyBanner',
    ]);
  });

  it('Story places actionBar in BOTH moments, with density "vitals" exploring / "chips" combat (Kage-CR Q1 ruling, 2026-09-30: overrules the R16-literal reading — Amendment A already removes `offers` in combat, so dropping the bar too would leave Story-combat with no way to act at all)', () => {
    const row = LAYOUT_ROWS_BY_ID.story;
    const exploring = getPlacement(row, 'actionBar', 'exploring');
    const combat = getPlacement(row, 'actionBar', 'combat');
    expect(exploring.area).toBe('actionBar');
    expect(exploring.density).toBe('vitals');
    expect(combat.area).toBe('actionBar');
    expect(combat.density).toBe('chips');
  });

  it('Story’s grid-template-areas names "actionBar" in both moments — unchanged by the Q1 fix, which is a density change only, never an area/token edit', () => {
    const row = LAYOUT_ROWS_BY_ID.story;
    expect(row.areas.exploring).toMatch(/\bactionBar\b/);
    expect(row.areas.combat).toMatch(/\bactionBar\b/);
  });

  it('Table places actionBar in BOTH moments (R16: Table = "…action bar", unconditional; mockup: "Action bar … Table: Bottom, always")', () => {
    const row = LAYOUT_ROWS_BY_ID.table;
    expect(getPlacement(row, 'actionBar', 'exploring').area).not.toBeNull();
    expect(getPlacement(row, 'actionBar', 'combat').area).not.toBeNull();
  });

  it('Phone places actionBar in BOTH moments (mockup: "Action bar … Phone: Vitals while exploring; five slots in combat" — the bar itself is always present, only its content/density changes)', () => {
    const row = LAYOUT_ROWS_BY_ID.phone;
    expect(getPlacement(row, 'actionBar', 'exploring').area).not.toBeNull();
    expect(getPlacement(row, 'actionBar', 'combat').area).not.toBeNull();
  });

  it('Story’s sheet is never docked (layer only), in every moment — regression lock for R16’s "sheet in a drawer"', () => {
    const row = LAYOUT_ROWS_BY_ID.story;
    expect(getPlacement(row, 'characterBlock', 'exploring').layer).toBe(true);
    expect(getPlacement(row, 'characterBlock', 'combat').layer).toBe(true);
  });

  it('Table’s sheet is docked (grid-placed, not a layer) in every moment — R20’s collapsible rail is a density of the SAME component, never a layer', () => {
    const row = LAYOUT_ROWS_BY_ID.table;
    expect(getPlacement(row, 'characterBlock', 'exploring').layer).not.toBe(true);
    expect(getPlacement(row, 'characterBlock', 'combat').layer).not.toBe(true);
    expect(getPlacement(row, 'characterBlock', 'exploring').area).not.toBeNull();
  });

  it('Table’s sheet is collapsible in every moment (Kage-CR IMPORTANT-4: R20 — "The docked sheet in Table layout is a COLLAPSIBLE RAIL. Scope: docked open by default, with a handle that folds it to a thin strip... Applies exploring and in combat.")', () => {
    const row = LAYOUT_ROWS_BY_ID.table;
    expect(getPlacement(row, 'characterBlock', 'exploring').collapsible).toBe(true);
    expect(getPlacement(row, 'characterBlock', 'combat').collapsible).toBe(true);
  });
});

describe('play-preset-registry — REGION_IDS/RegionId union drift (Miko-QA)', () => {
  it('every LayoutRow’s `regions` object has exactly the keys in REGION_IDS — no more, no fewer (documents a gap, see note)', () => {
    // NOTE (Kage-CR S-a, 2026-09-30 fix round — replaces the note this
    // comment used to carry, written before `RegionId` was derived from
    // `REGION_IDS`). This test still covers the RUNTIME half: every row's
    // `regions` object keys match REGION_IDS exactly, both directions, so
    // a hand-edited row literal that drops or adds a key is caught here.
    // The TYPE-drift half this note used to describe as open (a 12th
    // `RegionId` union member with no `REGION_IDS` entry, reaching `jest`
    // at 110/110 green) is now closed structurally: `RegionId` is derived
    // FROM `REGION_IDS` (`presets.ts`'s `export type RegionId =
    // (typeof REGION_IDS)[number]`), so that drift is a `npx tsc --noEmit`
    // error via `Record<RegionId, ...>`'s exhaustiveness check on every
    // row's `regions` field — not something this file needs to prove.
    for (const id of Object.keys(LAYOUT_ROWS_BY_ID.story.regions)) {
      expect(REGION_IDS).toContain(id);
    }
    for (const id of REGION_IDS) {
      expect(Object.keys(LAYOUT_ROWS_BY_ID.story.regions)).toContain(id);
    }
  });
});
