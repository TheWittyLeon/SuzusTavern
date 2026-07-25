// src/app/codex/CodexDetail.tsx
//
// DDX-21 — the Codex's right-hand detail drawer. One component per content
// kind, all reading straight off the raw CatalogItem['data'] shape the engine
// returns (see the CatalogXData types added in lib/api/types.ts) — no extra
// adapter layer, since (unlike the character wizard) the Codex is a read-only
// reference view of exactly what the engine has on file.

import type { ReactNode } from 'react';
import Icon from '@/components/Icon';
import Pill from '@/components/Pill';
import { formatMod } from '@/lib/dnd/helpers';
import type {
  CatalogBackgroundData,
  CatalogClassData,
  CatalogConditionData,
  CatalogEquipmentData,
  CatalogItem,
  CatalogMonsterData,
  CatalogRaceData,
  CatalogSpellData,
} from '@/lib/api/types';
import {
  CODEX_KIND_META,
  conditionHasData,
  itemCostLabel,
  itemDescription,
  itemWeightLabel,
  monsterActionDescription,
  monsterActionLine,
  monsterCrLabel,
  monsterSensesLabel,
  monsterSpeedLabel,
  raceSpeedLabel,
  sourceBadge,
  spellComponentsLabel,
  spellDescription,
  spellLevelLabel,
  toneVar,
  type CodexKind,
} from '@/lib/dnd/codex';
import styles from './Codex.module.css';

interface Stat {
  k: string;
  v: string;
}

