import { MEMBER_SHEET_HEADING_ID } from '@/components/MemberSheetPanel';
import type { FoldSpec } from './PlayShell';
import type { RegionId } from './presets';

/** Fold-handle copy for every region that is collapsible in some row (A9c C7).
 *  The shell reads `collapsible`; this is labels only. The stage has no
 *  `labelledBy`: it is already the "Scene" aside. It folds only its `body`. */
export const FOLD_SPECS: Partial<Record<RegionId, FoldSpec>> = {
  characterBlock: { label: 'Character sheet', icon: 'Scroll', labelledBy: MEMBER_SHEET_HEADING_ID },
  // (A9d-2 N5: the stage's entry is gone with its fold: no row sets `collapsible` on it. It returns with the phone map at step 12 as
  // `sceneStage: { label: 'Scene stage', icon: 'Map', body: SCENE_STAGE_BODY_ID }`; the label is "Scene stage", not "Scene", because the
  // stage IS the "Scene" aside and a button named like its landmark is announced twice, Iro A9c-1 MINOR-4.)
};
