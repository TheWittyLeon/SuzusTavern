/**
 * B8c-4 P0 (brief 2.3) — the REVEAL: the page opens a fold for this fight only. Session state beside the stored choice: it is cleared when the moment changes (the fight ends) and it NEVER
 * touches storage. The mutation that matters: a reveal written to storage turns the second case red.
 */
import { useEffect } from 'react';
import { act, render } from '@testing-library/react';
import { ThemeProvider } from '@/lib/theme/ThemeProvider';
import { FOLDS_KEY, FOLDS_OPEN_KEY } from '@/lib/theme/theme';
import { useRegionFolds } from '@/app/play/[sessionId]/hooks/useRegionFolds';
import type { Moment } from '@/app/play/[sessionId]/presets';

// The hook's latest value, handed out through a holder (a render may not reassign a module variable).
const holder: { current: ReturnType<typeof useRegionFolds> | null } = { current: null };
const Probe = ({ moment }: { moment: Moment }) => {
  const folds = useRegionFolds(moment);
  useEffect(() => { holder.current = folds; });
  return null;
};
const get = () => holder.current!;
const mount = (moment: Moment) => {
  const ui = (m: Moment) => <ThemeProvider><Probe moment={m} /></ThemeProvider>;
  const view = render(ui(moment));
  return { to: (m: Moment) => view.rerender(ui(m)) };
};
beforeEach(() => { window.localStorage.removeItem(FOLDS_KEY); window.localStorage.removeItem(FOLDS_OPEN_KEY); });

describe('useRegionFolds: reveal', () => {
  it('a reveal is in the shell props, and is cleared when the moment changes (the fight ended)', () => {
    const m = mount('combat');
    expect(get().shellProps.revealedRegions.size).toBe(0);
    act(() => get().reveal('sceneStage'));
    expect([...get().shellProps.revealedRegions]).toEqual(['sceneStage']);
    m.to('exploring');
    expect(get().shellProps.revealedRegions.size).toBe(0);
  });

  it('a reveal writes NOTHING to storage and does not change the stored choice', () => {
    window.localStorage.setItem(FOLDS_KEY, '["sceneStage"]');
    mount('combat');
    act(() => get().reveal('sceneStage'));
    expect(window.localStorage.getItem(FOLDS_KEY)).toBe('["sceneStage"]');
    expect(window.localStorage.getItem(FOLDS_OPEN_KEY)).toBeNull();
    expect([...get().shellProps.foldedRegions]).toEqual(['sceneStage']);
  });

  it('only a handle press writes: onFoldChoice stores folded or open; the legacy toggle stores folded or nothing', () => {
    mount('combat');
    act(() => get().shellProps.onFoldChoice('sceneStage', 'open'));
    expect(window.localStorage.getItem(FOLDS_OPEN_KEY)).toBe('["sceneStage"]');
    act(() => get().shellProps.onFoldChoice('sceneStage', 'folded'));
    expect(window.localStorage.getItem(FOLDS_KEY)).toBe('["sceneStage"]');
    expect(window.localStorage.getItem(FOLDS_OPEN_KEY)).toBeNull();
    act(() => get().shellProps.onToggleFold('sceneStage'));
    expect(window.localStorage.getItem(FOLDS_KEY)).toBeNull();
  });
});
