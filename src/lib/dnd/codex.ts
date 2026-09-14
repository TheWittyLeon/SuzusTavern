// src/lib/dnd/codex.ts
//
// DDX-21 — display helpers for the /codex compendium. Thin, pure functions
// that turn raw CatalogItem rows (GET /api/dnd/catalog) into strings the
// list rows and detail panels render. No React here — see useCodexCatalog.ts
// for the fetching hook and app/codex/page.tsx for the UI.

import type { IconName } from '@/components/Icon';
import type { PillTone } from '@/components/Pill';
import type {
  AdventureSummary,
  CatalogConditionData,
  CatalogEquipmentData,
  CatalogItem,
  CatalogMonsterAction,
  CatalogMonsterData,
  CatalogSpellData,
  ContentPack,
} from '@/lib/api/types';

// ── Content types shown in the Codex ─────────────────────────────────────────

export type CodexKind =
  | 'spell'
  | 'monster'
  | 'item'
  | 'race'
  | 'class'
  | 'background'
  | 'condition'
  // TAV-CODEX-SOURCE-PICKER-NPC (D6/FR-15) — four new rail kinds.
  | 'npc'
  | 'feat'
  | 'subclass'
  | 'adventure';

/**
 * TAV-CODEX-SOURCE-PICKER-NPC — the codex's single-select source filter.
 * `undefined` (or an empty string) means "All sources" — no `pack` query
 * param sent. A specific value is a `pack_id` from GET /catalog/packs,
 * validated server-side (never trusted client-side beyond "does this appear
 * in the packs list I was just given" — see usePacksList.ts / page.tsx).
 * Client-only concept — not part of the wire contract (Sora-Arch's `pack` is
 * the wire param name; this is what the UI carries between the picker, the
 * URL, and useCodexCatalog).
 */
export type CodexSource = string | undefined;

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

