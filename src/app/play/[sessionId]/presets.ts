/**
 * TAV-PLAY-SHELL step 6a — the layout-preset registry (decomposition plan
 * §3.1–§3.6; rulings R13/R16/R18–R25, D1–D4). Data and pure logic ONLY: no
 * CSS, no rendering, no change to page.tsx/regions/*. The `PlayShell` that
 * actually reads this (step 6b) is the next item.
 *
 * R16's hard rule, restated: "a preset may arrange, show or hide shared
 * parts; it may never fork a component." This file is that rule encoded as
 * data — three `LayoutRow`s (`story`/`table`/`phone`), each placing every
 * `RegionId` somewhere (a grid `area`) or nowhere (`area: null` + optionally
 * `layer: true` for a dismissible overlay, D1). Presets PLACE, they never
 * UNMOUNT (plan §5 step 6) — see the `visible`/`layer` discussion below.
 *
 * ---------------------------------------------------------------------------
 * RegionId reconciliation (plan §3.2's list vs what `main` actually has,
 * per this task's brief: "if the plan's list and the code disagree, the
 * code wins"). Read from `regions/*.tsx`, `page.tsx`'s remaining inline
 * JSX, and each file's own header comments:
 *
 *  - `topBar`      — plan's single region is TWO DOM nodes today
 *                     (`regions/TopBar.tsx`'s `SessionHead` + `TopBar`
 *                     exports, `data-region="topBarSession"` /
 *                     `"topBarStatus"`), by TopBar.tsx's OWN `debt:` marker
 *                     ("until: step 6 lands ... TopBar becomes the single
 *                     top-of-grid region"). No disagreement with the plan's
 *                     RegionId itself — `topBar` here is the FUTURE merged
 *                     region step 6b builds; the two-DOM-node reality is
 *                     that step's job, not this file's.
 *  - `tableControls` — same shape: `TableControls.tsx`'s `SessionControls` /
 *                     `DmCombatControls` exports (`data-region=
 *                     "tableControlsSession"` / `"tableControlsDm"`), same
 *                     kind of `debt:` marker ("until: step 10 lands").
 *  - `partyStrip`, `sceneStage`, `offers`, `storyLog`, `actionBar`,
 *                     `safetyBanner` — each has exactly one dedicated
 *                     `regions/*.tsx` file already. No disagreement.
 *  - `suzuPresence`  — NOT a dedicated file. `SuzuDM` still renders only
 *                     inside `NarratorStrip` (called from `regions/
 *                     TopBar.tsx`'s `TopBar` export) — TopBar.tsx's own
 *                     comment: "SuzuPresence ... is NOT created here ...
 *                     flagged for step 9". Kept as a RegionId per the
 *                     plan (this registry is forward-looking for step 6b),
 *                     represented today by that nested `SuzuDM` call.
 *  - `characterBlock`— NOT a dedicated file. Represented today by
 *                     `MemberSheetPanel` (the always-available party-member
 *                     drawer) — the one-sheet merge with `/character/[id]`
 *                     is step 7, R24, still pending. Kept per the plan.
 *  - `composer`      — NOT under `regions/`; still `@/components/Composer`,
 *                     imported directly by `page.tsx`. Matches plan §2.3
 *                     ("Composer | existing props minus combat | wrapped,
 *                     shrinks") — it is a real region concern, just not
 *                     relocated. `ActionBar` (see below) already IS
 *                     extracted and Composer renders it as
 *                     `{combat && <ActionBar .../>}`, its first child —
 *                     step 8 landed ahead of this registry.
 *
 * Net: all 11 of the plan's RegionIds are kept. Nothing added, nothing
 * removed — every "disagreement" above is "not yet extracted", not "wrong
 * id", and is noted so step 6b knows which regions it can place today vs
 * which it is placing ahead of their own extraction.
 * ---------------------------------------------------------------------------
 *
 * Rulings vs the pass-2 mockup (`scratchpad/tavern20-second-pass/`), where
 * they disagree — the RULING wins, the mockup is an exploratory visual
 * reference, not a spec:
 *
 *  - R16 says Story's sheet is "in a drawer"; the mockup's Story CSS shows
 *    a persistent docked `.me` card. Followed R16: `characterBlock` is
 *    `layer: true` (never grid-placed) in `story` AND `phone`; only
 *    `table` docks it (`area: 'characterBlock'`, R20's "collapsible rail",
 *    both moments — R20: "applies exploring and in combat").
 *  - D1 ("owner/DM controls are a dismissible layer, not a permanent
 *    column") vs the mockup's persistent `.tools` icon rail: `tableControls`
 *    is `layer: true` in every row — no grid area at all. The mockup's
 *    icon-rail trigger is a rendering detail for step 6b, not this file's
 *    concern.
 *  - `topBar` is a declared co-occupancy (`host: 'sceneStage'`) in `table`
 *    (mirrors the mockup's `.top{grid-area:stage}` / `.init{grid-area:
 *    stage}` — title/initiative float over the stage rather than taking
 *    their own row). No ruling contradicts this, so the mockup stands.
 *    Kage-CR CRITICAL-2 (2026-09-30): originally encoded as a duplicate
 *    `area: 'sceneStage'` string, indistinguishable from a typo and with
 *    no stacking signal for step 6b — replaced with the explicit `host`
 *    field (see `Placement.host`'s own doc) once `phone.partyStrip`/
 *    `phone.suzuPresence` turned out to need the identical mechanism
 *    against `topBar`.
 *  - `offers` has no dedicated grid area in the mockup at all (nested
 *    inside `.story`'s own flex column). Given `Offers` is a real,
 *    independently-mounted region (plan §2.3, code confirms), it gets its
 *    own area here — matching the plan's OWN illustrative §3.2 snippet
 *    ("party story stage" / "party offers stage" / "party composer
 *    stage"), not the mockup's nesting.
 *
 * Amendment A (2026-09-28) on `Offers`/combat: "the region's visibility
 * during combat becomes a Placement row (`regions.offers.combat =
 * { visible: false }`, §3.2) — a row, as §3.6 promises." Implemented
 * literally below in every row: `offers.combat = { area: null, visible:
 * false }`. `Offers` has no aria-live of its own (grepped, see next
 * paragraph) so hiding it never drops an announcement.
 *
 * ---------------------------------------------------------------------------
 * `announces` — derived by grepping every region's OWN file plus (for the
 * three not-yet-extracted regions) the component that stands in for it
 * today, for `aria-live` / `role="status"` / `role="alert"`, transitively
 * through what each region/component actually renders (not guessed):
 *
 *   topBar          — TopBar.tsx: `role="status" aria-live="polite"` (the
 *                      aiOffStatus fallback) + NarratorStrip.tsx's own
 *                      `role="status" aria-live={combatActive?'off':'polite'}`.
 *   partyStrip       — PartyStrip.tsx has none itself, but wraps
 *                      InitiativeTracker.tsx, which has
 *                      `aria-live="polite"` (round indicator) AND
 *                      `role="alert" aria-live="assertive"`.
 *   sceneStage       — SceneStage.tsx: two `role="status" aria-live="polite"`
 *                      nodes (combatNote, autoResolvePrompt).
 *   storyLog         — StoryLog.tsx wraps ChatLog, which has
 *                      `aria-live="polite"` on its `role="log"` root.
 *   actionBar        — ActionBar.tsx: `aria-live="polite"` (not-your-turn),
 *                      `role="alert" aria-live="assertive"` (refused
 *                      reason), `aria-live="polite" aria-atomic="true"`.
 *   composer         — Composer.tsx: `role="alert" aria-live="assertive"`
 *                      (send error) + `role="status" aria-live={disabled?
 *                      'off':'polite'}` (pending).
 *   characterBlock   — MemberSheetPanel.tsx: `aria-busy aria-live="polite"`
 *                      (loading) + `role="alert"` (error).
 *   tableControls    — TableControls.tsx has none itself, but wraps
 *                      DmNarrationPanel.tsx (`role="alert"
 *                      aria-live="assertive"`, ×2 more `role="alert"`) and
 *                      CampaignFloorPanel.tsx (`role="status"
 *                      aria-live="polite"`). ConditionsPanel.tsx's
 *                      `role="alert"` is a duration-hint, same family.
 *   safetyBanner     — SafetyBanner.tsx: `role="status" aria-live="polite"`
 *                      — the R3/Iro-CRITICAL-1 precedent this whole flag
 *                      exists to generalize.
 *
 *   NOT announcing: `offers` (Offers.tsx — no match) and `suzuPresence`
 *   (SuzuDM.tsx — no match; its parent NarratorStrip's announcer is
 *   `topBar`'s, not SuzuDM's own).
 *
 * R3's render-matrix rule ("every announcing region is `data-visible=
 * "true"` in every row × moment") is therefore satisfied by DESIGN below,
 * not by exception: every `announces: true` region (9 of 11) is placed
 * with `visible` left at its default `true` in EVERY row and moment,
 * including `actionBar`/`sceneStage`/`characterBlock`/`tableControls`,
 * whose CONTENT is only ever non-empty during combat or while a layer is
 * open. This is the exact "wrapper mounts unconditionally, only the
 * CONTENT is gated" pattern `page.tsx` already uses for `.deadStatus` /
 * `.durableRetryRow` (see those divs' own comments) — the region
 * component's job, not a reason to remove its mount point from a preset.
 * `layer: true` regions (`characterBlock` outside `table`, `tableControls`
 * everywhere) are likewise never `visible: false`: a layer's own
 * open/closed state is independent of the preset (Drawer invariant A5,
 * "always mounted") and is not this file's concern.
 *
 * Only `offers` (not announcing) ever goes `visible: false` — the one
 * region for which hiding it during combat is both true to the rulings
 * and safe for accessibility.
 */

