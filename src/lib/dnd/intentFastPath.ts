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
//
// `matchCombatIntent` (TAV-COMBAT-VERB-NO-MECHANICS, 2026-08-09) is the one
// non-movement matcher here and it does NOT weaken the rule above: it never
// executes anything. It only lets the caller WITHHOLD a narration turn and
// offer the real mechanical affordance instead — the opposite direction of
// the check hijack that rule was written against. See its own doc block.
import type { SceneTransition } from '@/lib/api/types';

// TAV-SLICE-END-ADVANCE-NULL: `to` mirrors SceneTransition.to — a lone
// terminal (`to: null`) exit is a legitimate single-transition match too.
export type ClientIntent = { type: 'transition'; to: string | null };

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

// ───────────────────────────────────────────────────────────────────────────
// TAV-COMBAT-VERB-NO-MECHANICS (filed 2026-08-01, built 2026-08-09)
//
// THE BUG: on a scene with an authored-but-unstarted combat encounter,
// "I stand my ground and attack the nearest timberwolf with Eldritch Blast"
// produced a well-written paragraph in which the blast glanced off and the
// wolf got annoyed — with NO attack roll, NO damage, NO combat row, and the
// session still `EXPLORING`. Suzu invented both a hit and a deflection.
//
// WHY A CLIENT MATCHER IS THE FIX: a server-side guard already existed and
// LOST. `core/dm_narrator.py::build_scene_prompt` injects a "COMBAT-VERB
// GUARD" instruction whenever `combat_encounter_unstarted()` is true, telling
// the model not to resolve combat mechanically. It is advisory prose, and the
// 27B narrator overrode it. Prompt text cannot be the enforcement layer for a
// mechanical invariant. This matcher runs BEFORE the turn is sent, so the
// fabricated narration is never generated at all — which is also the only
// place the fabrication can be stopped, since DM-STREAM reveals tokens as
// they arrive and any server-side verdict lands after the prose is on screen.
//
// SCOPE (Leon's ruling, 2026-08-09):
//   - refuse-and-prompt, NEVER auto-start. A false positive must cost one
//     ignorable line, not a spawned encounter with rolled initiative — and
//     `POST /combat/from-scene` is `guard_dm` under `DND_REQUIRE_ACTOR`
//     (live on .226 AND prod), so a non-DM player at a multiplayer table
//     could not auto-start one anyway. Prompting is the only behaviour that
//     works for every actor.
//   - scenes with NO authored encounter keep today's free narration. The
//     filed grievance is specifically about a scene that HAS a mechanical
//     path the player couldn't reach; "Suzu invents outcomes in general" is a
//     separate, larger item and is deliberately not in this change.
// ───────────────────────────────────────────────────────────────────────────

/**
 * True when `phrase` occurs in `text` as a word AND at least one occurrence is
 * not immediately preceded by one of `blockedPreceding`.
 *
 * Same disambiguation trick as matchesHeadMovement() above (a determiner turns
 * a verb into a noun), generalized — and unlike that function this one scans
 * EVERY occurrence rather than only the first, so a blocked early occurrence
 * cannot mask a clean later one ("I brace for the attack, then I attack").
 * matchesHeadMovement is deliberately left as-is: re-pointing it here would
 * change movement fast-path behaviour, which this change is not scoped to.
 */
function hasCleanOccurrence(
  text: string,
  phrase: string,
  blockedPreceding: ReadonlySet<string>,
): boolean {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`\\b${escaped}\\b`, 'gi');
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const before = text.slice(0, m.index).trimEnd();
    const lastWord = before.split(/\s+/).pop() ?? '';
    if (!blockedPreceding.has(lastWord)) return true;
  }
  return false;
}

/**
 * Determiners that turn "attack" into the NOUN ("brace for the attack", "her
 * attack goes wide") rather than the player's own declared verb ("I attack").
 * Same shape and reasoning as HEAD_NOUN_DETERMINERS above.
 */
const ATTACK_NOUN_DETERMINERS: ReadonlySet<string> = new Set([
  'my', 'your', 'his', 'her', 'its', 'our', 'their', 'the', 'a', 'an',
  'that', 'this', 'first', 'next', 'last', 'another', 'any', 'no',
]);

/**
 * TIER 1 — declarations that are combat and essentially nothing else, so they
 * fire with no target requirement. Every entry is either multi-word or a verb
 * with no common non-combat sense in a first-person tabletop composer.
 *
 * "attack"/"attacking" are handled separately through the determiner guard
 * (they are the only single tokens here with a live NOUN sense) — do not move
 * them into this list.
 *
 * DISCIPLINE, same as MOVE_ON_PHRASES: when a candidate phrase has ANY
 * plausible non-combat reading, it belongs in TIER 2 (creature-name-gated),
 * not here. A tier-1 false positive refuses a legitimate roleplay turn, which
 * is the only real cost this feature can impose on a player.
 */
const COMBAT_PHRASES_UNAMBIGUOUS: readonly string[] = [
  'stand and fight',
  'stand my ground and fight',
  'open fire',
  'throw a punch',
  'swing at',
  'swing my',
  'lunge at',
  'strike at',
  'slash at',
  'stab at',
  'hack at',
  'shoot at',
  'fire at',
  'charge at',
  'loose an arrow',
  'let fly',
];

