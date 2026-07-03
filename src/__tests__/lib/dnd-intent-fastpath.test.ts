/**
 * P1-PLAYFIX-2 §A.3/§A.4(c) — client-side keyword fast-path matcher
 * (src/lib/dnd/intentFastPath.ts).
 *
 * P1-PLAYFIX-2 gate fix (2026-07-02, Kage #3 / Miko DEFECT-1): the fast-path
 * is now MOVEMENT ONLY. `matchKeywordIntent` no longer accepts a `checks`
 * argument and never returns a `{ type: 'check' }` intent — a fast-path check
 * match used to call `onAttemptCheck()` directly, which ROLLS the check
 * immediately with zero player confirmation. Check-implying free text always
 * falls through to `narrate()` now; the server's `offered_check` signal
 * surfaces the "Attempt" button instead. See play.intent-fastpath.test.tsx
 * for the end-to-end (page-level) coverage of that fallthrough.
 *
 * Coverage:
 *   - single non-fork "push on" style phrases route to the sole transition,
 *     word-boundary safe (do not fire as a substring of an unrelated word)
 *   - fork (2+ transitions): unambiguous label-keyword match routes; an
 *     ambiguous phrase returns null so the buttons stay the affordance
 *   - roleplay / no-match text always returns null
 */
import type { SceneTransition } from '@/lib/api/types';
import { matchKeywordIntent } from '@/lib/dnd/intentFastPath';

const SINGLE_TRANSITION: SceneTransition = { to: 'slice_everfree_navigate', label: 'Get moving' };

const FORK_SMOKE: SceneTransition = {
  to: 'slice_everfree_zecora',
  label: 'Follow the smoke — southeast',
};
const FORK_PATH: SceneTransition = {
  to: 'slice_everfree_ponyville',
  label: 'Follow the path — northwest',
};

describe('matchKeywordIntent — single non-fork "push on" phrases', () => {
  it('"I head deeper" routes to the sole transition', () => {
    expect(matchKeywordIntent('I head deeper', [SINGLE_TRANSITION])).toEqual({
      type: 'transition',
      to: 'slice_everfree_navigate',
    });
  });

  it('"push on" routes to the sole transition', () => {
    expect(matchKeywordIntent('Let\'s push on', [SINGLE_TRANSITION])).toEqual({
      type: 'transition',
      to: 'slice_everfree_navigate',
    });
  });

  it('"get moving" routes to the sole transition', () => {
    expect(matchKeywordIntent('get moving already', [SINGLE_TRANSITION])).toEqual({
      type: 'transition',
      to: 'slice_everfree_navigate',
    });
  });

  it('"go deeper" routes to the sole transition', () => {
    expect(matchKeywordIntent('we go deeper into the woods', [SINGLE_TRANSITION])).toEqual({
      type: 'transition',
      to: 'slice_everfree_navigate',
    });
  });

  it('is case-insensitive', () => {
    expect(matchKeywordIntent('PUSH ON', [SINGLE_TRANSITION])).toEqual({
      type: 'transition',
      to: 'slice_everfree_navigate',
    });
  });

  it('does NOT fire the move-on phrase when there are zero transitions', () => {
    expect(matchKeywordIntent('I push on', [])).toBeNull();
  });

  it('does NOT fire the move-on phrase when there are 2+ transitions (a fork)', () => {
    // "push on" names no fork-branch keyword — ambiguous at a fork.
    expect(matchKeywordIntent('I push on', [FORK_SMOKE, FORK_PATH])).toBeNull();
  });
});

describe('matchKeywordIntent — fork disambiguation (§A.3 "fork = deliberate branch")', () => {
  it('"I follow the smoke" routes to the smoke branch only', () => {
    expect(matchKeywordIntent('I follow the smoke', [FORK_SMOKE, FORK_PATH])).toEqual({
      type: 'transition',
      to: 'slice_everfree_zecora',
    });
  });

  it('"I follow the path" routes to the path branch only', () => {
    expect(matchKeywordIntent('I follow the path', [FORK_SMOKE, FORK_PATH])).toEqual({
      type: 'transition',
      to: 'slice_everfree_ponyville',
    });
  });

  it('an ambiguous "I move on" at a fork returns null — never guesses a branch', () => {
    expect(matchKeywordIntent('I move on', [FORK_SMOKE, FORK_PATH])).toBeNull();
  });

  it('a phrase naming neither branch keyword returns null at a fork', () => {
    expect(matchKeywordIntent('I sit and think for a while', [FORK_SMOKE, FORK_PATH])).toBeNull();
  });
});

