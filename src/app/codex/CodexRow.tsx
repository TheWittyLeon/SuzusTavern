// src/app/codex/CodexRow.tsx
//
// DDX-21 — a single result row in the Codex listbox. Kind-aware meta chips
// (level/school for spells, CR/AC/HP for monsters, etc.) so a player can scan
// the list without opening the detail drawer for the common questions.

import Icon from '@/components/Icon';
import Pill from '@/components/Pill';
import type {
  CatalogBackgroundData,
  CatalogClassData,
  CatalogEquipmentData,
  CatalogFeatData,
  CatalogItem,
  CatalogMonsterData,
  CatalogNpcData,
  CatalogRaceData,
  CatalogSpellData,
  CatalogSubclassData,
} from '@/lib/api/types';
import {
  CODEX_KIND_META,
  adventureLengthLabel,
  adventureLevelRangeLabel,
  adventureSummary,
  itemCostLabel,
  monsterCrLabel,
  raceSpeedLabel,
  sourceBadge,
  spellLevelLabel,
  toneVar,
  type CodexKind,
} from '@/lib/dnd/codex';
import styles from './Codex.module.css';

// Kage-CR #13/#14: reuse the canonical types from lib/api/types.ts instead
// of a locally-declared narrower shape.

function RowMeta({ kind, item }: { kind: CodexKind; item: CatalogItem }) {
  if (kind === 'spell') {
    const d = item.data as CatalogSpellData;
    return (
      <span className={styles.rowMeta}>
        <span className={`${styles.metaChip} ${styles.metaChipMono}`}>{spellLevelLabel(d.level)}</span>
        {d.school && <span className={styles.metaChip}>{d.school}</span>}
        {d.casting_time && <span className={`${styles.metaChip} ${styles.metaChipMono}`}>{d.casting_time}</span>}
        {d.concentration && <span className={`${styles.metaChip} ${styles.metaChipMono}`}>conc.</span>}
      </span>
    );
  }
  if (kind === 'monster') {
    const d = item.data as CatalogMonsterData;
    return (
      <span className={styles.rowMeta}>
        <span className={`${styles.metaChip} ${styles.metaChipMono}`}>CR {monsterCrLabel(d.cr)}</span>
        {d.monster_type && <span className={styles.metaChip}>{d.monster_type}</span>}
        {d.ac != null && <span className={`${styles.metaChip} ${styles.metaChipMono}`}>AC {d.ac}</span>}
      </span>
    );
  }
  if (kind === 'item') {
    const d = item.data as CatalogEquipmentData;
    return (
      <span className={styles.rowMeta}>
        {d.item_type && <span className={styles.metaChip}>{d.item_type}</span>}
        <span className={`${styles.metaChip} ${styles.metaChipMono}`}>{itemCostLabel(d)}</span>
        {d.requires_attunement && <span className={styles.metaChip}>attune</span>}
      </span>
    );
  }
  if (kind === 'race') {
    const d = item.data as CatalogRaceData;
    return (
      <span className={styles.rowMeta}>
        {d.size && <span className={styles.metaChip}>{d.size}</span>}
        {/* DDX21-1: raceSpeedLabel, not a raw `{d.speed}` child — see
            codex.ts's doc comment for why this exact field crashed the whole
            /codex route during a kind-tab switch (a stale monster's
            *compound* speed object rendered under this 'race' path). */}
        {d.speed != null && (
          <span className={`${styles.metaChip} ${styles.metaChipMono}`}>{raceSpeedLabel(d.speed)}</span>
        )}
      </span>
    );
  }
  if (kind === 'class') {
    const d = item.data as CatalogClassData;
    return (
      <span className={styles.rowMeta}>
        <span className={`${styles.metaChip} ${styles.metaChipMono}`}>d{d.hit_die}</span>
        {d.spellcasting_ability && <span className={styles.metaChip}>{d.spellcasting_ability} caster</span>}
      </span>
    );
  }
  if (kind === 'background') {
    const d = item.data as CatalogBackgroundData;
    return (
      <span className={styles.rowMeta}>
        {(d.skills ?? []).slice(0, 2).map((s) => (
          <span key={s} className={styles.metaChip}>
            {s.replace(/_/g, ' ')}
          </span>
        ))}
      </span>
    );
  }
  // TAV-CODEX-SOURCE-PICKER-NPC (D4/Aoi-UI §2): role as a plain metaChip;
  // affiliation as an inline Pill — ONE flat tone for every affiliation
  // (no per-faction hashing/color-coding scheme), rank cue monospaced.
  if (kind === 'npc') {
    const d = item.data as CatalogNpcData;
    return (
      <span className={styles.rowMeta}>
        {d.role && <span className={styles.metaChip}>{d.role}</span>}
        {d.affiliation && <Pill tone="cool">{d.affiliation}</Pill>}
        {d.rank_cue && <span className={`${styles.metaChip} ${styles.metaChipMono}`}>{d.rank_cue}</span>}
      </span>
    );
  }
  if (kind === 'feat') {
    const d = item.data as CatalogFeatData;
    return (
      <span className={styles.rowMeta}>
        {d.prerequisite && <span className={styles.metaChip}>{d.prerequisite}</span>}
      </span>
    );
  }
  if (kind === 'subclass') {
    const d = item.data as CatalogSubclassData;
    return (
      <span className={styles.rowMeta}>
        {d.parent_class && <span className={styles.metaChip}>{d.parent_class}</span>}
      </span>
    );
  }
  if (kind === 'adventure') {
    // FR-6/FR-22: the engine's adventure row carries `summary` at the TOP
    // LEVEL, not under `.data` — see codex.ts's adventureSummary() doc
    // comment. No scene count exists on the wire (confirmed by Sora-Arch's
    // design — the allowlist is subtitle/level_range/length/content_rating/
    // tags only); `length` fills the second chip instead.
    const s = adventureSummary(item);
    return (
      <span className={styles.rowMeta}>
        <span className={`${styles.metaChip} ${styles.metaChipMono}`}>{adventureLevelRangeLabel(s.level_range)}</span>
        {s.length && <span className={styles.metaChip}>{adventureLengthLabel(s.length)}</span>}
      </span>
    );
  }
  return null;
}

