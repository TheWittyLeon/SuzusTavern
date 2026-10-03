'use client';
// src/components/tactical-map/TacticalMap.tsx
//
// Tactical map (#12), design pass v1 (Aoi-UI) — STANDALONE component (Lane D,
// 2026-09-28 runbook). Not mounted anywhere yet; B8c-3 mounts it as `SceneStage`'s
// body (A10 step 11 made the room). Presentational only: every prop is data
// in or a callback out — no fetching, no engine calls, no combat-action
// wiring (that belongs to whoever mounts this inside `/play`).
//
// HARD RULE (movement design §3.4, Aoi-UI design header, carried through
// every screen): renders from `space` ONLY, never `terrain`/`tactics`/
// `position` — those are DM-only or polymorphic prose that this component
// must never import, let alone read. See
// `src/__tests__/components/tactical-map/TacticalMap.test.tsx`'s guard test.
//
// Leon's T1-T4 rulings (2026-09-28) this component implements:
//   T1 (reach overlay visible to ALL) — the overlay is computed from the
//      ACTIVE participant's `at`/`movement_remaining`, never from
//      `viewerParticipantId`, so any viewer whose caller sets `moveMode`
//      true sees the true mover's reach, not a privileged "my own reach"
//      view. See the `reach`/`reachSet` derivation below.
//   T2 (condition badge = top/worst only) — `worstCondition` (./conditions).
//   T3 (invisible-but-shown = distinct look) — `.tokenInvisible` (dashed
//      outline) + an eye badge, applied whenever `conditions` includes
//      "invisible"; the token still renders at its true `at` (M1).
//   T4 (phone board centers on the active token each turn) — the
//      container-scoped scroll effect keyed on `activeParticipantId` below.
//
// D1 CR#1 fix round (2026-09-28, coordinator decisions in
// [[2026-09-27 Tavern 1.0 Drive — Reviews]] "D1 — consolidated fix round"):
//   1. `refusalReason` deleted — design §4 says the refusal reuses the
//      shell's EXISTING inline slot ("not a new component"); the mount
//      wires that slot, not this one.
//   4. (B8c-3 M1: the strip is gone.) The roving-focused or tapped cell's
//      occupant detail used to be an inspector strip under the board, which
//      cost the board ~100px of its room. It is now the `onInspect` payload:
//      the mount writes it in the scene line (see `InspectLine`, a11y.ts).
//   8. Escape now routes through `consumeEscape` (Tora CRIT-1 = Kage
//      IMPORTANT-3) — see `src/lib/a11y/escapeConsume.ts`.
//
// B8c-1 (2026-09-28, client half of the move verb that doesn't depend on its
// wire shape — [[2026-09-27 Tavern 1.0 Drive — Reviews]] D1 IMPORTANT-8/9,
// B8a IMPORTANT-5):
//   IMP-5. `occupiedByOthers` now excludes the dead (`is_alive === false`),
//      matching the engine ruling landed in B8a
//      (`engine/space.py::SquareSpace.occupied_by`'s docstring +
//      `engine.combat.living_participant_positions`): only LIVING
//      participants occupy a cell; the dead are walkable. A downed-but-alive
//      participant (0 HP, `is_alive: true`) still occupies its cell — that
//      is the engine's `is_active` rule, not an HP check.
//   IMP-9b. `moveSubmitting` (additive, optional) gates a second `onMove`
//      from firing while the caller's own in-flight `/move` request hasn't
//      resolved yet. The guard lives once in `attemptMove` (the one function
//      both the click handler and the Enter/Space keyboard handler call),
//      not duplicated per activation path.
//
// B8c-1 fix-round-2 (2026-09-28, Kage-CR IMPORTANT-3 — [[2026-09-27 Tavern
// 1.0 Drive — Reviews]]): occupancy was encoded twice — `occupiedByOthers`
// below (reach/legality) and `a11y.ts`'s `cellAccessibleName` (the
// accessible-name self-branch, which re-derived "does this occupant occupy"
// from `occupant.dead` independently). The two disagreed on the viewer's OWN
// cell: a dead, non-active viewer's square is a legal move target for
// someone else (IMP-5 above), but the self-narration still said only
// "Current position." `describeOccupant` now computes ONE `occupiesCell`
// fact — `occupiesWhenAlive` (the same predicate `occupiedByOthers` filters
// on) plus the narrow "you are the active mover" carve-out reach/legality
// doesn't need but the self-narration does — and threads it into
// `cellAccessibleName`, which no longer reads `dead` for this decision at
// all. See `occupiesWhenAlive`'s and `describeOccupant`'s own comments below.
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { CombatParticipantState, CombatSpace, SpaceCoordinate } from '@/lib/api/types';
import { consumeEscape } from '@/lib/a11y/escapeConsume';
import { chebyshevCost, coordsEqual, isLegalMoveTarget, isSpaceUsable, reachableCells } from './reach';
import { cellAccessibleName, nextFocusCoord, toDisplayRowCol, type CellNameInput, type CellOccupant, type InspectLine } from './a11y';
import { followAll, followScroll, followTurn, wholeSquareCap, panningWidthCap, FOLLOW_MARGIN_PROPERTY, EDGE_GUARD_PROPERTY, type Box, type FollowTarget, type WindowMetrics } from './follow';
import { worstCondition } from './conditions';
import { formatConditionName } from '@/lib/conditions';
import { useFollowGate } from './useFollowGate';
import TheatreOfMindBand from './TheatreOfMindBand';
import styles from './TacticalMap.module.css';