/**
 * Canonical iteration order — matches the plan's §3.2 listing.
 * Kage-CR IMPORTANT-7 (2026-09-30, verified by M6): `RegionId` is derived
 * FROM this array (`as const`) rather than hand-mirrored alongside it —
 * the same pattern theme.ts already uses for `VIBES`/`Vibe`,
 * `DENSITIES`/`Density` and `LAYOUT_PREFS`/`LayoutPref`. Previously a
 * 12th literal added to the `RegionId` union alone (no `REGION_IDS`
 * edit) reddened `tsc --noEmit` at 3 sites but left every jest suite
 * iterating `REGION_IDS` green (Miko-QA's gap, confirmed measured).
 * Deriving the type makes that drift structurally impossible: the same
 * mutation now reds BOTH `tsc` and the per-region `it()` loops (they grow
 * with the array).
 */
export const REGION_IDS = [
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
] as const;

export type RegionId = (typeof REGION_IDS)[number];

/** Regions that host a live-region announcer (grepped — see file header). */
export const ANNOUNCING_REGIONS: ReadonlySet<RegionId> = new Set<RegionId>([
  'topBar',
  'partyStrip',
  'sceneStage',
  'storyLog',
  'actionBar',
  'composer',
  'characterBlock',
  'tableControls',
  'safetyBanner',
]);