function StatsGrid({ stats }: { stats: Stat[] }) {
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

function Section({ label, children }: { label: string; children: ReactNode }) {
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

const ABILITY_ORDER: { key: string; abbr: string }[] = [
  { key: 'strength', abbr: 'STR' },
  { key: 'dexterity', abbr: 'DEX' },
  { key: 'constitution', abbr: 'CON' },
  { key: 'intelligence', abbr: 'INT' },
  { key: 'wisdom', abbr: 'WIS' },
  { key: 'charisma', abbr: 'CHA' },
];

function SpellDetail({ d }: { d: CatalogSpellData }) {
  return (
    <>
      <StatsGrid
        stats={[
          { k: 'Level', v: spellLevelLabel(d.level) },
          { k: 'School', v: d.school ?? '—' },
          { k: 'Casting time', v: d.casting_time ?? '—' },
          { k: 'Range', v: d.range ?? '—' },
        ]}
      />
      <StatsGrid
        stats={[
          { k: 'Components', v: spellComponentsLabel(d) },
          { k: 'Duration', v: `${d.duration ?? '—'}${d.concentration ? ' (concentration)' : ''}` },
        ]}
      />
      {d.classes && d.classes.length > 0 && (
        <Section label="Classes">
          <div className={styles.tagList}>
            {d.classes.map((c) => (
              <Pill key={c} tone="muted">
                {c}
              </Pill>
            ))}
          </div>
        </Section>
      )}
      <Section label="Description">
        <p>{spellDescription(d)}</p>
      </Section>
      {d.higher_levels && (
        <Section label="At higher levels">
          <p>{d.higher_levels}</p>
        </Section>
      )}
    </>
  );
}

function MonsterDetail({ d }: { d: CatalogMonsterData }) {
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
    </>
  );
}

function ItemDetail({ d }: { d: CatalogEquipmentData }) {
  return (
    <>
      <StatsGrid
        stats={[
          { k: 'Type', v: d.item_type ?? '—' },
          { k: 'Cost', v: itemCostLabel(d) },
          { k: 'Weight', v: itemWeightLabel(d) },
          { k: 'Attunement', v: d.requires_attunement ? 'required' : 'not required' },
        ]}
      />
      {(d.damage_dice || d.ac_base != null) && (
        <StatsGrid
          stats={[
            ...(d.damage_dice ? [{ k: 'Damage', v: `${d.damage_dice}${d.damage_type ? ` ${d.damage_type}` : ''}` }] : []),
            ...(d.ac_base != null ? [{ k: 'AC', v: String(d.ac_base) }] : []),
          ]}
        />
      )}
      {d.properties && d.properties.length > 0 && (
        <Section label="Properties">
          <div className={styles.tagList}>
            {d.properties.map((p) => (
              <Pill key={p} tone="muted">
                {p}
              </Pill>
            ))}
          </div>
        </Section>
      )}
      <Section label="Description">
        <p>{itemDescription(d)}</p>
      </Section>
    </>
  );
}

function RaceDetail({ d }: { d: CatalogRaceData }) {
  const bonuses = Object.entries(d.ability_bonus ?? {}).filter(([, v]) => v);
  return (
    <>
      <StatsGrid
        stats={[
          { k: 'Size', v: d.size ?? '—' },
          // DDX21-1: raceSpeedLabel guards against `d.speed` unexpectedly
          // being a monster's compound speed OBJECT (see codex.ts) — a plain
          // template literal here wouldn't crash (it stringifies to
          // "[object Object] ft." instead), but this keeps every "speed"
          // render site on the one formatter rather than two different
          // half-safe patterns.
          { k: 'Speed', v: raceSpeedLabel(d.speed) },
        ]}
      />
      {bonuses.length > 0 && (
        <Section label="Ability bonuses">
          <div className={styles.tagList}>
            {bonuses.map(([k, v]) => (
              <Pill key={k} tone="muted">
                +{v} {k.slice(0, 3).toUpperCase()}
              </Pill>
            ))}
          </div>
        </Section>
      )}
      {d.traits && d.traits.length > 0 && (
        <Section label="Traits">
          <div className={styles.tagList}>
            {d.traits.map((t) => (
              <Pill key={t} tone="muted">
                {t}
              </Pill>
            ))}
          </div>
        </Section>
      )}
      {d.languages && d.languages.length > 0 && (
        <Section label="Languages">
          <p>{d.languages.join(', ')}</p>
        </Section>
      )}
      {d.proficiencies && d.proficiencies.length > 0 && (
        <Section label="Proficiencies">
          <p>{d.proficiencies.join(', ')}</p>
        </Section>
      )}
      {d.subraces && Object.keys(d.subraces).length > 0 && (
        <Section label="Subraces">
          {Object.entries(d.subraces).map(([name, sub]) => {
            const s = sub as { traits?: string[]; ability_bonus?: Record<string, number> };
            return (
              <div key={name} className={styles.subcard}>
                <p className={styles.subcardTitle}>{name}</p>
                {s.traits && s.traits.length > 0 && (
                  <p className={styles.actionDesc}>{s.traits.join(', ')}</p>
                )}
              </div>
            );
          })}
        </Section>
      )}
    </>
  );
}

function ClassDetail({ d }: { d: CatalogClassData }) {
  return (
    <>
      <StatsGrid
        stats={[
          // COSMETIC (Miko): d.hit_die is typed required but a malformed/
          // partial homebrew row can omit it — the template literal used to
          // stringify undefined to the literal text "dundefined". Guard it
          // the same way every other missing-field value in this file falls
          // back to an em dash.
          { k: 'Hit die', v: d.hit_die != null ? `d${d.hit_die}` : '—' },
          { k: 'Spellcasting', v: d.spellcasting_ability ?? 'none' },
        ]}
      />
      {d.saving_throws && d.saving_throws.length > 0 && (
        <Section label="Saving throw proficiencies">
          <p>{d.saving_throws.map((s) => s.slice(0, 3).toUpperCase()).join(', ')}</p>
        </Section>
      )}
      {d.primary_ability && d.primary_ability.length > 0 && (
        <Section label="Primary ability">
          <p>{d.primary_ability.join(', ')}</p>
        </Section>
      )}
      {(d.armor_proficiencies || d.weapon_proficiencies) && (
        <Section label="Proficiencies">
          <p>
            {[d.armor_proficiencies, d.weapon_proficiencies, d.tool_proficiencies]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </Section>
      )}
      {d.skill_choices && d.skill_choices.length > 0 && (
        <Section label={`Skill choices${d.skill_count ? ` (choose ${d.skill_count})` : ''}`}>
          <p>{d.skill_choices.map((s) => s.replace(/_/g, ' ')).join(', ')}</p>
        </Section>
      )}
      {d.level1_features && d.level1_features.length > 0 && (
        <Section label="Level 1 features">
          <div className={styles.tagList}>
            {d.level1_features.map((f) => (
              <Pill key={f} tone="muted">
                {f}
              </Pill>
            ))}
          </div>
        </Section>
      )}
    </>
  );
}

function BackgroundDetail({ d }: { d: CatalogBackgroundData }) {
  return (
    <Section label="Skill proficiencies">
      {d.skills && d.skills.length > 0 ? (
        <div className={styles.tagList}>
          {d.skills.map((s) => (
            <Pill key={s} tone="muted">
              {s.replace(/_/g, ' ')}
            </Pill>
          ))}
        </div>
      ) : (
        <p>No skill proficiencies recorded for this background yet.</p>
      )}
    </Section>
  );
}

function ConditionDetail({ d }: { d: CatalogConditionData }) {
  if (!conditionHasData(d)) {
    return (
      <Section label="Description">
        <p>
          The engine hasn&rsquo;t catalogued rules text for this condition yet — it exists as a
          named status effect but carries no structured mechanical data on this server.
        </p>
      </Section>
    );
  }
  // Forward-compat: if the engine starts populating condition data, surface it
  // as simple key/value text rather than silently dropping it.
  return (
    <Section label="Description">
      <p>{JSON.stringify(d)}</p>
    </Section>
  );
}

export interface CodexDetailProps {
  item: CatalogItem;
  kind: CodexKind;
  /**
   * Optional id applied to the hero <h2> so a wrapping dialog can label
   * itself via aria-labelledby (CRITICAL-1's narrow-viewport CodexDetailModal).
   * The always-visible desktop drawer doesn't pass this — it's labelled via
   * the <aside>'s own dynamic aria-label instead (MAJOR-6, page.tsx).
   */
  headingId?: string;
}

export default function CodexDetail({ item, kind, headingId }: CodexDetailProps) {
  const meta = CODEX_KIND_META[kind];
  const badge = sourceBadge(item.source_type);

  return (
    <div className={styles.detail}>
      <div className={styles.detailHero} style={{ ['--tone' as string]: toneVar(meta.tone) }}>
        <div className={styles.detailGlyph}>
          <Icon name={meta.icon} size={26} />
        </div>
        <div className={`${styles.detailKind} label`}>{meta.noun}</div>
        <h2 id={headingId} className={styles.detailTitle}>{item.name}</h2>
        <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
          <Pill tone={badge.tone}>{badge.label}</Pill>
        </div>
      </div>
      <div className={styles.detailBody}>
        {kind === 'spell' && <SpellDetail d={item.data as CatalogSpellData} />}
        {kind === 'monster' && <MonsterDetail d={item.data as CatalogMonsterData} />}
        {kind === 'item' && <ItemDetail d={item.data as CatalogEquipmentData} />}
        {kind === 'race' && <RaceDetail d={item.data as CatalogRaceData} />}
        {kind === 'class' && <ClassDetail d={item.data as CatalogClassData} />}
        {kind === 'background' && <BackgroundDetail d={item.data as CatalogBackgroundData} />}
        {kind === 'condition' && <ConditionDetail d={item.data as CatalogConditionData} />}
      </div>
    </div>
  );
}