export interface TacticalMapProps {
  /** The instantiated board this encounter authored, or `null`/`undefined`
   *  for theatre-of-mind (movement design §5: absence of `space`, not a
   *  mode). */
  space: CombatSpace | null | undefined;
  /** Full participant roster, regardless of placement — an unplaced
   *  participant (`at: null`) is simply never drawn on the board. */
  participants: CombatParticipantState[];
  /** The logged-in viewer's own `participant_id`, if they have a character
   *  seated in this combat. Drives the "you" token modifier and the
   *  "Current position" accessible name — never drives which reach is
   *  shown (see T1 above). */
  viewerParticipantId?: string | null;
  /** `CombatState.active_participant_id` — whose reach/turn ring/board
   *  centering this render reflects. */
  activeParticipantId?: string | null;
  /** True while the viewer is in Move-targeting mode: the right to PICK a
   *  square. Gates the destination ring and tag, the cursor, the move-target
   *  accessible names, whether Enter/Space/click on a legal cell calls
   *  `onMove`, and the `target` line. Caller-controlled — this component
   *  never decides on its own that it's "someone's turn to move". B8c-3: it
   *  may be true only for the seat that controls the active turn (the player
   *  whose PC is up); never an observer, never a dead viewer — an observer
   *  sees the reach through `showReach` below, with none of the interaction. */
  moveMode: boolean;
  /** Draw the active creature's reach overlay without the interaction (T1:
   *  every seat sees how far the creature whose turn it is can go, all turn).
   *  The overlay is drawn when `showReach || moveMode`; the cursor, the
   *  destination ring and tag, the range language in the names and the commit
   *  stay `moveMode`'s. It takes no focus and calls nothing. */
  showReach?: boolean;
  /** True while the viewer's own confirmed move hasn't resolved yet
   *  (B8c-1 IMP-9b, additive — omitted/false behaves exactly as before).
   *  Gates every activation path from calling `onMove` a second time, and
   *  mirrors the pending state to sighted users (a diagonal-texture,
   *  non-interactive look on the reach overlay — see
   *  `TacticalMap.module.css`'s `.cellPending`; deliberately NOT opacity,
   *  which composited the whole cell and dragged the reach ring and
   *  destination-tag text below WCAG AA, Iro-A11y MAJOR-1, 2026-09-28) and
   *  assistive tech (`aria-busy` on the grid, `aria-disabled` on the
   *  still-highlighted move targets) without moving keyboard focus. The
   *  caller owns clearing it once its `/move` request settles either way.
   *
   *  Caller contract (Tora-Gesture MINOR-1, 2026-09-28): the mount MUST set
   *  this to `true` SYNCHRONOUSLY inside its own `onMove` handler, before
   *  awaiting the network call — never after the `await`, and never from a
   *  `.then()`/effect that only runs once the promise has already yielded.
   *  This component has no request-lifecycle state of its own to fall back
   *  on: `attemptMove` (the single choke point both the click handler and
   *  the Enter/Space keyboard handler call) only ever sees the prop it was
   *  given on its current render. If the flip to `true` lands late, two
   *  rapid discrete inputs — a fast double-tap, or Enter immediately
   *  followed by a stray Space — can both call `onMove` before either
   *  render picks up the pending state. There is no server backstop to
   *  fall back on today (Kage-CR B8c-1 IMPORTANT-4, 2026-09-28 — retracting
   *  this component's own earlier D1 IMPORTANT-9(b) claim that one exists):
   *  `/move` has no route yet, and even once B8b lands one, a short step
   *  off a larger budget does not spend the whole budget, so an identical
   *  second request can legally succeed rather than be refused — the only
   *  thing that would refuse a same-cell double-submit is the
   *  coordinator's own same-cell ruling (B8a IMPORTANT-6), and two requests
   *  racing on the SAME destination both apply under it. `/move`'s
   *  idempotency and concurrency handling is the engine move verb's own
   *  requirement (routed to B8b), not this component's. Until that lands,
   *  the caller contract above — set this prop synchronously, before
   *  awaiting — is the ONLY guard against a double submit; there is
   *  nothing else in this render path to fall back on. */
  moveSubmitting?: boolean;
  /** Called with the destination coordinate when the viewer confirms a
   *  legal cell (Enter/Space, or a click, on a cell this component's own
   *  `reach.ts` mirror considers reachable). The server's `/move` response
   *  is the only authority — this is a client PREVIEW (design §4).
   *
   *  Caller contract for the mount's `POST /api/dnd/combat/<combat_id>/move`
   *  request (the NekoNova proxy to the engine's `POST /combat/{id}/move`)
   *  (B8b design brief §5.2): send the participant's RENDERED `at` as
   *  `from` — the exact coordinate this component is currently drawing the
   *  mover at, not a recomputed guess, not a stale value held across a
   *  render the caller missed. The engine's move verb is a compare-and-set
   *  on `at`; anything other than the rendered `at` becomes a 409
   *  `position_changed` refusal, even when the destination itself is
   *  perfectly legal. `onMove`'s callback therefore must close over the
   *  active participant's CURRENT `at` at the time it fires, not capture it
   *  once outside the render.
   *
   *  A 409 `position_changed` means "the board moved on since this render —
   *  re-read `state`, re-render, and let the player choose again." It does
   *  NOT mean "resubmit the same request" — the `from` that produced it is
   *  now known-stale, so an automatic retry would just repeat the same
   *  refusal. Pair with `moveSubmitting` above: once the request resolves
   *  either way, the caller clears `moveSubmitting` and lets a fresh render
   *  (with the fresh `at`) drive the next attempt. */
  onMove: (to: SpaceCoordinate) => void;
  /** Called when the viewer presses Escape while `moveMode` is true. This
   *  component does not move focus outside its own DOM — the caller is
   *  responsible for returning focus to its Move control (design §5). */
  onExitMove: () => void;
  /** What the mount should say about the square the user CHOSE (tapped, clicked, arrowed to, or put focus on), or about the creature whose turn it is: `turn` at rest
   *  when the mover has a budget; `cell` when the chosen square holds a creature or a feature, with or without DOM focus (a tap under VoiceOver or TalkBack moves none);
   *  `target` while a move is being chosen (the hovered square, else the focused one). `cell` and `target` carry the `CellNameInput` the cell's own accessible name is
   *  built from, so `buildLine` (a11y.ts) and the name can never disagree. `null`: nothing to add to the stage's own line. Called from an effect keyed on the line's
   *  CONTENT, never on a render, and never with the initial `null`. The mount writes the text in the scene line; this component stays ignorant of the shell. */
  onInspect?: (line: InspectLine | null) => void;
  /** A counter the mount bumps when the VIEWER'S OWN move lands (the 200, in the same batch as the new state). With Move engaged, the map takes focus to the token's new square and follows it
   *  on a change of this and on nothing else: not a poll that redraws the token, not a refusal that redraws it (focus stays on the square the user was on). Omitted: it never changes. */
  movedSeq?: number;
  className?: string;
}

function coordKeyStr(c: SpaceCoordinate): string {
  return `${c[0]},${c[1]}`;
}

function isDowned(p: CombatParticipantState): boolean {
  return p.hp_current === 0 && p.is_alive;
}

