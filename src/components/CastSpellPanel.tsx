'use client';
/**
 * CastSpellPanel — T6 (DDX-12 cast-in-combat UI).
 *
 * Lets the active caster cast a spell during their own combat turn: pick a
 * castable spell (GET /spells/:id/list, filtered to `castable_now`) → choose
 * a slot level honoring upcast (DDX-04: from the spell's own `min_slot_level`
 * up to the highest level with a slot remaining) → optionally pick a target
 * from the current combatants → Cast (POST /api/dnd/spells/cast). The result
 * message is handed back to the play page for the shared chat/combat log
 * (mirrors how onCombatAction surfaces attack/dodge/dash text there); the
 * caster's own spell-slot pips live on the character sheet, so a successful
 * cast refetches the sheet (getCharacterSheet) and hands it to the parent via
 * `onSheetChanged` — same refetch-after-mutate contract as SpellSlotsPanel's
 * `onChanged`. A combat mutation never returns updated combat state from this
 * route (engine's POST /spells/cast only ever answers `{message}` — see
 * NekoNova-DnDEngine routes/spells.py::cast_spell), so `onStateRefresh` lets
 * the parent re-GET the CombatState (HP change on a healed/damaged target,
 * etc.) exactly like DmNarrationPanel's own `onStateRefresh` prop.
 *
 * Conventions mirrored verbatim from SpellbookPanel/SpellSlotsPanel: the
 * shared synchronous `useRef` busy-latch (set-before-await, released in
 * `finally` on both the success and error paths), a success toast (a11y —
 * the pip/log updates are visual-only), per-control aria-label, aria-busy on
 * the panel while a cast is in flight, disabled-while-busy, and a
 * reason-code → copy map for deterministic engine refusals (falls back to a
 * generic "try again" toast for a real network/unknown failure).
 *
 * Turn gating matches ActionRail's own convention (Composer.tsx): DISABLE,
 * don't hide, when it isn't the caster's turn — `isPlayerTurn` is computed by
 * the play page the exact same way it already is for the attack/dodge/dash
 * rail (activeIsMine), so a caster always sees their spell options; they just
 * can't fire them off-turn.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import Button from '@/components/Button';
import Icon from '@/components/Icon';
import { useToast } from '@/components/Toast';
import { castSpell, getCharacterSheet, getKnownSpells } from '@/lib/api/dnd';
import { engineErrorMessage } from '@/lib/dnd/engineError';
import { CAST_REFUSAL_REASON_MAP } from '@/lib/dnd/engineReasons';
import { isCastableCombatTarget } from '@/lib/dnd/combatTargets';
import type {
  CharacterSheet,
  CombatParticipantState,
  SheetSpellEntry,
  SheetSpellSlot,
  SpellListResult,
} from '@/lib/api/types';
import styles from './CastSpellPanel.module.css';

type FetchState = 'idle' | 'loading' | 'ok' | 'error';

function castErrorMessage(err: unknown, name: string): string {
  return engineErrorMessage(err, {
    // Unchanged wording: unlike the combat fallback, this never used
    // miss-language, and now that CAST_REFUSAL_REASON_MAP covers the action
    // economy the spent-action case no longer reaches it at all. The residual
    // cases really are transient (network / 5xx), so "try again" is honest.
    fallback: `Could not cast ${name}. Try again in a moment.`,
    reasonMap: CAST_REFUSAL_REASON_MAP,
  });
}

/** Cantrips + leveled spells, filtered to `castable_now`, sorted level-then-name. */
function castableSpells(list: SpellListResult | null): SheetSpellEntry[] {
  if (!list) return [];
  return [...list.cantrips, ...list.spells]
    .filter((s) => s.castable_now)
    .sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
}

/** Upcast range (DDX-04): from the spell's own min_slot_level (leveled spells
 *  only) up to the highest level that actually has a slot remaining. Empty
 *  for a cantrip — cantrips never consume a slot. Defensive fallback: if a
 *  race emptied every level since the list loaded, still offer the min level
 *  so the picker isn't stranded empty — the engine is the final authority and
 *  refuses cleanly (no_slots) if it's genuinely out. */
