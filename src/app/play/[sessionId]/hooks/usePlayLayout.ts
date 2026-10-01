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
 * `page.tsx` calls this hook and passes `row`/`moment` DOWN to `<PlayShell>`
 * as props — the shell itself stays a pure function of its props (never
 * reads the theme directly) so A9c's render matrix can mount it 6 times
 * without a provider.
 */
import { useThemeOptional } from '@/lib/theme/ThemeProvider';
import { useMediaQuery } from '@/lib/useMediaQuery';
import { PLAY_PHONE_QUERY } from '@/lib/breakpoints';
import { DEFAULT_LAYOUT_PREF, resolveLayout } from '@/lib/theme/theme';
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
  // `useThemeOptional` (not `useTheme`): measured, the /play test suite's
  // 74+ fixtures all mount `PlayPage` with no `<ThemeProvider>` ancestor
  // (the real app always has one, via app/layout.tsx) — `useTheme`'s throw
  // would red every one of them on this hook's first render.
  // debt: falls back to DEFAULT_LAYOUT_PREF ('auto', R23's own default) when there is no ThemeProvider ancestor.
  // ceiling: exactly this one fallback; a second "no provider" workaround elsewhere in /play is the finding.
  // until: the /play test fixtures wrap <ThemeProvider> (test-infra, tracked separately) or a suite needs to exercise a pinned (non-'auto') LayoutPref and must supply the real provider to do it.
  const pref = useThemeOptional()?.layout ?? DEFAULT_LAYOUT_PREF;
  const isPhone = useMediaQuery(PLAY_PHONE_QUERY);
  const layoutId = resolveLayout(pref, isPhone, moment);
  return { row: LAYOUT_ROWS_BY_ID[layoutId], layoutId, isPhone };
}
