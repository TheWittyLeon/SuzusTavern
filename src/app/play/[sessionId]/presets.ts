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
 *  - `topBar` overlays the stage in `table` (mirrors the mockup's
 *    `.top{grid-area:stage}` — the title floats over the stage rather than
 *    taking its own row). No ruling contradicts this, so the mockup stands.
 *    A9c C4: encoded as `anchor: 'top-start'` on `area: 'sceneStage'`
 *    (Amendment C.1). Kage-CR CRITICAL-2 (2026-09-30) first encoded it as a
 *    `host` field; A9c C4 superseded that for Table, and A9d E2 retired the
 *    field with its last two emitters (phone's party strip and presence):
 *    every region is a top-level slot in every row, so a row switch MOVES a
 *    region and never re-parents (remounts) it.
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

import { REGION_VARIANTS, isRegionVariant, type RegionVariant, type VariantRegionId } from './variants';

export { REGION_VARIANTS };
export type { RegionVariant, VariantRegionId };
export { isRegionVariant };

/**
 * Amendment B.3: union members that are legal but never emitted by a
 * preset ROW — reached only at runtime, from a persisted preference. A
 * guard below asserts every `REGION_VARIANTS` member is either emitted by
 * some row or named here; an un-exempted, un-emitted member is a dead slot
 * (the durability red flag "declared field with zero readers" pointed the
 * other way — a declared UNION member nobody can reach).
 */
export const VARIANTS_NOT_EMITTED_BY_PRESETS: Partial<Record<RegionId, readonly string[]>> = {};
// (A9c C7, Amendment C.4: `characterBlock`'s `'rail'` was the only entry. The
// fold is the shell's generic mechanism, so a folded sheet is the same
// CharacterBlock behind its handle, not a second variant. The map stays so a
// future runtime-only member has a declared home; its guard is unchanged.)

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
 *                         Folded behind a disclosure by default (A9c-2 D7), so
 *                         while folded they are `hidden` and say nothing:
 *                         `turnStatus` stays the SOLE turn announcer (A4), and
 *                         the panel's "Waiting for your turn…" is a visible
 *                         echo of it, never the only channel. `announces`
 *                         stays true: the host must still never be
 *                         `visible:false` / a layer, or an UNFOLDED panel
 *                         would stop announcing its load/empty/error states.
 *   nextPartOffer       — NextPartOffer.tsx: root is `<Card role="status">`
 *                         (an implicit live region, `aria-live="polite"`
 *                         by the ARIA spec default for `status`) — caught
 *                         on re-grep; an earlier pass of this comment
 *                         wrongly called it non-announcing.
 *   NOT announcing: `diceTray` (DiceTray.tsx — no match), `safetyControls`
 *   (plain button + copy, no match).
 *
 * `safetyControls` host (A9b fix round 1, Miko Imp-5 + Aoi B2): `actionBar`,
 * not `sceneStage`. The stage is a capped (`fit-content(400px)` in Table
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
  castSpellPanel: { host: 'actionBar', announces: true },
  nextPartOffer: { host: 'storyLog', announces: true },
  diceTray: { host: 'sceneStage', announces: false },
  safetyControls: { host: 'actionBar', announces: false },
};

export type Moment = 'exploring' | 'combat';
export type LayoutId = 'story' | 'table' | 'phone';

/**
 * A9c C4 (Amendment C.1) — the four corners an overlay can anchor to. The
 * shell maps ANY anchor generically (`top|bottom` -> `align-self`,
 * `start|end` -> `justify-self`, through `data-anchor` attribute selectors in
 * `Play.module.css`), so a corner no row emits yet costs nothing and still has
 * a reader: the tenth overlay is one row (`area` + `anchor`), no code.
 */
export const ANCHORS = ['top-start', 'top-end', 'bottom-start', 'bottom-end'] as const;
export type Anchor = (typeof ANCHORS)[number];

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
  /**
   * A9c C4 (Amendment C.1): `area` names ANOTHER region's area this moment.
   * This region is its own keyed grid item there (never inside the owner's
   * scroller, so the owner's scroll position is untouched), self-aligned to
   * this corner, stacked above the area's owner and content-sized. A
   * top-level slot in every row, so a row switch only MOVES it. Requires
   * `area != null` and no `layer` (guard C1-a); the area's owner must be
   * placed and never hidden (C1-c), and never collapsible (C1-d: a folded
   * owner shrinks to its handle row, so any corner collides).
   */
  anchor?: Anchor;
  /** default true; false = display:none, still mounted. Never set true→false
   *  on an `ANNOUNCING_REGIONS` member — see file header. */
  visible?: boolean;
  collapsible?: boolean;
  /** Rendered as an overlay, outside the grid (D1). When true, `area` is
   *  always null — a layer has no grid position to speak of. */
  layer?: boolean;
}

