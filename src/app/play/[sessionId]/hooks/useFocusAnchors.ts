'use client';

/**
 * TAV-PLAY-SHELL step 5 — `useFocusAnchors` (decomposition plan §2.2 /
 * §1.13, Amendment A A7). Owns the small cluster of stable focus-anchor
 * refs used to rescue focus after a control the user was on unmounts out
 * from under them, plus the two rAF-after-commit stranding-rescue effects
 * and the adjacent rising-edge toast that share the same
 * begin-encounter-button lifecycle (all eight were declared side-by-side
 * in page.tsx as one cluster — plan §1.13 — and moving five while leaving
 * three behind would split one concern across two files for no reason).
 *
 * Composed AFTER `useCombatState` (row 5) and `useSceneState` (row 6) in
 * page.tsx — both effects below read `isDying`/`combatId`
 * (useCombatState) and `sceneHasEncounter`/`sceneHeadRef` (useSceneState)
 * as plain downward params — and BEFORE `useCombatActions` (row 10), which
 * takes `composerRailAnchorRef`/`dmPanelAnchorRef` from this hook's return
 * as plain params, same shape as every other cross-hook ref threaded
 * through that call.
 *
 * REGISTRATION ORDER (Miko-QA + Kage-CR, A7): extracting these three
 * effects moved them from mount-effect positions 14-16 of 16 to 6-8 --
 * they now register BEFORE the mount-load effect, the events poll and both
 * useCombatActions effects. Registration order IS rAF scheduling order, so
 * it decides which rescue wins a same-commit focus-strand tie with
 * useCombatActions' own turn-flip rescue. That is safe, and the reason that
 * holds LOCALLY is: every one of these rescues is gated on
 * `document.activeElement === document.body` inside its own rAF, so
 * whichever fires first wins and the rest are no-ops -- and in the one
 * plausible collision (a death-save stabilize) both rescues target the same
 * `composerRailAnchorRef`. Two narrower reasons also hold TODAY but depend
 * on code this file doesn't own, so don't rely on them: the engine never
 * advances the turn on a death save (engine/combat.py::make_death_save
 * touches `active_participant_id` zero times), and the turn-flip rescue
 * early-returns on `prev == null` (useCombatActions.ts:629), excluding a
 * fresh encounter's first active-participant assignment. None of these
 * three effects has a cleanup, so teardown order is a non-issue. A FOURTH
 * rescue effect added here must keep the stranding gate, or the ordering
 * stops being harmless.
 *
 * `dialogRef`/Tab-trap `onKeyDown` are NOT here — those are `<Drawer>`'s
 * own concern (step 2), unrelated to this cluster.
 */
import { useEffect, useRef, type MutableRefObject } from 'react';
import { useToast } from '@/components/Toast';

export interface UseFocusAnchorsResult {
  endCombatBtnRef: MutableRefObject<HTMLButtonElement | null>;
  lastOpenerRef: MutableRefObject<HTMLButtonElement | null>;
  beginCombatRef: MutableRefObject<HTMLButtonElement | null>;
  composerRailAnchorRef: MutableRefObject<HTMLDivElement | null>;
  dmPanelAnchorRef: MutableRefObject<HTMLElement | null>;
  composerTextareaAnchorRef: MutableRefObject<HTMLTextAreaElement | null>;
}

