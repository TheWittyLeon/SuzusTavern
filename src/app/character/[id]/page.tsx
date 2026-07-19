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
import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth/AuthProvider';
import { useAuthGate } from '@/lib/auth/useAuthGate';
import { getCharacterSheet } from '@/lib/api/dnd';
import DeleteCharacterButton from '@/components/DeleteCharacterButton';
import LevelUpButton from '@/components/LevelUpButton';
import LevelChoicePicker from '@/components/LevelChoicePicker';
import type { CharacterSheet } from '@/lib/api/types';
import TavernShell from '@/components/TavernShell';
import PageSkeleton from '@/components/PageSkeleton';
import Card from '@/components/Card';
import Button from '@/components/Button';
import Pill from '@/components/Pill';
import Icon from '@/components/Icon';
import SuzuDM from '@/components/SuzuDM';
import InventoryPanel from '@/components/InventoryPanel';
import CurrencyPurse from '@/components/CurrencyPurse';
import HpControl from '@/components/HpControl';
import SpellSlotsPanel from '@/components/SpellSlotsPanel';
import SpellbookPanel from '@/components/SpellbookPanel';
import { ABILITIES, SKILLS } from '@/lib/dnd/helpers';
import { useSuzuNote } from '@/lib/dnd/useSuzuNote';
import styles from './CharacterView.module.css';

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

  // Suzu's note (ST-080) — called unconditionally (rules of hooks); null-safe
  // until the sheet loads. No aiAssistLevel source on a session-less sheet yet
  // (FLAGGED), so it defaults to the deterministic placeholder with ZERO LLM
  // calls; a persisted note (once generated) is read back verbatim.
  const { note: suzuNote } = useSuzuNote(sheet);

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
    // Canonical fetch-on-mount pattern (React docs "Fetching data" example);
    // `load` sets state only after the async request resolves, guarded by
    // `signal.aborted`. There's no external store to subscribe to here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(ac.signal);
    return () => ac.abort();
  }, [username, load]);

  // A11Y (Iro CRITICAL-4b): the LAST pending level-choice resolving unmounts
  // the whole LevelChoicePicker Card (its own render gate below is
  // `pending_choices.length > 0`), stranding focus at <body> — the picker's
  // OWN focus-restore (its "Pending choices" heading) only helps while it's
  // still mounted for a sibling choice, see LevelChoicePicker.tsx's header
  // comment. Track the previous pending count so this only fires on a
  // >0 -> 0 transition, never on the initial load (which may already be 0).
  const abilityHeadingRef = useRef<HTMLHeadingElement>(null);
  const prevPendingCountRef = useRef(sheet?.pending_choices?.length ?? 0);
  useEffect(() => {
    const count = sheet?.pending_choices?.length ?? 0;
    if (prevPendingCountRef.current > 0 && count === 0) {
      abilityHeadingRef.current?.focus();
    }
    prevPendingCountRef.current = count;
  }, [sheet?.pending_choices]);

  // UIR2-TAV-3: this used to be `if (!user) return <skeleton>` with no
  // escape hatch — a failed silent refresh left `user` null forever, so the
  // skeleton never resolved. useAuthGate bounds it: resolving → skeleton,
  // failed refresh → re-auth prompt, genuinely logged out → /login.
  const gate = useAuthGate({
    skeleton: <PageSkeleton variant="card" lines={4} />,
    label: 'Loading character',
  });
  if (gate) return gate;

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
  const initial = (sheet.name || '?').charAt(0).toUpperCase();
  const ageHeightLine = [sheet.alignment, sheet.subrace].filter(Boolean).join(' · ');
  // Precomputed to avoid JSX inter-expression whitespace pitfalls.
  // DDX-10: client-side UX gate only (mirrors every other owner/DM-only
  // affordance in this repo — the engine's real ownership check is the Track A
  // DND_REQUIRE_ACTOR kill-switch, default off). GET .../sheet has no ownership
  // enforcement while that flag is off, so a non-owner really can view this
  // page today; this only decides whether the Level-Up button renders at all.
  const isOwner = !!username && sheet.owner_username.toLowerCase() === username.toLowerCase();

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
              {/* HP (T5/DDX-09): interactive damage/heal, replaces the old
                  static HP dt/dd + hpBar (now owned by HpControl). */}
              <HpControl
                characterId={id}
                username={username ?? ''}
                isOwner={isOwner}
                hp={sheet.hp}
                onChanged={setSheet}
              />
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
            {/* DDX-10: owner-only level-up affordance. Absent entirely for a
                non-owner viewer (not merely disabled) — see the isOwner note
                above. Full-width via .wrap/.result's grid-column: 1 / -1. */}
            {username && isOwner && (
              <LevelUpButton
                characterId={id}
                username={username}
                sheet={sheet}
                onLeveledUp={setSheet}
              />
            )}
          </Card>

          {/* T13 (DDX-14t/15t): owner-only level-choice picker — subclass
              archetype / Ability Score Improvement / feat. Same isOwner gate
              as LevelUpButton above (a non-owner has no reason to resolve
              someone else's build decisions, and the engine route is
              OWNER-authed regardless); absent entirely when there is nothing
              pending, not merely empty, mirroring LevelUpButton's own
              own-Card-per-affordance split. */}
          {username && isOwner && (sheet.pending_choices?.length ?? 0) > 0 && (
            <Card>
              <LevelChoicePicker
                characterId={id}
                username={username}
                sheet={sheet}
                onResolved={setSheet}
              />
            </Card>
          )}

          {/* Ability scores (ST-056). Heading added as a stable a11y focus
              landmark (Iro CRITICAL-4b, see the effect above) — ref+
              tabIndex=-1 so it's focusable programmatically without joining
              the tab order.
              TAV-SHEET-HEADING-ORDER: h2, not h3 — this is the sheet's first
              section heading after TavernShell's own page h1 (the character
              name); h3 here skipped a level (axe heading-order, moderate).
              Visual size is unaffected — `.label` is a plain utility class,
              not tied to the heading tag. */}
          <h2
            ref={abilityHeadingRef}
            tabIndex={-1}
            className="label"
            style={{ margin: '0 0 8px' }}
          >
            Ability scores
          </h2>
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
            {/* TAV-SHEET-HEADING-ORDER: h2 — sibling section heading to
                "Ability scores" above, not a subsection of it. */}
            <h2 className="label" style={{ margin: '0 0 10px' }}>
              Saving throws
            </h2>
            <div className={styles.saveRow}>
              {ABILITIES.map((a) => {
                const mod = sheet.ability_scores[a.key]?.modifier ?? 0;
                const proficient = sheet.proficient_saves.includes(a.key);
                const total = mod + (proficient ? sheet.proficiency_bonus : 0);
                return (
                  <div key={a.key} className={styles.save} data-prof={proficient}>
                    {/* TAV-20: aria-label is prohibited on a role-less <span>
                        (axe aria-prohibited-attr, serious) so AT never announced
                        proficiency — role="img" makes the dot a labelable node. */}
                    <span
                      role="img"
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
            {/* TAV-SHEET-HEADING-ORDER: h2 — sibling section heading. */}
            <h2 className="label" style={{ margin: '0 0 10px' }}>
              Skills
            </h2>
            <div className={styles.skillGrid}>
              {SKILLS.map((s) => {
                const abilityMod = sheet.ability_scores[s.ability]?.modifier ?? 0;
                const proficient = sheet.proficient_skills.includes(s.key);
                const total = abilityMod + (proficient ? sheet.proficiency_bonus : 0);
                return (
                  <div key={s.key} className={styles.skillRow}>
                    {/* TAV-20: role="img" so the proficiency aria-label is valid
                        on the dot (was aria-prohibited-attr on a role-less span). */}
                    <span
                      role="img"
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

          {/* Inventory (ST-057, interactive equip/unequip — T5/DDX-09) */}
          <Card>
            <InventoryPanel
              characterId={id}
              username={username ?? ''}
              isOwner={isOwner}
              inventory={sheet.inventory}
              inventoryWeight={sheet.inventory_weight}
              onChanged={setSheet}
            />
          </Card>

          {/* Purse (T12/DDX-23t): gold display + owner-only Spend. Own
              small Card, right below Inventory — economy affordances live
              together. */}
          <Card>
            <CurrencyPurse
              characterId={id}
              username={username ?? ''}
              isOwner={isOwner}
              currencyGp={sheet.currency_gp ?? 0}
              onChanged={setSheet}
            />
          </Card>
        </div>

        {/* RIGHT */}
        <div className={styles.colSide}>
          {/* Suzu's note (ST-080) — labeled region; AI-attributed, persona flavor. */}
          <Card pop className={styles.suzuNote} role="region" aria-labelledby="suzu-note-label">
            <div className={styles.suzuHead}>
              <SuzuDM size={42} glow={false} aria-hidden />
              <div>
                {/* --ink-2 (not the .label default --ink-3): this is the region's
                    accessible name and --ink-3 fails AA on the tinted card across
                    the dark palettes. 11px (drop the 0.6rem override) for legibility. */}
                <p className="label" id="suzu-note-label" style={{ color: 'var(--ink-2)' }}>
                  Suzu&rsquo;s note
                </p>
                <p className={styles.suzuHeadTitle}>On {sheet.name.split(' ')[0]}</p>
              </div>
            </div>
            <p className={styles.suzuQuote}>&ldquo;{suzuNote}&rdquo;</p>
          </Card>

          {/* Spells (ST-058, interactive spend/restore — T5/DDX-09) — only
              for casters. The Card wrapper + is_spellcaster gate stay here
              (same split as InventoryPanel: parent owns the Card, the
              component owns the content); SpellSlotsPanel ALSO self-guards
              on its own isCaster prop, see its header comment. */}
          {sheet.is_spellcaster && (
            <Card>
              <SpellSlotsPanel
                characterId={id}
                username={username ?? ''}
                isOwner={isOwner}
                isCaster={sheet.is_spellcaster}
                spellcasting={sheet.spellcasting}
                spellSlots={sheet.spell_slots}
                onChanged={setSheet}
              />
            </Card>
          )}

          {/* Spells tab — sheet Spells tab slice (T4 / DDX-11t): browse/learn/
              prepare the actual repertoire. Separate Card from SpellSlotsPanel
              above (that one owns numbered slot pips; this one owns WHICH
              spells the character has) — same is_spellcaster gate, same
              parent-owns-Card / component-owns-content split, and
              SpellbookPanel ALSO self-guards on its own isCaster prop. */}
          {sheet.is_spellcaster && (
            <Card>
              <SpellbookPanel
                characterId={id}
                username={username ?? ''}
                isOwner={isOwner}
                isCaster={sheet.is_spellcaster}
              />
            </Card>
          )}

          {/* Features */}
          <Card>
            {/* TAV-SHEET-HEADING-ORDER: h2 — sibling section heading. */}
            <h2 className="label" style={{ margin: '0 0 10px' }}>
              Features
            </h2>
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
