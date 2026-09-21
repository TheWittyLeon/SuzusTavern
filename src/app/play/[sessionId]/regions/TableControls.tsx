'use client';

import type { Dispatch, RefObject, SetStateAction } from 'react';
import type { CombatState, Participant } from '@/lib/api/types';
import type { LogRow } from '@/components/ChatLog';
import Icon from '@/components/Icon';
import GrantCurrencyPanel from '@/components/GrantCurrencyPanel';
import CampaignFloorPanel from '@/components/CampaignFloorPanel';
import DmNarrationPanel from '@/components/DmNarrationPanel';
import ConditionsPanel from '@/components/ConditionsPanel';
import { consumeEscape } from '@/lib/a11y/escapeConsume';
import styles from '../Play.module.css';

/**
 * TAV-PLAY-SHELL step 3 — pure region extraction. Two named exports, not
 * one component: today's DOM has "Session controls" as a direct child of
 * the party `<aside>` and "DM controls" as a direct child of the story
 * `<main>` — two different parents, not adjacent JSX, so one component
 * instance cannot render both without either a portal (a behavior change)
 * or a wrapping element around both (a DOM change) — both of which step 3
 * forbids ("identical DOM... this step moves JSX only"). Both groups are
 * "TableControls" as a CONCERN (DM-only tooling, decomposition plan §2.3);
 * step 10 ("TableControls as a layer — DM group out of the left column,
 * D1") is what actually gets to render them as one positioned unit, once
 * they're no longer constrained to their current parents. Until then this
 * file is where both live, called twice from page.tsx at their existing
 * positions.
 *
 * I4 (Kage-CR/Miko-QA, 2026-09-21 review): the two exports used to share
 * ONE `data-region="tableControls"` value — inert today, but Miko's
 * sharper read: step 6's Guard 2 ("the same set of data-region ids is
 * mounted every time"), if implemented as a naive id Set, cannot
 * distinguish "both present" from "one of the two vanished" when two
 * INDEPENDENTLY gated nodes (isDm vs isHumanDM&&combatIsActive&&...) share
 * an id — either could vanish on its own without the other, and a Set
 * comparison would see the same total either way. Split into
 * `tableControlsSession` / `tableControlsDm` — distinct, independently
 * trackable, matching that they really are two independent conditions.
 *
 * Deliberately does NOT include CastSpellPanel, even though the
 * decomposition plan's §2.3 region table lists it alongside these five —
 * checked the actual gate (`(isDmPlayingOwnPc || !isHumanDM) && ...`) and
 * it renders for a REGULAR PLAYER's own spellcasting (`!isHumanDM`), not
 * just a DM's. Its own JSX carries `aria-label="Your character's
 * controls"`, a different landmark from these two DM-only ones. Folding it
 * in here would cut off spellcasting for every non-DM caster the moment
 * step 10's layer gate applies. Left in page.tsx; it belongs nearer
 * ActionBar (step 8) or its own region, not here.
 */

export interface SessionControlsProps {
  isDm: boolean;
  sessionActionBusy: 'pause' | 'resume' | 'end' | 'xp' | null;
  isEnded: boolean;
  isPaused: boolean;
  onTogglePause: () => void;
  onEndSessionRequest: () => void;
  xpToggleBtnRef: RefObject<HTMLButtonElement | null>;
  xpFormOpen: boolean;
  setXpFormOpen: Dispatch<SetStateAction<boolean>>;
  xpAmount: string;
  setXpAmount: Dispatch<SetStateAction<string>>;
  xpReason: string;
  setXpReason: Dispatch<SetStateAction<string>>;
  xpAmountValid: boolean;
  onAwardXp: () => void;
  sessionId: string;
  participants: Participant[];
  username: string | null;
  startingLevel: number;
  onCampaignFloorChanged: () => void;
}

