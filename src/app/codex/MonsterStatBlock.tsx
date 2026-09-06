// src/app/codex/MonsterStatBlock.tsx
//
// TAV-CODEX-SOURCE-PICKER-NPC (Aoi-UI §Component list) — `Section`,
// `StatsGrid`, `ABILITY_ORDER` and `MonsterDetail` extracted out of
// CodexDetail.tsx so the standalone Monster tab AND the NPC drawer's
// client-side-joined stat block (Sora-Arch §5) share exactly one renderer —
// and, with it, exactly one DM-only-tactics disclosure (Aoi-UI §Changed #3:
// the brief's "monster mechanics stay visible, only tactics goes owner-only"
// assumption applies to the standalone tab too, not just NPC's embedded
// block).
//
// `DmOnlyDisclosure` is co-located here (Aoi-UI's plan) and reused by both
// MonsterDetail's own `dm_only.tactics`/`dm_only.hidden_truth` and
// CodexDetail.tsx's NpcDetail for the NPC's own `dm_only` fields — two
// independent disclosures can coexist on one NPC page (FR-18), each
// collapsed by default, each toggled independently.

import { useId, useState, type ReactNode } from 'react';
import Icon from '@/components/Icon';
import Button from '@/components/Button';
import { formatMod } from '@/lib/dnd/helpers';
import type { CatalogMonsterData, DmOnly } from '@/lib/api/types';
import { monsterActionDescription, monsterActionLine, monsterCrLabel, monsterSensesLabel, monsterSpeedLabel } from '@/lib/dnd/codex';
import styles from './Codex.module.css';

export interface Stat {
  k: string;
  v: string;
}

export function StatsGrid({ stats }: { stats: Stat[] }) {
  if (stats.length === 0) return null;
  return (
    <div className={styles.statsGrid}>
      {stats.map((s) => (
        <div key={s.k} className={styles.stat}>
          <div className={styles.statK}>{s.k}</div>
          <div className={styles.statV}>{s.v}</div>
        </div>
      ))}
    </div>
  );
}

export function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={styles.section}>
      {/* A11Y (MINOR-1, Iro): was a <div> — not in the heading outline, so SR
          users couldn't jump between sections. h3 nests under the hero's h2
          in document order (see Codex.module.css .sectionLabel for the
          margin reset this needed). */}
      <h3 className={`label ${styles.sectionLabel}`}>{label}</h3>
      {children}
    </div>
  );
}

export const ABILITY_ORDER: { key: string; abbr: string }[] = [
  { key: 'strength', abbr: 'STR' },
  { key: 'dexterity', abbr: 'DEX' },
  { key: 'constitution', abbr: 'CON' },
  { key: 'intelligence', abbr: 'INT' },
  { key: 'wisdom', abbr: 'WIS' },
  { key: 'charisma', abbr: 'CHA' },
];

// ── DM-only disclosure (TAV-CODEX-SOURCE-PICKER-NPC, FR-18/A11Y-4) ──────────