/**
 * Kage-CR IMPORTANT-6 (2026-09-30): `Placement.density` is deliberately
 * opaque to the shell (Guard 1, plan §3.5, "an opaque string to the shell
 * and a union inside the region") — but nothing recorded which values are
 * legal for which region, so a typo or an unsupported value was
 * undetectable by `tsc` and by every test. This table is that missing
 * union, one entry per region that actually has a density axis, derived
 * from the plan's declared per-region unions (§2.3) and this row data
 * (reconciled against three divergences found in review — see each
 * region's own `regions.*` comment for its specific fix):
 *  - `characterBlock` — was `'rail'` in `table` (a third, unplanned value
 *    — R21 says "full sheet + five tabs") and unset in `story`/`phone`
 *    (plan §2.4: "compact = card/drawer"). Now `'full'` / `'compact'`.
 *  - `suzuPresence` is deliberately ABSENT from this table: its real prop
 *    is `size` (plan §2.3: "{mood, size, caption?, aiOff}"), not
 *    `density` — the opaque `density` field carries its value today for
 *    lack of a dedicated slot, but the axis name is wrong, so validating
 *    it against a "density" union would assert the wrong thing.
 * A9b/A9c derive each region's own prop union from this
 * (`(typeof REGION_DENSITIES)['offers'][number]`) instead of
 * hand-writing it a second time.
 */
export const REGION_DENSITIES = {
  partyStrip: ['strip', 'rail'],
  sceneStage: ['inline', 'panel', 'hero'],
  offers: ['chips', 'list'],
  characterBlock: ['compact', 'full'],
  actionBar: ['vitals', 'chips', 'full'],
} as const satisfies Partial<Record<RegionId, readonly string[]>>;

