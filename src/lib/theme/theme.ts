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
import type { LayoutId, Moment, RegionId } from '@/app/play/[sessionId]/presets';

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

/** Labels and hints for the TweaksPanel layout picker (A9c-2 D3). Here, beside
 *  `VIBE_*`, because a lib module must not import a route's runtime values
 *  (`presets.ts` is `/play`'s). Keyed by `LayoutPref`, so a fourth pref is a
 *  compile error until it is described. */
export const LAYOUT_PREF_LABELS: Record<LayoutPref, string> = {
  auto: 'Auto',
  story: 'Story',
  table: 'Table',
};

export const LAYOUT_PREF_HINTS: Record<LayoutPref, string> = {
  auto: 'Story while exploring, Table in combat',
  story: 'Narration first, always',
  table: 'Stage first, always',
};

/** Shown instead of the picker's effect on a phone, where R16 gives one layout. */
export const LAYOUT_PHONE_NOTE = 'Phones use one layout.';

export function isLayoutPref(v: string | null | undefined): v is LayoutPref {
  return v != null && (LAYOUT_PREFS as readonly string[]).includes(v);
}

/**
 * R20 (A9c C7): which docked regions the user has folded, "remembered per
 * user" beside look/layout/density. Stored as a JSON array of region ids.
 * ABSENT MEANS OPEN (R20: docked open by default) — the same convention as
 * `'auto'` layout and `'system'` vibe: a default is never written. Parsing is
 * tolerant: anything that is not an array of strings is "nothing folded".
 * Ids this build does not know are KEPT, inert: the shell reads a fold by a
 * placed region's id, so a stale id changes nothing, and keeping it means an
 * older build does not erase a newer build's fold. (Deliberately no
 * `REGION_IDS` import: this module is in the global layout's bundle and
 * `presets.ts` is not.)
 */
export const FOLDS_KEY = 'tavern.folds';

export type Folds = Partial<Record<RegionId, true>>;

export function parseFolds(raw: string | null): Folds {
  if (raw == null) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!Array.isArray(parsed)) return {};
  const folds: Folds = {};
  for (const id of parsed) if (typeof id === 'string') folds[id as RegionId] = true;
  return folds;
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

/** The inverse of `parseFolds`; an empty set is the absent key (see FOLDS_KEY). */
export function serializeFolds(folds: Folds): string | null {
  const ids = Object.keys(folds).filter((id) => folds[id as RegionId]);
  return ids.length === 0 ? null : JSON.stringify(ids.sort());
}
