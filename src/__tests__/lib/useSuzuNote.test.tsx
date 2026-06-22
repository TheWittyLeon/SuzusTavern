import { renderHook, waitFor, act } from '@testing-library/react';

jest.mock('../../lib/stream', () => ({
  streamNarration: jest.fn(),
}));

import { streamNarration } from '../../lib/stream';
import { useSuzuNote, placeholderNote } from '../../lib/dnd/useSuzuNote';
import type { CharacterSheet } from '../../lib/api/types';

const mStream = streamNarration as jest.MockedFunction<typeof streamNarration>;

function makeSheet(extra: Partial<CharacterSheet> = {}): CharacterSheet {
  return {
    character_id: 'c1',
    owner_username: 'leon',
    name: 'Velka Quickfingers',
    race: 'Halfling',
    subrace: '',
    char_class: 'Rogue',
    subclass: '',
    level: 2,
    background: 'Charlatan',
    alignment: '',
    ability_scores: {},
    hp: { current: 12, max: 20, temp: 0 },
    ac: 14,
    initiative: 3,
    proficiency_bonus: 2,
    speed: 25,
    xp: 0,
    xp_next: 300,
    hit_dice_remaining: 2,
    proficient_saves: [],
    proficient_skills: [],
    class_features: [],
    conditions: [],
    spellcasting: null,
    spell_slots: {},
    is_spellcaster: false,
    inventory: [],
    inventory_weight: 0,
    ...extra,
  };
}

// A stable sheet reference per test — the hook's effect keys on sheet identity,
// so a fresh object each render (as in the real app it isn't) would re-run it.
let sheet: CharacterSheet;
beforeEach(() => {
  window.localStorage.clear();
  mStream.mockReset();
  sheet = makeSheet();
});

describe('useSuzuNote', () => {
  it('placeholderNote is deterministic from the sheet', () => {
    expect(placeholderNote(makeSheet())).toMatch(/halfling rogue with a charlatan past/i);
  });

  it('shows the deterministic placeholder and makes NO narration call when ai is off', async () => {
    const { result } = renderHook(() => useSuzuNote(sheet, 'off'));
    expect(result.current.note).toMatch(/halfling rogue/i);
    expect(result.current.source).toBe('placeholder');
    await act(async () => {});
    expect(mStream).not.toHaveBeenCalled();
  });

  it('makes NO narration call when aiAssistLevel is undefined', async () => {
    renderHook(() => useSuzuNote(makeSheet()));
    await act(async () => {});
    expect(mStream).not.toHaveBeenCalled();
  });

  it('is null-safe before the sheet loads', () => {
    const { result } = renderHook(() => useSuzuNote(null, 'full'));
    expect(result.current.note).toBe('');
    expect(mStream).not.toHaveBeenCalled();
  });

  it('generates once via narration when assist is on, then persists it', async () => {
    mStream.mockImplementation(async function* () {
      yield { kind: 'chunk' as const, text: 'This one steals hearts and coin purses alike.' };
    });
    const { result } = renderHook(() => useSuzuNote(sheet, 'full'));
    await waitFor(() => expect(result.current.source).toBe('ai'));
    expect(result.current.note).toMatch(/steals hearts/i);
    expect(mStream).toHaveBeenCalledTimes(1);
    // persisted for next time
    expect(window.localStorage.getItem('suzu.note.c1')).toMatch(/steals hearts/i);
  });

  it('reads a persisted note verbatim without regenerating (no LLM call)', async () => {
    window.localStorage.setItem('suzu.note.c1', 'A persisted observation.');
    const { result } = renderHook(() => useSuzuNote(sheet, 'full'));
    await waitFor(() => expect(result.current.source).toBe('persisted'));
    expect(result.current.note).toBe('A persisted observation.');
    expect(mStream).not.toHaveBeenCalled();
  });

  it('falls back to the placeholder if generation yields nothing', async () => {
    mStream.mockImplementation(async function* () {
      yield { kind: 'error' as const, error: 'network' };
    });
    const { result } = renderHook(() => useSuzuNote(sheet, 'assist'));
    await act(async () => {});
    expect(result.current.note).toMatch(/halfling rogue/i);
    expect(result.current.source).toBe('placeholder');
  });
});