function upcastLevels(spell: SheetSpellEntry, slots: Record<string, SheetSpellSlot>): number[] {
  if (spell.is_cantrip) return [];
  const min = spell.min_slot_level ?? spell.level;
  const levels: number[] = [];
  for (let lvl = min; lvl <= 9; lvl += 1) {
    if ((slots[String(lvl)]?.remaining ?? 0) > 0) levels.push(lvl);
  }
  return levels.length > 0 ? levels : [min];
}

export interface CastSpellPanelProps {
  combatId: string;
  characterId: string;
  username: string;
  /** Combat participants (from CombatState.participants) — the target picker
   *  excludes the caster themselves (TAV-CAST-SELF-HEAL-UI: unless the
   *  selected spell heals, in which case self is offered too, labeled
   *  "yourself"); everyone else (ally or enemy) is always offered — the
   *  engine validates the actual legality of a given spell/target pair. */
  participants: CombatParticipantState[];
  /** The caster's own spell slots (from the sheet) — drives the upcast range. */
  spellSlots: Record<string, SheetSpellSlot>;
  /** Mirrors ActionRail's turn gate: disables (never hides) controls off-turn. */
  isPlayerTurn: boolean;
  /** Extra disable — session paused/ended, or another combat mutation in flight. */
  disabled?: boolean;
  /** Fired with the cast result message so the parent appends it to the shared log. */
  onCast: (message: string) => void;
  /** Fired with the freshly-refetched sheet after a successful cast — mirrors
   *  SpellSlotsPanel's onChanged; the slot pips live off this. */
  onSheetChanged: (sheet: CharacterSheet) => void;
  /** Fired after a successful cast so the parent re-GETs CombatState (a
   *  healed/damaged target's HP) — mirrors DmNarrationPanel's onStateRefresh. */
  onStateRefresh: () => void;
  /** Raise/lower the parent's shared combat-busy latch for the cast's duration,
   *  so the attack/dodge/dash/End-Turn rail is disabled while a cast resolves —
   *  symmetric with every other in-combat mutation (prevents a Cast+Attack
   *  double-action in the same turn during the network window). */
  onBusyChange?: (busy: boolean) => void;
}