describe('matchKeywordIntent — roleplay / ambiguous text always falls through', () => {
  it('pure roleplay text with no scene affordances returns null', () => {
    expect(matchKeywordIntent('I hum a little tune to myself.', [])).toBeNull();
  });

  it('roleplay text that happens to share no keywords with authored affordances returns null', () => {
    expect(
      matchKeywordIntent(
        'I ask the innkeeper about the strange lights last night.',
        [SINGLE_TRANSITION],
      ),
    ).toBeNull();
  });

  it('empty string returns null', () => {
    expect(matchKeywordIntent('', [SINGLE_TRANSITION])).toBeNull();
  });

  it('whitespace-only string returns null', () => {
    expect(matchKeywordIntent('   ', [SINGLE_TRANSITION])).toBeNull();
  });

  it('"I whisper to myself that I miss home" (pure roleplay) returns null', () => {
    expect(matchKeywordIntent('I whisper to myself that I miss home', [SINGLE_TRANSITION])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// P1-PLAYFIX-2 gate fix (2026-07-02) — word-boundary matching, flipped from
// Miko's original `it.failing` DEFECT report (HIGH severity) to passing
// assertions now that intentFastPath.ts anchors every phrase with `\b`.
//
// The original report also covered a check-intent hijack ("creepy" →
// stealth), but that whole class of bug is now structurally impossible: the
// fast-path no longer matches check phrases at all (see Kage #3 / DEFECT-1
// fix above the imports) — there is nothing left to word-boundary-guard on
// the check side because there is no check side. Only the two transition
// substring-hijack repros remain applicable and are covered below.
// ---------------------------------------------------------------------------
describe('matchKeywordIntent — word-boundary safety (no substring phrase-hijack)', () => {
  it('"I forget moving my character sheet" does NOT fire the single-transition move-on fast-path just because it contains "get moving" as a substring', () => {
    expect(
      matchKeywordIntent(
        'I forget moving my character sheet last session, sorry.',
        [SINGLE_TRANSITION],
      ),
    ).toBeNull();
  });

  it('"I glance ahead on the trail" does NOT fire the single-transition move-on fast-path just because it contains "head on" as a substring', () => {
    expect(
      matchKeywordIntent('I glance ahead on the trail, nothing more.', [SINGLE_TRANSITION]),
    ).toBeNull();
  });

  it('a fork label keyword must match as a whole word too (not as a substring of another word)', () => {
    // "smoker" contains "smoke" as a substring but is not the same word.
    const forkWithTrickyLabel: SceneTransition = {
      to: 'slice_everfree_zecora',
      label: 'Follow the smoke',
    };
    expect(
      matchKeywordIntent(
        'The old smoker by the fire waves at us.',
        [forkWithTrickyLabel, FORK_PATH],
      ),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// P1-PLAYFIX-3 — broadened MOVE_ON_PHRASES (verb-anchored locomotion/advance
// phrases). Single-transition scene throughout this block.
// ---------------------------------------------------------------------------
describe('matchKeywordIntent — P1-PLAYFIX-3 broadened MOVE_ON_PHRASES (positive)', () => {
  it('"I head towards the sound of water" routes to the sole transition (acceptance phrasing)', () => {
    expect(
      matchKeywordIntent('I head towards the sound of water', [SINGLE_TRANSITION]),
    ).toEqual({ type: 'transition', to: 'slice_everfree_navigate' });
  });

  it('"I make my way down the path" routes to the sole transition', () => {
    expect(
      matchKeywordIntent('I make my way down the path', [SINGLE_TRANSITION]),
    ).toEqual({ type: 'transition', to: 'slice_everfree_navigate' });
  });

  it('"I press forward" routes to the sole transition', () => {
    expect(matchKeywordIntent('I press forward', [SINGLE_TRANSITION])).toEqual({
      type: 'transition',
      to: 'slice_everfree_navigate',
    });
  });

  it('"I press onward, deeper into the trees" routes via the "onward" phrase', () => {
    expect(
      matchKeywordIntent('I press onward, deeper into the trees', [SINGLE_TRANSITION]),
    ).toEqual({ type: 'transition', to: 'slice_everfree_navigate' });
  });

  it('"let\'s keep going" routes to the sole transition', () => {
    expect(matchKeywordIntent("let's keep going", [SINGLE_TRANSITION])).toEqual({
      type: 'transition',
      to: 'slice_everfree_navigate',
    });
  });

  it('"onward" routes to the sole transition', () => {
    expect(matchKeywordIntent('onward', [SINGLE_TRANSITION])).toEqual({
      type: 'transition',
      to: 'slice_everfree_navigate',
    });
  });

  it('"push on" still routes to the sole transition (pre-existing phrase, regression guard)', () => {
    expect(matchKeywordIntent('push on', [SINGLE_TRANSITION])).toEqual({
      type: 'transition',
      to: 'slice_everfree_navigate',
    });
  });

  it('"head on" still routes to the sole transition (pre-existing phrase, regression guard)', () => {
    expect(matchKeywordIntent('head on', [SINGLE_TRANSITION])).toEqual({
      type: 'transition',
      to: 'slice_everfree_navigate',
    });
  });
});

describe('matchKeywordIntent — P1-PLAYFIX-3 excluded-phrase discipline (negative, must return null)', () => {
  it('"I look around" does not hijack — looking is not movement', () => {
    expect(matchKeywordIntent('I look around', [SINGLE_TRANSITION])).toBeNull();
  });

  it('"I pause, unsettled by how wrong this feels" does not hijack', () => {
    expect(
      matchKeywordIntent(
        'I pause, unsettled by how wrong this feels',
        [SINGLE_TRANSITION],
      ),
    ).toBeNull();
  });

  it('"I glance toward the shadows" does not hijack — bare "toward" is excluded, not verb-anchored', () => {
    expect(
      matchKeywordIntent('I glance toward the shadows', [SINGLE_TRANSITION]),
    ).toBeNull();
  });

  it('"I follow her gaze" does not hijack — bare "follow" is excluded (fork-label word, not in MOVE_ON_PHRASES)', () => {
    expect(matchKeywordIntent('I follow her gaze', [SINGLE_TRANSITION])).toBeNull();
  });

  it('"I go to my knees" does not hijack — bare "go to" is excluded (body/state idiom collision)', () => {
    expect(matchKeywordIntent('I go to my knees', [SINGLE_TRANSITION])).toBeNull();
  });

  it('"I nod towards the door" does not hijack — bare "towards" is excluded, not verb-anchored', () => {
    expect(matchKeywordIntent('I nod towards the door', [SINGLE_TRANSITION])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Kage CR (P1-PLAYFIX-3): "head" is a body-part NOUN as often as a motion VERB.
// The determiner guard (matchesHeadMovement + HEAD_NOUN_DETERMINERS) must let
// "I head towards X" advance while rejecting "<possessive> head towards/on/for".
// ---------------------------------------------------------------------------
describe('matchKeywordIntent — P1-PLAYFIX-3 "head" verb-vs-noun determiner guard', () => {
  // Positive: "head" as a motion verb still advances a single-exit scene.
  it('"I head towards the sound of water" advances (acceptance phrasing)', () => {
    expect(
      matchKeywordIntent('I head towards the sound of water', [SINGLE_TRANSITION]),
    ).toEqual({ type: 'transition', to: 'slice_everfree_navigate' });
  });

  it('"I head for the treeline" advances', () => {
    expect(matchKeywordIntent('I head for the treeline', [SINGLE_TRANSITION])).toEqual({
      type: 'transition',
      to: 'slice_everfree_navigate',
    });
  });

  it('"I head deeper into the woods" advances (pre-existing phrase, guarded)', () => {
    expect(
      matchKeywordIntent('I head deeper into the woods', [SINGLE_TRANSITION]),
    ).toEqual({ type: 'transition', to: 'slice_everfree_navigate' });
  });

  // Negative: "head" as a body-part noun after a determiner must NOT advance.
  it('"I nod my head towards the door" does NOT hijack — "my head" is the body part', () => {
    expect(
      matchKeywordIntent('I nod my head towards the door', [SINGLE_TRANSITION]),
    ).toBeNull();
  });

  it('"I turn my head toward her voice" does NOT hijack', () => {
    expect(
      matchKeywordIntent('I turn my head toward her voice', [SINGLE_TRANSITION]),
    ).toBeNull();
  });

  it('"I shake my head for a moment" does NOT hijack', () => {
    expect(
      matchKeywordIntent('I shake my head for a moment', [SINGLE_TRANSITION]),
    ).toBeNull();
  });

  it('"I rest my head on the cold stone" does NOT hijack ("head on" as noun)', () => {
    expect(
      matchKeywordIntent('I rest my head on the cold stone', [SINGLE_TRANSITION]),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// DEFECT FIXED (Miko-QA found, P1-PLAYFIX-3 adversarial pass, 2026-07-02):
// bare `press on` used to false-advance on the non-movement, physical-action
// sense of "press on [something]" — apply/maintain pressure — which is ordinary
// D&D combat/first-aid roleplay ("press on the wound to stop the bleeding").
// Resolved by DROPPING bare `press on` from MOVE_ON_PHRASES; the advance sense
// is preserved by `press forward` and by `onward` (\b-matches inside "press
// onward"). These now-passing tests lock in the corrected behavior — bare
// "press on [object]" falls through to narrate() (returns null).
// ---------------------------------------------------------------------------
describe('matchKeywordIntent — P1-PLAYFIX-3: bare "press on [object]" must NOT hijack (roleplay collision, fixed)', () => {
  it('"I press on the wound to stop the bleeding" is NOT movement and returns null', () => {
    expect(
      matchKeywordIntent(
        'I press on the wound to stop the bleeding',
        [SINGLE_TRANSITION],
      ),
    ).toBeNull();
  });

  it('"I press on the lever, hoping it does something" is NOT movement and returns null', () => {
    expect(
      matchKeywordIntent(
        'I press on the lever, hoping it does something',
        [SINGLE_TRANSITION],
      ),
    ).toBeNull();
  });
});
