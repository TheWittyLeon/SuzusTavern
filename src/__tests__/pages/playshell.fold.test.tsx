/**
 * A9c C7 (build brief 5.1/5.2) -- the shell is the ONE reader of
 * `Placement.collapsible`. Real rows x moments, real FOLD_SPECS, stub region
 * content. jsdom applies no CSS, so `hidden` (an attribute) is what a fold
 * asserts; layout is the browser pass.
 */
import { useEffect } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import PlayShell from '@/app/play/[sessionId]/PlayShell';
import { FOLD_SPECS } from '@/app/play/[sessionId]/foldSpecs';
import {
  FOLDABLE_REGIONS,
  LAYOUT_ROWS,
  REGION_IDS,
  getPlacement,
  type LayoutRow,
  type Moment,
  type RegionId,
} from '@/app/play/[sessionId]/presets';

const MOMENTS: readonly Moment[] = ['exploring', 'combat'];
const COMBOS: Array<[string, LayoutRow, Moment]> = LAYOUT_ROWS.flatMap((row) =>
  MOMENTS.map((m): [string, LayoutRow, Moment] => [`${row.id}/${m}`, row, m]),
);

function regionNodes(): Partial<Record<RegionId, React.ReactNode>> {
  const out: Partial<Record<RegionId, React.ReactNode>> = {};
  for (const id of REGION_IDS) out[id] = <span data-probe-region={id}>{id}</span>;
  return out;
}

const collapsibleIds = (row: LayoutRow, m: Moment) =>
  REGION_IDS.filter((id) => {
    const p = getPlacement(row, id, m);
    return p.collapsible === true && p.layer !== true;
  });

describe('every collapsible placement has a FoldSpec (collapsible-without-spec must never ship)', () => {
  it('FOLD_SPECS covers FOLDABLE_REGIONS exactly', () => {
    expect(Object.keys(FOLD_SPECS).sort()).toEqual([...FOLDABLE_REGIONS].sort());
  });
});

describe('a region whose node is null renders nothing, not an empty dock (Kage S10)', () => {
  const NULLED = [...FOLDABLE_REGIONS].flatMap((id) => COMBOS.map((c): [string, ...typeof c] => [id, ...c]));
  it.each(NULLED)('%s null in %s: no handle for it, no dock in its slot', (id, _n, row, moment) => {
    const { container } = render(
      <PlayShell row={row} moment={moment} regions={{ ...regionNodes(), [id]: null }} tenants={{}} foldSpecs={FOLD_SPECS} />,
    );
    expect(screen.queryByRole('button', { name: FOLD_SPECS[id as RegionId]!.label })).toBeNull();
    const slot = container.querySelector(`[data-region-slot="${id}"]`);
    if (slot) expect(slot.querySelector('[data-foldable]')).toBeNull();
  });
});

describe('PlayShell folds a region because its PLACEMENT says collapsible, in every real row x moment', () => {
  it.each(COMBOS)('%s: a handle exists for exactly the collapsible, non-layer regions', (_n, row, moment) => {
    const { container } = render(
      <PlayShell row={row} moment={moment} regions={regionNodes()} tenants={{}} foldSpecs={FOLD_SPECS} />,
    );
    const handles = Array.from(container.querySelectorAll('button[aria-expanded]'));
    const expected = collapsibleIds(row, moment).map((id) => FOLD_SPECS[id as RegionId]!.label);
    expect(handles.map((h) => h.getAttribute('aria-label')).sort()).toEqual([...expected].sort());
    for (const h of handles) {
      expect(h).toHaveAttribute('aria-expanded', 'true');
      const panel = document.getElementById(h.getAttribute('aria-controls') as string);
      expect(panel).not.toBeNull();
      expect(panel).not.toHaveAttribute('hidden');
    }
  });

  it.each(COMBOS)('%s: with NO spec a collapsible region renders unfolded (never silently unfoldable)', (_n, row, moment) => {
    const { container } = render(
      <PlayShell row={row} moment={moment} regions={regionNodes()} tenants={{}} />,
    );
    expect(container.querySelectorAll('button[aria-expanded]')).toHaveLength(0);
    for (const id of collapsibleIds(row, moment)) {
      expect(container.querySelector(`[data-probe-region="${id}"]`)).toBeVisible();
    }
  });

  it('the mutation control: a row whose placement is not collapsible gets no handle (Kage IMP-4)', () => {
    const table = LAYOUT_ROWS.find((r) => r.id === 'table')!;
    const stripped = {
      ...table,
      regions: { ...table.regions, characterBlock: { default: { area: 'characterBlock', variant: 'full' } } },
    } as LayoutRow;
    render(<PlayShell row={stripped} moment="exploring" regions={regionNodes()} tenants={{}} foldSpecs={FOLD_SPECS} />);
    expect(screen.queryByRole('button', { name: 'Character sheet' })).not.toBeInTheDocument();
  });
});

