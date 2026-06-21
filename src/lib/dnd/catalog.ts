// src/lib/dnd/catalog.ts
//
// Transforms raw GET /api/dnd/catalog items into the typed display shapes
// the wizard uses. Mechanical fields come from the catalog; UI-only decoration
// (icons, flavor, blurbs) comes from the local decoration tables in helpers.ts.
//
// This adapter is the single point of contact between catalog data and wizard
// rendering — change the catalog schema, update it here.

import {
  RACE_DECORATION,
  CLASS_DECORATION,
  BACKGROUND_DECORATION,
  type AbilityKey,
} from './helpers';
import type { IconName } from '@/components/Icon';
import type { CatalogItem, CatalogRaceData, CatalogClassData, CatalogBackgroundData } from '@/lib/api/types';

// ── Wizard display types ──────────────────────────────────────────────────────

export interface WizardRace {
  /** Catalog slug == name.toLowerCase(). POSTed to the engine as `race` via name. */
  id: string;
  /** Canonical name to POST to the engine. */
  name: string;
  sub: string;
  /** Human-readable bonus summary derived from ability_bonus. */
  bonusLabel: string;
  /** Fixed racial ability bonuses the engine applies at create. */
  bonuses: Partial<Record<AbilityKey, number>>;
  /** Base walking speed in feet. */
  speed: number;
  icon: IconName;
}

export interface WizardClass {
  id: string;
  name: string;
  hitDie: number;
  /** Two saving-throw proficiency ability keys. */
  saves: AbilityKey[];
  icon: IconName;
  /** CSS custom property for the card accent. */
  accent: string;
  flavor: string;
}

export interface WizardBackground {
  id: string;
  name: string;
  /** Skill proficiency keys in engine form (e.g. 'sleight_of_hand'). */
  skills: string[];
  blurb: string;
}

// ── Bonus label helper ────────────────────────────────────────────────────────

const ABILITY_ABBR: Record<string, string> = {
  strength: 'STR',
  dexterity: 'DEX',
  constitution: 'CON',
  intelligence: 'INT',
  wisdom: 'WIS',
  charisma: 'CHA',
};

function buildBonusLabel(bonus: Partial<Record<string, number>>): string {
  const parts = Object.entries(bonus)
    .filter(([, v]) => v && v !== 0)
    .map(([k, v]) => `+${v ?? 0} ${ABILITY_ABBR[k] ?? k.toUpperCase()}`);
  return parts.length ? parts.join(' · ') : 'none';
}

// ── Catalog → wizard adapters ─────────────────────────────────────────────────

export function catalogItemToRace(item: CatalogItem): WizardRace {
  const d = item.data as CatalogRaceData;
  const deco = RACE_DECORATION[item.slug] ?? { icon: 'Users' as IconName, sub: '' };
  const bonuses = (d.ability_bonus ?? {}) as Partial<Record<AbilityKey, number>>;
  return {
    id: item.slug,
    name: item.name,
    sub: deco.sub,
    bonusLabel: buildBonusLabel(bonuses),
    bonuses,
    speed: d.speed ?? 30,
    icon: deco.icon,
  };
}

export function catalogItemToClass(item: CatalogItem): WizardClass {
  const d = item.data as CatalogClassData;
  const deco = CLASS_DECORATION[item.slug] ?? {
    icon: 'Sword' as IconName,
    accent: 'var(--accent)',
    flavor: '',
  };
  // saving_throws from catalog; fall back to empty to keep type safety
  const saves = ((d.saving_throws ?? []) as string[]).filter(
    (s): s is AbilityKey => s in ABILITY_ABBR,
  );
  return {
    id: item.slug,
    name: item.name,
    hitDie: d.hit_die ?? 8,
    saves,
    icon: deco.icon,
    accent: deco.accent,
    flavor: deco.flavor,
  };
}

export function catalogItemToBackground(item: CatalogItem): WizardBackground {
  const d = item.data as CatalogBackgroundData;
  const deco = BACKGROUND_DECORATION[item.slug] ?? { blurb: '' };
  return {
    id: item.slug,
    name: item.name,
    skills: d.skills ?? [],
    blurb: deco.blurb,
  };
}
