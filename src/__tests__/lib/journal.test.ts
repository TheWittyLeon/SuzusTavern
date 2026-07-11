import { deriveNpcsMet, deriveQuestTrail, deriveRecapHistory } from '@/lib/dnd/journal';
import type { EngineSessionEvent, SceneNpc } from '@/lib/api/types';

describe('deriveQuestTrail', () => {
  it('extracts scene_advance descriptions in seq order', () => {
    const events: EngineSessionEvent[] = [
      { seq: 3, kind: 'scene_advance', data: { description: 'The party enters the cave.' } },
      { seq: 1, kind: 'narration', data: { text: 'ignored kind' } },
      { seq: 2, kind: 'scene_advance', data: { description: 'The tide begins to rise.' } },
    ];
    const trail = deriveQuestTrail(events);
    expect(trail.map((t) => t.text)).toEqual([
      'The tide begins to rise.',
      'The party enters the cave.',
    ]);
  });

  it('sorts defensively even when input arrives out of seq order', () => {
    const events: EngineSessionEvent[] = [
      { seq: 5, kind: 'scene_advance', data: { description: 'second' } },
      { seq: 2, kind: 'scene_advance', data: { description: 'first' } },
    ];
    expect(deriveQuestTrail(events).map((t) => t.text)).toEqual(['first', 'second']);
  });

  it('skips scene_advance events with no description', () => {
    const events: EngineSessionEvent[] = [
      { seq: 1, kind: 'scene_advance', data: {} },
      { seq: 2, kind: 'scene_advance', data: { description: '   ' } },
      { seq: 3, kind: 'scene_advance' },
    ];
    expect(deriveQuestTrail(events)).toEqual([]);
  });

  it('decodes HTML entities (TAV-7 symmetric decode)', () => {
    const events: EngineSessionEvent[] = [
      { seq: 1, kind: 'scene_advance', data: { description: 'The door said &quot;beware&quot;.' } },
    ];
    expect(deriveQuestTrail(events)[0].text).toBe('The door said "beware".');
  });

  it('returns [] for an empty event list', () => {
    expect(deriveQuestTrail([])).toEqual([]);
  });
});

describe('deriveRecapHistory', () => {
  it('extracts recap-kind events with who + text, oldest first', () => {
    const events: EngineSessionEvent[] = [
      { seq: 4, kind: 'recap', data: { text: 'Second recap.', who: 'Suzu' } },
      { seq: 2, kind: 'narration', data: { text: 'not a recap' } },
      { seq: 1, kind: 'recap', data: { text: 'First recap.', who: 'Suzu' } },
    ];
    const history = deriveRecapHistory(events);
    expect(history.map((r) => r.text)).toEqual(['First recap.', 'Second recap.']);
    expect(history.every((r) => r.who === 'Suzu')).toBe(true);
  });

  it('defaults who to "Suzu" when the field is absent', () => {
    const events: EngineSessionEvent[] = [{ seq: 1, kind: 'recap', data: { text: 'A recap.' } }];
    expect(deriveRecapHistory(events)[0].who).toBe('Suzu');
  });

  it('skips recap events with no text', () => {
    const events: EngineSessionEvent[] = [
      { seq: 1, kind: 'recap', data: { who: 'Suzu' } },
      { seq: 2, kind: 'recap', data: { text: '' } },
    ];
    expect(deriveRecapHistory(events)).toEqual([]);
  });

  it('decodes HTML entities in both who and text', () => {
    const events: EngineSessionEvent[] = [
      { seq: 1, kind: 'recap', data: { text: 'Give a &quot;previously on&quot;.', who: 'Suzu&#x27;s recap' } },
    ];
    const [entry] = deriveRecapHistory(events);
    expect(entry.text).toBe('Give a "previously on".');
    expect(entry.who).toBe("Suzu's recap");
  });
});

describe('deriveNpcsMet', () => {
  it('unions npcs_introduced across events in first-seen order', () => {
    const events: EngineSessionEvent[] = [
      { seq: 1, kind: 'narration', data: { npcs_introduced: ['Mira'] } },
      { seq: 2, kind: 'narration', data: { npcs_introduced: ['Zecora', 'Mira'] } },
    ];
    expect(deriveNpcsMet(events)).toEqual(['Mira', 'Zecora']);
  });

  it('scans non-narration kinds too (the stamp is not kind-gated server-side)', () => {
    const events: EngineSessionEvent[] = [
      { seq: 1, kind: 'recap', data: { npcs_introduced: ['Mira'] } },
    ];
    expect(deriveNpcsMet(events)).toEqual(['Mira']);
  });

  it('merges grounding scene NPCs after the event-sourced list, deduping case-insensitively', () => {
    const events: EngineSessionEvent[] = [
      { seq: 1, kind: 'narration', data: { npcs_introduced: ['Mira'] } },
    ];
    const sceneNpcs: SceneNpc[] = [{ name: 'mira' }, { name: 'Rainbow Dash' }];
    expect(deriveNpcsMet(events, sceneNpcs)).toEqual(['Mira', 'Rainbow Dash']);
  });

  it('falls back to grounding NPCs alone for a solo/human-DM session with no stamped events', () => {
    const sceneNpcs: SceneNpc[] = [{ name: 'Applejack' }];
    expect(deriveNpcsMet([], sceneNpcs)).toEqual(['Applejack']);
  });

  it('returns [] when there is nothing to show (empty state)', () => {
    expect(deriveNpcsMet([], null)).toEqual([]);
    expect(deriveNpcsMet([])).toEqual([]);
  });

  it('ignores malformed npcs_introduced entries without crashing', () => {
    const events: EngineSessionEvent[] = [
      { seq: 1, kind: 'narration', data: { npcs_introduced: 'not-an-array' } },
      { seq: 2, kind: 'narration', data: { npcs_introduced: [42, null, 'Mira'] } },
    ];
    expect(deriveNpcsMet(events)).toEqual(['Mira']);
  });

  it('decodes HTML entities in NPC names', () => {
    const events: EngineSessionEvent[] = [
      { seq: 1, kind: 'narration', data: { npcs_introduced: ['Mira&#x27;s Shadow'] } },
    ];
    expect(deriveNpcsMet(events)).toEqual(["Mira's Shadow"]);
  });
});
