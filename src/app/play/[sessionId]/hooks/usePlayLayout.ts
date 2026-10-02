'use client';

/**
 * TAV-PLAY-SHELL step 6b, commit C4 (build brief §6.2) — resolves `/play`'s
 * layout preset from the user's preference (`ThemeProvider`), the phone
 * breakpoint, and the current moment. A thin wrapper around three
 * already-built, already-tested pieces (`useTheme`, `useMediaQuery` +
 * `PLAY_PHONE_QUERY`, `resolveLayout`) — no new resolution logic lives
 * here; this hook exists so `PlayShell`'s caller (page.tsx) has ONE call
 * that returns the row + the attributes the shell paints
 * (`data-layout-resolved`/`data-moment`, plan §3.4).
 *
 * A9c C6: reads `useTheme()` like every other consumer. /play suites mount
 * under the real provider (`src/test-utils/renderPlay.tsx`); the no-provider
 * fallback (`useThemeOptional`) and its `debt:` are gone.
 *
 * `page.tsx` calls this hook and passes `row`/`moment` DOWN to `<PlayShell>`
 * as props — the shell itself stays a pure function of its props (never
 * reads the theme directly) so A9c's render matrix can mount it 6 times
 * without a provider.
 */
import { useTheme } from '@/lib/theme/ThemeProvider';
import { useMediaQuery } from '@/lib/useMediaQuery';
import { PLAY_PHONE_QUERY } from '@/lib/breakpoints';
import { resolveLayout } from '@/lib/theme/theme';
import { isSpaceUsable } from '@/components/tactical-map/reach';
import type { CombatSpace } from '@/lib/api/types';
import {
  LAYOUT_ROWS_BY_ID,
  type Facts,
  type FactValue,
  type LayoutId,
  type LayoutRow,
  type Moment,
} from '../presets';

export interface PlayLayout {
  row: LayoutRow;
  /** = `row.id` — the resolved preset, for `data-layout-resolved`. */
  layoutId: LayoutId;
  isPhone: boolean;
  /** What the page reports to the shell (A10 step 11 S2a, Amendment F.4); the row answers it with `--play-*` values (`factVars`). */
  facts: Facts;
}

/**
 * The `room` fact (A10 step 11 S2a, Sora brief 3.1): what the encounter gives the stage. Not in a fight: `none`. In a fight whose encounter has a
 * usable `space`: `board`. Otherwise (no `space`, or a malformed one): `band`. `isSpaceUsable` is the tactical map's ONE seam for "can this board be
 * drawn" and the map's own fallback reads the same predicate, so the room and the map can never disagree about whether there is a board (a second
 * copy of that test, or a bare `space != null`, would let a malformed board get a board's room and the map draw its fallback in it).
 */
export function roomFact(moment: Moment, space: CombatSpace | null | undefined): FactValue<'room'> {
  if (moment !== 'combat') return 'none';
  return isSpaceUsable(space) ? 'board' : 'band';
}

export function usePlayLayout(moment: Moment, space?: CombatSpace | null): PlayLayout {
  const pref = useTheme().layout;
  const isPhone = useMediaQuery(PLAY_PHONE_QUERY);
  const layoutId = resolveLayout(pref, isPhone, moment);
  return { row: LAYOUT_ROWS_BY_ID[layoutId], layoutId, isPhone, facts: { room: roomFact(moment, space) } };
}
