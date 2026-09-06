// src/app/codex/CodexDetail.tsx
//
// DDX-21 — the Codex's right-hand detail drawer. One component per content
// kind, all reading straight off the raw CatalogItem['data'] shape the engine
// returns (see the CatalogXData types added in lib/api/types.ts) — no extra
// adapter layer, since (unlike the character wizard) the Codex is a read-only
// reference view of exactly what the engine has on file.
//
// TAV-CODEX-SOURCE-PICKER-NPC: `Section`/`StatsGrid`/`MonsterDetail`/
// `DmOnlyDisclosure` moved to MonsterStatBlock.tsx so the standalone Monster
// tab and NPC's embedded stat block share one renderer. Adds NpcDetail (with
// the client-side stat_ref join, Sora-Arch §5), FeatDetail, SubclassDetail,
// AdventureDetail.

import Icon from '@/components/Icon';
import Pill from '@/components/Pill';
import type {
  AdventureSummary,
  CatalogBackgroundData,
  CatalogClassData,
  CatalogConditionData,
  CatalogEquipmentData,
  CatalogItem,
  CatalogMonsterData,
  CatalogNpcData,
  CatalogRaceData,
  CatalogSpellData,
} from '@/lib/api/types';
import {
  CODEX_KIND_META,
  adventureLengthLabel,
  adventureLevelRangeLabel,
  adventureSummary,
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
import {
  DmOnlyDisclosure,
  MonsterDetail,
  Section,
  StatsGrid,
  dmOnlyFields,
} from './MonsterStatBlock';
import styles from './Codex.module.css';

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

// ── NPC detail (TAV-CODEX-SOURCE-PICKER-NPC, D4/FR-17/FR-18) ────────────────

function NpcDetail({ d, monster }: { d: CatalogNpcData; monster: CatalogItem | undefined }) {
  return (
    <>
      {d.aliases && d.aliases.length > 0 && (
        <p className={styles.detailSubtitle}>also known as {d.aliases.join(', ')}</p>
      )}
      {(d.affiliation || d.rank_cue) && (
        <div className={styles.tagList} style={{ marginBottom: 16 }}>
          {d.affiliation && <Pill tone="cool">{d.affiliation}</Pill>}
          {d.rank_cue && <Pill tone="muted">{d.rank_cue}</Pill>}
        </div>
      )}
      {(d.role || d.motivation) && (
        <Section label="Role & motivation">
          {d.role && <p>{d.role}</p>}
          {d.motivation && <p>{d.motivation}</p>}
        </Section>
      )}
      {(d.height_ft || d.lineage || d.appearance) && (
        <Section label="Appearance">
          <StatsGrid
            stats={[
              ...(d.height_ft ? [{ k: 'Height', v: d.height_ft }] : []),
              ...(d.lineage ? [{ k: 'Lineage', v: d.lineage }] : []),
            ]}
          />
          {d.appearance && <p>{d.appearance}</p>}
        </Section>
      )}
      {(d.aura_signature || d.form_state || d.power_tier_cue) && (
        <Section label="Cues">
          <StatsGrid
            stats={[
              ...(d.aura_signature ? [{ k: 'Aura', v: d.aura_signature }] : []),
              ...(d.form_state ? [{ k: 'Form', v: d.form_state }] : []),
              ...(d.power_tier_cue ? [{ k: 'Power tier', v: d.power_tier_cue }] : []),
            ]}
          />
        </Section>
      )}
      {d.key_lines && d.key_lines.length > 0 && (
        <Section label="Key lines">
          <ul className={styles.quoteList}>
            {d.key_lines.map((line, i) => (
              <li key={i} className={styles.quoteLine}>
                &ldquo;{line}&rdquo;
              </li>
            ))}
          </ul>
        </Section>
      )}
      {d.location && (
        <Section label="Location">
          <p>{d.location}</p>
        </Section>
      )}
      {/* Sora-Arch §5: NO server-embedded stat block, no `resolve` param — the
          monster row is looked up client-side in useCodexCatalog's own
          (kind='monster', same source) cache by stat_ref's slug. A miss (49%
          of authored NPCs dangle today — content debt, not a bug) renders a
          quiet line, never styled as an error. */}
      <Section label="Stat block">
        {monster ? (
          <MonsterDetail d={monster.data as CatalogMonsterData} />
        ) : (
          <p className={styles.stateBody}>No stat block on file for this NPC.</p>
        )}
      </Section>
      <DmOnlyDisclosure fields={dmOnlyFields(d.dm_only)} />
    </>
  );
}

// ── Feat / Subclass / Adventure (minimal — D6, Aoi-UI §4) ───────────────────

interface CatalogFeatData {
  prerequisite?: string;
  ability_score_increase?: string;
  description?: string;
}

function FeatDetail({ d }: { d: CatalogFeatData }) {
  return (
    <>
      <StatsGrid
        stats={[
          { k: 'Prerequisite', v: d.prerequisite ?? '—' },
          { k: 'Ability score increase', v: d.ability_score_increase ?? '—' },
        ]}
      />
      <Section label="Description">
        <p>{d.description && d.description.trim() ? d.description : 'No description recorded for this feat yet.'}</p>
      </Section>
    </>
  );
}

interface CatalogSubclassData {
  parent_class?: string;
  subclass_level?: number;
  features?: string[];
  description?: string;
}

function SubclassDetail({ d }: { d: CatalogSubclassData }) {
  return (
    <>
      <StatsGrid
        stats={[
          { k: 'Parent class', v: d.parent_class ?? '—' },
          { k: 'Unlocks at level', v: d.subclass_level != null ? String(d.subclass_level) : '—' },
        ]}
      />
      {d.features && d.features.length > 0 && (
        <Section label="Features">
          <div className={styles.tagList}>
            {d.features.map((f) => (
              <Pill key={f} tone="muted">
                {f}
              </Pill>
            ))}
          </div>
        </Section>
      )}
      <Section label="Description">
        <p>{d.description && d.description.trim() ? d.description : 'No description recorded for this subclass yet.'}</p>
      </Section>
    </>
  );
}

/**
 * FR-6/FR-22: renders ONLY the engine's allowlisted adventure summary
 * (subtitle, level_range, length, content_rating, tags) — never scenes or
 * gm_description, even if a malformed/malicious payload carried them.
 */
function AdventureDetail({ item }: { item: CatalogItem }) {
  const s: AdventureSummary = adventureSummary(item);
  return (
    <>
      {s.subtitle && <p className={styles.detailSubtitle}>{s.subtitle}</p>}
      <StatsGrid
        stats={[
          { k: 'Level range', v: adventureLevelRangeLabel(s.level_range) },
          { k: 'Length', v: adventureLengthLabel(s.length) },
          { k: 'Content rating', v: s.content_rating ?? '—' },
        ]}
      />
      {s.tags && s.tags.length > 0 && (
        <Section label="Tags">
          <div className={styles.tagList}>
            {s.tags.map((t) => (
              <Pill key={t} tone="muted">
                {t}
              </Pill>
            ))}
          </div>
        </Section>
      )}
      <Section label="Full adventure">
        <p className={styles.stateBody}>
          Full adventure content is DM-only and not shown in the codex.
        </p>
      </Section>
    </>
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
  /**
   * TAV-CODEX-SOURCE-PICKER-NPC — only consulted for kind==='npc': the
   * monster row (if any) resolved client-side against the active source's
   * monster cache by the NPC's `stat_ref` slug (Sora-Arch §5). `undefined`
   * either means "no stat_ref", "not loaded yet", or "no matching monster in
   * this source" — all three render the same quiet fallback line.
   */
  resolvedMonster?: CatalogItem;
}

export default function CodexDetail({ item, kind, headingId, resolvedMonster }: CodexDetailProps) {
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
          {/* LEVELUP-UX-A11Y-TAIL: skip the pill entirely for an item with no
              source_type (the wizard's synthetic spell entries carry none) —
              an empty Pill renders as a bare chip. */}
          {badge.label && <Pill tone={badge.tone}>{badge.label}</Pill>}
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
        {kind === 'npc' && <NpcDetail d={item.data as CatalogNpcData} monster={resolvedMonster} />}
        {kind === 'feat' && <FeatDetail d={item.data as CatalogFeatData} />}
        {kind === 'subclass' && <SubclassDetail d={item.data as CatalogSubclassData} />}
        {kind === 'adventure' && <AdventureDetail item={item} />}
      </div>
    </div>
  );
}