export type Moment = 'exploring' | 'combat';
export type LayoutId = 'story' | 'table' | 'phone';

export interface Placement {
  /** Grid-area name; null = not placed in the grid this moment (either a
   *  `layer` or genuinely absent, e.g. `offers` during combat). */
  area: string | null;
  /** Passed straight to the region. Opaque to the shell (Guard 1, plan
   *  §3.5) — a region's own prop type is the only thing that interprets it. */
  density?: string;
  /** default true; false = display:none, still mounted. Never set true→false
   *  on an `ANNOUNCING_REGIONS` member — see file header. */
  visible?: boolean;
  collapsible?: boolean;
  /** Rendered as an overlay, outside the grid (D1). When true, `area` is
   *  always null — a layer has no grid position to speak of. */
  layer?: boolean;
  /**
   * Kage-CR CRITICAL-2 (2026-09-30): this region is not an independent
   * grid item — it renders INSIDE the named region's area (a declared
   * co-occupancy, e.g. TopBar's title/initiative floating over the scene
   * stage, or Phone's party strip and presence icon living inside the
   * header). The host must itself be placed (non-null `area`) in the
   * same row × moment — enforced by the "grid co-occupancy" guard below.
   * When set, `area` is always null: a hosted region has no grid
   * position of its own, same convention as `layer`.
   */
  host?: RegionId;
}

export interface LayoutRow {
  id: LayoutId;
  label: string;
  /** The grid-template-areas value. */
  areas: Record<Moment, string>;
  /** The grid-template-columns value. Row heights are deliberately NOT part
   *  of this contract (no `rows` field) — sizing per area is a step-6b/
   *  Aoi-UI CSS concern (`--stage-w`/`--stage-h` etc., plan §4.1), not
   *  preset data. */
  columns: Record<Moment, string>;
  regions: Record<RegionId, Partial<Record<Moment, Placement>> & { default: Placement }>;
}

/**
 * Resolves a region's placement for a given moment: the moment-specific
 * override if the row declares one, else the row's `default` for that
 * region. This is the one piece of resolution logic every consumer needs
 * (step 6b's `PlayShell`, and this file's own tests) — kept here rather
 * than re-derived at each call site.
 */
export function getPlacement(row: LayoutRow, region: RegionId, moment: Moment): Placement {
  const entry = row.regions[region];
  // Kage-CR IMPORTANT-7 (2026-09-30): with `RegionId` now derived from
  // `REGION_IDS`, a region added to the union but missing from a row's
  // `regions` literal is a `tsc` error at the call site (`Record<RegionId,
  // ...>`'s exhaustiveness check) — cheap insurance for whoever debugs a
  // white-screened `/play` if that ever slips through anyway (e.g. a
  // runtime-constructed row), naming the region instead of a bare
  // TypeError on `undefined`.
  if (!entry) throw new Error(`no placement for "${region}" in row "${row.id}"`);
  return entry[moment] ?? entry.default;
}

// ---------------------------------------------------------------------------
// STORY — R16: "story column, sheet in a drawer, offers inline". Columns
// reuse today's real proportions in spirit (`Play.module.css`'s current
// `220px 1fr 260px`, plan §2.3's render note) rather than the mockup's
// invented px values.
// ---------------------------------------------------------------------------

