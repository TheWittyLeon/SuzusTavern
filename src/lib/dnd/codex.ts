// src/lib/dnd/codex.ts
//
// DDX-21 — display helpers for the /codex compendium. Thin, pure functions
// that turn raw CatalogItem rows (GET /api/dnd/catalog) into strings the
// list rows and detail panels render. No React here — see useCodexCatalog.ts
// for the fetching hook and app/codex/page.tsx for the UI.

import type { IconName } from '@/components/Icon';
import type { PillTone } from '@/components/Pill';
import type {
  CatalogConditionData,
  CatalogEquipmentData,
  CatalogItem,
  CatalogMonsterAction,
  CatalogMonsterData,
  CatalogSpellData,
} from '@/lib/api/types';

// ── Content types shown in the Codex ─────────────────────────────────────────

export type CodexKind =
  | 'spell'
  | 'monster'
  | 'item'
  | 'race'
  | 'class'
  | 'background'
  | 'condition';

export interface CodexKindMeta {
  kind: CodexKind;
  /** Tab label. */
  label: string;
  /** Singular noun for empty/error copy ("no spells found"). */
  noun: string;
  /**
   * Plural noun for count copy ("12 classes"). DDX21-3: an explicit field
   * rather than derived (`` `${noun}s` ``) — "class" is irregular ("classes",
   * not "classs"), and naive concatenation shipped exactly that bug.
   */
  nounPlural: string;
  icon: IconName;
  /** Reuses Pill's already-contrast-audited tone palette for the kind accent. */
  tone: PillTone;
}

// Order here is the tab order (Spells, Monsters, Items, Races, Classes,
// Backgrounds, Conditions — DDX-21 scope, in that sequence).
export const CODEX_KINDS: CodexKindMeta[] = [
  { kind: 'spell', label: 'Spells', noun: 'spell', nounPlural: 'spells', icon: 'Magic', tone: 'lav' },
  { kind: 'monster', label: 'Monsters', noun: 'monster', nounPlural: 'monsters', icon: 'Skull', tone: 'bad' },
  { kind: 'item', label: 'Items', noun: 'item', nounPlural: 'items', icon: 'Potion', tone: 'warm' },
  { kind: 'race', label: 'Races', noun: 'race', nounPlural: 'races', icon: 'Users', tone: 'cool' },
  { kind: 'class', label: 'Classes', noun: 'class', nounPlural: 'classes', icon: 'Sword', tone: 'accent' },
  { kind: 'background', label: 'Backgrounds', noun: 'background', nounPlural: 'backgrounds', icon: 'Scroll', tone: 'crit' },
  { kind: 'condition', label: 'Conditions', noun: 'condition', nounPlural: 'conditions', icon: 'Sparkle', tone: 'warn' },
];

export const CODEX_KIND_META: Record<CodexKind, CodexKindMeta> = CODEX_KINDS.reduce(
  (acc, m) => ({ ...acc, [m.kind]: m }),
  {} as Record<CodexKind, CodexKindMeta>,
);

/** CSS custom property value for a kind's accent — used as `--tone` inline. */
const TONE_VAR: Record<PillTone, string> = {
  accent: 'var(--accent)',
  good: 'var(--good)',
  warn: 'var(--warn-ink)',
  bad: 'var(--bad-ink)',
  cool: 'var(--cool-ink)',
  warm: 'var(--warm-ink)',
  crit: 'var(--crit-ink)',
  // A11Y MAJOR-3 (Iro): was --ink-3, diverging from Pill.tsx's own audited
  // "muted" tone (TONE_MAP.muted.fg = var(--ink-2) — ink-3 measured 4.14:1 on
  // the muted chip surface there, ink-2 passes). Keep the two maps in sync.
  muted: 'var(--ink-2)',
  lav: 'var(--accent-2)',
};

export function toneVar(tone: PillTone): string {
  return TONE_VAR[tone];
}

// ── Source badge ──────────────────────────────────────────────────────────────

/** Human label + Pill tone for a catalog row's source_type (srd/nekonova/homebrew). */
export function sourceBadge(sourceType: string): { label: string; tone: PillTone } {
  switch (sourceType) {
    case 'srd':
      return { label: 'SRD', tone: 'cool' };
    case 'nekonova':
      return { label: "Suzu's", tone: 'lav' };
    case 'homebrew':
      return { label: 'Homebrew', tone: 'warm' };
    default:
      return { label: sourceType, tone: 'muted' };
  }
}

// ── Spell display helpers ─────────────────────────────────────────────────────

export function spellLevelLabel(level: number): string {
  return level === 0 ? 'Cantrip' : `Level ${level}`;
}

export function spellComponentsLabel(d: CatalogSpellData): string {
  const c = d.components ?? {};
  const parts: string[] = [];
  if (c.V) parts.push('V');
  if (c.S) parts.push('S');
  if (c.M) parts.push('M');
  return parts.length ? parts.join(', ') : '—';
}

