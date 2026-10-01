'use client';

import type { CombatState, Participant } from '@/lib/api/types';
import PartyPanel from '@/components/PartyPanel';
import InitiativeTracker from '@/components/InitiativeTracker';
import RebindCharacterButton from '@/components/RebindCharacterButton';
import type { RegionVariant } from '../variants';
import styles from '../Play.module.css';

/**
 * TAV-PLAY-SHELL step 3 — pure region extraction. PartyPanel + the rebind
 * affordances + InitiativeTracker, moved verbatim (decomposition plan
 * §2.3: "survives as-is: PartyPanel + InitiativeTracker composed"). Does
 * NOT own the `<aside id="play-pane-party" aria-label="Party and
 * initiative">` landmark itself — that wrapper (and the session-head
 * content above it, TopBar's eventual home) stays in page.tsx for now,
 * since no single region owns the whole landmark yet; this is the party
 * roster's own content, placed inside it.
 *
 * A9c-2 D1 (build brief 6): consumes its `variant` (the registry's union, not
 * a hand-written copy). `rail` and `strip` are two presentations of the same
 * three children, which stay mounted either way (InitiativeTracker holds two
 * live regions, R3). The rebind row follows: per-member rows in a rail; one
 * compact button per member in a strip, the name kept only for the DM, who
 * rebinds other members and needs to tell the buttons apart.
 */
export interface PartyStripProps {
  participants: Participant[];
  selfUsername: string | null;
  combatState: CombatState | null;
  onSelectMember: (p: Participant) => void;
  isDm: boolean;
  sessionId: string;
  combatIsActive: boolean;
  sessionLocked: boolean;
  onRebindChanged: () => void;
  round: number | null;
  selfPcId: string | null;
  variant?: RegionVariant<'partyStrip'>;
}

export default function PartyStrip({
  participants,
  selfUsername,
  combatState,
  onSelectMember,
  isDm,
  sessionId,
  combatIsActive,
  sessionLocked,
  onRebindChanged,
  round,
  selfPcId,
  variant = 'rail',
}: PartyStripProps) {
  return (
    <div data-region="partyStrip" data-variant={variant}>
      <PartyPanel
        variant={variant}
        participants={participants}
        selfUsername={selfUsername}
        combatState={combatState}
        onSelectMember={onSelectMember}
      />
      {/* B2-4: rebind affordances — one "Change character" button per party
          row. Self sees their own row's button always; DM sees all rows. */}
      {participants.length > 0 && (
        <div className={variant === 'strip' ? `${styles.rebindSection} ${styles.rebindStrip}` : styles.rebindSection}>
          {participants.map((p) => {
            // Non-DM players only see the button on their own row.
            const isSelf = p.username.toLowerCase() === (selfUsername ?? '').toLowerCase();
            if (!isSelf && !isDm) return null;
            return (
              <div key={p.username} className={styles.rebindRow}>
                <span className={variant === 'strip' && !isDm ? 'sr-only' : styles.rebindName}>
                  {p.character?.name ?? p.username}
                </span>
                <RebindCharacterButton
                  sessionId={sessionId}
                  targetUsername={p.username}
                  selfUsername={selfUsername ?? ''}
                  isDm={isDm}
                  combatActive={combatIsActive && combatState?.state === 'active'}
                  // DDX-25 R2 (D2-D4): a paused/ended session must not allow
                  // a rebind either — mirrors every other player-action gate
                  // (Composer, combat rail, skill check, Move on, DiceTray)
                  // which all extend `sessionLocked`.
                  sessionLocked={sessionLocked}
                  onChanged={onRebindChanged}
                />
              </div>
            );
          })}
        </div>
      )}
      {/* ADV-7/8: structured tracker when combatState available; legacy shim otherwise. */}
      {combatState && combatState.participants.length > 0 ? (
        <InitiativeTracker
          participants={combatState.participants}
          round={round}
          selfParticipantId={selfPcId}
          variant={variant}
        />
      ) : null}
    </div>
  );
}
