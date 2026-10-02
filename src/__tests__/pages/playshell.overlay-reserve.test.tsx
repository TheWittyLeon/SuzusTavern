/**
 * A9c-2 D7 -- the owner of an overlaid area RESERVES the edge its overlay sits on.
 *
 * Found by the harness's new check e:topBar:overText (Miko A9c-1 #2): Table's
 * header overlay lay over the stage's own "Scene / title / subtitle" heading.
 * The shell now tells the owner which edges are overlaid (`data-overlay-edges`,
 * derived from each overlay's anchor, never named per region) and the stylesheet
 * pads that edge by the bar's height token. jsdom applies no CSS, so the DOM
 * contract and the stylesheet's own wiring are pinned separately; the measured
 * proof is the harness.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';
import PlayShell from '@/app/play/[sessionId]/PlayShell';
import { LAYOUT_ROWS, REGION_IDS, getPlacement, type LayoutRow, type Moment, type RegionId } from '@/app/play/[sessionId]/presets';

const MOMENTS: readonly Moment[] = ['exploring', 'combat'];
const regions = () => Object.fromEntries(REGION_IDS.map((id) => [id, <span key={id}>{id}</span>])) as Partial<Record<RegionId, React.ReactNode>>;
const slot = (c: HTMLElement, id: string) => c.querySelector(`[data-region-slot="${id}"]`) as HTMLElement;

describe('overlay owners reserve the overlaid edge', () => {
  it.each(LAYOUT_ROWS.flatMap((r) => MOMENTS.map((m): [LayoutRow, Moment] => [r, m])))(
    '%#: an area\'s owner lists exactly the edges its overlays anchor to; every other slot lists none',
    (row, moment) => {
      const { container } = render(<PlayShell row={row} moment={moment} regions={regions()} tenants={{}} />);
      const expected = new Map<string, Set<string>>();
      for (const id of REGION_IDS) {
        const p = getPlacement(row, id, moment);
        if (p.anchor == null || p.area == null) continue;
        expected.set(p.area, (expected.get(p.area) ?? new Set()).add(p.anchor.split('-')[0]));
      }
      for (const s of container.querySelectorAll('[data-region-slot]')) {
        const area = s.getAttribute('data-area');
        const isOverlay = s.hasAttribute('data-anchor');
        const want = !isOverlay && area != null ? [...(expected.get(area) ?? [])].sort().join(' ') : '';
        expect({ slot: s.getAttribute('data-region-slot'), edges: s.getAttribute('data-overlay-edges') ?? '' }).toEqual({
          slot: s.getAttribute('data-region-slot'),
          edges: want,
        });
      }
    },
  );

  it('Table reserves the stage\'s top edge (the real row); Story and Phone reserve nothing', () => {
    const table = LAYOUT_ROWS.find((r) => r.id === 'table')!;
    const { container } = render(<PlayShell row={table} moment="combat" regions={regions()} tenants={{}} />);
    expect(slot(container, 'sceneStage')).toHaveAttribute('data-overlay-edges', 'top');
  });

  it('a bottom-anchored overlay reserves the BOTTOM edge, and two overlays on one area reserve both (the tenth overlay is a row)', () => {
    const table = LAYOUT_ROWS.find((r) => r.id === 'table')!;
    const base = table.regions.topBar!.default!;
    const bottom: LayoutRow = { ...table, regions: { ...table.regions, topBar: { default: { ...base, anchor: 'bottom-end' } } } };
    expect(slot(render(<PlayShell row={bottom} moment="exploring" regions={regions()} tenants={{}} />).container, 'sceneStage')).toHaveAttribute('data-overlay-edges', 'bottom');
    const both: LayoutRow = {
      ...table,
      regions: { ...table.regions, topBar: { default: { ...base, anchor: 'top-start' } }, safetyBanner: { default: { ...table.regions.safetyBanner!.default!, area: base.area, anchor: 'bottom-start' } } },
    };
    expect(slot(render(<PlayShell row={both} moment="exploring" regions={regions()} tenants={{}} />).container, 'sceneStage')).toHaveAttribute('data-overlay-edges', 'bottom top');
  });

  it('the stylesheet reserves each edge (as a MARGIN, so it holds at every scroll position) by the SAME height token the overlay bar takes', () => {
    const css = readFileSync(path.join(process.cwd(), 'src/app/play/[sessionId]/Play.module.css'), 'utf8');
    // A10 step 11 S2b: the top edge's reserve is a row-overridable reader (`--play-overlay-reserve`, 40px in Table sets it to 0) whose FALLBACK is
    // the same bar height and margin, so the pin reads through the `var(` and keeps its claim: the default is still the overlay bar's own token.
    expect(css).toMatch(/\.slot\[data-overlay-edges~='top'\]\s*\{[^}]*margin-block-start:\s*var\(--play-overlay-reserve,\s*calc\(var\(--overlay-bar-h\)/);
    expect(css).toMatch(/\.slot\[data-overlay-edges~='bottom'\]\s*\{[^}]*margin-block-end:\s*calc\(var\(--overlay-bar-h\)/);
    expect(css).toMatch(/\.topBarCompact\s*\{[^}]*height:\s*var\(--overlay-bar-h\)/);
    expect(css).toMatch(/--overlay-bar-h:\s*\d+px/);
  });
});
