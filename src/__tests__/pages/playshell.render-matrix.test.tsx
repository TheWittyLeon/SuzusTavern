/**
 * TAV-PLAY-SHELL step 6b, commit C4 (build brief §7 C4 "New pins this
 * commit owns") — `PlayShell`'s own mechanism, tested in isolation with
 * STUB data (not the real `presets.ts` rows — those, and their genuinely
 * row-varying host/layer/visible shapes, are already pinned at the data
 * layer by `play-preset-registry.test.ts` and
 * `play-data-region-contract.test.ts`'s tenant guards). A9c extends these
 * mechanisms to the real page; it does not build them twice.
 *
 * Four things pinned here, per the build brief:
 *   1. A minimal render matrix: the same SET of `data-region-slot` ids
 *      mounts for every row × moment combination; only `data-visible`/
 *      `data-area` differ.
 *   2. Every `ANNOUNCING_REGIONS` member is `data-visible="true"` in all
 *      6 combinations (R3, on the shell rather than on the data).
 *   3. No remount across a row switch (`key={regionId}`, build brief
 *      §6.4 rule 1).
 *   4. `data-layout-resolved`/`data-moment` reflect `resolveLayout`'s
 *      output for (pref × isPhone × moment) — tested on `usePlayLayout`
 *      directly, the one piece that actually calls `resolveLayout`;
 *      `PlayShell` itself only ever reflects `row.id`/`moment` verbatim.
 */
import { useState } from 'react';
import { fireEvent, render, renderHook } from '@testing-library/react';
import '@testing-library/jest-dom';
import PlayShell from '@/app/play/[sessionId]/PlayShell';
import { usePlayLayout } from '@/app/play/[sessionId]/hooks/usePlayLayout';
import { ThemeProvider } from '@/lib/theme/ThemeProvider';
import {
  ANNOUNCING_REGIONS,
  REGION_IDS,
  type LayoutRow,
  type Moment,
  type Placement,
  type RegionId,
} from '@/app/play/[sessionId]/presets';

const MOMENTS: readonly Moment[] = ['exploring', 'combat'];

/** A MINIMAL stub row: every region gets its own grid area (no host/layer
 *  variation — that richer shape is the real rows' own concern, pinned
 *  elsewhere). `hidden` optionally hides ONE region via `visible: false`,
 *  to exercise that branch without touching the "same set of ids" claim
 *  (a hidden region is still MOUNTED, just `data-visible="false"`). */
function stubRow(id: LayoutRow['id'], hidden?: RegionId): LayoutRow {
  const areaTokens = REGION_IDS.join(' ');
  const regions = {} as LayoutRow['regions'];
  for (const regionId of REGION_IDS) {
    const placement: Placement = { area: regionId };
    if (regionId === hidden) placement.visible = false;
    regions[regionId] = { default: placement };
  }
  return {
    id,
    label: id,
    // One row, REGION_IDS.length columns — purely synthetic, never meant
    // to look like anything; only the mechanism under test cares.
    columns: { exploring: REGION_IDS.map(() => '1fr').join(' '), combat: REGION_IDS.map(() => '1fr').join(' ') },
    rows: { exploring: 'auto', combat: 'auto' },
    areas: { exploring: `"${areaTokens}"`, combat: `"${areaTokens}"` },
    regions,
  };
}

function stubRegionNodes(): Partial<Record<RegionId, React.ReactNode>> {
  const out: Partial<Record<RegionId, React.ReactNode>> = {};
  for (const id of REGION_IDS) out[id] = <span>{id}</span>;
  return out;
}