describe('PlayShell fold state', () => {
  const table = LAYOUT_ROWS.find((r) => r.id === 'table')!;
  const phone = LAYOUT_ROWS.find((r) => r.id === 'phone')!;

  it('folded: the region stays MOUNTED but hidden; the handle stays the same node and says Open', () => {
    const { rerender } = render(
      <PlayShell row={table} moment="exploring" regions={regionNodes()} tenants={{}} foldSpecs={FOLD_SPECS} />,
    );
    const handle = screen.getByRole('button', { name: 'Character sheet' });
    rerender(
      <PlayShell
        row={table}
        moment="exploring"
        regions={regionNodes()}
        tenants={{}}
        foldSpecs={FOLD_SPECS}
        foldedRegions={new Set<RegionId>(['characterBlock'])}
      />,
    );
    expect(screen.getByRole('button', { name: 'Character sheet' })).toBe(handle);
    expect(handle).toHaveAttribute('aria-expanded', 'false');
    expect(handle).toHaveAttribute('title', 'Open character sheet');
    const probe = document.querySelector('[data-probe-region="characterBlock"]') as HTMLElement;
    expect(probe).toBeInTheDocument();
    expect(probe).not.toBeVisible();
  });

  it('the handle calls onToggleFold with its own region id', () => {
    const onToggleFold = jest.fn();
    render(
      <PlayShell
        row={table}
        moment="exploring"
        regions={regionNodes()}
        tenants={{}}
        foldSpecs={FOLD_SPECS}
        onToggleFold={onToggleFold}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Character sheet' }));
    expect(onToggleFold).toHaveBeenCalledWith('characterBlock');
  });

  it('a pref that folds a region this row does not make collapsible does not fold it (Table fold, then Story)', () => {
    const story = LAYOUT_ROWS.find((r) => r.id === 'story')!;
    const { container } = render(
      <PlayShell
        row={story}
        moment="exploring"
        regions={regionNodes()}
        tenants={{}}
        foldSpecs={FOLD_SPECS}
        foldedRegions={new Set<RegionId>(['sceneStage'])}
      />,
    );
    expect(container.querySelector('[data-probe-region="sceneStage"]')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Scene stage' })).not.toBeInTheDocument();
  });

  it('phone: the stage gets a handle, and no extra landmark (it is already the Scene aside)', () => {
    render(<PlayShell row={phone} moment="exploring" regions={regionNodes()} tenants={{}} foldSpecs={FOLD_SPECS} />);
    const handle = screen.getByRole('button', { name: 'Scene stage' });
    expect(handle).toHaveAttribute('aria-expanded', 'true');
    const scene = screen.getByRole('complementary', { name: 'Scene' });
    // MINOR-4: the handle is not named like the landmark it controls
    expect(handle).not.toHaveAccessibleName('Scene');
    expect(within(scene).queryByRole('region')).not.toBeInTheDocument();
  });

  it('tenants stay OUTSIDE the fold: a folded stage hides its own node, not the dice tray it hosts', () => {
    render(
      <PlayShell
        row={phone}
        moment="exploring"
        regions={regionNodes()}
        tenants={{ diceTray: <span data-probe-tenant="diceTray">dice</span> }}
        foldSpecs={FOLD_SPECS}
        foldedRegions={new Set<RegionId>(['sceneStage'])}
      />,
    );
    expect(document.querySelector('[data-probe-region="sceneStage"]')).not.toBeVisible();
    const tray = document.querySelector('[data-probe-tenant="diceTray"]') as HTMLElement;
    expect(tray).toBeVisible();
    expect(tray.closest('[data-foldable]')).toBeNull();
  });
});

describe('a fold changes the dock\'s MODE across a row switch, never its place in the tree (presets place, they never unmount)', () => {
  const PAIRS: Array<[string, LayoutRow, Moment, LayoutRow, Moment]> = [];
  for (const a of LAYOUT_ROWS) for (const ma of MOMENTS) for (const b of LAYOUT_ROWS) for (const mb of MOMENTS) {
    if (a === b && ma === mb) continue;
    PAIRS.push([`${a.id}/${ma} -> ${b.id}/${mb}`, a, ma, b, mb]);
  }

  it.each(PAIRS)('%s: the stage mounts once even though its dock turns on/off', (_n, a, ma, b, mb) => {
    const log: string[] = [];
    const Stage = () => {
      useEffect(() => {
        log.push('sceneStage');
      }, []);
      return <span data-probe-region="sceneStage" />;
    };
    const regions = { ...regionNodes(), sceneStage: <Stage /> };
    const { rerender } = render(
      <PlayShell row={a} moment={ma} regions={regions} tenants={{}} foldSpecs={FOLD_SPECS} />,
    );
    rerender(<PlayShell row={b} moment={mb} regions={regions} tenants={{}} foldSpecs={FOLD_SPECS} />);
    expect(log).toEqual(['sceneStage']);
  });
});
