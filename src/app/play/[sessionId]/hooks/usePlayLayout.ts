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
import {
  LAYOUT_ROWS_BY_ID,
  type LayoutId,
  type LayoutRow,
  type Moment,
} from '../presets';

export interface PlayLayout {
  row: LayoutRow;
  /** = `row.id` — the resolved preset, for `data-layout-resolved`. */
  layoutId: LayoutId;
  isPhone: boolean;
}

export function usePlayLayout(moment: Moment): PlayLayout {
  const pref = useTheme().layout;
  const isPhone = useMediaQuery(PLAY_PHONE_QUERY);
  const layoutId = resolveLayout(pref, isPhone, moment);
  return { row: LAYOUT_ROWS_BY_ID[layoutId], layoutId, isPhone };
}
