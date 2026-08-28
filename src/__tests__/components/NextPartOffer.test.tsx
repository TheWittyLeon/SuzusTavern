/**
 * T4p1 — NextPartOffer (design doc §6.4's completion next-pointer renderer).
 *
 * No live mount point exists this phase (play chrome, the only caller of
 * POST /sessions/{id}/advance, is out of scope) — this test exercises the
 * component directly against the exact wire shapes the design doc documents
 * so it's verified-correct and ready to mount when a trigger point lands.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import NextPartOffer from '../../components/NextPartOffer';
import type { SeriesCompletionPointer, SeriesNextAdventure } from '../../lib/api/types';

describe('NextPartOffer', () => {
  it('next_status=ok: renders the up-next offer with a real, working (not disabled) CTA', () => {
    const series: SeriesCompletionPointer = {
      ref: 'dnd5e:series:mlp-toto-campaign',
      title: 'Tales of the Oppressed',
      position: 1,
      total: 4,
      next_status: 'ok',
    };
    const next: SeriesNextAdventure = {
      ref: 'dnd5e:adventure:mlp-act2-canterlot',
      name: 'Act II — Canterlot Under Glass',
      label: 'Act II',
      act_handle: 'act2',
      level_range: { min: 4, max: 8 },
    };
    render(<NextPartOffer series={series} next={next} />);

    expect(screen.getByText(/tales of the oppressed/i)).toBeInTheDocument();
    expect(screen.getByText(/part 1 of 4 complete/i)).toBeInTheDocument();
    expect(screen.getByText(/up next: act ii/i)).toBeInTheDocument();
    expect(screen.getByText('Levels 4–8')).toBeInTheDocument();

    const cta = screen.getByRole('link', { name: /start act ii as a new table/i });
    expect(cta).not.toHaveAttribute('aria-disabled');
    expect(cta).toHaveAttribute(
      'href',
      `/modules?adventure=${encodeURIComponent('dnd5e:adventure:mlp-act2-canterlot')}`,
    );
    // Honest about the limitation — no invented seamless rebind.
    expect(screen.getByText(/doesn.t carry this table.s characters or progress forward/i)).toBeInTheDocument();
  });

  it('falls back to `name` when the next member has no author-supplied `label`', () => {
    const series: SeriesCompletionPointer = {
      ref: 'dnd5e:series:dbz-complete',
      title: 'Dragon Ball — Zenkai',
      position: 1,
      total: 13,
      next_status: 'ok',
    };
    const next: SeriesNextAdventure = {
      ref: 'dnd5e:adventure:db2-army-days',
      name: 'DB-2: Army Days',
    };
    render(<NextPartOffer series={series} next={next} />);
    expect(screen.getByText(/up next: db-2: army days/i)).toBeInTheDocument();
  });

  it('next_status=end_of_series: congratulatory message, no CTA', () => {
    const series: SeriesCompletionPointer = {
      ref: 'dnd5e:series:mlp-toto-campaign',
      title: 'Tales of the Oppressed',
      position: 4,
      total: 4,
      next_status: 'end_of_series',
    };
    render(<NextPartOffer series={series} next={null} />);
    expect(screen.getByText(/completed tales of the oppressed/i)).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('next_status=unresolved: a "hole, not an ending" note, no CTA, no fake end-of-series claim', () => {
    const series: SeriesCompletionPointer = {
      ref: 'dnd5e:series:mlp-toto-campaign',
      title: 'Tales of the Oppressed',
      position: 2,
      total: 4,
      next_status: 'unresolved',
    };
    render(<NextPartOffer series={series} next={null} />);
    expect(screen.getByText(/isn.t available right now/i)).toBeInTheDocument();
    expect(screen.queryByText(/completed tales of the oppressed/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('next_status=ok with next=null (a malformed payload) renders nothing rather than crashing', () => {
    const series: SeriesCompletionPointer = {
      ref: 'dnd5e:series:mlp-toto-campaign',
      title: 'Tales of the Oppressed',
      position: 1,
      total: 4,
      next_status: 'ok',
    };
    const { container } = render(<NextPartOffer series={series} next={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
