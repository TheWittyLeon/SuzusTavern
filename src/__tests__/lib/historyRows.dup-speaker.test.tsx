/**
 * TAV-HISTORYROWS-DUP-SPEAKER-KEY: an NPC with two opening lines in one scene used to get two rows
 * with the same id (`ev<seq>-line-<npc_ref>`), and ChatLog keys on the id.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

import ChatLog from '@/components/ChatLog';
import { buildHistoryRows } from '@/app/play/[sessionId]/historyRows';
import type { EngineSessionEvent, GroundingData } from '@/lib/api/types';

const g = {
  scene_id: 'tavern',
  scene_name: 'The Tavern',
  boxed_text: 'Smoke.',
  adventure_title: 'T',
  opening_lines: [
    { npc_ref: 'barkeep', speaker_display_name: 'Barkeep', line: 'Welcome in.' },
    { npc_ref: 'barkeep', speaker_display_name: 'Barkeep', line: 'Mind the cat.' },
    { npc_ref: 'bard', speaker_display_name: 'Bard', line: 'A song?' },
  ],
} as unknown as GroundingData;
const opening: EngineSessionEvent = { seq: 7, kind: 'opening_narrated', data: { scene_id: 'tavern' } };

describe('buildHistoryRows opening lines', () => {
  it('gives every line of a two-line speaker its own id', () => {
    const ids = buildHistoryRows([opening], g).map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain('ev7-line-0');
    expect(ids).toContain('ev7-line-1');
  });

  it('is stable across rebuilds (mount and heal must agree on ids)', () => {
    const a = buildHistoryRows([opening], g).map((r) => r.id);
    expect(buildHistoryRows([opening], g).map((r) => r.id)).toEqual(a);
  });

  it('renders both lines with no duplicate-key warning', () => {
    const err = jest.spyOn(console, 'error').mockImplementation(() => {});
    render(<ChatLog rows={buildHistoryRows([opening], g)} participants={[]} />);
    expect(screen.getByText('Welcome in.')).toBeInTheDocument();
    expect(screen.getByText('Mind the cat.')).toBeInTheDocument();
    const dup = err.mock.calls.filter((c) => String(c[0]).includes('same key'));
    err.mockRestore();
    expect(dup).toEqual([]);
  });
});