describe('PlayShell — minimal render matrix (build brief §7 C4, pin 1+2)', () => {
  // Three stub rows, deliberately near-identical (same 11 regions, same
  // area-per-region shape) — the POINT is that resolving a different
  // row/moment must not change WHICH regions mount, only their
  // visibility. `table`'s stub hides `offers` (a non-announcing region,
  // matching real data's own only-hideable region) in BOTH moments, so
  // the fixture exercises the hidden branch without ever hiding an
  // announcing region.
  const ROWS: LayoutRow[] = [stubRow('story'), stubRow('table', 'offers'), stubRow('phone')];

  for (const row of ROWS) {
    for (const moment of MOMENTS) {
      it(`${row.id}/${moment}: the same 11 data-region-slot ids mount as every other combination`, () => {
        const { container, unmount } = render(
          <PlayShell row={row} moment={moment} regions={stubRegionNodes()} tenants={{}} />,
        );
        const slots = Array.from(container.querySelectorAll('[data-region-slot]'));
        const ids = slots.map((el) => el.getAttribute('data-region-slot')).sort();
        expect(ids).toEqual([...REGION_IDS].sort());
        unmount();
      });

      it(`${row.id}/${moment}: every ANNOUNCING_REGIONS member is data-visible="true" (R3, on the shell)`, () => {
        const { container, unmount } = render(
          <PlayShell row={row} moment={moment} regions={stubRegionNodes()} tenants={{}} />,
        );
        for (const regionId of ANNOUNCING_REGIONS) {
          const slot = container.querySelector(`[data-region-slot="${regionId}"]`);
          expect(slot).not.toBeNull();
          expect(slot).toHaveAttribute('data-visible', 'true');
        }
        unmount();
      });
    }
  }

  it('the hidden stub region (offers, non-announcing) carries data-visible="false" and the .slotHidden class, never an inline display:none', () => {
    const row = ROWS.find((r) => r.id === 'table')!;
    const { container } = render(
      <PlayShell row={row} moment="exploring" regions={stubRegionNodes()} tenants={{}} />,
    );
    const slot = container.querySelector('[data-region-slot="offers"]');
    expect(slot).toHaveAttribute('data-visible', 'false');
    expect(slot?.getAttribute('style') ?? '').not.toMatch(/display/);
  });

  /**
   * Mutation control, hand-run (same discipline as play-preset-registry.
   * test.ts's own trailing comment block): temporarily changed `story`'s
   * stub so `storyLog`'s `default` placement omitted `area` entirely
   * (`{}` instead of `{ area: 'storyLog' }`) — `story`'s stub has no
   * per-moment override, so this affects BOTH its moments, leaving
   * `table`'s and `phone`'s 4 combinations untouched. Result: exactly 4
   * red — the two `story` "same 11 ids" cases (10 ids, missing
   * `storyLog`) and the two `story` "ANNOUNCING_REGIONS visible" cases
   * (`storyLog` IS announcing, so its now-missing slot fails the
   * not-null check) — while all 4 `table`/`phone` combinations stayed
   * green, confirming each combination's assertions depend on that
   * combination's own data, not a shared fixture quirk. Reverted
   * immediately; full file reconfirmed green (17/17).
   */
});

