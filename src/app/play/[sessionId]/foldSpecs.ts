import { MEMBER_SHEET_HEADING_ID } from '@/components/MemberSheetPanel';
import type { FoldSpec } from './PlayShell';
import type { RegionId } from './presets';

/** Fold-handle copy for every region that is collapsible in some row (A9c C7).
 *  The shell reads `collapsible`; this is labels only. The stage has no
 *  `labelledBy`: it is already the "Scene" aside. */
export const FOLD_SPECS: Partial<Record<RegionId, FoldSpec>> = {
  characterBlock: { label: 'Character sheet', icon: 'Scroll', labelledBy: MEMBER_SHEET_HEADING_ID },
  sceneStage: { label: 'Scene', icon: 'Map' },
};
