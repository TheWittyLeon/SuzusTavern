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
 * overlay host ⇒ a LAYER; the root and the slots ⇒ SHELL CHROME.* (The
 * mobile tab bar was chrome too until A9d E4 deleted it.)
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
 * A10 step 11 S2a (Sora's brief 3.2, Amendment F.4) — FACTS: a named value the page reports about what the table holds, which a row answers
 * with `--play-*` values. `moment` already works this way (`momentVars`); a fact is the same channel for a thing a row cannot know. `room` is
 * what the encounter gives the stage: a `board` (a usable `space`), a `band` (a fight that authored none: `space: null`, or a malformed one), `unserved` (positioning is off: the state body carries no `space` key; the stage takes no height) or `none` (not in a fight). The shell maps
 * a key to the row's values and learns nothing about what it means; the tenth fact is an entry here, the rows' values for it, and the one line
 * where the page computes it (`hooks/usePlayLayout.ts`).
 */
export const FACTS = { room: ['board', 'band', 'none', 'unserved'] } as const satisfies Record<string, readonly string[]>;
/**
 * The ORDER of `FACTS` is the PRECEDENCE of its facts (Sora's brief K3; Kage A10 Tavern 3): the shell emits each fact's values in this order and the LAST wins a name two
 * facts both set, whatever order the caller's object lists them in. It runs from what SIZES a thing to what can REMOVE it: `room` first, any `fold:<regionId>` (the
 * phone mount's fold, reported by the shell itself) last, a `width` fact, if one lands, between. Add a fact at the position its precedence names, not at the end.
 */
export type FactId = keyof typeof FACTS;
export type FactValue<F extends FactId> = (typeof FACTS)[F][number];
/** What the page reports: a value per fact it has a say about. */
export type Facts = { [F in FactId]?: FactValue<F> };
type PlayVars = Readonly<Record<`--play-${string}`, string>>;

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
  /**
   * A10 step 11 round 3 (Iro; Aoi's "Which Band Pays"): this region's slot is a BOUNDED scroller (Table's character sheet stops at the story log and scrolls inside itself). The shell
   * names it (`SCROLL_REGION_NAMES` in PlayShell) and makes it a keyboard stop (`tabindex=0`, `role="group"`), so its text has a keyboard path: a nested scroller with no name and no stop
   * hides its overflow from a keyboard user (WCAG 2.1.1). Only a region with a name there may say it (a registry guard).
   */
  scrolls?: boolean;
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
  /**
   * A10 step 11 S2a (Amendment F.4): the same, per VALUE of a fact the page reports (`FACTS`): fact -> value -> `--play-*` values. Emitted after
   * `momentVars`. A row that has no entry for a fact is not affected by it (the phone's); a row that has one gives EVERY value of the fact its
   * set (`Record`, and a registry guard), so a reported value never finds a row with nothing to say.
   */
  factVars?: { [F in FactId]?: Readonly<Record<FactValue<F>, PlayVars>> };
  /**
   * A9d-2 N5 (Amendment E.7; Iro 3, Tora A4): a band that hides content says so. When true, every slot of this row that can scroll
   * (all but the story log, which scrolls by design) paints a bottom-fade cue, ONLY while there is more to scroll. `PlayShell` stamps
   * `data-scroll-cue` on the grid and `Play.module.css` reads it. The phone row sets it (its party band hides the tracker in combat);
   * the desktop rows are untouched. Absent = no cue.
   */
  scrollCue?: boolean;
  /**
   * B8c-3 (Tora, gate before P1): a row opts IN to the map's Move verb. Absent = no Move in the bar, whatever the stage shows. Story and
   * Table set it; the phone row does not until P3 lands the selection seam (a thumb must not commit a move on one tap).
   */
  boardMove?: boolean;
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
 * A10 step 11 S2a: the `--play-*` values a row gives the facts the page reports. The one read site of `LayoutRow.factVars`, beside
 * `getPlacement` and `variantFor`. Throws, naming the row and the fact, on a value outside `FACTS` (a typo must not render as "no values") and
 * on a value the row has no set for. A fact the row has no table for contributes nothing. The facts are applied in `FACTS`' DECLARED order, the last one winning (K3).
 */
// debt: `declared` is a parameter of a production function that exists for one test: FACTS has one fact today, so the "last declared fact wins" order (K3) cannot be pinned on the real vocabulary and the test passes a two-fact one.
// ceiling: this one defaulted parameter; no production caller passes it. until: a second fact joins FACTS (the order is then pinned on the real vocabulary, and this parameter is deleted).
export function factVarsFor(row: LayoutRow, facts: Facts | undefined, declared: Readonly<Record<string, readonly string[]>> = FACTS): PlayVars {
  const given = (facts ?? {}) as Readonly<Record<string, string | undefined>>;
  // A key the vocabulary does not declare is a typo: it throws, naming the row and the fact, whatever its value (it is not "no values").
  for (const fact of Object.keys(given)) {
    if (declared[fact] === undefined) throw new Error(`"${fact}" is not a declared fact (row "${row.id}")`);
  }
  const out: Record<`--play-${string}`, string> = {};
  // The vocabulary's declared order, not the caller's object key order: the last declared fact wins (see FACTS). `declared` is a parameter only so the order can be pinned on
  // a vocabulary with two facts (there is one today).
  for (const [fact, values] of Object.entries(declared)) {
    const value = given[fact];
    if (value === undefined) continue;
    if (!values.includes(value)) throw new Error(`"${value}" is not a declared value of fact "${fact}" (row "${row.id}")`);
    const table = (row.factVars as Record<string, Record<string, PlayVars> | undefined> | undefined)?.[fact];
    if (table === undefined) continue;
    const vars = table[value];
    if (vars === undefined) throw new Error(`row "${row.id}" has no values for fact "${fact}" = "${value}"`);
    Object.assign(out, vars);
  }
  return out;
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

// ---------------------------------------------------------------------------
// The desktop combat rows' TRACK CLASSES (A10 step 11 fix round; Sora's brief 3.2, Amendment F.8): the phone's three classes (the PHONE_ROW comment below), as data.
//   WHOLE     `max-content`                                              banner, top bar, scene line, composer, action bar. Never shrinks.
//   FLOOR     `minmax(var(--play-floor,288px),1fr)`                      the story log. It never goes under its floor: a page that cannot afford it scrolls.
//   OPTIONAL  `minmax(var(--play-body-floor,0px),var(--play-body,0px))`  the stage's body: between its own floor (3 rows) and the size its room rules.
// The grid hands spare room to the body before the log grows past its floor, and takes it back from the body first: on a small screen the BOARD gives rows and the
// STORY keeps its room. Whole bands are `max-content` because a scroll container's automatic minimum is 0 (a slot is one): with `auto` beside a floored log, the grid
// squeezes the top bar and the composer instead (probe, Sora's brief Q1b; the A9c-2 D0 lesson again). Exploring rows are untouched: they have no body to yield.
//
// Floor arithmetic, as the phone's is written beside its row (re-derive when a tenant in the story slot changes height; the harness's a:storyLog measures the inner log on
// every gated size, so a stale sum reds): a floor is its INNER log plus the story slot's own chrome, and the chrome is written from its tokens (A10 fix round 2, Kage Tavern 3:
// it was the sum 288 = 210 + 78 at the default density, and `airy` / `compact` re-tune the gap, so the inner log was 186 / 228 there). The slot pays `--density-gap` three times
// (its padding above and below, and the gap to its last tenant) plus that tenant's own height: the status line in combat (30px), the recap strip while exploring (46px: the phone's
// 224 = 160 + 12 + 6 + 46 is the same recap). Inner floors: 210 / 100 with the X-card banner up in combat, 240 / 230 while exploring (the harness's, per moment: layout-assertions.mjs).
// The banner yield (Play.module.css) lowers `--play-floor` to `--play-banner-floor` while the X-card banner is up.
// ---------------------------------------------------------------------------
const slotLogFloor = (innerPx: number, lastTenantPx: number) => `calc(${innerPx}px + 3 * var(--density-gap) + ${lastTenantPx}px)`;
const DESKTOP_COMBAT_LOG_FLOOR = slotLogFloor(210, 30);
const DESKTOP_COMBAT_BANNER_FLOOR = slotLogFloor(100, 30);
const DESKTOP_EXPLORING_LOG_FLOOR = slotLogFloor(240, 46);
const DESKTOP_EXPLORING_BANNER_FLOOR = slotLogFloor(230, 46);
// Round 4 (the rule's third step): a fight's composer is the band that gives its padding (the phone's two vars, read by Composer.module.css): 99px -> 83px.
const FIGHT_COMPOSER_VARS = { '--play-composer-pad': 'var(--space-3)', '--play-composer-gap': 'var(--space-4)' } as const;

const STORY_ROW: LayoutRow = {
  id: 'story',
  boardMove: true,
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
  // (History: A9c-2 D7 made the combat stage track `fit-content(290px)`, and it always sat at its cap, because the dice tray's content was taller than the cap
  // and then, with the tray out of the stage, the stand-in and the head still filled it: the cap was never the lever. A10 S2b replaced the cap with the two
  // tracks below.)
  // Measured inner log (a:storyLog, desktop 1440x900) after A9d R-1 lever 2 (the recap strip
  // steps aside in combat): g 226, caster cell l 226, and the X-card-raised caster cell k 118 (A10 S2b, with the board room: 52 of scene line + 7 x 34).
  // The recap lever took every cell without the X-card banner past 200, and the harness combat floor is 210
  // (A9d-2; plain cells 224-226 here). The banner (a raised safety row above the stage) is what is left on k,
  // which the harness judges against its own banner floor (100), not an exemption.
  // debt: Story's X-card-raised combat cell (k-story-combat-caster-xcard) is judged against a 100px banner floor, not the 200px target: it measures 118px inner.
  // ceiling: 118px on a 900px desktop with the X-card banner up, ~3 narration rows; the banner stays and so does a 7-row board (it yields rows only below 900px tall, down to the log's banner floor: `--play-banner-floor` 178 = 100 + 78, F1).
  // until: Aoi rules the banner-up combat cell (an inline X-card, or the stage giving the banner its rows), Backlog TAV-COMBAT-LOG-FLOOR-200; then raise the harness's banner combat floor to 200.
  // A10 step 11 S2b (Sora's brief 3.2, Amendment F.2): the combat stage is TWO track lines of one area: `max-content` (the scene line, whole) and
  // `minmax(0, var(--play-body, 0px))` (the body: `--play-body` is a count of `--play-cell`s, set by the `room` fact below). The old line was a hand-summed
  // `fit-content(290px)` (52 of strip + 238 of body, re-derived whenever the chrome changed); this one is the strip and the body, each its own number.
  rows: {
    // A10 step 11 round 3 (Aoi's rule, "Which Band Pays", Iro MAJOR-1 / Kage Tavern 4 for Table, the same shape here): banner, top bar, LOG, composer, action bar, offers. The log is a FLOOR
    // and every band beside it is WHOLE (`max-content`): with the floor added and the two top tracks left `auto` the grid squeezes the header (the log's top moved from y 145 to 36: the
    // title bar and the party strip were clipped, not scrolled; the A9c-2 D0 lesson again). A page that cannot afford the floor and the bands scrolls, and what falls under the fold falls
    // from the bottom up: the offers first, then the X-card, the text box last.
    exploring: `max-content max-content minmax(var(--play-floor,${DESKTOP_EXPLORING_LOG_FLOOR}),1fr) max-content max-content max-content`,
    // banner, top bar, scene line, body, log, composer, action bar: the classes above (A10 fix round: it was `auto auto max-content minmax(0,body) minmax(0,1fr) auto max-content`).
    combat: `max-content max-content max-content minmax(var(--play-body-floor,0px),var(--play-body,0px)) minmax(var(--play-floor,${DESKTOP_COMBAT_LOG_FLOOR}),1fr) max-content max-content`,
  },
  // The banner floor of the log's class (the phone's shape: `--play-banner-floor`, read by the shell's banner yield), for both moments: the exploring log is a floor too (round 3).
  momentVars: { exploring: { '--play-banner-floor': DESKTOP_EXPLORING_BANNER_FLOOR }, combat: { '--play-banner-floor': DESKTOP_COMBAT_BANNER_FLOOR, ...FIGHT_COMPOSER_VARS } },
  // The board's size is data (F.3): 34px squares (Aoi's pictures are drawn at 34; 35 fits too, and one size on both layouts means a Story <-> Table
  // switch mid-fight does not rescale the board), 7 rows in Story (R19), a short band of 3 for a fight with no board (#44 question 4: ruling it
  // out is `band` taking `board`'s value), nothing while exploring (Story's exploring stage is a `panel`, which has no body).
  vars: { '--play-cell': '34px' },
  // Each room carries its size AND its floor (the optional class): a board yields down to 3 rows ("fewer is a lane", Aoi); a band does not yield (its floor is its size).
  factVars: {
    room: {
      board: { '--play-body': 'calc(7 * var(--play-cell))', '--play-body-floor': 'calc(3 * var(--play-cell))' },
      band: { '--play-body': 'calc(3 * var(--play-cell))', '--play-body-floor': 'calc(3 * var(--play-cell))' },
      none: { '--play-body': '0px', '--play-body-floor': '0px' },
      // Positioning is OFF (the state body has no `space` key): the stage's body takes NO height and shows no text (round 4, Aoi's rule; it overrides the phone mount brief's "the band's values" for these rows).
      unserved: { '--play-body': '0px', '--play-body-floor': '0px' },
    },
  },
  areas: {
    // Aoi's order (round 3): the story, the text box, the X-card, the offers last. DOM and focus order follow it (slotOrder walks the areas): story, composer, X-card, offers.
    exploring: `"safetyBanner safetyBanner safetyBanner"
                "topBar       topBar       partyStrip"
                "suzuPresence storyLog     sceneStage"
                "suzuPresence composer     sceneStage"
                "suzuPresence actionBar    sceneStage"
                "suzuPresence offers       sceneStage"`,
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
    // (A10 S2b: `sceneStage` is named on two consecutive lines: its scene line, then its body.)
    // A10 step 11 round 4 (Aoi's "Short Desktop Fights", the rule): in a fight the band you act with comes first: the stage, the story at its floor, the action bar (the verbs and the X-card),
    // and the composer LAST. What gives, in order: the empty stage box (the `unserved` room), the board's rows down to three, the composer's padding (`momentVars`), and then the page
    // scrolls, taking the composer and never the verbs or the X-card. (Exploring is the reverse: the player acts by writing.) DOM and Tab order follow: log, verbs, X-card, composer.
    combat: `"safetyBanner safetyBanner safetyBanner"
             "topBar       topBar       partyStrip"
             "suzuPresence sceneStage   partyStrip"
             "suzuPresence sceneStage   partyStrip"
             "suzuPresence storyLog     partyStrip"
             "suzuPresence actionBar    partyStrip"
             "suzuPresence composer     partyStrip"`,
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
    // A10 step 11 (S1; Sora's brief 3.1, Amendment F.4): a `hero` stage hosts no tenant, so the dice leave it with the fight. Exploring keeps the
    // tray in the `panel` stage (`full`); in combat the stage is `hero` and the dice open from Roll in the composer's mode row, as on the phone.
    // One node, two homes, chosen by the row: the tray remounts at the combat edge, and `advantage` lives in the page and survives it.
    composer: { default: { area: 'composer', variant: 'full' }, combat: { area: 'composer', variant: 'roll' } },
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
  boardMove: true,
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
  // (History: A9c-2 D7 made the combat stage `fit-content(400px)`, which always filled its cap; A10 S2b replaced the cap with the two tracks below.)
  // Measured inner log (a:storyLog, desktop 1440x900) after A10 S2b, with the board room (8 x 34 body, 396 of stage with the title bar's reserve):
  // b 245.5, i 245.5, monster-turn c 221, and the X-card-raised caster cell j 137.5.
  // The harness combat floor is 210 (A9d-2; plain cells 221-246 here).
  // debt: Table's X-card-raised combat cell (j-combat-caster-xcard) is judged against a 100px banner floor, not the 200px target: it measures 137.5px inner.
  // ceiling: 137.5px on a 900px desktop with the X-card banner up; the banner stays and so does an 8-row board (it yields rows only below 900px tall, down to the log's banner floor: `--play-banner-floor` 178 = 100 + 78, F1).
  // until: Aoi rules the banner-up combat cell, Backlog TAV-COMBAT-LOG-FLOOR-200; then raise the harness's banner combat floor to 200. (The dice tray left the stage at S1.)
  rows: {
    // The offers track is content-sized, a WHOLE band: Table's offers are chips (A10 fix round F3), whole at rest; the 120px cap and its `debt:` are gone. The log is a FLOOR
    // (A10 fix round 2, Iro MAJOR-1 / Kage Tavern 4: the chips took the log from 175 to 113px at 1024x768 and to 44 at 1024x690, and nothing scrolled), so a page that cannot afford
    // the chips AND the log scrolls, and the log is never crushed. The offers track is NOT bounded instead: a cap puts a scroller back around what a player acts with (the 120px
    // cap hid two transitions), and bounding it by the log's floor would be a number the shell computes from a row's. The body is the optional class, as the combat row's: it is
    // `none` here (0 and 0), so every Table moment spells it one way.
    exploring: `max-content max-content minmax(var(--play-body-floor,0px),var(--play-body,0px)) minmax(var(--play-floor,${DESKTOP_EXPLORING_LOG_FLOOR}),1fr) max-content max-content max-content`,
    // banner, scene line (with the title bar's 72px reserve), body, log, composer, action bar: the classes above (A10 fix round: it was `auto max-content minmax(0,body) minmax(0,1fr) auto max-content`).
    combat: `max-content max-content minmax(var(--play-body-floor,0px),var(--play-body,0px)) minmax(var(--play-floor,${DESKTOP_COMBAT_LOG_FLOOR}),1fr) max-content max-content`,
  },
  momentVars: { exploring: { '--play-banner-floor': DESKTOP_EXPLORING_BANNER_FLOOR }, combat: { '--play-banner-floor': DESKTOP_COMBAT_BANNER_FLOOR, ...FIGHT_COMPOSER_VARS } },
  // A10 step 11 S2b: the stage is `hero` in BOTH moments and names its area on two lines (the scene line, then the body), as Story's combat does. The room
  // is rows x cell (F.3): 8 rows (R19) of the 34px cell, 3 for a fight with no board, none while exploring (the scene line IS the stage: 72 + 52 = 124
  // where the stage was a fixed 218). The title bar's 72px reserve sits in the scene line's track, so the body is exactly rows x cell.
  //
  // debt: the four `--play-overlay-*` / `--play-strip-*` readers (Play.module.css, regions/SceneStage.module.css) are set by no row: 40px squares in Table
  // are five row values (`--play-cell: 40px` and these four) and only the harness's `whatif-cell-40` leg exercises them.
  // ceiling: 0 rows set them; the picture at 40px is a harness what-if, the default stays 34px. Story cannot take 40 by row value (no title bar over its stage).
  // until: Needs Leon #44 question 3 is answered (40: the Table row sets the five values; 34: delete the four readers and the leg).
  vars: { '--play-cell': '34px' },
  factVars: {
    room: {
      board: { '--play-body': 'calc(8 * var(--play-cell))', '--play-body-floor': 'calc(3 * var(--play-cell))' },
      band: { '--play-body': 'calc(3 * var(--play-cell))', '--play-body-floor': 'calc(3 * var(--play-cell))' },
      none: { '--play-body': '0px', '--play-body-floor': '0px' },
      // Positioning is OFF (the state body has no `space` key): the stage's body takes NO height and shows no text (round 4, Aoi's rule; it overrides the phone mount brief's "the band's values" for these rows).
      unserved: { '--play-body': '0px', '--play-body-floor': '0px' },
    },
  },
  areas: {
    // V2 (Aoi's "Which Band Pays", Leon's #54 = `sheet`): the text box, the X-card and the offers take the FULL width under the story, and the character sheet stops at the story log
    // and scrolls inside itself (a named, keyboard-reachable region: `scrolls` on its placement). At 1024x768 the page then does not scroll (it scrolled 127) and the text box is 522 wide
    // (360 beside the sheet); what cannot fit falls from the bottom up, the offers first.
    exploring: `"safetyBanner safetyBanner safetyBanner safetyBanner"
                "partyStrip   sceneStage   sceneStage   characterBlock"
                "partyStrip   sceneStage   sceneStage   characterBlock"
                "partyStrip   suzuPresence storyLog     characterBlock"
                "partyStrip   composer     composer     composer"
                "partyStrip   actionBar    actionBar    actionBar"
                "partyStrip   offers       offers       offers"`,
    // Round 4, the same rule: the sheet rail stops at the story log and the action bar, then the composer, take the full width.
    combat: `"safetyBanner safetyBanner safetyBanner safetyBanner"
             "partyStrip   sceneStage   sceneStage   characterBlock"
             "partyStrip   sceneStage   sceneStage   characterBlock"
             "partyStrip   suzuPresence storyLog     characterBlock"
             "partyStrip   actionBar    actionBar    actionBar"
             "partyStrip   composer     composer     composer"`,
  },
  regions: {
    // Mirrors the mockup's `.top{grid-area:stage}` — the title floats over the
    // stage rather than owning a row. A9c C4 (Amendment C.1): an ANCHORED
    // overlay — its own keyed top-level slot in the stage's area, self-aligned
    // top-start, so a row switch only moves it and it stays out of the stage's
    // scroller (a `host` changed parent on every Auto switch and remounted
    // TopBar, Kage S7; `host` is retired, A9d E2). `compact` is the one-line form.
    topBar: { default: { area: 'sceneStage', anchor: 'top-start', variant: 'compact' } },
    partyStrip: { default: { area: 'partyStrip', variant: 'rail' } },
    // Amendment B.3 (🟡-5): presence size is preset data — Table gives it
    // a "framed speaker portrait" treatment, `'full'`.
    suzuPresence: { default: { area: 'suzuPresence', variant: 'full' } },
    sceneStage: { default: { area: 'sceneStage', variant: 'hero' } },
    storyLog: { default: { area: 'storyLog' } },
    offers: {
      default: { area: 'offers', variant: 'chips' },
      combat: { area: null, visible: false },
    },
    characterBlock: { default: { area: 'characterBlock', variant: 'full', collapsible: true, scrolls: true } },
    // Amendment B.3 (🟡-7): `'bar'`, Table's bottom-always treatment.
    actionBar: { default: { area: 'actionBar', variant: 'bar' } },
    // A10 step 11 (S1): the stage is `hero` in BOTH moments here, so the dice are never its tenant: Roll, in both (see Story's composer).
    composer: { default: { area: 'composer', variant: 'roll' } },
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
//   exploring 224 = 160 inner log + 12 slot edge (6px border each side) + 6 stack gap
//                   + 46 "Previously on..." recap (one line: the scene subtitle is dropped on the phone)
//   combat    208 = 160 inner log + 12 slot edge + 6 stack gap + 30 status line (no recap:
//                   "Previously on..." steps aside in combat, A9d R-1 lever 2, so the 63 + its
//                   6px gap that the pre-lever 277 paid are gone; measured at 390x844: the combat
//                   log inner is the track minus 48)
// The exploring floor was 241 until A9d-2 N5: it budgeted a 63px recap that measures 46 (Kage A9d-1 S1 measured the same), so the log
// was handed 17px the floor did not need. The 160 and 88 INNER floors (harness PHONE_STORY_LOG_MIN_PX / _BANNER_MIN_PX) do not move.
// Party minimum 91 = 14 label
// + 8 gap + 57 tile row + 12 slot edge: one tile row. At 320px wide and under (a 400% zoom) the tiles WRAP and the page scrolls anyway, so Play.module.css
// sets `--play-party-min: max-content` there and the band sizes to its content instead of clipping the wrapped rows at 91px (Tora MINOR-1, Iro Minor-2). A focused tile's name caption sits ABOVE the
// tile, in the label's row (PartyPanel.module.css), so it fits at this minimum.
const PHONE_ROW: LayoutRow = {
  id: 'phone',
  // Every slot that can hide content paints the bottom-fade cue while it has more to scroll (E.7): the party band does in combat.
  scrollCue: true,
  vars: {
    '--play-slot-edge': 'var(--space-3)',
    '--play-slot-pad': '0px',
    '--play-slot-inline': 'var(--space-6)',
    // The recap strip's scene subtitle is dropped on the phone: one line, not two (about -18px).
    '--play-recap-sub': 'none',
    // The composer's own density on the phone (A9d-2 N6, Sora lever brief 2.4): 6px of pad above the mode row (it was 22) and 8px between
    // the mode row and the input (it was 16): the composer 145 -> 121px at 390 wide. Composer.module.css reads both (absent = the
    // density tokens). The 44px targets and the 8px between them are unchanged.
    '--play-composer-pad': 'var(--space-3)',
    '--play-composer-gap': 'var(--space-4)',
    // The `roll` composer is TWO rows on the phone (A10 fix round F6; Sora K2, Kage Tavern 5): the mode row takes a line of its own and the input keeps its old `flex: 1`
    // (the mode row's own line already puts it on the next one). Composer.module.css reads both; absent = the desktop's (the mode row shares the line, the input wraps by
    // itself). This was `@media (max-width: 880px)` in the stylesheet, a copy of the shell's phone breakpoint that a test had to keep honest: the row is where a layout's
    // choices live. Table and Story set neither, so a tablet row could pick one row at 1024 wide by a row value (the lever is here if Aoi or Tora want it).
    '--play-roll-mode-flex': '1 0 100%',
    '--play-roll-input-flex': '1 1 0%',
  },
  // The banner floor: while the X-card banner is raised and the page FIT before it came up (the shell's measured `data-fit`, not a
  // height line: Play.module.css), the story track yields down to THIS, not to 0: 88 inner (log padding 44 + one 42px narration row)
  // + the same chrome as the floors above. 152 = 88 + 64 (exploring chrome: 12 edge + 6 gap + 46 recap); 136 = 88 + 48 (combat:
  // 12 + 6 + 30 status). Where the page scrolled anyway the banner takes no yield and the full 160 floor holds.
  // (A9d-2 N5 deleted `--play-foldable-reflow-min`: the stage is a whole band, one scene strip, and needs no minimum of its own.)
  momentVars: {
    exploring: { '--play-banner-floor': '152px' },
    combat: { '--play-banner-floor': '136px' },
  },
  // Column 2 is `suzuPresence`'s track: 0px when she is absent (AI assist off).
  columns: {
    exploring: 'minmax(0,1fr) auto',
    combat: 'minmax(0,1fr) auto',
  },
  // The stage is a WHOLE band (`max-content`, A9d-2 N5, Amendment E.1): the scene strip (variant `inline`, one row) holds the scene's
  // name, its objective or status and the encounter's buttons, never scrolls, and cannot hide a control. The party band is the phone's
  // only optional band; the log is the floor; the offers, composer and action bar are whole.
  rows: {
    exploring:
      'max-content max-content minmax(var(--play-party-min,91px),var(--play-optional,auto)) max-content minmax(var(--play-floor,224px),1fr) max-content max-content max-content',
    combat:
      'max-content max-content minmax(var(--play-party-min,91px),var(--play-optional,auto)) max-content minmax(var(--play-floor,208px),1fr) max-content max-content',
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
    // A9d-2 N5 (E.1/E.2): the scene strip in BOTH moments, never collapsible. No picture and no fold on the phone until the map
    // (step 12): the stand-in was 58px of a band whose job is the controls, and a fold that visibly did nothing was Iro's Major.
    sceneStage: {
      default: { area: 'sceneStage', variant: 'inline' },
      combat: { area: 'sceneStage', variant: 'inline' },
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
    // A9d-2 N7 (Amendment E.4): the Roll control sits at the end of the mode row and the stage hosts no dice tray (the tray remounts when the row
    // changes; `advantage` lives in the page). One node, two homes, chosen by the row. (A10 S1: Story's combat and Table say `roll` too; the phone
    // is the row whose mode row is forced onto a line of its own, by Composer.module.css, at the shell's phone width.)
    composer: { default: { area: 'composer', variant: 'roll' } },
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
  // (A9d-2 N5: `sceneStage` is no longer foldable in any row: the phone's strip does not fold. When the phone map returns at step 12
  // and the row re-declares `collapsible`, the entry returns with it: its announcers sit outside the fold body, only the picture folds.)
};
