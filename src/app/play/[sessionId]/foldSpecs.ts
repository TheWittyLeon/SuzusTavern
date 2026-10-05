import { MEMBER_SHEET_HEADING_ID } from '@/components/MemberSheetPanel';
import { SCENE_STAGE_BODY_ID } from './regions/SceneStage';
import type { FoldSpec } from './PlayShell';
import type { RegionId } from './presets';

/** Fold-handle copy for every region that is collapsible in some row (A9c C7).
 *  The shell reads `collapsible`; this is labels only. The stage has no
 *  `labelledBy`: it is already the "Scene" aside. It folds only its `body`. */
export const FOLD_SPECS: Partial<Record<RegionId, FoldSpec>> = {
  characterBlock: { label: 'Character sheet', icon: 'Scroll', labelledBy: MEMBER_SHEET_HEADING_ID },
  // B8c-4 P1 (brief 2.3, 4.1): the stage's fold is its BODY, the map, behind a handle on the scene line. The name is "Map" (the handle's visible word is the same: WCAG 2.5.3), not "Scene": the stage IS the "Scene" aside,
  // and a button named like its landmark is announced twice (Iro A9c-1 MINOR-4). It exists only in a board fight (`when`): a band or a fight with no board has nothing to fold.
  sceneStage: { label: 'Map', text: 'Map', icon: 'Map', body: SCENE_STAGE_BODY_ID, when: { room: 'board' } },
};