const STORY_ROW: LayoutRow = {
  id: 'story',
  label: 'Story',
  columns: {
    exploring: '200px minmax(0,1fr) 280px',
    combat: '200px minmax(0,1fr) 280px',
  },
  areas: {
    exploring: `"safetyBanner safetyBanner safetyBanner"
                "topBar       topBar       partyStrip"
                "suzuPresence storyLog     sceneStage"
                "suzuPresence offers       sceneStage"
                "suzuPresence composer     sceneStage"
                "suzuPresence actionBar    sceneStage"`,
    // Plan §3.2's illustrative snippet says combat "adds actionBar" —
    // stale: `actionBar` is placed in BOTH moments (Kage-CR Q1 ruling,
    // see the `regions.actionBar` entry below); only its density changes.
    // What combat actually does here is move `sceneStage` above `storyLog`
    // and gate `offers` off (Amendment A, a data gate in useScene, not a
    // rendering choice). Kage-CR IMPORTANT-5 (2026-09-30, option (c)):
    // column 3 would otherwise be a dead 280px track below its header row
    // once `characterBlock` is a drawer in this row (R16) — instead of
    // leaving it empty, `partyStrip` takes it full-height as a rail in
    // combat (see the `regions.partyStrip` entry below), mirroring the
    // treatment `table.characterBlock` already gets. Keeps 3 stable
    // tracks across moments (R18: "the stage animates in and the story
    // log never remounts") rather than dropping to 2.
    combat: `"safetyBanner safetyBanner safetyBanner"
             "topBar       topBar       partyStrip"
             "suzuPresence sceneStage   partyStrip"
             "suzuPresence storyLog     partyStrip"
             "suzuPresence composer     partyStrip"
             "suzuPresence actionBar    partyStrip"`,
  },
  regions: {
    topBar: { default: { area: 'topBar' } },
    // Kage-CR IMPORTANT-5 (2026-09-30, option (c)): exploring keeps the
    // header-row strip; combat gives it column 3 full-height as a rail
    // (same density Table's characterBlock rail would use) rather than
    // leaving a dead 280px track.
    partyStrip: {
      default: { area: 'partyStrip', density: 'strip' },
      combat: { area: 'partyStrip', density: 'rail' },
    },
    suzuPresence: { default: { area: 'suzuPresence' } },
    sceneStage: {
      default: { area: 'sceneStage', density: 'panel' },
      combat: { area: 'sceneStage', density: 'hero' },
    },
    storyLog: { default: { area: 'storyLog' } },
    offers: {
      default: { area: 'offers', density: 'chips' },
      combat: { area: null, visible: false },
    },
    // R16: Story's sheet is "in a drawer" — never docked in this preset.
    // Kage-CR IMPORTANT-6 (2026-09-30): density reconciled to plan §2.4
    // ("compact = card/drawer") — was unset.
    characterBlock: { default: { area: null, layer: true, density: 'compact' } },
    // Kage-CR Q1 ruling (2026-09-30, overrules Miko's R16-literal defect):
    // Amendment A already hides `offers` during combat, so dropping the
    // bar too would leave Story-combat with NO way to act at all — that
    // forces the data, no Leon needed. Placed in BOTH moments (`areas`
    // strings already carry the token, unchanged); only the density
    // changes: 'vitals' while exploring (no combat verbs to offer),
    // 'chips' in combat (R16's "offers inline" idiom, now rendered by the
    // bar itself since `offers` is gone).
    actionBar: {
      default: { area: 'actionBar', density: 'vitals' },
      combat: { area: 'actionBar', density: 'chips' },
    },
    composer: { default: { area: 'composer' } },
    tableControls: { default: { area: null, layer: true } },
    safetyBanner: { default: { area: 'safetyBanner' } },
  },
};

// ---------------------------------------------------------------------------
// TABLE — R16: "scene stage, sheet docked open, action bar" (all three
// persistent, not moment-gated — matches the mockup's unconditional
// `.bar{display:flex}` under `[data-layout="table"]`, unlike phone/story).
// R20: the docked sheet is a COLLAPSIBLE RAIL — "docked open by default,
// with a handle that folds it to a thin strip", same in both moments.
// `collapsible: true` is the fold mechanism; `density: 'full'` is R21's
// "full sheet + five tabs" (Kage-CR IMPORTANT-4, 2026-09-30 — the docked
// state is the full sheet, collapsible is what makes it a RAIL when
// folded, not a separate density value).
// ---------------------------------------------------------------------------