export function useFocusAnchors(
  isDying: boolean,
  sceneHasEncounter: boolean,
  combatId: string | null,
  sceneHeadRef: MutableRefObject<HTMLDivElement | null>,
  // TAV-PLAY-SHELL step 6b, commit C3 (carry (b), Iro MEDIUM-3 re-home):
  // drives the composer-refocus rescue below. Composer.tsx can no longer
  // own this itself once `combat`/ActionBar leaves its props.
  combatIsActive: boolean,
): UseFocusAnchorsResult {
  const { toast } = useToast();

  // Tora MAJOR-2: ref for the "End" trigger button so focus returns to it
  // when the outcome chooser is closed via Escape.
  const endCombatBtnRef = useRef<HTMLButtonElement>(null);
  // Iro MAJOR-1: the outcome chooser now has two openers ("End" and "Wrap
  // up") — capture whichever one actually opened it so Escape/Cancel
  // refocus the real opener instead of always the "End" button.
  // `endCombatBtnRef` stays as the fallback (e.g. if the chooser is ever
  // opened programmatically).
  const lastOpenerRef = useRef<HTMLButtonElement | null>(null);

  // TAV-COMBAT-VERB-NO-MECHANICS — the "Stand and fight" button itself, so
  // a refused combat-verb declaration (page.tsx's onSend) can move focus
  // onto it — the prompt half of refuse-and-prompt.
  const beginCombatRef = useRef<HTMLButtonElement>(null);

  // Tora MAJOR-2: rail button anchors for the turn-flip refocus rescue —
  // owned by useCombatActions, which takes both as plain params. A
  // disabled rail button force-blurs to <body>; these anchor the
  // newly-enabled rail so refocus can land there instead of a full re-tab.
  const composerRailAnchorRef = useRef<HTMLDivElement>(null);
  const dmPanelAnchorRef = useRef<HTMLElement>(null);

  // Iro MEDIUM-3 (re-homed from Composer.tsx, TAV-PLAY-SHELL step 6b
  // commit C3, carry (b) — ActionBar's lift out of Composer): registers
  // the composer textarea as a stable anchor so the rescue below can
  // refocus it, mirroring composerRailAnchorRef/dmPanelAnchorRef above.
  const composerTextareaAnchorRef = useRef<HTMLTextAreaElement>(null);

  // TAV-BUSY-DISABLED-FOCUS-PARK (1.7 audit): the "Roll death save" row —
  // button AND pips — is gated purely on `isDying`, so the roll that SAVES
  // you unmounts the control you just pressed and drops focus to <body>.
  // Gated on the stranding check alone — it can only ever fire when focus
  // is ALREADY lost, so it needs no provenance flag and can never steal
  // focus from anywhere. The rail anchor survives — only the deathSaveRow
  // child unmounts.
  const prevIsDyingRef = useRef(false);
  useEffect(() => {
    const was = prevIsDyingRef.current;
    prevIsDyingRef.current = isDying;
    if (!was || isDying) return;
    requestAnimationFrame(() => {
      if (document.activeElement !== document.body) return;
      composerRailAnchorRef.current?.focus({ preventScroll: true });
    });
  }, [isDying]);

  // Iro-A11y MAJOR-2 — the "Begin an encounter"->"Stand and fight" reframe:
  // rising-edge toast (the button's own render gate is `sceneHasEncounter`
  // in page.tsx's JSX, unchanged, and NOT wrapped in a live region itself —
  // that would double-announce on mount).
  const prevSceneHasEncounterRef = useRef(sceneHasEncounter);
  useEffect(() => {
    if (sceneHasEncounter && !prevSceneHasEncounterRef.current && !combatId) {
      toast({
        tone: 'warn',
        message: 'This scene can turn into a fight — "Stand and fight" is ready when you are.',
      });
    }
    prevSceneHasEncounterRef.current = sceneHasEncounter;
  }, [sceneHasEncounter, combatId, toast]);

  // Iro-A11y CRITICAL-1 — focus-strand on unmount. `sceneHasEncounter` is
  // ALSO the "Begin an encounter" button's mount condition (not just a copy
  // signal), so the button can disappear out from under a focused user: a
  // background poll/grounding refresh moving the scene to one with no
  // encounter, OR the button's own successful click, can both unmount it.
  // Falling-edge (true -> false) rescue, same rAF-after-commit +
  // activeElement===body check as the effect above — no single triggering
  // gesture to race here (poll, click and scene-advance can each flip
  // visibility independently), so it watches the computed visibility
  // itself rather than a click-captured flag.
  const beginEncounterVisibleRef = useRef(false);
  useEffect(() => {
    const nowVisible = !combatId && sceneHasEncounter;
    if (beginEncounterVisibleRef.current && !nowVisible) {
      requestAnimationFrame(() => {
        if (document.activeElement === document.body) {
          sceneHeadRef.current?.focus();
        }
      });
    }
    beginEncounterVisibleRef.current = nowVisible;
  }, [combatId, sceneHasEncounter, sceneHeadRef]);

  // Iro MEDIUM-3 (re-homed from Composer.tsx, TAV-PLAY-SHELL step 6b
  // commit C3): when ActionBar unmounts (combat ends), keyboard focus is
  // dropped to <body> — fire from the SAME `combatIsActive` falling edge
  // Composer's own prior `combat === null` transition fired from (the two
  // are driven by the same state one hop up). Moved VERBATIM — unconditional,
  // synchronous (no rAF/stranding gate, unlike the three effects above):
  // Composer's original effect never checked `document.activeElement`
  // either (its comment claimed to, the code didn't), and this is a
  // behaviour-preserving relocation, not a redesign of the rescue itself.
  const prevCombatIsActiveRef = useRef(combatIsActive);
  useEffect(() => {
    const was = prevCombatIsActiveRef.current;
    prevCombatIsActiveRef.current = combatIsActive;
    if (was && !combatIsActive) {
      composerTextareaAnchorRef.current?.focus();
    }
  }, [combatIsActive]);

  return {
    endCombatBtnRef,
    lastOpenerRef,
    beginCombatRef,
    composerRailAnchorRef,
    dmPanelAnchorRef,
    composerTextareaAnchorRef,
  };
}