export interface CodexRowProps {
  item: CatalogItem;
  kind: CodexKind;
  selected: boolean;
  focused: boolean;
  optionId: string;
  onSelect: () => void;
}

export default function CodexRow({ item, kind, selected, focused, optionId, onSelect }: CodexRowProps) {
  const meta = CODEX_KIND_META[kind];
  const badge = sourceBadge(item.source_type);
  const rowClass = [
    styles.row,
    selected ? styles.rowOn : '',
    focused ? styles.rowFocused : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      id={optionId}
      role="option"
      aria-selected={selected}
      className={rowClass}
      style={{ ['--tone' as string]: toneVar(meta.tone) }}
      onClick={onSelect}
    >
      <div className={styles.rowSpine}>
        <Icon name={meta.icon} size={18} />
      </div>
      <div className={styles.rowBody}>
        <div className={styles.rowHead}>
          {/* Not a heading: role="option" text content is a list item, not a
              page section — matches the /modules precedent of keeping list
              chrome out of the heading outline (only the drawer's selected
              entry becomes an <h2>, mirrored in CodexDetail). */}
          <span className={styles.rowName}>{item.name}</span>
          {/* Never a color-only selected signal: a checkmark icon + text label
              back the tone/border change (Iro — no color-only signals). */}
          {selected && (
            <span className={`${styles.metaChip} ${styles.metaChipMono}`}>
              <Icon name="Check" size={11} aria-hidden /> selected
            </span>
          )}
          <RowMeta kind={kind} item={item} />
        </div>
      </div>
      <div className={styles.rowSelected}>
        <Pill tone={badge.tone}>{badge.label}</Pill>
      </div>
    </div>
  );
}