export interface LayoutRow {
  id: LayoutId;
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
  /**
   * A9d: extra `--play-*` custom properties for this row, emitted on `.grid` beside
   * the three track lists. Absent = the desktop defaults. The phone row sets
   * `--play-slot-edge` (what each slot spends top and bottom, as a transparent border,
   * see `.slot` in `Play.module.css`) and zeroes `--play-slot-pad`: seven slots at
   * 2 x 16px is 224px of an 844px screen.
   */
  vars?: Readonly<Record<`--play-${string}`, string>>;
  /**
   * A9d-2 (Kage A9d-1 I-1): the same, per moment, for a number that differs between exploring and
   * combat because the log slot's own chrome does (the recap strip exists in one, the status line in
   * the other). Emitted after `vars`, so a moment's value wins. Absent = none.
   */
  momentVars?: Partial<Record<Moment, Readonly<Record<`--play-${string}`, string>>>>;
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

/**
 * A9c C3 (build brief §3-§4, Amendment C.2) — the DOM order of `/play`'s
 * regions for one row x moment, as data. Pure, beside `getPlacement`; the shell
 * (`PlayShell`) only ever walks this list, it never derives order itself.
 *
 * Moved here from `PlayShell.deriveDomOrder` so the order can be pinned as
 * literals in the registry test (and on the real page) instead of being an
 * implementation detail of a component.
 *
 * Rules:
 *   1. Row-major, first appearance of each token in `row.areas[moment]` (the
 *      visual order: focus order follows what the eye sees, WCAG 2.4.3).
 *      Only tokens that name a `REGION_IDS` member placed in the grid
 *      (`area != null`, not a layer) become a `slot`.
 *   2. C.2: an area-less, non-layer region (`offers` in combat) is
 *      a `hidden` slot, emitted IMMEDIATELY AFTER its nearest `REGION_IDS`
 *      predecessor already in the sequence. Appending it last made the
 *      composer and the action bar shift one place on every moment flip (three
 *      DOM moves on a Story combat edge, one of them the composer); this
 *      makes the hidden slot's position stable, so a moment flip moves none
 *      of the visible regions.
 *   3. Layers (`layer: true`) own no DOM slot and are not listed.
 *   4. C4 (C.1): an ANCHORED region (`placement.anchor`) is an `overlay`: its
 *      own top-level slot, listed with the area it sits on — its `top-*`
 *      overlays, then the area's owner, then its `bottom-*` overlays (each
 *      group in `REGION_IDS` order). Never inside the owner's slot.
 *
 *   A9d E2: there is no `hosted` entry any more. `Placement.host` had two
 *   emitters (phone's party strip and presence); both are top-level slots now,
 *   so every region in the list is its own DOM node in every row.
 */
export type SlotEntry =
  | { id: RegionId; kind: 'slot' | 'hidden' }
  | { id: RegionId; kind: 'overlay'; anchor: Anchor; area: string };

export function slotOrder(row: LayoutRow, moment: Moment): SlotEntry[] {
  const regionIds: ReadonlySet<string> = new Set(REGION_IDS);
  const seen = new Set<string>();
  const tokens: RegionId[] = [];
  for (const quotedRow of row.areas[moment].matchAll(/"([^"]*)"/g)) {
    for (const token of quotedRow[1].trim().split(/\s+/)) {
      if (token === '.' || seen.has(token) || !regionIds.has(token)) continue;
      seen.add(token);
      tokens.push(token as RegionId);
    }
  }

