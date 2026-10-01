/**
 * A9b QA (Miko) -- PlayShell against the REAL registry rows.
 *
 * The builder's `playshell.render-matrix.test.tsx` runs STUB rows in which every
 * region owns an area. That proves the mechanism and nothing about the three
 * shapes the real rows actually use: a region HOSTED by another region
 * (table.topBar -> sceneStage; phone.partyStrip/suzuPresence -> topBar), a
 * region that is a LAYER (characterBlock in story/phone), and a region with
 * `area: null` (offers in combat). Those are exactly where "every announcing
 * region stays mounted inside a visible host" can break, so this file mounts
 * the real rows x moments and asserts it.
 *
 * jsdom applies no CSS, so everything here is DOM-structure only. Layout
 * claims (zero-height log, X-card off-screen) are in the browser pass.
 */
import { useEffect, useRef } from 'react';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';
import PlayShell from '@/app/play/[sessionId]/PlayShell';
import {
  ANNOUNCING_REGIONS,
  LAYOUT_ROWS,
  REGION_IDS,
  REGION_TENANTS,
  TENANT_IDS,
  getPlacement,
  type LayoutRow,
  type Moment,
  type RegionId,
  type TenantId,
} from '@/app/play/[sessionId]/presets';

const MOMENTS: readonly Moment[] = ['exploring', 'combat'];

function regionNodes(): Partial<Record<RegionId, React.ReactNode>> {
  const out: Partial<Record<RegionId, React.ReactNode>> = {};
  for (const id of REGION_IDS) out[id] = <span data-probe-region={id}>{id}</span>;
  return out;
}
function tenantNodes(): Partial<Record<TenantId, React.ReactNode>> {
  const out: Partial<Record<TenantId, React.ReactNode>> = {};
  for (const id of TENANT_IDS) out[id] = <span data-probe-tenant={id}>{id}</span>;
  return out;
}

/** The slot that ultimately contains a probe, and that slot's visibility. */
function hostSlotOf(container: HTMLElement, attr: string, id: string) {
  const nodes = container.querySelectorAll(`[${attr}="${id}"]`);
  return {
    count: nodes.length,
    slot: nodes[0]?.closest('[data-region-slot]') as HTMLElement | null,
  };
}

const COMBOS: Array<[LayoutRow, Moment]> = LAYOUT_ROWS.flatMap((row) =>
  MOMENTS.map((m): [LayoutRow, Moment] => [row, m]),
);

