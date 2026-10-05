/**
 * The questions a reader may ask of a fight's state (TPK-HOLD W1; moved out of the play route so components and `lib` import a lib module, not a page's).
 *
 * No reader reads `CombatState.state` itself: it asks one of these. `combatState.source-scan.test.ts` fails the build on any expression typed `CombatStateValue` outside this file,
 * and the table below is a `Record<CombatStateValue, ...>`, so a seventh engine state added to the type is a compile error HERE, once, until it is classified.
 *
 * A value outside the type (an engine newer than this build) counts as LIVE and FROZEN, and says so once in the console: nothing offered, nothing hidden that would let a DM walk
 * away from it. That is the fail-closed side.
 */
import type { CombatState, CombatStateValue } from '@/lib/api/types';

interface StateKind {
  /** A fight exists and has not ended. */
  live: boolean;
  /** A turn order is running: the one kind in which a turn verb can be accepted. */
  running: boolean;
  /** Every character has fallen after a DM override; the fight waits for the DM. */
  held: boolean;
}

const KINDS: Readonly<Record<CombatStateValue, StateKind>> = {
  idle: { live: true, running: false, held: false },
  rolling_initiative: { live: true, running: false, held: false },
  active: { live: true, running: true, held: false },
  between_turns: { live: true, running: false, held: false },
  held: { live: true, running: false, held: true },
  ended: { live: false, running: false, held: false },
};
/** Live and frozen: what a state this build has never heard of is taken to be. */
const UNKNOWN: StateKind = { live: true, running: false, held: false };
const warned = new Set<string>();

function kindOf(combatState: CombatState | null | undefined): StateKind | null {
  if (combatState == null) return null;
  const raw: unknown = combatState.state;
  if (typeof raw === 'string' && Object.hasOwn(KINDS, raw)) return KINDS[raw as CombatStateValue];
  const key = String(raw);
  if (!warned.has(key)) {
    warned.add(key);
    console.warn(`Unknown combat state ${JSON.stringify(key)}: treated as live and frozen. Classify it in lib/dnd/combatState.ts.`);
  }
  return UNKNOWN;
}

/** The fight is over (the only state the poller stops on). A fight not read yet is not over. */
export function isFightEnded(combatState: CombatState | null | undefined): boolean {
  const k = kindOf(combatState);
  return k !== null && !k.live;
}

/** A fight exists and has not ended: before initiative, running, between turns, held. NOT `combatIsActive` (page.tsx), which is "has an id" and so is also true before the
 *  state is read: a reader that must freeze on an unread state asks `combatIsActive`, not this. */
export function isFightLive(combatState: CombatState | null | undefined): boolean {
  return kindOf(combatState)?.live === true;
}

/** A live turn order is running: the one state in which a turn verb can be accepted. NOT `combatIsActive`, which is also true before initiative, between turns and while held. */
export function areTurnsRunning(combatState: CombatState | null | undefined): boolean {
  return kindOf(combatState)?.running === true;
}

/** Every character has fallen after a DM override; the fight waits for the DM to resume it or end it. Live, and frozen. */
export function isFightHeld(combatState: CombatState | null | undefined): boolean {
  return kindOf(combatState)?.held === true;
}
