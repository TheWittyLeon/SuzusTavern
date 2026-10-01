'use client';

/**
 * TAV-PLAY-SHELL step 6b, commit C4 (the irreducible core — build brief
 * §6.2–§6.4, §6.8) — `PlayShell` places `/play`'s regions from the preset
 * registry (`presets.ts`). NOT under `regions/`: Guard 2 (A9c, the source
 * scan) rejects a `regions/*.tsx` file importing `./presets`, and Guard 3
 * rejects a grid property inside `regions/*.module.css` — this is the one
 * file that must do both, so it lives beside `presets.ts` instead.
 *
 * The shell knows ONLY `RegionId -> ReactNode` (via `regions`) and
 * `TenantId -> ReactNode` (via `tenants`) — it never imports a region
 * component and never sees a region's own props. The tenth region is one
 * `presets.ts` row, one `regions` map entry and the component; the shell
 * is untouched. `page.tsx` builds both maps (where the data/handlers
 * already live) and stays a pure function of `row`/`moment` otherwise —
 * `usePlayLayout` resolves those two upstream, in `page.tsx`, not here, so
 * A9c's render matrix can mount this component directly, without a
 * `<ThemeProvider>`.
 *
 * Four placement kinds, one loop, per `getPlacement`:
 *   - `area != null`             -> a grid-item slot (`.slot`), visible
 *     unless `visible === false` (`.slotHidden` — a CSS class, never an
 *     inline style: jsdom computes inline styles, dropping the node from
 *     RTL's accessibility-filtered queries, but a CSS Module class is
 *     invisible to jsdom — build brief §1 mechanism 1).
 *   - `host != null`             -> nothing of its own; appended INSIDE
 *     the host's slot, after the host's own node (same mechanism tenants
 *     use — a hosted REGION and a TENANT are both "rides inside a placed
 *     region's slot", just declared in two different tables).
 *   - `layer === true`           -> nothing into the grid; the region's
 *     own overlay host (a `<Drawer>`, rendered by `page.tsx` outside this
 *     component, or — for `tableControls` at 6b, which has none yet — an
 *     in-flow placement `page.tsx` builds into another region's own node,
 *     per that region's own `debt:` marker) renders it.
 *   - genuinely absent (`area`/`host`/`layer` all unset) -> rendered
 *     nowhere. Reachable only for a NON-announcing region (`offers`
 *     during combat) — the R3 guards (presets.ts's own host/visible
 *     checks, play-data-region-contract.test.ts's tenant guards) already
 *     make this unreachable for anything `ANNOUNCING_REGIONS` lists.
 *
 * **DOM order in this commit is today's document order**, as an explicit
 * constant (`DOM_ORDER` below) — a measurement baseline, not a design.
 * C5 replaces it with an order derived from the row's own `areas` string.
 *
 * `key={regionId}` on every slot (rule 1): without a stable key a row
 * switch reorders children by array position and React remounts them —
 * the map's lost canvas, the scrolled log jumping to the top (R18). Slots
 * get `min-width:0`/`min-height:0` (rule 2) so the fixed-height grid
 * doesn't overflow on a grid item's default `auto` minimum. The landmark
 * element IS the slot (rule 3) for `partyStrip`/`storyLog`/`sceneStage` —
 * three entries, and the names are the accessibility contract, pinned by
 * `play.tav-play-landmarks.test.tsx` / `play.tav3-auth-gate.test.tsx`.
 */
import { Fragment, type ReactNode } from 'react';
import {
  REGION_IDS,
  REGION_TENANTS,
  TENANT_IDS,
  getPlacement,
  type LayoutRow,
  type Moment,
  type RegionId,
  type TenantId,
} from './presets';
import styles from './Play.module.css';

export interface PlayShellProps {
  row: LayoutRow;
  moment: Moment;
  /** Built by page.tsx, where the region components' own props/handlers
   *  already live — the shell never imports a region. */
  regions: Partial<Record<RegionId, ReactNode>>;
  tenants: Partial<Record<TenantId, ReactNode>>;
  /** `.mobileTabs` until A9d — shell chrome, not a region or a tenant. */
  chrome?: ReactNode;
  /** The two `<Drawer>`s + `<ConfirmDialog>` — overlay hosts, outside the
   *  grid; position within this root doesn't matter (they are
   *  fixed/portal-adjacent), kept trailing for file readability. */
  layers?: ReactNode;
  /** Additive, merged with `.grid` — today's one caller is `mobileView`'s
   *  `showJournal` class (Amendment B.5 point 2: `mobileView`/
   *  `journalVisible` are explicitly NOT touched at 6b), which
   *  `Play.module.css`'s `.showJournal .journalPane` rule still needs on
   *  an ANCESTOR of the Journal drawer (rendered via `layers`) for the
   *  phone-width in-flow fallback. */
  className?: string;
}

