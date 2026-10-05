'use client';
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import DmOverrideModal from '@/components/DmOverrideModal';
import type { LogRow } from '@/components/ChatLog';
import { useLastAliveHp } from '@/lib/useLastAliveHp';
import type { CombatState } from '@/lib/api/types';
import { isFightHeld, isFightLive } from './format';

/**
 * The DM override dialog's ONE mount (TPK-HOLD W3; Aoi's Revive spec 1: "lifted to the page, and the panel's button and the strip's button
 * call the same instance"). It used to be mounted inside DmNarrationPanel, so it existed only while that panel did. It now sits above the
 * whole shell, and every opener (the panel's DM Override and Revive…, the held strip's Revive…) asks this host to open it through
 * `useOverrideDialog()`. A tenth opener is a call, not a form.
 *
 * The context value is `null` for any seat that cannot override (not the human DM, or no live fight): an opener reads that as "not mine
 * to show", which is also how the stage knows whether to draw the DM's held strip or the waiting line. The engine's 404 stays the authority.
 */
export interface OverrideRequest {
  /** 'revive' opens on Revive; absent opens on Attack. */
  kind?: 'revive';
  /** Preselect this participant (a revive's fallen character). */
  targetId?: string | null;
  /** Where focus goes on close when the opener is no longer in the page. Absent: the scene head. Never <body>. */
  fallback?: () => HTMLElement | null | undefined;
}

export interface OverrideDialog {
  open: (request?: OverrideRequest) => void;
  /** The dialog is up. The held strip's End combat does not open its confirm over it. */
  isOpen: boolean;
}

const OverrideDialogContext = createContext<OverrideDialog | null>(null);

/** The opener's handle, or null when this seat cannot override. */
export function useOverrideDialog(): OverrideDialog | null {
  return useContext(OverrideDialogContext);
}

const NO_PARTICIPANTS: CombatState['participants'] = [];

export interface OverrideDialogHostProps {
  children: ReactNode;
  isHumanDM: boolean;
  combatId: string | null;
  combatState: CombatState | null;
  dmUsername: string;
  appendLog: (row: Omit<LogRow, 'id' | 'ts'>) => void;
  onStateUpdate: (state: CombatState) => void;
  onStateRefresh: () => void;
  /** The scene head: where focus lands when the opener has left the page. */
  fallbackFocus: () => HTMLElement | null | undefined;
}

export function OverrideDialogHost({
  children,
  isHumanDM,
  combatId,
  combatState,
  dmUsername,
  appendLog,
  onStateUpdate,
  onStateRefresh,
  fallbackFocus,
}: OverrideDialogHostProps) {
  const [request, setRequest] = useState<OverrideRequest | null>(null);
  // Kept for the whole tab, not just while the dialog is open: Revive's default is the HP this tab last SAW them alive with.
  const lastAliveHp = useLastAliveHp(combatState?.participants ?? NO_PARTICIPANTS);
  const enabled = isHumanDM && !!combatId && isFightLive(combatState);
  const dialog = useMemo<OverrideDialog | null>(() => (enabled ? { open: (r = {}) => setRequest(r), isOpen: request !== null } : null), [enabled, request]);
  // The fight ending (or the seat losing the DM) takes the dialog with it; a request left behind would reopen it with the next fight.
  if (!enabled && request) setRequest(null);

  return (
    <OverrideDialogContext.Provider value={dialog}>
      {children}
      {enabled && combatState && (
        <DmOverrideModal
          open={request !== null}
          combatId={combatId}
          participants={combatState.participants}
          defaultActorId={combatState.active_participant_id}
          onSuccess={(message, newState) => {
            setRequest(null);
            // The amber ruling row, as the panel always wrote it (ChatLog renders kind 'dm_override' distinctly).
            appendLog({ who: `DM (${dmUsername})`, kind: 'dm_override', text: `DM ruled: ${message}` });
            if (newState) onStateUpdate(newState);
          }}
          onClose={() => setRequest(null)}
          initialKind={request?.kind}
          initialTargetId={request?.targetId}
          held={isFightHeld(combatState)}
          lastAliveHp={lastAliveHp}
          onRefresh={onStateRefresh}
          fallbackFocus={() => request?.fallback?.() ?? fallbackFocus()}
        />
      )}
    </OverrideDialogContext.Provider>
  );
}
