'use client';

/**
 * A9c C7 (build brief §5.3) — the shell's fold state, from ThemeProvider
 * (`folds`, persisted as `tavern.folds`: R20's "remembered per user"). Names
 * no region: `PlayShell` takes `foldedRegions`/`onToggleFold`, and a caller
 * that needs to reveal a particular region (picking a party member un-folds
 * the sheet) passes `unfold(id)` its own id.
 */
import { useCallback, useMemo } from 'react';
import { useTheme } from '@/lib/theme/ThemeProvider';
import type { RegionId } from '../presets';

export function useRegionFolds() {
  const { folds, setFold } = useTheme();
  const foldedRegions = useMemo(() => new Set(Object.keys(folds) as RegionId[]), [folds]);
  const onToggleFold = useCallback((id: RegionId) => setFold(id, !folds[id]), [folds, setFold]);
  const unfold = useCallback((id: RegionId) => setFold(id, false), [setFold]);
  return { foldedRegions, onToggleFold, unfold };
}
