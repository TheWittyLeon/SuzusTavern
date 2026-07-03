// src/lib/dnd/intentFastPath.ts
//
// P1-PLAYFIX-2 §A.3/§A.4(c) — client-side keyword fast-path for free-text
// player intent. Deterministic, zero-latency half of the hybrid classifier
// (the other half is the server-side LLM `INTENT:` line — NN `dm_narrator.py`
// / `narration.py`, a separate work item).
//
// SCOPE DISCIPLINE (do not weaken):
//   - Matching is ALWAYS bounded to the CURRENT scene's already-authored
//     transitions passed in by the caller (`transitions` from grounding) —
//     this function can never emit a target that isn't one of them. It has
//     no knowledge of any other scene.
//   - The phrase lists are deliberately small and literal, taken verbatim
//     from the approved design doc (§A.3/§A.4). Do NOT grow them into a
//     general-purpose NLU vocabulary — a broad match list is exactly the
//     "hijack roleplay into a mechanical action" failure mode the design
//     doc warns against. When in doubt, return null (fall through to
//     narrate() / the server's INTENT classifier) rather than add a phrase.
//   - A fork (2+ transitions) is a deliberate choice, not a guessable
//     intent (design doc §A.3): free-text only routes a fork branch when
//     the text unambiguously names exactly ONE transition's own authored
//     label words. An ambiguous phrase at a fork returns null so the two
//     buttons stay the affordance.
//   - MOVEMENT ONLY (P1-PLAYFIX-2 gate fix, Kage #3 / Miko DEFECT-1): checks
//     are NEVER routed by this fast-path. A fast-path check match used to
//     call onAttemptCheck() directly, which ROLLS the check immediately with
//     zero player confirmation — a keyword collision (e.g. "this place feels
//     creepy") could silently burn a real die roll. Check-implying free text
//     now always falls through to narrate(); Suzu invites the check
//     in-fiction and the server's `offered_check` signal surfaces the
//     "Attempt" button — the player still has to click/roll it themselves.
import type { SceneTransition } from '@/lib/api/types';

export type ClientIntent = { type: 'transition'; to: string };

/**
 * Escape a literal phrase for use inside a RegExp, then wrap it in `\b`
 * word-boundary anchors so it can only match whole words — not as a
 * substring of an unrelated word (e.g. "creep" inside "creepy", "get moving"
 * inside "forget moving"). Case-insensitive; caller passes already-lowercased
 * input text, so the `i` flag is defensive rather than load-bearing.
 */
