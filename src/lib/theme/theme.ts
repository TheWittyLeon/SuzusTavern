/**
 * Theme constants for the palette + density switcher (S3.1 / ST-073).
 *
 * The four palettes and three densities already exist as token blocks in
 * globals.css (`[data-vibe=…]` / `[data-density=…]`). This module is the single
 * source of truth for their ids/labels, the localStorage keys, and the tiny
 * pre-hydration script that applies the saved choice before first paint.
 */

export const VIBES = ['dusk-tavern', 'candlelit', 'aetheric', 'moonlit-grove'] as const;
export type Vibe = (typeof VIBES)[number];

export const DENSITIES = ['compact', 'cozy', 'airy'] as const;
export type Density = (typeof DENSITIES)[number];

export const DEFAULT_VIBE: Vibe = 'dusk-tavern';
export const DEFAULT_DENSITY: Density = 'cozy';

export const VIBE_KEY = 'tavern.vibe';
export const DENSITY_KEY = 'tavern.density';

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

export const DENSITY_LABELS: Record<Density, string> = {
  compact: 'Compact',
  cozy: 'Cozy',
  airy: 'Airy',
};

export function isVibe(v: string | null | undefined): v is Vibe {
  return v != null && (VIBES as readonly string[]).includes(v);
}

export function isDensity(d: string | null | undefined): d is Density {
  return d != null && (DENSITIES as readonly string[]).includes(d);
}

/**
 * Dependency-free script injected into the document head. It runs before first
 * paint and applies the saved palette/density to <html>, so a non-default
 * choice never flashes the dusk default then swaps (AC #4). Kept tiny and
 * literal (no imports — it executes before any module loads) and CSP-safe
 * (no eval, no external src). Mirrors the keys/values above; keep in sync.
 */
export const NO_FLASH_SCRIPT = `(function(){try{var d=document.documentElement,v=localStorage.getItem('${VIBE_KEY}'),n=localStorage.getItem('${DENSITY_KEY}');if(v==='dusk-tavern'||v==='candlelit'||v==='aetheric'||v==='moonlit-grove')d.setAttribute('data-vibe',v);if(n==='compact'||n==='cozy'||n==='airy')d.setAttribute('data-density',n);}catch(e){}})();`;
