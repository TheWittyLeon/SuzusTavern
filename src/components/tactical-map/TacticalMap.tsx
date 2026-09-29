'use client';
// src/components/tactical-map/TacticalMap.tsx
//
// Tactical map (#12), design pass v1 (Aoi-UI) — STANDALONE component (Lane D,
// 2026-09-28 runbook). Not mounted anywhere yet; mounting into `SceneStage`
// waits for play-shell steps 6/11. Presentational only: every prop is data
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
//   4. An inspector strip under the board shows the roving-focused (or
//      tapped — see the cell onClick handler) cell's full occupant detail,
//      replacing the old `title`-only disclosure that Tora-Gesture found
//      inert on touch (MAJOR-3).
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
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { CombatParticipantState, CombatSpace, SpaceCoordinate } from '@/lib/api/types';
import { consumeEscape } from '@/lib/a11y/escapeConsume';
import { chebyshevCost, coordsEqual, isLegalMoveTarget, reachableCells } from './reach';
import { cellAccessibleName, nextFocusCoord, toDisplayRowCol, type CellOccupant } from './a11y';
import { worstCondition } from './conditions';
import { formatConditionName } from '@/lib/conditions';
import ConditionChipList from '@/components/ConditionChipList';
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
  /** True while the viewer is in Move-targeting mode. Gates the reach
   *  overlay, the destination-cell highlight, and whether Enter/Space/click
   *  on a legal cell calls `onMove`. Caller-controlled — this component
   *  never decides on its own that it's "someone's turn to move". */
  moveMode: boolean;
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

