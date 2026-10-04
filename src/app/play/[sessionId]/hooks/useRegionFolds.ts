'use client';

/**
 * A9c C7 (build brief §5.3) — the shell's fold state, from ThemeProvider
 * (`folds`, persisted as `tavern.folds`: R20's "remembered per user"). Names
 * no region: `PlayShell` takes `foldedRegions`/`onToggleFold`, and a caller
 * that needs to reveal a particular region (picking a party member un-folds
 * the sheet) passes `unfold(id)` its own id.
 *
 * B8c-4 P0 (brief 2.3): a fold has three stored states (folded, open, none: `folds` and `foldsOpen`) and a fourth that is NEVER stored, the REVEAL: the page opens a fold
 * for this fight only (`reveal(id)`, Move on a folded map) and the reveal is cleared when the moment changes, i.e. when the fight ends. `shellProps` is what `PlayShell` takes.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTheme } from '@/lib/theme/ThemeProvider';
import type { Moment, RegionId } from '../presets';

export function useRegionFolds(moment: Moment) {
  const { folds, foldsOpen, setFold, setFoldChoice } = useTheme();
  const foldedRegions = useMemo(() => new Set(Object.keys(folds) as RegionId[]), [folds]);
  const openedRegions = useMemo(() => new Set(Object.keys(foldsOpen) as RegionId[]), [foldsOpen]);
  const [revealedRegions, setRevealed] = useState<ReadonlySet<RegionId>>(() => new Set());
  const onToggleFold = useCallback((id: RegionId) => setFold(id, !folds[id]), [folds, setFold]);
  const reveal = useCallback((id: RegionId) => setRevealed((prev) => (prev.has(id) ? prev : new Set(prev).add(id))), []);
  const unreveal = useCallback((id: RegionId) => setRevealed((prev) => { if (!prev.has(id)) return prev; const next = new Set(prev); next.delete(id); return next; }), []);
  // A press on the handle is the user's own choice and it outranks the page's reveal: the reveal outranks a stored fold (so Move can open a folded map), so a press that only wrote the
  // choice would be dead while the reveal stood (the map stays open under a press that says fold). The press hands the decision back to the stored choice.
  const onFoldChoice = useCallback((id: RegionId, choice: 'folded' | 'open' | 'none') => { setFoldChoice(id, choice); unreveal(id); }, [setFoldChoice, unreveal]);
  const unfold = useCallback((id: RegionId) => setFold(id, false), [setFold]);
  // Session state, beside the stored choice: a reveal lasts one fight.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- clearing session state when the moment changes is the reveal's whole lifecycle
    setRevealed((prev) => (prev.size === 0 ? prev : new Set()));
  }, [moment]);
  const shellProps = { foldedRegions, openedRegions, revealedRegions, onToggleFold, onFoldChoice };
  return { foldedRegions, onToggleFold, unfold, reveal, shellProps };
}
