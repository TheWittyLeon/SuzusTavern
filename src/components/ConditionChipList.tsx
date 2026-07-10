'use client';
/**
 * ConditionChipList — T7 (DDX-17e) condition chips for a single combatant.
 *
 * Read-only by default (used inside InitiativeTracker, visible to every
 * client via the existing combat-state poll). Pass `onRemove` to add a
 * DM-only "x" per chip (used by ConditionsPanel's own combatant rows) —
 * plain rendering never shows a remove affordance to non-DM viewers because
 * only ConditionsPanel (mounted DM-only) ever supplies `onRemove`.
 *
 * Reuses the shared Pill for tone/geometry (API-6: Pill composes the global
 * `.pill` class) — only the optional remove button and chip-row layout live
 * in this component's own CSS module.
 */
import Icon from '@/components/Icon';
import Pill from '@/components/Pill';
import { conditionChipLabel, formatConditionName } from '@/lib/conditions';
import styles from './ConditionChipList.module.css';

export interface ConditionChipListProps {
  conditions: string[];
  /** Rounds-remaining per lower-cased condition (CombatParticipantState.condition_durations).
   *  A condition absent here renders name-only (indefinite). */
  durations?: Record<string, number>;
  /** Combatant name, used only to build an accessible remove-button label. */
  combatantName?: string;
  /** Supplying this renders a remove "x" on every chip (DM-only callers). */
  onRemove?: (condition: string) => void;
  /** Disables every remove button (e.g. a mutation is already in flight). */
  removeDisabled?: boolean;
  className?: string;
}

export default function ConditionChipList({
  conditions,
  durations,
  combatantName,
  onRemove,
  removeDisabled = false,
  className,
}: ConditionChipListProps) {
  if (conditions.length === 0) return null;

  return (
    <div
      className={[styles.chips, className].filter(Boolean).join(' ')}
      role="group"
      aria-label={
        combatantName ? `${combatantName} conditions` : 'Conditions'
      }
    >
      {conditions.map((c) => {
        const rounds = durations?.[c.toLowerCase()];
        return (
          <Pill key={c} tone="warn" className={styles.chip}>
            {/* A11Y (Iro MODERATE-2): the visible "Name · N" separator is
                ambiguous to a screen reader (the middle dot has no semantic
                meaning) — hide the visual label from the AT tree and give it
                a plain-language sibling instead. */}
            <span aria-hidden="true">{conditionChipLabel(c, rounds)}</span>
            <span className="sr-only">
              {rounds != null
                ? `${formatConditionName(c)}, ${rounds} round${rounds === 1 ? '' : 's'} remaining`
                : formatConditionName(c)}
            </span>
            {onRemove && (
              <button
                type="button"
                className={styles.remove}
                aria-label={
                  combatantName
                    ? `Remove ${formatConditionName(c)} from ${combatantName}`
                    : `Remove ${formatConditionName(c)}`
                }
                disabled={removeDisabled}
                onClick={() => onRemove(c)}
              >
                <Icon name="Close" size={9} aria-hidden />
              </button>
            )}
          </Pill>
        );
      })}
    </div>
  );
}
