/**
 * @jest-environment node
 *
 * TAV-PLAY-SHELL step 5 hook 4 (useScene) moved `isSessionLocked` and
 * `buildReadAloudBlock` from page.tsx into
 * `src/app/play/[sessionId]/format.ts` verbatim. Neither function had a
 * dedicated unit test before or after the move — both were only exercised
 * indirectly through the big `/play` page-level RTL suites (e.g.
 * play.ddx25-session-controls-adversarial.test.tsx for the lock gate,
 * play.opening.test.tsx for the read-aloud block). This file adds the
 * direct, fast, pure-function coverage the move makes cheap to add and
 * does not touch or rewrite any existing test (Miko-QA, TAV-PLAY-SHELL A1
 * QA pass).
 */
import { isSessionLocked, buildReadAloudBlock, isCombatEngaged } from '../../app/play/[sessionId]/format';
import type { CombatState, GroundingData, Session } from '../../lib/api/types';

function makeSession(status: Session['status']): Session {
  return {
    session_id: 'sess-format-1',
    status,
  } as Session;
}

function makeCombatState(state: CombatState['state']): CombatState {
  return {
    combat_id: 'combat-format-1',
    session_id: 'sess-format-1',
    round: 1,
    state,
    turn_index: 0,
    active_participant_id: null,
    initiative: [],
    participants: [],
  };
}

describe('isSessionLocked', () => {
  it('is false for an active session', () => {
    expect(isSessionLocked(makeSession('active'))).toBe(false);
  });

  it('is true for a paused session', () => {
    expect(isSessionLocked(makeSession('paused'))).toBe(true);
  });

  it('is true for an ended session', () => {
    expect(isSessionLocked(makeSession('ended'))).toBe(true);
  });

  it('is false for null/undefined (no session loaded yet)', () => {
    expect(isSessionLocked(null)).toBe(false);
    expect(isSessionLocked(undefined)).toBe(false);
  });
});

describe('isCombatEngaged', () => {
  // A2 commit 0 (Kage-CR A1b IMPORTANT-2, verbatim): "`isCombatEngaged` is
  // unpinned against the exact `combatIsActive` confusion it exists to
  // prevent ... replacing its body with `!!combatState && combatState.state
  // !== 'ended'` (M3) -> all green. The corpus only ever sets `state:
  // 'active'` or `'ended'` -- zero fixtures for the three states the
  // predicates disagree on." This table covers all five states plus null so
  // M3 (the combatIsActive body swap) cannot survive silently again.
  it.each([
    ['active', true],
    ['between_turns', false],
    ['rolling_initiative', false],
    ['idle', false],
    ['ended', false],
  ] as const)("combat state '%s' -> %s", (state, expected) => {
    expect(isCombatEngaged(makeCombatState(state))).toBe(expected);
  });

  it('is false for null (no active combat)', () => {
    expect(isCombatEngaged(null)).toBe(false);
  });
});

describe('buildReadAloudBlock', () => {
  it('assembles every present field in the authored order, blank-line-separated', () => {
    const g: GroundingData = {
      adventure_title: 'The Hollow Tide',
      hook: 'A bell tolls beneath the waves.',
      scene_name: 'The Drowned Bell',
      boxed_text: 'Salt air. The bell rings once more.',
      objective: 'Silence the bell before high tide.',
    };
    expect(buildReadAloudBlock(g)).toBe(
      [
        '— The Hollow Tide —',
        'A bell tolls beneath the waves.',
        '\nScene: The Drowned Bell',
        'Salt air. The bell rings once more.',
        '\nObjective: Silence the bell before high tide.',
      ].join('\n'),
    );
  });

  it('omits missing fields rather than leaving a blank line', () => {
    // Discriminates from the "everything present" fixture above with
    // distinct values, and specifically leaves out adventure_title AND
    // objective so the .filter(Boolean) drop of BOTH a leading and a
    // trailing optional field is exercised, not just one.
    const g: GroundingData = {
      scene_name: 'A Nameless Crossing',
      boxed_text: 'The bridge groans underfoot.',
    };
    expect(buildReadAloudBlock(g)).toBe(
      ['\nScene: A Nameless Crossing', 'The bridge groans underfoot.'].join('\n'),
    );
  });

  it('returns an empty string when grounding carries none of the block fields', () => {
    expect(buildReadAloudBlock({} as GroundingData)).toBe('');
  });
});
