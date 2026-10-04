/**
 * B8c-4 P0 (brief 2.3) — the fold value as ONE pure function, pinned as a table, and its two small companions. No DOM.
 */
import { FOLD_FACT_VALUES, foldValue, isEditable, scrollStep, whenMatches, type FoldChoice, type FoldInputs } from '@/app/play/[sessionId]/foldState';

const base: FoldInputs = { banner: false, revealed: false, stored: 'none', fits: true, decided: undefined };
const v = (o: Partial<FoldInputs>) => foldValue({ ...base, ...o });

describe('foldValue: the precedence table (brief 2.3, with the reveal above a stored fold)', () => {
  it.each<[string, Partial<FoldInputs>, string]>([
    ['nothing stored, nothing decided, a measured default -> auto', {}, 'auto'],
    ['a decision made this fight -> the decision (open)', { decided: 'open' }, 'open'],
    ['a decision made this fight -> the decision (folded)', { decided: 'folded' }, 'folded'],
    ['a default that is not measured -> open, whatever was decided', { fits: false, decided: 'folded' }, 'open'],
    ['stored folded outranks the measured default', { stored: 'folded', decided: 'open' }, 'folded'],
    ['stored open outranks a decision to fold', { stored: 'open', decided: 'folded' }, 'open'],
    ['stored open on a fold that is not measured -> open', { stored: 'open', fits: false }, 'open'],
    ['a reveal opens a map the user folded (Move on a folded map)', { stored: 'folded', revealed: true }, 'open'],
    ['a reveal over a decision to fold -> open', { revealed: true, decided: 'folded' }, 'open'],
    ['a banner folds it, over a stored open', { banner: true, stored: 'open' }, 'folded'],
    ['a banner folds it, over a reveal (the X-card is never covered)', { banner: true, revealed: true }, 'folded'],
    ['a banner folds it, over a decision to open', { banner: true, decided: 'open' }, 'folded'],
  ])('%s', (_name, over, want) => {
    expect(v(over)).toBe(want);
    expect(FOLD_FACT_VALUES).toContain(want);
  });

  it('every input combination returns one of the three values (the table is total)', () => {
    const stored: FoldChoice[] = ['folded', 'open', 'none'];
    for (const banner of [true, false]) for (const revealed of [true, false]) for (const s of stored) for (const fits of [true, false]) for (const decided of [undefined, 'open', 'folded'] as const) {
      expect(FOLD_FACT_VALUES).toContain(foldValue({ banner, revealed, stored: s, fits, decided }));
    }
  });
});

describe('whenMatches: every named fact must hold', () => {
  it('absent = always; one miss = no', () => {
    expect(whenMatches(undefined, { room: 'band' })).toBe(true);
    expect(whenMatches({ room: 'board' }, { room: 'board' })).toBe(true);
    expect(whenMatches({ room: 'board' }, { room: 'band' })).toBe(false);
    expect(whenMatches({ room: 'board' }, undefined)).toBe(false);
    expect(whenMatches({ room: 'board', other: 'x' }, { room: 'board' })).toBe(false);
  });
});

describe('scrollStep: opening scrolls by what the body added, never past the handle; folding goes back by what it removed', () => {
  const at = (o: Partial<Parameters<typeof scrollStep>[0]>) => scrollStep({ dir: 'open', added: 90, handleTop: 300, handleBottom: 344, viewport: 664, ...o });
  it('open: the whole addition when the handle can afford it', () => expect(at({})).toBe(90));
  it('open: clamped to the handle\'s distance from the top edge', () => expect(at({ added: 210, handleTop: 40, handleBottom: 84 })).toBe(40));
  it('open: a handle not wholly in view cannot be kept in view: 0', () => {
    expect(at({ handleTop: -4, handleBottom: 40 })).toBe(0);
    expect(at({ handleTop: 640, handleBottom: 684 })).toBe(0);
  });
  it('fold: back by what was removed; nothing added or removed: 0', () => {
    expect(at({ dir: 'fold' })).toBe(-90);
    expect(at({ added: 0 })).toBe(0);
  });
});

describe('isEditable: where a soft keyboard may be up', () => {
  const el = (html: string) => { const d = document.createElement('div'); d.innerHTML = html; return d.firstElementChild as HTMLElement; };
  it('text fields, textareas and selects are; buttons and checkboxes are not', () => {
    expect(isEditable(el('<textarea></textarea>'))).toBe(true);
    expect(isEditable(el('<input type="text">'))).toBe(true);
    expect(isEditable(el('<select></select>'))).toBe(true);
    expect(isEditable(el('<input type="checkbox">'))).toBe(false);
    expect(isEditable(el('<button></button>'))).toBe(false);
    expect(isEditable(null)).toBe(false);
  });
});