  // Overlays (C.1) by the area they sit on, in REGION_IDS order.
  const overlaysByArea = new Map<string, Extract<SlotEntry, { kind: 'overlay' }>[]>();
  for (const id of REGION_IDS) {
    const { area, anchor, layer } = getPlacement(row, id, moment);
    if (anchor == null || area == null || layer === true) continue;
    const list = overlaysByArea.get(area) ?? [];
    list.push({ id, kind: 'overlay', anchor, area });
    overlaysByArea.set(area, list);
  }

  const order: SlotEntry[] = [];
  for (const id of tokens) {
    const placement = getPlacement(row, id, moment);
    if (placement.layer === true || placement.area == null) continue;
    // An anchored region is placed through its owner's token, not its own.
    if (placement.anchor != null) continue;
    // Its top-* overlays, then its owner, then its bottom-* overlays: focus
    // order follows the eye (WCAG 2.4.3), and a top-start title is read first.
    const overlays = overlaysByArea.get(placement.area) ?? [];
    order.push(...overlays.filter((o) => o.anchor.startsWith('top-')));
    order.push({ id, kind: 'slot' });
    order.push(...overlays.filter((o) => o.anchor.startsWith('bottom-')));
  }

  // C.2: hidden (area-less) slots, in REGION_IDS order, each after its nearest
  // predecessor already in the sequence (a later hidden region may therefore
  // follow an earlier hidden one); at the front if it has none.
  REGION_IDS.forEach((id, index) => {
    const placement = getPlacement(row, id, moment);
    if (placement.layer === true || placement.area != null) return;
    let insertAt = 0;
    for (let i = index - 1; i >= 0; i--) {
      const at = order.findIndex((entry) => entry.id === REGION_IDS[i]);
      if (at !== -1) {
        insertAt = at + 1;
        break;
      }
    }
    order.splice(insertAt, 0, { id, kind: 'hidden' });
  });

  return order;
}

/**
 * A9c C4 (build brief §6) — the one read site for a placement's `variant`,
 * typed as the REGION's own union. Throws, naming row/region/moment, on a
 * value outside `REGION_VARIANTS[region]`: unreachable on the real rows
 * (the registry guard holds), so it fails loudly for a runtime-built row
 * rather than letting a typo render as the region's default.
 */
export function variantFor<R extends VariantRegionId>(
  row: LayoutRow,
  region: R,
  moment: Moment,
): RegionVariant<R> | undefined {
  const { variant } = getPlacement(row, region, moment);
  if (variant === undefined) return undefined;
  if (!isRegionVariant(region, variant)) {
    throw new Error(
      `"${variant}" is not a declared variant of "${region}" (row "${row.id}", ${moment})`,
    );
  }
  return variant;
}

// ---------------------------------------------------------------------------
// STORY — R16: "story column, sheet in a drawer, offers inline". Columns
// reuse today's real proportions in spirit (`Play.module.css`'s current
// `220px 1fr 260px`, plan §2.3's render note) rather than the mockup's
// invented px values.
// ---------------------------------------------------------------------------

