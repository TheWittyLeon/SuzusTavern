/**
 * Miko-QA, A9a review (TAV-PLAY-SHELL step 6a, `presets.ts`).
 *
 * `play-preset-registry.test.ts` (the item's own pin, 110 cases) proves the
 * registry is INTERNALLY consistent — every RegionId has a row, no orphan
 * grid areas, announcing regions never go invisible. None of that checks
 * whether a row's CONTENT is faithful to what was actually ruled. This file
 * adds that second layer: per-row/per-moment assertions traced to specific
 * rulings, for the regions the rulings gate explicitly.
 *
 * Headline finding: `actionBar` is placed (`area: 'actionBar'`, non-null)
 * in the STORY row in both moments. Per R16 ("Tavern 2.0 — Rulings",
 * Round 5): Story = "story column, sheet in a drawer, offers inline" —
 * action bar is not one of Story's three listed parts, in either moment.
 * Table = "scene stage, sheet docked open, action bar" (action bar named
 * ONLY here) and Auto = "Story while exploring, Table in combat" — i.e.
 * Auto SWITCHES to the Table LayoutId in combat, it does not graft an
 * action bar onto Story. Phone = "gaining B's [Table's] action bar in
 * combat" is the one stated exception, and it is PHONE's, not Story's.
 * The layout authority mockup (`scratchpad/tavern20-second-pass/index.html`)
 * agrees byte-for-byte: `.pl.desk[data-layout="story"] .bar` is never
 * overridden off its base `display:none` (contrast
 * `.pl.desk[data-layout="table"] .bar{display:flex}`, unconditional), and
 * the page's own parts×preset table states outright: "Action bar … Story:
 * Not shown; actions are chips."
 *
 * `presets.ts`'s own header traces this decision to the decomposition
 * plan's §3.2 illustrative snippet ("`story` combat moves `stage` above
 * `story` and adds `actionBar`") — but that snippet predates neither R16
 * nor the mockup; both were already ruled/drawn before the plan cites them,
 * and both disagree with it on this one point. `presets.ts`'s own stated
 * priority order is "Rulings vs the pass-2 mockup … the RULING wins, the
 * mockup is an exploratory visual reference, not a spec" — by that same
 * logic, where the PLAN's illustrative text and the RULING disagree, the
 * ruling wins there too, and here it does not appear to have been checked.
 *
 * These assertions run against the REAL registry (no mutation) — every one
 * failing below is a live defect at HEAD, not a hypothetical.
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

  it('Story never places actionBar, in EITHER moment (R16: Story = "story column, sheet in a drawer, offers inline" — no action bar listed, in any moment)', () => {
    const row = LAYOUT_ROWS_BY_ID.story;
    expect(getPlacement(row, 'actionBar', 'exploring').area).toBeNull();
    expect(getPlacement(row, 'actionBar', 'combat').area).toBeNull();
  });

  it('Story’s grid-template-areas literally does not name "actionBar" in either moment (catches a fix that nulls Placement.area but leaves the token in the CSS string — orphaned, but easy to miss by eye)', () => {
    const row = LAYOUT_ROWS_BY_ID.story;
    expect(row.areas.exploring).not.toMatch(/\bactionBar\b/);
    expect(row.areas.combat).not.toMatch(/\bactionBar\b/);
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
});

describe('play-preset-registry — REGION_IDS/RegionId union drift (Miko-QA)', () => {
  it('every LayoutRow’s `regions` object has exactly the keys in REGION_IDS — no more, no fewer (documents a gap, see note)', () => {
    // NOTE (not a fix, a finding): this test can only compare REGION_IDS
    // against the object keys actually WRITTEN in presets.ts's three row
    // literals. If a new member is added to the `RegionId` union but
    // omitted from REGION_IDS *and* from a row's `regions` literal, this
    // test — and every test in play-preset-registry.test.ts that iterates
    // REGION_IDS — stays green, because nothing here can see the TYPE
    // union at runtime. Only `npx tsc --noEmit` catches that specific
    // omission today, via `Record<RegionId, ...>`'s exhaustiveness check
    // on the `regions` field — and only once someone DOES add a row entry
    // (forced by that same tsc check) does REGION_IDS's silent omission
    // become "region has full Placement data but is never iterated/
    // rendered", which is invisible to both tsc and jest. Reproduced by
    // hand: adding a 12th literal to the `RegionId` union alone (no other
    // edit) reds 3 `tsc --noEmit` checks but leaves `jest
    // play-preset-registry.test.ts` at 110/110 green. Recommended fix:
    // derive `RegionId` FROM `REGION_IDS` (`export const REGION_IDS =
    // [...] as const; export type RegionId = (typeof REGION_IDS)[number];`)
    // — the exact pattern this same diff already uses for `VIBES`/`Vibe`,
    // `DENSITIES`/`Density` and `LAYOUT_PREFS`/`LayoutPref` in theme.ts, a
    // few lines away. That makes drift structurally impossible instead of
    // relying on a human to keep two hand-written lists in sync.
    for (const id of Object.keys(LAYOUT_ROWS_BY_ID.story.regions)) {
      expect(REGION_IDS).toContain(id);
    }
    for (const id of REGION_IDS) {
      expect(Object.keys(LAYOUT_ROWS_BY_ID.story.regions)).toContain(id);
    }
  });
});
