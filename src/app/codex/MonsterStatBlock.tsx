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

export function Section({
  label,
  children,
  level = 3,
}: {
  label: string;
  children: ReactNode;
  /**
   * MINOR-1 (Iro-A11y, TAV-CODEX-SOURCE-PICKER-NPC): the NPC drawer nests a
   * full MonsterDetail (itself built from `Section`s) inside its OWN
   * "Stat block" `Section` — without this, the embedded "Ability scores"/
   * "Senses"/etc. headings render as h3 SIBLINGS of the NPC's own h3s
   * instead of properly nesting one level deeper. Defaults to 3 (unchanged
   * for every existing call site); NpcDetail passes 4 to the embedded
   * `<MonsterDetail level={4} />` only.
   */
  level?: 3 | 4;
}) {
  const HeadingTag = level === 4 ? 'h4' : 'h3';
  return (
    <div className={styles.section}>
      {/* A11Y (MINOR-1, Iro): was a <div> — not in the heading outline, so SR
          users couldn't jump between sections. h3 nests under the hero's h2
          in document order (see Codex.module.css .sectionLabel for the
          margin reset this needed). */}
      <HeadingTag className={`label ${styles.sectionLabel}`}>{label}</HeadingTag>
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
  /** The raw `dm_only` object key (e.g. "hidden_truth") — used as the React
   *  list key (Kage-CR #20): two different raw keys could in principle
   *  humanize to the same display label, which the label alone can't
   *  disambiguate. */
  key: string;
  label: string;
  value: string;
}

/**
 * Converts a `dm_only` record into the labeled fact rows `DmOnlyDisclosure`
 * renders. Returns `[]` for `undefined` input, AND for a present-but-empty
 * (or fully-suppressed) object — `DmOnlyDisclosure` treats both identically:
 * an empty `fields` array renders nothing (Kage-CR #12: this is the code's
 * actual behavior; an earlier draft of this comment claimed callers must
 * separately gate on `dm_only`'s presence to distinguish "absent" from
 * "present but empty", which the code never implemented. Given the choice,
 * fail toward showing LESS — a genuinely-owner-visible-but-empty `dm_only`
 * object is a real if unlikely wire shape (Sora-Arch §4.2), and rendering an
 * empty disclosure shell for it would be a worse outcome than rendering
 * nothing: FR-18's actual requirement is "never a placeholder hinting a
 * hidden field exists", and a disclosure with zero rows inside it reads
 * exactly like that placeholder to a non-owner who can't tell the
 * difference from CSS/DOM alone).
 */
export function dmOnlyFields(dmOnly: DmOnly | undefined): DmOnlyFieldRow[] {
  if (!dmOnly) return [];
  return Object.entries(dmOnly)
    .filter(([key]) => !DM_ONLY_SUPPRESSED_KEYS.has(key))
    .map(([key, value]) => ({ key, label: humanizeKey(key), value: humanizeValue(value) }));
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
            <div key={f.key} className={styles.dmOnlyRow}>
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

export function MonsterDetail({
  d,
  level = 3,
}: {
  d: CatalogMonsterData;
  /** MINOR-1 (Iro-A11y): forwarded to every internal `Section` — 4 when
   *  embedded inside NpcDetail's own "Stat block" Section, 3 (default,
   *  unchanged) on the standalone Monster tab. */
  level?: 3 | 4;
}) {
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
      <Section label="Ability scores" level={level}>
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
      <Section label="Senses" level={level}>
        <p>{monsterSensesLabel(d)}</p>
      </Section>
      {d.languages && d.languages.length > 0 && (
        <Section label="Languages" level={level}>
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
          <Section key={label as string} label={label as string} level={level}>
            <p>{(list as string[]).join(', ')}</p>
          </Section>
        ))}
      {d.actions && d.actions.length > 0 && (
        <Section label="Actions" level={level}>
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
        <Section label="Legendary actions" level={level}>
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