/**
 * TIER 2 — verbs that are combat ONLY in context. Each has a common innocent
 * sense that would otherwise refuse an ordinary turn: "I strike a match",
 * "I hit the road", "I shoot him a look", "I cut the rope", "I charge my
 * staff", "I cast light", "I'd fight you if I had to", "they'll kill us".
 *
 * These fire only when the text ALSO names one of the scene's own authored
 * creatures (see creatureKeywords) — i.e. the player said what they are
 * attacking, and it is a thing the encounter actually contains. That target
 * requirement is what makes a long list safe here.
 */
const COMBAT_VERBS_TARGETED: readonly string[] = [
  'fight', 'fights', 'fighting',
  'kill', 'kills', 'killing',
  'slay', 'slays', 'slaying',
  // "attacks" only — the noun-plural sense ("her attacks go wide") is what
  // makes it ambiguous. Bare "attack"/"attacking" are NOT repeated here:
  // tier 1a already returns on them, so listing them would be dead weight.
  'attacks',
  'strike', 'strikes', 'striking',
  'hit', 'hits', 'hitting',
  'shoot', 'shoots', 'shooting',
  'stab', 'stabs', 'stabbing',
  'slash', 'slashes', 'slashing',
  'swing', 'swings', 'swinging',
  'charge', 'charges', 'charging',
  'blast', 'blasts', 'blasting',
  'cast', 'casts', 'casting',
  'smash', 'smashes', 'smashing',
  'bash', 'bashes', 'bashing',
  'punch', 'punches', 'punching',
  'tackle', 'tackles', 'tackling',
  'grapple', 'grapples', 'grappling',
  'shove', 'shoves', 'shoving',
  'cut', 'cuts', 'cutting',
  'fire', 'fires', 'firing',
  'throw', 'throws', 'throwing',
];

/** Generic words inside an authored creature name that identify nothing on
 *  their own — dropped so "the young" or "of the" can't stand in for the
 *  creature. Mirrors LABEL_STOPWORDS' role for transition labels. */
const CREATURE_NAME_STOPWORDS = new Set([
  'the', 'and', 'of', 'a', 'an', 'creature', 'monster', 'beast', 'enemy',
]);

/**
 * Turn the scene's authored creature names into match keywords.
 *
 * Takes `grounding.encounter.monsters_resolved[].name` — populated by the
 * engine on EVERY grounding fetch from the scene's authored `monsters` refs
 * (routes/sessions.py ~1431), independent of whether combat ever started, so
 * these names are available in exactly the pre-combat window this guard runs
 * in. Emits the full lowercased name (so multi-word names like "dire wolf"
 * match as a phrase) plus each significant word (len >= 4, non-stopword), so
 * "Timberwolf (juvenile)" is reachable as both "timberwolf" and "juvenile".
 *
 * NPCs are deliberately NOT a source: they are usually the scene's friendly
 * faces, and folding them in makes "I hit it off with Zecora" a combat verb
 * plus a name — a false refusal on pure dialogue.
 */
export function creatureKeywords(names: readonly (string | undefined)[]): string[] {
  const out = new Set<string>();
  for (const raw of names) {
    if (typeof raw !== 'string') continue;
    const cleaned = raw.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').trim();
    if (!cleaned) continue;
    const collapsed = cleaned.replace(/\s+/g, ' ');
    if (collapsed.length >= 3) out.add(collapsed);
    for (const w of collapsed.split(' ')) {
      if (w.length >= 4 && !CREATURE_NAME_STOPWORDS.has(w)) out.add(w);
    }
  }
  return [...out];
}

/**
 * True when free text reads as the player declaring a combat action.
 *
 * PURE and side-effect free — it decides nothing about state. The CALLER owns
 * the gate ("is there an authored combat encounter here that has never been
 * started?"), exactly as matchKeywordIntent's caller owns `transitions`; this
 * function is only ever asked about the words.
 *
 * `creatureNames` are the scene's authored creature names (pass
 * `monsters_resolved.map(m => m.name)`); an empty list simply means tier 2
 * cannot fire, never that tier 1 is skipped.
 */
export function matchCombatIntent(
  text: string,
  creatureNames: readonly (string | undefined)[] = [],
): boolean {
  const norm = normalize(text);
  if (!norm) return false;

  // Tier 1a — "attack"/"attacking" as the player's verb, not as a noun.
  if (
    hasCleanOccurrence(norm, 'attack', ATTACK_NOUN_DETERMINERS) ||
    hasCleanOccurrence(norm, 'attacking', ATTACK_NOUN_DETERMINERS)
  ) {
    return true;
  }

  // Tier 1b — unambiguous multi-word declarations.
  if (matchesAnyPhrase(norm, COMBAT_PHRASES_UNAMBIGUOUS)) return true;

  // Tier 2 — an ambiguous combat verb AND one of THIS scene's creatures named.
  const creatures = creatureKeywords(creatureNames);
  if (creatures.length && matchesAnyPhrase(norm, creatures)) {
    if (matchesAnyPhrase(norm, COMBAT_VERBS_TARGETED)) return true;
  }

  return false;
}
