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
 * A9d-2 F2 (build brief §5, Iro A9d-1 MINOR-2): a LAYOUT change can strand focus too. The one move React cannot keep
 * is a node that lands somewhere `inert` (Table's docked sheet becoming the closed phone drawer) or an element that
 * stops existing (the stage's fold handle going inert at desktop width): focus drops to <body>. One more rescue:
 * when the resolved layout id changes and the control focus was on has been REMOVED (see `useRemovedFocus`), the scene
 * head takes it. The head is outside every fold body (F1), so it is always there to take it.
 *
 * A9d-2 fix round 4 (Kage I-C): all three rescues that used to wait a frame and ask "is focus on <body>?" now ask the commit-tied question
 * "was the control focus was on removed?" (`useRemovedFocus`), in a layout effect, with no frame. "<body>" alone is also what a cold load looks like:
 * the layout rescue put a ring on the scene heading in 6 of 8 cold loads (Table preference, motion allowed). The three are: the death-save row's
 * falling edge, the begin-encounter button's, and the layout change. (The stranding gate in the REGISTRATION ORDER paragraph above is now
 * "the focused control was removed", which is stricter: a rescue can no longer fire when nothing was lost.)
 * NOT when the layout changed because the MOMENT did (Auto: combat starting or ending flips Story <-> Table): that
 * flip has rescues of its own (the begin-encounter and turn-flip ones above), scoped to a LOCAL cause, and a poll
 * that starts another player's fight must not move a user who is on <body> (Iro CRITICAL-1's provenance rule;
 * play.solo-dm-cast-rail pins both).
 *
 * `dialogRef`/Tab-trap `onKeyDown` are NOT here — those are `<Drawer>`'s
 * own concern (step 2), unrelated to this cluster.
 */
import { useEffect, useLayoutEffect, useRef, type MutableRefObject } from 'react';
import { useToast } from '@/components/Toast';
import type { LayoutId } from '../presets';
import { useRemovedFocus } from './useRemovedFocus';

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
  // A9d-2 F2: the resolved layout id (`usePlayLayout`), the trigger of the layout-change rescue below.
  layoutId: LayoutId,
): UseFocusAnchorsResult {
  const { toast } = useToast();
  const focusWasRemoved = useRemovedFocus();

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
  useLayoutEffect(() => {
    const was = prevIsDyingRef.current;
    prevIsDyingRef.current = isDying;
    if (!was || isDying) return;
    if (focusWasRemoved()) composerRailAnchorRef.current?.focus({ preventScroll: true });
  }, [isDying, focusWasRemoved]);

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
  useLayoutEffect(() => {
    const nowVisible = !combatId && sceneHasEncounter;
    if (beginEncounterVisibleRef.current && !nowVisible && focusWasRemoved()) sceneHeadRef.current?.focus();
    beginEncounterVisibleRef.current = nowVisible;
  }, [combatId, sceneHasEncounter, sceneHeadRef, focusWasRemoved]);

  // Iro MEDIUM-3 (re-homed from Composer.tsx, TAV-PLAY-SHELL step 6b
  // commit C3): when ActionBar unmounts (combat ends), keyboard focus is
  // dropped to <body> — fire from the SAME `combatIsActive` falling edge
  // Composer's own prior `combat === null` transition fired from (the two
  // are driven by the same state one hop up). Synchronous (no rAF, unlike
  // the three effects above: a layout-effect-time commit has already removed
  // the unmounted ActionBar, so `activeElement` is settled by now). A9b fix
  // round 1 (Min-7, Kage): it was moved verbatim from Composer UNGATED, and
  // Composer's own comment claimed a `document.activeElement` check the code
  // never had — so a human DM typing in another field when combat ended had
  // focus pulled into the composer. Now it rescues only STRANDED focus
  // (<body>/null), the same gate as the other rescues in this file.
  const prevCombatIsActiveRef = useRef(combatIsActive);
  useEffect(() => {
    const was = prevCombatIsActiveRef.current;
    prevCombatIsActiveRef.current = combatIsActive;
    if (was && !combatIsActive) {
      const active = document.activeElement;
      if (active == null || active === document.body) {
        composerTextareaAnchorRef.current?.focus();
      }
    }
  }, [combatIsActive]);

  // A9d-2 F2 — see the header. Not on the first render (nothing changed), only on an id change.
  const prevLayoutRef = useRef({ layoutId, combatIsActive });
  useLayoutEffect(() => {
    const was = prevLayoutRef.current;
    prevLayoutRef.current = { layoutId, combatIsActive };
    if (was.layoutId === layoutId || was.combatIsActive !== combatIsActive) return;
    if (focusWasRemoved()) sceneHeadRef.current?.focus({ preventScroll: true });
  }, [layoutId, combatIsActive, sceneHeadRef, focusWasRemoved]);

  return {
    endCombatBtnRef,
    lastOpenerRef,
    beginCombatRef,
    composerRailAnchorRef,
    dmPanelAnchorRef,
    composerTextareaAnchorRef,
  };
}
