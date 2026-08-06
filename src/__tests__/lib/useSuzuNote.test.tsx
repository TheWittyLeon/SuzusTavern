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

  // TAV-SUZU-NOTE-ARTICLE-AGREEMENT (2026-08-06): the fixture above is
  // consonant-led on BOTH race ("halfling") and background ("charlatan"), so
  // it would have passed identically against the pre-fix hardcoded "A ... a
  // ..." template — it never exercised the bug. These cases specifically
  // target vowel-initial words, including the LEADING article (the reported
  // bug was the second one only — "a acolyte" — but the first hardcoded "A"
  // had the exact same defect, just masked by "human"/"halfling" in every
  // example anyone happened to try).
  it('uses "An" (capitalised) for a vowel-initial LEADING race, and "a" for a consonant-initial trailing background', () => {
    const note = placeholderNote(makeSheet({ race: 'Elf', background: 'Charlatan' }));
    expect(note.startsWith('An elf')).toBe(true);
    expect(note).toContain('with a charlatan past');
    expect(note).not.toContain('A elf');
  });

  it('uses "an" (lowercase, mid-sentence) for a vowel-initial trailing background', () => {
    const note = placeholderNote(makeSheet({ race: 'Human', background: 'Acolyte' }));
    expect(note.startsWith('A human')).toBe(true);
    expect(note).toContain('with an acolyte past');
    expect(note).not.toContain('with a acolyte');
  });

  it('gets both articles right when BOTH race and background are vowel-initial', () => {
    const note = placeholderNote(makeSheet({ race: 'Elf', background: 'Acolyte' }));
    expect(note.startsWith('An elf')).toBe(true);
    expect(note).toContain('with an acolyte past');
  });

  it('falls back to the default race/class/background copy when the sheet omits them, and still agrees', () => {
    // race defaults to 'wanderer' (consonant) -- pin the default's article too,
    // so a future change to the default word doesn't silently reintroduce "A
    // acolyte"-style breakage without a test noticing.
    const note = placeholderNote(makeSheet({ race: '', background: '' }));
    expect(note.startsWith('A wanderer')).toBe(true);
    expect(note).toContain('with a mysterious past');
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
