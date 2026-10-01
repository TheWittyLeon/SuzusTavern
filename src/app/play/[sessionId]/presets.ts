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
 *  - Kage-CR S-b (2026-09-30 fix round, carried to A9b): three more
 *    divergences this ledger missed —
 *      - Story places `actionBar` in BOTH moments. The mockup's parts
 *        table says "Story: Not shown; actions are chips" — superseded by
 *        Kage-CR's Q1 ruling: Amendment A already hides `offers` during
 *        combat, so dropping the bar too would leave Story-combat with no
 *        way to act at all, and S3 (ruled after both R16 and the mockup)
 *        forbids the mockup's actual mechanism ("offers become the
 *        actions when the bar isn't showing" — a second combat-submit
 *        surface).
 *      - Story-combat's `partyStrip` takes column 3 full-height as a rail
 *        (Kage-CR IMPORTANT-5 option (c)). The mockup's parts table says
 *        "Party — Story: Header, small portraits" (no rail) — the ruling
 *        avoids a dead 280px track once `characterBlock` is a drawer in
 *        this row (R16), rather than leaving the mockup's header-strip
 *        treatment and the column empty.
 *      - `phone.sceneStage` is placed (non-null area) in BOTH moments.
 *        The mockup's parts table says "Hidden while exploring" — D3/R3
 *        require it stay mounted-and-visible so an announcing region
 *        never goes dark (the X-card/Iro CRITICAL-1 precedent); only its
 *        variant changes (`'inline'` exploring, `'panel'` combat).
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
 * Amendment B.3 (2026-09-30, Sora-Arch — answers Kage-CR 🟡-5/6/7): the
 * three `variant` unions, reconciled. `Placement.variant` is deliberately
 * opaque to the shell (Guard 1, plan §3.5, "an opaque string to the shell
 * and a union inside the region") — this table is the missing record of
 * which values are legal for which region, so a typo or an unsupported
 * value is caught by the guard below instead of being undetectable by
 * `tsc` and by every test.
 *  - `suzuPresence: ['compact','full']` — Kage's option (i). The B.1 rename
 *    removes the objection that excluded it at A9a ("its real prop is
 *    `size`, so validating it against a *density* union asserts the wrong
 *    thing") — presence size **is** a presentational variant: Story's
 *    "figure beside the story" and Table's "framed speaker portrait" differ
 *    in LOOK, not on the size axis. A third value with one emitter would
 *    repeat the `'vitals'` mistake below.
 *  - `characterBlock: ['compact','full','rail']` — `'rail'` is R20's
 *    FOLDED state, reached at runtime from the persisted fold pref (A9c),
 *    and declared in `VARIANTS_NOT_EMITTED_BY_PRESETS` below as not emitted
 *    by any preset row — a declaration, not the accident that killed
 *    `actionBar`'s `'full'`.
 *  - `actionBar: ['chips','bar']` — 🟡-7 taken whole. `'vitals'` was the
 *    name of a DATA prop (`ActionBarProps.vitals`), not a variant; `'full'`
 *    had no emitter. "Vitals only while exploring" is the bar's own
 *    response to an empty `actions` array (data), which is what it already
 *    does — R16's "phone gains the action bar in combat" is therefore
 *    expressed by the bar's CONTENT, and the registry stops claiming a
 *    moment difference it cannot deliver.
 * A9b/A9c derive each region's own prop union from this
 * (`(typeof REGION_VARIANTS)['offers'][number]`) instead of hand-writing it
 * a second time.
 */
export const REGION_VARIANTS = {
  partyStrip: ['strip', 'rail'],
  sceneStage: ['inline', 'panel', 'hero'],
  offers: ['chips', 'list'],
  characterBlock: ['compact', 'full', 'rail'],
  actionBar: ['chips', 'bar'],
  suzuPresence: ['compact', 'full'],
} as const satisfies Partial<Record<RegionId, readonly string[]>>;

/**
 * Amendment B.3: union members that are legal but never emitted by a
 * preset ROW — reached only at runtime, from a persisted preference. A
 * guard below asserts every `REGION_VARIANTS` member is either emitted by
 * some row or named here; an un-exempted, un-emitted member is a dead slot
 * (the durability red flag "declared field with zero readers" pointed the
 * other way — a declared UNION member nobody can reach).
 */
export const VARIANTS_NOT_EMITTED_BY_PRESETS: Partial<Record<RegionId, readonly string[]>> = {
  characterBlock: ['rail'],
};

/**
 * Amendment B.4 (2026-09-30, Sora-Arch — answers S6, the un-regioned
 * nodes). §2.3's region table is not total: `page.tsx` renders several
 * live-region nodes, `CastSpellPanel`, `NextPartOffer`, `DiceTray` and the
 * safety/X-card block, none of which is independently placed and
 * therefore none of which is a region.
 *
 * The distinction, stated once: *placed independently by a row ⇒ a
 * REGION; rides inside a placed region ⇒ a TENANT; placed by its own
 * overlay host ⇒ a LAYER; the root, the slots and (until A9d) the mobile
 * tab bar ⇒ SHELL CHROME.*
 *
 * A tenant renders inside its host's slot element, carries
 * `data-tenant="<id>"` and never a `data-region`. R3's rule extends: an
 * announcing tenant's `host` must be a region that is placed and NEVER
 * `visible: false` and NEVER `layer: true` in any row × moment — the
 * X-card / Iro CRITICAL-1 failure caught one field deeper than 🟡-2
 * caught it (presets.ts's own `host` guard, C0). `tableControls`'s two
 * DOM pieces (`SessionControls`/`DmCombatControls`) are deliberately NOT
 * here — `tableControls` is already a declared REGION (with `layer:true`
 * in every row); their 6b placement is `PlayShell`'s own `debt:`-marked
 * call-site decision (build brief §6.5), not a tenant declaration.
 */
export const TENANT_IDS = [
  'sessionRecap',
  'sessionPausedEnded',
  'turnStatus',
  'deadStatus',
  'durableRetryRow',
  'castSpellPanel',
  'nextPartOffer',
  'diceTray',
  'safetyControls',
] as const;

export type TenantId = (typeof TENANT_IDS)[number];

export interface TenantPlacement {
  /** The region whose grid slot this tenant renders inside. */
  host: RegionId;
  /** Whether this tenant carries a live-region announcer of its own
   *  (`aria-live` / `role="status"` / `role="alert"`) — grepped against
   *  its actual source, same discipline as `ANNOUNCING_REGIONS` above. */
  announces: boolean;
}

/**
 * `announces` — grepped against each tenant's own file/JSX:
 *   sessionRecap        — `aria-live="polite"` wrapper (tenants/StatusAnnouncers.tsx).
 *   sessionPausedEnded  — `role="status" aria-live="polite"` (tenants/StatusAnnouncers.tsx).
 *   turnStatus          — `role="status" aria-live="polite"`, combat-gated (tenants/StatusAnnouncers.tsx).
 *   deadStatus          — `role="status" aria-live="polite"`, always mounted (tenants/StatusAnnouncers.tsx).
 *   durableRetryRow     — `role="status" aria-live="polite"` (tenants/StatusAnnouncers.tsx).
 *   castSpellPanel      — CastSpellPanel.tsx's own 4 internal announcers (tenants/CastSpellTenant.tsx).
 *   nextPartOffer       — NextPartOffer.tsx: root is `<Card role="status">`
 *                         (an implicit live region, `aria-live="polite"`
 *                         by the ARIA spec default for `status`) — caught
 *                         on re-grep; an earlier pass of this comment
 *                         wrongly called it non-announcing.
 *   NOT announcing: `diceTray` (DiceTray.tsx — no match), `safetyControls`
 *   (plain button + copy, no match).
 *
 * `safetyControls` host (A9b fix round 1, Miko Imp-5 + Aoi B2): `actionBar`,
 * not `sceneStage`. The stage is a capped (`minmax(0,400px)` in Table
 * combat), scrolling slot; the X-card sat below its fold. The invariant is
 * that the X-card raise control is on screen without scrolling the page or
 * any nested container, in every row x moment — so its host must be a
 * placed, always-visible region whose rows are all `auto` (content-sized,
 * never a capped scroller). `actionBar` is the bottom band in every row,
 * has the horizontal room beside the combat buttons (no extra height in
 * combat), and in exploring the control is what justifies the otherwise
 * empty track. Pinned in `play-preset-registry.test.ts`. NOT `safetyBanner`:
 * that slot must be 0px when no signal is active (the live-region band).
 */
export const REGION_TENANTS: Record<TenantId, TenantPlacement> = {
  sessionRecap: { host: 'storyLog', announces: true },
  sessionPausedEnded: { host: 'storyLog', announces: true },
  turnStatus: { host: 'storyLog', announces: true },
  deadStatus: { host: 'storyLog', announces: true },
  durableRetryRow: { host: 'storyLog', announces: true },
  castSpellPanel: { host: 'storyLog', announces: true },
  nextPartOffer: { host: 'storyLog', announces: true },
  diceTray: { host: 'sceneStage', announces: false },
  safetyControls: { host: 'actionBar', announces: false },
};

export type Moment = 'exploring' | 'combat';
export type LayoutId = 'story' | 'table' | 'phone';

export interface Placement {
  /** Grid-area name; null = not placed in the grid this moment (either a
   *  `layer` or genuinely absent, e.g. `offers` during combat). */
  area: string | null;
  /**
   * Amendment B.1 (2026-09-30, Sora-Arch — answers Kage-CR 🟡-8): renamed
   * from `density`. `theme.ts`'s site-wide density axis (`DENSITIES`,
   * `data-density`, `--density-pad`/`--density-gap`) already owns that
   * word, and `'compact'` is a legal member of BOTH vocabularies — a region
   * reading `--density-pad` from the cascade while also receiving
   * `density="compact"` as a placement input is ambiguous by construction.
   * `variant` is the repo's existing word for a presentational form of one
   * component (`SessionRecap variant="strip"`) — reuse beats invention.
   * Passed straight to the region. Opaque to the shell (Guard 1, plan
   * §3.5) — a region's own prop type is the only thing that interprets it.
   */
  variant?: string;
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
  /** The grid-template-columns value. Per-area sizing (`--stage-w`/
   *  `--stage-h` etc., plan §4.1) is a step-6b/Aoi-UI CSS concern, not
   *  preset data — but TRACK sizing (this field and `rows` below) is the
   *  same kind of thing as `columns` already was, one track list per
   *  moment. */
  columns: Record<Moment, string>;
  /**
   * Amendment B.2 (2026-09-30, Sora-Arch — a gap, not a preference):
   * grid-template-rows, beside `columns`. `/play` is
   * `height: calc(100dvh - var(--env-banner-h))` with `overflow: hidden`
   * (`Play.module.css`) — today the three panes are the scroll containers;
   * once regions are grid items, `auto`-sized bands in a fixed-height grid
   * CLIP (no `1fr`, nothing scrolls). Guard S1 extends: the track count
   * here equals the line count in `areas[moment]`. Values are Aoi/step-11's
   * to tune at the post-A9d checkpoint — this field makes that a row edit,
   * not a CSS hunt.
   */
  rows: Record<Moment, string>;
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
    // Amendment B §5 "aiOff edge": column 1 is `suzuPresence`'s track.
    // `TopBar` only renders `NarratorStrip` (and therefore `SuzuDM`) when
    // `showSuzuPanel` — an `ai_assist_level:'off'` session leaves this
    // column empty. `auto` lets an empty slot collapse instead of holding
    // open a dead 200px column (the same shape as IMPORTANT-5's dead
    // 280px, one column over). Column 3 (S-c): `280px` was sized for the
    // exploring-moment stage card; combat now holds a party rail there
    // instead — `200px` fits the rail without the extra width the stage
    // card wanted. Checkpoint settles the exact value; this is data.
    exploring: 'auto minmax(0,1fr) 280px',
    combat: 'auto minmax(0,1fr) 200px',
  },
  // Amendment B.2: grid-template-rows, one track per `areas` line. Starting
  // values (build brief §7 C1) — Aoi/step 11 tunes them at the checkpoint.
  // Ren-Dev, A9b self-check (found via live-browser measurement, not
  // guessed): row 2 (`topBar`+`partyStrip`'s shared band) was `auto` —
  // `PartyStrip.tsx` doesn't yet read its own `variant` prop (R25/S7's
  // "strip" is supposed to mean a compact header-band representation;
  // the component always renders the SAME full roster+rebind+initiative
  // content regardless, same "contract ahead of implementation" shape as
  // S-d's characterBlock) — measured at 502px tall. An `auto` track
  // inflated to fit it, squeezing `storyLog`'s `minmax(0,1fr)` track to
  // 0px (measured: the chat log was present in the DOM, `data-visible=
  // "true"`, zero RENDERED height — the X-card-shaped failure one layer
  // down, a layout collapse instead of a visibility one). Capped to a
  // fixed `140px` (measured: the merged TopBar's own content is 113px);
  // `partyStrip`'s slot already carries `.slotScroll` (`overflow-y:auto`)
  // so its excess content scrolls within the band instead of inflating
  // it. This is a ROW EDIT (data), not a CSS hunt or a PartyStrip
  // rewrite — the real fix (a compact `'strip'` rendering PartyStrip.tsx
  // doesn't implement yet) is Aoi/step-11 territory; flagged, not built
  // here. `debt:` not used — the STARTING VALUES in this field are
  // already understood repo-wide (build brief §7 C1) to be the Aoi/A9d
  // checkpoint's own tuning target, not a hidden shortcut.
  rows: {
    exploring: 'auto 140px minmax(0,1fr) auto auto auto',
    combat: 'auto 140px minmax(0,340px) minmax(0,1fr) auto auto',
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
    // see the `regions.actionBar` entry below); only its variant changes.
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
    // (same variant Table's characterBlock rail would use) rather than
    // leaving a dead 280px track.
    partyStrip: {
      default: { area: 'partyStrip', variant: 'strip' },
      combat: { area: 'partyStrip', variant: 'rail' },
    },
    // Amendment B.3 (🟡-5, Kage's option (i)): presence size IS preset
    // data — Story gives it a full-height column, so it emits `'full'`.
    suzuPresence: { default: { area: 'suzuPresence', variant: 'full' } },
    sceneStage: {
      default: { area: 'sceneStage', variant: 'panel' },
      combat: { area: 'sceneStage', variant: 'hero' },
    },
    storyLog: { default: { area: 'storyLog' } },
    offers: {
      default: { area: 'offers', variant: 'chips' },
      combat: { area: null, visible: false },
    },
    // R16: Story's sheet is "in a drawer" — never docked in this preset.
    // Kage-CR IMPORTANT-6 (2026-09-30): variant reconciled to plan §2.4
    // ("compact = card/drawer") — was unset.
    characterBlock: { default: { area: null, layer: true, variant: 'compact' } },
    // Amendment B.3 (🟡-7, supersedes the Kage-CR Q1 ruling's density
    // split): `actionBar`'s union is now `['chips','bar']` — Story emits
    // `'chips'` in BOTH moments (R16's "offers inline" idiom; `'vitals'`
    // was the name of a DATA prop, not a variant, and is deleted).
    // "Vitals only while exploring" is the bar's own response to an empty
    // `actions` array, which keeps Q1's reasoning intact: Amendment A
    // already hides `offers` during combat, so the bar stays the one way
    // to act in Story-combat either way. Placed in BOTH moments; `areas`
    // strings already carry the token, unchanged.
    actionBar: { default: { area: 'actionBar', variant: 'chips' } },
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
// `collapsible: true` is the fold mechanism; `variant: 'full'` is R21's
// "full sheet + five tabs" (Kage-CR IMPORTANT-4, 2026-09-30 — the docked
// state is the full sheet, collapsible is what makes it a RAIL when
// folded, not a separate variant value).
// ---------------------------------------------------------------------------

const TABLE_ROW: LayoutRow = {
  id: 'table',
  label: 'Table',
  columns: {
    // Amendment B §5 "aiOff edge": column 2 is `suzuPresence`'s track —
    // `auto` lets an `ai_assist_level:'off'` session's empty slot collapse
    // instead of holding open a dead 150px column (see STORY_ROW's
    // identical column-1 comment).
    // A9b fix round 1: column 4 is `characterBlock`'s docked rail
    // (R20) — `fit-content` so FOLDING it (FoldDock) gives the space back;
    // 300px is the open cap, owned here and nowhere else.
    exploring: '160px auto minmax(0,1fr) fit-content(300px)',
    combat: '160px auto minmax(0,1fr) fit-content(300px)',
  },
  rows: {
    exploring: 'auto 218px minmax(0,1fr) auto auto auto',
    combat: 'auto minmax(0,400px) minmax(0,1fr) auto auto',
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
    partyStrip: { default: { area: 'partyStrip', variant: 'rail' } },
    // Amendment B.3 (🟡-5): presence size is preset data — Table gives it
    // a "framed speaker portrait" treatment, `'full'`.
    suzuPresence: { default: { area: 'suzuPresence', variant: 'full' } },
    sceneStage: { default: { area: 'sceneStage', variant: 'hero' } },
    storyLog: { default: { area: 'storyLog' } },
    offers: {
      default: { area: 'offers', variant: 'list' },
      combat: { area: null, visible: false },
    },
    characterBlock: { default: { area: 'characterBlock', variant: 'full', collapsible: true } },
    // Amendment B.3 (🟡-7): `'bar'`, Table's bottom-always treatment.
    actionBar: { default: { area: 'actionBar', variant: 'bar' } },
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
// `sceneStage` variant per plan §4.2's 390-wide column (never hidden —
// `inline` while exploring, `panel` in combat, both collapsible).
// ---------------------------------------------------------------------------

const PHONE_ROW: LayoutRow = {
  id: 'phone',
  label: 'Phone',
  columns: {
    exploring: '1fr',
    combat: '1fr',
  },
  // Ren-Dev, A9b self-check: same finding as STORY_ROW's own comment on
  // `rows` above — row 2 (`topBar`, HOSTING `partyStrip`+`suzuPresence`
  // on phone — three pieces stacked in one slot, no separate scroll
  // container of their own) was `auto` and measured at 680px (146 +
  // 502 + 32) against a viewport with ~810px total to share across
  // seven rows, squeezing `storyLog` to 44px. Capped to `160px`
  // (phone's narrower column wraps topBar's own text more than
  // desktop's 113px) — `.slot`'s own `overflow-y:auto` (added in this
  // same self-check pass) lets the excess scroll instead of bleeding
  // into `sceneStage`'s row below.
  rows: {
    exploring: 'auto 160px auto minmax(0,1fr) auto auto auto',
    combat: 'auto 160px minmax(0,34vh) minmax(0,1fr) auto auto',
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
    partyStrip: { default: { area: null, host: 'topBar', variant: 'strip' } },
    suzuPresence: { default: { area: null, host: 'topBar', variant: 'compact' } },
    sceneStage: {
      default: { area: 'sceneStage', variant: 'inline', collapsible: true },
      combat: { area: 'sceneStage', variant: 'panel', collapsible: true },
    },
    storyLog: { default: { area: 'storyLog' } },
    offers: {
      default: { area: 'offers', variant: 'chips' },
      combat: { area: null, visible: false },
    },
    // R16 (Phone = Story's arrangement): sheet is a drawer, never docked.
    // Kage-CR IMPORTANT-6 (2026-09-30): variant reconciled to plan §2.4
    // ("compact = card/drawer") — was unset.
    characterBlock: { default: { area: null, layer: true, variant: 'compact' } },
    // Amendment B.3 (🟡-7): `'bar'`, matching Table — the bar's own
    // content (not the registry) is what expresses R16's "Phone gains the
    // action bar in combat".
    actionBar: { default: { area: 'actionBar', variant: 'bar' } },
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