/** Measurement baseline (not a design — see this file's header). Covers
 *  every `RegionId`; a region that is `layer:true` or genuinely absent in
 *  every row/moment (none today) would simply never reach the loop body's
 *  rendering branches, regardless of its position here. */
const DOM_ORDER: readonly RegionId[] = [
  'safetyBanner',
  'topBar',
  'partyStrip',
  'characterBlock',
  'suzuPresence',
  'storyLog',
  'offers',
  'actionBar',
  'composer',
  'tableControls',
  'sceneStage',
];

interface LandmarkSpec {
  as: 'aside' | 'main';
  id: string;
  'aria-label'?: string;
  /** Additional scroll/stack treatment layered on top of `.slot`. */
  layoutClassName: string;
}

/** Rule 3: the landmark element IS the slot — three entries, and the
 *  names are the accessibility contract (unchanged from pre-shell page.tsx:
 *  `#play-pane-party`/`#play-pane-story`/`#play-pane-scene`, same
 *  `aria-label`s, same exactly-2-`complementary`-plus-1-`main` count). */
const LANDMARKS: Partial<Record<RegionId, LandmarkSpec>> = {
  partyStrip: {
    as: 'aside',
    id: 'play-pane-party',
    'aria-label': 'Party and initiative',
    layoutClassName: styles.slotScroll,
  },
  storyLog: {
    as: 'main',
    id: 'play-pane-story',
    layoutClassName: styles.slotStack,
  },
  sceneStage: {
    as: 'aside',
    id: 'play-pane-scene',
    'aria-label': 'Scene',
    layoutClassName: styles.slotScroll,
  },
};

export default function PlayShell({
  row,
  moment,
  regions,
  tenants,
  chrome,
  layers,
  className,
}: PlayShellProps) {
  // Tenants grouped by host, in TENANT_IDS declaration order (the tenth
  // tenant is one presets.ts row — no code change here).
  const tenantsByHost = new Map<RegionId, ReactNode[]>();
  for (const tenantId of TENANT_IDS) {
    const node = tenants[tenantId];
    if (node === undefined) continue;
    const { host } = REGION_TENANTS[tenantId];
    const list = tenantsByHost.get(host) ?? [];
    list.push(<Fragment key={tenantId}>{node}</Fragment>);
    tenantsByHost.set(host, list);
  }

  // Regions hosted by ANOTHER region (e.g. table.topBar -> sceneStage,
  // phone.partyStrip/suzuPresence -> topBar), grouped the same way, in
  // REGION_IDS declaration order.
  const hostedRegionsByHost = new Map<RegionId, ReactNode[]>();
  for (const regionId of REGION_IDS) {
    const placement = getPlacement(row, regionId, moment);
    if (placement.host == null) continue;
    const node = regions[regionId];
    if (node === undefined) continue;
    const list = hostedRegionsByHost.get(placement.host) ?? [];
    list.push(<Fragment key={regionId}>{node}</Fragment>);
    hostedRegionsByHost.set(placement.host, list);
  }

  const slots: ReactNode[] = [];
  for (const regionId of DOM_ORDER) {
    const placement = getPlacement(row, regionId, moment);
    // `host != null` / `layer === true` / genuinely absent: nothing of its
    // own in the grid (see this file's header for all three).
    if (placement.host != null || placement.layer === true || placement.area == null) {
      continue;
    }

    const hidden = placement.visible === false;
    const landmark = LANDMARKS[regionId];
    const Tag = landmark?.as ?? 'div';
    const className = [
      styles.slot,
      landmark?.layoutClassName,
      hidden ? styles.slotHidden : null,
    ]
      .filter(Boolean)
      .join(' ');

    slots.push(
      <Tag
        key={regionId}
        id={landmark?.id}
        aria-label={landmark?.['aria-label']}
        className={className}
        style={{ gridArea: placement.area }}
        data-region-slot={regionId}
        data-area={placement.area}
        data-visible={!hidden}
      >
        {regions[regionId]}
        {hostedRegionsByHost.get(regionId)}
        {tenantsByHost.get(regionId)}
      </Tag>,
    );
  }

  return (
    <div
      id="main-content"
      className={className ? `${styles.grid} ${className}` : styles.grid}
      data-layout-resolved={row.id}
      data-moment={moment}
      style={
        {
          '--play-areas': row.areas[moment],
          '--play-columns': row.columns[moment],
          '--play-rows': row.rows[moment],
        } as React.CSSProperties
      }
    >
      {chrome}
      {slots}
      {layers}
    </div>
  );
}
