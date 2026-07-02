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
 */
const MOVE_ON_PHRASES: readonly string[] = [
  'head on',
  'push on',
  'get moving',
  'go deeper',
  'head deeper',
];

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
  if (transitions.length === 1 && matchesAnyPhrase(norm, MOVE_ON_PHRASES)) {
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
