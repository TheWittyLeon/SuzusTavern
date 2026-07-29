'use client';
/**
 * LevelUpButton — the DDX-10 level-up affordance (character sheet).
 *
 * Rendering is entirely owned by the caller: this component assumes it should
 * be visible (the character/[id] page only mounts it `{username && isOwner &&
 * <LevelUpButton .../>}`, mirroring the existing DeleteCharacterButton gate in
 * the same file) — a non-owner never gets this component in the DOM at all.
 *
 * Enabled only when `sheet.xp >= sheet.xp_next` — the threshold comes straight
 * off the engine payload (`rules.xp_for_next_level`, GET .../sheet), never
 * computed client-side. `xp_next` is null at level 20 (the engine's own
 * xp_for_next_level returns None past the cap) — atMaxLevel disables the
 * button with a reason rather than removing it, so a maxed-out character still
 * gets a clear "why not" instead of a mysteriously absent button.
 *
 * Flow: click -> ConfirmDialog -> levelUpCharacter -> refetch the sheet
 * (refetch-after-mutate — the engine is the source of truth for HP/slots/
 * features, same model as DDX-09/DDX-25's session-control handlers) -> diff
 * the pre/post sheets to report what was gained -> hand the fresh sheet up via
 * onLeveledUp so the whole page re-renders off the authoritative new state.
 *
 * "Success" is decided by the level ACTUALLY incrementing on the refetched
 * sheet, not by the mutate call merely resolving — see the dnd.ts contract
 * note on levelUpCharacter: the engine's "not enough XP" refusal is also a
 * 200, so a resolved promise alone doesn't prove anything happened.
 *
 * R2 fixes (Miko-QA adversarial pass, DDX-10):
 *   - D1: `confirmLevelUp` had no synchronous guard at all, so two clicks on
 *     "Yes, level up" landing in the same React batch both ran to completion
 *     (React state's `busy` flip hadn't committed for either dispatch) — a
 *     real double level-up. Fixed with `levelUpBusyRef`, the same synchronous
 *     useRef-latch pattern as `sessionActionBusyRef` in
 *     src/app/play/[sessionId]/page.tsx (DDX-25 R2 / D5): check-and-return at
 *     the top, set `true` before the first `await`, clear in `finally`.
 *   - D2: `levelUpCharacter` resolving and the follow-up `getCharacterSheet`
 *     refetch throwing was reported with the same copy as an actual level-up
 *     failure ("Could not level up. Try again in a moment.") — misleading,
 *     since the level-up already happened server-side and "try again" invites
 *     a second, real one. The mutate and the refetch now have separate
 *     try/catch blocks so a refetch failure gets its own non-retry copy.
 *
 * DDX-14/15 seam (T13 update): the engine grants a class feature literally
 * named "Ability Score Improvement" (or "Ability Score Improvement / ASI")
 * as flavor text at the levels 5e calls for it. That choice — and any queued
 * subclass pick — is now actually resolvable: `character/[id]/page.tsx`
 * mounts `LevelChoicePicker` right below this button whenever the freshly-
 * refetched sheet's `pending_choices` is non-empty, so the result region here
 * only needs to POINT at it, not apologize for a missing feature.
 */
import { useId, useRef, useState } from 'react';
import Button from '@/components/Button';
import Icon from '@/components/Icon';
import ConfirmDialog from '@/components/ConfirmDialog';
import { useToast } from '@/components/Toast';
import { getCharacterSheet, levelUpCharacter } from '@/lib/api/dnd';
import type { CharacterSheet } from '@/lib/api/types';
import styles from './LevelUpButton.module.css';

export interface LevelUpGain {
  fromLevel: number;
  toLevel: number;
  hpGain: number;
  hpMax: number;
  /** Spell-slot levels whose max changed this level-up (new casters included). */
  slotChanges: { level: string; from: number; to: number }[];
  newFeatures: string[];
  /** See the DDX-14/15 seam note above — ASI-only detection, reliable across
   *  every class ("Ability Score Improvement" is the literal feature name). */
  hasAsiFeature: boolean;
}

export interface LevelUpButtonProps {
  characterId: string;
  username: string;
  sheet: CharacterSheet;
  /** Fired with the freshly-refetched sheet after a successful level-up, so
   *  the parent page re-renders every other panel off the new state too. */
  onLeveledUp: (updated: CharacterSheet) => void;
  className?: string;
}

