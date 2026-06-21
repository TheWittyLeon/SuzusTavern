'use client';
/**
 * Character sheet — /character/[id] (ST-054–058).
 *
 * Full 5e sheet rendered from the engine's STRUCTURED read
 * (GET /api/dnd/characters/:id/sheet → get_character_sheet_data), not the
 * cmd_sheet display string. Left column: identity card (ST-055), ability scores +
 * saving throws + skills (ST-056), inventory (ST-057). Right column: Suzu's note,
 * spells (ST-058, hidden for non-casters), class features.
 *
 * The engine is the source of mechanical truth — every number here comes from the
 * payload; the page only formats. Numbers use the mono font + tabular figures.
 */
import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth/AuthProvider';
import { getCharacterSheet } from '@/lib/api/dnd';
import DeleteCharacterButton from '@/components/DeleteCharacterButton';
import type { CharacterSheet } from '@/lib/api/types';
import TavernShell from '@/components/TavernShell';
import PageSkeleton from '@/components/PageSkeleton';
import Card from '@/components/Card';
import Button from '@/components/Button';
import Pill from '@/components/Pill';
import Icon, { type IconName } from '@/components/Icon';
import SuzuDM from '@/components/SuzuDM';
import { ABILITIES, SKILLS } from '@/lib/dnd/helpers';
import styles from './CharacterView.module.css';

const ITEM_ICON: Record<string, IconName> = {
  weapon: 'Sword',
  armor: 'Shield',
  shield: 'Shield',
  potion: 'Potion',
  tool: 'Scroll',
  gear: 'Scroll',
};

function signed(n: number): string {
  return n >= 0 ? `+${n}` : `${n}`;
}

