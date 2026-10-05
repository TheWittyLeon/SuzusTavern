/**
 * A held fight's words, once (TPK-HOLD). The strip's line for each seat, the note on the controls the freeze switches off, the name suffix of a locked verb and the End combat confirm.
 * Components and the play route import them from here; `app/play/[sessionId]/format.ts` re-exports them.
 */
import type { CombatParticipantState } from '@/lib/api/types';

/** The note on every control the hold locks (the bar, Cast, the phone's turn line). Not a live region: the stage strip announces the hold once. */
export const HELD_FROZEN_NOTE = 'The fight is on hold.';
/** What a locked verb's accessible name says while the fight is held, in place of "not your turn". One suffix for the four verbs and Cast. */
export const HELD_VERB_SUFFIX = 'fight on hold';

/** Every character has fallen: the line, for the DM who can act on it. Kept as a named constant: tests and the harness read it. */
export const HELD_LINE_DM = 'Every character has fallen.';
export const HELD_LINE_WAITING = 'Every character has fallen. The DM decides what happens next.';

/**
 * The strip's line, as data: a function of three facts the page has. Who the table's DM is (a person, or Suzu with the session's host holding the one move that is left),
 * whether the viewer can end the fight, and whether a character is still standing (the engine's heal-resume race: held with a living PC). A new table type is a row.
 */
const HELD_LINES = {
  human: {
    ender: { fallen: HELD_LINE_DM, standing: 'The fight is on hold. A character is still standing.' },
    watcher: { fallen: HELD_LINE_WAITING, standing: 'The fight is on hold. The DM decides what happens next.' },
  },
  ai: {
    ender: { fallen: 'Every character has fallen. You can end the fight.', standing: 'The fight is on hold. You can end the fight.' },
    watcher: { fallen: 'Every character has fallen. The host can end the fight.', standing: 'The fight is on hold. The host can end the fight.' },
  },
} as const;

export function heldLine({ humanDmTable, canEnd, standing }: { humanDmTable: boolean; canEnd: boolean; standing: boolean }): string {
  return HELD_LINES[humanDmTable ? 'human' : 'ai'][canEnd ? 'ender' : 'watcher'][standing ? 'standing' : 'fallen'];
}

/** A player character is still on their feet. */
export function anyPcStanding(participants: readonly CombatParticipantState[] | null | undefined): boolean {
  return !!participants?.some((p) => p.is_pc && p.is_alive);
}

/** The held End combat's confirm. Ending it records a total party wipe, so the DM is asked once; "Keep waiting" is the safe side and takes focus. The confirm button is not "End combat":
 *  the strip's button has that name and both are on the page while the dialog is open (Iro). */
export const HELD_END_TITLE = 'End the fight?';
export const HELD_END_BODY = "Every character has fallen. Ending it now records a total party wipe and can't be undone.";
/** The confirm's body, as data keyed by the two facts the strip already uses (Aoi addendum 3, 1): is a character still standing, and can the viewer Resume (the human DM; the host at a Suzu-DM table has End alone).
 *  "Keep waiting" is the cancel button's exact name, so the sentence tells the DM which button to press. */
const HELD_END_BODIES = {
  fallen: HELD_END_BODY,
  standingResume: "A character is still standing. Ending the fight now records a total party wipe and can't be undone. To play on, choose Keep waiting, then use Resume.",
  standingEndOnly: "A character is still standing. Ending the fight now records a total party wipe and can't be undone.",
} as const;
export function heldEndBody({ standing, canResume }: { standing: boolean; canResume: boolean }): string {
  return HELD_END_BODIES[!standing ? 'fallen' : canResume ? 'standingResume' : 'standingEndOnly'];
}
/** The End-session warning's lead while a fight is held (Aoi addendum 3, 1): all fallen, or with a character still standing. The ordinary tail follows. */
export const HELD_SESSION_WARN = {
  fallen: "A fight is waiting for your ruling: every character has fallen. Ending the session leaves it unresolved, and the characters in it can't be deleted until it ends.",
  standing: "A fight is on hold with a character still standing. Ending the session leaves the fight unresolved, and its characters can't be deleted until the fight ends.",
} as const;
export const HELD_END_CONFIRM = 'End the fight';
export const HELD_END_CANCEL = 'Keep waiting';