// Order here is the tab order. TAV-CODEX-SOURCE-PICKER-NPC (Aoi-UI §Rail,
// coordinator-confirmed 2026-09-06): Classes, Subclasses, Races,
// Backgrounds, Feats, Spells, Items, Conditions, Monsters, NPCs, Adventures
// — a visible reorder of the original 7 (Class 5th->1st, Spell 1st->6th,
// Monster 2nd->9th). The DEFAULT landing kind is a separate concern (page.tsx
// `useState<CodexKind>('spell')`) and stays Spells per the coordinator's
// ruling — this array only controls rail position/Home-End endpoints, not
// which tab is active on load.
//
// Tone reuse, not new hues (Aoi §Changed #2): Subclasses reuses `accent`
// (pairs with Classes — parent/child read); NPCs reuses `cool` (pairs with
// Races — both "people" kinds). Both tones are already Iro-audited; a new
// hue would need a fresh 4-vibe contrast pass.
export const CODEX_KINDS: CodexKindMeta[] = [
  { kind: 'class', label: 'Classes', noun: 'class', nounPlural: 'classes', icon: 'Sword', tone: 'accent' },
  { kind: 'subclass', label: 'Subclasses', noun: 'subclass', nounPlural: 'subclasses', icon: 'Quill', tone: 'accent' },
  { kind: 'race', label: 'Races', noun: 'race', nounPlural: 'races', icon: 'Users', tone: 'cool' },
  { kind: 'background', label: 'Backgrounds', noun: 'background', nounPlural: 'backgrounds', icon: 'Scroll', tone: 'crit' },
  { kind: 'feat', label: 'Feats', noun: 'feat', nounPlural: 'feats', icon: 'Crit', tone: 'good' },
  { kind: 'spell', label: 'Spells', noun: 'spell', nounPlural: 'spells', icon: 'Magic', tone: 'lav' },
  { kind: 'item', label: 'Items', noun: 'item', nounPlural: 'items', icon: 'Potion', tone: 'warm' },
  { kind: 'condition', label: 'Conditions', noun: 'condition', nounPlural: 'conditions', icon: 'Sparkle', tone: 'warn' },
  { kind: 'monster', label: 'Monsters', noun: 'monster', nounPlural: 'monsters', icon: 'Skull', tone: 'bad' },
  { kind: 'npc', label: 'NPCs', noun: 'NPC', nounPlural: 'NPCs', icon: 'Crown', tone: 'cool' },
  { kind: 'adventure', label: 'Adventures', noun: 'adventure', nounPlural: 'adventures', icon: 'Map', tone: 'muted' },
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

// ── Adventure display helpers (TAV-CODEX-SOURCE-PICKER-NPC) ──────────────────
//
// FR-6/FR-22 + Sora-Arch A5: the engine's adventure projection is an
// allowlist-by-construction jsonb_build_object over exactly {subtitle,
// level_range, length, content_rating, tags} — no scenes, no
// gm_description, ever. Mirrors src/app/modules/page.tsx's toCatalogItem():
// the engine puts this `summary` block at the TOP LEVEL of the catalog row,
// not nested under `.data` (CatalogItem['data'] predates the adventure kind
// — see that file's comment). Reading it any other way silently renders
// nothing; this is the one place that shape is decoded for the codex.

/** Extracts the allowlisted adventure summary from a raw catalog row (adventure
 *  content_type). Never reads `scenes`/`gm_description` even if a
 *  maliciously/accidentally over-stuffed payload carried them (FR-22). */
export function adventureSummary(item: CatalogItem): AdventureSummary {
  const raw = item as unknown as Record<string, unknown>;
  const summary = (raw['summary'] as Record<string, unknown> | undefined) ?? {};
  return {
    subtitle: summary['subtitle'] as string | undefined,
    level_range: summary['level_range'] as { min: number; max: number } | undefined,
    length: summary['length'] as string | undefined,
    content_rating: summary['content_rating'] as string | undefined,
    tags: summary['tags'] as string[] | undefined,
  };
}

export function adventureLevelRangeLabel(lr?: { min: number; max: number }): string {
  if (!lr) return '—';
  if (lr.min === lr.max) return `Lv ${lr.min}`;
  return `Lv ${lr.min}–${lr.max}`;
}

export function adventureLengthLabel(len?: string): string {
  if (!len) return '—';
  return len.replace(/_/g, ' ');
}

// ── Source picker grouping (TAV-CODEX-SOURCE-PICKER-NPC, D2/FR-12) ───────────

export interface GroupedPacks {
  /** kind='srd' packs — rendered flat (Aoi assumes exactly one). */
  srd: ContentPack[];
  /** kind='nekonova' packs — rendered flat (Aoi assumes exactly one). */
  suzu: ContentPack[];
  /** kind='homebrew' packs — rendered under a "Homebrew" group heading, alphabetical. */
  homebrew: ContentPack[];
  /** Anything else (kind='licensed' or a future kind) — not in Aoi's
   *  spec'd groups, but a generic catalog feature must not silently drop a
   *  visible pack the actor is entitled to. Grouped under "Other", alphabetical. */
  other: ContentPack[];
}

function byDisplayName(a: ContentPack, b: ContentPack): number {
  return a.display_name.localeCompare(b.display_name);
}

/** Buckets the packs-list response into the picker's display groups
 *  (All sources / SRD / Suzu's / Homebrew, in that order — D2). */
export function groupPacksBySource(packs: ContentPack[]): GroupedPacks {
  const grouped: GroupedPacks = { srd: [], suzu: [], homebrew: [], other: [] };
  for (const p of packs) {
    if (p.kind === 'srd') grouped.srd.push(p);
    else if (p.kind === 'nekonova') grouped.suzu.push(p);
    else if (p.kind === 'homebrew') grouped.homebrew.push(p);
    else grouped.other.push(p);
  }
  grouped.homebrew.sort(byDisplayName);
  grouped.other.sort(byDisplayName);
  return grouped;
}
