'use client';
/**
 * ThemeProvider — client palette/density state for the switcher (S3.1 / ST-073).
 *
 * The no-flash inline script (theme.ts `NO_FLASH_SCRIPT`) has already applied
 * the saved choice to <html> before hydration, so this provider seeds its React
 * state from the live DOM dataset (falling back to localStorage, then defaults).
 * Changes are written imperatively to `document.documentElement.dataset` +
 * localStorage — the provider never re-renders the <html> attribute, so there's
 * no hydration mismatch (the <html> element carries `suppressHydrationWarning`).
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import {
  DEFAULT_DENSITY,
  DEFAULT_VIBE,
  DENSITY_KEY,
  VIBE_KEY,
  isDensity,
  isVibe,
  type Density,
  type Vibe,
} from './theme';

interface ThemeContextValue {
  vibe: Vibe;
  density: Density;
  setVibe: (v: Vibe) => void;
  setDensity: (d: Density) => void;
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

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [vibe, setVibeState] = useState<Vibe>(DEFAULT_VIBE);
  const [density, setDensityState] = useState<Density>(DEFAULT_DENSITY);

  // Sync React state with what the no-flash script already painted.
  useEffect(() => {
    const d = document.documentElement;
    const domVibe = d.dataset.vibe;
    if (isVibe(domVibe)) setVibeState(domVibe);
    else {
      const stored = safeGet(VIBE_KEY);
      if (isVibe(stored)) setVibeState(stored);
    }

    const domDensity = d.dataset.density;
    if (isDensity(domDensity)) setDensityState(domDensity);
    else {
      const stored = safeGet(DENSITY_KEY);
      if (isDensity(stored)) setDensityState(stored);
    }
  }, []);

  const setVibe = useCallback((v: Vibe) => {
    document.documentElement.dataset.vibe = v;
    safeSet(VIBE_KEY, v);
    setVibeState(v);
  }, []);

  const setDensity = useCallback((d: Density) => {
    document.documentElement.dataset.density = d;
    safeSet(DENSITY_KEY, d);
    setDensityState(d);
  }, []);

  return (
    <ThemeContext.Provider value={{ vibe, density, setVibe, setDensity }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider');
  return ctx;
}