/**
 * The engine's occupancy rule (`SquareSpace.occupied_by` docstring, B8a
 * IMP-5): true iff a participant's presence blocks movement onto their
 * cell — living participants only, the dead are walkable. Named and shared
 * verbatim by `occupiedByOthers` below (the reach/legality set, which ALSO
 * excludes the active mover's own id — a reach-specific exclusion that has
 * nothing to do with the occupancy rule itself, see `describeOccupant`'s
 * `occupiesCell`) and by `describeOccupant` (the accessible-name
 * disclosure). Kage-CR B8c-1 IMPORTANT-3 (2026-09-28): before this,
 * `a11y.ts` independently re-derived the same fact from `occupant.dead` —
 * numerically identical today, but a SECOND computation of the SAME rule,
 * so the next change to this rule (e.g. a future "downed no longer
 * occupies" ruling) could update the reach/legality half and silently
 * leave the accessible-name half behind.
 */
function occupiesWhenAlive(p: CombatParticipantState): boolean {
  return p.is_alive;
}

function tokenInitial(name: string): string {
  const trimmed = name.trim();
  return trimmed.length > 0 ? trimmed[0].toUpperCase() : '?';
}

interface OccupantDescription {
  cellOccupant: CellOccupant;
  downed: boolean;
  dead: boolean;
  invisible: boolean;
  worst: string | undefined;
  otherConditionsFormatted: string | undefined;
}

/**
 * Single source of truth for "what is true about this occupant" — used both
 * per-cell in the board render loop and (D1 decision 4) by the inspector
 * strip for whichever cell is currently roving-focused. Kept as ONE
 * function (rather than two near-identical derivations) on purpose: A2's
 * IMPORTANT-2 finding on this same lane's sibling component is exactly what
 * a second copy risks.
 *
 * T2/Kage-CR D1 IMPORTANT-6(b): "invisible" is filtered out of the
 * conditions BEFORE `worstCondition` is computed — it has its own eye-badge
 * disclosure, so without this filter an invisible-only token could show
 * both the eye badge AND a redundant condition badge for the same fact.
 */
function describeOccupant(
  occupant: CombatParticipantState,
  viewerParticipantId: string | null | undefined,
  activeParticipantId: string | null | undefined,
): OccupantDescription {
  const downed = isDowned(occupant);
  const dead = !occupant.is_alive;
  const invisible = occupant.conditions.includes('invisible');
  const nonInvisibleConditions = occupant.conditions.filter(
    (c) => c.toLowerCase() !== 'invisible',
  );
  const worst = worstCondition(nonInvisibleConditions);
  const otherConditions = nonInvisibleConditions.map(formatConditionName);
  const otherConditionsFormatted = otherConditions.length > 0 ? otherConditions.join(', ') : undefined;
  const isSelf = occupant.participant_id === viewerParticipantId;
  const isActiveMover = occupant.participant_id === activeParticipantId;
  // Kage-CR B8c-1 IMPORTANT-3 (2026-09-28): `occupiesWhenAlive` alone is the
  // fact `cellAccessibleName`'s "other occupant" branch needs (replacing
  // its old, independent `dead` re-derivation). The self-narration branch
  // needs ONE more bit `occupiedByOthers` deliberately does NOT carry: the
  // active mover's own square is excluded from THAT set for a reach-only
  // reason (a mover never checks whether their own cell blocks their own
  // move — moot), not because it stops being occupied. Without the
  // `isSelf && isActiveMover` carve-out, occupiesWhenAlive alone would
  // misreport a LIVING active mover's own square as "not occupied" to
  // themselves, which the many pre-existing "Current position." fixtures
  // pin against.
  const occupiesCell = occupiesWhenAlive(occupant) || (isSelf && isActiveMover);
  return {
    downed,
    dead,
    invisible,
    worst,
    otherConditionsFormatted,
    cellOccupant: {
      name: occupant.name,
      isSelf,
      isAlly: occupant.is_pc && !isSelf,
      hostile: !occupant.is_pc,
      invisible,
      dead,
      // D1b item D: was computed above but never threaded into the
      // accessible-name input, so cellAccessibleName's downed branch (added
      // this same fold-forward) had no signal to read for a real render.
      downed,
      occupiesCell,
      otherConditions,
    },
  };
}

/** The window's metrics as the follow rule reads them: its rect's origin, its CLIENT size (a classic scrollbar is not visible), its offsets and how far each axis can go. */
function windowMetrics(win: HTMLElement): WindowMetrics {
  const wr = win.getBoundingClientRect();
  return { view: { left: wr.left, top: wr.top, width: win.clientWidth, height: win.clientHeight }, scrollLeft: win.scrollLeft, scrollTop: win.scrollTop, maxLeft: win.scrollWidth - win.clientWidth, maxTop: win.scrollHeight - win.clientHeight };
}

function boxOf(el: HTMLElement): Box {
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, width: r.width, height: r.height };
}

/** Whether the browser shows keyboard-style focus on `el` (the user is ON it by key or Move-sync, not by a click or tap). An engine without `:focus-visible` (iOS before 15.4) throws on the
 *  selector: that reads as NOT focus-visible, so nothing is held and the plain follow runs. */
function isFocusVisible(el: HTMLElement): boolean {
  try {
    return el.matches(':focus-visible');
  } catch {
    return false;
  }
}

/** A window has a box when it is laid out: a folded (`hidden`) body has none. */
function hasBox(win: HTMLElement): boolean {
  return win.clientWidth > 0 && win.clientHeight > 0;
}

