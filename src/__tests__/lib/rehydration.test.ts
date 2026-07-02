/**
 * PLAY-PERSIST §6.3 — eventToLogRow mapping tests.
 *
 * Pure-function coverage: one test per kind in the mapping table, plus the
 * adversarial cases called out in the design doc's Miko checklist (§8):
 * empty/missing text is skipped (no blank row), narration missing `data.who`
 * falls back to 'Suzu', unknown/structural kinds are skipped, and opening_narrated
 * is never rendered as a plain row (the caller reconstructs it specially).
 */
import { eventToLogRow } from '../../lib/rehydration';
import type { EngineSessionEvent } from '../../lib/api/types';

describe('eventToLogRow — kind mapping', () => {
  it('player_action -> player row (who/text/color from data)', () => {
    const e: EngineSessionEvent = {
      seq: 1,
      kind: 'player_action',
      actor: 'leon',
      data: { who: 'leon', text: 'I push open the door.', log_kind: 'player', mode: 'act' },
      created_at: '2026-07-01T10:00:00Z',
    };
    const row = eventToLogRow(e);
    expect(row).toMatchObject({
      who: 'leon',
      kind: 'player',
      text: 'I push open the door.',
      color: 'var(--accent)',
    });
    expect(row?.id).toBe('ev1');
  });

  it('player_action falls back to actor when data.who is absent', () => {
    const e: EngineSessionEvent = {
      seq: 2,
      kind: 'player_action',
      actor: 'leon',
      data: { text: 'I look around.' },
    };
    const row = eventToLogRow(e);
    expect(row?.who).toBe('leon');
  });

  it('player_action with empty data.text is skipped (no blank row)', () => {
    const e: EngineSessionEvent = {
      seq: 3,
      kind: 'player_action',
      data: { who: 'leon', text: '' },
    };
    expect(eventToLogRow(e)).toBeNull();
  });

  it('player_action with missing data.text is skipped', () => {
    const e: EngineSessionEvent = { seq: 4, kind: 'player_action', data: { who: 'leon' } };
    expect(eventToLogRow(e)).toBeNull();
  });

  it('narration -> narration row, who defaults to Suzu', () => {
    const e: EngineSessionEvent = {
      seq: 5,
      kind: 'narration',
      data: { text: 'The door creaks open.', log_kind: 'narration' },
    };
    const row = eventToLogRow(e);
    expect(row).toMatchObject({ who: 'Suzu', kind: 'narration', text: 'The door creaks open.' });
  });

  it('narration missing data.who falls back to Suzu (adversarial case)', () => {
    const e: EngineSessionEvent = { seq: 6, kind: 'narration', data: { text: 'Prose.' } };
    expect(eventToLogRow(e)?.who).toBe('Suzu');
  });

  it('narration with missing text is skipped', () => {
    const e: EngineSessionEvent = { seq: 7, kind: 'narration', data: {} };
    expect(eventToLogRow(e)).toBeNull();
  });

  it('dm_narration -> dm_narration row, who from data.who then actor then DM', () => {
    const e: EngineSessionEvent = {
      seq: 8,
      kind: 'dm_narration',
      actor: 'suzu_dm',
      data: { text: 'The torches flicker.' },
    };
    const row = eventToLogRow(e);
    expect(row).toMatchObject({ who: 'suzu_dm', kind: 'dm_narration', text: 'The torches flicker.' });
  });

  it('dm_narration falls back to literal "DM" when neither data.who nor actor is present', () => {
    const e: EngineSessionEvent = { seq: 9, kind: 'dm_narration', data: { text: 'A ruling.' } };
    expect(eventToLogRow(e)?.who).toBe('DM');
  });

  it('dm_narration with missing text is skipped', () => {
    const e: EngineSessionEvent = { seq: 10, kind: 'dm_narration', data: {} };
    expect(eventToLogRow(e)).toBeNull();
  });

  it('scene_advance -> system row from data.description', () => {
    const e: EngineSessionEvent = {
      seq: 11,
      kind: 'scene_advance',
      data: { description: 'The scene shifts: approach -> cave-mouth' },
    };
    const row = eventToLogRow(e);
    expect(row).toMatchObject({
      who: 'Suzu',
      kind: 'system',
      text: 'The scene shifts: approach -> cave-mouth',
    });
  });

  it('encounter_resolved -> system row from data.description', () => {
    const e: EngineSessionEvent = {
      seq: 12,
      kind: 'encounter_resolved',
      data: { description: 'Combat ended. Victory.' },
    };
    const row = eventToLogRow(e);
    expect(row).toMatchObject({ who: 'Suzu', kind: 'system', text: 'Combat ended. Victory.' });
  });

  it('scene_advance/encounter_resolved without data.description is skipped', () => {
    expect(eventToLogRow({ seq: 13, kind: 'scene_advance', data: {} })).toBeNull();
    expect(eventToLogRow({ seq: 14, kind: 'encounter_resolved', data: null })).toBeNull();
  });

  // P1-PLAYFIX §3.5 / C13 — check_resolved rehydration render branch.
  it('check_resolved -> system row from data.description (P1-PLAYFIX §3.5 / C13)', () => {
    const e: EngineSessionEvent = {
      seq: 22,
      kind: 'check_resolved',
      data: { description: 'Survival check (DC 12): 15 — success.' },
    };
    const row = eventToLogRow(e);
    expect(row).toMatchObject({
      who: 'Suzu',
      kind: 'system',
      text: 'Survival check (DC 12): 15 — success.',
    });
  });

  it('check_resolved without data.description is skipped', () => {
    expect(eventToLogRow({ seq: 23, kind: 'check_resolved', data: {} })).toBeNull();
  });

  it('opening_narrated is never a plain row (caller reconstructs it specially)', () => {
    const e: EngineSessionEvent = {
      seq: 15,
      kind: 'opening_narrated',
      data: { scene_id: 'approach', source: 'read_aloud_verbatim' },
    };
    expect(eventToLogRow(e)).toBeNull();
  });

  it('structural/unknown kinds are skipped (rebind, session_start, session_created, hack)', () => {
    expect(eventToLogRow({ seq: 16, kind: 'rebind', data: {} })).toBeNull();
    expect(eventToLogRow({ seq: 17, kind: 'session_start', data: {} })).toBeNull();
    expect(eventToLogRow({ seq: 18, kind: 'session_created', data: {} })).toBeNull();
    expect(eventToLogRow({ seq: 19, kind: 'hack', data: { text: 'ignored' } })).toBeNull();
  });

  it('handles null data without throwing', () => {
    expect(eventToLogRow({ seq: 20, kind: 'player_action', data: null })).toBeNull();
    expect(eventToLogRow({ seq: 21, kind: 'narration', data: null })).toBeNull();
  });

  it('derives a stable id from seq so rehydrated rows never collide with live r${n} ids', () => {
    const row = eventToLogRow({
      seq: 42,
      kind: 'narration',
      data: { text: 'Prose.' },
    });
    expect(row?.id).toBe('ev42');
    expect(row?.id.startsWith('r')).toBe(false);
  });

  it('formats created_at into a time string when present, empty string when absent/invalid', () => {
    const withTs = eventToLogRow({
      seq: 43,
      kind: 'narration',
      data: { text: 'x' },
      created_at: '2026-07-01T10:00:00Z',
    });
    expect(withTs?.ts).not.toBe('');

    const withoutTs = eventToLogRow({ seq: 44, kind: 'narration', data: { text: 'x' } });
    expect(withoutTs?.ts).toBe('');

    const invalidTs = eventToLogRow({
      seq: 45,
      kind: 'narration',
      data: { text: 'x' },
      created_at: 'not-a-date',
    });
    expect(invalidTs?.ts).toBe('');
  });
});
