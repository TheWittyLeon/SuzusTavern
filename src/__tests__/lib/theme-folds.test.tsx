/** A9c C7 (build brief 5.3) -- ThemeProvider `folds`: R20's per-user fold preference. */
import { act, render } from '@testing-library/react';
import { FOLDS_KEY, FOLDS_OPEN_KEY, parseFolds, serializeFolds } from '@/lib/theme/theme';
import { ThemeProvider, useTheme } from '@/lib/theme/ThemeProvider';

describe('parseFolds / serializeFolds', () => {
  it('absent, junk and non-array values are "nothing folded"', () => {
    expect(parseFolds(null)).toEqual({});
    expect(parseFolds('not json')).toEqual({});
    expect(parseFolds('{"characterBlock":true}')).toEqual({});
    expect(parseFolds('"characterBlock"')).toEqual({});
  });

  it('keeps string ids (unknown ones inert) and drops non-strings', () => {
    expect(parseFolds('["characterBlock",7,null,"someFutureRegion"]')).toEqual({
      characterBlock: true,
      someFutureRegion: true,
    });
  });

  it('an empty set serializes to null (absent means open); a set round-trips sorted', () => {
    expect(serializeFolds({})).toBeNull();
    expect(serializeFolds(parseFolds('["sceneStage","characterBlock"]'))).toBe('["characterBlock","sceneStage"]');
  });
});

describe('ThemeProvider folds', () => {
  let latest: ReturnType<typeof useTheme>;
  const Probe = () => {
    latest = useTheme();
    return null;
  };
  const mount = () => render(<ThemeProvider><Probe /></ThemeProvider>);

  beforeEach(() => window.localStorage.removeItem(FOLDS_KEY));
  afterEach(() => window.localStorage.removeItem(FOLDS_KEY));

  it('defaults to nothing folded', () => {
    mount();
    expect(latest.folds).toEqual({});
  });

  it('seeds from storage on mount', () => {
    window.localStorage.setItem(FOLDS_KEY, '["characterBlock"]');
    mount();
    expect(latest.folds).toEqual({ characterBlock: true });
  });

  it('setFold persists, and setFold(r,false) deletes the key rather than writing a default', () => {
    mount();
    act(() => latest.setFold('characterBlock', true));
    expect(window.localStorage.getItem(FOLDS_KEY)).toBe('["characterBlock"]');
    expect(latest.folds).toEqual({ characterBlock: true });
    act(() => latest.setFold('characterBlock', false));
    expect(window.localStorage.getItem(FOLDS_KEY)).toBeNull();
    expect(latest.folds).toEqual({});
  });

  it('two folds set in one tick both land', () => {
    mount();
    act(() => {
      latest.setFold('characterBlock', true);
      latest.setFold('sceneStage', true);
    });
    expect(latest.folds).toEqual({ characterBlock: true, sceneStage: true });
    expect(window.localStorage.getItem(FOLDS_KEY)).toBe('["characterBlock","sceneStage"]');
  });

  it('survives storage that throws: the in-memory fold still works', () => {
    mount();
    const spy = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    act(() => latest.setFold('characterBlock', true));
    expect(latest.folds).toEqual({ characterBlock: true });
    spy.mockRestore();
  });
});

// B8c-4 P0 (brief 2.3): a fold has THREE stored states. `tavern.folds` stays the folded list; `tavern.foldsOpen` holds the ids the user explicitly opened.
describe('ThemeProvider: the third stored state (an explicit open)', () => {
  let latest: ReturnType<typeof useTheme>;
  const Probe = () => {
    latest = useTheme();
    return null;
  };
  const mount = () => render(<ThemeProvider><Probe /></ThemeProvider>);
  const clear = () => { window.localStorage.removeItem(FOLDS_KEY); window.localStorage.removeItem(FOLDS_OPEN_KEY); };
  beforeEach(clear);
  afterEach(clear);

  it('seeds both keys from storage on mount; absent is none', () => {
    mount();
    expect(latest.foldsOpen).toEqual({});
    clear();
    window.localStorage.setItem(FOLDS_OPEN_KEY, '["sceneStage"]');
    window.localStorage.setItem(FOLDS_KEY, '["characterBlock"]');
    mount();
    expect(latest.folds).toEqual({ characterBlock: true });
    expect(latest.foldsOpen).toEqual({ sceneStage: true });
  });

  it('setFoldChoice writes exactly one of folded / open / none per region, and a default is never written', () => {
    mount();
    act(() => latest.setFoldChoice('sceneStage', 'open'));
    expect(window.localStorage.getItem(FOLDS_OPEN_KEY)).toBe('["sceneStage"]');
    expect(window.localStorage.getItem(FOLDS_KEY)).toBeNull();
    act(() => latest.setFoldChoice('sceneStage', 'folded'));
    expect(window.localStorage.getItem(FOLDS_KEY)).toBe('["sceneStage"]');
    expect(window.localStorage.getItem(FOLDS_OPEN_KEY)).toBeNull();
    act(() => latest.setFoldChoice('sceneStage', 'none'));
    expect(window.localStorage.getItem(FOLDS_KEY)).toBeNull();
    expect(window.localStorage.getItem(FOLDS_OPEN_KEY)).toBeNull();
    expect(latest.folds).toEqual({});
    expect(latest.foldsOpen).toEqual({});
  });

  it('the legacy two-state write never writes an explicit open, and clears one (a region whose default is open)', () => {
    mount();
    act(() => latest.setFoldChoice('characterBlock', 'open'));
    act(() => latest.setFold('characterBlock', false));
    expect(window.localStorage.getItem(FOLDS_OPEN_KEY)).toBeNull();
    act(() => latest.setFold('characterBlock', true));
    expect(window.localStorage.getItem(FOLDS_KEY)).toBe('["characterBlock"]');
    expect(window.localStorage.getItem(FOLDS_OPEN_KEY)).toBeNull();
  });

  it('two regions set in one tick both land in their own keys', () => {
    mount();
    act(() => {
      latest.setFoldChoice('characterBlock', 'folded');
      latest.setFoldChoice('sceneStage', 'open');
    });
    expect(latest.folds).toEqual({ characterBlock: true });
    expect(latest.foldsOpen).toEqual({ sceneStage: true });
  });
});
