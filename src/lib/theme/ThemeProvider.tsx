'use client';
/**
 * ThemeProvider — client palette/density state for the switcher (S3.1 / ST-073).
 *
 * The no-flash inline script (theme.ts `NO_FLASH_SCRIPT`) has already applied
 * the resolved palette to <html> before hydration, so this provider seeds its
 * React state from the live DOM dataset (falling back to the stored preference,
 * then defaults). Changes are written imperatively to
 * `document.documentElement.dataset` + localStorage — the provider never
 * re-renders the <html> attribute, so there's no hydration mismatch (the <html>
 * element carries `suppressHydrationWarning`).
 *
 * UIR2-TAV-4: `vibePref` is what the user chose (`'system'` or a concrete vibe);
 * `vibe` is the concrete palette actually painted. When the preference is
 * `'system'` the provider follows the OS `prefers-color-scheme` live, so a user
 * who never opened the picker tracks their device theme in real time.
 * `color-scheme` itself is handled declaratively per `data-vibe` in globals.css.
 */
import type { RegionId } from '@/app/play/[sessionId]/presets';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  DEFAULT_DENSITY,
  DEFAULT_LAYOUT_PREF,
  DEFAULT_VIBE,
  DEFAULT_VIBE_PREF,
  DENSITY_KEY,
  FOLDS_KEY,
  FOLDS_OPEN_KEY,
  LAYOUT_KEY,
  VIBE_KEY,
  isDensity,
  isLayoutPref,
  isVibe,
  isVibePref,
  parseFolds,
  prefersLight,
  resolveVibe,
  serializeFolds,
  type Density,
  type Folds,
  type LayoutPref,
  type Vibe,
  type VibePref,
} from './theme';

interface ThemeContextValue {
  /** The concrete palette currently painted onto <html data-vibe>. */
  vibe: Vibe;
  /** The user's stored preference: a concrete vibe, or 'system' (follow OS). */
  vibePref: VibePref;
  density: Density;
  /** TAV-PLAY-SHELL step 6a (plan §3.4): the `/play` layout preset
   *  preference — 'auto' (default, R23) | 'story' | 'table'. Resolved to a
   *  concrete `LayoutId` by `resolveLayout` (theme.ts), which also takes
   *  the phone breakpoint and the current moment — neither of which this
   *  provider knows about, so it stores the raw preference only.
   *
   *  A9c-2 D3: the TweaksPanel Layout group calls `setLayout`, from TavernShell
   *  and from `/play`'s TopBar settings slot.
   */
  layout: LayoutPref;
  /** R20 (A9c C7): the docked regions the user has folded. Absent = open. */
  folds: Folds;
  /** The ids the user explicitly opened (B8c-4 P0): the third stored state beside folded and none. */
  foldsOpen: Folds;
  setFold: (region: RegionId, folded: boolean) => void;
  /** Writes one region's stored fold choice: `folded`, `open` (explicit) or `none` (the default decides). Only a press on a handle calls it. */
  setFoldChoice: (region: RegionId, choice: 'folded' | 'open' | 'none') => void;
  setVibe: (v: VibePref) => void;
  setDensity: (d: Density) => void;
  setLayout: (l: LayoutPref) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function safeGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* private mode / storage disabled — choice just doesn't persist */
  }
}

