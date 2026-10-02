'use client';

import DiceTray, { type DiceTrayProps } from '@/components/DiceTray';
import styles from '../Play.module.css';

/**
 * The dice tray as the STAGE's tenant: the row x moment cells whose composer variant is `full` (Story while exploring, where the stage is a
 * `panel`). Everywhere the stage is a `hero` or the phone's strip (`composer: 'roll'`: the phone since A9d-2 N7, Amendment E.4; Story's combat
 * and Table since A10 S1, Amendment F.4) the same tray lives behind the Roll control in the composer's mode row (`components/RollControl`) and this tenant is not
 * rendered: one node, two homes, chosen by the row. The tray remounts when the row changes; `advantage` lives in the page and survives.
 */
export default function DiceTrayTenant(props: Omit<DiceTrayProps, 'layout'>) {
  return (
    <div className={styles.diceWrap} data-tenant="diceTray">
      {/* A2 — real character skill modifiers; null=loading or []=DM-only hide checks */}
      <DiceTray {...props} />
    </div>
  );
}