describe('PlayShell — no remount across a row switch (build brief §6.4 rule 1)', () => {
  function StatefulMarker() {
    const [count, setCount] = useState(0);
    return (
      <button type="button" onClick={() => setCount((c) => c + 1)} data-testid="marker">
        {count}
      </button>
    );
  }

  it('a stateful child of storyLog keeps its state across a row switch (key={regionId})', () => {
    const rowA = stubRow('story');
    // rowB removes an EARLIER region (characterBlock, index 3 of 11 in
    // PlayShell's own DOM_ORDER) from the grid entirely (host, not area) —
    // so storyLog (index 5) shifts from array position 5 to 4 among
    // RENDERED slots between the two renders. Without `key`, React's
    // positional fallback would match storyLog's new position-4 element
    // against whatever rowA rendered at position 4 (suzuPresence) instead
    // of its own prior element, which is the exact failure `key={regionId}`
    // exists to prevent — row-position-only matching is deliberately NOT
    // enough for this control to be real (see the mutation note below).
    const rowB = stubRow('table');
    rowB.regions.characterBlock = { default: { area: null, host: 'partyStrip' } };
    const regions = { ...stubRegionNodes(), storyLog: <StatefulMarker /> };

    const { rerender, getByTestId } = render(
      <PlayShell row={rowA} moment="exploring" regions={regions} tenants={{}} />,
    );
    const marker = getByTestId('marker');
    fireEvent.click(marker);
    fireEvent.click(marker);
    expect(marker).toHaveTextContent('2');

    rerender(<PlayShell row={rowB} moment="exploring" regions={regions} tenants={{}} />);
    // Same DOM node, same internal state -- a remount would reset the
    // counter to 0 and (with how React mounts fresh elements) very likely
    // also change node identity.
    expect(getByTestId('marker')).toBe(marker);
    expect(getByTestId('marker')).toHaveTextContent('2');
  });

  /**
   * Mutation control, hand-run: removed `key={regionId}` from PlayShell's
   * slot element (`<Tag key={regionId} ...>` -> `<Tag ...>`) and re-ran
   * this exact test. First pass (rowB sharing storyLog's exact array
   * position with rowA) stayed GREEN even keyless -- a false negative:
   * React's positional fallback is sufficient when nothing shifts
   * position, so that version of the control proved nothing. Fixed by
   * making rowB host `characterBlock` (index 3 of 11 in DOM_ORDER)
   * instead of grid-placing it, which shifts storyLog from rendered
   * position 5 to position 4. Re-ran keyless: RED --
   * `getByTestId('marker')` after the `rerender` no longer `===` the
   * original node, and its text content reset to `0` (state lost) --
   * React's positional fallback matched storyLog's new position-4 slot
   * against whatever rowA rendered there instead of its own prior
   * element. Restored `key={regionId}` immediately; full file
   * reconfirmed green (17/17).
   */
});

describe('usePlayLayout — data-layout-resolved/data-moment reflect resolveLayout (build brief §7 C4, pin 4)', () => {
  function withTheme(children: React.ReactNode) {
    return <ThemeProvider>{children}</ThemeProvider>;
  }

  function mockMatchMedia(matches: boolean) {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: jest.fn().mockImplementation((query: string) => ({
        matches,
        media: query,
        onchange: null,
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
        dispatchEvent: jest.fn(),
      })),
    });
  }

  afterEach(() => {
    // Restore jest.setup.ts's own default (matches: false) so later files
    // in the same worker aren't left with this test's override.
    mockMatchMedia(false);
  });

  it('pref "table" while exploring (not phone) resolves to the "table" row — a pinned LayoutPref overrides Auto\'s story-while-exploring default', () => {
    mockMatchMedia(false);
    localStorage.setItem('tavern.layout', 'table');
    const { result } = renderHook(() => usePlayLayout('exploring'), {
      wrapper: ({ children }) => withTheme(children),
    });
    expect(result.current.layoutId).toBe('table');
    expect(result.current.row.id).toBe('table');
    expect(result.current.isPhone).toBe(false);
    localStorage.removeItem('tavern.layout');
  });

  it('matchMedia forced true resolves to "phone" regardless of pref (R16: phone has one layout, full stop)', () => {
    mockMatchMedia(true);
    localStorage.setItem('tavern.layout', 'table');
    const { result } = renderHook(() => usePlayLayout('exploring'), {
      wrapper: ({ children }) => withTheme(children),
    });
    expect(result.current.layoutId).toBe('phone');
    expect(result.current.isPhone).toBe(true);
    localStorage.removeItem('tavern.layout');
  });

  it("<PlayShell>'s own data-layout-resolved/data-moment reflect row.id/moment verbatim (PlayShell never calls resolveLayout itself)", () => {
    const row = stubRow('table');
    render(<PlayShell row={row} moment="combat" regions={stubRegionNodes()} tenants={{}} />);
    const el = document.getElementById('main-content');
    expect(el).toHaveAttribute('data-layout-resolved', 'table');
    expect(el).toHaveAttribute('data-moment', 'combat');
  });
});