/** TAV spell-picker description helper — mirrors CodexDetail's SpellDetail
 *  inline fallback so the wizard's Spells step and the read-only Codex show
 *  identical copy for a spell with no catalog description recorded. */
export function spellDescription(d: CatalogSpellData): string {
  return d.description && d.description.trim().length > 0
    ? d.description
    : 'No description recorded for this spell yet.';
}

// ── Monster display helpers ────────────────────────────────────────────────────

/**
 * Shared by monsterSpeedLabel and raceSpeedLabel below — formats a compound
 * `{walk, swim, fly, burrow, climb, hover}`-shaped speed object, e.g.
 * "30 ft., fly 60 ft." or "swim 40 ft., 10 ft." for an Aboleth.
 */
function speedEntriesLabel(speed: Partial<Record<string, number>>): string {
  const parts = Object.entries(speed)
    .filter(([, v]) => typeof v === 'number' && v > 0)
    .map(([k, v]) => (k === 'walk' ? `${v} ft.` : `${k} ${v} ft.`));
  return parts.length ? parts.join(', ') : '—';
}

export function monsterSpeedLabel(d: CatalogMonsterData): string {
  return speedEntriesLabel(d.speed ?? {});
}

/**
 * Formats a race's speed value for display ("30 ft.", or '—' when absent).
 *
 * DDX21-1: deliberately typed to accept `unknown`, not just
 * `CatalogRaceData['speed']` (a plain `number`). Root cause of the /codex
 * route crash ("Objects are not valid as a React child (found: object with
 * keys {swim, walk})"): CodexRow/CodexDetail render whichever kind is
 * currently active, but useCodexCatalog's `items` state is only ever updated
 * by a passive effect — for one render right after a kind-tab switch,
 * `activeKind` has already flipped (e.g. to 'race') while `items`/`selected`
 * still belong to the PREVIOUS kind. If that previous kind was 'monster',
 * its item's `speed` is a compound object (`{walk, swim, ...}`), not the
 * plain number `CatalogRaceData['speed']` is typed as — and the race render
 * path used to hand that value straight to JSX as a raw child. This always
 * reduces the value to a string first, so React can never be asked to render
 * a raw object: a number formats as "N ft.", an object falls back to the
 * same compound formatter the monster stat block uses, anything else is '—'.
 */
export function raceSpeedLabel(speed: unknown): string {
  if (typeof speed === 'number') return `${speed} ft.`;
  if (speed && typeof speed === 'object') return speedEntriesLabel(speed as Partial<Record<string, number>>);
  return '—';
}

export function monsterSensesLabel(d: CatalogMonsterData): string {
  const senses = d.senses ?? {};
  const parts = Object.entries(senses)
    .filter(([, v]) => typeof v === 'number')
    .map(([k, v]) => `${k.replace(/_/g, ' ')} ${v}`);
  return parts.length ? parts.join(', ') : '—';
}

export function monsterCrLabel(cr: number | string | undefined): string {
  if (cr === undefined || cr === null) return '—';
  if (cr === 0.125) return '1/8';
  if (cr === 0.25) return '1/4';
  if (cr === 0.5) return '1/2';
  return String(cr);
}

export function monsterActionLine(a: CatalogMonsterAction): string {
  const bits: string[] = [];
  if (a.attack_bonus != null) bits.push(`+${a.attack_bonus} to hit`);
  if (a.damage_dice) bits.push(`${a.damage_dice}${a.damage_type ? ` ${a.damage_type}` : ''}`);
  const suffix = bits.length ? ` (${bits.join(' · ')})` : '';
  return `${a.name}${suffix}`;
}

export function monsterActionDescription(a: CatalogMonsterAction): string {
  return a.description ?? a.desc ?? '';
}

// ── Item (equipment) display helpers ──────────────────────────────────────────

export function itemCostLabel(d: CatalogEquipmentData): string {
  if (d.cost_gp == null) return '—';
  return `${d.cost_gp} gp`;
}

export function itemWeightLabel(d: CatalogEquipmentData): string {
  if (d.weight == null) return '—';
  return `${d.weight} lb.`;
}

export function itemDescription(d: CatalogEquipmentData): string {
  return d.description && d.description.trim().length > 0
    ? d.description
    : 'No description recorded for this item in the catalog yet.';
}

// ── Condition display helpers ─────────────────────────────────────────────────

export function conditionHasData(d: CatalogConditionData): boolean {
  return Object.keys(d ?? {}).length > 0;
}

// ── Generic ────────────────────────────────────────────────────────────────────

/** Case-insensitive substring match against a catalog item's name. */
export function matchesSearch(item: CatalogItem, query: string): boolean {
  if (!query.trim()) return true;
  return item.name.toLowerCase().includes(query.trim().toLowerCase());
}
