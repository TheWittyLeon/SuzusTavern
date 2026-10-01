import { MEMBER_SHEET_HEADING_ID } from '@/components/MemberSheetPanel';
import { SCENE_STAGE_BODY_ID } from './regions/SceneStage';
import type { FoldSpec } from './PlayShell';
import type { RegionId } from './presets';

/** Fold-handle copy for every region that is collapsible in some row (A9c C7).
 *  The shell reads `collapsible`; this is labels only. The stage has no
 *  `labelledBy`: it is already the "Scene" aside. It folds only its `body`. */
export const FOLD_SPECS: Partial<Record<RegionId, FoldSpec>> = {
  characterBlock: { label: 'Character sheet', icon: 'Scroll', labelledBy: MEMBER_SHEET_HEADING_ID },
  // "Scene stage", not "Scene": the stage IS the "Scene" aside, and a button named like
  // the landmark it controls is announced as the same thing twice (Iro A9c-1 MINOR-4).
  sceneStage: { label: 'Scene stage', icon: 'Map', body: SCENE_STAGE_BODY_ID },
};
