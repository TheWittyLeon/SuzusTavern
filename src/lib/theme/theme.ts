/**
 * Theme constants for the palette + density switcher (S3.1 / ST-073).
 *
 * The four palettes and three densities already exist as token blocks in
 * globals.css (`[data-vibe=…]` / `[data-density=…]`). This module is the single
 * source of truth for their ids/labels, the localStorage keys, and the tiny
 * pre-hydration script that applies the saved choice before first paint.
 *
 * UIR2-TAV-4: the app now honors the OS `prefers-color-scheme`. A user's stored
 * value is a *preference* (`VibePref`) that is either a concrete palette or
 * `'system'` (follow the device light/dark setting). `'system'` is the default
 * when nothing is stored, so a first-time visitor whose OS is in light mode
 * lands on the light `candlelit` palette instead of the dark default.
 * `color-scheme` is set declaratively per `data-vibe` in globals.css.
 */

export const VIBES = ['dusk-tavern', 'candlelit', 'aetheric', 'moonlit-grove'] as const;
export type Vibe = (typeof VIBES)[number];

/**
 * A user's palette preference: a concrete vibe, or `'system'` to follow the OS
 * `prefers-color-scheme`. Distinct from the concrete `Vibe` that is actually
 * painted onto `<html data-vibe>` (see {@link resolveVibe}).
 */
export type VibePref = Vibe | 'system';

export const DENSITIES = ['compact', 'cozy', 'airy'] as const;
export type Density = (typeof DENSITIES)[number];

/** Ultimate fallback vibe when the OS preference is unavailable (SSR / no matchMedia). */
export const DEFAULT_VIBE: Vibe = 'dusk-tavern';
/** Default preference when nothing is stored — follow the device theme. */
export const DEFAULT_VIBE_PREF: VibePref = 'system';
export const DEFAULT_DENSITY: Density = 'cozy';

/** Which concrete vibe `'system'` resolves to for each OS scheme. */
export const SYSTEM_LIGHT_VIBE: Vibe = 'candlelit';
export const SYSTEM_DARK_VIBE: Vibe = 'dusk-tavern';

export const VIBE_KEY = 'tavern.vibe';
export const DENSITY_KEY = 'tavern.density';

/** Order the palette options appear in the Tweaks panel (System first). */
export const VIBE_PREFS: readonly VibePref[] = ['system', ...VIBES];

export const VIBE_LABELS: Record<Vibe, string> = {
  'dusk-tavern': 'Dusk Tavern',
  candlelit: 'Candlelit',
  aetheric: 'Aetheric',
  'moonlit-grove': 'Moonlit Grove',
};

export const VIBE_HINTS: Record<Vibe, string> = {
  'dusk-tavern': 'Cozy, fireside, aubergine',
  candlelit: 'Light parchment, ember',
  aetheric: 'Deep midnight, arcane teal',
  'moonlit-grove': 'Mossy, silver, lavender',
};

export const VIBE_PREF_LABELS: Record<VibePref, string> = {
  system: 'System',
  ...VIBE_LABELS,
};

export const VIBE_PREF_HINTS: Record<VibePref, string> = {
  system: 'Match your device theme',
  ...VIBE_HINTS,
};

export const DENSITY_LABELS: Record<Density, string> = {
  compact: 'Compact',
  cozy: 'Cozy',
  airy: 'Airy',
};

export function isVibe(v: string | null | undefined): v is Vibe {
  return v != null && (VIBES as readonly string[]).includes(v);
}

export function isVibePref(v: string | null | undefined): v is VibePref {
  return v === 'system' || isVibe(v);
}

export function isDensity(d: string | null | undefined): d is Density {
  return d != null && (DENSITIES as readonly string[]).includes(d);
}

/**
 * Read the OS light preference, guarded for SSR / jsdom (where `matchMedia` is
 * absent). Returns false (→ dark default) whenever it can't be determined.
 */
export function prefersLight(): boolean {
  try {
    return (
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-color-scheme: light)').matches
    );
  } catch {
    return false;
  }
}

/** Resolve the concrete vibe to paint from a preference + the current OS scheme. */
export function resolveVibe(pref: VibePref, osPrefersLight: boolean): Vibe {
  if (pref === 'system') return osPrefersLight ? SYSTEM_LIGHT_VIBE : SYSTEM_DARK_VIBE;
  return pref;
}

/**
 * Dependency-free script injected into the document head. It runs before first
 * paint and applies the palette/density to <html>, so the correct scheme never
 * flashes the dusk default then swaps (AC #4). It resolves the palette from the
 * stored preference: a concrete saved vibe is used verbatim; anything else
 * (`'system'`, absent, or tampered) follows the OS `prefers-color-scheme` —
 * light → candlelit, otherwise dusk-tavern. Kept tiny and literal (no imports —
 * it executes before any module loads) and CSP-safe (no eval, no external src).
 * Mirrors the keys/values above; keep in sync.
 */
export const NO_FLASH_SCRIPT = `(function(){try{var d=document.documentElement,v=localStorage.getItem('${VIBE_KEY}'),n=localStorage.getItem('${DENSITY_KEY}');if(v!=='dusk-tavern'&&v!=='candlelit'&&v!=='aetheric'&&v!=='moonlit-grove'){v=(window.matchMedia&&window.matchMedia('(prefers-color-scheme: light)').matches)?'candlelit':'dusk-tavern';}d.setAttribute('data-vibe',v);if(n==='compact'||n==='cozy'||n==='airy')d.setAttribute('data-density',n);}catch(e){}})();`;
