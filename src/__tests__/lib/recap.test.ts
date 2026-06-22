import { buildRecap } from '@/lib/dnd/recap';
import type { Session, SessionEvent } from '@/lib/api/types';

const base: Session = {
  session_id: 's1',
  channel: 'the_hollow_tide',
  status: 'paused',
  dm_username: 'suzu',
  player_count: 3,
  started_at: '2026-06-14T20:00:00Z',
};

describe('buildRecap (deterministic, zero LLM)', () => {
  it('digests the most notable recent events when available', () => {
    const events: SessionEvent[] = [
      { event_type: 'join', description: 'Velka joined the table.' },
      { event_type: 'combat', description: 'The party fought two goblins in the cave.' },
      { event_type: 'level_up', description: 'Velka reached level 2.' },
    ];
    const r = buildRecap(base, events);
    expect(r.empty).toBe(false);
    expect(r.headline).toBe('Previously on…');
    // notable events (combat, level_up) preferred over the join
    expect(r.lines).toContain('The party fought two goblins in the cave.');
    expect(r.lines).toContain('Velka reached level 2.');
    expect(r.facts).toContain('goblins');
  });

  it('caps the number of digest lines', () => {
    const events: SessionEvent[] = Array.from({ length: 10 }, (_, i) => ({
      event_type: 'combat',
      description: `beat ${i}`,
    }));
    const r = buildRecap(base, events, { maxLines: 3 });
    expect(r.lines).toHaveLength(3);
    expect(r.lines).toEqual(['beat 7', 'beat 8', 'beat 9']);
  });

  it('falls back to a metadata digest when no events are available', () => {
    const r = buildRecap(base, []);
    expect(r.empty).toBe(false);
    expect(r.headline).toBe('Where you left off');
    expect(r.lines.join(' ')).toMatch(/DM’d by Suzu/);
    expect(r.lines.join(' ')).toMatch(/3 players/);
    expect(r.lines.join(' ')).toMatch(/paused/i);
  });

  it('renders the friendly first-session empty state when there is nothing to say', () => {
    const bare: Session = { session_id: 's2', channel: 'new_table' };
    const r = buildRecap(bare, []);
    expect(r.empty).toBe(true);
    expect(r.headline).toMatch(/starts here/i);
    expect(r.lines).toHaveLength(0);
    expect(r.facts).toBe('');
  });
});
