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
import type { LayoutId, Moment } from '@/app/play/[sessionId]/presets';

export const VIBES = ['hearthlight', 'dusk-tavern', 'candlelit', 'aetheric', 'moonlit-grove'] as const;
export type Vibe = (typeof VIBES)[number];

/**
 * A user's palette preference: a concrete vibe, or `'system'` to follow the OS
 * `prefers-color-scheme`. Distinct from the concrete `Vibe` that is actually
 * painted onto `<html data-vibe>` (see {@link resolveVibe}).
 */
export type VibePref = Vibe | 'system';

export const DENSITIES = ['compact', 'cozy', 'airy'] as const;
export type Density = (typeof DENSITIES)[number];

/**
 * TAV-PLAY-SHELL step 6a (decomposition plan §3.3/§3.4) — the user's layout
 * preset preference. `'phone'` is deliberately NOT a member: it is a
 * resolved {@link LayoutId} the phone breakpoint forces (R16: "phone has
 * ONE layout"), never something a user picks.
 */
export const LAYOUT_PREFS = ['auto', 'story', 'table'] as const;
export type LayoutPref = (typeof LAYOUT_PREFS)[number];

/** R23: Auto is the default, and the new shell ships with no feature flag —
 *  the preset picker itself is the escape hatch. */
export const DEFAULT_LAYOUT_PREF: LayoutPref = 'auto';

export const LAYOUT_KEY = 'tavern.layout';

export function isLayoutPref(v: string | null | undefined): v is LayoutPref {
  return v != null && (LAYOUT_PREFS as readonly string[]).includes(v);
}

/** Ultimate fallback vibe when the OS preference is unavailable (SSR / no matchMedia).
 *  T4p1: hearthlight-refined is now the app default (dusk-tavern stays fully
 *  selectable — see globals.css's sibling [data-vibe="hearthlight"] block). */
export const DEFAULT_VIBE: Vibe = 'hearthlight';
/** Default preference when nothing is stored — follow the device theme. */
export const DEFAULT_VIBE_PREF: VibePref = 'system';
export const DEFAULT_DENSITY: Density = 'cozy';

/** Which concrete vibe `'system'` resolves to for each OS scheme. */
export const SYSTEM_LIGHT_VIBE: Vibe = 'candlelit';
export const SYSTEM_DARK_VIBE: Vibe = 'hearthlight';

export const VIBE_KEY = 'tavern.vibe';
export const DENSITY_KEY = 'tavern.density';

/** Order the palette options appear in the Tweaks panel (System first). */
export const VIBE_PREFS: readonly VibePref[] = ['system', ...VIBES];

export const VIBE_LABELS: Record<Vibe, string> = {
  hearthlight: 'Hearthlight',
  'dusk-tavern': 'Dusk Tavern',
  candlelit: 'Candlelit',
  aetheric: 'Aetheric',
  'moonlit-grove': 'Moonlit Grove',
};

export const VIBE_HINTS: Record<Vibe, string> = {
  hearthlight: 'Ember-rose and amethyst, crafted',
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
 * TAV-PLAY-SHELL step 6a (decomposition plan §3.3) — resolves `/play`'s
 * layout preset from the user's preference, the phone breakpoint, and the
 * current moment. Byte-for-byte parallel to {@link resolveVibe}: same file,
 * same test file, same mental model, same reason this isn't a component
 * (pure function of three already-known inputs).
 *
 * `isPhone` is expected to come from `useMediaQuery(PLAY_PHONE_QUERY)`
 * (`src/lib/breakpoints.ts`) — not re-derived here, so this stays a pure
 * function with no window/matchMedia access of its own.
 */
export function resolveLayout(pref: LayoutPref, isPhone: boolean, moment: Moment): LayoutId {
  if (isPhone) return 'phone'; // R16: phone has one layout, full stop.
  if (pref === 'auto') return moment === 'combat' ? 'table' : 'story'; // R18
  return pref;
}

/**
 * Dependency-free script injected into the document head. It runs before first
 * paint and applies the palette/density to <html>, so the correct scheme never
 * flashes the default then swaps (AC #4). It resolves the palette from the
 * stored preference: a concrete saved vibe is used verbatim; anything else
 * (`'system'`, absent, or tampered) follows the OS `prefers-color-scheme` —
 * light → candlelit, otherwise hearthlight (T4p1: was dusk-tavern). Kept tiny
 * and literal (no imports — it executes before any module loads) and CSP-safe
 * (no eval, no external src). Mirrors the keys/values above; keep in sync.
 *
 * TAV-PLAY-SHELL step 6a: extended with `data-layout`, same convention as
 * density — `'auto'` is the default and is never written as an attribute
 * (absence means auto); only a pinned `'story'`/`'table'` choice is painted
 * pre-hydration. This is the *preference*; the resolved id
 * (`data-layout-resolved` + `data-moment`) is `/play`'s own concern
 * (plan §3.4), not this app-wide script's.
 */
export const NO_FLASH_SCRIPT = `(function(){try{var d=document.documentElement,v=localStorage.getItem('${VIBE_KEY}'),n=localStorage.getItem('${DENSITY_KEY}'),l=localStorage.getItem('${LAYOUT_KEY}');if(v!=='hearthlight'&&v!=='dusk-tavern'&&v!=='candlelit'&&v!=='aetheric'&&v!=='moonlit-grove'){v=(window.matchMedia&&window.matchMedia('(prefers-color-scheme: light)').matches)?'candlelit':'hearthlight';}d.setAttribute('data-vibe',v);if(n==='compact'||n==='cozy'||n==='airy')d.setAttribute('data-density',n);if(l==='story'||l==='table')d.setAttribute('data-layout',l);}catch(e){}})();`;