describe('PlayShell on the REAL rows -- announcers stay mounted in a visible host', () => {
  it.each(COMBOS)('%#: every ANNOUNCING region that is not a layer renders exactly once, in a data-visible slot', (row, moment) => {
    const { container } = render(
      <PlayShell row={row} moment={moment} regions={regionNodes()} tenants={tenantNodes()} />,
    );
    for (const id of ANNOUNCING_REGIONS) {
      const p = getPlacement(row, id, moment);
      if (p.layer === true) continue; // rendered by its own overlay host in page.tsx
      const { count, slot } = hostSlotOf(container, 'data-probe-region', id);
      expect({ row: row.id, moment, id, count }).toEqual({ row: row.id, moment, id, count: 1 });
      expect(slot).not.toBeNull();
      expect(slot).toHaveAttribute('data-visible', 'true');
      // the slot must be the region's own, or its declared host's
      const expectedSlot = p.host ?? id;
      expect(slot).toHaveAttribute('data-region-slot', expectedSlot);
    }
  });

  it.each(COMBOS)('%#: every tenant renders exactly once inside its host region slot, visible', (row, moment) => {
    const { container } = render(
      <PlayShell row={row} moment={moment} regions={regionNodes()} tenants={tenantNodes()} />,
    );
    for (const tid of TENANT_IDS) {
      const { count, slot } = hostSlotOf(container, 'data-probe-tenant', tid);
      const host = REGION_TENANTS[tid].host;
      expect({ row: row.id, moment, tid, count }).toEqual({ row: row.id, moment, tid, count: 1 });
      // A tenant whose host is itself hosted elsewhere would be orphaned;
      // assert the slot it landed in is a real, visible, top-level slot.
      expect(slot).not.toBeNull();
      expect(slot).toHaveAttribute('data-visible', 'true');
      if (getPlacement(row, host, moment).area != null) {
        expect(slot).toHaveAttribute('data-region-slot', host);
      }
    }
  });

  it.each(COMBOS)('%#: the X-card banner slot (safetyBanner) is always its own visible slot', (row, moment) => {
    const { container } = render(
      <PlayShell row={row} moment={moment} regions={regionNodes()} tenants={tenantNodes()} />,
    );
    const slot = container.querySelector('[data-region-slot="safetyBanner"]');
    expect(slot).not.toBeNull();
    expect(slot).toHaveAttribute('data-visible', 'true');
    expect(slot).toContainElement(container.querySelector('[data-probe-region="safetyBanner"]') as HTMLElement);
  });

  it('table: topBar rides inside the sceneStage slot, AFTER the stage node (hosted-region path)', () => {
    const table = LAYOUT_ROWS.find((r) => r.id === 'table')!;
    const { container } = render(
      <PlayShell row={table} moment="combat" regions={regionNodes()} tenants={tenantNodes()} />,
    );
    const stage = container.querySelector('[data-region-slot="sceneStage"]')!;
    expect(stage.querySelector('[data-probe-region="topBar"]')).not.toBeNull();
    expect(container.querySelector('[data-region-slot="topBar"]')).toBeNull();
  });

  it('phone: partyStrip and suzuPresence ride inside the topBar slot', () => {
    const phone = LAYOUT_ROWS.find((r) => r.id === 'phone')!;
    for (const m of MOMENTS) {
      const { container, unmount } = render(
        <PlayShell row={phone} moment={m} regions={regionNodes()} tenants={tenantNodes()} />,
      );
      const bar = container.querySelector('[data-region-slot="topBar"]')!;
      expect(bar.querySelector('[data-probe-region="partyStrip"]')).not.toBeNull();
      expect(bar.querySelector('[data-probe-region="suzuPresence"]')).not.toBeNull();
      unmount();
    }
  });

  it('layer regions (characterBlock in story/phone) get NO shell slot -- the Drawer in page.tsx is their only host', () => {
    for (const row of LAYOUT_ROWS.filter((r) => r.id !== 'table')) {
      for (const m of MOMENTS) {
        const { container, unmount } = render(
          <PlayShell row={row} moment={m} regions={regionNodes()} tenants={tenantNodes()} />,
        );
        expect(container.querySelector('[data-probe-region="characterBlock"]')).toBeNull();
        unmount();
      }
    }
  });

  /**
   * DEFECT (brief section 6.4, "nothing unmounts"): `offers` has
   * `{area:null, visible:false}` in combat, and the shell skips `area == null`,
   * so the node is NOT hidden-but-mounted, it is unmounted. The brief says a
   * `visible:false` region keeps its slot with `.slotHidden`. `test.failing`
   * Fixed in A9b fix round 1 (Imp-2): the shell now emits a hidden-mounted
   * slot for an area-less, host-less, non-layer region.
   */
  it.each(LAYOUT_ROWS.map((r) => [r.id, r] as const))(
    'A9b-7: %s/combat -- offers stays MOUNTED (hidden), not unmounted',
    (_id, row) => {
      const { container } = render(
        <PlayShell row={row} moment="combat" regions={regionNodes()} tenants={tenantNodes()} />,
      );
      expect(container.querySelector('[data-probe-region="offers"]')).not.toBeNull();
    },
  );
});

describe('PlayShell on the REAL rows -- R18, no remount across a row/moment change', () => {
  /** Counts mounts of the node it wraps; a remount bumps the counter. */
  function mountCounter(log: string[], label: string) {
    return function Probe() {
      const first = useRef(true);
      useEffect(() => {
        if (first.current) {
          log.push(label);
          first.current = false;
        }
      }, []);
      return <span data-probe-region={label} />;
    };
  }

  const PAIRS: Array<[string, LayoutRow, Moment, LayoutRow, Moment]> = [];
  for (const a of LAYOUT_ROWS) for (const ma of MOMENTS) for (const b of LAYOUT_ROWS) for (const mb of MOMENTS) {
    if (a === b && ma === mb) continue;
    PAIRS.push([`${a.id}/${ma} -> ${b.id}/${mb}`, a, ma, b, mb]);
  }

  it.each(PAIRS)('%s: storyLog and sceneStage mount once, never again', (_name, a, ma, b, mb) => {
    const log: string[] = [];
    const Story = mountCounter(log, 'storyLog');
    const Stage = mountCounter(log, 'sceneStage');
    const regions = { ...regionNodes(), storyLog: <Story />, sceneStage: <Stage /> };
    const { rerender } = render(<PlayShell row={a} moment={ma} regions={regions} tenants={tenantNodes()} />);
    rerender(<PlayShell row={b} moment={mb} regions={regions} tenants={tenantNodes()} />);
    expect(log.sort()).toEqual(['sceneStage', 'storyLog']);
  });
});