const ASI_PATTERN = /ability score improvement|\bASI\b/i;

/** Diff two sheets from the SAME character (pre/post level-up) into a
 *  human-readable gain summary. Pure function — no API calls. */
export function summarizeLevelUpGain(
  before: CharacterSheet,
  after: CharacterSheet,
): LevelUpGain {
  const beforeFeatures = new Set(before.class_features);
  const newFeatures = after.class_features.filter((f) => !beforeFeatures.has(f));

  const slotLevels = new Set([
    ...Object.keys(before.spell_slots || {}),
    ...Object.keys(after.spell_slots || {}),
  ]);
  const slotChanges: LevelUpGain['slotChanges'] = [];
  for (const lvl of slotLevels) {
    const from = before.spell_slots?.[lvl]?.max ?? 0;
    const to = after.spell_slots?.[lvl]?.max ?? 0;
    if (to !== from) slotChanges.push({ level: lvl, from, to });
  }
  slotChanges.sort((a, b) => Number(a.level) - Number(b.level));

  return {
    fromLevel: before.level,
    toLevel: after.level,
    hpGain: Math.max(0, after.hp.max - before.hp.max),
    hpMax: after.hp.max,
    slotChanges,
    newFeatures,
    hasAsiFeature: newFeatures.some((f) => ASI_PATTERN.test(f)),
  };
}