export default function TacticalMap({
  space,
  participants,
  viewerParticipantId,
  activeParticipantId,
  moveMode,
  moveSubmitting = false,
  onMove,
  onExitMove,
  className,
}: TacticalMapProps) {
  const cellRefs = useRef(new Map<string, HTMLDivElement>());
  const boardScrollRef = useRef<HTMLDivElement>(null);

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

  const reach = useMemo(() => {
    if (!space || !moveMode || !activeAt) return [] as SpaceCoordinate[];
    return reachableCells(space, activeAt, activeMovementRemaining, occupiedByOthers);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [space, moveMode, activeAt?.[0], activeAt?.[1], activeMovementRemaining, occupiedByOthers]);
  const reachSet = useMemo(() => new Set(reach.map(coordKeyStr)), [reach]);

  const [focusedCoord, setFocusedCoord] = useState<SpaceCoordinate>(() => activeAt ?? [0, 0]);
  const [hoverCoord, setHoverCoord] = useState<SpaceCoordinate | null>(null);

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
  const focusSyncKey = moveMode ? activeAtKey : null;
  const [prevFocusSyncKey, setPrevFocusSyncKey] = useState<string | null>(focusSyncKey);
  if (focusSyncKey !== prevFocusSyncKey) {
    setPrevFocusSyncKey(focusSyncKey);
    if (moveMode && activeAt) setFocusedCoord(activeAt);
  }

  useEffect(() => {
    if (!moveMode) return;
    cellRefs.current.get(coordKeyStr(focusedCoord))?.focus();
  }, [focusedCoord, moveMode]);

  // T4: center the board on the active participant's cell each time the
  // turn changes (guarded so it fires once per turn, not on every render).
  // Tora-Gesture MAJOR-1: `scrollIntoView` walks EVERY scrollable ancestor
  // including the page (the classic phone vertical-jump trap) — scoped
  // instead to `.boardScroll`'s own scrollLeft/scrollTop via
  // getBoundingClientRect deltas, so no ancestor outside the board ever
  // moves.
  const lastCenteredRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (!space || !activeAt) return;
    if (lastCenteredRef.current === activeParticipantId) return;
    lastCenteredRef.current = activeParticipantId;
    const container = boardScrollRef.current;
    const cell = cellRefs.current.get(coordKeyStr(activeAt));
    if (!container || !cell) return;
    const containerRect = container.getBoundingClientRect();
    const cellRect = cell.getBoundingClientRect();
    const deltaX =
      cellRect.left + cellRect.width / 2 - (containerRect.left + containerRect.width / 2);
    const deltaY =
      cellRect.top + cellRect.height / 2 - (containerRect.top + containerRect.height / 2);
    container.scrollLeft += deltaX;
    container.scrollTop += deltaY;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [space, activeAt?.[0], activeAt?.[1], activeParticipantId]);

  // Kage-CR D1 IMPORTANT-1: `space.kind` was never read, so a non-square
  // board (a future hex/zone kind) silently rendered as a square grid with
  // a nonsensical Chebyshev overlay. M6 (movement design) is square-only in
  // 1.0 — fall through to the same theatre-of-mind band `!space` uses
  // rather than draw a board this mirror doesn't understand.
  if (!space || space.kind !== 'square') {
    if (participants.length === 0) return null;
    return <TheatreOfMindBand participants={participants} className={className} />;
  }

  const destinationCoord = moveMode ? (hoverCoord ?? focusedCoord) : null;
  const destinationLegal =
    destinationCoord && activeAt
      ? isLegalMoveTarget(space, activeAt, destinationCoord, activeMovementRemaining, occupiedByOthers)
      : false;

  function attemptMove(to: SpaceCoordinate) {
    // B8c-1 IMP-9b: the one guard both activation paths (click's onClick
    // below, and Enter/Space in handleGridKeyDown) go through — a second
    // per-caller check would be the same-shape-sibling risk this function
    // already exists to avoid.
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
      // mode" behaviour Tora already verified clean.
      if (moveMode) {
        e.preventDefault();
        consumeEscape(e, { onClose: onExitMove });
      }
      return;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      if (moveMode) {
        e.preventDefault();
        attemptMove(focusedCoord);
      }
      return;
    }
    const next = nextFocusCoord(e.key, focusedCoord, space.width, space.height);
    if (next) {
      e.preventDefault();
      setFocusedCoord(next);
    }
  }

  // Inspector strip (coordinator decision 4): driven by the roving focus,
  // which a click now also syncs to (see the cell onClick handler below) —
  // "tap = focus a cell" is the touch affordance Tora-Gesture's MAJOR-3
  // asked for, replacing the old title-only (hover-only, touch-inert) full
  // condition-list disclosure. `title` stays as a hover nicety only.
  const focusedOccupant = placed.find((p) => coordsEqual(p.at, focusedCoord));
  const focusedDesc = focusedOccupant
    ? describeOccupant(focusedOccupant, viewerParticipantId, activeParticipantId)
    : undefined;

  return (
    <div className={[styles.wrap, className].filter(Boolean).join(' ')}>
      <div
        className={styles.boardScroll}
        ref={boardScrollRef}
        style={{ ['--tm-cols' as string]: space.width, ['--tm-rows' as string]: space.height }}
      >
        <div
          className={styles.board}
          role="grid"
          aria-label={
            activeParticipant
              ? `Battle map — ${activeParticipant.name}'s turn, ${activeMovementRemaining} feet remaining`
              : 'Battle map'
          }
          aria-busy={moveSubmitting || undefined}
          onKeyDown={handleGridKeyDown}
        >
          {Array.from({ length: space.height }, (_, y) => (
            <div role="row" className={styles.row} key={y}>
              {Array.from({ length: space.width }, (_, x) => {
                const coord: SpaceCoordinate = [x, y];
                const key = coordKeyStr(coord);
                const occupant = placed.find((p) => coordKeyStr(p.at) === key);
                // Kage-CR D1 CRITICAL-1: `space.blocked`/`.features` are
                // legally omittable content (the validator accepts absence
                // and never backfills `[]` — B3/Miko re-confirmed by object
                // identity) even though the B6 wire type claims them
                // always-present. `SquareSpace._is_blocked`, this mirror's
                // own cited authority, defends with `or []`; match it.
                const blocked = (space.blocked ?? []).some((b) => coordKeyStr(b) === key);
                const feature = (space.features ?? []).find((f) =>
                  f.at.some((a) => coordKeyStr(a) === key),
                );
                const inRange = reachSet.has(key);
                const isDestination = Boolean(
                  destinationCoord && coordKeyStr(destinationCoord) === key,
                );
                // B8c-1 IMP-9b: a move target while the caller's previous
                // move hasn't resolved yet — visually muted (`.cellPending`)
                // and disabled to AT, without touching this cell's tabIndex
                // or unmounting it (keyboard focus must not move).
                const pending = moveMode && inRange && moveSubmitting;
                const { row1, col1 } = toDisplayRowCol(coord);

                const desc = occupant
                  ? describeOccupant(occupant, viewerParticipantId, activeParticipantId)
                  : undefined;

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
                    aria-label={cellAccessibleName({
                      row1,
                      col1,
                      occupant: desc?.cellOccupant,
                      blocked,
                      inRange,
                      costFt: activeAt ? chebyshevCost(space, activeAt, coord) : undefined,
                      moveModeActive: moveMode,
                    })}
                    className={[
                      styles.cell,
                      blocked && styles.cellBlocked,
                      moveMode && inRange && styles.cellInRange,
                      pending && styles.cellPending,
                      isDestination && destinationLegal && styles.cellDestination,
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    onClick={() => {
                      // Tora-Gesture MAJOR-2: a click never synced
                      // `focusedCoord`, desyncing DOM focus (which a click
                      // on a tabindex-bearing div already moves natively)
                      // from the roving-tabindex model — the NEXT arrow key
                      // or Tab would then jump from the STALE cell, not the
                      // one just clicked. Unconditional (not gated on
                      // moveMode) so tapping any cell outside Move mode
                      // also drives the inspector strip below.
                      setFocusedCoord(coord);
                      attemptMove(coord);
                    }}
                    onMouseEnter={() => {
                      if (moveMode) setHoverCoord(coord);
                    }}
                    onMouseLeave={() => {
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
      <div className={styles.inspector}>
        {focusedOccupant && focusedDesc ? (
          <>
            <span className={styles.inspectorName}>{focusedOccupant.name}</span>
            <span className={styles.inspectorTeam}>
              {focusedDesc.cellOccupant.isSelf
                ? 'You'
                : focusedDesc.cellOccupant.isAlly
                  ? 'Ally'
                  : 'Foe'}
            </span>
            {focusedDesc.dead && <span className={styles.inspectorState}>Dead</span>}
            {!focusedDesc.dead && focusedDesc.downed && (
              <span className={styles.inspectorState}>Downed</span>
            )}
            {focusedDesc.invisible && <span className={styles.inspectorState}>Invisible</span>}
            <ConditionChipList
              conditions={focusedOccupant.conditions}
              durations={focusedOccupant.condition_durations}
              combatantName={focusedOccupant.name}
            />
          </>
        ) : (
          <span className={styles.inspectorEmpty}>No creature selected.</span>
        )}
      </div>
    </div>
  );
}