function safeRemove(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* private mode / storage disabled — nothing to clear */
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [vibe, setVibeResolved] = useState<Vibe>(DEFAULT_VIBE);
  const [vibePref, setVibePref] = useState<VibePref>(DEFAULT_VIBE_PREF);
  const [density, setDensityState] = useState<Density>(DEFAULT_DENSITY);
  const [layout, setLayoutState] = useState<LayoutPref>(DEFAULT_LAYOUT_PREF);
  const [folds, setFoldsState] = useState<Folds>({});
  const foldsRef = useRef<Folds>({});
  const [foldsOpen, setFoldsOpenState] = useState<Folds>({});
  const foldsOpenRef = useRef<Folds>({});

  // Sync React state with what the no-flash script already painted.
  useEffect(() => {
    const d = document.documentElement;

    // Preference comes from storage (absent/tampered → 'system').
    const storedPref = safeGet(VIBE_KEY);
    const pref: VibePref = isVibePref(storedPref) ? storedPref : DEFAULT_VIBE_PREF;
    // Deliberately post-hydration (see header comment) — reading localStorage
    // during render here would risk exactly the hydration mismatch this
    // effect exists to avoid, so this can't move to a lazy initializer.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setVibePref(pref);

    // Resolved concrete vibe: trust what the no-flash script painted; otherwise
    // resolve the preference against the OS (SSR/no-matchMedia → dark default).
    const domVibe = d.dataset.vibe;
    const resolved = isVibe(domVibe) ? domVibe : resolveVibe(pref, prefersLight());
    setVibeResolved(resolved);
    // DDX-THEME-MOUNT-DOM (P3): mirror the resolved value onto the DOM so a
    // no-flash script that never ran (CSP block, extension interference,
    // etc.) doesn't strand <html data-vibe> on the static SSR default while
    // React's own state has already resolved a different vibe. Runs
    // post-hydration inside this effect — same timing as the OS-listener and
    // setVibe writes below — so it can't cause a hydration mismatch (only a
    // render-time attribute diff would). When domVibe was already a trusted,
    // syntactically-valid value this is a same-value no-op: `resolved` is
    // literally `domVibe` in that branch, so the write changes nothing —
    // theme.test.tsx's CHARACTERIZATION test (an already-present, valid
    // data-vibe "wins" over the stored pref) is unaffected by this line.
    if (d.dataset.vibe !== resolved) d.dataset.vibe = resolved;

    const domDensity = d.dataset.density;
    if (isDensity(domDensity)) setDensityState(domDensity);
    else {
      const stored = safeGet(DENSITY_KEY);
      if (isDensity(stored)) setDensityState(stored);
    }

    // Same pattern as density: 'auto' is the default and is never painted as
    // an attribute (NO_FLASH_SCRIPT), so an absent/invalid dataset value just
    // means "nothing pinned yet" rather than "seed from storage".
    const domLayout = d.dataset.layout;
    if (isLayoutPref(domLayout)) setLayoutState(domLayout);
    else {
      const storedLayout = safeGet(LAYOUT_KEY);
      if (isLayoutPref(storedLayout)) setLayoutState(storedLayout);
    }

    // R20: folds are storage-only (no attribute — nothing paints before React).
    foldsRef.current = parseFolds(safeGet(FOLDS_KEY));
    setFoldsState(foldsRef.current);
    foldsOpenRef.current = parseFolds(safeGet(FOLDS_OPEN_KEY));
    setFoldsOpenState(foldsOpenRef.current);
  }, []);

  // While following the system, react to live OS light/dark changes.
  useEffect(() => {
    if (vibePref !== 'system') return;
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const onChange = () => {
      const resolved = resolveVibe('system', mq.matches);
      document.documentElement.dataset.vibe = resolved;
      setVibeResolved(resolved);
    };
    // Safari < 14 exposes only the legacy addListener/removeListener API (its
    // MediaQueryList has no addEventListener), so fall back to it rather than
    // throw inside the effect on those engines.
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else mq.addListener?.(onChange);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener('change', onChange);
      else mq.removeListener?.(onChange);
    };
  }, [vibePref]);

  const setVibe = useCallback((pref: VibePref) => {
    if (pref === 'system') {
      // Absence of the key means "follow the OS" — clear any pinned choice.
      safeRemove(VIBE_KEY);
      const resolved = resolveVibe('system', prefersLight());
      document.documentElement.dataset.vibe = resolved;
      setVibePref('system');
      setVibeResolved(resolved);
    } else {
      document.documentElement.dataset.vibe = pref;
      safeSet(VIBE_KEY, pref);
      setVibePref(pref);
      setVibeResolved(pref);
    }
  }, []);

  const setDensity = useCallback((d: Density) => {
    document.documentElement.dataset.density = d;
    safeSet(DENSITY_KEY, d);
    setDensityState(d);
  }, []);

  const setLayout = useCallback((l: LayoutPref) => {
    // 'auto' is the default — clear the pinned choice rather than writing
    // the literal string, same reason setVibe clears VIBE_KEY for 'system'.
    if (l === 'auto') {
      document.documentElement.removeAttribute('data-layout');
      safeRemove(LAYOUT_KEY);
    } else {
      document.documentElement.dataset.layout = l;
      safeSet(LAYOUT_KEY, l);
    }
    setLayoutState(l);
  }, []);

  const writeFolds = useCallback((folded: Folds, opened: Folds) => {
    // Computed from refs, not from the state closures: two folds set in one tick must not clobber each other, and with storage unavailable the in-memory state is the only copy.
    for (const [key, next, ref, set] of [
      [FOLDS_KEY, folded, foldsRef, setFoldsState],
      [FOLDS_OPEN_KEY, opened, foldsOpenRef, setFoldsOpenState],
    ] as const) {
      const raw = serializeFolds(next);
      if (raw === null) safeRemove(key);
      else safeSet(key, raw);
      ref.current = next;
      set(next);
    }
  }, []);

  const setFoldChoice = useCallback((region: RegionId, choice: 'folded' | 'open' | 'none') => {
    const folded = { ...foldsRef.current };
    const opened = { ...foldsOpenRef.current };
    delete folded[region];
    delete opened[region];
    if (choice === 'folded') folded[region] = true;
    if (choice === 'open') opened[region] = true;
    writeFolds(folded, opened);
  }, [writeFolds]);

  // The legacy two-state write (a region whose default is open): folded, or nothing. Never writes an explicit open.
  const setFold = useCallback((region: RegionId, folded: boolean) => setFoldChoice(region, folded ? 'folded' : 'none'), [setFoldChoice]);

  return (
    <ThemeContext.Provider
      value={{ vibe, vibePref, density, layout, folds, foldsOpen, setVibe, setDensity, setLayout, setFold, setFoldChoice }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider');
  return ctx;
}
