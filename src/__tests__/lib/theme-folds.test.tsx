/** A9c C7 (build brief 5.3) -- ThemeProvider `folds`: R20's per-user fold preference. */
import { act, render } from '@testing-library/react';
import { FOLDS_KEY, parseFolds, serializeFolds } from '@/lib/theme/theme';
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