const STORY_ROW: LayoutRow = {
  id: 'story',
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
  // History (A9b self-check, measured live): row 2 (`topBar` + `partyStrip`'s
  // shared band) was `auto` while `PartyStrip` rendered the full roster
  // whatever its variant, measured 502px, and squeezed `storyLog`'s
  // `minmax(0,1fr)` to 0px; it was capped at `140px` as a stop-gap.
  // A9c-2 D1 gave `partyStrip` its real `strip` form (a row of 44px tiles) and
  // D2 gave `offers` its `chips` form, so both bands are content-sized again:
  // row 2 and the offers row are `auto`, the cap and the `debt:` it carried
  // are gone. A track still never shrinks below its content here because the
  // stage is the only capped sibling and the log is the `1fr` that absorbs.
  // A9c-2 D0: the LAST track (the `actionBar` area, which hosts the X-card) is
  // `max-content`, not `auto`. A grid item that is a scroll container (every
  // `.slot`) has a minimum contribution of 0, so an `auto` track can be shrunk
  // by the "maximize tracks" step when a greedy capped sibling (the stage's
  // `minmax(0,Npx)` at the time; now `fit-content`) eats the free space: on phone with the X-card banner up it
  // lost 9px and the X-card was clipped (harness (c), 809..853 of 844).
  // `max-content` takes its base size from the content, so it is never shrunk.
  // A9c-2 D7: the combat stage track is `fit-content(290px)`, content-sized up to
  // R19's cap, instead of `minmax(0,290px)`, which grows to its cap whatever the
  // stage holds. It returns 0px today: the stage holds the dice tray AND its
  // quick-check list (>=556px of content, probed with the cap at 900px), so the
  // track sits at its 290px cap, and it STAYS at 290 with the tray out of the stage
  // (Kage's A9c-2 review measurement), so the cap is not the lever here at all.
  // Measured inner log (a:storyLog, desktop 1440x900) after A9d R-1 lever 2 (the recap strip
  // steps aside in combat): g 226, caster cell l 213, and the X-card-raised caster cell k 105.
  // The recap lever took every cell without the X-card banner past 200. The banner (a raised
  // safety row above the stage) is what is left on k.
  // debt: the harness combat floor stays 100px, not 200: Story's X-card-raised cell (k-story-combat-caster-xcard) measures 105px inner (plain cells 213-226).
  // ceiling: 105px on a 900px desktop with the X-card banner up, ~3 narration rows; the banner and the stage's 290px track both stay.
  // until: Aoi rules the banner-up combat cell (an inline X-card, or the stage giving the banner its rows), or the harness floor models the banner as its own moment (Backlog TAV-COMBAT-LOG-FLOOR-200); then raise COMBAT to 200.
  rows: {
    exploring: 'auto auto minmax(0,1fr) auto auto max-content',
    combat: 'auto auto fit-content(290px) minmax(0,1fr) auto max-content',
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
    topBar: { default: { area: 'topBar', variant: 'full' } },
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
  // A9c-2 D7: `fit-content(400px)` (was `minmax(0,400px)`), same lever, same 0px
  // returned: the stage holds the dice tray and its quick-check list (>=680px of
  // content probed at a 900px cap), so it always fills its 400px cap.
  // Measured inner log (a:storyLog, desktop 1440x900) after A9d R-1 lever 2 (the recap strip
  // steps aside in combat): b 242, i 242, monster-turn c 217, and the X-card-raised caster cell j 134.
  // The recap lever took every cell without the X-card banner past 200.
  // debt: the harness combat floor stays 100px, not 200: Table's X-card-raised cell (j-combat-caster-xcard) measures 134px inner (plain cells 217-242).
  // ceiling: 134px on a 900px desktop with the X-card banner up; the banner and the stage's 400px track both stay.
  // until: Aoi rules the banner-up combat cell, or the harness floor models the banner as its own moment (Backlog TAV-COMBAT-LOG-FLOOR-200); then raise COMBAT to 200.
  // debt: Table's `offers` (`list`, one full-width button per offer) is capped at 120px and scrolls inside it; uncapped, 3-4 offers starve the log.
  // ceiling: 3+ offers scroll in a 120px box, in the table·exploring cell only (offers are hidden in combat).
  // until: Table's offers take the `chips` form (step 11 Table checkpoint) or the stage track is content-sized.
  rows: {
    exploring: 'auto 218px minmax(0,1fr) fit-content(120px) auto max-content',
    combat: 'auto fit-content(400px) minmax(0,1fr) auto max-content',
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
    // Mirrors the mockup's `.top{grid-area:stage}` — the title floats over the
    // stage rather than owning a row. A9c C4 (Amendment C.1): ANCHORED, not
    // anchored — its own keyed top-level slot in the stage's area, self-aligned
    // top-start. A host changed parent on every Auto switch and so remounted
    // TopBar (Kage S7); this only moves, and stays out of the stage's
    // scroller. `overlay` is the compact one-line form.
    topBar: { default: { area: 'sceneStage', anchor: 'top-start', variant: 'compact' } },
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
// combat." One column plus a presence column beside the header line; EVERY
// region is its own top-level slot (A9d E2, Amendment D.1/D.3), so a row switch
// moves regions and never re-parents them (`host` is retired). Track sizing is
// three classes, stated once (Amendment D.3):
//   WHOLE    `max-content`   safetyBanner, topBar, offers, composer, actionBar.
//            What the user acts with or must read; never shrinks. (`max-content`
//            on a scroll-container slot is A9c-2 D0's lesson: `auto` contributes 0.)
//   FLOOR    `minmax(var(--play-floor,N),1fr)`   storyLog. N = the 160px inner
//            floor (harness PHONE_STORY_LOG_MIN_PX) + that moment's slot chrome.
//   OPTIONAL `var(--play-optional,…)` as the growth limit   partyStrip (minimum
//            one tile row) and sceneStage (minimum its fold-handle row, see
//            Play.module.css). They take spare room before the log grows past its
//            floor and give it back first. The grid hands spare room to `auto`
//            tracks BEFORE `fr` (probe-measured), so the floor is the story's only
//            guarantee; a raised safety banner sets both variables to 0px
//            (`.grid:has(...)` in Play.module.css) so the banner outranks the bands.
// When whole + floor + optional minimums exceed the viewport the PAGE scrolls
// (`.grid` clips the inline axis only) and nothing is cut off; the harness reads
// that as the `reflow` class (375x667, 720x450, 320x256).
// ---------------------------------------------------------------------------

// Floor arithmetic (measured at 390x844, `probe-floor`; re-derive when a tenant in the
// story slot changes height):
//   exploring 241 = 160 inner log + 12 slot edge (6px border each side) + 6 stack gap
//                   + 63 "Previously on..." recap
//   combat    208 = 160 inner log + 12 slot edge + 6 stack gap + 30 status line (no recap:
//                   "Previously on..." steps aside in combat, A9d R-1 lever 2, so the 63 + its
//                   6px gap that the pre-lever 277 paid are gone; measured at 390x844: the combat
//                   log inner is the track minus 48)
// Party minimum 91 = 14 label
// + 8 gap + 57 tile row + 12 slot edge: one tile row, which is also why a focused tile's
// caption (about 28px below the tile) does not fit and is clipped by the band at its minimum.
const PHONE_ROW: LayoutRow = {
  id: 'phone',
  vars: {
    '--play-slot-edge': 'var(--space-3)',
    '--play-slot-pad': '0px',
    '--play-slot-inline': 'var(--space-6)',
    // The recap strip's scene subtitle is dropped on the phone: one line, not two (about -18px).
    '--play-recap-sub': 'none',
    // The dice are ONE row of six chips here, not 3x2: a two-row tray was ~66px more band than the
    // stage can spare (Tora A9d-1 MAJOR-1). DiceTray.module.css reads it; the tray's keys follow.
    '--play-dice-columns': '6',
  },
  // The banner floor: while the X-card banner is raised on a viewport the page does not scroll on
  // (`@media (min-height: 701px)` in Play.module.css), the story track yields down to THIS, not to 0:
  // 88 inner (log padding 44 + one 42px narration row) + the same chrome as the floors above. 169 =
  // 88 + 81 (exploring chrome: 12 edge + 6 gap + 63 recap); 136 = 88 + 48 (combat: 12 + 6 + 30 status).
  // Measured 390x844: combat + banner leaves 146 for the track, exploring + banner 171 (harness shots j and
  // p). Where the page scrolls anyway (reflow) the banner takes no yield and the full 160 floor holds.
  //
  // The stage's reflow minimum: where the page scrolls anyway the stage band takes the height its
  // CONTROLS need to be seen at rest, and its picture and quick checks scroll inside it (A9d-2, Tora
  // A9d-1 MAJOR-1; Play.module.css reads `--play-foldable-reflow-min` on a short viewport and applies it as
  // the min-height of a foldable slot, which `fit-content` honours as its track minimum). 294 = the dice row's
  // bottom edge at 281 (64 head + 112 picture block + 10 + 14 label + 10 + 58 chips, measured at 375x667) + 13
  // (the slot's 12px of edge and a px of rounding); 378 = 365 + 13, the 68px combat note with End combat
  // sitting above the dice in combat.
  momentVars: {
    exploring: { '--play-banner-floor': '169px', '--play-foldable-reflow-min': '294px' },
    combat: { '--play-banner-floor': '136px', '--play-foldable-reflow-min': '378px' },
  },
  // Column 2 is `suzuPresence`'s track: 0px when she is absent (AI assist off).
  columns: {
    exploring: 'minmax(0,1fr) auto',
    combat: 'minmax(0,1fr) auto',
  },
  // Stage caps are plan §4.2's: combat 34vh ("default open"); exploring 20vh,
  // standing in for the inline strip until step 11 reads the `inline` variant.
  rows: {
    exploring:
      'max-content max-content minmax(91px,var(--play-optional,auto)) fit-content(var(--play-optional,20vh)) minmax(var(--play-floor,241px),1fr) max-content max-content max-content',
    combat:
      'max-content max-content minmax(91px,var(--play-optional,auto)) fit-content(var(--play-optional,34vh)) minmax(var(--play-floor,208px),1fr) max-content max-content',
  },
  areas: {
    exploring: `"safetyBanner safetyBanner"
                "topBar       suzuPresence"
                "partyStrip   partyStrip"
                "sceneStage   sceneStage"
                "storyLog     storyLog"
                "offers       offers"
                "composer     composer"
                "actionBar    actionBar"`,
    combat: `"safetyBanner safetyBanner"
             "topBar       suzuPresence"
             "partyStrip   partyStrip"
             "sceneStage   sceneStage"
             "storyLog     storyLog"
             "composer     composer"
             "actionBar    actionBar"`,
  },
  regions: {
    // `compact`: the one-line header (exit, title, state pill, journal, settings).
    topBar: { default: { area: 'topBar', variant: 'compact' } },
    suzuPresence: { default: { area: 'suzuPresence', variant: 'compact' } },
    partyStrip: { default: { area: 'partyStrip', variant: 'strip' } },
    sceneStage: {
      default: { area: 'sceneStage', variant: 'inline', collapsible: true },
      combat: { area: 'sceneStage', variant: 'panel', collapsible: true },
    },
    storyLog: { default: { area: 'storyLog' } },
    offers: {
      default: { area: 'offers', variant: 'rows' },
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

const MOMENT_LIST: readonly Moment[] = ['exploring', 'combat'];

/**
 * A9c C7 (build brief §5): every region whose placement is `collapsible` in
 * ANY row x moment, DERIVED from the rows (the tenth foldable region is a row
 * flag, never an edit here). The shell wraps these regions in a `FoldDock`
 * in EVERY row — the dock is inert (`foldable={false}`) where the placement is
 * not collapsible — so a row switch changes the dock's mode, never the tree,
 * and the region's state survives (presets place, they never unmount).
 */
export const FOLDABLE_REGIONS: ReadonlySet<RegionId> = new Set(
  REGION_IDS.filter((id) =>
    LAYOUT_ROWS.some((row) => MOMENT_LIST.some((m) => getPlacement(row, id, m).collapsible === true)),
  ),
);

/**
 * R3 consequence of a fold (build brief §5.5): a fold hides the region's own
 * announcers, just as a closed drawer does. Every region in
 * `FOLDABLE_REGIONS` that is also an `ANNOUNCING_REGIONS` member must be
 * listed here with the reason silencing it is safe; the registry guard fails
 * an unlisted one (the control: make `table.storyLog` collapsible -> red).
 */
export const FOLDABLE_ANNOUNCERS: Partial<Record<RegionId, string>> = {
  characterBlock:
    'its announcers report only the sheet\'s own loading/error; a folded sheet has nothing to say',
  sceneStage:
    'its announcers and focus anchors sit outside its fold body: only the picture folds (FoldSpec.body, A9d-2 F1)',
};
