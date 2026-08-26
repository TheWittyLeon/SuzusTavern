'use client';
/**
 * MemberSheetPanel — TAV-PARTY-INLINE-SHEET.
 *
 * Read-only, compact presentation of a party member's character sheet,
 * rendered inline in /play/[sessionId]'s slide-over drawer (page.tsx) instead
 * of navigating to /character/[id] (which reloads the whole session — see
 * PartyPanel.tsx's onSelectMember). Mirrors JournalPane's split: this
 * component owns the content, the wrapping `<aside>` in page.tsx owns the
 * drawer chrome (position/scrim/dialog semantics/focus-trap/Esc), exactly
 * like JournalPane/`#play-pane-journal`.
 *
 * Deliberately NOT the full /character/[id] page reused verbatim: that page's
 * sections (HpControl, InventoryPanel, LevelUpButton, …) are owner-mutation
 * widgets wired to `isOwner` + `onChanged` — appropriate when you're viewing
 * YOUR OWN sheet on its own page, wrong for glancing at another party
 * member's sheet mid-session (no one should get an equip/damage/level-up
 * affordance for a teammate's character from the party rail). This renders
 * the same underlying `CharacterSheet` fields read-only instead: identity,
 * HP/AC/initiative/proficiency/speed, ability scores, skills, inventory,
 * languages, features — the fields TAV-PARTY-INLINE-SHEET's design calls
 * for, without inheriting the full sheet page's mutation surface.
 *
 * `closeButtonRef` lets the parent focus this button when the drawer opens
 * (mirrors JournalPane/ConfirmDialog's "focus the least-destructive control
 * on open").
 */
import { useMemo, type RefObject } from 'react';
import Link from 'next/link';
import Icon from '@/components/Icon';
import Pill from '@/components/Pill';
import SpellInfoPopover from '@/components/SpellInfoPopover';
import { ABILITIES, SKILLS } from '@/lib/dnd/helpers';
import { raceSpeedLabel } from '@/lib/dnd/codex';
import { groupClassFeatures } from '@/lib/dnd/classFeatureText';
import { useClassFeatureDescriptions } from '@/lib/dnd/useClassFeatureDescriptions';
import type { CharacterSheet } from '@/lib/api/types';
import styles from './MemberSheetPanel.module.css';

/**
 * Fixed (not useId-generated) heading id — MemberSheetPanel is a singleton on
 * the play page (never rendered twice at once), and the wrapping `<aside>` in
 * page.tsx needs a stable id for its `aria-labelledby` (mirrors
 * JournalPane's JOURNAL_HEADING_ID).
 */
export const MEMBER_SHEET_HEADING_ID = 'member-sheet-panel-heading';

function signed(n: number): string {
  return n >= 0 ? `+${n}` : `${n}`;
}

export interface MemberSheetPanelProps {
  /** The resolved sheet, or null while loading/on error/before any selection. */
  sheet: CharacterSheet | null;
  loading: boolean;
  error: boolean;
  /** The clicked row's display name — shown as a heading fallback while the
   *  real sheet is still loading (or failed to load). */
  memberName: string | null;
  /** LVL (Aoi gap B): true when the drawer is showing the VIEWER's own
   *  sheet. This panel stays deliberately read-only (see the header
   *  comment) — but your own row's "↑ level up" badge opening a drawer with
   *  no way to act on it is a dead end, so the self view gets a callout
   *  that points at the one surface that CAN resolve pending choices. */
  isSelf?: boolean;
  onClose: () => void;
  closeButtonRef?: RefObject<HTMLButtonElement | null>;
}

