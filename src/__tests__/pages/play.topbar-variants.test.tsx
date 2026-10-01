/**
 * TAV-PLAY-SHELL A9c-1 C4 — `topBar` variants (build brief §6) and
 * `variantFor`, the one read site for a placement's variant.
 *
 * `full` is today's markup (Story) and must not change; `compact` is
 * the one-line header over the Table stage. The compact variant keeps the single
 * announcer per fact (A4): NarratorStrip stays MOUNTED (R3, topBar still
 * announces) inside `sr-only`, and the visible pill is aria-hidden.
 */
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import TopBar, { type TopBarProps } from '@/app/play/[sessionId]/regions/TopBar';
import {
  LAYOUT_ROWS,
  LAYOUT_ROWS_BY_ID,
  REGION_VARIANTS,
  variantFor,
  type LayoutRow,
} from '@/app/play/[sessionId]/presets';

const base: TopBarProps = {
  title: 'The Hollow Tide',
  journalOpen: false,
  onToggleJournal: () => {},
  paneId: 'play-pane-journal',
  showSuzuPanel: true,
  talking: false,
  sceneName: 'Cave Mouth',
  objective: null,
  combatActive: false,
  round: null,
  turnStatusText: null,
  initiativeOrder: [],
  status: <span data-testid="pill">exploring</span>,
  statusPill: <span data-testid="pill">exploring</span>,
};

describe('A9c C4 — TopBar variants', () => {
  it('full (default): kicker present, NarratorStrip visible, pill not aria-hidden', () => {
    const { container } = render(<TopBar {...base} />);
    expect(screen.getByText('Session')).toBeInTheDocument();
    expect(container.querySelector('.sr-only')).toBeNull();
    expect(container.querySelector('[data-region="topBar"]')).toHaveAttribute('data-variant', 'full');
    expect(screen.getByTestId('pill').closest('[aria-hidden="true"]')).toBeNull();
  });

  it('compact: no kicker; exit, title and journal toggle stay reachable; one line of controls', () => {
    const { container } = render(<TopBar {...base} variant="compact" />);
    expect(container.querySelector('[data-region="topBar"]')).toHaveAttribute('data-variant', 'compact');
    expect(screen.queryByText('Session')).toBeNull();
    expect(screen.getByRole('link', { name: 'Leave session' })).toBeVisible();
    expect(screen.getByText('The Hollow Tide')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open journal' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('compact: NarratorStrip stays mounted in sr-only and the visible pill is aria-hidden (one announcer per fact, A4)', () => {
    const { container } = render(<TopBar {...base} variant="compact" />);
    const hidden = container.querySelector('.sr-only');
    expect(hidden).not.toBeNull();
    expect(hidden).toHaveTextContent('Cave Mouth');
    // two pills exist (visible aria-hidden + the one inside NarratorStrip); only one is announced
    const pills = screen.getAllByTestId('pill');
    expect(pills.filter((p) => p.closest('[aria-hidden="true"]') === null)).toHaveLength(1);
    expect(pills.some((p) => p.closest('.sr-only'))).toBe(true);
  });

  it('compact + ai-off: no NarratorStrip; the status pill surfaces inline in its role=status region (R3)', () => {
    const { container } = render(<TopBar {...base} variant="compact" showSuzuPanel={false} />);
    expect(container.querySelector('.sr-only')).toBeNull();
    const status = screen.getByRole('status');
    expect(status).toContainElement(screen.getByTestId('pill'));
    expect(screen.getAllByRole('status')).toHaveLength(1);
  });

  it('NarratorStrip is the SAME node across an Auto switch full <-> compact (a remount re-announces the scene; Kage A9c-1 S1)', () => {
    const { rerender } = render(<TopBar {...base} />);
    const before = screen.getByText('Cave Mouth');
    rerender(<TopBar {...base} variant="compact" />);
    expect(screen.getByText('Cave Mouth')).toBe(before);
    expect(before.closest('.sr-only')).not.toBeNull();
    rerender(<TopBar {...base} />);
    expect(screen.getByText('Cave Mouth')).toBe(before);
    expect(before.closest('.sr-only')).toBeNull();
  });

  it('settings slot (D3): rendered after the journal toggle in both variants, absent when not passed; the exit stays first', () => {
    for (const variant of ['full', 'compact'] as const) {
      const { unmount } = render(
        <TopBar {...base} variant={variant} settings={<button type="button">Gear</button>} />,
      );
      const exit = screen.getByRole('link', { name: 'Leave session' });
      const journal = screen.getByRole('button', { name: 'Open journal' });
      const gear = screen.getByRole('button', { name: 'Gear' });
      expect(exit.compareDocumentPosition(journal) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(journal.compareDocumentPosition(gear) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      unmount();
    }
    render(<TopBar {...base} />);
    expect(screen.queryByRole('button', { name: 'Gear' })).toBeNull();
  });

  it('full + ai-off keeps its single status region below the head (unchanged)', () => {
    render(<TopBar {...base} showSuzuPanel={false} />);
    expect(screen.getAllByRole('status')).toHaveLength(1);
  });
});

describe('A9c C4 — variantFor: the one typed read site', () => {
  it('returns the row\'s variant for every real row x moment x variant region, and it is a declared member', () => {
    for (const row of LAYOUT_ROWS) {
      for (const moment of ['exploring', 'combat'] as const) {
        for (const region of Object.keys(REGION_VARIANTS) as (keyof typeof REGION_VARIANTS)[]) {
          const v = variantFor(row, region, moment);
          if (v !== undefined) expect(REGION_VARIANTS[region] as readonly string[]).toContain(v);
        }
      }
    }
  });

  it('topBar: full on story, compact on phone and table', () => {
    expect(variantFor(LAYOUT_ROWS_BY_ID.story, 'topBar', 'exploring')).toBe('full');
    expect(variantFor(LAYOUT_ROWS_BY_ID.phone, 'topBar', 'combat')).toBe('compact');
    expect(variantFor(LAYOUT_ROWS_BY_ID.table, 'topBar', 'combat')).toBe('compact');
  });

  it('throws, naming row, region and moment, on a value outside the region\'s union (a typo never renders as the default)', () => {
    const bad: LayoutRow = {
      ...LAYOUT_ROWS_BY_ID.table,
      regions: {
        ...LAYOUT_ROWS_BY_ID.table.regions,
        topBar: { default: { area: 'sceneStage', anchor: 'top-start', variant: 'overlai' } },
      },
    };
    expect(() => variantFor(bad, 'topBar', 'combat')).toThrow(/"overlai".*"topBar".*"table".*combat/);
  });
});