/** DDX-25: DM-only session lifecycle controls (Pause/Resume, End, Award
 *  XP) + GrantCurrencyPanel + CampaignFloorPanel. Renders as a direct child
 *  of the party `<aside>`, exactly where it lives today. */
export function SessionControls({
  isDm,
  sessionActionBusy,
  isEnded,
  isPaused,
  onTogglePause,
  onEndSessionRequest,
  xpToggleBtnRef,
  xpFormOpen,
  setXpFormOpen,
  xpAmount,
  setXpAmount,
  xpReason,
  setXpReason,
  xpAmountValid,
  onAwardXp,
  sessionId,
  participants,
  username,
  startingLevel,
  onCampaignFloorChanged,
}: SessionControlsProps) {
  if (!isDm) return null;
  return (
    <div
      className={styles.sessionControls}
      role="group"
      aria-label="Session controls"
      data-region="tableControlsSession"
    >
      <div className={styles.sessionControlsLabel}>Session</div>
      <div className={styles.sessionControlsBtns}>
        <button
          type="button"
          className={styles.sessionControlBtn}
          onClick={onTogglePause}
          disabled={sessionActionBusy !== null || isEnded}
          aria-busy={sessionActionBusy === 'pause' || sessionActionBusy === 'resume'}
        >
          <Icon name="Pulse" size={13} aria-hidden />
          {sessionActionBusy === 'pause'
            ? 'Pausing…'
            : sessionActionBusy === 'resume'
              ? 'Resuming…'
              : isPaused
                ? 'Resume'
                : 'Pause'}
        </button>
        <button
          type="button"
          className={`${styles.sessionControlBtn} ${styles.sessionControlBtnDanger}`}
          onClick={onEndSessionRequest}
          disabled={sessionActionBusy !== null || isEnded}
        >
          <Icon name="Power" size={13} aria-hidden />
          End session
        </button>
        <button
          ref={xpToggleBtnRef}
          type="button"
          className={styles.sessionControlBtn}
          onClick={() => setXpFormOpen((v) => !v)}
          disabled={sessionActionBusy !== null || isEnded}
          aria-haspopup="true"
          aria-expanded={xpFormOpen}
        >
          <Icon name="Sparkle" size={13} aria-hidden />
          Award XP
        </button>
      </div>
      {xpFormOpen && (
        <form
          className={styles.xpForm}
          aria-label="Award session XP"
          // TAV-A11Y-USE-ESCAPE-CONSUME-HOOK: stopPropagation is
          // unconditional; only the actual dismiss stays gated on
          // sessionActionBusy==='xp' (an in-flight award shouldn't be
          // dismissable mid-request).
          onKeyDown={(e) =>
            consumeEscape(e, {
              onClose: () => setXpFormOpen(false),
              canClose: sessionActionBusy !== 'xp',
              onRefocus: () => xpToggleBtnRef.current?.focus(),
            })
          }
          onSubmit={(e) => {
            e.preventDefault();
            onAwardXp();
          }}
        >
          <label className={`label ${styles.xpLabel}`} htmlFor="xp-amount-input">
            XP amount
          </label>
          <input
            id="xp-amount-input"
            className="input"
            type="number"
            min={1}
            step={1}
            inputMode="numeric"
            value={xpAmount}
            disabled={sessionActionBusy === 'xp'}
            onChange={(e) => setXpAmount(e.target.value)}
          />
          <label className={`label ${styles.xpLabel}`} htmlFor="xp-reason-input">
            Reason (optional)
          </label>
          <input
            id="xp-reason-input"
            className="input"
            type="text"
            value={xpReason}
            disabled={sessionActionBusy === 'xp'}
            onChange={(e) => setXpReason(e.target.value)}
          />
          <div className={styles.xpFormBtns}>
            <button
              type="submit"
              className={styles.sessionControlBtn}
              disabled={sessionActionBusy === 'xp' || !xpAmountValid}
              aria-busy={sessionActionBusy === 'xp'}
            >
              {sessionActionBusy === 'xp' ? 'Awarding…' : 'Award'}
            </button>
            <button
              type="button"
              className={styles.sessionControlBtn}
              disabled={sessionActionBusy === 'xp'}
              onClick={() => {
                setXpFormOpen(false);
                xpToggleBtnRef.current?.focus();
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
      {/* T12 (DDX-23t): session-scoped, not combat-scoped — same isDm
          "Session controls" group as Award XP. */}
      <GrantCurrencyPanel
        sessionId={sessionId}
        participants={participants}
        disabled={sessionActionBusy !== null || isEnded}
      />
      {/* LVL-1 (T5): floor display/edit + "Apply floor now". Peer of
          GrantCurrencyPanel — same isDm gate, same disabled expression. */}
      <CampaignFloorPanel
        sessionId={sessionId}
        username={username as string}
        participants={participants}
        startingLevel={startingLevel}
        disabled={sessionActionBusy !== null || isEnded}
        onChanged={onCampaignFloorChanged}
      />
    </div>
  );
}

export interface DmCombatControlsProps {
  isHumanDM: boolean;
  combatIsActive: boolean;
  combatState: CombatState | null;
  combatId: string | null;
  sessionId: string;
  dmUsername: string;
  overridePlayerVisible: boolean;
  dmPanelAnchorRef: RefObject<HTMLElement | null>;
  localTurnActionRef: RefObject<boolean>;
  appendLog: (row: Omit<LogRow, 'id' | 'ts'>) => void;
  onCombatStateUpdate: (newState: CombatState) => void;
  onCombatStateRefresh: () => void;
  combatBusy: boolean;
  sessionLocked: boolean;
  onCombatBusyChange: (busy: boolean) => void;
}

/** Tora MAJOR-1: DmNarrationPanel + ConditionsPanel, the DM-side combat
 *  controls — human DM seat only, during active combat. Renders as a direct
 *  child of the story `<main>`, exactly where it lives today. */
export function DmCombatControls({
  isHumanDM,
  combatIsActive,
  combatState,
  combatId,
  sessionId,
  dmUsername,
  overridePlayerVisible,
  dmPanelAnchorRef,
  localTurnActionRef,
  appendLog,
  onCombatStateUpdate,
  onCombatStateRefresh,
  combatBusy,
  sessionLocked,
  onCombatBusyChange,
}: DmCombatControlsProps) {
  if (!(isHumanDM && combatIsActive && combatState && combatId)) return null;
  return (
    <div role="group" aria-label="DM controls" className={styles.dmControlsGroup} data-region="tableControlsDm">
      {/* S5.3 + S5.4: monster control panel — human DM seat only, during active combat. */}
      <DmNarrationPanel
        combatId={combatId}
        combatState={combatState}
        sessionId={sessionId}
        dmUsername={dmUsername}
        overridePlayerVisible={overridePlayerVisible}
        panelRef={dmPanelAnchorRef}
        localTurnActionRef={localTurnActionRef}
        onMessage={(text) => appendLog({ who: 'Suzu', kind: 'system', text })}
        onOverrideMessage={(text) =>
          appendLog({
            who: `DM (${dmUsername})`,
            kind: 'dm_override',
            text: `DM ruled: ${text}`,
          })
        }
        onStateUpdate={onCombatStateUpdate}
        onStateRefresh={onCombatStateRefresh}
      />
      {/* T7 (DDX-17e): condition apply/remove — human DM seat only, during
          active combat. Mounts alongside DmNarrationPanel (both DM-only,
          not mutually exclusive with it). */}
      <ConditionsPanel
        combatId={combatId}
        dmUsername={dmUsername}
        participants={combatState.participants}
        disabled={combatBusy || sessionLocked}
        onApplied={(text) => appendLog({ who: 'Suzu', kind: 'system', text })}
        onStateRefresh={onCombatStateRefresh}
        onBusyChange={onCombatBusyChange}
      />
    </div>
  );
}