export default function LevelUpButton({
  characterId,
  username,
  sheet,
  onLeveledUp,
  className,
}: LevelUpButtonProps) {
  const { toast } = useToast();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [gain, setGain] = useState<LevelUpGain | null>(null);
  // Micro-hardening: a hardcoded id would collide if two LevelUpButton
  // instances ever render on the same page at once.
  const reasonId = useId();
  /** D1: synchronous double-submit latch — see the header comment. React
   *  state (`busy`) can't close this gap because two same-tick clicks both
   *  read it before either dispatch's re-render commits; a ref mutation is
   *  visible immediately to the second invocation. */
  const levelUpBusyRef = useRef(false);

  // LVL (D5/FR-14): the gate is the SERVER's verdict — `levelup_policy` off
  // the sheet (engine level_policy.evaluate). Four states on this one
  // control: XP-gated disabled/enabled (unchanged), workshop (unbound —
  // level freely, LVL-2), floor catch-up (below the bound table's
  // starting_level, LVL-1/OQ-1). Max level discriminates on
  // `outcome === 'denied_max_level'`, NEVER on `xp_next == null` — that
  // null is ambiguous the moment workshop mode exists (reconciliation
  // item 3). The client-computed block below survives ONLY as the
  // pre-upgrade-backend fallback (levelup_policy absent), mirroring
  // characterBadge()'s `!c.in_use` fallback convention in modules/page.tsx.
  const policy = sheet.levelup_policy;
  const fallbackAtMax = sheet.xp_next == null;
  const fallbackCanLevel =
    !fallbackAtMax && sheet.xp_next != null && sheet.xp >= sheet.xp_next;
  const fallbackXpShort =
    sheet.xp_next != null ? Math.max(0, sheet.xp_next - sheet.xp) : 0;

  const atMaxLevel = policy ? policy.outcome === 'denied_max_level' : fallbackAtMax;
  const canLevelUp = policy ? policy.can_level : fallbackCanLevel;
  const xpShort = policy ? (policy.xp_short ?? 0) : fallbackXpShort;
  // Reason text doubles as mode flavor: it stays rendered (and
  // aria-describedby-associated) even while the button is ENABLED in
  // workshop/floor mode — a described-by that vanishes when the button
  // becomes enabled is a screen-reader regression (design §10).
  const reason = atMaxLevel
    ? 'Max level reached.'
    : policy?.mode === 'workshop'
      ? 'Workshop — level freely, no campaign yet.'
      : policy?.outcome === 'allowed_floor'
        ? `Catch up to table level ${policy.floor ?? sheet.level + 1}.`
        : !canLevelUp
          ? `Needs ${xpShort.toLocaleString()} more XP.`
          : '';

  async function confirmLevelUp() {
    // D1: check-and-set BEFORE the first await, synchronously — closes the
    // same-tick double-click window (mirrors sessionActionBusyRef's
    // check-and-return-then-set-true ordering in play/[sessionId]/page.tsx).
    if (levelUpBusyRef.current) return;
    levelUpBusyRef.current = true;
    setBusy(true);
    try {
      // D2: the mutate and the refetch get separate try/catch blocks so a
      // failure can be attributed to the right one. Once levelUpCharacter
      // resolves, the level-up has already happened (or been refused) server-
      // side — see the dnd.ts contract note — so nothing past this point may
      // be reported as a level-up failure, and nothing past this point may
      // invite a retry (a retry would be a second, real level-up attempt).
      try {
        await levelUpCharacter(characterId, username);
      } catch {
        toast({ message: 'Could not level up. Try again in a moment.', tone: 'error' });
        setConfirming(false);
        return;
      }

      try {
        const after = await getCharacterSheet(characterId, username);
        setConfirming(false);
        if (after.level > sheet.level) {
          setGain(summarizeLevelUpGain(sheet, after));
          toast({
            title: 'Level up!',
            message: `${after.name} is now level ${after.level}.`,
            tone: 'success',
          });
        } else {
          // Defensive: see the dnd.ts contract note — a resolved levelUpCharacter
          // call is not proof anything changed. The refetched level not moving
          // means it didn't, regardless of what the mutate response said.
          setGain(null);
          toast({ message: 'Suzu says: not quite enough XP yet.', tone: 'info' });
        }
        onLeveledUp(after);
      } catch {
        // D2: the level-up itself succeeded OR was refused — either way, only
        // this refetch failed, and we don't actually know which happened
        // (see the dnd.ts contract note: a resolved levelUpCharacter isn't
        // proof of anything on its own). Don't assert an outcome we can't
        // verify, and don't say "try again" (that reads as "nothing happened
        // yet", which risks a real second level-up attempt).
        setConfirming(false);
        toast({
          message: "Couldn't refresh your sheet — reload to see the result.",
          tone: 'warn',
        });
      }
    } finally {
      setBusy(false);
      levelUpBusyRef.current = false;
    }
  }

  return (
    <>
      <div className={`${styles.wrap} ${className ?? ''}`}>
        <Button
          variant="primary"
          leadingIcon={<Icon name="Crown" size={14} aria-hidden />}
          disabled={!canLevelUp}
          aria-describedby={reason ? reasonId : undefined}
          onClick={() => setConfirming(true)}
        >
          Level up
        </Button>
        {reason && (
          <span id={reasonId} className={styles.reason}>
            {reason}
          </span>
        )}
      </div>

      {/* confirmLabel is deliberately "Yes, level up", not "Level up" — the
          trigger button above already owns that exact accessible name and
          both are on screen at once while the dialog is open (same trap as
          DDX-25's End Session button; a same-named trigger+confirm pair
          breaks naive getByRole('button', {name}) queries in tests). */}
      <ConfirmDialog
        open={confirming}
        title={`Level up ${sheet.name}?`}
        body={
          <>
            {sheet.name} will advance to level {sheet.level + 1}. HP, hit dice
            {sheet.is_spellcaster ? ', spell slots,' : ''} and class features
            update immediately — this can&rsquo;t be undone.
          </>
        }
        confirmLabel="Yes, level up"
        cancelLabel="Not yet"
        busy={busy}
        onConfirm={() => void confirmLevelUp()}
        onCancel={() => setConfirming(false)}
      />

      {/* Result announcement — polite live region, always mounted so screen
          readers reliably pick up the content change (WAI-ARIA authoring
          practice); visible text too, never color-only. */}
      <div role="status" aria-live="polite" className={styles.result}>
        {gain && (
          <p>
            <strong>
              Leveled up! Lv.{gain.fromLevel} → Lv.{gain.toLevel}.
            </strong>{' '}
            {gain.hpGain > 0 && `+${gain.hpGain} HP (now ${gain.hpMax}). `}
            {gain.slotChanges.length > 0 &&
              `New spell slots: ${gain.slotChanges
                .map((s) => `Lv.${s.level} ${s.from}→${s.to}`)
                .join(', ')}. `}
            {gain.newFeatures.length > 0 && `New: ${gain.newFeatures.join(', ')}.`}
            {gain.hasAsiFeature && ' Pick your Ability Score Improvement below.'}
          </p>
        )}
      </div>
    </>
  );
}