export default function CastSpellPanel({
  combatId,
  characterId,
  username,
  participants,
  spellSlots,
  isPlayerTurn,
  disabled = false,
  onCast,
  onSheetChanged,
  onStateRefresh,
  onBusyChange,
}: CastSpellPanelProps) {
  const { toast } = useToast();
  const uid = useId();

  const [list, setList] = useState<SpellListResult | null>(null);
  const [listState, setListState] = useState<FetchState>('idle');

  const [selectedSlug, setSelectedSlug] = useState('');
  const [slotLevel, setSlotLevel] = useState<number | null>(null);
  const [targetId, setTargetId] = useState('');

  const [busy, setBusy] = useState(false);
  /** Synchronous double-submit latch — see SpellSlotsPanel/SpellbookPanel's
   *  header comment for why a plain `busy` state isn't enough on its own. */
  const mutationBusyRef = useRef(false);

  const loadCastable = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!opts?.silent) setListState('loading');
      try {
        const data = await getKnownSpells(characterId, username);
        setList(data);
        setListState('ok');
      } catch (err) {
        if (!opts?.silent) {
          setListState('error');
          return;
        }
        throw err;
      }
    },
    [characterId, username],
  );

  useEffect(() => {
    // Canonical fetch-on-mount pattern (React docs "Fetching data" example).
    // There's no external store to subscribe to here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadCastable();
  }, [loadCastable]);

  const spells = useMemo(() => castableSpells(list), [list]);
  const selectedSpell = useMemo(
    () => spells.find((s) => s.slug === selectedSlug) ?? null,
    [spells, selectedSlug],
  );
  const slotOptions = useMemo(
    () => (selectedSpell ? upcastLevels(selectedSpell, spellSlots) : []),
    [selectedSpell, spellSlots],
  );
  // TAV-CAST-SELF-HEAL-UI + F2/CAST-DEAD-TARGET: the caster is excluded from
  // the target list by default (you don't target yourself with an attack/
  // utility spell), but a HEALING spell (`selectedSpell.heals`, from the
  // engine's TAV-CAST-COMBAT-SELF-HEAL fix) is a legal self-cast in combat,
  // so include the caster's own participant in that case rather than
  // stranding them with no way to pick themselves. Layered on top:
  // isCastableCombatTarget (src/lib/dnd/combatTargets.ts, shared with the
  // Attack rail's targetableFoes) drops a downed/dead participant UNLESS the
  // selected spell heals AND the participant is an ally/self (never a downed
  // enemy, never a genuinely-dead PC even for a heal) — spell-kind-aware,
  // not a blunt mirror of Attack's living-enemies-only rule.
  const targets = useMemo(() => {
    const healSpellSelected = Boolean(selectedSpell?.heals);
    return participants.filter((p) => {
      const isSelf = String(p.entity_id) === String(characterId);
      if (isSelf && !healSpellSelected) return false;
      return isCastableCombatTarget(p, healSpellSelected);
    });
  }, [participants, characterId, selectedSpell]);

  // Keep targetId valid as `targets` changes shape — most notably, switching
  // FROM a healing spell (self selected) TO a non-healing spell drops self
  // out of `targets`, and a stale self-target must not survive to be
  // submitted with an attack/utility cast. Adjust-during-render, same
  // pattern as the selectedSlug/slotLevel resets below.
  const [prevTargets, setPrevTargets] = useState(targets);
  if (targets !== prevTargets) {
    setPrevTargets(targets);
    if (targetId !== '' && !targets.some((p) => p.participant_id === targetId)) {
      setTargetId('');
    }
  }

  // Keep selectedSlug valid as the castable list refreshes (e.g. a cast just
  // spent the caster's last slot at that level, dropping it from the list) —
  // reset to the first castable spell rather than stranding the picker.
  // Adjusted during render (not an effect) per React's documented pattern for
  // "adjusting state when a prop changes" — avoids an extra render pass.
  const [prevSpells, setPrevSpells] = useState(spells);
  if (spells !== prevSpells) {
    setPrevSpells(spells);
    if (spells.length === 0) {
      if (selectedSlug !== '') setSelectedSlug('');
    } else if (!spells.some((s) => s.slug === selectedSlug)) {
      setSelectedSlug(spells[0].slug);
    }
  }

  // Default the slot-level chooser to the LOWEST available level whenever the
  // selected spell (or its available range) changes — upcast is opt-in.
  const [prevSlotOptions, setPrevSlotOptions] = useState(slotOptions);
  if (slotOptions !== prevSlotOptions) {
    setPrevSlotOptions(slotOptions);
    if (slotOptions.length === 0) {
      if (slotLevel !== null) setSlotLevel(null);
    } else if (slotLevel === null || !slotOptions.includes(slotLevel)) {
      setSlotLevel(slotOptions[0]);
    }
  }

  async function handleCast() {
    if (!selectedSpell || mutationBusyRef.current || disabled || !isPlayerTurn) return;
    mutationBusyRef.current = true;
    setBusy(true);
    onBusyChange?.(true); // raise the shared combat latch → disables the attack rail
    try {
      const targetParticipant = targets.find((p) => p.participant_id === targetId);
      let res;
      try {
        res = await castSpell({
          username,
          combat_id: combatId,
          spell_name: selectedSpell.slug,
          ...(selectedSpell.is_cantrip ? {} : { slot_level: slotLevel ?? selectedSpell.level }),
          // DDX-CAST-TARGETID-PLUMBING: send both — target_id is preferred by
          // the engine (disambiguates two combatants with identical exact
          // names), target stays for logs/graceful degradation.
          ...(targetParticipant
            ? { target_id: targetParticipant.participant_id, target: targetParticipant.name }
            : {}),
        });
      } catch (err) {
        toast({ message: castErrorMessage(err, selectedSpell.name), tone: 'error' });
        return;
      }
      onCast(res.message ?? `You cast ${selectedSpell.name}.`);
      try {
        const sheet = await getCharacterSheet(characterId, username);
        onSheetChanged(sheet);
        onStateRefresh();
        // Re-pull the castable list too — spending a slot can change which
        // spells are castable_now (e.g. the last slot at that level is gone).
        await loadCastable({ silent: true });
        // Announce success programmatically (a11y): the pip/log updates are
        // visual-only, so screen-reader users need the toast's live-region.
        toast({ message: `Cast ${selectedSpell.name}.`, tone: 'success' });
      } catch {
        toast({
          message: "Couldn't refresh after casting — reload to see the result.",
          tone: 'warn',
        });
      }
    } finally {
      mutationBusyRef.current = false;
      setBusy(false);
      onBusyChange?.(false); // release the shared combat latch
    }
  }

  const notYourTurn = !isPlayerTurn;
  const castDisabled = busy || disabled || notYourTurn || !selectedSpell;

  return (
    <div
      className={styles.panel}
      aria-busy={busy}
      // A11Y-PANEL-SEMANTICS (P3): give this panel a landmark-equivalent
      // group + accessible name wired to its own visible label (mirrors
      // DmNarrationPanel's <section aria-label="DM monster control">), so AT
      // users get the same region cue that panel already provides.
      role="group"
      aria-labelledby={`${uid}-label`}
    >
      <p id={`${uid}-label`} className={styles.panelLabel}>
        <Icon name="Sparkle" size={12} aria-hidden /> Cast a spell
      </p>
      {listState === 'loading' && !list && (
        <p className={styles.emptyRow} aria-busy="true" aria-live="polite" aria-atomic="true">
          Loading spells…
        </p>
      )}
      {listState === 'error' && (
        <p className={styles.emptyRow} aria-live="polite" aria-atomic="true">
          Couldn&rsquo;t load your spells.
        </p>
      )}
      {listState === 'ok' && spells.length === 0 && (
        <p className={styles.emptyRow} aria-live="polite" aria-atomic="true">
          Nothing castable right now.
        </p>
      )}
      {listState === 'ok' && spells.length > 0 && (
        <div className={styles.row}>
          <div className={styles.field}>
            <label className={styles.fieldLabel} htmlFor={`${uid}-spell`}>
              Spell
            </label>
            <select
              id={`${uid}-spell`}
              className={styles.select}
              value={selectedSlug}
              disabled={busy || disabled}
              onChange={(e) => setSelectedSlug(e.target.value)}
            >
              {spells.map((s) => (
                <option key={s.slug} value={s.slug}>
                  {s.name}
                  {s.is_cantrip ? ' (cantrip)' : ` (Lvl ${s.level})`}
                </option>
              ))}
            </select>
          </div>
          {selectedSpell && !selectedSpell.is_cantrip && (
            <div className={styles.field}>
              <label className={styles.fieldLabel} htmlFor={`${uid}-slot`}>
                Slot level
              </label>
              <select
                id={`${uid}-slot`}
                className={styles.select}
                value={slotLevel ?? ''}
                disabled={busy || disabled}
                onChange={(e) => setSlotLevel(Number(e.target.value))}
              >
                {slotOptions.map((lvl) => (
                  <option key={lvl} value={lvl}>
                    Level {lvl}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className={styles.field}>
            <label className={styles.fieldLabel} htmlFor={`${uid}-target`}>
              Target
            </label>
            <select
              id={`${uid}-target`}
              className={styles.select}
              value={targetId}
              disabled={busy || disabled}
              onChange={(e) => setTargetId(e.target.value)}
            >
              <option value="">— no target —</option>
              {targets.map((p) => {
                const isSelf = String(p.entity_id) === String(characterId);
                return (
                  <option key={p.participant_id} value={p.participant_id}>
                    {p.name} (HP {p.hp_current}/{p.hp_max})
                    {isSelf ? ' — yourself' : ''}
                  </option>
                );
              })}
            </select>
          </div>
          <Button
            variant="primary"
            size="default"
            className={styles.castBtn}
            aria-label={
              notYourTurn
                ? `Cast ${selectedSpell?.name ?? 'spell'} (not your turn)`
                : `Cast ${selectedSpell?.name ?? 'spell'}`
            }
            aria-busy={busy}
            disabled={castDisabled}
            onClick={() => void handleCast()}
          >
            {busy ? '…' : 'Cast'}
          </Button>
        </div>
      )}
      {notYourTurn && (
        <p className={styles.notYourTurn} aria-live="polite" aria-atomic="true">
          Waiting for your turn…
        </p>
      )}
    </div>
  );
}
