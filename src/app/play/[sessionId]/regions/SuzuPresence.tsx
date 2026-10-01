'use client';

import SuzuDM from '@/components/SuzuDM';
import type { RegionVariant } from '../variants';

/**
 * TAV-PLAY-SHELL step 6b, commit C4 (build brief §6.8, Amendment B.3) —
 * `SuzuPresence` finally gets its own file: `SuzuDM` used to render
 * *inside* `NarratorStrip` (`NarratorStrip.tsx:125`, deleted in this same
 * commit), but Story/Table now give `suzuPresence` its own `200px` grid
 * area — a region nested inside `topBar`'s own area can't reach it.
 *
 * `variant` (Amendment B.3's `suzuPresence: ['compact','full']` union) maps
 * to `SuzuDM`'s own `size` prop — Story/Table emit `'full'` (a full-height
 * column, so the larger presence), Phone emits `'compact'` (a small figure in
 * its own column at the end of the header line, A9d E2). Sizes are a starting point for Aoi/step
 * 9's checkpoint pass (plan §2.3: step 9 "only adds `mood`"), not final
 * pixel values — `'full'` matches the original `NarratorStrip` call's
 * `size={56}` so desktop's visual size is unchanged at 6b.
 */
export interface SuzuPresenceProps {
  /** The registry's own union (`REGION_VARIANTS.suzuPresence`), not a hand-written copy. */
  variant?: RegionVariant<'suzuPresence'>;
  talking?: boolean;
}

const SIZE_BY_VARIANT: Record<RegionVariant<'suzuPresence'>, number> = {
  compact: 32,
  full: 56,
};

export default function SuzuPresence({ variant = 'full', talking = false }: SuzuPresenceProps) {
  return (
    <div data-region="suzuPresence" data-variant={variant}>
      <SuzuDM size={SIZE_BY_VARIANT[variant]} glow={false} talking={talking} />
    </div>
  );
}
