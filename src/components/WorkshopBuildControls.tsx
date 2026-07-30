'use client';
/**
 * WorkshopBuildControls — LVLDN: level down / reset for a WORKSHOP build.
 *
 * Renders NOTHING unless the sheet's SERVER verdict says workshop mode
 * (`levelup_policy.mode === 'workshop'`) and level > 1 — fail-closed: a
 * missing policy (pre-upgrade backend) hides the controls rather than
 * offering an op the engine will refuse. Bound characters never see this;
 * their level moves through play, floors, and the DM.
 *
 * Semantics (rebuild-and-walk, Leon-accepted 2026-07-29): the engine
 * rebuilds the build at the target level from its creation identity —
 * HP becomes the deterministic average, ability scores return to creation
 * values (recorded ASI increases subtracted), and every level choice from
 * the climb re-opens as a pending choice. Gear, gold and the spell
 * repertoire SURVIVE (Forget in the spellbook is the swap path — and the
 * reason a down/up cycle can never over-learn: the engine's learn budget
 * counts kept spells).
 *
 * Both buttons always confirm (irreversible), ConfirmDialog tone=danger.
 * Dialog stays open on a refusal (the CampaignFloorPanel convention) —
 * EXCEPT walk_incomplete, where the rebuild really happened but stopped
 * below target: close, refetch, and point at the Level-up button.
 */
import { useRef, useState } from 'react';
import Button from '@/components/Button';
import ConfirmDialog from '@/components/ConfirmDialog';
import Icon from '@/components/Icon';
import { useToast } from '@/components/Toast';
import { getCharacterSheet, rebuildCharacter } from '@/lib/api/dnd';
import type { ApiError, CharacterSheet } from '@/lib/api/types';
import styles from './WorkshopBuildControls.module.css';

function isApiError(e: unknown): e is ApiError {
  return e instanceof Error && 'status' in e;
}

function refusalReason(e: unknown): string | undefined {
  if (!isApiError(e)) return undefined;
  const body = e.body as { data?: { reason?: string } } | null | undefined;
  return body?.data?.reason;
}

// Deterministic refusals (the engine owns every rule — see
// NekoNova-DnDEngine routes/characters.py::rebuild_character_route).
const REBUILD_REFUSAL_COPY: Record<string, string> = {
  bound_to_campaign:
    'This character is seated at a table — leave the campaign to edit the build.',
  invalid_target_level: 'That level isn’t below the current one.',
  creation_scores_unavailable:
    'This build predates rebuild support — its creation ability scores can’t be recovered.',
  asi_history_incomplete:
    'An already-applied Ability Score Improvement predates rebuild support and can’t be unpicked.',
  rebuild_failed: 'The rebuild was refused — reload and try again.',
  not_found: 'Character not found — reload and try again.',
  walk_incomplete:
    'The rebuild stopped partway — your character is safe at a lower level. Use Level up to finish the climb.',
};

function rebuildErrorMessage(err: unknown): string {
  return (
    REBUILD_REFUSAL_COPY[refusalReason(err) ?? ''] ??
    'Could not rebuild the character. Try again in a moment.'
  );
}

export interface WorkshopBuildControlsProps {
  characterId: string;
  username: string;
  sheet: CharacterSheet;
  /** Fired with the freshly-refetched sheet (the LevelUpButton onLeveledUp
   *  contract) — the parent re-renders every panel off the new state. */
  onRebuilt: (updated: CharacterSheet) => void;
  className?: string;
}

export default function WorkshopBuildControls({
  characterId,
  username,
  sheet,
  onRebuilt,
  className,
}: WorkshopBuildControlsProps) {
  const { toast } = useToast();
  const [confirmTarget, setConfirmTarget] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  /** Synchronous double-submit latch (the LevelUpButton D1 pattern). */
  const rebuildBusyRef = useRef(false);

  const policy = sheet.levelup_policy;
  // Fail-closed render gate — see the header comment.
  if (!policy || policy.mode !== 'workshop' || sheet.level <= 1) return null;

  async function confirmRebuild(target: number) {
    if (rebuildBusyRef.current) return;
    rebuildBusyRef.current = true;
    setBusy(true);
    try {
      try {
        await rebuildCharacter(characterId, username, target);
      } catch (err) {
        if (refusalReason(err) === 'walk_incomplete') {
          // The rebuild HAPPENED but the re-climb stopped early — the build
          // is coherent at a lower level. Close, refresh, point forward;
          // "try again" would be a lie (target < level no longer holds).
          setConfirmTarget(null);
          toast({ message: REBUILD_REFUSAL_COPY.walk_incomplete, tone: 'warn' });
          try {
            onRebuilt(await getCharacterSheet(characterId, username));
          } catch {
            toast({
              message: "Couldn't refresh your sheet — reload to see the result.",
              tone: 'warn',
            });
          }
          return;
        }
        // Dialog stays open on a plain refusal (CampaignFloorPanel
        // convention) — the toast explains, the user can adjust or cancel.
        toast({ message: rebuildErrorMessage(err), tone: 'error' });
        return;
      }

      setConfirmTarget(null);
      try {
        const after = await getCharacterSheet(characterId, username);
        const pending = after.pending_choices?.length ?? 0;
        toast({
          title: target === 1 ? 'Reset to level 1' : `Leveled down to ${target}`,
          message:
            pending > 0
              ? `${after.name} rebuilt — ${pending} choice${pending === 1 ? ' is' : 's are'} waiting on the sheet.`
              : `${after.name} rebuilt.`,
          tone: 'success',
        });
        onRebuilt(after);
      } catch {
        toast({
          message: "Couldn't refresh your sheet — reload to see the result.",
          tone: 'warn',
        });
      }
    } finally {
      rebuildBusyRef.current = false;
      setBusy(false);
    }
  }

  const downTarget = sheet.level - 1;

  return (
    <>
      <div className={`${styles.wrap} ${className ?? ''}`}>
        <Button
          variant="ghost"
          leadingIcon={<Icon name="History" size={14} aria-hidden />}
          disabled={busy}
          onClick={() => setConfirmTarget(downTarget)}
        >
          Level down
        </Button>
        {/* At level 2, down and reset are the same op — one button. */}
        {sheet.level > 2 && (
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => setConfirmTarget(1)}
          >
            Reset to level 1
          </Button>
        )}
        <span className={styles.reason}>
          Workshop build editing — a rebuild re-opens your level choices.
        </span>
      </div>

      <ConfirmDialog
        open={confirmTarget != null}
        tone="danger"
        title={
          confirmTarget === 1
            ? `Reset ${sheet.name} to level 1?`
            : `Level ${sheet.name} down to ${confirmTarget}?`
        }
        body={
          <>
            {sheet.name} will be REBUILT at level {confirmTarget}: HP becomes
            the average, ability scores return to their creation values, and
            the subclass / Ability Score Improvement / spell picks from the
            climb re-open as pending choices. Gear, gold and learned spells
            stay (use Forget in the spellbook to swap picks). This
            can&rsquo;t be undone.
          </>
        }
        confirmLabel={
          confirmTarget === 1 ? 'Yes, reset to 1' : `Yes, down to ${confirmTarget}`
        }
        cancelLabel="Keep the build"
        busy={busy}
        onConfirm={() => {
          if (confirmTarget != null) void confirmRebuild(confirmTarget);
        }}
        onCancel={() => setConfirmTarget(null)}
      />
    </>
  );
}