function wordBoundaryRegex(phrase: string): RegExp {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}\\b`, 'i');
}

function matchesAnyPhrase(text: string, phrases: readonly string[]): boolean {
  return phrases.some((p) => wordBoundaryRegex(p).test(text));
}

/**
 * Bounded, conservative "advance the single available edge" phrases. Only
 * fires when exactly one transition is authored on the current scene (no
 * fork ambiguity) — see the fork-branch matcher below for 2+ transitions.
 *
 * NOTE: no phrase here may begin with the token "head" — that word is a
 * body-part NOUN as often as a motion VERB, so all `head …` phrases live in
 * HEAD_MOVE_PHRASES below and go through the determiner guard instead (Kage CR,
 * P1-PLAYFIX-3).
 */
const MOVE_ON_PHRASES: readonly string[] = [
  // existing (keep)
  'push on',
  'get moving',
  'go deeper',
  // P1-PLAYFIX-3: verb-anchored locomotion / continue phrases. Each is a
  // travel or advance clause that cannot open a look/emote roleplay line.
  // `toward`/`towards` are separate entries on purpose — \b won't bridge them.
  'make my way',
  'walk toward',
  'walk towards',
  'move toward',
  'move towards',
  'move forward',
  'go toward',
  'go towards',
  'move on',
  // NOTE: bare 'press on' is deliberately EXCLUDED — it collides with the
  // non-movement "apply pressure" sense ("I press on the wound", "press on the
  // lever"), which would false-advance a single-exit scene (Miko DEFECT,
  // P1-PLAYFIX-3). The advance sense is covered by 'press forward' below and by
  // 'onward' (which \b-matches inside "press onward"). Bare "I press on" falls
  // through to the server INTENT classifier — a graceful, non-fabricating miss.
  'press forward',
  'keep going',
  'keep moving',
  'continue on',
  'onward',
  'onwards',
];

/**
 * Movement phrases that START with the ambiguous token "head". "head" is a
 * motion verb ("I head towards the water") but also a body-part noun ("I nod
 * my head towards the door", "I rest my head on the stone", "I shake my head
 * for a moment"). Matched via matchesHeadMovement() — which fires ONLY when the
 * "head" is NOT preceded by a determiner that makes it the noun (Kage CR,
 * P1-PLAYFIX-3). Kept separate from MOVE_ON_PHRASES so the plain \b matcher
 * never sees them.
 */
const HEAD_MOVE_PHRASES: readonly string[] = [
  'head on',
  'head deeper',
  'head toward',
  'head towards',
  'head for',
];

/** Determiners that turn "head" into the body-part NOUN rather than the motion
 *  VERB — "my/the/her head", never "I head". If one of these immediately
 *  precedes a "head …" movement phrase, it's an emote, not locomotion. */
const HEAD_NOUN_DETERMINERS = new Set([
  'my', 'your', 'his', 'her', 'its', 'our', 'their', 'the', 'a',
]);

/**
 * True when the text contains a "head …" movement phrase used as a VERB — i.e.
 * a HEAD_MOVE_PHRASES occurrence whose "head" is not immediately preceded by a
 * body-part determiner. "I head towards the water" → true; "I nod my head
 * towards the door" → false. Conservative: any determiner-preceded occurrence
 * is skipped, and only a clean verb occurrence returns true.
 */
function matchesHeadMovement(text: string): boolean {
  return HEAD_MOVE_PHRASES.some((phrase) => {
    const re = wordBoundaryRegex(phrase);
    const m = re.exec(text);
    if (!m) return false;
    const before = text.slice(0, m.index).trimEnd();
    const lastWord = before.split(/\s+/).pop() ?? '';
    return !HEAD_NOUN_DETERMINERS.has(lastWord);
  });
}

/** Words too generic to disambiguate one fork branch from another — dropped
 *  from a transition label before it's used as a unique-match keyword. */
const LABEL_STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'to', 'toward', 'towards', 'into', 'on',
  'move', 'go', 'head', 'push', 'press', 'keep', 'moving', 'deeper', 'get',
  'find', 'my', 'way', 'follow',
]);

function normalize(text: string): string {
  return text.toLowerCase().trim();
}

/** Extract the significant (non-stopword, len>=4) words from a transition's
 *  authored label, lowercased. Used only to detect an UNAMBIGUOUS fork match. */
function labelKeywords(label: string): string[] {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !LABEL_STOPWORDS.has(w));
}

/**
 * Match free-text player input against the CURRENT scene's authored
 * transitions only (movement-only — see the module-level SCOPE DISCIPLINE
 * note on why checks are excluded). Returns null on no confident match —
 * callers MUST treat null as "send through narrate()", never a guess.
 */
export function matchKeywordIntent(
  text: string,
  transitions: readonly SceneTransition[],
): ClientIntent | null {
  const norm = normalize(text);
  if (!norm) return null;

  // 1. Single non-fork edge — "push on" style verbs, only when unambiguous
  //    (exactly one authored transition; a fork must be chosen, not guessed).
  //    Word-boundary matched so "get moving" doesn't fire inside "forget
  //    moving" and "head on" doesn't fire inside "ahead on" (Miko DEFECT-1).
  //    "head …" phrases go through matchesHeadMovement() so the body-part noun
  //    ("nod my head towards…") can't hijack the verb (Kage CR, P1-PLAYFIX-3).
  if (
    transitions.length === 1 &&
    (matchesAnyPhrase(norm, MOVE_ON_PHRASES) || matchesHeadMovement(norm))
  ) {
    return { type: 'transition', to: transitions[0].to };
  }

  // 2. Fork / multi-branch — route ONLY when the text names exactly one
  //    branch's own authored label keyword. Two-or-more matches (or zero)
  //    means "ambiguous" → null → the buttons stay the affordance.
  if (transitions.length >= 2) {
    const matches = transitions.filter((t) =>
      t.label ? matchesAnyPhrase(norm, labelKeywords(t.label)) : false,
    );
    if (matches.length === 1) {
      return { type: 'transition', to: matches[0].to };
    }
  }

  return null;
}