const TABLE_ROW: LayoutRow = {
  id: 'table',
  label: 'Table',
  columns: {
    exploring: '160px 150px minmax(0,1fr) 300px',
    combat: '160px 150px minmax(0,1fr) 300px',
  },
  areas: {
    exploring: `"safetyBanner safetyBanner safetyBanner safetyBanner"
                "partyStrip   sceneStage   sceneStage   characterBlock"
                "partyStrip   suzuPresence storyLog     characterBlock"
                "partyStrip   suzuPresence offers       characterBlock"
                "partyStrip   suzuPresence composer     characterBlock"
                "partyStrip   actionBar    actionBar    actionBar"`,
    combat: `"safetyBanner safetyBanner safetyBanner safetyBanner"
             "partyStrip   sceneStage   sceneStage   characterBlock"
             "partyStrip   suzuPresence storyLog     characterBlock"
             "partyStrip   suzuPresence composer     characterBlock"
             "partyStrip   actionBar    actionBar    actionBar"`,
  },
  regions: {
    // Mirrors the mockup's `.top{grid-area:stage}` / `.init{grid-area:stage}`
    // — title + initiative float over the stage rather than owning a row.
    // Kage-CR CRITICAL-2 (2026-09-30): a declared co-occupancy, not a
    // duplicate area string — topBar renders INSIDE sceneStage's area.
    topBar: { default: { area: null, host: 'sceneStage' } },
    partyStrip: { default: { area: 'partyStrip', density: 'rail' } },
    suzuPresence: { default: { area: 'suzuPresence' } },
    sceneStage: { default: { area: 'sceneStage', density: 'hero' } },
    storyLog: { default: { area: 'storyLog' } },
    offers: {
      default: { area: 'offers', density: 'list' },
      combat: { area: null, visible: false },
    },
    characterBlock: { default: { area: 'characterBlock', density: 'full', collapsible: true } },
    actionBar: { default: { area: 'actionBar' } },
    composer: { default: { area: 'composer' } },
    tableControls: { default: { area: null, layer: true } },
    safetyBanner: { default: { area: 'safetyBanner' } },
  },
};

// ---------------------------------------------------------------------------
// PHONE — R16: "ONE layout: A's [Story], gaining B's [Table] action bar in
// combat." Single column; `partyStrip`/`suzuPresence` are declared
// co-occupancies of `topBar` (CRITICAL-2 — inline avatar strip + a small
// always-mounted presence icon, R10's bound "presence must not cost story
// space on a phone" — mirrors the mockup's `.pl.phone .party`/`.suzu`
// living inside/over `.hdr`, not a separate row).
// `sceneStage` density per plan §4.2's 390-wide column (never hidden —
// `inline` while exploring, `panel` in combat, both collapsible).
// ---------------------------------------------------------------------------

const PHONE_ROW: LayoutRow = {
  id: 'phone',
  label: 'Phone',
  columns: {
    exploring: '1fr',
    combat: '1fr',
  },
  areas: {
    exploring: `"safetyBanner"
                "topBar"
                "sceneStage"
                "storyLog"
                "offers"
                "composer"
                "actionBar"`,
    combat: `"safetyBanner"
             "topBar"
             "sceneStage"
             "storyLog"
             "composer"
             "actionBar"`,
  },
  regions: {
    topBar: { default: { area: 'topBar' } },
    // Kage-CR CRITICAL-2 (2026-09-30): declared co-occupancies of `topBar`,
    // not duplicate area strings — both render INSIDE topBar's area.
    partyStrip: { default: { area: null, host: 'topBar', density: 'strip' } },
    suzuPresence: { default: { area: null, host: 'topBar', density: 'compact' } },
    sceneStage: {
      default: { area: 'sceneStage', density: 'inline', collapsible: true },
      combat: { area: 'sceneStage', density: 'panel', collapsible: true },
    },
    storyLog: { default: { area: 'storyLog' } },
    offers: {
      default: { area: 'offers', density: 'chips' },
      combat: { area: null, visible: false },
    },
    // R16 (Phone = Story's arrangement): sheet is a drawer, never docked.
    // Kage-CR IMPORTANT-6 (2026-09-30): density reconciled to plan §2.4
    // ("compact = card/drawer") — was unset.
    characterBlock: { default: { area: null, layer: true, density: 'compact' } },
    actionBar: { default: { area: 'actionBar' } },
    composer: { default: { area: 'composer' } },
    tableControls: { default: { area: null, layer: true } },
    safetyBanner: { default: { area: 'safetyBanner' } },
  },
};

export const LAYOUT_ROWS: readonly LayoutRow[] = [STORY_ROW, TABLE_ROW, PHONE_ROW];

export const LAYOUT_ROWS_BY_ID: Record<LayoutId, LayoutRow> = {
  story: STORY_ROW,
  table: TABLE_ROW,
  phone: PHONE_ROW,
};