export default function CharacterPage() {
  const params = useParams<{ id: string }>();
  const id = typeof params?.id === 'string' ? params.id : '';
  const { user } = useAuth();
  const username = user?.username ?? null;
  const router = useRouter();

  const [sheet, setSheet] = useState<CharacterSheet | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading');

  const load = useCallback(
    async (signal: AbortSignal) => {
      if (!username || !id) return;
      try {
        const data = await getCharacterSheet(id, username, signal);
        if (!signal.aborted) {
          setSheet(data);
          setState('ok');
        }
      } catch {
        if (!signal.aborted) setState('error');
      }
    },
    [username, id],
  );

  useEffect(() => {
    if (!username) return;
    const ac = new AbortController();
    void load(ac.signal);
    return () => ac.abort();
  }, [username, load]);

  if (!user) {
    return (
      <main aria-busy="true" aria-label="Loading character" style={{ padding: '32px 28px' }}>
        <PageSkeleton variant="card" lines={4} />
      </main>
    );
  }

  if (state === 'error') {
    return (
      <TavernShell active="dashboard" title="Character">
        <Card className={styles.panel}>
          <p className={styles.errorTitle}>Suzu can&rsquo;t find that one.</p>
          <p className={styles.errorBody}>
            The character may not exist, or it isn&rsquo;t yours to view.
          </p>
          <div className={styles.actions}>
            <Button variant="primary" href="/character/new">
              Create a character
            </Button>
            <Button variant="ghost" href="/dashboard">
              Back to dashboard
            </Button>
          </div>
        </Card>
      </TavernShell>
    );
  }

  if (state === 'loading' || !sheet) {
    return (
      <TavernShell active="dashboard" title="Character">
        <div aria-busy="true" aria-label="Loading character sheet">
          <PageSkeleton variant="card" lines={4} />
          <div style={{ marginTop: 18 }}>
            <PageSkeleton variant="list" lines={4} />
          </div>
        </div>
      </TavernShell>
    );
  }

  const subtitleParts = [
    sheet.race,
    `${sheet.char_class} ${sheet.level}`,
    sheet.subclass || null,
  ].filter(Boolean);
  const hpPct = sheet.hp.max > 0 ? Math.max(0, Math.min(100, (sheet.hp.current / sheet.hp.max) * 100)) : 0;
  const initial = (sheet.name || '?').charAt(0).toUpperCase();
  const ageHeightLine = [sheet.alignment, sheet.subrace].filter(Boolean).join(' · ');
  // Precomputed to avoid JSX inter-expression whitespace pitfalls.
  const suzuNote = `A ${sheet.race.toLowerCase()} ${sheet.char_class.toLowerCase()} with a ${sheet.background.toLowerCase()} past. I’ve seen how this story tends to go. Bring a coat.`;

  return (
    <TavernShell
      active="dashboard"
      title={sheet.name}
      actions={
        <>
          {username && (
            <DeleteCharacterButton
              variant="button"
              characterId={id}
              characterName={sheet.name}
              username={username}
              onDeleted={() => router.push('/dashboard')}
            />
          )}
          <Button
            variant="primary"
            href="/lobby"
            leadingIcon={<Icon name="Compass" size={14} aria-hidden />}
          >
            Find a table
          </Button>
        </>
      }
    >
      <div className={styles.sheet}>
        {/* LEFT */}
        <div className={styles.colMain}>
          {/* Identity card (ST-055) */}
          <Card className={styles.identity}>
            <span className={styles.idAvatar} aria-hidden>
              {initial}
            </span>
            <div className={styles.idBody}>
              <p className="label">Background · {sheet.background || '—'}</p>
              {/* The page <h1> (TavernShell title) already is the name; this is a
                  styled display line, not a second heading. */}
              <p className={styles.idName}>{sheet.name}</p>
              <p className={styles.idSub}>
                {subtitleParts.join(' · ').toLowerCase()}
                {ageHeightLine ? ` · ${ageHeightLine.toLowerCase()}` : ''}
              </p>
              <dl className={`mono ${styles.idStats}`}>
                <div className={styles.idStat}>
                  <dt style={{ color: 'var(--good)' }}>HP</dt>
                  <dd>
                    {sheet.hp.current}/{sheet.hp.max}
                    {sheet.hp.temp > 0 ? ` (+${sheet.hp.temp})` : ''}
                  </dd>
                </div>
                <div className={styles.idStat}>
                  <dt style={{ color: 'var(--cool-ink)' }}>AC</dt>
                  <dd>{sheet.ac}</dd>
                </div>
                <div className={styles.idStat}>
                  <dt style={{ color: 'var(--crit-ink)' }}>INIT</dt>
                  <dd>{signed(sheet.initiative)}</dd>
                </div>
                <div className={styles.idStat}>
                  <dt style={{ color: 'var(--accent-2)' }}>PROF</dt>
                  <dd>+{sheet.proficiency_bonus}</dd>
                </div>
                <div className={styles.idStat}>
                  <dt>SPD</dt>
                  <dd>{sheet.speed} ft</dd>
                </div>
              </dl>
              <div
                className={styles.hpBar}
                role="meter"
                aria-label={`Hit points ${sheet.hp.current} of ${sheet.hp.max}`}
                aria-valuenow={sheet.hp.current}
                aria-valuemin={0}
                aria-valuemax={sheet.hp.max}
              >
                <span className={styles.hpFill} style={{ width: `${hpPct}%` }} />
              </div>
              {sheet.conditions.length > 0 && (
                <div className={styles.conditions}>
                  {sheet.conditions.map((c) => (
                    <Pill key={c} tone="warn">
                      {c}
                    </Pill>
                  ))}
                </div>
              )}
            </div>
            <div className={styles.idLevel}>
              <p className="label">Level</p>
              <p className={styles.idLevelNum}>{sheet.level}</p>
              <p className={`mono ${styles.idXp}`}>
                XP {sheet.xp.toLocaleString()}
                {sheet.xp_next != null ? ` / ${sheet.xp_next.toLocaleString()}` : ''}
              </p>
            </div>
          </Card>

          {/* Ability scores (ST-056) */}
          <div className={styles.abilityRow}>
            {ABILITIES.map((a) => {
              const block = sheet.ability_scores[a.key];
              const score = block?.score ?? 10;
              const mod = block?.modifier ?? 0;
              return (
                <div key={a.key} className={styles.statBox}>
                  <span className={styles.statName}>{a.abbr}</span>
                  <span className={styles.statVal}>{score}</span>
                  <span className={`mono ${styles.statMod}`}>{signed(mod)}</span>
                </div>
              );
            })}
          </div>

          {/* Saving throws (ST-056) */}
          <Card>
            <h3 className="label" style={{ margin: '0 0 10px' }}>
              Saving throws
            </h3>
            <div className={styles.saveRow}>
              {ABILITIES.map((a) => {
                const mod = sheet.ability_scores[a.key]?.modifier ?? 0;
                const proficient = sheet.proficient_saves.includes(a.key);
                const total = mod + (proficient ? sheet.proficiency_bonus : 0);
                return (
                  <div key={a.key} className={styles.save} data-prof={proficient}>
                    <span
                      className={`${styles.profDot} ${proficient ? styles.profOn : ''}`}
                      aria-label={proficient ? 'proficient' : 'not proficient'}
                    />
                    <span className={styles.saveName}>{a.abbr}</span>
                    <span className={`mono ${styles.saveMod}`}>{signed(total)}</span>
                  </div>
                );
              })}
            </div>
          </Card>

          {/* Skills (ST-056) */}
          <Card>
            <h3 className="label" style={{ margin: '0 0 10px' }}>
              Skills
            </h3>
            <div className={styles.skillGrid}>
              {SKILLS.map((s) => {
                const abilityMod = sheet.ability_scores[s.ability]?.modifier ?? 0;
                const proficient = sheet.proficient_skills.includes(s.key);
                const total = abilityMod + (proficient ? sheet.proficiency_bonus : 0);
                return (
                  <div key={s.key} className={styles.skillRow}>
                    <span
                      className={`${styles.profDot} ${proficient ? styles.profOn : ''}`}
                      aria-label={proficient ? 'proficient' : 'not proficient'}
                    />
                    <span className={styles.skillName}>
                      {s.name}
                      <small className={styles.skillAbbr}>{s.abbr}</small>
                    </span>
                    <span className={`mono ${styles.skillMod}`}>{signed(total)}</span>
                  </div>
                );
              })}
            </div>
          </Card>

          {/* Inventory (ST-057) */}
          <Card>
            <div className={styles.cardHead}>
              <h3 className="label" style={{ margin: 0 }}>
                Inventory · weight {sheet.inventory_weight} lb
              </h3>
            </div>
            {sheet.inventory.length === 0 ? (
              <p className={styles.emptyRow}>Nothing in the pack yet.</p>
            ) : (
              <ul className={styles.itemList}>
                {sheet.inventory.map((it, i) => (
                  <li key={`${it.name}-${i}`} className={styles.itemRow}>
                    <span className={styles.itemIcon} aria-hidden>
                      <Icon name={ITEM_ICON[it.item_type] ?? 'Scroll'} size={16} />
                    </span>
                    <span className={styles.itemMeta}>
                      <span className={styles.itemName}>
                        {it.name}
                        {it.equipped && (
                          <Pill tone="good" className={styles.equipPill}>
                            equipped
                          </Pill>
                        )}
                      </span>
                      {it.sub && <span className={`mono ${styles.itemSub}`}>{it.sub}</span>}
                    </span>
                    <span className={`mono ${styles.itemQty}`}>×{it.quantity}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        {/* RIGHT */}
        <div className={styles.colSide}>
          {/* Suzu's note */}
          <Card pop className={styles.suzuNote}>
            <div className={styles.suzuHead}>
              <SuzuDM size={42} glow={false} aria-hidden />
              <div>
                <p className="label" style={{ fontSize: '0.6rem' }}>
                  Suzu&rsquo;s note
                </p>
                <p className={styles.suzuHeadTitle}>On {sheet.name.split(' ')[0]}</p>
              </div>
            </div>
            <p className={styles.suzuQuote}>&ldquo;{suzuNote}&rdquo;</p>
          </Card>

          {/* Spells (ST-058) — only for casters */}
          {sheet.is_spellcaster && (
            <Card>
              <div className={styles.cardHead}>
                <h3 className="label" style={{ margin: 0 }}>
                  Spells
                  {sheet.spellcasting
                    ? ` · ${ABILITIES.find((a) => a.key === sheet.spellcasting?.ability)?.abbr.toLowerCase() ?? ''} (DC ${sheet.spellcasting.save_dc})`
                    : ''}
                </h3>
                {sheet.spellcasting && (
                  <span className={`mono ${styles.castAtk}`}>
                    atk {signed(sheet.spellcasting.attack_bonus)}
                  </span>
                )}
              </div>
              {Object.keys(sheet.spell_slots).length === 0 ? (
                <p className={styles.emptyRow}>No spell slots at this level yet.</p>
              ) : (
                <ul className={styles.slotList}>
                  {Object.entries(sheet.spell_slots)
                    .sort((a, b) => Number(a[0]) - Number(b[0]))
                    .map(([lvl, slot]) => (
                      <li key={lvl} className={styles.slotRow}>
                        <span className={styles.slotLvl} aria-hidden>
                          {lvl}
                        </span>
                        <span className={styles.slotLabel}>Level {lvl}</span>
                        <span className={styles.slotPips} aria-label={`${slot.remaining} of ${slot.max} level ${lvl} slots remaining`}>
                          {Array.from({ length: slot.max }).map((_, i) => (
                            <span
                              key={i}
                              className={`${styles.pip} ${i < slot.remaining ? styles.pipOn : ''}`}
                              aria-hidden
                            />
                          ))}
                        </span>
                        <span className={`mono ${styles.slotCount}`}>
                          {slot.remaining}/{slot.max}
                        </span>
                      </li>
                    ))}
                </ul>
              )}
            </Card>
          )}

          {/* Features */}
          <Card>
            <h3 className="label" style={{ margin: '0 0 10px' }}>
              Features
            </h3>
            {sheet.class_features.length === 0 ? (
              <p className={styles.emptyRow}>No class features recorded.</p>
            ) : (
              <ul className={styles.featureList}>
                {sheet.class_features.map((f, i) => (
                  <li key={`${f}-${i}`} className={styles.featureRow}>
                    {f}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </TavernShell>
  );
}