export default function MemberSheetPanel({
  sheet,
  loading,
  error,
  memberName,
  isSelf = false,
  onClose,
  closeButtonRef,
}: MemberSheetPanelProps) {
  // Iro/Kage-CR-anticipated (byLabelText matches ANY element's
  // aria-labelledby, not just form controls): must not collide with an
  // unrelated field literally labeled "Character" elsewhere on the play page
  // (e.g. GrantCurrencyPanel's own "Character" <select>) while this drawer
  // sits closed-but-mounted with no member ever selected yet.
  const heading = sheet?.name ?? memberName ?? 'Character sheet';

  // Features list: same scaffolding-filter/dedupe/rules-text treatment as
  // the full /character/[id] sheet (classFeatureText.ts / TAV-CLASS-FEATURE-TEXT)
  // — this drawer renders the same underlying fields, see the header comment.
  const { descriptions: classFeatureDescriptions } = useClassFeatureDescriptions(
    sheet?.char_class ?? null,
  );
  const groupedClassFeatures = useMemo(
    () => (sheet ? groupClassFeatures(sheet.class_features) : []),
    [sheet],
  );

  return (
    <div className={styles.root}>
      <div className={styles.head}>
        <h2 id={MEMBER_SHEET_HEADING_ID} className={styles.heading}>
          <Icon name="Scroll" size={16} aria-hidden /> {heading}
        </h2>
        <button
          type="button"
          ref={closeButtonRef}
          className={styles.closeBtn}
          onClick={onClose}
          aria-label="Close character sheet"
        >
          <Icon name="Close" size={14} aria-hidden />
        </button>
      </div>

      {loading && (
        <p className={styles.status} aria-busy="true" aria-live="polite">
          Loading {memberName ?? 'character'}&rsquo;s sheet…
        </p>
      )}

      {!loading && error && (
        <p className={styles.statusError} role="alert">
          Suzu couldn&rsquo;t load that sheet right now.
        </p>
      )}

      {!loading && !error && sheet && (
        <>
          {/* LVL (Aoi gap B): FIRST thing in the body — what a top-to-bottom
              screen-reader pass (and a sighted eye) hits before anything
              else. Not a new mutation surface: it links out to the character
              page, respecting this panel's read-only philosophy. */}
          {isSelf && (sheet.pending_choices?.length ?? 0) > 0 && (
            <div className={styles.pendingCallout} role="note">
              <Icon name="Sparkle" size={14} aria-hidden />
              <p>
                {sheet.pending_choices?.length ?? 0} level choice
                {(sheet.pending_choices?.length ?? 0) > 1 ? 's' : ''} waiting —{' '}
                <Link href={`/character/${encodeURIComponent(sheet.character_id)}`}>
                  resolve on your character sheet
                </Link>
                .
              </p>
            </div>
          )}
          <section className={styles.section}>
            <p className={styles.subtitle}>
              {[sheet.race, `${sheet.char_class} ${sheet.level}`, sheet.subclass || null]
                .filter(Boolean)
                .join(' · ')
                .toLowerCase()}
            </p>
            <dl className={`mono ${styles.statRow}`}>
              <div className={styles.stat}>
                <dt>HP</dt>
                <dd>
                  {sheet.hp.current}/{sheet.hp.max}
                  {sheet.hp.temp > 0 ? ` (+${sheet.hp.temp})` : ''}
                </dd>
              </div>
              <div className={styles.stat}>
                <dt>AC</dt>
                <dd>{sheet.ac}</dd>
              </div>
              <div className={styles.stat}>
                <dt>INIT</dt>
                <dd>{signed(sheet.initiative)}</dd>
              </div>
              <div className={styles.stat}>
                <dt>PROF</dt>
                <dd>+{sheet.proficiency_bonus}</dd>
              </div>
              <div className={styles.stat}>
                <dt>SPD</dt>
                <dd>{raceSpeedLabel(sheet.speed)}</dd>
              </div>
            </dl>
          </section>

          <section aria-labelledby="member-sheet-abilities-heading" className={styles.section}>
            <h3 id="member-sheet-abilities-heading" className={styles.sectionHeading}>
              Ability scores
            </h3>
            <div className={styles.abilityRow}>
              {ABILITIES.map((a) => {
                const block = sheet.ability_scores[a.key];
                const score = block?.score ?? 10;
                const mod = block?.modifier ?? 0;
                return (
                  <div key={a.key} className={styles.abilityBox}>
                    <span className={styles.abilityName}>{a.abbr}</span>
                    <span className={styles.abilityVal}>{score}</span>
                    <span className={`mono ${styles.abilityMod}`}>{signed(mod)}</span>
                  </div>
                );
              })}
            </div>
          </section>

          <section aria-labelledby="member-sheet-skills-heading" className={styles.section}>
            <h3 id="member-sheet-skills-heading" className={styles.sectionHeading}>
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
                      role="img"
                      className={`${styles.profDot} ${proficient ? styles.profOn : ''}`}
                      aria-label={proficient ? 'proficient' : 'not proficient'}
                    />
                    <span className={styles.skillName}>{s.name}</span>
                    <span className={`mono ${styles.skillMod}`}>{signed(total)}</span>
                  </div>
                );
              })}
            </div>
          </section>

          <section aria-labelledby="member-sheet-inventory-heading" className={styles.section}>
            <h3 id="member-sheet-inventory-heading" className={styles.sectionHeading}>
              Gear &amp; inventory
            </h3>
            {sheet.inventory.length === 0 ? (
              <p className={styles.empty}>No items recorded.</p>
            ) : (
              <ul className={styles.list}>
                {sheet.inventory.map((item, i) => (
                  <li key={`${item.name}-${i}`} className={styles.itemRow}>
                    <span>
                      {item.name}
                      {item.quantity > 1 ? ` ×${item.quantity}` : ''}
                    </span>
                    {item.equipped && <span className={styles.equippedBadge}>equipped</span>}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="member-sheet-languages-heading" className={styles.section}>
            <h3 id="member-sheet-languages-heading" className={styles.sectionHeading}>
              Languages
            </h3>
            {(sheet.languages ?? []).length === 0 ? (
              <p className={styles.empty}>No languages recorded.</p>
            ) : (
              <div className={styles.tagList}>
                {(sheet.languages ?? []).map((lang) => (
                  <Pill key={lang} tone="muted">
                    {lang}
                  </Pill>
                ))}
              </div>
            )}
          </section>

          <section aria-labelledby="member-sheet-features-heading" className={styles.section}>
            <h3 id="member-sheet-features-heading" className={styles.sectionHeading}>
              Features
            </h3>
            {groupedClassFeatures.length === 0 ? (
              <p className={styles.empty}>No class features recorded.</p>
            ) : (
              <ul className={styles.list}>
                {groupedClassFeatures.map((f) => (
                  <li key={f.name}>
                    <SpellInfoPopover
                      spell={{ name: f.name, description: classFeatureDescriptions[f.name] }}
                      detailsLabel="Feature details"
                      emptyLabel="No details available yet."
                    >
                      {f.name}
                      {f.count > 1 && <span className="mono"> ×{f.count}</span>}
                    </SpellInfoPopover>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