/** "hidden_truth" -> "Hidden Truth", "dark_intensity_floor" -> "Dark Intensity Floor". */
function humanizeKey(key: string): string {
  return key
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function humanizeValue(value: unknown): string {
  if (value == null) return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) return value.length > 0 ? value.map((v) => humanizeValue(v)).join(', ') : '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/**
 * Keys never worth a DM's screen space — internal bookkeeping, not narrative
 * or tactical content. Everything else in a `dm_only` object renders
 * generically (Sora-Arch §4.2: the complement is open-ended by design — a
 * future authored field must show up here, not silently vanish).
 */
const DM_ONLY_SUPPRESSED_KEYS = new Set(['shape_version']);

export interface DmOnlyFieldRow {
  label: string;
  value: string;
}

/** Converts a `dm_only` record into the labeled fact rows `DmOnlyDisclosure`
 *  renders. Returns `[]` for `undefined`/empty input — callers must still
 *  gate on the SOURCE object's presence (not this function's output length)
 *  before deciding whether to render a disclosure at all: FR-18 requires the
 *  block to be absent from the DOM when `dm_only` itself is absent, not
 *  merely "has nothing to show" (an owner-only object that happens to be
 *  `{}` is a real, if unlikely, wire shape and still marks the row as
 *  owner-visible). */
export function dmOnlyFields(dmOnly: DmOnly | undefined): DmOnlyFieldRow[] {
  if (!dmOnly) return [];
  return Object.entries(dmOnly)
    .filter(([key]) => !DM_ONLY_SUPPRESSED_KEYS.has(key))
    .map(([key, value]) => ({ label: humanizeKey(key), value: humanizeValue(value) }));
}

export interface DmOnlyDisclosureProps {
  fields: DmOnlyFieldRow[];
}

/**
 * Collapsed-by-default disclosure for owner/admin-only content (FR-18).
 * Content is UNMOUNTED while closed (not `display:none`) — defense in depth
 * against a stale non-owner reference ever reading it, per Aoi-UI §3.
 * Visual treatment (dashed border + --warn tone + EyeOff icon) lives in
 * Codex.module.css's `.dmOnly*` classes — never color/icon alone (A11Y-4):
 * the trigger's own text states "DM only — never read aloud".
 */
export function DmOnlyDisclosure({ fields }: DmOnlyDisclosureProps) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  if (fields.length === 0) return null;

  return (
    <div className={styles.dmOnly}>
      <Button
        type="button"
        variant="ghost"
        className={styles.dmOnlyTrigger}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name="EyeOff" size={14} aria-hidden />
        DM only — never read aloud ({fields.length})
      </Button>
      {open && (
        <dl id={panelId} className={styles.dmOnlyPanel}>
          {fields.map((f) => (
            <div key={f.label} className={styles.dmOnlyRow}>
              <dt>{f.label}</dt>
              <dd>{f.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

// ── Monster stat block (shared: standalone Monster tab + NPC's embedded block) ──

export function MonsterDetail({ d }: { d: CatalogMonsterData }) {
  const scores = d.ability_scores ?? {};
  return (
    <>
      <StatsGrid
        stats={[
          { k: 'AC', v: `${d.ac ?? '—'}${d.ac_note ? ` (${d.ac_note})` : ''}` },
          { k: 'HP', v: d.hp_formula ?? '—' },
          { k: 'CR', v: `${monsterCrLabel(d.cr)}${d.xp != null ? ` (${d.xp} XP)` : ''}` },
          { k: 'Speed', v: monsterSpeedLabel(d) },
        ]}
      />
      <StatsGrid
        stats={[
          { k: 'Type', v: `${d.size ?? ''} ${d.monster_type ?? ''}`.trim() || '—' },
          { k: 'Alignment', v: d.alignment ?? '—' },
        ]}
      />
      <Section label="Ability scores">
        <div className={styles.statsGrid}>
          {ABILITY_ORDER.filter(({ key }) => scores[key] != null).map(({ key, abbr }) => (
            <div key={key} className={styles.stat}>
              <div className={styles.statK}>{abbr}</div>
              <div className={styles.statV}>
                {scores[key]} ({formatMod(scores[key] as number)})
              </div>
            </div>
          ))}
        </div>
      </Section>
      <Section label="Senses">
        <p>{monsterSensesLabel(d)}</p>
      </Section>
      {d.languages && d.languages.length > 0 && (
        <Section label="Languages">
          <p>{d.languages.join(', ')}</p>
        </Section>
      )}
      {[
        ['Damage resistances', d.damage_resistances],
        ['Damage immunities', d.damage_immunities],
        ['Condition immunities', d.condition_immunities],
      ]
        .filter(([, list]) => Array.isArray(list) && (list as string[]).length > 0)
        .map(([label, list]) => (
          <Section key={label as string} label={label as string}>
            <p>{(list as string[]).join(', ')}</p>
          </Section>
        ))}
      {d.actions && d.actions.length > 0 && (
        <Section label="Actions">
          {d.actions.map((a, i) => (
            <div key={`${a.name}-${i}`} className={styles.actionRow}>
              <p className={styles.actionName}>{monsterActionLine(a)}</p>
              {monsterActionDescription(a) && (
                <p className={styles.actionDesc}>{monsterActionDescription(a)}</p>
              )}
            </div>
          ))}
        </Section>
      )}
      {d.legendary_actions && d.legendary_actions.length > 0 && (
        <Section label="Legendary actions">
          {d.legendary_actions.map((a, i) => (
            <div key={`${a.name}-${i}`} className={styles.actionRow}>
              <p className={styles.actionName}>{a.name}</p>
              {monsterActionDescription(a) && (
                <p className={styles.actionDesc}>{monsterActionDescription(a)}</p>
              )}
            </div>
          ))}
        </Section>
      )}
      {/* TAV-CODEX-SOURCE-PICKER-NPC (FR-5/FR-18): `tactics` + `hidden_truth`
          are the only fields ever moved off the public mechanical block —
          absent entirely for a non-owner/non-admin reader (SEC-1). */}
      <DmOnlyDisclosure fields={dmOnlyFields(d.dm_only)} />
    </>
  );
}
