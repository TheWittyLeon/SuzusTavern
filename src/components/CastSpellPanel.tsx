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
import type {
  ApiError,
  CharacterSheet,
  CombatParticipantState,
  SheetSpellEntry,
  SheetSpellSlot,
  SpellListResult,
} from '@/lib/api/types';
import styles from './CastSpellPanel.module.css';

type FetchState = 'idle' | 'loading' | 'ok' | 'error';

function isApiError(e: unknown): e is ApiError {
  return e instanceof Error && 'status' in e;
}

/** Same body-shape probe as SpellbookPanel's refusalReason (data.reason /
 *  reason / e.code). */
function refusalReason(e: ApiError): string | undefined {
  const body = e.body as { data?: { reason?: string }; reason?: string } | null | undefined;
  return body?.data?.reason ?? body?.reason ?? e.code;
}

// Deterministic cast refusals, sourced from engine.spells.SPELL_REASON_STATUS
// + cast_spell_in_combat's own CombatResult reasons (NekoNova-DnDEngine
// engine/spells.py, engine/commands/spell_commands.py::cmd_cast). A reason
// NOT in this map, or a non-ApiError (network/unknown), falls back to the
// generic transient message.
const CAST_REFUSAL_COPY: Record<string, string> = {
  no_combat: 'No active combat.',
  not_your_turn: "It's not your turn.",
  no_active_turn: 'No one has the active turn right now.',
  unknown_spell: "That spell couldn't be found.",
  invalid_slot: 'That slot level is too low for this spell.',
  no_slots: "You're out of slots at that level.",
  not_prepared: "That spell isn't known or prepared.",
  target_not_found: 'That target could not be found or is already down.',
};

function castErrorMessage(err: unknown, name: string): string {
  const fallback = `Could not cast ${name}. Try again in a moment.`;
  if (!isApiError(err)) return fallback;
  const reason = refusalReason(err);
  return CAST_REFUSAL_COPY[reason ?? ''] ?? fallback;
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
   *  excludes the caster themselves; everyone else (ally or enemy) is offered
   *  — the engine validates the actual legality of a given spell/target pair. */
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
  const targets = useMemo(
    () => participants.filter((p) => String(p.entity_id) !== String(characterId)),
    [participants, characterId],
  );

  // Keep selectedSlug valid as the castable list refreshes (e.g. a cast just
  // spent the caster's last slot at that level, dropping it from the list) —
  // reset to the first castable spell rather than stranding the picker.
  useEffect(() => {
    if (spells.length === 0) {
      if (selectedSlug !== '') setSelectedSlug('');
      return;
    }
    if (!spells.some((s) => s.slug === selectedSlug)) {
      setSelectedSlug(spells[0].slug);
    }
  }, [spells, selectedSlug]);

  // Default the slot-level chooser to the LOWEST available level whenever the
  // selected spell (or its available range) changes — upcast is opt-in.
  useEffect(() => {
    if (slotOptions.length === 0) {
      if (slotLevel !== null) setSlotLevel(null);
      return;
    }
    if (slotLevel === null || !slotOptions.includes(slotLevel)) {
      setSlotLevel(slotOptions[0]);
    }
  }, [slotOptions, slotLevel]);

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
    <div className={styles.panel} aria-busy={busy}>
      <p className={styles.panelLabel}>
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
              {targets.map((p) => (
                <option key={p.participant_id} value={p.participant_id}>
                  {p.name} (HP {p.hp_current}/{p.hp_max})
                </option>
              ))}
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