export default function TacticalMap({
  space,
  participants,
  viewerParticipantId,
  activeParticipantId,
  moveMode,
  showReach = false,
  moveSubmitting = false,
  onMove,
  onExitMove,
  onInspect,
  movedSeq = 0,
  className,
}: TacticalMapProps) {
  const cellRefs = useRef(new Map<string, HTMLDivElement>());
  const boardScrollRef = useRef<HTMLDivElement>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  // The sliver rule: the window's length on each axis when the room would leave a cut square under SLIVER_MIN_PX (null: the room as it is). Measured from the ROOM (the wrapper), not
  // from the window, so that capping the window cannot change what is measured.
  const [cap, setCap] = useState<{ w: number | null; h: number | null }>({ w: null, h: null });
  // The window stamps itself when the board is wider than its room (it pans sideways); the stylesheet gives such a board an inline-start guard against the iOS back swipe.
  const [pansX, setPansX] = useState(false);
  // The one seam for 'is there a board to draw' (see the usability comment further down): read ONCE, here, because the follow gate below needs it before the early return.
  const usable = isSpaceUsable(space);
  const gate = useFollowGate(boardScrollRef, usable);

  const activeParticipant = useMemo(
    () => participants.find((p) => p.participant_id === activeParticipantId),
    [participants, activeParticipantId],
  );

  // Only PLACED participants (`at` set) are drawn — an unplaced participant
  // (design §5/§7: no `space` authored at spawn, a legacy row, or more
  // seated PCs than `space.start.party` cells) is shown nowhere on the
  // board, not as a ghost/edge marker.
  const placed = useMemo(
    () =>
      participants.filter(
        (p): p is CombatParticipantState & { at: SpaceCoordinate } => p.at != null,
      ),
    [participants],
  );

  // B8c-1 IMP-5 (D1 IMPORTANT-8 / B8a IMPORTANT-5): membership mirrors
  // `engine/space.py::SquareSpace.occupied_by`'s docstring exactly — only
  // LIVING participants (`occupiesWhenAlive`) occupy a cell; the dead are
  // walkable. This is the ONE place that filters occupancy for
  // reach/legality — every call site below (`reachableCells`,
  // `isLegalMoveTarget` for the destination preview, and `attemptMove`)
  // reads this same value, so there is no second hand-rolled copy of THAT
  // rule to drift from it. `describeOccupant`'s `occupiesCell` (the
  // accessible-name half) shares `occupiesWhenAlive` too — see its comment.
  const occupiedByOthers = useMemo(
    () =>
      placed
        .filter((p) => p.participant_id !== activeParticipantId && occupiesWhenAlive(p))
        .map((p) => p.at),
    [placed, activeParticipantId],
  );

  const activeAt = activeParticipant?.at ?? null;
  const activeMovementRemaining = activeParticipant?.movement_remaining ?? 0;

  // B8c-3: the overlay is `showReach || moveMode` (T1: an observer sees the mover's reach all turn without the right to pick a square).
  const reachShown = showReach || moveMode;
  const reach = useMemo(() => {
    if (!space || !reachShown || !activeAt) return [] as SpaceCoordinate[];
    return reachableCells(space, activeAt, activeMovementRemaining, occupiedByOthers);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [space, reachShown, activeAt?.[0], activeAt?.[1], activeMovementRemaining, occupiedByOthers]);
  const reachSet = useMemo(() => new Set(reach.map(coordKeyStr)), [reach]);

  // The roving stop AND what put it there. `key` (an arrow) and `sync` (Move engaged: the mover's token) are the map moving focus itself: it focuses the square and follows it.
  // `native` is focus the BROWSER already placed (a pointer, a Tab, a screen reader's cursor): the map only records it, and never scrolls the board under a pointer.
  // `landed`: a `sync` that is the mover's own move landing while Move stays engaged (the map's own follow, so it takes the margin); arming Move is a `sync` that is not (margin 0, as for any focus).
  const [focus, setFocus] = useState<{ coord: SpaceCoordinate; by: 'key' | 'sync' | 'native'; landed?: boolean }>(() => ({ coord: activeAt ?? [0, 0], by: 'native' }));
  const focusedCoord = focus.coord;
  const [hoverCoord, setHoverCoord] = useState<SpaceCoordinate | null>(null);
  // The square the user last CHOSE — tapped, clicked, arrowed to, or put focus on — and the turn it was chosen in; and whether the grid holds focus. The line follows the
  // chosen square, not DOM focus (a tap under VoiceOver or TalkBack moves none: Iro-A11y's deciding case). It clears when focus leaves the grid, and at a turn change while
  // the grid does not hold focus (a stale square must not be read against the next mover). Derived in render, no effect.
  const [chosen, setChosen] = useState<{ coord: SpaceCoordinate; turn: string | null } | null>(null);
  const [gridFocused, setGridFocused] = useState(false);
  // Whether the grid's focus is KEYBOARD-style (:focus-visible), set where focus lands (only read while a square is chosen, and leaving the grid clears that, so it needs no reset of its own). While it is, the line names the square the user is on even when it is empty (Iro-A11y condition C):
  // a sighted keyboard user needs to know where focus went, and the scene line is where they read it. A click or a tap on an empty square is not that and says nothing new.
  const [keyFocus, setKeyFocus] = useState(false);
  const chosenCoord = chosen && (gridFocused || chosen.turn === (activeParticipantId ?? null)) ? chosen.coord : null;
  const choose = (coord: SpaceCoordinate) => setChosen({ coord, turn: activeParticipantId ?? null });

  // Move mode engaged, or the actor's own cell changed while engaged: focus
  // enters (design §5: "focus enters grid at your token") or follows
  // (a11y checklist: "focus follows the token after a successful move,
  // prop-driven") the actor's current cell. React's documented "adjust
  // state during render" pattern (a synchronous reset in the render body,
  // not an effect) — same convention as JournalPane.tsx's resetKey, and it
  // satisfies the repo-wide set-state-in-effect lint. `focusSyncKey` is
  // `null` whenever `moveMode` is false, so re-engaging Move (even at an
  // unchanged `at`) always reproduces a real key transition and re-syncs —
  // deliberately gated on `moveMode` so an observer's own roving-tabindex
  // position is never yanked by someone else's move.
  const activeAtKey = activeAt ? coordKeyStr(activeAt) : null;
  // The Move sync (B8c-3 M3): focus ENTERS the grid at the token when Move is armed, and FOLLOWS it when the viewer's own move lands (`movedSeq`). It does not follow a change of `at` as such:
  // a poll that moves the token, or a 409 that redraws it, leaves focus on the square the user was on (the brief's focus table). Re-arming always re-syncs.
  const [prevMoveMode, setPrevMoveMode] = useState(moveMode);
  const [prevMovedSeq, setPrevMovedSeq] = useState(movedSeq);
  if (moveMode !== prevMoveMode || movedSeq !== prevMovedSeq) {
    setPrevMoveMode(moveMode);
    setPrevMovedSeq(movedSeq);
    if (moveMode && activeAt && (!prevMoveMode || movedSeq !== prevMovedSeq)) setFocus({ coord: activeAt, by: 'sync', landed: prevMoveMode && movedSeq !== prevMovedSeq });
  }

  // The follow rule (follow.ts): ONE function for the turn change and for focus. A square wholly inside the window scrolls nothing; otherwise each axis that needs it
  // scrolls by the fewest whole squares; never centred. The window's OWN scrollLeft / scrollTop, set at once (the stylesheet never asks for smooth scrolling, so a user
  // who asked for reduced motion gets none): never `scrollIntoView`, which walks every scrollable ancestor including the page (Tora-Gesture MAJOR-1).
  // `margin` is in squares: 0 for anything the USER did (an arrow, a tap, arming Move); the mount's `--tm-follow-margin` (read here, default 0) for the map's own follows only.
  const ownMargin = useCallback((): number => {
    const win = boardScrollRef.current;
    const m = win ? parseFloat(getComputedStyle(win).getPropertyValue(FOLLOW_MARGIN_PROPERTY)) : 0;
    return Number.isFinite(m) && m > 0 ? m : 0;
  }, []);
  const applyScroll = useCallback((win: HTMLElement, next: { left: number; top: number } | null) => {
    if (!next) return;
    win.scrollLeft = next.left;
    win.scrollTop = next.top;
    gate.markOwn();
  }, [gate]);
  const keepInView = useCallback((cell: HTMLElement, margin = 0) => {
    const win = boardScrollRef.current;
    if (!win) return;
    applyScroll(win, followScroll(windowMetrics(win), boxOf(cell), margin));
  }, [applyScroll]);

  // What a follow that runs a moment later (the gate, the window's observer) must read as it is THEN, not as it was when it was asked for.
  const latest = useRef<{ moveMode: boolean; moveSubmitting: boolean; onExitMove: () => void; focusKey: string; moverKey: string | null }>({ moveMode, moveSubmitting, onExitMove, focusKey: coordKeyStr(focus.coord), moverKey: activeAtKey });
  useEffect(() => {
    latest.current = { moveMode, moveSubmitting, onExitMove, focusKey: coordKeyStr(focus.coord), moverKey: activeAtKey };
  });

  // Roving focus follows the arrows EVERYWHERE (B8c-3, brief F-d): in Move mode, and whenever the grid already holds focus. Only the map's OWN focus moves (`key`, `sync`) focus and follow:
  // focus the browser placed (`native`) is recorded and nothing more, or a mousedown on a cut-off square would scroll the board 34 px under the pointer and lose the click (T1). It never runs on mount unless Move is engaged,
  // and never pulls focus INTO the grid for an observer (someone else's move changes `activeAt`, not `focusedCoord`). `preventScroll`: a square already in view is never
  // scrolled by being focused — the follow rule above is the only thing that scrolls. The page may scroll for the user's own focus move, and only when the square is
  // STILL outside the viewport after the window has followed.
  useEffect(() => {
    const holdsFocus = !!boardRef.current && boardRef.current.contains(document.activeElement);
    if (!moveMode && !holdsFocus) return;
    if (focus.by === 'native' && holdsFocus) return;
    const key = coordKeyStr(focus.coord);
    const cell = cellRefs.current.get(key);
    if (!cell) return;
    cell.focus({ preventScroll: true });
    // Focus is immediate; the scroll waits for a quiet window (useFollowGate) and reads the square again when it runs.
    gate.request('focus', () => {
      const c = cellRefs.current.get(key);
      if (!c) return;
      keepInView(c, focus.by === 'sync' && focus.landed ? ownMargin() : 0);
      const r = c.getBoundingClientRect();
      if (r.bottom < 0 || r.top > window.innerHeight || r.right < 0 || r.left > window.innerWidth) c.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
  }, [focus, moveMode, keepInView, ownMargin, gate]);

  // The turn change: the creature whose turn it is is brought into view by the same rule, once per TURN. A turn change never scrolls the page (the window's own offsets only).
  // Keyed on a boolean, a string and the id: a poll hands over a new `space` object every few seconds, and the effect must not run (let alone drag a window the user scrolled
  // by hand back to the token) on anything but a real change. The turn is recorded BEFORE the placement check, so turn a -> an unplaced creature -> a is a new turn for a.
  // The ONE follow of the mover (the turn change and the window's re-follow both ask the gate for exactly this). It reads everything as it is when it RUNS.
  //   - A square is HELD only while it matches `:focus-visible` (keyboard and Move-sync focus): a square a mouse click or a tap focused is not held, or one click would pin the window
  //     and the board would stop showing whose turn it is (Tora-Gesture rule 5, Kage-CR).
  //   - A turn that passed since the last run is OWED its follow, in a ref the gate cannot lose by replacing one pending request with another. Its rule is `followTurn` (follow.ts): the
  //     mover ends whole; the held square is kept when both fit, the margin giving way first; when they cannot both fit the mover wins and DOM focus stays where it is.
  //   - Any other run (the window got a box, its width changed) keeps the held square first (`followAll`).
  //   - A hidden window has no box and gives zero metrics: nothing runs, and the turn stays owed for the re-follow that its box coming back asks for.
  const turnOwed = useRef(false);
  const followMover = useCallback(() => {
    const win = boardScrollRef.current;
    if (!win || !hasBox(win)) return;
    const turn = turnOwed.current;
    turnOwed.current = false;
    const { focusKey, moverKey } = latest.current;
    const heldCell = boardRef.current?.contains(document.activeElement) ? cellRefs.current.get(focusKey) : undefined;
    const held = heldCell && isFocusVisible(heldCell) ? heldCell : undefined;
    const mover = moverKey ? cellRefs.current.get(moverKey) : undefined;
    const metrics = windowMetrics(win);
    if (turn && mover) {
      applyScroll(win, followTurn(metrics, held ? boxOf(held) : null, boxOf(mover), ownMargin()));
      return;
    }
    const targets: FollowTarget[] = [];
    if (held) targets.push({ box: boxOf(held), margin: 0 });
    if (mover) targets.push({ box: boxOf(mover), margin: ownMargin() });
    applyScroll(win, followAll(metrics, targets));
  }, [ownMargin, applyScroll]);
  const lastFollowedRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (!usable) return;
    if (lastFollowedRef.current === activeParticipantId) return;
    lastFollowedRef.current = activeParticipantId;
    if (!activeAtKey) return;
    turnOwed.current = true;
    gate.request('mover', followMover); // waits for a quiet window and follows the mover AS IT IS THEN (a poll may have moved it meanwhile)
  }, [usable, activeAtKey, activeParticipantId, gate, followMover]);

  // The window's own box (P2, brief section 5; Iro-A11y C4). A folded body has no box, so MOUNTED is not VISIBLE, and a window that is hidden loses its offsets: it follows again when it
  // gets a box, when its WIDTH changes (a rotation), and when the mover is no longer wholly in it. NOT on a pure height step (the action bar is 24 px taller on a monster's turn and
  // would re-run the follow, margin and all, every turn). The user's focused square is followed first and the mover second, and the mover is not taken if it would cut the focused
  // one (followAll). A window that LOSES its box while Move is armed calls `onExitMove`: the player cannot choose a square on a map they cannot see. Every follow goes through the gate.
  // ONE place decides "the window's geometry is final, now follow" (QA F1): the cap and the edge-guard stamp are React state, so a follow run INSIDE an observer callback read a window
  // whose guard (16 px of scroll width) had not been added yet, clamped to the old maximum, and left a mover in the last column cut. So an observer never follows: it measures the room
  // (`measureRoom`, which sets the cap and the stamp), decides THAT a follow is wanted and bumps `followWanted`; the effect below runs after the commit that carries both, when the DOM
  // has its final box, and hands the follow to the gate.
  const spaceCols = usable ? space.width : 0;
  const spaceRows = usable ? space.height : 0;
  const [followWanted, setFollowWanted] = useState(0);
  const measureRoom = useCallback(() => {
    const room = wrapRef.current;
    if (!room) return;
    const first = cellRefs.current.values().next().value as HTMLElement | undefined;
    const sq = first ? boxOf(first) : null;
    // A board that pans starts `guard` in from the start edge (the stylesheet's margin), so the window has TWO cut edges (the far one at scroll 0, the near one at scroll max):
    // `panningWidthCap` takes both into account (QA F2, F2b). The height is not affected.
    const win = boardScrollRef.current;
    const pans = !!sq && spaceCols * sq.width > room.clientWidth;
    // debt: the guard is read as px (parseFloat of the property's authored value), so a guard written in rem or em reads as its bare number. ceiling: the phone row's 16px. until: a row sets the guard in another unit.
    const guard = pans && win ? Math.max(0, parseFloat(getComputedStyle(win).getPropertyValue(EDGE_GUARD_PROPERTY)) || 0) : 0;
    const next = sq ? { w: panningWidthCap(room.clientWidth, sq.width, spaceCols * sq.width, guard), h: wholeSquareCap(room.clientHeight, sq.height, spaceRows * sq.height) } : { w: null, h: null };
    setCap((prev) => (prev.w === next.w && prev.h === next.h ? prev : next));
    setPansX(pans);
  }, [spaceCols, spaceRows]);

  const boxState = useRef({ had: false, width: 0, height: 0 });
  const exitOwed = useRef(false);
  useEffect(() => {
    if (moveSubmitting || !exitOwed.current) return;
    exitOwed.current = false;
    const win = boardScrollRef.current;
    if (latest.current.moveMode && win && !hasBox(win)) latest.current.onExitMove();
  }, [moveSubmitting]);
  useEffect(() => {
    const win = boardScrollRef.current;
    const room = wrapRef.current;
    if (!usable || !win || !room || typeof ResizeObserver === 'undefined') return;
    boxState.current = { had: false, width: 0, height: 0 };
    measureRoom();
    const roomObserver = new ResizeObserver(measureRoom);
    roomObserver.observe(room);
    const winObserver = new ResizeObserver(() => {
      const prev = boxState.current;
      const has = hasBox(win);
      boxState.current = { had: has, width: win.clientWidth, height: win.clientHeight };
      if (!has) {
        // Disarming under an in-flight request can clear the page's own in-flight guard and let a reopen send a second POST, which is why Escape is deaf in that state (`canClose`). So the
        // exit is OWED, not made: it is paid when the submit settles, if the window still has no box THEN (the effect below: a box that came back in the meantime owes nothing).
        if (prev.had && latest.current.moveMode) {
          if (latest.current.moveSubmitting) exitOwed.current = true;
          else latest.current.onExitMove();
        }
        return;
      }
      measureRoom(); // the same batch as the request below, so one commit carries both
      const moverKey = latest.current.moverKey;
      const mover = moverKey ? cellRefs.current.get(moverKey) : undefined;
      const metrics = windowMetrics(win);
      const moverCut = !!mover && followScroll(metrics, boxOf(mover)) !== null;
      // On a HEIGHT-ONLY step the mover is re-followed only if it was wholly in view under the PREVIOUS height: if it was not, the user scrolled it out of view by hand, and a resize must
      // never undo a hand scroll (Tora-Gesture rule 3). A box gained or a width change always follows.
      const wasWhole = !!mover && followScroll({ ...metrics, view: { ...metrics.view, height: prev.height } }, boxOf(mover)) === null;
      if (!prev.had || win.clientWidth !== prev.width || (moverCut && wasWhole)) setFollowWanted((n) => n + 1);
    });
    winObserver.observe(win);
    // The grid's own box changes when the SQUARE does (a cell-size change with the room and the window unchanged): measure again and follow. Nothing else resizes the grid.
    const gridObserver = new ResizeObserver(() => {
      measureRoom();
      setFollowWanted((n) => n + 1);
    });
    if (boardRef.current) gridObserver.observe(boardRef.current);
    return () => {
      roomObserver.disconnect();
      winObserver.disconnect();
      gridObserver.disconnect();
    };
  }, [usable, measureRoom]);

  useEffect(() => {
    if (followWanted === 0) return;
    gate.request('mover', followMover);
  }, [followWanted, gate, followMover]);

  // Everything one square says, in ONE place (Kage-CR D1 IMPORTANT-4's "single source of truth"): the cell's accessible name, its token and the scene line all read this.
  // `a11y.ts`'s `cellAccessibleName` and `buildLine` render the same CellNameInput; a fact cannot be in one and not the other.
  function describeSquare(sp: CombatSpace, coord: SpaceCoordinate): { input: CellNameInput; occupant?: CombatParticipantState & { at: SpaceCoordinate }; desc?: OccupantDescription } {
    const key = coordKeyStr(coord);
    const occupant = placed.find((p) => coordKeyStr(p.at) === key);
    // Kage-CR D1 CRITICAL-1: `space.blocked`/`.features` are
    // legally omittable content (the validator accepts absence
    // and never backfills `[]` — B3/Miko re-confirmed by object
    // identity) even though the B6 wire type claims them
    // always-present. `SquareSpace._is_blocked`, this mirror's
    // own cited authority, defends with `or []`; match it.
    const blocked = (sp.blocked ?? []).some((b) => coordKeyStr(b) === key);
    const feature = (sp.features ?? []).find((f) => f.at.some((a) => coordKeyStr(a) === key));
    const desc = occupant ? describeOccupant(occupant, viewerParticipantId, activeParticipantId) : undefined;
    const { row1, col1 } = toDisplayRowCol(coord);
    return {
      occupant,
      desc,
      input: {
        row1,
        col1,
        occupant: desc?.cellOccupant,
        blocked,
        inRange: reachSet.has(key),
        costFt: activeAt ? chebyshevCost(sp, activeAt, coord) : undefined,
        moveModeActive: moveMode,
        featureLabel: feature?.label,
      },
    };
  }

  // The destination while choosing a move, and whether it is a legal one: computed ONCE, here, and read by the scene line, the ring and the cost tag alike (a second
  // call with its own occupancy could say "Move to…" on a square whose name says "Occupied").
  const destinationCoord = moveMode ? (hoverCoord ?? focusedCoord) : null;
  const destinationLegal = usable && destinationCoord && activeAt ? isLegalMoveTarget(space, activeAt, destinationCoord, activeMovementRemaining, occupiedByOthers) : false;

  // The scene line's content (see `onInspect`): computed here, before the usability seam, so the effect below is unconditional.
  let inspect: InspectLine | null = null;
  if (usable) {
    if (destinationCoord) {
      const { input } = describeSquare(space, destinationCoord);
      inspect = { kind: 'target', input, legal: destinationLegal, ...(destinationLegal && activeAt ? { costFt: chebyshevCost(space, activeAt, destinationCoord), budgetFt: activeMovementRemaining } : {}) };
    } else if (chosenCoord) {
      const { input } = describeSquare(space, chosenCoord);
      if (input.occupant || input.featureLabel || keyFocus) inspect = { kind: 'cell', input };
    }
    if (!inspect && activeParticipant && activeAt && activeParticipant.movement_remaining != null) {
      inspect = { kind: 'turn', name: activeParticipant.name, feetLeft: activeParticipant.movement_remaining };
    }
  }
  const inspectKey = inspect ? JSON.stringify(inspect) : '';
  const latestInspectRef = useRef<InspectLine | null>(null);
  const onInspectRef = useRef(onInspect);
  const emittedKeyRef = useRef('');
  useEffect(() => {
    latestInspectRef.current = inspect;
    onInspectRef.current = onInspect;
  });
  useEffect(() => {
    if (emittedKeyRef.current === inspectKey) return;
    emittedKeyRef.current = inspectKey;
    onInspectRef.current?.(latestInspectRef.current);
  }, [inspectKey]);

  // Kage-CR D1 IMPORTANT-1: `space.kind` was never read, so a non-square
  // board (a future hex/zone kind) silently rendered as a square grid with
  // a nonsensical Chebyshev overlay. M6 (movement design) is square-only in
  // 1.0 — fall through to the same theatre-of-mind band `!space` uses
  // rather than draw a board this mirror doesn't understand.
  //
  // Kage-CR B8c-3a CRITICAL-1 (2026-09-29, ledger item 16): this is now the
  // component's ONE seam for space usability — `isSpaceUsable` (reach.ts, called once above as `usable`)
  // is a type predicate, so everything below this line (the per-cell
  // `chebyshevCost` call included) runs only on a `CombatSpace` with a
  // real, finite, positive `cell.value`. The old `space.kind !== 'square'`
  // check never validated `cell` at all, so a wire-reachable `cell: null`
  // (key-presence-only projection gate, engine/combat.py:7361-7364 @
  // 3a5d18b) reached `chebyshevCost` and threw `TypeError` at render.
  if (!usable) {
    if (participants.length === 0) return null;
    return <TheatreOfMindBand participants={participants} className={className} />;
  }

  // The grid's label states the BOARD, not the window (Iro-A11y ruling 4): every cell is in the tree and reachable, so "showing 13 of 14" would be a statement about the drawing, false
  // for a user who can reach the whole board, and it would change with a rotation or a fold. `aria-rowcount` / `aria-colcount` (below) let a screen reader say "row 3 of 7".
  const count = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;
  const boardLabel = `Battle map, ${count(space.width, 'column')} by ${count(space.height, 'row')}${
    activeParticipant ? `. ${activeParticipant.name}'s turn${activeParticipant.movement_remaining == null ? '' : `, ${activeMovementRemaining} feet remaining`}` : ''
  }`;

  function attemptMove(to: SpaceCoordinate) {
    // B8c-1 IMP-9b: the one guard both activation paths (click's onClick
    // below, and Enter/Space in handleGridKeyDown) go through — a second
    // per-caller check would be the same-shape-sibling risk this function
    // already exists to avoid. Outside Move mode nothing is ever sent
    // (B8c-3: `showReach` draws the overlay for an observer and commits nothing).
    if (!space || !moveMode || !activeAt || moveSubmitting) return;
    if (isLegalMoveTarget(space, activeAt, to, activeMovementRemaining, occupiedByOthers)) {
      onMove(to);
    }
  }

  function handleGridKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (!space) return;
    if (e.key === 'Escape') {
      // Tora-Gesture CRIT-1 / Kage-CR IMPORTANT-3: route through
      // consumeEscape so Escape can never fall through to /play's
      // document-level Award-XP fallback while exiting Move mode. Outside
      // Move mode this branch never calls consumeEscape at all, so
      // propagation is untouched — matches the pre-fix "no-op outside Move
      // mode" behaviour Tora already verified clean. In flight (B8c-3,
      // ledger 3) the event is consumed and closes NOTHING: a move that is
      // already on the wire is not cancelled by leaving the mode.
      if (moveMode) {
        e.preventDefault();
        consumeEscape(e, { onClose: onExitMove, canClose: !moveSubmitting });
      }
      return;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      // Outside Move mode these only CHOOSE the square for the scene line and nothing else (Iro): they never arm Move, select a destination or move a token. Space is
      // consumed so it does not scroll the page from a grid that has focus.
      e.preventDefault();
      setHoverCoord(null); // the key commits the FOCUSED square, so the ring and the line must say that square, not one a resting mouse is over (Tora M-1)
      if (moveMode) attemptMove(focusedCoord);
      else choose(focusedCoord);
      return;
    }
    const next = nextFocusCoord(e.key, focusedCoord, space.width, space.height);
    if (next) {
      e.preventDefault();
      setHoverCoord(null); // keyboard wins until the next pointer ENTER: a mouse resting over the board no longer outranks the arrows (Tora M-1)
      setFocus({ coord: next, by: 'key' });
      choose(next);
    }
  }

  return (
    <div className={[styles.wrap, className].filter(Boolean).join(' ')} ref={wrapRef}>
      <div
        className={styles.boardScroll}
        ref={boardScrollRef}
        data-board-window=""
        data-pans-x={pansX ? '' : undefined}
        // The toast must not land on the board. At this base nothing reads this mark: the toast host reads it on the phone branch, where the safety block and the composer carry it too.
        data-toast-avoid=""
        style={{ ['--tm-cols' as string]: space.width, ['--tm-rows' as string]: space.height, maxWidth: cap.w ?? undefined, maxHeight: cap.h ?? undefined }}
      >
        <div
          className={styles.board}
          ref={boardRef}
          role="grid"
          aria-label={boardLabel}
          aria-rowcount={space.height}
          aria-colcount={space.width}
          aria-busy={moveSubmitting || undefined}
          onKeyDown={handleGridKeyDown}
          onFocus={() => setGridFocused(true)}
          onBlur={(e) => {
            // Focus moving between two squares of the grid is not leaving it.
            if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
            setGridFocused(false);
            setChosen(null);
          }}
        >
          {Array.from({ length: space.height }, (_, y) => (
            <div role="row" className={styles.row} key={y}>
              {Array.from({ length: space.width }, (_, x) => {
                const coord: SpaceCoordinate = [x, y];
                const key = coordKeyStr(coord);
                const { occupant, desc, input } = describeSquare(space, coord);
                const inRange = reachSet.has(key);
                const isDestination = Boolean(
                  destinationCoord && coordKeyStr(destinationCoord) === key,
                );
                // B8c-1 IMP-9b: a move target while the caller's previous
                // move hasn't resolved yet — visually muted (`.cellPending`)
                // and disabled to AT, without touching this cell's tabIndex
                // or unmounting it (keyboard focus must not move).
                const pending = moveMode && inRange && moveSubmitting;
                const feature = (space.features ?? []).find((f) => f.at.some((a) => coordKeyStr(a) === key));

                return (
                  <div
                    key={key}
                    ref={(el) => {
                      if (el) cellRefs.current.set(key, el);
                      else cellRefs.current.delete(key);
                    }}
                    role="gridcell"
                    tabIndex={coordsEqual(focusedCoord, coord) ? 0 : -1}
                    aria-disabled={pending || undefined}
                    aria-label={cellAccessibleName(input)}
                    className={[
                      styles.cell,
                      input.blocked && styles.cellBlocked,
                      reachShown && inRange && styles.cellInRange,
                      moveMode && inRange && styles.cellMovable,
                      pending && styles.cellPending,
                      isDestination && destinationLegal && styles.cellDestination,
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    onFocus={(e) => {
                      // Real focus moving onto a square (a Tab into the grid, a screen reader's cursor, a programmatic focus) is the roving stop and the chosen square
                      // from then on: the NEXT arrow key starts from here, not from a stale square.
                      setFocus((prev) => (coordsEqual(prev.coord, coord) ? prev : { coord, by: 'native' }));
                      choose(coord);
                      setKeyFocus(isFocusVisible(e.currentTarget));
                    }}
                    onClick={(e) => {
                      // Tora-Gesture MAJOR-2: a click never synced
                      // `focusedCoord`, desyncing DOM focus (which a click
                      // on a tabindex-bearing div already moves natively)
                      // from the roving-tabindex model — the NEXT arrow key
                      // or Tab would then jump from the STALE cell, not the
                      // one just clicked. Unconditional (not gated on
                      // moveMode) so tapping any cell outside Move mode
                      // also chooses it for the scene line (B8c-3: a tap
                      // moves no focus under VoiceOver or TalkBack).
                      setFocus((prev) => (coordsEqual(prev.coord, coord) ? prev : { coord, by: 'native' }));
                      choose(coord);
                      // A tap that moves no focus (a screen reader's, iOS Safari's) leaves `keyFocus` as the LAST focus set it: a keyboard visit earlier must not make this empty square read as keyboard-on.
                      setKeyFocus(isFocusVisible(e.currentTarget));
                      attemptMove(coord);
                    }}
                    // HOVER is a mouse's (or a pen's), never a finger's: a tap makes the browser fire emulated enter events and the hover then STAYS until another tap, so a touch user would read
                    // a destination ring and a target line for a square they only touched (B3, Tora-Gesture). Pointer events say which kind of pointer it is.
                    onPointerEnter={(e) => {
                      if (moveMode && e.pointerType !== 'touch') setHoverCoord(coord);
                    }}
                    onPointerLeave={() => {
                      setHoverCoord((prev) => (coordsEqual(prev, coord) ? null : prev));
                    }}
                  >
                    {feature && !occupant && (
                      <span className={styles.feature} aria-hidden="true" title={feature.label}>
                        {feature.label.slice(0, 1).toUpperCase()}
                      </span>
                    )}
                    {occupant && desc && (
                      <span
                        className={[
                          styles.token,
                          desc.cellOccupant.isSelf && styles.tokenSelf,
                          !desc.cellOccupant.isSelf && desc.cellOccupant.isAlly && styles.tokenAlly,
                          desc.cellOccupant.hostile && styles.tokenFoe,
                          desc.dead && styles.tokenDead,
                          !desc.dead && desc.downed && styles.tokenDowned,
                          desc.invisible && styles.tokenInvisible,
                          occupant.is_active_turn && styles.tokenActive,
                        ]
                          .filter(Boolean)
                          .join(' ')}
                        aria-hidden="true"
                        title={desc.otherConditionsFormatted}
                      >
                        {tokenInitial(occupant.name)}
                        {desc.invisible && (
                          <span className={styles.eyeBadge} aria-hidden="true">
                            ◌
                          </span>
                        )}
                        {desc.worst && (
                          <span className={styles.conditionBadge} aria-hidden="true">
                            {desc.worst.slice(0, 1).toUpperCase()}
                          </span>
                        )}
                      </span>
                    )}
                    {moveMode && isDestination && destinationLegal && activeAt && (
                      <span className={styles.destinationTag} aria-hidden="true">
                        {chebyshevCost(space, activeAt, coord)} ft
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
