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
 * Five placement kinds, one loop, per `getPlacement`:
 *   - `area != null`             -> a grid-item slot (`.slot`), visible
 *     unless `visible === false` (`.slotHidden` — a CSS class, never an
 *     inline style: jsdom computes inline styles, dropping the node from
 *     RTL's accessibility-filtered queries, but a CSS Module class is
 *     invisible to jsdom — build brief §1 mechanism 1).
 *   - `anchor != null` (+ area)  -> an OVERLAY (A9c C4, Amendment C.1): its
 *     own keyed top-level slot in another region's area (`.slotOverlay`,
 *     `data-anchor`), self-aligned to a corner and stacked above that area's
 *     owner, which gains `data-overlaid` + `isolation:isolate`. Only those two
 *     elements ever gain stacking — never `.slot` generically, which would
 *     confine every in-slot `position:fixed` modal to its slot's stacking
 *     context (build brief §1).
 *   - `host != null`             -> nothing of its own; appended INSIDE
 *     the host's slot, after the host's own node (same mechanism tenants
 *     use — a hosted REGION and a TENANT are both "rides inside a placed
 *     region's slot", just declared in two different tables).
 *   - `layer === true`           -> nothing into the grid; the region's
 *     own overlay host (a `<Drawer>`, rendered by `page.tsx` outside this
 *     component, or — for `tableControls` at 6b, which has none yet — an
 *     in-flow placement `page.tsx` builds into another region's own node,
 *     per that region's own `debt:` marker) renders it.
 *   - genuinely absent (`area`/`host`/`layer` all unset, e.g. `offers`
 *     during combat) -> a MOUNTED `.slotHidden` node with
 *     `data-visible="false"` and no grid area: presets place, they never
 *     unmount (A9b Imp-2 — this used to be skipped, which unmounted the
 *     region and dropped its state on every combat edge). It is appended
 *     after the placed slots, in REGION_IDS order, under the same
 *     `key={regionId}` the placed slot has, so a moment switch toggles it
 *     between the two forms without a remount.
 *
 * **DOM order is `slotOrder(row, moment)`** (`presets.ts`, A9c C3/C.2): row-
 * major first appearance of each token in the row's own `areas` string, with
 * a hidden (area-less) slot emitted right after its nearest `REGION_IDS`
 * predecessor rather than appended last. It is data (pinned as literals in
 * the registry test), so DOM order tracks visual order in every row and the
 * tenth region's position is decided by its token in the `areas` string — a
 * row, not code. This component only walks the list.
 *
 * **`ScrollKeeper`** wraps the root: a slot MOVE resets a scroller to 0, so
 * every scroller under a region slot is snapshotted before a commit that
 * changes the order and restored after (`ScrollKeeper.tsx`).
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
import { Fragment, useRef, type ReactNode } from 'react';
import {
  REGION_TENANTS,
  TENANT_IDS,
  getPlacement,
  slotOrder,
  type Anchor,
  type LayoutRow,
  type Moment,
  type RegionId,
  type TenantId,
} from './presets';
import ScrollKeeper from './ScrollKeeper';
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
  const rootRef = useRef<HTMLDivElement>(null);
  const tenantsByHost = new Map<RegionId, ReactNode[]>();
  for (const tenantId of TENANT_IDS) {
    const node = tenants[tenantId];
    if (node === undefined) continue;
    const { host } = REGION_TENANTS[tenantId];
    const list = tenantsByHost.get(host) ?? [];
    list.push(<Fragment key={tenantId}>{node}</Fragment>);
    tenantsByHost.set(host, list);
  }

  // One derivation for the whole DOM shape (A9c C3): top-level slots, hidden
  // slots and hosted regions all come from `slotOrder`.
  const order = slotOrder(row, moment);

  // Regions hosted by ANOTHER region (e.g. table.topBar -> sceneStage,
  // phone.partyStrip/suzuPresence -> topBar), grouped by host, in slotOrder's
  // (REGION_IDS) order.
  const hostedRegionsByHost = new Map<RegionId, ReactNode[]>();
  for (const entry of order) {
    if (entry.kind !== 'hosted') continue;
    const node = regions[entry.id];
    if (node === undefined) continue;
    const list = hostedRegionsByHost.get(entry.host) ?? [];
    list.push(<Fragment key={entry.id}>{node}</Fragment>);
    hostedRegionsByHost.set(entry.host, list);
  }

  // C4 (C.1): the areas an overlay sits on. Their owner slots get
  // `data-overlaid` + `isolation:isolate` (and ONLY they do — never `.slot`).
  const overlaidAreas = new Set<string>();
  for (const entry of order) if (entry.kind === 'overlay') overlaidAreas.add(entry.area);

  const slotFor = (regionId: RegionId, area: string | null, anchor?: Anchor) => {
    const hidden = area == null || getPlacement(row, regionId, moment).visible === false;
    const landmark = LANDMARKS[regionId];
    const Tag = landmark?.as ?? 'div';
    const slotClass = [
      styles.slot,
      landmark?.layoutClassName,
      anchor != null ? styles.slotOverlay : null,
      hidden ? styles.slotHidden : null,
    ]
      .filter(Boolean)
      .join(' ');

    return (
      <Tag
        key={regionId}
        id={landmark?.id}
        aria-label={landmark?.['aria-label']}
        className={slotClass}
        style={area == null ? undefined : { gridArea: area }}
        data-region-slot={regionId}
        data-area={area ?? undefined}
        data-anchor={anchor}
        data-overlaid={anchor == null && area != null && overlaidAreas.has(area) ? 'true' : undefined}
        data-visible={!hidden}
      >
        {regions[regionId]}
        {hostedRegionsByHost.get(regionId)}
        {tenantsByHost.get(regionId)}
      </Tag>
    );
  };

  // A hidden slot is a MOUNTED `.slotHidden` node with `data-visible="false"`
  // and no grid area: presets place, they never unmount (A9b Imp-2). Same
  // `key={regionId}` as the placed form, so a moment switch toggles between the
  // two without a remount.
  const slots: ReactNode[] = [];
  for (const entry of order) {
    if (entry.kind === 'hosted') continue;
    if (entry.kind === 'hidden' && regions[entry.id] === undefined) continue;
    if (entry.kind === 'overlay') slots.push(slotFor(entry.id, entry.area, entry.anchor));
    else slots.push(slotFor(entry.id, entry.kind === 'hidden' ? null : getPlacement(row, entry.id, moment).area));
  }
  // The precise trigger for a DOM move (ScrollKeeper): slot order + hosting.
  const orderKey = order
    .map((entry) => (entry.kind === 'hosted' ? `${entry.host}>${entry.id}` : `${entry.kind}:${entry.id}`))
    .join(',');

  return (
    <ScrollKeeper orderKey={orderKey} rootRef={rootRef}>
      <div
        ref={rootRef}
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
    </ScrollKeeper>
  );
}
